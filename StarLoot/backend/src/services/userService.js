'use strict';

const { query, withTransaction } = require('../db/pool');
const FindGeneratorService = require('./findGeneratorService');
const logger = require('../utils/logger');

class UserService {
  constructor(configManager) {
    this.cfg = configManager;
  }

  async _autoCompleteExpiredTravel(userId) {
    const completeRes = await query(
      `UPDATE users
       SET current_universe = CASE WHEN current_universe = 1 THEN 2 ELSE 1 END,
           universe_travel_until = NULL
       WHERE id = $1
         AND universe_travel_until IS NOT NULL
         AND universe_travel_until <= NOW()
       RETURNING current_universe`,
      [userId]
    );

    if (!completeRes.rows.length) return null;

    const newUniverse = Number(completeRes.rows[0].current_universe || 1);
    // Insert visited_universe2 when arriving at U2 (newUniverse=2) OR when returning from U2
    // (newUniverse=1 means user was in U2). Belt-and-suspenders to keep the flag sticky.
    await query(
      `INSERT INTO user_story_items (user_id, item_key, item_data)
       VALUES ($1, 'visited_universe2', '{}'::jsonb)
       ON CONFLICT (user_id, item_key) DO NOTHING`,
      [userId]
    );

    logger.info({ userId, newUniverse }, 'Universe travel auto-completed during user state read');
    return newUniverse;
  }

  _getRarityConfig(rarity, config) {
    return config.universe2?.rarity?.[rarity] || config.rarity?.[rarity] || null;
  }

  _getRarityRank(rarity) {
    const order = {
      common: 1,
      exotic: 2,
      rare: 3,
      ancient: 4,
      epic: 5,
      relic: 6,
      legendary: 7,
      hybrid: 8,
      mythical: 9,
      singularity: 10,
    };
    return order[rarity] || 0;
  }

  async getProfile(userId) {
    await this._autoCompleteExpiredTravel(userId);

    const [userRes, modulesRes, achRes, shipRes, deceleratorRes, universeSignalRes, visitedU2Res, haulerBeaconRes] = await Promise.all([
      query('SELECT * FROM users WHERE id = $1', [userId]),
      query('SELECT module_type, level FROM ship_modules WHERE user_id = $1', [userId]),
      query(
        `SELECT ad.id, ad.name, ad.icon
         FROM users u
         JOIN achievement_definitions ad ON ad.id = u.selected_achievement_id
         WHERE u.id = $1`,
        [userId]
      ),
      query(
        `SELECT 1 FROM inventory_items
         WHERE user_id = $1 AND find_type = 'nft_container'
           AND status IN ('in_inventory','saved_coords')
           AND object_data->>'outcomeType' = 'unique_ship'
         LIMIT 1`, [userId]),
      query(
        `SELECT 1 FROM user_story_items WHERE user_id = $1 AND item_key = 'particle_decelerator' LIMIT 1`,
        [userId]),
      query(
        `SELECT 1 FROM user_story_items WHERE user_id = $1 AND item_key = 'signal_from_another_universe' LIMIT 1`,
        [userId]),
      query(
        `SELECT 1 FROM user_story_items WHERE user_id = $1 AND item_key = 'visited_universe2' LIMIT 1`,
        [userId]),
      query(
        `SELECT 1 FROM user_story_items WHERE user_id = $1 AND item_key = 'hyperlane_beacon' LIMIT 1`,
        [userId]),
    ]);
    if (!userRes.rows.length) throw { status: 404, message: 'User not found' };
    const user = userRes.rows[0];

    const modules = {};
    for (const m of modulesRes.rows) modules[m.module_type] = m.level;

    const config = this.cfg.config;
    const levelTable = config.xp.levelTable;
    const currentLevelEntry = levelTable.find((l) => l.level === user.level);
    const nextLevelEntry = levelTable.find((l) => l.level === user.level + 1);

    const cooldownUntil = user.expedition_cooldown_until &&
      new Date(user.expedition_cooldown_until) > new Date()
        ? user.expedition_cooldown_until
        : null;

    return {
      id: user.id,
      username: user.username,
      firstName: user.first_name,
      credits: Number(user.credits),
      starsBalance: Number(user.stars_balance),
      xp: Number(user.xp),
      level: user.level,
      xpForCurrentLevel: currentLevelEntry?.xpRequired || 0,
      xpForNextLevel: nextLevelEntry?.xpRequired || null,
      totalExpeditions: user.total_expeditions,
      totalFinds: user.total_finds,
      modules,
      expeditionCooldownUntil: cooldownUntil,
      selectedAchievement: achRes.rows[0]
        ? { id: achRes.rows[0].id, name: achRes.rows[0].name, icon: achRes.rows[0].icon || '🏆' }
        : null,
      createdAt: user.created_at,
      lastActiveAt: user.last_active_at,
      headerColor:   user.header_color   || 'blue',
      avatarId:      user.avatar_id      || 'astronaut',
      activeDecorId: user.active_decor_id || null,
      isSupporter:      !!user.is_supporter,
      hasShip:          shipRes.rows.length > 0,
      isChannelMember:  !!user.is_channel_member,
      zoneGlow:      user.zone_glow || null,
      referredBy:    user.referred_by || null,
      pendingReferrerId: (!user.referred_by && user.pending_referrer_id) ? String(user.pending_referrer_id) : null,
      tosAccepted:   !!user.tos_accepted,
      tosAcceptedAt: user.tos_accepted_at || null,
      tosVersion:    user.tos_version || null,
      hasParticleDecelerator: deceleratorRes.rows.length > 0,
      hasUniverse2Access: universeSignalRes.rows.length > 0,
      hasVisitedUniverse2: (user.current_universe || 1) === 2 || visitedU2Res.rows.length > 0,
      hasHaulerTravelReducer: haulerBeaconRes.rows.length > 0,
      totalSpeedups: user.total_speedups || 0,
      currentUniverse: user.current_universe || 1,
      crystals: Number(user.crystals || 0),
      universeTravelUntil: user.universe_travel_until && new Date(user.universe_travel_until) > new Date()
        ? user.universe_travel_until : null,
      prestigeLevel: Number(user.prestige_level || 0),
    };
  }

  async getInventory(userId, { type, sortBy = 'date', sortDir = 'desc', limit = 50, offset = 0 } = {}) {
    await this._autoCompleteExpiredTravel(userId);

    const userRes = await query('SELECT current_universe FROM users WHERE id = $1', [userId]);
    if (!userRes.rows.length) throw { status: 404, message: 'User not found' };
    const currentUniverse = Number(userRes.rows[0].current_universe || 1);

    // Include both collected items and saved asteroid coords
    let sql = `
      SELECT i.id, i.result_id, i.find_type, i.template_id, i.rarity, i.object_data, i.status,
             i.acquired_at, i.sold_for, i.xp_gained, i.viewer_sympathy,
             COALESCE(er.base_credits, 0) AS base_credits,
             COALESCE(e.universe, (i.object_data->>'universe')::int, 1) AS item_universe
      FROM inventory_items i
      LEFT JOIN expedition_results er ON er.id = i.result_id
      LEFT JOIN expeditions e ON e.id = er.expedition_id
      WHERE i.user_id = $1 AND i.status IN ('in_inventory', 'saved_coords', 'on_exhibition')
        AND i.find_type != 'collectible'
    `;
    const params = [userId];

    if (type) {
      params.push(type);
      sql += ` AND i.find_type = $${params.length}`;
    }

    const dir = sortDir === 'asc' ? 'ASC' : 'DESC';
    if (sortBy === 'rarity') {
      sql += ` ORDER BY CASE i.rarity
        WHEN 'common'      THEN 1
        WHEN 'exotic'      THEN 2
        WHEN 'rare'        THEN 3
        WHEN 'ancient'     THEN 4
        WHEN 'epic'        THEN 5
        WHEN 'relic'       THEN 6
        WHEN 'legendary'   THEN 7
        WHEN 'hybrid'      THEN 8
        WHEN 'mythical'    THEN 9
        WHEN 'singularity' THEN 10
        ELSE 0 END ${dir}, i.acquired_at DESC`;
    } else if (sortBy === 'price') {
      sql += ` ORDER BY COALESCE(er.base_credits, 0) ${dir}, i.acquired_at DESC`;
    } else {
      sql += ` ORDER BY i.acquired_at ${dir}`;
    }

    params.push(limit, offset);
    sql += ` LIMIT $${params.length - 1} OFFSET $${params.length}`;

    const result = await query(sql, params);

    const countSql = `
      SELECT COUNT(*) FROM inventory_items
      WHERE user_id = $1 AND status IN ('in_inventory', 'saved_coords', 'on_exhibition')
      ${type ? 'AND find_type = $2' : ''}
    `;
    const countParams = type ? [userId, type] : [userId];
    const countRes = await query(countSql, countParams);

    const config = this.cfg.config;
    const itemsWithPrice = result.rows.map(item => ({
      ...item,
      sell_price: this._calcItemSellPrice(item, config, currentUniverse),
      sell_currency: currentUniverse === 2 ? 'crystals' : 'credits',
    }));

    return {
      items: itemsWithPrice,
      total: parseInt(countRes.rows[0].count),
      limit,
      offset,
    };
  }

  async getAvailableZones(userId) {
    await this._autoCompleteExpiredTravel(userId);

    const userRes = await query('SELECT level, current_universe FROM users WHERE id = $1', [userId]);
    if (!userRes.rows.length) throw { status: 404, message: 'User not found' };
    const userLevel = userRes.rows[0].level;
    const currentUniverse = userRes.rows[0].current_universe || 1;

    const config = this.cfg.config;

    if (currentUniverse === 2 && config.universe2?.zones) {
      return config.universe2.zones.map((z) => ({
        id: z.id,
        name: z.name,
        nameEn: z.nameEn,
        minLevel: z.minLevel,
        universe: 2,
        locked: z.minLevel > userLevel,
        creditMultiplier: z.creditMultiplier,
        xpMultiplier: z.xpMultiplier,
        findTypeModifiers: z.findTypeModifiers || {},
      }));
    }

    return config.zones.map((z) => ({
      id: z.id,
      name: z.name,
      minLevel: z.minLevel,
      universe: 1,
      locked: z.minLevel > userLevel,
      creditMultiplier: z.creditMultiplier,
      xpMultiplier: z.xpMultiplier,
      findTypeModifiers: z.findTypeModifiers || {},
    }));
  }

  async getLeaderboard({ by = 'xp', limit = 50, requestingUserId = null } = {}) {
    // Use $2 to select sort column — avoids any interpolation in SQL
    const byCredits = by === 'credits';
    const topRes = await query(
      `SELECT u.id, u.username, u.first_name, u.xp, u.credits, u.level,
              u.active_decor_id, u.prestige_level,
              ad.id AS ach_id, ad.icon AS ach_icon, ad.name AS ach_name
       FROM users u
       LEFT JOIN achievement_definitions ad ON ad.id = u.selected_achievement_id
       WHERE u.is_banned = false AND u.hidden_from_leaderboards = false
       ORDER BY (CASE WHEN $2 THEN u.credits ELSE u.xp END) DESC
       LIMIT $1`,
      [Math.min(limit, 100), byCredits]
    );
    const valueKey = byCredits ? 'credits' : 'xp';
    const top = topRes.rows.map((u, i) => ({
      rank: i + 1,
      userId: String(u.id),
      name: u.username || u.first_name || `User ${u.id}`,
      value: Number(u[valueKey]),
      level: u.level,
      activeDecorId: u.active_decor_id || null,
      prestigeLevel: Number(u.prestige_level || 0),
      achievement: u.ach_id ? { id: u.ach_id, icon: u.ach_icon || '🏆', name: u.ach_name } : null,
    }));

    let me = null;
    if (requestingUserId) {
      const inTop = top.find((r) => r.userId === String(requestingUserId));
      if (inTop) {
        me = inTop;
      } else {
        const rankRes = await query(
          `SELECT COUNT(*) + 1 AS rank
           FROM users
           WHERE is_banned = false AND hidden_from_leaderboards = false
             AND (CASE WHEN $2 THEN credits ELSE xp END) >
                 (SELECT (CASE WHEN $2 THEN credits ELSE xp END) FROM users WHERE id = $1)`,
          [requestingUserId, byCredits]
        );
        const userRow = await query(
          `SELECT u.id, u.username, u.first_name, u.xp, u.credits, u.level,
                  u.active_decor_id, u.prestige_level,
                  ad.id AS ach_id, ad.icon AS ach_icon, ad.name AS ach_name
           FROM users u
           LEFT JOIN achievement_definitions ad ON ad.id = u.selected_achievement_id
           WHERE u.id = $1`,
          [requestingUserId]
        );
        if (userRow.rows.length) {
          const u = userRow.rows[0];
          me = {
            rank: Number(rankRes.rows[0].rank),
            userId: String(u.id),
            name: u.username || u.first_name || `User ${u.id}`,
            value: Number(u[valueKey]),
            level: u.level,
            activeDecorId: u.active_decor_id || null,
            prestigeLevel: Number(u.prestige_level || 0),
            achievement: u.ach_id ? { id: u.ach_id, icon: u.ach_icon || '🏆', name: u.ach_name } : null,
          };
        }
      }
    }

    return { top, me };
  }

  // Total distinct named templates (excludes asteroid, nft_container which are not in named pools)
  static get TOTAL_UNIQUE_TEMPLATES() {
    return FindGeneratorService.TOTAL_UNIQUE_TEMPLATES;
  }

  async getUserAchievements(userId) {
    const res = await query(
      `SELECT ad.id, ad.name, ad.description, ad.icon, ad.reward_credits, ad.reward_xp,
              ad.conditions, ad.is_hidden, ua.progress, ua.completed, ua.completed_at
       FROM achievement_definitions ad
       LEFT JOIN user_achievements ua ON ua.achievement_id = ad.id AND ua.user_id = $1
       ORDER BY ua.completed DESC NULLS LAST, ad.id`,
      [userId]
    );
    return res.rows.map((r) => {
      const cond = r.conditions || {};
      const target =
        cond.type === 'expedition_count' ? cond.count :
        cond.type === 'find_count'       ? cond.count :
        cond.type === 'rarity_find'      ? cond.count :
        cond.type === 'credits_total'    ? cond.amount :
        cond.type === 'level'            ? cond.level  :
        cond.type === 'unique_templates' ? cond.count  :
        cond.type === 'prestige'         ? cond.level  : null;
      const isHidden = !!r.is_hidden;
      const completed = r.completed ?? false;
      // Hidden achievements reveal name/description only when completed
      return {
        id:           r.id,
        name:         isHidden && !completed ? '???' : r.name,
        description:  isHidden && !completed ? '???' : r.description,
        icon:         isHidden && !completed ? '🔒' : (r.icon || '🏆'),
        rewardCredits: r.reward_credits,
        rewardXp:     r.reward_xp,
        progress:     r.progress ?? 0,
        target,
        completed,
        completedAt:  r.completed_at,
        isHidden,
      };
    });
  }

  async setSelectedAchievement(userId, achievementId) {
    if (achievementId !== null) {
      // Verify the user actually has this achievement completed
      const check = await query(
        `SELECT 1 FROM user_achievements WHERE user_id = $1 AND achievement_id = $2 AND completed = true`,
        [userId, achievementId]
      );
      if (!check.rows.length) throw { status: 403, message: 'Achievement not completed' };
    }
    await query(
      'UPDATE users SET selected_achievement_id = $1 WHERE id = $2',
      [achievementId, userId]
    );
  }

  async getUserStats(userId) {
    const uid = userId;

    const [
      userRow,
      byType,
      byRarity,
      u2ByType,
      u2ByRarity,
      mostExpensive,
      creditsEarned,
      inventoryValue,
      nftCount,
      uniqueTemplates,
      expeditionsToday,
      recordCreature,
      recordDebris,
      recordAsteroid,
      recordArtifact,
      inventoryCount,
    ] = await Promise.all([
      // Basic counts from users table (coalesce pirate cols — may be 0 on old rows)
      query(
        `SELECT total_expeditions, total_finds, total_sold,
                COALESCE(pirate_encounters,   0) AS pirate_encounters,
                COALESCE(pirate_fight_wins,   0) AS pirate_fight_wins,
                COALESCE(pirate_fight_losses, 0) AS pirate_fight_losses,
                current_universe, crystals
         FROM users WHERE id = $1`,
        [uid]
      ),

      // Finds by type (U1)
      query(`SELECT find_type, COUNT(*)::int AS cnt FROM expedition_results 
             WHERE user_id = $1 AND find_type NOT IN ('echo', 'relic', 'entity', 'rift')
             GROUP BY find_type`, [uid]),

      // Finds by rarity (U1 - exclude pirate_defeat)
      query(
        `SELECT rarity, COUNT(*)::int AS cnt FROM expedition_results
         WHERE user_id = $1 AND rarity NOT IN ('exotic', 'ancient', 'relic', 'hybrid', 'singularity')
           AND (action_taken IS NULL OR action_taken != 'pirate_defeat')
         GROUP BY rarity`,
        [uid]
      ),

      // Finds by type (U2 - only U2 find types from zones with u2_ prefix)
      query(
        `SELECT er.find_type, COUNT(*)::int AS cnt FROM expedition_results er
         JOIN expeditions e ON e.id = er.expedition_id
         WHERE er.user_id = $1 AND e.zone_id LIKE 'u2_%'
         GROUP BY er.find_type`,
        [uid]
      ),

      // Finds by rarity (U2 - exclude pirate_defeat)
      query(
        `SELECT er.rarity, COUNT(*)::int AS cnt FROM expedition_results er
         JOIN expeditions e ON e.id = er.expedition_id
         WHERE er.user_id = $1 AND e.zone_id LIKE 'u2_%'
           AND (er.action_taken IS NULL OR er.action_taken != 'pirate_defeat')
         GROUP BY er.rarity`,
        [uid]
      ),

      // Most expensive single find - compute actual sell price using rarity multiplier
      query(
        `SELECT er.id, er.find_type, er.rarity, er.template_id, er.object_data,
                ROUND(COALESCE(er.base_credits, 0) * CASE er.rarity
                  WHEN 'common'    THEN 1.0
                  WHEN 'rare'      THEN 2.0
                  WHEN 'epic'      THEN 4.0
                  WHEN 'legendary' THEN 8.0
                  WHEN 'mythical'  THEN 20.0
                  ELSE 1.0 END) AS value
         FROM expedition_results er
         WHERE er.user_id = $1
           AND er.find_type NOT IN ('nft_container', 'asteroid')
           AND (er.action_taken IS NULL OR er.action_taken != 'pirate_defeat')
         ORDER BY value DESC LIMIT 1`,
        [uid]
      ),

      // Total credits earned
      query(`SELECT COALESCE(SUM(amount), 0)::bigint AS total FROM credit_transactions WHERE user_id = $1 AND amount > 0`, [uid]),

      // Current inventory estimated value
      query(
        `SELECT COALESCE(SUM(COALESCE(er.base_credits, 0)), 0)::bigint AS total
         FROM inventory_items ii
         LEFT JOIN expedition_results er ON er.id = ii.result_id
         WHERE ii.user_id = $1 AND ii.status IN ('in_inventory', 'saved_coords')`,
        [uid]
      ),

      // NFT containers found
      query(`SELECT COUNT(*)::int AS cnt FROM expedition_results WHERE user_id = $1 AND find_type = 'nft_container'`, [uid]),

      // Unique named template IDs found
      query(
        `SELECT COUNT(DISTINCT template_id)::int AS cnt
         FROM expedition_results
         WHERE user_id = $1 AND template_id IS NOT NULL AND find_type NOT IN ('asteroid', 'nft_container')`,
        [uid]
      ),

      // Expeditions today (MSK = UTC+3)
      query(
        `SELECT COUNT(*)::int AS cnt FROM expeditions
         WHERE user_id = $1 AND status = 'collected'
           AND started_at >= (date_trunc('day', NOW() AT TIME ZONE 'Europe/Moscow') AT TIME ZONE 'Europe/Moscow')`,
        [uid]
      ),

      // Record: heaviest creature — use numeric cast guarded by text check
      query(
        `SELECT (object_data->>'mass')::numeric AS val, object_data->>'name' AS name, rarity
         FROM expedition_results
         WHERE user_id = $1 AND find_type = 'creature'
           AND object_data->>'mass' ~ '^[0-9]+(\.[0-9]+)?$'
         ORDER BY val DESC LIMIT 1`,
        [uid]
      ),

      // Record: heaviest debris
      query(
        `SELECT (object_data->>'mass')::numeric AS val, object_data->>'name' AS name, rarity
         FROM expedition_results
         WHERE user_id = $1 AND find_type = 'debris'
           AND object_data->>'mass' ~ '^[0-9]+(\.[0-9]+)?$'
         ORDER BY val DESC LIMIT 1`,
        [uid]
      ),

      // Record: largest asteroid (volume)
      query(
        `SELECT (object_data->>'estimatedVolume')::numeric AS val, object_data->>'name' AS name, rarity
         FROM expedition_results
         WHERE user_id = $1 AND find_type = 'asteroid'
           AND object_data->>'estimatedVolume' ~ '^[0-9]+(\.[0-9]+)?$'
         ORDER BY val DESC LIMIT 1`,
        [uid]
      ),

      // Record: rarest artifact
      query(
        `SELECT rarity, object_data->>'name' AS name,
                CASE rarity WHEN 'mythical' THEN 5 WHEN 'legendary' THEN 4 WHEN 'epic' THEN 3 WHEN 'rare' THEN 2 ELSE 1 END AS rank
         FROM expedition_results
         WHERE user_id = $1 AND find_type = 'artifact'
           AND (action_taken IS NULL OR action_taken != 'pirate_defeat')
         ORDER BY rank DESC, id LIMIT 1`,
        [uid]
      ),

      // Current inventory item count (includes saved asteroid coords)
      query(`SELECT COUNT(*)::int AS cnt FROM inventory_items WHERE user_id = $1 AND status IN ('in_inventory', 'saved_coords')`, [uid]),
    ]);

    const u = userRow.rows[0] || {};

    const byTypeMap  = Object.fromEntries(byType.rows.map((r) => [r.find_type, r.cnt]));
    const byRarityMap = Object.fromEntries(byRarity.rows.map((r) => [r.rarity, r.cnt]));
    
    // U2 statistics
    const u2ByTypeMap  = Object.fromEntries(u2ByType.rows.map((r) => [r.find_type, r.cnt]));
    const u2ByRarityMap = Object.fromEntries(u2ByRarity.rows.map((r) => [r.rarity, r.cnt]));
    const hasVisitedU2 = (u.current_universe || 1) === 2 || (u2ByType.rows.length > 0 || u2ByRarity.rows.length > 0);

    const uniqueFound = uniqueTemplates.rows[0]?.cnt ?? 0;
    const collectionPct = Math.round((uniqueFound / UserService.TOTAL_UNIQUE_TEMPLATES) * 100);

    const best = mostExpensive.rows[0] || null;

    const stats = {
      // General
      totalExpeditions:   Number(u.total_expeditions || 0),
      expeditionsToday:   expeditionsToday.rows[0]?.cnt ?? 0,
      totalFinds:         Number(u.total_finds || 0),
      totalSold:          Number(u.total_sold || 0),
      currentUniverse:    u.current_universe || 1,
      hasVisitedUniverse2: hasVisitedU2,
      // By type (U1)
      findsByType: {
        debris:        byTypeMap.debris        || 0,
        artifact:      byTypeMap.artifact      || 0,
        creature:      byTypeMap.creature      || 0,
        anomaly:       byTypeMap.anomaly       || 0,
        asteroid:      byTypeMap.asteroid      || 0,
        nft_container: byTypeMap.nft_container || 0,
      },
      // By rarity (U1)
      findsByRarity: {
        common:    byRarityMap.common    || 0,
        rare:      byRarityMap.rare      || 0,
        epic:      byRarityMap.epic      || 0,
        legendary: byRarityMap.legendary || 0,
        mythical:  byRarityMap.mythical  || 0,
      },
      ...(hasVisitedU2 && {
        // By type (U2)
        u2_findsByType: {
          echo:       u2ByTypeMap.echo       || 0,
          relic:      u2ByTypeMap.relic      || 0,
          entity:     u2ByTypeMap.entity     || 0,
          rift:       u2ByTypeMap.rift       || 0,
          asteroid:   u2ByTypeMap.asteroid   || 0,
        },
        // By rarity (U2)
        u2_findsByRarity: {
          exotic:      u2ByRarityMap.exotic      || 0,
          ancient:     u2ByRarityMap.ancient     || 0,
          relic:       u2ByRarityMap.relic       || 0,
          hybrid:      u2ByRarityMap.hybrid      || 0,
          singularity: u2ByRarityMap.singularity || 0,
        },
      }),
      // Economy
      totalCreditsEarned: Number(creditsEarned.rows[0]?.total || 0),
      inventoryValue:     Number(inventoryValue.rows[0]?.total || 0),
      // Best find
      mostExpensiveFind: best ? {
        id:         best.id,
        findType:   best.find_type,
        rarity:     best.rarity,
        templateId: best.template_id,
        name:       best.object_data?.name || '?',
        value:      best.value,
      } : null,
      // Pirates
      pirateEncounters:   Number(u.pirate_encounters   || 0),
      pirateFightWins:    Number(u.pirate_fight_wins   || 0),
      pirateFightLosses:  Number(u.pirate_fight_losses || 0),
      // Collection
      inventoryCount:       inventoryCount.rows[0]?.cnt ?? 0,
      uniqueTemplatesFound: uniqueFound,
      totalUniqueTemplates: UserService.TOTAL_UNIQUE_TEMPLATES,
      collectionCompletionPct: collectionPct,
      // Records
      records: {
        heaviestCreature: recordCreature.rows[0]  || null,
        heaviestDebris:   recordDebris.rows[0]    || null,
        largestAsteroid:  recordAsteroid.rows[0]  || null,
        rarestArtifact:   recordArtifact.rows[0]  || null,
      },
    };

    return stats;
  }

  async remoteScanAsteroid(userId, itemId) {
    // 1. Check user has remote_scanner buff
    const buffRes = await query(
      `SELECT uses_remaining FROM user_active_buffs
       WHERE user_id = $1 AND buff_type = 'remote_scanner' AND uses_remaining > 0`,
      [userId]
    );
    if (!buffRes.rows.length) {
      throw { status: 402, message: 'Нет удалённых сканеров' };
    }

    // 2. Fetch inventory item
    const itemRes = await query(
      `SELECT ii.*, COALESCE(er.base_credits, 0) AS er_base_credits
       FROM inventory_items ii
       LEFT JOIN expedition_results er ON er.id = ii.result_id
       WHERE ii.id = $1 AND ii.user_id = $2 AND ii.status IN ('in_inventory', 'saved_coords')`,
      [itemId, userId]
    );
    if (!itemRes.rows.length) throw { status: 404, message: 'Предмет не найден' };
    const item = itemRes.rows[0];
    if (item.find_type !== 'asteroid') throw { status: 400, message: 'Не астероид' };

    const od = item.object_data;
    if (od.scanned) throw { status: 409, message: 'Уже отсканирован' };

    const actualRarity    = od.actualRarity;
    const realBaseCredits = od.realBaseCredits;
    if (!actualRarity || realBaseCredits == null) {
      throw { status: 400, message: 'Данные астероида неполные (старый предмет, сканирование недоступно)' };
    }

    return await withTransaction(async (client) => {
      // 3. Update inventory item: reveal data, restore real rarity
      const newOd = { ...od, scanned: true };
      await client.query(
        `UPDATE inventory_items SET rarity = $1::rarity_enum, object_data = $2 WHERE id = $3`,
        [actualRarity, JSON.stringify(newOd), itemId]
      );

      // 4. Update expedition result: restore real rarity + price
      if (item.result_id) {
        await client.query(
          `UPDATE expedition_results SET rarity = $1::rarity_enum, base_credits = $2 WHERE id = $3`,
          [actualRarity, realBaseCredits, item.result_id]
        );
      }

      // 5. Consume one remote_scanner use
      await client.query(
        `UPDATE user_active_buffs SET uses_remaining = uses_remaining - 1
         WHERE user_id = $1 AND buff_type = 'remote_scanner'`,
        [userId]
      );
      await client.query(
        `DELETE FROM user_active_buffs
         WHERE user_id = $1 AND buff_type = 'remote_scanner' AND uses_remaining <= 0`,
        [userId]
      );

      // 6. Return updated item + remaining scanners
      const updatedItem = await client.query(
        `SELECT ii.id, ii.find_type, ii.template_id, ii.rarity, ii.object_data, ii.status,
                ii.acquired_at, ii.sold_for, ii.xp_gained,
                COALESCE(er.base_credits, 0) AS base_credits
         FROM inventory_items ii
         LEFT JOIN expedition_results er ON er.id = ii.result_id
         WHERE ii.id = $1`,
        [itemId]
      );
      const remaining = await client.query(
        `SELECT COALESCE(uses_remaining, 0) AS cnt FROM user_active_buffs
         WHERE user_id = $1 AND buff_type = 'remote_scanner'`,
        [userId]
      );

      return {
        item:              updatedItem.rows[0],
        scannersRemaining: remaining.rows[0]?.cnt ?? 0,
      };
    });
  }

  async sellInventoryItem(userId, itemId) {
    const config = this.cfg.config;

    return await withTransaction(async (client) => {
      // Fetch item inside transaction with FOR UPDATE to prevent double-sell
      const itemRes = await client.query(
        `SELECT i.*, er.base_credits
                , COALESCE(e.universe, (i.object_data->>'universe')::int, 1) AS item_universe
         FROM inventory_items i
         LEFT JOIN expedition_results er ON er.id = i.result_id
         LEFT JOIN expeditions e ON e.id = er.expedition_id
         WHERE i.id = $1 AND i.user_id = $2 AND i.status IN ('in_inventory', 'saved_coords')
         FOR UPDATE OF i`,
        [itemId, userId]
      );
      if (!itemRes.rows.length) throw { status: 404, message: 'Item not found or already sold' };
      const item = itemRes.rows[0];

      // NFT containers cannot be sold
      if (item.find_type === 'nft_container') {
        throw { status: 403, message: 'NFT-контейнер нельзя продать' };
      }

      const baseCredits = Number(item.base_credits || item.object_data?.sellPrice || 0);
      let sellPrice;

      if (item.find_type === 'asteroid') {
        // Asteroids: sell coordinates for 20% of mining value (rarity already in resource price)
        const od = item.object_data || {};
        if (!item.result_id && od.sellPrice != null) {
          sellPrice = Math.round(Number(od.sellPrice) || 0);
        } else if (!od.scanned) {
          sellPrice = 125;
        } else {
          sellPrice = Math.round(baseCredits * 0.2);
        }
      } else {
        // Other items: base price × rarity multiplier
        const rarityMultiplier = this._getRarityConfig(item.rarity, config)?.priceMultiplier || 1;
        sellPrice = Math.round(baseCredits * rarityMultiplier);
      }

      const itemUniverse = Number(item.item_universe || 1);

      const userRes = await client.query(
        'SELECT credits, crystals, current_universe, prestige_level FROM users WHERE id = $1 FOR UPDATE',
        [userId]
      );
      const user = userRes.rows[0];
      const currentCredits = Number(user.credits || 0);
      const currentCrystals = Number(user.crystals || 0);
      const userUniverse = Number(user.current_universe || 1);

      const crossBonus = itemUniverse !== userUniverse
        ? (config.universe2?.crossUniverseSellBonus || 1.5)
        : 1.0;
      sellPrice = Math.round(sellPrice * crossBonus);

      if (Number(user.prestige_level || 0) > 0) {
        sellPrice = Math.round(sellPrice * 1.15);
      }

      const saleCurrency = userUniverse === 2 ? 'crystals' : 'credits';

      if (saleCurrency === 'crystals') {
        await client.query(
          'UPDATE users SET crystals = crystals + $1 WHERE id = $2',
          [sellPrice, userId]
        );
        await client.query(
          `INSERT INTO crystal_transactions
             (user_id, type, amount, balance_before, balance_after, reference_id, description)
           VALUES ($1, 'sell_item', $2, $3, $4, $5, $6)`,
          [userId, sellPrice, currentCrystals, currentCrystals + sellPrice, itemId, 'Продажа предмета из инвентаря']
        );
      } else {
        await client.query(
          'UPDATE users SET credits = credits + $1 WHERE id = $2',
          [sellPrice, userId]
        );
        await client.query(
          `INSERT INTO credit_transactions
             (user_id, type, amount, balance_before, balance_after, reference_id)
           VALUES ($1, 'sell_item', $2, $3, $4, $5)`,
          [userId, sellPrice, currentCredits, currentCredits + sellPrice, itemId]
        );
      }

      // Mark item as sold
      await client.query(
        `UPDATE inventory_items
         SET status = 'sold', sold_at = NOW(), sold_for = $1
         WHERE id = $2`,
        [sellPrice, itemId]
      );

      logger.info({ userId, itemId, sellPrice, rarity: item.rarity, saleCurrency }, 'Inventory item sold');

      return {
        sellPrice,
        saleCurrency,
        creditsGained: saleCurrency === 'credits' ? sellPrice : 0,
        crystalsGained: saleCurrency === 'crystals' ? sellPrice : 0,
        creditsRemaining: saleCurrency === 'credits' ? (currentCredits + sellPrice) : currentCredits,
        crystalsRemaining: saleCurrency === 'crystals' ? (currentCrystals + sellPrice) : currentCrystals,
        findType: item.find_type,
        rarity: item.rarity,
      };
    });
  }

  async bulkSellItems(userId, itemIds) {
    const config = this.cfg.config;
    if (!Array.isArray(itemIds) || itemIds.length === 0) {
      throw { status: 400, message: 'itemIds must be a non-empty array' };
    }
    if (itemIds.length > 50) {
      throw { status: 400, message: 'Maximum 50 items per bulk sell' };
    }

    return await withTransaction(async (client) => {
      // Fetch all sellable items
      const itemsRes = await client.query(
        `SELECT i.id, i.result_id, i.find_type, i.rarity, i.object_data,
                COALESCE(er.base_credits, 0) AS base_credits,
                COALESCE(e.universe, (i.object_data->>'universe')::int, 1) AS item_universe
         FROM inventory_items i
         LEFT JOIN expedition_results er ON er.id = i.result_id
         LEFT JOIN expeditions e ON e.id = er.expedition_id
         WHERE i.id = ANY($1) AND i.user_id = $2 AND i.status IN ('in_inventory', 'saved_coords')
         FOR UPDATE OF i`,
        [itemIds, userId]
      );

      // Filter out NFT containers — they cannot be sold
      const sellableItems = itemsRes.rows.filter(i => i.find_type !== 'nft_container');

      if (!sellableItems.length) {
        throw { status: 404, message: 'No sellable items found' };
      }

      let totalPrice = 0;
      const soldItems = [];

      for (const item of sellableItems) {
        const baseCredits = Number(item.base_credits || item.object_data?.sellPrice || 0);
        let sellPrice;

        if (item.find_type === 'asteroid') {
          const od = item.object_data || {};
          if (!item.result_id && od.sellPrice != null) {
            sellPrice = Math.round(Number(od.sellPrice) || 0);
          } else if (!od.scanned) {
            sellPrice = 125;
          } else {
            sellPrice = Math.round(baseCredits * 0.2);
          }
        } else {
          const rarityMultiplier = this._getRarityConfig(item.rarity, config)?.priceMultiplier || 1;
          sellPrice = Math.round(baseCredits * rarityMultiplier);
        }

        const itemUniverse = Number(item.item_universe || 1);

        // Apply cross-universe sell bonus based on current user universe (loaded below)
        soldItems.push({ id: item.id, sellPrice, itemUniverse });
      }

      // Get user balances and current universe
      const userRes = await client.query(
        'SELECT credits, crystals, current_universe, prestige_level FROM users WHERE id = $1 FOR UPDATE',
        [userId]
      );
      const user = userRes.rows[0];
      const currentCredits = Number(user.credits || 0);
      const currentCrystals = Number(user.crystals || 0);
      const userUniverse = Number(user.current_universe || 1);
      const prestigeSellMult = Number(user.prestige_level || 0) > 0 ? 1.15 : 1.0;

      for (const item of soldItems) {
        const crossBonus = item.item_universe !== userUniverse
          ? (config.universe2?.crossUniverseSellBonus || 1.5)
          : 1.0;
        item.sellPrice = Math.round(item.sellPrice * crossBonus * prestigeSellMult);
        totalPrice += item.sellPrice;
      }

      const saleCurrency = userUniverse === 2 ? 'crystals' : 'credits';

      if (saleCurrency === 'crystals') {
        await client.query(
          'UPDATE users SET crystals = crystals + $1 WHERE id = $2',
          [totalPrice, userId]
        );
        await client.query(
          `INSERT INTO crystal_transactions
             (user_id, type, amount, balance_before, balance_after, description)
           VALUES ($1, 'sell_item', $2, $3, $4, $5)`,
          [userId, totalPrice, currentCrystals, currentCrystals + totalPrice, `Оптовая продажа (${soldItems.length})`]
        );
      } else {
        await client.query(
          'UPDATE users SET credits = credits + $1 WHERE id = $2',
          [totalPrice, userId]
        );
        await client.query(
          `INSERT INTO credit_transactions
             (user_id, type, amount, balance_before, balance_after, metadata)
           VALUES ($1, 'sell_item', $2, $3, $4, $5)`,
          [userId, totalPrice, currentCredits, currentCredits + totalPrice,
           JSON.stringify({ bulkSell: true, count: soldItems.length })]
        );
      }

      // Mark all items as sold
      const soldIds = soldItems.map(s => s.id);
      await client.query(
        `UPDATE inventory_items
         SET status = 'sold', sold_at = NOW()
         WHERE id = ANY($1)`,
        [soldIds]
      );

      logger.info({ userId, count: soldItems.length, totalPrice, saleCurrency }, 'Bulk items sold');

      return {
        soldCount: soldItems.length,
        totalPrice,
        saleCurrency,
        totalCredits: saleCurrency === 'credits' ? totalPrice : 0,
        totalCrystals: saleCurrency === 'crystals' ? totalPrice : 0,
        creditsRemaining: saleCurrency === 'credits' ? (currentCredits + totalPrice) : currentCredits,
        crystalsRemaining: saleCurrency === 'crystals' ? (currentCrystals + totalPrice) : currentCrystals,
      };
    });
  }

  _calcItemSellPrice(item, config, userUniverse = 1) {
    const itemUniverse = Number(item.item_universe || 1);
    const crossBonus = itemUniverse !== userUniverse
      ? (config.universe2?.crossUniverseSellBonus || 1.5)
      : 1.0;

    if (item.find_type === 'asteroid') {
      const od = item.object_data || {};
      if (!item.result_id && od.sellPrice != null) {
        return Math.round((Number(od.sellPrice) || 0) * crossBonus);
      }
      if (!od.scanned) return Math.round(125 * crossBonus);
      let resource = null;
      for (const resources of Object.values(config.asteroidResources)) {
        resource = resources.find((r) => r.id === od.resourceType);
        if (resource) break;
      }
      if (resource && od.estimatedVolume != null && od.condition != null) {
        const depletionFactor = (od.condition / 100) * 0.8 + 0.2;
        const miningValue = Math.round(od.estimatedVolume * resource.pricePerTon * depletionFactor);
        return Math.round(miningValue * 0.2 * crossBonus);
      }
      return Math.round(Number(item.base_credits || item.object_data?.sellPrice || 0) * 0.2 * crossBonus);
    }
    const rarityMult = this._getRarityConfig(item.rarity, config)?.priceMultiplier || 1.0;
    return Math.round(Number(item.base_credits || item.object_data?.sellPrice || 0) * rarityMult * crossBonus);
  }
}

// ─────────────────────────────────────────────────────────────────────────────

class UpgradeService {
  constructor(configManager) {
    this.cfg = configManager;
  }

  async upgradeModule(userId, moduleType) {
    const config = this.cfg.config;
    const moduleDef = config.modules[moduleType];
    if (!moduleDef) throw { status: 400, message: 'Unknown module type' };

    return await withTransaction(async (client) => {
      // Lock the user row
      const userRes = await client.query(
        'SELECT * FROM users WHERE id = $1 FOR UPDATE',
        [userId]
      );
      if (!userRes.rows.length) throw { status: 404, message: 'User not found' };
      const user = userRes.rows[0];

      // Get current module level
      const moduleRes = await client.query(
        'SELECT * FROM ship_modules WHERE user_id = $1 AND module_type = $2 FOR UPDATE',
        [userId, moduleType]
      );
      const currentLevel = moduleRes.rows[0]?.level || 0;

      if (currentLevel >= moduleDef.maxLevel) {
        throw { status: 409, message: 'Module already at max level' };
      }

      const nextLevel = currentLevel + 1;
      const levelCfg = moduleDef.levels[nextLevel];
      const costCrystals = levelCfg.costCrystals || 0;
      const costCredits = levelCfg.upgradeCost || 0;
      const useCrystals = costCrystals > 0;

      if (useCrystals) {
        // Levels 6-10: cost in crystals (U2 currency)
        if (Number(user.crystals || 0) < costCrystals) {
          throw { status: 402, message: 'Insufficient crystals', required: costCrystals, current: Number(user.crystals || 0) };
        }
        // Must be in Universe 2 to upgrade with crystals
        if ((user.current_universe || 1) !== 2) {
          throw { status: 403, message: 'Crystal upgrades only available in Universe 2' };
        }
        await client.query(
          'UPDATE users SET crystals = crystals - $1 WHERE id = $2',
          [costCrystals, userId]
        );
        await client.query(
          `INSERT INTO crystal_transactions
             (user_id, type, amount, balance_before, balance_after)
           VALUES ($1, 'upgrade_module', $2, $3, $4)`,
          [userId, -costCrystals, Number(user.crystals || 0), Number(user.crystals || 0) - costCrystals]
        );
      } else {
        // Levels 1-5: cost in credits
        if (Number(user.credits) < costCredits) {
          throw { status: 402, message: 'Insufficient credits', required: costCredits, current: Number(user.credits) };
        }
        // Must be in Universe 1 to upgrade with credits
        if ((user.current_universe || 1) !== 1) {
          throw { status: 403, message: 'Credit upgrades only available in Universe 1' };
        }
        await client.query(
          'UPDATE users SET credits = credits - $1 WHERE id = $2',
          [costCredits, userId]
        );
        await client.query(
          `INSERT INTO credit_transactions
             (user_id, type, amount, balance_before, balance_after)
           VALUES ($1, 'upgrade_module', $2, $3, $4)`,
          [userId, -costCredits, Number(user.credits), Number(user.credits) - costCredits]
        );
      }

      // Upgrade module
      await client.query(
        `UPDATE ship_modules SET level = $1, upgraded_at = NOW() WHERE user_id = $2 AND module_type = $3`,
        [nextLevel, userId, moduleType]
      );

      const cost = useCrystals ? costCrystals : costCredits;
      logger.info({ userId, moduleType, fromLevel: currentLevel, toLevel: nextLevel, cost, useCrystals }, 'Module upgraded');

      return {
        moduleType,
        previousLevel: currentLevel,
        newLevel: nextLevel,
        costPaid: cost,
        costType: useCrystals ? 'crystals' : 'credits',
        newStats: levelCfg,
        creditsRemaining: useCrystals ? Number(user.credits) : Number(user.credits) - costCredits,
        crystalsRemaining: useCrystals ? Number(user.crystals || 0) - costCrystals : Number(user.crystals || 0),
      };
    });
  }

  async getUpgradeInfo(userId) {
    const config = this.cfg.config;

    const modulesRes = await query(
      'SELECT module_type, level FROM ship_modules WHERE user_id = $1',
      [userId]
    );
    const moduleLevels = {};
    for (const m of modulesRes.rows) moduleLevels[m.module_type] = m.level;

    const userRes = await query('SELECT credits, crystals FROM users WHERE id = $1', [userId]);
    const credits = Number(userRes.rows[0]?.credits || 0);
    const crystals = Number(userRes.rows[0]?.crystals || 0);

    const result = {};
    for (const [type, def] of Object.entries(config.modules)) {
      // Engine is hidden from the upgrade UI
      if (def.hidden) continue;

      const currentLevel = moduleLevels[type] || 0;
      const nextLevel = currentLevel + 1;
      const isMaxed = currentLevel >= def.maxLevel;
      const nextCfg = isMaxed ? null : def.levels[nextLevel];
      const costCrystals = nextCfg?.costCrystals || null;
      const upgradeCost = costCrystals ? null : (nextCfg?.upgradeCost || null);

      result[type] = {
        label: def.label,
        currentLevel,
        maxLevel: def.maxLevel,
        isMaxed,
        currentStats: def.levels[currentLevel],
        nextStats: nextCfg,
        upgradeCost,
        costCrystals,
        usesCrystals: Boolean(costCrystals),
        canAfford: nextCfg
          ? (costCrystals ? crystals >= costCrystals : credits >= (nextCfg.upgradeCost || 0))
          : false,
      };
    }

    return result;
  }
}

module.exports = { UserService, UpgradeService };
