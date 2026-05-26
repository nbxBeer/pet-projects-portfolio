'use strict';

const crypto = require('crypto');
const { query, withTransaction } = require('../db/pool');
const FindGeneratorService = require('./findGeneratorService');
const logger = require('../utils/logger');

// Simplified item name+price templates for blitz cards (server-side only)
const BLITZ_TEMPLATES = {
  debris: {
    common:    [{ name: 'Обломок обшивки', minPrice: 15, maxPrice: 45 }, { name: 'Сломанный манипулятор', minPrice: 12, maxPrice: 38 }],
    rare:      [{ name: 'Навигационный модуль', minPrice: 28, maxPrice: 52 }, { name: 'Грузовой контейнер', minPrice: 26, maxPrice: 50 }],
    epic:      [{ name: 'Военный дрон', minPrice: 58, maxPrice: 92 }, { name: 'Криокамера', minPrice: 55, maxPrice: 88 }],
    legendary: [{ name: 'ИИ-ядро (повреждённое)', minPrice: 110, maxPrice: 190 }],
    mythical:  [{ name: 'Сингулярный генератор', minPrice: 310, maxPrice: 490 }],
  },
  artifact: {
    common:    [{ name: 'Реликвия старой колонии', minPrice: 18, maxPrice: 48 }, { name: 'Сломанный механоид', minPrice: 20, maxPrice: 50 }],
    rare:      [{ name: 'Торговый знак Кейрон', minPrice: 30, maxPrice: 56 }, { name: 'Оружие Империи Валтар', minPrice: 32, maxPrice: 60 }],
    epic:      [{ name: 'Артефакт Древних Строителей', minPrice: 62, maxPrice: 100 }, { name: 'Биотехнология Оро', minPrice: 60, maxPrice: 96 }],
    legendary: [{ name: 'Реликвия Предтеч', minPrice: 125, maxPrice: 205 }],
    mythical:  [{ name: 'Объект класса X', minPrice: 330, maxPrice: 530 }],
  },
  creature: {
    common:    [{ name: 'Космический планктон', minPrice: 10, maxPrice: 30 }, { name: 'Вакуумная медуза', minPrice: 14, maxPrice: 36 }],
    rare:      [{ name: 'Звёздный краб', minPrice: 22, maxPrice: 46 }, { name: 'Кристаллический рой', minPrice: 20, maxPrice: 44 }],
    epic:      [{ name: 'Теневой хищник', minPrice: 55, maxPrice: 90 }, { name: 'Плазменный дракон', minPrice: 50, maxPrice: 85 }],
    legendary: [{ name: 'Ледяной левиафан (взрослый)', minPrice: 115, maxPrice: 185 }],
    mythical:  [{ name: 'Живая звезда (фрагмент)', minPrice: 300, maxPrice: 490 }],
  },
  anomaly: {
    common:    [{ name: 'Гравитационная линза', minPrice: 18, maxPrice: 42 }, { name: 'Магнитный шторм (образец)', minPrice: 16, maxPrice: 38 }],
    rare:      [{ name: 'Временной пузырь', minPrice: 28, maxPrice: 54 }, { name: 'Антигравитационный карман', minPrice: 26, maxPrice: 50 }],
    epic:      [{ name: 'Складка пространства', minPrice: 65, maxPrice: 100 }, { name: 'Хроно-кристалл', minPrice: 62, maxPrice: 96 }],
    legendary: [{ name: 'Мини-чёрная дыра', minPrice: 125, maxPrice: 205 }],
    mythical:  [{ name: 'Сингулярность сознания', minPrice: 340, maxPrice: 520 }],
  },
  asteroid: {
    common:    [{ name: 'Железный астероид', minPrice: 8, maxPrice: 25 }],
    rare:      [{ name: 'Титановый астероид', minPrice: 20, maxPrice: 45 }],
    epic:      [{ name: 'Иридиевый астероид', minPrice: 55, maxPrice: 85 }],
    legendary: [{ name: 'Платиновый астероид', minPrice: 110, maxPrice: 180 }],
    mythical:  [{ name: 'Астероид из антиматерии', minPrice: 300, maxPrice: 450 }],
  },
  // U2 find types
  echo: {
    exotic:      [{ name: 'Эхо-обломки', minPrice: 20, maxPrice: 52 }],
    ancient:     [{ name: 'Эхо-фрагмент', minPrice: 34, maxPrice: 80 }],
    relic:       [{ name: 'Древние эхо-записи', minPrice: 62, maxPrice: 120 }],
    hybrid:      [{ name: 'Гибридный эхо-сигнал', minPrice: 140, maxPrice: 240 }],
    singularity: [{ name: 'Резонанс сингулярности', minPrice: 400, maxPrice: 640 }],
  },
  relic: {
    exotic:      [{ name: 'Экзотическая реликвия', minPrice: 24, maxPrice: 58 }],
    ancient:     [{ name: 'Реликвия Древних', minPrice: 38, maxPrice: 86 }],
    relic:       [{ name: 'Хроно-реликт', minPrice: 70, maxPrice: 136 }],
    hybrid:      [{ name: 'Гибридный артефакт', minPrice: 158, maxPrice: 270 }],
    singularity: [{ name: 'Реликвия Сингулярности', minPrice: 420, maxPrice: 680 }],
  },
  entity: {
    exotic:      [{ name: 'Экзотическая сущность', minPrice: 22, maxPrice: 54 }],
    ancient:     [{ name: 'Древняя сущность', minPrice: 36, maxPrice: 80 }],
    relic:       [{ name: 'Реликтовый хранитель', minPrice: 64, maxPrice: 126 }],
    hybrid:      [{ name: 'Гибридный организм', minPrice: 148, maxPrice: 258 }],
    singularity: [{ name: 'Сингулярный разум', minPrice: 380, maxPrice: 600 }],
  },
  rift: {
    exotic:      [{ name: 'Экзотический разлом', minPrice: 26, maxPrice: 62 }],
    ancient:     [{ name: 'Разлом времени', minPrice: 40, maxPrice: 92 }],
    relic:       [{ name: 'Темпоральный разлом', minPrice: 74, maxPrice: 146 }],
    hybrid:      [{ name: 'Гибридный разлом', minPrice: 168, maxPrice: 290 }],
    singularity: [{ name: 'Разлом Сингулярности', minPrice: 440, maxPrice: 710 }],
  },
};

class BlitzExpeditionService {
  constructor(configManager, buffService) {
    this.cfg = configManager;
    this.buffService = buffService;
    this.generator = new FindGeneratorService(configManager);
  }

  // Returns explosion probability for next swipe-right
  // swipeCount = number of cards already in the accumulated pile
  // wasProtected = stabilizer was active last swipe
  _calcExplosionChance(swipeCount, hasStabilizer, stabilizerSwipesUsed) {
    const blitz = this.cfg.config.blitz || {};
    const base      = blitz.baseExplosionChance ?? 0.04;
    const increment = blitz.explosionIncrement  ?? 0.065;
    const power     = blitz.explosionPower      ?? 1.15;
    const maxChance = blitz.maxExplosionChance  ?? 0.88;
    const stabSwipes = blitz.stabilizerSwipes   ?? 5;

    if (hasStabilizer && stabilizerSwipesUsed < stabSwipes) return 0;
    const effective = hasStabilizer ? (swipeCount - stabSwipes) : swipeCount;
    const n = Math.max(0, effective);
    return Math.min(base + Math.pow(n, power) * increment, maxChance);
  }

  _weightedSelect(entries, rng) {
    const total = entries.reduce((sum, [, v]) => sum + (v.weight ?? v), 0);
    let target = rng * total;
    for (const [key, v] of entries) {
      target -= (v.weight ?? v);
      if (target <= 0) return key;
    }
    return entries[entries.length - 1][0];
  }

  // Pure server-side card generation — no client influence possible
  _generateBlitzCard(zoneId, universe = 1) {
    const config = this.cfg.config;
    const blitz = config.blitz || {};
    const rewardMult = blitz.rewardMultiplier ?? 0.4;
    const xpMult     = blitz.xpMultiplier    ?? 0.5;

    const zones = universe === 2 ? (config.universe2?.zones || []) : config.zones;
    const zone = zones.find((z) => z.id === zoneId) || zones[0];

    const rarityConfig   = universe === 2 ? config.universe2.rarity  : config.rarity;
    const findTypesConfig = universe === 2 ? config.universe2.findTypes : config.findTypes;

    const rarityEntries   = Object.entries(rarityConfig);
    const findTypeEntries = Object.entries(findTypesConfig);

    const rarityWeighted = rarityEntries.map(([k, v]) => [k, { weight: v.weight * (zone?.rarityMultiplier || 1) }]);
    const rarity    = this._weightedSelect(rarityWeighted, Math.random());
    const rarityData = rarityConfig[rarity];

    const ftWeighted = findTypeEntries.map(([k, v]) => [k, { weight: v.weight * (zone?.findTypeModifiers?.[k] || 1) }]);
    const findType  = this._weightedSelect(ftWeighted, Math.random());

    const pool = BLITZ_TEMPLATES[findType]?.[rarity]
      || BLITZ_TEMPLATES[findType]?.['common']
      || BLITZ_TEMPLATES.debris.common;
    const template = pool[Math.floor(Math.random() * pool.length)];

    const rawPrice = template.minPrice + Math.random() * (template.maxPrice - template.minPrice);
    const creditsValue = Math.max(1, Math.floor(
      rawPrice
      * (zone?.creditMultiplier || 1)
      * (rarityData?.priceMultiplier || 1)
      * rewardMult
    ));

    const baseXpForType = config.economy?.baseXP?.[findType] || 10;
    const xpValue = Math.max(1, Math.floor(
      baseXpForType
      * (zone?.xpMultiplier || 1)
      * (rarityData?.xpMultiplier || 1)
      * xpMult
    ));

    const currency = universe === 2 ? 'crystals' : 'credits';
    return { findType, rarity, name: template.name, creditsValue, xpValue, rarityLabel: rarityData?.label || rarity, universe, currency };
  }

  // ── Public API ────────────────────────────────────────────────────────────

  async _getScannerCfg(userId, db = { query }) {
    const scannerRes = await db.query(
      'SELECT * FROM ship_modules WHERE user_id = $1 AND module_type = $2',
      [userId, 'scanner']
    );
    const scannerModule = scannerRes.rows[0] || null;
    return this.cfg.config.modules.scanner.levels[scannerModule?.level || 0];
  }

  _calculateBlitzSellPreview(find, rarityData, rewardMult) {
    if (find.findType === 'asteroid') {
      if (!find.objectData?.scanned) return Math.max(1, Math.floor(125 * rewardMult));
      return Math.max(1, Math.floor(Number(find.baseCredits || 0) * 0.2 * rewardMult));
    }
    return Math.max(1, Math.floor(
      Number(find.baseCredits || 0)
      * Number(rarityData?.priceMultiplier || 1)
      * rewardMult
    ));
  }

  _formatBlitzCard(find, rarityData, rewardMult, xpMult, universe) {
    const currency = universe === 2 ? 'crystals' : 'credits';
    const creditsValue = this._calculateBlitzSellPreview(find, rarityData, rewardMult);
    const xpValue = Math.max(1, Math.floor(Number(find.baseXP || 0) * Number(rarityData?.xpMultiplier || 1) * xpMult));
    return {
      findType: find.findType,
      rarity: find.rarity,
      templateId: find.templateId,
      name: find.objectData?.name || find.templateId || find.findType,
      creditsValue,
      xpValue,
      rarityLabel: rarityData?.label || find.rarity,
      universe,
      currency,
      objectData: find.objectData,
      baseCredits: find.baseCredits,
      baseXP: find.baseXP,
    };
  }

  async _generateBlitzCard(zoneId, universe = 1, userId = null, db = { query }) {
    const config = this.cfg.config;
    const blitz = config.blitz || {};
    const rewardMult = blitz.rewardMultiplier ?? 0.4;
    const xpMult = blitz.xpMultiplier ?? 0.5;

    const zones = universe === 2 ? (config.universe2?.zones || []) : config.zones;
    const zone = zones.find((z) => z.id === zoneId) || zones[0];
    const rarityConfig = universe === 2 ? config.universe2.rarity : config.rarity;
    const scannerCfg = userId ? await this._getScannerCfg(userId, db) : config.modules.scanner.levels[0];

    let find = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      const serverSeed = this.generator.generateServerSeed();
      const clientSeed = `blitz_${crypto.randomBytes(12).toString('hex')}`;
      find = await this.generator.generate(serverSeed, clientSeed, zone, scannerCfg, {}, null, [], universe);
      if (find.findType !== 'nft_container') break;
    }

    const rarityData = rarityConfig[find.rarity];
    return this._formatBlitzCard(find, rarityData, rewardMult, xpMult, universe);
  }

  async getStatus(userId) {
    const sessionRes = await query(
      `SELECT * FROM blitz_sessions WHERE user_id = $1 AND status = 'active' ORDER BY created_at DESC LIMIT 1`,
      [userId]
    );

    if (sessionRes.rows.length > 0) {
      const session = sessionRes.rows[0];
      const blitz = this.cfg.config.blitz || {};
      const stabSwipes = blitz.stabilizerSwipes ?? 5;
      const wasProtected = session.has_stabilizer && session.stabilizer_swipes_used < stabSwipes;
      const explosionChance = wasProtected ? 0
        : this._calcExplosionChance(session.swipe_count, session.has_stabilizer, session.stabilizer_swipes_used);

      return {
        hasActiveSession: true,
        sessionId: session.id,
        card: session.next_card_data,
        swipeCount: session.swipe_count,
        explosionChance,
        accumulatedCount: (session.accumulated_items || []).length,
        accumulatedCredits: (session.accumulated_items || []).reduce((s, c) => s + (c.creditsValue || 0), 0),
        stabilizerActive: session.has_stabilizer,
        stabilizerSwipesRemaining: session.has_stabilizer ? Math.max(0, stabSwipes - session.stabilizer_swipes_used) : 0,
      };
    }

    const cdRes = await query(
      `SELECT cooldown_until FROM blitz_sessions WHERE user_id = $1 AND status IN ('cashed_out', 'detonated') ORDER BY ended_at DESC LIMIT 1`,
      [userId]
    );
    const cooldownUntil = cdRes.rows[0]?.cooldown_until || null;
    const onCooldown = cooldownUntil && new Date(cooldownUntil) > new Date();

    return { hasActiveSession: false, cooldownUntil: onCooldown ? cooldownUntil : null };
  }

  async startSession(userId, { zoneId }) {
    const config = this.cfg.config;
    const blitz  = config.blitz || {};

    // Enforce cooldown
    const cdRes = await query(
      `SELECT cooldown_until FROM blitz_sessions WHERE user_id = $1 AND status IN ('cashed_out', 'detonated') ORDER BY ended_at DESC LIMIT 1`,
      [userId]
    );
    if (cdRes.rows.length > 0 && cdRes.rows[0].cooldown_until) {
      const cooldownUntil = new Date(cdRes.rows[0].cooldown_until);
      if (cooldownUntil > new Date()) {
        throw { status: 429, message: 'Блиц-рейд на перезарядке', cooldownUntil: cooldownUntil.toISOString() };
      }
    }

    // Idempotent — return existing session if active
    const activeRes = await query(
      `SELECT id FROM blitz_sessions WHERE user_id = $1 AND status = 'active'`,
      [userId]
    );
    if (activeRes.rows.length > 0) return this.getStatus(userId);

    // Resolve zone
    let zone = config.zones.find((z) => z.id === zoneId);
    let universe = 1;
    if (!zone && config.universe2?.zones) {
      zone = config.universe2.zones.find((z) => z.id === zoneId);
      if (zone) universe = 2;
    }
    if (!zone) { zone = config.zones[0]; zoneId = zone.id; universe = 1; }

    // Check stabilizer buff
    const buffsMap = await this.buffService.getActiveBuffsMap(userId);
    const hasStabilizer = !!buffsMap['blitz_stabilizer'];

    const firstCard = await this._generateBlitzCard(zoneId, universe, userId);
    const stabSwipes = blitz.stabilizerSwipes ?? 5;

    const insRes = await query(
      `INSERT INTO blitz_sessions (user_id, zone_id, status, accumulated_items, swipe_count, next_card_data, has_stabilizer, stabilizer_swipes_used)
       VALUES ($1, $2, 'active', '[]', 0, $3, $4, 0)
       RETURNING id`,
      [userId, zoneId, JSON.stringify(firstCard), hasStabilizer]
    );

    return {
      hasActiveSession: true,
      sessionId: insRes.rows[0].id,
      card: firstCard,
      swipeCount: 0,
      explosionChance: hasStabilizer ? 0 : this._calcExplosionChance(0, false, 0),
      accumulatedCount: 0,
      accumulatedCredits: 0,
      stabilizerActive: hasStabilizer,
      stabilizerSwipesRemaining: hasStabilizer ? stabSwipes : 0,
    };
  }

  async continueSession(userId, { sessionId }) {
    return await withTransaction(async (client) => {
      const sessionRes = await client.query(
        `SELECT * FROM blitz_sessions WHERE id = $1 AND user_id = $2 AND status = 'active' FOR UPDATE`,
        [sessionId, userId]
      );
      if (!sessionRes.rows.length) throw { status: 404, message: 'Сессия блиц-рейда не найдена или уже завершена' };

      const session = sessionRes.rows[0];
      const blitz   = this.cfg.config.blitz || {};
      const stabSwipes = blitz.stabilizerSwipes ?? 5;

      // Server-side explosion — client cannot influence this
      const wasProtected = session.has_stabilizer && session.stabilizer_swipes_used < stabSwipes;
      const explosionChance = wasProtected ? 0
        : this._calcExplosionChance(session.swipe_count, session.has_stabilizer, session.stabilizer_swipes_used);
      const detonated = Math.random() < explosionChance;

      if (detonated) {
        const cooldownHours = blitz.cooldownHours ?? 6;
        let effectiveCooldownMs = cooldownHours * 3600 * 1000;

        const reducerRes = await client.query(
          `SELECT id FROM user_active_buffs WHERE user_id = $1 AND buff_type = 'blitz_cooldown_reducer' AND (uses_remaining IS NULL OR uses_remaining > 0) LIMIT 1`,
          [userId]
        );
        if (reducerRes.rows.length > 0) {
          effectiveCooldownMs = Math.floor(effectiveCooldownMs * (blitz.cooldownReducerFactor ?? 0.75));
          await client.query(
            `DELETE FROM user_active_buffs WHERE user_id = $1 AND buff_type = 'blitz_cooldown_reducer'`,
            [userId]
          );
        }

        const cooldownUntil = new Date(Date.now() + effectiveCooldownMs);
        const lostItems  = session.accumulated_items || [];
        const lostCredits = lostItems.reduce((s, c) => s + (c.creditsValue || 0), 0);

        await client.query(
          `UPDATE blitz_sessions SET status = 'detonated', ended_at = NOW(), cooldown_until = $1 WHERE id = $2`,
          [cooldownUntil, sessionId]
        );
        logger.info({ userId, sessionId, lostItems: lostItems.length, lostCredits }, 'Blitz detonated');

        return { survived: false, detonated: true, lostItems, lostCount: lostItems.length, lostCredits, cooldownUntil: cooldownUntil.toISOString() };
      }

      // Survived — accept current card, advance state
      const currentCard = session.next_card_data;
      const accumulated = [...(session.accumulated_items || []), currentCard];
      const newSwipeCount = session.swipe_count + 1;
      const newStabUsed = wasProtected ? session.stabilizer_swipes_used + 1 : session.stabilizer_swipes_used;

      const isU2Zone = this.cfg.config.universe2?.zones?.some((z) => z.id === session.zone_id);
      const nextCard = await this._generateBlitzCard(session.zone_id, isU2Zone ? 2 : 1, userId, client);

      await client.query(
        `UPDATE blitz_sessions SET accumulated_items = $1, swipe_count = $2, next_card_data = $3, stabilizer_swipes_used = $4 WHERE id = $5`,
        [JSON.stringify(accumulated), newSwipeCount, JSON.stringify(nextCard), newStabUsed, sessionId]
      );

      const nextWasProtected = session.has_stabilizer && newStabUsed < stabSwipes;
      const nextExplosionChance = nextWasProtected ? 0
        : this._calcExplosionChance(newSwipeCount, session.has_stabilizer, newStabUsed);

      return {
        survived: true,
        acceptedCard: currentCard,
        nextCard,
        swipeCount: newSwipeCount,
        explosionChance: nextExplosionChance,
        accumulatedCount: accumulated.length,
        accumulatedCredits: accumulated.reduce((s, c) => s + (c.creditsValue || 0), 0),
        stabilizerActive: session.has_stabilizer,
        stabilizerSwipesRemaining: session.has_stabilizer ? Math.max(0, stabSwipes - newStabUsed) : 0,
      };
    });
  }

  async skipCooldown(userId) {
    return await withTransaction(async (client) => {
      const userRes = await client.query(
        `SELECT stars_balance FROM users WHERE id = $1 FOR UPDATE`,
        [userId]
      );
      if (!userRes.rows.length) throw { status: 404, message: 'Пользователь не найден' };
      const balance = Number(userRes.rows[0].stars_balance ?? 0);
      if (balance < 15) throw { status: 400, message: `Недостаточно Stars. Нужно 15, есть ${balance}` };

      const cdRes = await client.query(
        `SELECT id FROM blitz_sessions WHERE user_id = $1 AND status IN ('cashed_out', 'detonated') AND cooldown_until > NOW() ORDER BY ended_at DESC LIMIT 1`,
        [userId]
      );
      if (!cdRes.rows.length) throw { status: 400, message: 'Активного кулдауна нет' };

      await client.query(
        `UPDATE users SET stars_balance = stars_balance - 15, total_stars_spent = total_stars_spent + 15 WHERE id = $1`,
        [userId]
      );
      await client.query(
        `UPDATE blitz_sessions SET cooldown_until = NULL WHERE id = $1`,
        [cdRes.rows[0].id]
      );

      logger.info({ userId }, 'Blitz cooldown skipped for 15 stars');
      return { cooldownSkipped: true, starsSpent: 15, newStarsBalance: balance - 15 };
    });
  }

  async cashoutSession(userId, { sessionId }) {
    return await withTransaction(async (client) => {
      const sessionRes = await client.query(
        `SELECT * FROM blitz_sessions WHERE id = $1 AND user_id = $2 AND status = 'active' FOR UPDATE`,
        [sessionId, userId]
      );
      if (!sessionRes.rows.length) throw { status: 404, message: 'Сессия блиц-рейда не найдена или уже завершена' };

      const session = sessionRes.rows[0];
      const blitz   = this.cfg.config.blitz || {};

      // Current card is included in cashout
      const currentCard = session.next_card_data;
      const allItems    = [...(session.accumulated_items || []), currentCard];
      const totalCredits = allItems.filter((c) => (c.currency || 'credits') === 'credits').reduce((s, c) => s + (c.creditsValue || 0), 0);
      const totalCrystals = allItems.filter((c) => c.currency === 'crystals').reduce((s, c) => s + (c.creditsValue || 0), 0);
      const totalXP      = allItems.reduce((s, c) => s + (c.xpValue    || 0), 0);

      // Award XP immediately. Currency is awarded only after explicit sell.
      const userRes = await client.query(
        `UPDATE users SET xp = xp + $1, updated_at = NOW() WHERE id = $2 RETURNING credits, crystals, xp, level`,
        [totalXP, userId]
      );

      // Cooldown with optional reducer
      const cooldownHours = blitz.cooldownHours ?? 6;
      let effectiveCooldownMs = cooldownHours * 3600 * 1000;
      const reducerRes = await client.query(
        `SELECT id FROM user_active_buffs WHERE user_id = $1 AND buff_type = 'blitz_cooldown_reducer' AND (uses_remaining IS NULL OR uses_remaining > 0) LIMIT 1`,
        [userId]
      );
      if (reducerRes.rows.length > 0) {
        effectiveCooldownMs = Math.floor(effectiveCooldownMs * (blitz.cooldownReducerFactor ?? 0.75));
        await client.query(
          `DELETE FROM user_active_buffs WHERE user_id = $1 AND buff_type = 'blitz_cooldown_reducer'`,
          [userId]
        );
      }
      const cooldownUntil = new Date(Date.now() + effectiveCooldownMs);

      await client.query(
        `UPDATE blitz_sessions SET status = 'cashed_out', ended_at = NOW(), accumulated_items = $1, cooldown_until = $2 WHERE id = $3`,
        [JSON.stringify(allItems), cooldownUntil, sessionId]
      );

      // Consume one session use of stabilizer buff
      if (session.has_stabilizer) {
        await client.query(
          `UPDATE user_active_buffs SET uses_remaining = uses_remaining - 1 WHERE user_id = $1 AND buff_type = 'blitz_stabilizer' AND uses_remaining > 0`,
          [userId]
        );
        await client.query(
          `DELETE FROM user_active_buffs WHERE user_id = $1 AND buff_type = 'blitz_stabilizer' AND uses_remaining <= 0`,
          [userId]
        );
      }

      logger.info({ userId, sessionId, itemCount: allItems.length, totalCredits, totalXP }, 'Blitz cashed out');

      return {
        collected: true,
        pendingSale: true,
        sessionId,
        items: allItems,
        itemCount: allItems.length,
        totalCredits,
        totalCrystals,
        totalXP,
        newCredits: Number(userRes.rows[0]?.credits),
        newCrystals: Number(userRes.rows[0]?.crystals || 0),
        newXP: Number(userRes.rows[0]?.xp),
        cooldownUntil: cooldownUntil.toISOString(),
      };
    });
  }

  async sellCashout(userId, { sessionId }) {
    return await withTransaction(async (client) => {
      const sessionRes = await client.query(
        `SELECT * FROM blitz_sessions
         WHERE id = $1 AND user_id = $2 AND status = 'cashed_out' AND payout_claimed = false
         FOR UPDATE`,
        [sessionId, userId]
      );
      if (!sessionRes.rows.length) throw { status: 404, message: 'No pending blitz payout' };

      const items = sessionRes.rows[0].accumulated_items || [];
      const totalCredits = items.filter((c) => (c.currency || 'credits') === 'credits').reduce((s, c) => s + (c.creditsValue || 0), 0);
      const totalCrystals = items.filter((c) => c.currency === 'crystals').reduce((s, c) => s + (c.creditsValue || 0), 0);

      const userRes = await client.query(
        `UPDATE users
         SET credits = credits + $1, crystals = crystals + $2, updated_at = NOW()
         WHERE id = $3
         RETURNING credits, crystals`,
        [totalCredits, totalCrystals, userId]
      );
      await client.query('UPDATE blitz_sessions SET payout_claimed = true WHERE id = $1', [sessionId]);

      return {
        sold: true,
        totalCredits,
        totalCrystals,
        newCredits: Number(userRes.rows[0]?.credits || 0),
        newCrystals: Number(userRes.rows[0]?.crystals || 0),
      };
    });
  }

  async keepCashout(userId, { sessionId }) {
    return await withTransaction(async (client) => {
      const sessionRes = await client.query(
        `SELECT * FROM blitz_sessions
         WHERE id = $1 AND user_id = $2 AND status = 'cashed_out' AND payout_claimed = false
         FOR UPDATE`,
        [sessionId, userId]
      );
      if (!sessionRes.rows.length) throw { status: 404, message: 'No pending blitz payout' };

      const items = sessionRes.rows[0].accumulated_items || [];
      for (const item of items) {
        const rarityConfig = item.universe === 2
          ? this.cfg.config.universe2?.rarity?.[item.rarity]
          : this.cfg.config.rarity?.[item.rarity];
        const rarityMultiplier = Number(rarityConfig?.priceMultiplier || 1);
        const baseSellPrice = Math.max(0, Math.round(Number(item.creditsValue || 0) / rarityMultiplier));
        const objectData = {
          ...(item.objectData || {}),
          name: item.objectData?.name || item.name,
          nameEn: item.objectData?.nameEn || item.objectData?.name || item.name,
          sellPrice: baseSellPrice,
          currency: item.currency || 'credits',
          universe: item.universe || 1,
        };
        await client.query(
          `INSERT INTO inventory_items
             (user_id, find_type, template_id, rarity, object_data, status, xp_gained)
           VALUES ($1, $2, $3, $4, $5, 'in_inventory', $6)`,
          [
            userId,
            item.findType,
            item.templateId || `blitz_${item.findType}`,
            item.rarity,
            JSON.stringify(objectData),
            item.xpValue || 0,
          ]
        );
      }

      await client.query('UPDATE blitz_sessions SET payout_claimed = true WHERE id = $1', [sessionId]);
      return { kept: true, itemCount: items.length };
    });
  }
}

module.exports = BlitzExpeditionService;
