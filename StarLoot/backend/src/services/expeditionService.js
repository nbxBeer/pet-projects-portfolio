'use strict';

const crypto = require('crypto');
const { query, withTransaction } = require('../db/pool');
const FindGeneratorService = require('./findGeneratorService');
const EventService = require('./eventService');
const logger = require('../utils/logger');

class ExpeditionService {
  constructor(configManager, nftNotificationService = null, buffService = null, eventService = null, tournamentService = null, miniTournamentService = null) {
    this.cfg = configManager;
    this.generator = new FindGeneratorService(configManager);
    this.nftService = nftNotificationService;
    this.buffService = buffService;
    this.eventService = eventService;
    this.tournamentService = tournamentService;
    this.miniTournamentService = miniTournamentService;
  }

  _trackMiniTournament(userId) {
    if (!this.miniTournamentService) return;
    setImmediate(() => {
      this.miniTournamentService.trackCompletionAndNotify(userId)
        .catch((err) => logger.warn({ err, userId }, 'Mini-tournament tracking failed'));
    });
  }

  _getRarityConfig(rarity) {
    const config = this.cfg.config;
    return config.universe2?.rarity?.[rarity] || config.rarity?.[rarity] || null;
  }

  /**
   * Start a new expedition.
   * Also auto-awards pending XP from previous expeditions that the user didn't act on.
   */
  async startExpedition(userId, { zoneId, clientSeed, longExpedition = false }) {
    const config = this.cfg.config;

    if (!this.generator.validateClientSeed(clientSeed)) {
      throw { status: 400, message: 'Invalid client seed format' };
    }

    // Look up zone from both universes
    let zone = config.zones.find((z) => z.id === zoneId);
    let expeditionUniverse = 1;
    if (!zone && config.universe2?.zones) {
      zone = config.universe2.zones.find((z) => z.id === zoneId);
      if (zone) expeditionUniverse = 2;
    }
    if (!zone) throw { status: 400, message: 'Unknown zone' };

    // Long expedition requires Particle Decelerator story item
    if (longExpedition) {
      const hasDecelerator = await query(
        `SELECT 1 FROM user_story_items WHERE user_id = $1 AND item_key = 'particle_decelerator'`,
        [userId]
      );
      if (!hasDecelerator.rows.length) {
        throw { status: 403, message: 'Particle Decelerator required for long expeditions' };
      }
    }

    return await withTransaction(async (client) => {
      const userRes = await client.query(
        'SELECT * FROM users WHERE id = $1 FOR UPDATE',
        [userId]
      );
      if (!userRes.rows.length) throw { status: 404, message: 'User not found' };
      const userRow = userRes.rows[0];

      // Auto-claim any pending results (user left without choosing action)
      await this._autoClaimPending(client, userId, config, userRow.prestige_level);

      const activeRes = await client.query(
        `SELECT id FROM expeditions WHERE user_id = $1 AND status IN ('in_progress', 'completed') LIMIT 1`,
        [userId]
      );
      if (activeRes.rows.length > 0) {
        throw { status: 409, message: 'Expedition already in progress' };
      }

      if (userRow.expedition_cooldown_until && new Date(userRow.expedition_cooldown_until) > new Date()) {
        throw {
          status: 403,
          message: 'Временный запрет: корабль повреждён после столкновения с пиратами',
          cooldownUntil: userRow.expedition_cooldown_until,
        };
      }

      // Auto-complete travel if timer already expired.
      if (userRow.universe_travel_until && new Date(userRow.universe_travel_until) <= new Date()) {
        const newUniverse = userRow.current_universe === 1 ? 2 : 1;
        await client.query(
          'UPDATE users SET current_universe = $1, universe_travel_until = NULL WHERE id = $2',
          [newUniverse, userId]
        );
        // Insert when arriving at U2 OR returning from U2 — keeps the flag sticky
        await client.query(
          `INSERT INTO user_story_items (user_id, item_key, item_data)
           VALUES ($1, 'visited_universe2', '{}'::jsonb)
           ON CONFLICT (user_id, item_key) DO NOTHING`,
          [userId]
        );
        logger.info({ userId, newUniverse }, 'Universe travel auto-completed during expedition start');
        const freshUserRes = await client.query(
          'SELECT * FROM users WHERE id = $1 FOR UPDATE',
          [userId]
        );
        Object.assign(userRow, freshUserRes.rows[0]);
      }

      if (userRow.universe_travel_until && new Date(userRow.universe_travel_until) > new Date()) {
        throw {
          status: 409,
          message: 'Cannot start expedition while traveling between universes',
          travelUntil: userRow.universe_travel_until,
        };
      }

      // Validate user is in the correct universe
      const userUniverse = userRow.current_universe || 1;
      if (expeditionUniverse !== userUniverse) {
        throw { status: 403, message: `Zone belongs to Universe ${expeditionUniverse}, you are in Universe ${userUniverse}` };
      }

      if (userRow.level < zone.minLevel) {
        throw { status: 403, message: `Zone requires level ${zone.minLevel}` };
      }

      const engineRes = await client.query(
        'SELECT * FROM ship_modules WHERE user_id = $1 AND module_type = $2',
        [userId, 'engine']
      );
      const engineModule = engineRes.rows[0] || null;
      const engineCfg = config.modules.engine.levels[engineModule?.level || 0];
      let durationMultiplier = engineCfg?.durationMultiplier || 1.0;

      if (this.buffService) {
        const buffsMap = await this.buffService.getActiveBuffsMap(userId);
        if (buffsMap.turbo_engine) {
          durationMultiplier *= buffsMap.turbo_engine.metadata?.durationMultiplier || 0.5;
        }
      }

      const prestigeLevel = Number(userRow.prestige_level || 0);

      let durationMs;
      if (longExpedition) {
        // Long expeditions are fixed-duration.
        let longBase = 120 * 60 * 1000;
        if (prestigeLevel > 0) longBase = Math.round(longBase * 0.9); // prestige -10%
        durationMs = longBase;
      } else {
        // Base duration before multipliers
        let baseDurationMs = config.expedition.baseDurationMinutes * 60 * 1000;

        // Prestige bonus: -10% applied first (before channel sub and engine module)
        if (prestigeLevel > 0) {
          baseDurationMs = Math.round(baseDurationMs * 0.9);
        }

        // Channel subscription bonus: -30s applied BEFORE multipliers
        if (this.bot) {
          try {
            const isMember = await this._checkChannelMembership(client, userId, userRow);
            if (isMember) {
              baseDurationMs = Math.max(1000, baseDurationMs - 30 * 1000);
            }
          } catch (err) {
            // Don't block expedition if check fails
          }
        }

        durationMs = baseDurationMs * durationMultiplier;
      }

      const endsAt = new Date(Date.now() + durationMs);

      const sectors = expeditionUniverse === 2 ? (config.universe2?.sectors || config.sectors) : config.sectors;
      const sector = sectors[Math.floor(Math.random() * sectors.length)];
      const serverSeed = this.generator.generateServerSeed();

      let eventSnapshot = [];
      if (this.eventService) {
        const activeEvent = await this.eventService.getActiveEvent().catch(() => null);
        if (activeEvent) eventSnapshot = activeEvent.effects || [];
      }

      const result = await client.query(
        `INSERT INTO expeditions
           (user_id, zone_id, sector, status, ends_at, client_seed, server_seed, event_snapshot, is_long_expedition, universe)
         VALUES ($1, $2, $3, 'in_progress', $4, $5, $6, $7, $8, $9)
         RETURNING id, zone_id, sector, status, started_at, ends_at, is_long_expedition, universe`,
        [userId, zoneId, sector, endsAt, clientSeed, serverSeed, JSON.stringify(eventSnapshot), longExpedition, expeditionUniverse]
      );

      const expedition = result.rows[0];
      logger.info({ userId, expeditionId: expedition.id, zoneId, endsAt, longExpedition }, 'Expedition started');

      return {
        expeditionId: expedition.id,
        zoneId: expedition.zone_id,
        sector: expedition.sector,
        startedAt: expedition.started_at,
        endsAt: expedition.ends_at,
        durationSeconds: Math.round(durationMs / 1000),
        isLongExpedition: expedition.is_long_expedition,
        universe: expedition.universe || 1,
      };
    });
  }

  /**
   * Speed up expedition by spending Stars from wallet.
   */
  async speedUpExpedition(userId, expeditionId) {
    const expedition = await this._getExpeditionById(expeditionId, userId);
    if (!expedition) throw { status: 404, message: 'Expedition not found' };
    if (expedition.status !== 'in_progress') throw { status: 409, message: 'Expedition not in progress' };
    if (expedition.was_sped_up) throw { status: 409, message: 'Already sped up' };

    const costStars = expedition.is_long_expedition ? 20 : this.cfg.get('expedition.speedUpCostStars');

    return await withTransaction(async (client) => {
      const userRes = await client.query(
        'SELECT stars_balance FROM users WHERE id = $1 FOR UPDATE',
        [userId]
      );
      const user = userRes.rows[0];
      if (!user || user.stars_balance < costStars) {
        throw { status: 402, message: 'Insufficient Stars balance', required: costStars, current: user?.stars_balance || 0 };
      }

      await client.query(
        'UPDATE users SET stars_balance = stars_balance - $1, total_stars_spent = total_stars_spent + $1, total_speedups = total_speedups + 1 WHERE id = $2',
        [costStars, userId]
      );
      await client.query(
        `INSERT INTO stars_transactions
           (user_id, type, amount, balance_before, balance_after, reference_id, description)
         VALUES ($1, 'spend_speedup', $2, $3, $4, $5, $6)`,
        [userId, -costStars, user.stars_balance, user.stars_balance - costStars, expeditionId, 'Ускорение экспедиции']
      );
      await client.query(
        `UPDATE expeditions
         SET ends_at = NOW() - INTERVAL '1 second', was_sped_up = true, speedup_cost_stars = $1
         WHERE id = $2 AND user_id = $3`,
        [costStars, expeditionId, userId]
      );

      logger.info({ userId, expeditionId, costStars }, 'Expedition sped up');
      return { success: true, expeditionId, starsSpent: costStars, starsRemaining: user.stars_balance - costStars };
    });
  }

  /**
   * Collect expedition result.
   * UNIFIED: generates the find, adds to inventory, but does NOT award XP.
   * XP is awarded when user takes action (sell / collect / auto-claim).
   */
  async collectExpedition(userId, expeditionId) {
    const expedition = await this._getExpeditionById(expeditionId, userId);
    if (!expedition) throw { status: 404, message: 'Expedition not found' };
    if (expedition.status === 'collected') throw { status: 409, message: 'Already collected' };

    // Pirate pending idempotency
    if (expedition.pirate_pending_data) {
      return this._formatPirateEncounter(expedition);
    }

    // Idempotency — result already generated, return it
    const existing = await query(
      'SELECT * FROM expedition_results WHERE expedition_id = $1',
      [expeditionId]
    );
    if (existing.rows.length > 0) {
      return { ...this._formatResult(existing.rows[0], expedition), outcome: 'success', inventoryItemId: null };
    }

    if (expedition.status !== 'in_progress') throw { status: 409, message: 'Expedition not ready' };

    if (new Date(expedition.ends_at) > new Date()) {
      throw {
        status: 425,
        message: 'Expedition not finished yet',
        remainingSeconds: Math.ceil((new Date(expedition.ends_at) - new Date()) / 1000),
      };
    }

    const config = this.cfg.config;
    const expUniverse = expedition.universe || 1;
    let zone = config.zones.find((z) => z.id === expedition.zone_id);
    if (!zone && config.universe2?.zones) {
      zone = config.universe2.zones.find((z) => z.id === expedition.zone_id);
    }
    if (!zone) {
      logger.warn({ userId, expeditionId, zoneId: expedition.zone_id, universe: expUniverse }, 'Zone config missing, using fallback multipliers');
      zone = {
        id: expedition.zone_id || 'unknown_zone',
        name: 'Unknown Zone',
        rarityMultiplier: 1.0,
        findTypeModifiers: {},
        creditMultiplier: 1.0,
        xpMultiplier: 1.0,
      };
    }

    const scannerModule = await this._getModule(userId, 'scanner');
    const scannerCfg = config.modules.scanner.levels[scannerModule?.level || 0];
    const buffsMap = this.buffService ? await this.buffService.getActiveBuffsMap(userId) : {};
    const eventEffects = Array.isArray(expedition.event_snapshot) ? expedition.event_snapshot : [];

    let find = await this.generator.generate(expedition.server_seed, expedition.client_seed, zone, scannerCfg, buffsMap, userId, eventEffects, expUniverse);

    // Long expedition: reroll until Rare+ and no NFT (max 10 tries to avoid infinite loop)
    if (expedition.is_long_expedition) {
      // Universe-specific rarity thresholds for long expeditions
      const RARE_PLUS_U1 = ['rare', 'epic', 'legendary', 'mythical'];
      const RARE_PLUS_U2 = ['ancient', 'relic', 'hybrid', 'singularity'];
      const rarePlusThresholds = expUniverse === 2 ? RARE_PLUS_U2 : RARE_PLUS_U1;
      
      let rerolls = 0;
      while ((!rarePlusThresholds.includes(find.rarity) || find.findType === 'nft_container') && rerolls < 10) {
        const extraSeed = expedition.server_seed + '_long_' + rerolls;
        find = await this.generator.generate(extraSeed, expedition.client_seed, zone, scannerCfg, buffsMap, userId, eventEffects, expUniverse);
        rerolls++;
      }
      // Fallback: if still below threshold after 10 rerolls, force the lowest "rare+" rarity for this universe
      if (!rarePlusThresholds.includes(find.rarity)) {
        find.rarity = expUniverse === 2 ? 'ancient' : 'rare';
      }
      // Strip NFT from long expeditions
      if (find.findType === 'nft_container') {
        find.findType = 'artifact';
        find.rarity = expUniverse === 2 ? 'relic' : 'epic';
      }

      // 5% chance to drop Divine Shard (both universes, Tech Institute quest)
      const shardFind = await this._rollDivineShardDrop(userId, expedition, find, expUniverse);
      if (shardFind) {
        find = shardFind;
      } else {
        // 5% one-time replacement drop: signal becomes the expedition reward.
        const signalFind = await this._rollUniverseSignalDrop(userId, expedition, find);
        if (signalFind) {
          find = signalFind;
        }
      }
    }

    // Insurance policy: reroll once if lowest-tier rarity
    const lowestRarityU1 = 'common';
    const lowestRarityU2 = 'exotic';
    const currentLowest = expUniverse === 2 ? lowestRarityU2 : lowestRarityU1;
    
    if (buffsMap.insurance_policy && find.rarity === currentLowest && find.findType !== 'nft_container') {
      const rerollFind = await this._rerollNoNft(expedition.server_seed, expedition.client_seed, zone, scannerCfg, buffsMap, config, eventEffects, expUniverse);
      if (rerollFind) {
        const RARITY_ORDER_U1 = ['common', 'rare', 'epic', 'legendary', 'mythical'];
        const RARITY_ORDER_U2 = ['exotic', 'ancient', 'relic', 'hybrid', 'singularity'];
        const rarityOrder = expUniverse === 2 ? RARITY_ORDER_U2 : RARITY_ORDER_U1;
        const origRank = rarityOrder.indexOf(find.rarity);
        const rerollRank = rarityOrder.indexOf(rerollFind.rarity);
        if (rerollRank > origRank || (rerollRank === origRank && rerollFind.baseCredits > find.baseCredits)) {
          find = rerollFind;
        }
      }
    }

    // ── Pirate event check ──────────────────────────────────────────────────
    const stealth = buffsMap.stealth_module;
    if (!stealth && find.findType !== 'nft_container') {
      const pirateRoll = this._deriveFloat(expedition.server_seed, expedition.client_seed, 'pirate_check');
      if (pirateRoll < config.pirates.chance) {
        await withTransaction(async (client) => {
          await client.query(
            `UPDATE expeditions
             SET pirate_pending_data = $1, status = 'completed', collected_at = NOW()
             WHERE id = $2`,
            [JSON.stringify({ find, buffsMap: {} }), expeditionId]
          );
          await client.query(
            'UPDATE users SET pirate_encounters = pirate_encounters + 1 WHERE id = $1',
            [userId]
          );
        });
        if (this.questService) {
          setImmediate(() => this.questService.trackProgress(userId, 'pirate_encounter', {}).catch(() => {}));
        }
        return this._formatPirateEncounter({ ...expedition, pirate_pending_data: { find } });
      }
    }

    // No pirate — finalize
    try {
      const result = await this._finalizeExpedition(userId, expedition, find, buffsMap, null);
      this._trackMiniTournament(userId);
      return result;
    } catch (err) {
      logger.error({
        err,
        userId,
        expeditionId,
        universe: expUniverse,
        zoneId: expedition.zone_id,
        findType: find?.findType,
        rarity: find?.rarity,
      }, 'Failed to finalize expedition collect');
      throw err;
    }
  }

  /**
  * Handle pirate encounter choice: 'pay' (10 stars), 'fight' (50/50), or 'destroy' (Void Cannon).
   */
  async pirateAction(userId, expeditionId, choice) {
    const expedition = await this._getExpeditionById(expeditionId, userId);
    if (!expedition) throw { status: 404, message: 'Expedition not found' };
    if (!expedition.pirate_pending_data) throw { status: 409, message: 'No pirate encounter pending' };
    if (expedition.status === 'collected') throw { status: 409, message: 'Already collected' };

    const config = this.cfg.config;
    const pirates = config.pirates;
    const pendingData = expedition.pirate_pending_data;
    const find = pendingData.find;

    if (choice === 'pay') {
      await withTransaction(async (client) => {
        const userRes = await client.query(
          'SELECT stars_balance FROM users WHERE id = $1 FOR UPDATE',
          [userId]
        );
        const user = userRes.rows[0];
        if (!user || user.stars_balance < pirates.escapeCostStars) {
          throw { status: 402, message: 'Недостаточно Stars для откупа', required: pirates.escapeCostStars, current: user?.stars_balance || 0 };
        }

        await client.query(
          'UPDATE users SET stars_balance = stars_balance - $1, total_stars_spent = total_stars_spent + $1 WHERE id = $2',
          [pirates.escapeCostStars, userId]
        );
        await client.query(
          `INSERT INTO stars_transactions
             (user_id, type, amount, balance_before, balance_after, description)
           VALUES ($1, 'spend_other', $2, $3, $4, $5)`,
          [userId, -pirates.escapeCostStars, user.stars_balance, user.stars_balance - pirates.escapeCostStars, 'Откуп от пиратов']
        );
        await client.query(
          `UPDATE expeditions SET pirate_pending_data = NULL WHERE id = $1`,
          [expeditionId]
        );
      });

      const buffsMap = this.buffService ? await this.buffService.getActiveBuffsMap(userId) : {};
      const result = await this._finalizeExpedition(userId, expedition, find, buffsMap, null);
      this._trackMiniTournament(userId);
      return { ...result, pirateOutcome: 'paid', starsSpent: pirates.escapeCostStars };

    } else if (choice === 'destroy') {
      const cannonItemKey = 'void_cannon';
      const cannonRes = await withTransaction(async (client) => {
        const itemRes = await client.query(
          `SELECT item_data FROM user_story_items WHERE user_id = $1 AND item_key = $2 FOR UPDATE`,
          [userId, cannonItemKey]
        );
        if (!itemRes.rows.length) {
          throw { status: 403, message: 'Void Cannon required' };
        }

        const itemData = itemRes.rows[0].item_data || {};
        const cooldownHours = Number(itemData.cooldownHours || 24);
        const lastUsedAt = itemData.lastUsedAt ? new Date(itemData.lastUsedAt) : null;
        if (lastUsedAt) {
          const cooldownUntil = new Date(lastUsedAt.getTime() + cooldownHours * 3600 * 1000);
          if (cooldownUntil > new Date()) {
            throw {
              status: 429,
              message: 'Void Cannon is recharging',
              cooldownUntil: cooldownUntil.toISOString(),
            };
          }
        }

        const updatedData = {
          ...itemData,
          cooldownHours,
          lastUsedAt: new Date().toISOString(),
        };

        await client.query(
          `UPDATE user_story_items SET item_data = $1 WHERE user_id = $2 AND item_key = $3`,
          [JSON.stringify(updatedData), userId, cannonItemKey]
        );
        await client.query(
          `UPDATE expeditions SET pirate_pending_data = NULL WHERE id = $1`,
          [expeditionId]
        );
        return updatedData;
      });

      const buffsMap = this.buffService ? await this.buffService.getActiveBuffsMap(userId) : {};
      const result = await this._finalizeExpedition(userId, expedition, find, buffsMap, pirates.winCreditBonusMultiplier);
      this._trackMiniTournament(userId);
      return { ...result, pirateOutcome: 'destroy_win', storyItemUsed: cannonRes };

    } else if (choice === 'fight') {
      const fightRoll = this._deriveFloat(expedition.server_seed, expedition.client_seed, 'pirate_fight');
      const win = fightRoll < pirates.fightWinChance;

      if (win) {
        await withTransaction(async (client) => {
          await client.query(`UPDATE expeditions SET pirate_pending_data = NULL WHERE id = $1`, [expeditionId]);
          await client.query('UPDATE users SET pirate_fight_wins = pirate_fight_wins + 1 WHERE id = $1', [userId]);
        });
        const buffsMap = this.buffService ? await this.buffService.getActiveBuffsMap(userId) : {};
        const result = await this._finalizeExpedition(userId, expedition, find, buffsMap, pirates.winCreditBonusMultiplier);
        this._trackMiniTournament(userId);
        return { ...result, pirateOutcome: 'fight_win' };

      } else {
        const cooldownUntil = new Date(Date.now() + pirates.defeatCooldownMinutes * 60 * 1000);

        await withTransaction(async (client) => {
          await client.query(
            `UPDATE users
             SET expedition_cooldown_until = $1,
                 total_expeditions = total_expeditions + 1,
                 pirate_fight_losses = pirate_fight_losses + 1
             WHERE id = $2`,
            [cooldownUntil, userId]
          );
          await client.query(
            `INSERT INTO expedition_results
               (expedition_id, user_id, find_type, template_id, rarity, object_data,
                base_credits, base_xp, action_taken, action_taken_at, final_credits, final_xp)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pirate_defeat', NOW(), 0, 0)`,
            [expeditionId, userId, find.findType, find.templateId, find.rarity,
             JSON.stringify(find.objectData), find.baseCredits, find.baseXP]
          );
          await client.query(
            `UPDATE expeditions
             SET status = 'collected', collected_at = NOW(), pirate_pending_data = NULL
             WHERE id = $1`,
            [expeditionId]
          );
        });

        logger.info({ userId, expeditionId, cooldownUntil }, 'Pirate defeat — cooldown applied');
        this._trackMiniTournament(userId);
        return { outcome: 'pirate_defeat', pirateOutcome: 'fight_lose', cooldownUntil };
      }
    } else {
      throw { status: 400, message: "choice must be 'pay' or 'fight'" };
    }
  }

  /**
   * UNIFIED action on ANY expedition result: sell, collect (keep in inventory), save_coords.
   * This is the ONLY place where XP is awarded (unified XP system).
   */
  async takeAction(userId, resultId, action) {
    const validActions = ['sell', 'save_coords', 'collect'];
    if (!validActions.includes(action)) {
      throw { status: 400, message: `Invalid action. Use: ${validActions.join(', ')}` };
    }

    const config = this.cfg.config;
    const MAX_RETRIES = 2;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await withTransaction(async (client) => {
          // Lock expedition_results row to prevent concurrent action on the same result
          const result = await client.query(
            'SELECT * FROM expedition_results WHERE id = $1 AND user_id = $2 FOR UPDATE',
            [resultId, userId]
          );
          if (!result.rows.length) throw { status: 404, message: 'Result not found' };

          const expResult = result.rows[0];
          if (expResult.action_taken) {
            throw { status: 409, message: 'Action already taken', action: expResult.action_taken };
          }

          const isNFT = expResult.find_type === 'nft_container';
          const isAsteroid = expResult.find_type === 'asteroid';
          const isStoryItem = expResult.find_type === 'story_item';

          // NFT containers: only save_coords (stores in inventory), never sell
          if (isNFT) {
            if (action !== 'save_coords') {
              throw { status: 400, message: 'NFT-контейнер можно только сохранить' };
            }
          } else if (isStoryItem) {
            if (action !== 'collect') {
              throw { status: 400, message: 'Сюжетный предмет можно только забрать' };
            }
          } else if (action === 'save_coords' && !isAsteroid) {
            throw { status: 400, message: 'save_coords only for asteroids' };
          } else if (action === 'collect' && isAsteroid) {
            throw { status: 400, message: 'Use sell or save_coords for asteroids' };
          }

          // Lock user row to prevent concurrent XP/credits updates (e.g. from achievement awards)
          const userRow = await client.query(
            'SELECT * FROM users WHERE id = $1 FOR UPDATE',
            [userId]
          );
          if (!userRow.rows.length) throw { status: 404, message: 'User not found' };
          const user = userRow.rows[0];

          // Load expedition for event_snapshot
          const expRow = await client.query(
            'SELECT event_snapshot, zone_id, was_sped_up, universe FROM expeditions WHERE id = $1',
            [expResult.expedition_id]
          );
          const expedition = expRow.rows[0] || {};
          const evMults = this._getEventMults(expedition);

          const prestigeSellMult = Number(user.prestige_level || 0) > 0 ? 1.15 : 1.0;
          const prestigeXpMult  = Number(user.prestige_level || 0) > 0 ? 1.1  : 1.0;

          let creditsGained = 0;
          let crystalsGained = 0;
          let xpGained = 0;
          let saleCurrency = 'credits';
          const rarityXpMult = this._getRarityConfig(expResult.rarity)?.xpMultiplier || 1.0;

          if (action === 'sell') {
            const rawSellPrice = this._calculateSellPrice(expResult, config);
            // Cross-universe sell bonus: 1.5× when selling item from the other universe
            const itemUniverse = expedition.universe || 1;
            const userUniverse = user.current_universe || 1;
            const crossBonus = (itemUniverse !== userUniverse)
              ? (config.universe2?.crossUniverseSellBonus || 1.5)
              : 1.0;
            const sellAmount = Math.round(rawSellPrice * evMults.credits * crossBonus * prestigeSellMult);
            if (userUniverse === 2) {
              saleCurrency = 'crystals';
              crystalsGained = sellAmount;
            } else {
              saleCurrency = 'credits';
              creditsGained = sellAmount;
            }
            xpGained = Math.round(expResult.base_xp * rarityXpMult * config.xp.collectXPMultiplier * evMults.xp * prestigeXpMult);

            if (!isAsteroid) {
              // Non-asteroid sell: delete from inventory
              await client.query(
                `UPDATE inventory_items SET status = 'sold', sold_at = NOW(), sold_for = $1
                 WHERE result_id = $2 AND user_id = $3 AND status = 'in_inventory'`,
                [sellAmount, expResult.id, userId]
              );
            }

            if (saleCurrency === 'crystals') {
              await client.query(`UPDATE users SET crystals = crystals + $1 WHERE id = $2`, [crystalsGained, userId]);
              await client.query(
                `INSERT INTO crystal_transactions
                   (user_id, type, amount, balance_before, balance_after, reference_id, description)
                 VALUES ($1, 'sell_item', $2, $3, $4, $5, $6)`,
                [userId, crystalsGained, Number(user.crystals || 0), Number(user.crystals || 0) + crystalsGained, expResult.id, 'Продажа предмета в U2']
              );
            } else {
              await client.query(`UPDATE users SET credits = credits + $1 WHERE id = $2`, [creditsGained, userId]);
              await client.query(
                `INSERT INTO credit_transactions
                   (user_id, type, amount, balance_before, balance_after, reference_id)
                 VALUES ($1, 'sell_item', $2, $3, $4, $5)`,
                [userId, creditsGained, Number(user.credits), Number(user.credits) + creditsGained, expResult.id]
              );
            }
          } else if (action === 'save_coords') {
            xpGained = Math.round(expResult.base_xp * rarityXpMult * config.xp.collectXPMultiplier * evMults.xp * prestigeXpMult);
            await client.query(
              `INSERT INTO inventory_items
                 (user_id, result_id, find_type, template_id, rarity, object_data, status, xp_gained)
               VALUES ($1, $2, $3, $4, $5, $6, 'saved_coords', $7)`,
              [userId, expResult.id, expResult.find_type, expResult.template_id,
               expResult.rarity, expResult.object_data, xpGained]
            );

            // Auto-grant captain nick decoration for ship owners
            if (isNFT) {
              const objData = typeof expResult.object_data === 'string'
                ? JSON.parse(expResult.object_data) : (expResult.object_data || {});
              if (objData.outcomeType === 'unique_ship') {
                await client.query(
                  `INSERT INTO user_name_decorations(user_id, decor_id)
                   VALUES ($1, 'fx_captain')
                   ON CONFLICT DO NOTHING`,
                  [userId]
                );
                // Auto-set zone glow to captain if not already set
                await client.query(
                  `UPDATE users SET zone_glow = COALESCE(zone_glow, 'captain') WHERE id = $1`,
                  [userId]
                );
              }
            }
          } else if (action === 'collect') {
            // Non-asteroid: keep in inventory, award full XP
            xpGained = Math.round(expResult.base_xp * rarityXpMult * config.xp.collectXPMultiplier * evMults.xp * prestigeXpMult);
            // Item is already in inventory from _finalizeExpedition, just award XP

            if (isStoryItem) {
              const itemData = expResult.object_data || {};
              const storyItemKey = itemData.storyItemKey || expResult.template_id || 'signal_from_another_universe';
              await client.query(
                `INSERT INTO user_story_items (user_id, item_key, item_data)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (user_id, item_key) DO NOTHING`,
                [userId, storyItemKey, JSON.stringify({
                  nameRu: itemData.name,
                  nameEn: itemData.nameEn,
                  descRu: itemData.description,
                  descEn: itemData.descriptionEn,
                  icon: itemData.icon,
                  rarity: itemData.rarity,
                })]
              );
            }
          }

          // ── Award XP (unified for ALL actions) ────────────────────────────────
          const newXP = BigInt(user.xp) + BigInt(xpGained);
          const newLevel = this._calculateLevel(Number(newXP), config.xp.levelTable);

          await client.query(
            `UPDATE users SET xp = $1, level = $2, total_sold = total_sold + $3 WHERE id = $4`,
            [newXP, newLevel, action === 'sell' ? 1 : 0, userId]
          );
          await client.query(
            `UPDATE expedition_results
             SET action_taken = $1, action_taken_at = NOW(), final_credits = $2, final_xp = $3
             WHERE id = $4`,
            [action, creditsGained, xpGained, resultId]
          );
          await client.query(
            `UPDATE expeditions SET status = 'collected', collected_at = NOW()
             WHERE id = (SELECT expedition_id FROM expedition_results WHERE id = $1)`,
            [resultId]
          );

          // Record tournament score (non-blocking)
          if (this.tournamentService) {
            const wasSpedUp = expedition.was_sped_up || false;
            const objData = typeof expResult.object_data === 'string'
              ? JSON.parse(expResult.object_data) : (expResult.object_data || {});
            setImmediate(() =>
              this.tournamentService.recordExpeditionResult(userId, {
                xpGained, creditsGained: creditsGained + crystalsGained,
                expeditionCount: 1,
                wasSpedUp,
                findType: expResult.find_type,
                rarity: expResult.rarity,
                weight: objData.weight || objData.mass || 0,
              }).catch((err) => logger.warn({ err, userId }, 'Tournament score (action) failed'))
            );
          }

          // ── Ship NFT bonus: 5% chance for +1 star ──────────────────────────────
          let starBonus = 0;
          if (Math.random() < 0.05) {
            const shipCheck = await client.query(
              `SELECT 1 FROM inventory_items
               WHERE user_id = $1 AND find_type = 'nft_container'
                 AND status IN ('in_inventory','saved_coords')
                 AND object_data->>'outcomeType' = 'unique_ship'
               LIMIT 1`, [userId]);
            if (shipCheck.rows.length > 0) {
              starBonus = 1;
              await client.query(
                'UPDATE users SET stars_balance = stars_balance + 1 WHERE id = $1', [userId]);
              await client.query(
                `INSERT INTO stars_transactions (user_id, type, amount, balance_before, balance_after, description)
                 SELECT $1, 'bonus', 1, stars_balance - 1, stars_balance, 'Бонус капитана (уникальный корабль)'
                 FROM users WHERE id = $1`, [userId]);
            }
          }

          const levelTable = config.xp.levelTable;
          const currentLevelEntry = levelTable.find((l) => l.level === newLevel);
          const nextLevelEntry = levelTable.find((l) => l.level === newLevel + 1);

          logger.info({ userId, resultId, action, xpGained, creditsGained, crystalsGained, saleCurrency, newLevel }, 'Action taken — XP awarded');

          // Track mini-tournament progress after action (non-blocking)
          this._trackMiniTournament(userId);

          return {
            action, outcome: 'success', creditsGained, crystalsGained, saleCurrency, xpGained,
            findType: expResult.find_type,
            rarity: expResult.rarity,
            newXP: Number(newXP), newLevel,
            leveledUp: newLevel > user.level,
            xpForCurrentLevel: currentLevelEntry?.xpRequired || 0,
            xpForNextLevel: nextLevelEntry?.xpRequired || null,
            storyItemUnlocked: isStoryItem && action === 'collect',
            storyItemKey: isStoryItem ? (expResult.template_id || expResult.object_data?.storyItemKey || null) : null,
            starBonus,
          };
        });
      } catch (err) {
        // Retry on transient DB errors (deadlock, serialization failure, connection issues)
        const isTransient = err.code === '40P01' // deadlock_detected
          || err.code === '40001'                 // serialization_failure
          || err.code === '08006'                 // connection_failure
          || err.code === '08001'                 // sqlclient_unable_to_establish_sqlconnection
          || err.code === '57P01'                 // admin_shutdown
          || err.code === 'ECONNRESET'
          || err.code === 'ETIMEDOUT';

        if (isTransient && attempt < MAX_RETRIES) {
          logger.warn({ err, userId, resultId, attempt }, 'Transient DB error in takeAction, retrying');
          await new Promise((r) => setTimeout(r, 100 * (attempt + 1)));
          continue;
        }
        throw err;
      }
    }
  }

  async getActiveExpedition(userId) {
    const row = await this._getActiveExpedition(userId);
    if (!row) return null;
    const isPiratePending = !!row.pirate_pending_data;
    return {
      expeditionId: row.id,
      zoneId: row.zone_id,
      sector: row.sector,
      status: isPiratePending ? 'pirate_pending' : row.status,
      startedAt: row.started_at,
      endsAt: row.ends_at,
      wasSpedUp: row.was_sped_up || false,
      isLongExpedition: row.is_long_expedition || false,
      universe: row.universe || 1,
    };
  }

  async getExpeditionHistory(userId, { limit = 20, offset = 0 } = {}) {
    const result = await query(
      `SELECT e.*, er.find_type, er.rarity, er.object_data, er.base_credits, er.base_xp,
              er.final_credits, er.action_taken
       FROM expeditions e
       LEFT JOIN expedition_results er ON e.id = er.expedition_id
       WHERE e.user_id = $1
       ORDER BY e.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );
    return result.rows;
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /**
   * Auto-claim pending results where user didn't take action.
   * Awards XP as "collect" and marks action_taken.
   */
  async _autoClaimPending(client, userId, config, prestigeLevel = 0) {
    const pendingRes = await client.query(
      `SELECT er.*, e.event_snapshot, e.zone_id FROM expedition_results er
       JOIN expeditions e ON e.id = er.expedition_id
       WHERE er.user_id = $1 AND er.action_taken IS NULL
         AND e.status = 'completed'`,
      [userId]
    );

    for (const row of pendingRes.rows) {
      if (row.find_type === 'story_item') {
        const itemData = row.object_data || {};
        const storyItemKey = itemData.storyItemKey || row.template_id || 'signal_from_another_universe';
        await client.query(
          `INSERT INTO user_story_items (user_id, item_key, item_data)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_id, item_key) DO NOTHING`,
          [userId, storyItemKey, JSON.stringify({
            nameRu: itemData.name,
            nameEn: itemData.nameEn,
            descRu: itemData.description,
            descEn: itemData.descriptionEn,
            icon: itemData.icon,
            rarity: itemData.rarity,
          })]
        );
      }

      const rarityXpMult = this._getRarityConfig(row.rarity)?.xpMultiplier || 1.0;
      const evMults = this._getEventMults(row);
      const prestigeXpMult = Number(prestigeLevel || 0) > 0 ? 1.1 : 1.0;
      const xpGained = Math.round(row.base_xp * rarityXpMult * config.xp.collectXPMultiplier * evMults.xp * prestigeXpMult);

      await client.query(
        `UPDATE expedition_results SET action_taken = 'collect', action_taken_at = NOW(), final_xp = $1
         WHERE id = $2`,
        [xpGained, row.id]
      );
      await client.query(
        `UPDATE expeditions SET status = 'collected', collected_at = NOW() WHERE id = $1`,
        [row.expedition_id]
      );
      await client.query(
        `UPDATE users SET xp = xp + $1 WHERE id = $2`,
        [xpGained, userId]
      );

      // Recalculate level
      const userRes = await client.query('SELECT xp FROM users WHERE id = $1', [userId]);
      const newLevel = this._calculateLevel(Number(userRes.rows[0].xp), config.xp.levelTable);
      await client.query('UPDATE users SET level = $1 WHERE id = $2', [newLevel, userId]);

      logger.info({ userId, resultId: row.id, xpGained }, 'Auto-claimed pending result');

      // Tournament score (non-blocking)
      if (this.tournamentService) {
        const objData = typeof row.object_data === 'string'
          ? JSON.parse(row.object_data) : (row.object_data || {});
        setImmediate(() =>
          this.tournamentService.recordExpeditionResult(userId, {
            xpGained, creditsGained: 0, expeditionCount: 0,
            wasSpedUp: false,
            findType: row.find_type, rarity: row.rarity,
            weight: objData.weight || objData.mass || 0,
          }).catch(() => {})
        );
      }
    }

    // Track mini-tournament progress if any results were auto-claimed (non-blocking)
    if (pendingRes.rows.length > 0) {
      this._trackMiniTournament(userId);
    }
  }

  /**
   * Finalize expedition: generate result, add to inventory, but DO NOT award XP.
   * XP is awarded later when user takes action (sell/collect) via takeAction().
   */
  async _finalizeExpedition(userId, expedition, find, buffsMap, creditBonusMult = null) {
    const config = this.cfg.config;
    const expeditionId = expedition.id;
    const freshExp = await this._getExpeditionById(expeditionId, userId);

    // ── Asteroid / NFT container / story item: save result, wait for action ─
    if (find.findType === 'asteroid' || find.findType === 'nft_container' || find.findType === 'story_item') {
      const txResult = await withTransaction(async (client) => {
        const res = await client.query(
          `INSERT INTO expedition_results
             (expedition_id, user_id, find_type, template_id, rarity, object_data, base_credits, base_xp)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
          [expeditionId, userId, find.findType, find.templateId, find.rarity,
           JSON.stringify(find.objectData), find.baseCredits, find.baseXP]
        );
        await client.query(
          `UPDATE expeditions
           SET status = 'completed', collected_at = NOW(), pirate_pending_data = NULL
           WHERE id = $1`,
          [expeditionId]
        );
        await client.query(
          `UPDATE users SET total_expeditions = total_expeditions + 1, total_finds = total_finds + 1 WHERE id = $1`,
          [userId]
        );
        if (this.buffService) {
          if (buffsMap.cartographer) await this.buffService.consumeUseBuff(userId, 'cartographer');
          if (buffsMap.quantum_locator) await this.buffService.consumeUseBuff(userId, 'quantum_locator');
        }
        logger.info({ userId, expeditionId, findType: find.findType, rarity: find.rarity }, 'Result generated (XP pending action)');
        return { ...this._formatResult(res.rows[0], freshExp), outcome: 'success', inventoryItemId: null };
      });

      // NFT notification AFTER transaction commits so FK references are visible
      if (find.findType === 'nft_container' && this.nftService) {
        const user = await this._getUser(userId);
        const resultForNotif = { ...txResult, expeditionId };
        logger.info({ userId, expeditionId, findType: find.findType }, 'Scheduling NFT admin notification');
        setImmediate(() =>
          this.nftService.handleNftFound(user, resultForNotif).catch((err) =>
            logger.error({ err }, 'NFT notification failed')
          )
        );
      }

      return txResult;
    }

    // ── Non-asteroid: cargo / capsule check → add to inventory, NO XP yet ──
    const cargoModule   = await this._getModule(userId, 'cargo');
    const capsuleModule = await this._getModule(userId, 'capsule');
    const cargoCfg   = config.modules.cargo.levels[cargoModule?.level || 0];
    const capsuleCfg = config.modules.capsule.levels[capsuleModule?.level || 0];
    const cargoMaxVol      = cargoCfg?.maxVolume   || 30;
    const capsuleMaxRarity = capsuleCfg?.capturesUpTo || 0;

    const RARITY_TIER = {
      common: 1,
      rare: 2,
      epic: 3,
      legendary: 4,
      mythical: 5,
      exotic: 6,
      ancient: 7,
      relic: 8,
      hybrid: 9,
      singularity: 10,
    };
    const rarityTier = RARITY_TIER[find.rarity] || 1;
    const rarityXpMult = this._getRarityConfig(find.rarity)?.xpMultiplier || 1.0;

    let outcome       = 'success';
    let creditsGained = 0;
    let addToInventory = true;
    let xpMult = config.xp.collectXPMultiplier;

    if (find.findType === 'creature') {
      if (capsuleMaxRarity < rarityTier) {
        outcome = 'no_capsule';
        addToInventory = false;
        xpMult = 0.1;
      }
    } else {
      const itemVolume = find.objectData?.volume ?? 0;
      if (itemVolume > cargoMaxVol) {
        outcome       = 'cargo_full';
        addToInventory = false;
        xpMult        = 0.1;
        creditsGained = Math.round((8 + Math.floor(Math.random() * 13)) * 1.0);
      }
    }

    if (creditBonusMult !== null && creditsGained > 0) {
      creditsGained = Math.round(creditsGained * (1 + creditBonusMult));
    }

    // Apply event multipliers at the last moment
    const evMults = this._getEventMults(freshExp);
    const xpGained = Math.round(find.baseXP * rarityXpMult * xpMult * evMults.xp);
    if (creditsGained > 0) {
      creditsGained = Math.round(creditsGained * evMults.credits);
    }

    return await withTransaction(async (client) => {
      // For cargo_full / no_capsule: auto-award XP immediately (no action needed).
      // For normal items: action_taken stays NULL → XP awarded on action (takeAction applies prestige there).
      const isAutoComplete = outcome === 'cargo_full' || outcome === 'no_capsule';
      const actionTaken = isAutoComplete ? outcome : null;
      const actionTakenAt = isAutoComplete ? 'NOW()' : null;

      const res = await client.query(
        `INSERT INTO expedition_results
           (expedition_id, user_id, find_type, template_id, rarity, object_data,
            base_credits, base_xp, action_taken, action_taken_at, final_credits, final_xp)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, ${isAutoComplete ? 'NOW()' : 'NULL'}, $10, $11)
         RETURNING *`,
        [expeditionId, userId, find.findType, find.templateId, find.rarity,
         JSON.stringify(find.objectData), find.baseCredits, find.baseXP, actionTaken, creditsGained, xpGained]
      );
      const resultRow = res.rows[0];

      let inventoryItemId = null;
      let geneEnhancerProc = null;
      if (addToInventory) {
        const invRes = await client.query(
          `INSERT INTO inventory_items
             (user_id, result_id, find_type, template_id, rarity, object_data, status, xp_gained)
           VALUES ($1, $2, $3, $4, $5, $6, 'in_inventory', $7)
           RETURNING id`,
          [userId, resultRow.id, find.findType, find.templateId, find.rarity,
           JSON.stringify(find.objectData), xpGained]
        );
        inventoryItemId = invRes.rows[0].id;

        // Gene Enhancer: 20% chance to upgrade creature rarity by 1 tier (capsule level 5+ required)
        if (find.findType === 'creature' && (capsuleModule?.level || 0) >= 5) {
          const hasEnhancer = await client.query(
            `SELECT 1 FROM user_story_items WHERE user_id = $1 AND item_key = 'gene_enhancer' LIMIT 1`,
            [userId]
          );
          if (hasEnhancer.rows.length > 0 && Math.random() < 0.20) {
            const RARITY_UP = { common: 'rare', rare: 'epic', epic: 'legendary', legendary: 'mythical' };
            const upgradedRarity = RARITY_UP[find.rarity]; // undefined for mythical — already max
            if (upgradedRarity) {
              await client.query(`UPDATE inventory_items SET rarity = $1 WHERE id = $2`, [upgradedRarity, inventoryItemId]);
              await client.query(`UPDATE expedition_results SET rarity = $1 WHERE id = $2`, [upgradedRarity, resultRow.id]);
              resultRow.rarity = upgradedRarity;
              geneEnhancerProc = { originalRarity: find.rarity, upgradedRarity };
            }
          }
        }
      }

      if (creditsGained > 0) {
        const user = await this._getUser(userId);
        await client.query(`UPDATE users SET credits = credits + $1 WHERE id = $2`, [creditsGained, userId]);
        await client.query(
          `INSERT INTO credit_transactions
             (user_id, type, amount, balance_before, balance_after, reference_id)
           VALUES ($1, 'sell_item', $2, $3, $4, $5)`,
          [userId, creditsGained, Number(user.credits), Number(user.credits) + creditsGained, resultRow.id]
        );
      }

      // For cargo_full / no_capsule: auto-award XP + mark expedition collected
      if (isAutoComplete) {
        const user = await this._getUser(userId);
        const finalXp = Number(user.prestige_level || 0) > 0
          ? Math.round(xpGained * 1.1)
          : xpGained;
        if (finalXp !== xpGained) {
          await client.query(`UPDATE expedition_results SET final_xp = $1 WHERE id = $2`, [finalXp, resultRow.id]);
        }
        const newXP = BigInt(user.xp) + BigInt(finalXp);
        const newLevel = this._calculateLevel(Number(newXP), config.xp.levelTable);
        await client.query(
          `UPDATE users SET xp = $1, level = $2,
             total_expeditions = total_expeditions + 1,
             total_finds       = total_finds + 1
           WHERE id = $3`,
          [newXP, newLevel, userId]
        );
        await client.query(
          `UPDATE expeditions
           SET status = 'collected', collected_at = NOW(), pirate_pending_data = NULL
           WHERE id = $1`,
          [expeditionId]
        );

        if (this.buffService) {
          if (buffsMap.cartographer) await this.buffService.consumeUseBuff(userId, 'cartographer');
          if (buffsMap.quantum_locator) await this.buffService.consumeUseBuff(userId, 'quantum_locator');
        }

        // Tournament score
        if (this.tournamentService) {
          setImmediate(() =>
            this.tournamentService.recordExpeditionResult(userId, {
              xpGained, creditsGained, expeditionCount: 1,
              wasSpedUp: expedition.was_sped_up || false,
              findType: find.findType, rarity: find.rarity,
              weight: find.objectData?.weight || find.objectData?.mass || 0,
            }).catch((err) => logger.warn({ err, userId }, 'Tournament score (auto) failed'))
          );
        }

        const levelTable = config.xp.levelTable;
        const currentLevelEntry = levelTable.find((l) => l.level === newLevel);
        const nextLevelEntry = levelTable.find((l) => l.level === newLevel + 1);

        logger.info({ userId, expeditionId, findType: find.findType, rarity: find.rarity, outcome }, 'Auto-completed (cargo_full/no_capsule)');

        this._trackMiniTournament(userId);

        return {
          ...this._formatResult(resultRow, freshExp),
          outcome,
          inventoryItemId,
          creditsGained,
          xpGained: finalXp,
          newXP: Number(newXP),
          newLevel,
          leveledUp: newLevel > user.level,
          xpForCurrentLevel: currentLevelEntry?.xpRequired || 0,
          xpForNextLevel: nextLevelEntry?.xpRequired || null,
          geneEnhancerProc,
          ...(outcome === 'cargo_full' ? { itemVolume: find.objectData?.volume ?? 0, cargoMaxVolume: cargoMaxVol } : {}),
        };
      }

      // Normal item: keep expedition as 'completed' (not 'collected') — XP pending action
      await client.query(
        `UPDATE users SET total_expeditions = total_expeditions + 1, total_finds = total_finds + 1
         WHERE id = $1`,
        [userId]
      );
      await client.query(
        `UPDATE expeditions
         SET status = 'completed', collected_at = NOW(), pirate_pending_data = NULL
         WHERE id = $1`,
        [expeditionId]
      );

      if (this.buffService) {
        if (buffsMap.cartographer) await this.buffService.consumeUseBuff(userId, 'cartographer');
        if (buffsMap.quantum_locator) await this.buffService.consumeUseBuff(userId, 'quantum_locator');
      }

      logger.info({ userId, expeditionId, findType: find.findType, rarity: find.rarity, outcome: 'pending_action' }, 'Result generated — XP pending user action');

      return {
        ...this._formatResult(resultRow, freshExp),
        outcome,
        inventoryItemId,
        creditsGained: 0,
        xpGained: 0, // NOT awarded yet — will be awarded on action
        pendingXP: xpGained, // Tell frontend how much XP will be awarded
        geneEnhancerProc,
      };
    });
  }

  /**
   * 5% chance to replace long-expedition result with a one-time story item.
   * The item is granted only when player presses "collect" on the result card.
   */
  async _rollUniverseSignalDrop(userId, expedition, currentFind) {
    const existing = await query(
      `SELECT 1 FROM user_story_items WHERE user_id = $1 AND item_key = 'signal_from_another_universe'`,
      [userId]
    );
    if (existing.rows.length > 0) return null;

    const roll = this._deriveFloat(expedition.server_seed, expedition.client_seed, 'signal_drop');
    if (roll >= 0.05) return null;

    logger.info({ userId, expeditionId: expedition.id }, 'Signal from Another Universe replaced long-expedition reward');

    return {
      findType: 'story_item',
      templateId: 'signal_from_another_universe',
      rarity: 'mythical',
      baseCredits: 0,
      baseXP: Math.max(Number(currentFind?.baseXP || 0), Number(this.cfg.config?.xp?.basePerExpedition || 10)),
      objectData: {
        storyItemKey: 'signal_from_another_universe',
        templateId: 'signal_from_another_universe',
        name: 'Сигнал из другой вселенной',
        nameEn: 'Signal from Another Universe',
        description: 'Странный мифический сигнал, указывающий путь во Вселенную II.',
        descriptionEn: 'A strange mythical signal pointing the way to Universe II.',
        icon: '📡',
        rarity: 'mythical',
        sellable: false,
      },
    };
  }

  /**
   * 5% chance to drop Divine Shard in long expeditions (both U1 and U2).
   * Only drops when the Tech Institute story quest is active and shard not yet obtained.
   */
  async _rollDivineShardDrop(userId, expedition, currentFind, expUniverse) {
    // Skip if player already has the shard or the reward (exhibition_pass)
    const existingRes = await query(
      `SELECT item_key FROM user_story_items
       WHERE user_id = $1 AND item_key IN ('divine_shard', 'exhibition_pass')`,
      [userId]
    );
    if (existingRes.rows.length > 0) return null;

    // Skip if tech story quest is not active for this user
    const questRes = await query(
      `SELECT 1 FROM user_quests
       WHERE user_id = $1 AND template_id = 'tech_story_divine_shard' AND status = 'active'
       LIMIT 1`,
      [userId]
    );
    if (!questRes.rows.length) return null;

    const roll = this._deriveFloat(expedition.server_seed, expedition.client_seed, 'divine_shard_drop');
    if (roll >= 0.05) return null;

    logger.info({ userId, expeditionId: expedition.id, universe: expUniverse }, 'Divine Shard dropped');

    return {
      findType: 'story_item',
      templateId: 'divine_shard',
      rarity: 'mythical',
      baseCredits: 0,
      baseXP: Math.max(Number(currentFind?.baseXP || 0), Number(this.cfg.config?.xp?.basePerExpedition || 10)),
      objectData: {
        storyItemKey: 'divine_shard',
        templateId: 'divine_shard',
        name: 'Божественный осколок',
        nameEn: 'Divine Shard',
        description: 'Осколок неизвестной цивилизации, мерцающий энергией обеих вселенных. Технологический институт заинтересован в нём.',
        descriptionEn: 'A shard of an unknown civilization, shimmering with energy from both universes. The Technology Institute is interested in it.',
        icon: '💎',
        rarity: 'mythical',
        sellable: false,
      },
    };
  }

  // Insurance policy reroll
  async _rerollNoNft(serverSeed, clientSeed, zone, scannerCfg, buffsMap, config, eventEffects = [], universe = 1) {
    try {
      const rerollSeed = serverSeed + '_reroll';
      const rerollBuffs = { ...buffsMap };
      delete rerollBuffs.insurance_policy;
      // Insurance reroll should be independent from one-shot type forcing buffs.
      delete rerollBuffs.cartographer;
      const find = await this.generator.generate(rerollSeed, clientSeed, zone, scannerCfg, rerollBuffs, null, eventEffects, universe);
      if (find.findType === 'nft_container') return null;
      return find;
    } catch {
      return null;
    }
  }

  _formatPirateEncounter(expedition) {
    const pending = expedition.pirate_pending_data;
    const find = pending?.find || {};
    return {
      outcome: 'pirate_encounter',
      expeditionId: expedition.id,
      pirateInfo: {
        findType: find.findType,
        rarity: find.rarity,
        approximateValue: find.baseCredits,
      },
    };
  }

  _deriveFloat(serverSeed, clientSeed, label) {
    const combined = `${serverSeed}:${clientSeed}:${label}`;
    const hash = crypto.createHash('sha256').update(combined).digest('hex');
    return parseInt(hash.slice(0, 8), 16) / 0xFFFFFFFF;
  }

  async _getActiveExpedition(userId) {
    const result = await query(
      `SELECT * FROM expeditions
       WHERE user_id = $1 AND status IN ('in_progress', 'completed')
       ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );
    return result.rows[0] || null;
  }

  async _getExpeditionById(expeditionId, userId) {
    const result = await query(
      'SELECT * FROM expeditions WHERE id = $1 AND user_id = $2',
      [expeditionId, userId]
    );
    return result.rows[0] || null;
  }

  async _getUser(userId) {
    const result = await query('SELECT * FROM users WHERE id = $1', [userId]);
    if (!result.rows.length) throw { status: 404, message: 'User not found' };
    return result.rows[0];
  }

  async _getModule(userId, moduleType) {
    const result = await query(
      'SELECT * FROM ship_modules WHERE user_id = $1 AND module_type = $2',
      [userId, moduleType]
    );
    return result.rows[0] || null;
  }

  _calculateSellPrice(expResult, config) {
    const findType = expResult.find_type;
    if (findType === 'story_item') return 0;
    if (findType === 'asteroid') {
      const obj = expResult.object_data || {};
      if (!obj.scanned) return 125;
      let resource = null;
      for (const resources of Object.values(config.asteroidResources)) {
        resource = resources.find((r) => r.id === obj.resourceType);
        if (resource) break;
      }
      if (resource && obj.estimatedVolume != null && obj.condition != null) {
        const depletionFactor = (obj.condition / 100) * 0.8 + 0.2;
        const miningValue = Math.round(obj.estimatedVolume * resource.pricePerTon * depletionFactor);
        return Math.round(miningValue * 0.2);
      }
      return Math.round(Number(expResult.base_credits) * 0.2);
    }
    const rarityMult = this._getRarityConfig(expResult.rarity)?.priceMultiplier || 1.0;
    return Math.round(Number(expResult.base_credits) * rarityMult);
  }

  _calculateLevel(xp, levelTable) {
    let level = 1;
    for (const entry of levelTable) {
      if (xp >= entry.xpRequired) level = entry.level;
    }
    return level;
  }

  /**
   * Extract XP and credits event multipliers from expedition's event_snapshot.
   */
  _getEventMults(expedition) {
    const effects = Array.isArray(expedition?.event_snapshot) ? expedition.event_snapshot : [];
    const zoneId = expedition?.zone_id;
    return {
      xp: EventService.getMultiplier(effects, 'xp_bonus', zoneId),
      credits: EventService.getMultiplier(effects, 'credits_bonus', zoneId),
    };
  }

  _formatResult(resultRow, expedition, userUniverse = null) {
    const config = this.cfg.config;
    const baseXP = Number(resultRow.base_xp);
    const rarityXpMult = this._getRarityConfig(resultRow.rarity)?.xpMultiplier || 1.0;
    const evMults = this._getEventMults(expedition);
    const displayXP = Math.round(baseXP * rarityXpMult * config.xp.collectXPMultiplier * evMults.xp);
    const rawSellPrice = this._calculateSellPrice(resultRow, config);
    const itemUniverse = expedition.universe || 1;
    const crossBonus = (userUniverse && itemUniverse !== userUniverse)
      ? (config.universe2?.crossUniverseSellBonus || 1.5)
      : 1.0;
    const sellPrice = Math.round(rawSellPrice * evMults.credits * crossBonus);
    return {
      resultId: resultRow.id,
      expeditionId: resultRow.expedition_id,
      findType: resultRow.find_type,
      rarity: resultRow.rarity,
      objectData: resultRow.object_data,
      baseCredits: resultRow.base_credits,
      baseXP: resultRow.base_xp,
      displayXP,
      sellPrice,
      crossUniverseBonus: crossBonus > 1.0,
      itemUniverse,
      actionTaken: resultRow.action_taken,
      serverSeed: expedition.server_seed,
      clientSeed: expedition.client_seed,
    };
  }

  /**
   * Check if user is subscribed to the StarLoot Telegram channel.
   * Uses a 5-minute cache stored in the users table.
   */
  async _checkChannelMembership(client, userId, userRow) {
    const CACHE_TTL_MS = 5 * 60 * 1000;
    const cachedAt = userRow.channel_member_checked_at;
    if (cachedAt && (Date.now() - new Date(cachedAt).getTime()) < CACHE_TTL_MS) {
      return Boolean(userRow.is_channel_member);
    }

    // Cache expired or missing — query Telegram API
    const isMember = await this.bot.checkChannelMembership(userId);
    await client.query(
      `UPDATE users SET is_channel_member=$1, channel_member_checked_at=NOW() WHERE id=$2`,
      [isMember, userId]
    );
    return isMember;
  }
}

module.exports = ExpeditionService;
