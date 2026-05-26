'use strict';

const crypto = require('crypto');
const { query } = require('../db/pool');
const EventService = require('./eventService');
const { ECHO_TEMPLATES, RELIC_TEMPLATES, ENTITY_TEMPLATES, RIFT_TEMPLATES } = require('../config/u2Templates');

// ── Per-rarity item templates ─────────────────────────────────────────────────
// minMass/maxMass in arbitrary units (у.е.) for debris/anomaly, kg for creatures
// minPrice/maxPrice = characteristic base value (before zone + rarity sell mult)

const DEBRIS_TEMPLATES = {
  common: [
    { id: 'hull_fragment',   name: 'Обломок обшивки',       minMass:  80, maxMass:  200, minVol: 15, maxVol:  40, minPrice:  15, maxPrice:  45 },
    { id: 'broken_arm',      name: 'Сломанный манипулятор', minMass:  40, maxMass:  120, minVol:  8, maxVol:  25, minPrice:  12, maxPrice:  38 },
    { id: 'empty_fuel_tank', name: 'Топливный бак (пустой)',minMass:  30, maxMass:   90, minVol: 20, maxVol:  60, minPrice:  10, maxPrice:  32 },
  ],
  rare: [
    { id: 'nav_module',      name: 'Навигационный модуль',  minMass:  15, maxMass:   50, minVol:  5, maxVol:  15, minPrice:  28, maxPrice:  52 },
    { id: 'engine_section',  name: 'Двигательная секция',   minMass: 200, maxMass:  600, minVol: 40, maxVol: 100, minPrice:  30, maxPrice:  55 },
    { id: 'cargo_container', name: 'Грузовой контейнер',    minMass: 100, maxMass:  300, minVol: 30, maxVol:  80, minPrice:  26, maxPrice:  50 },
  ],
  epic: [
    { id: 'military_drone',  name: 'Военный дрон (нерабочий)', minMass:  60, maxMass: 150, minVol: 10, maxVol:  30, minPrice:  58, maxPrice:  92 },
    { id: 'reactor_block',   name: 'Блок реактора',         minMass: 400, maxMass:  900, minVol: 50, maxVol: 120, minPrice:  62, maxPrice:  98 },
    { id: 'cryo_chamber',    name: 'Криокамера',            minMass: 150, maxMass:  350, minVol: 25, maxVol:  60, minPrice:  55, maxPrice:  88 },
  ],
  legendary: [
    { id: 'ai_core',         name: 'ИИ-ядро (повреждённое)',minMass:   5, maxMass:   20, minVol:  2, maxVol:   8, minPrice: 110, maxPrice: 190 },
    { id: 'warp_coil',       name: 'Прототип варп-катушки', minMass:  80, maxMass:  200, minVol: 15, maxVol:  35, minPrice: 120, maxPrice: 200 },
  ],
  mythical: [
    { id: 'singularity_gen', name: 'Сингулярный генератор', minMass:   1, maxMass:   10, minVol:  1, maxVol:   5, minPrice: 310, maxPrice: 490 },
  ],
};

const ARTIFACT_TEMPLATES = {
  common: [
    { id: 'colony_relic',    name: 'Реликвия старой колонии',       race: 'Люди (старая колония)', minMass:  50, maxMass: 300, minVol: 10, maxVol: 60, minPrice:  18, maxPrice:  48 },
    { id: 'broken_mechanoid',name: 'Сломанный механоид',            race: 'Механоиды',             minMass: 100, maxMass: 300, minVol: 20, maxVol: 60, minPrice:  20, maxPrice:  50 },
  ],
  rare: [
    { id: 'keiron_trade',    name: 'Торговый знак Кейрон',          race: 'Торговцы Кейрон',       minMass:  20, maxMass: 150, minVol:  5, maxVol: 30, minPrice:  30, maxPrice:  56 },
    { id: 'valtar_weapon',   name: 'Оружие Империи Валтар',         race: 'Империя Валтар',        minMass:  30, maxMass: 150, minVol:  5, maxVol: 30, minPrice:  32, maxPrice:  60 },
  ],
  epic: [
    { id: 'builder_relic',   name: 'Артефакт Древних Строителей',  race: 'Древние Строители',     minMass:   5, maxMass:  80, minVol:  2, maxVol: 20, minPrice:  62, maxPrice: 100 },
    { id: 'oro_biotech',     name: 'Биотехнология Симбионтов Оро', race: 'Симбионты Оро',         minMass:   5, maxMass:  80, minVol:  2, maxVol: 20, minPrice:  60, maxPrice:  96 },
  ],
  legendary: [
    { id: 'precursor_relic', name: 'Реликвия Предтеч',             race: 'Предтечи',              minMass:   1, maxMass:  30, minVol: 0.5, maxVol:  8, minPrice: 125, maxPrice: 205 },
  ],
  mythical: [
    { id: 'unknown_x',       name: 'Объект класса X',              race: 'Неизвестная раса X',    minMass: 0.1, maxMass:   5, minVol: 0.1, maxVol:  2, minPrice: 330, maxPrice: 530 },
  ],
};

const CREATURE_TEMPLATES = {
  // Prices for non-intelligent; intelligent ones get ×2.5 bonus in generator
  common: [
    { id: 'space_plankton',   name: 'Космический планктон', isIntelligent: false, minMass: 0.001, maxMass:   0.1, minPrice:  10, maxPrice:  30 },
    { id: 'vacuum_jellyfish', name: 'Вакуумная медуза',     isIntelligent: false, minMass:   0.5, maxMass:     5, minPrice:  14, maxPrice:  36 },
    { id: 'dust_worm',        name: 'Пылевой червь',        isIntelligent: false, minMass:     2, maxMass:    20, minPrice:  18, maxPrice:  42 },
  ],
  rare: [
    { id: 'star_crab',        name: 'Звёздный краб',        isIntelligent: false, minMass:    10, maxMass:    80, minPrice:  22, maxPrice:  46 },
    { id: 'ice_leviathan_s',  name: 'Ледяной левиафан (малый)', isIntelligent: false, minMass: 50, maxMass:   500, minPrice:  26, maxPrice:  50 },
    { id: 'crystal_swarm',    name: 'Кристаллический рой',  isIntelligent: false, minMass:     5, maxMass:    30, minPrice:  20, maxPrice:  44 },
  ],
  epic: [
    { id: 'shadow_predator',  name: 'Теневой хищник',       isIntelligent: false, minMass:   100, maxMass:   800, minPrice:  55, maxPrice:  90 },
    { id: 'kelo_shroom',      name: 'Разумный гриб Кело',   isIntelligent: true,  minMass:    20, maxMass:   120, minPrice:  22, maxPrice:  40 },
    { id: 'plasma_dragon',    name: 'Плазменный дракон',    isIntelligent: false, minMass:   0.1, maxMass:     2, minPrice:  50, maxPrice:  85 },
  ],
  legendary: [
    { id: 'ice_leviathan_a',  name: 'Ледяной левиафан (взрослый)', isIntelligent: false, minMass: 500, maxMass: 5000, minPrice: 115, maxPrice: 185 },
    { id: 'ancient_guardian', name: 'Древний страж',        isIntelligent: true,  minMass:  1000, maxMass: 10000, minPrice:  45, maxPrice:  80 },
    { id: 'quantum_mimic',    name: 'Квантовый мимик',      isIntelligent: true,  minMass:  0.01, maxMass:     5, minPrice:  40, maxPrice:  72 },
  ],
  mythical: [
    { id: 'living_star',      name: 'Живая звезда (фрагмент)', isIntelligent: true, minMass: 1, maxMass: 1000000, minPrice: 120, maxPrice: 200 },
  ],
};

// anomaly container mass = mass of stabilizing equipment (not the anomaly itself)
// minVol/maxVol = volume of containment equipment in м³
const ANOMALY_TEMPLATES = {
  common: [
    { id: 'grav_lens',        name: 'Гравитационная линза',        minMass:   80, maxMass:  200, minVol: 20, maxVol:  60, minPrice:  18, maxPrice:  42 },
    { id: 'mag_storm',        name: 'Магнитный шторм (образец)',   minMass:   50, maxMass:  150, minVol: 15, maxVol:  50, minPrice:  16, maxPrice:  38 },
  ],
  rare: [
    { id: 'time_bubble',      name: 'Временной пузырь',            minMass:  200, maxMass:  500, minVol: 25, maxVol:  70, minPrice:  28, maxPrice:  54 },
    { id: 'antigrav_pocket',  name: 'Антигравитационный карман',   minMass:   30, maxMass:  100, minVol: 10, maxVol:  35, minPrice:  26, maxPrice:  50 },
  ],
  epic: [
    { id: 'space_fold',       name: 'Складка пространства',        minMass:  500, maxMass: 1200, minVol: 30, maxVol:  80, minPrice:  65, maxPrice: 100 },
    { id: 'chrono_crystal',   name: 'Хроно-кристалл',              minMass:  100, maxMass:  300, minVol:  8, maxVol:  25, minPrice:  62, maxPrice:  96 },
  ],
  legendary: [
    { id: 'mini_blackhole',   name: 'Мини-чёрная дыра',            minMass: 1000, maxMass: 3000, minVol:  3, maxVol:  12, minPrice: 125, maxPrice: 205 },
    { id: 'blocked_portal',   name: 'Портал (заблокированный)',    minMass: 2000, maxMass: 5000, minVol:  5, maxVol:  18, minPrice: 130, maxPrice: 210 },
  ],
  mythical: [
    { id: 'consciousness_singularity', name: 'Сингулярность сознания', minMass: 0.001, maxMass: 0.01, minVol: 0.001, maxVol: 0.01, minPrice: 340, maxPrice: 520 },
  ],
};

// Asteroid volume (tons) and condition (%) ranges by rarity
const ASTEROID_VOLUME = {
  common:    { min: 80,  max: 240 },
  rare:      { min: 60,  max: 180 },
  epic:      { min: 40,  max: 120 },
  legendary: { min: 20,  max: 60  },
  mythical:  { min: 2,   max: 12  },
};
const ASTEROID_CONDITION = {
  common:    { min: 10, max: 60 },
  rare:      { min: 20, max: 75 },
  epic:      { min: 40, max: 90 },
  legendary: { min: 60, max: 95 },
  mythical:  { min: 80, max: 100 },
};

// U2 asteroid ranges mapped to U2 rarities.
const ASTEROID_VOLUME_U2 = {
  exotic:      { min: 80,  max: 240 },
  ancient:     { min: 60,  max: 180 },
  relic:       { min: 40,  max: 120 },
  hybrid:      { min: 20,  max: 60  },
  singularity: { min: 2,   max: 12  },
};
const ASTEROID_CONDITION_U2 = {
  exotic:      { min: 10, max: 60 },
  ancient:     { min: 20, max: 75 },
  relic:       { min: 40, max: 90 },
  hybrid:      { min: 60, max: 95 },
  singularity: { min: 80, max: 100 },
};

const U1_LOWEST_RARITY = 'common';
const U2_LOWEST_RARITY = 'exotic';
const U1_TOP_RARITIES = new Set(['legendary', 'mythical']);
const U2_TOP_RARITIES = new Set(['hybrid', 'singularity']);

/**
 * FindGeneratorService — generates random expedition findings.
 *
 * Uses provably fair randomness:
 * - Server seed (secret until reveal)
 * - Client seed (provided by client)
 * - Combined hash = SHA256(serverSeed + clientSeed)
 * - Derivation: use HMAC with combined hash as key
 *
 * This ensures the server cannot manipulate results after
 * the client has submitted their seed.
 */
class FindGeneratorService {
  /**
   * Returns count of all unique named templates (excludes asteroid/nft which don't have named templates).
   * Used by achievement and stats systems.
   */
  static get TOTAL_UNIQUE_TEMPLATES() {
    let count = 0;
    const allCollections = [
      DEBRIS_TEMPLATES, ARTIFACT_TEMPLATES, CREATURE_TEMPLATES, ANOMALY_TEMPLATES
    ];
    for (const col of allCollections) {
      for (const arr of Object.values(col)) {
        count += arr.length;
      }
    }
    return count;
  }

  constructor(configManager) {
    this.cfg = configManager;
  }

  generateServerSeed() {
    return crypto.randomBytes(32).toString('hex');
  }

  validateClientSeed(clientSeed) {
    return (
      typeof clientSeed === 'string' &&
      clientSeed.length >= 8 &&
      clientSeed.length <= 64 &&
      /^[a-zA-Z0-9_-]+$/.test(clientSeed)
    );
  }

  _deriveFloat(serverSeed, clientSeed, nonce) {
    const combined = `${serverSeed}:${clientSeed}:${nonce}`;
    const hash = crypto.createHash('sha256').update(combined).digest('hex');
    return parseInt(hash.slice(0, 8), 16) / 0xFFFFFFFF;
  }

  _weightedSelect(items, rng) {
    const entries = Object.entries(items);
    const totalWeight = entries.reduce((sum, [, v]) => sum + (v.weight ?? v), 0);
    let target = rng * totalWeight;
    for (const [key, v] of entries) {
      target -= (v.weight ?? v);
      if (target <= 0) return key;
    }
    return entries[entries.length - 1][0];
  }

  _selectTemplate(templates, rng) {
    const idx = Math.floor(rng * templates.length);
    return templates[Math.min(idx, templates.length - 1)];
  }

  _range(min, max, rng) {
    return min + rng * (max - min);
  }

  /**
   * Converts raw mass into a bounded value multiplier.
   * Saturating exponential keeps heavy entities valuable, but prevents
   * extreme outliers from exploding sell price after rarity multipliers.
   */
  _massValueMultiplier(mass) {
    const safeMass = Math.max(0, Number(mass) || 0);
    const MAX_EXTRA = 1.2; // max multiplier = 1 + MAX_EXTRA => 2.2x
    const SCALE = 1200;
    return 1 + MAX_EXTRA * (1 - Math.exp(-safeMass / SCALE));
  }

  _centerWeightedRandom(rng, samples, label = 'center') {
    if (typeof rng !== 'function') {
      return Number(rng) || 0;
    }
    let total = 0;
    for (let i = 0; i < samples; i++) {
      total += rng(`${label}_${i}`);
    }
    return total / samples;
  }

  /**
   * Rarity-biased range for mass/volume.
   * Uses a center-weighted distribution so edge values appear less often.
   */
  _biasedRange(min, max, rarity, rng, label = 'center') {
    const sampleCountByRarity = {
      common: 2,
      rare: 3,
      epic: 3,
      legendary: 4,
      mythical: 5,
    };
    const samples = sampleCountByRarity[rarity] || 2;
    return this._range(min, max, this._centerWeightedRandom(rng, samples, label));
  }

  /**
   * Generate a find result.
   * @param buffs        - map of buffType → buff row from user_active_buffs (optional)
   * @param eventEffects - array of event effect objects (snapshot from expedition start)
   */
  async generate(serverSeed, clientSeed, zone, scannerModule = { level: 0, rarityMultiplier: 1.0, scansUpTo: 0 }, buffs = {}, userId = null, eventEffects = [], universe = 1) {
    const config = this.cfg.config;
    const isU2 = universe === 2;
    let nonce = 0;
    const rng = (label) => this._deriveFloat(serverSeed, clientSeed, `${label}_${nonce++}`);

    // Use U2 find types and rarity config when in Universe 2
    const findTypesConfig = isU2 ? (config.universe2?.findTypes || config.findTypes) : config.findTypes;
    const rarityConfig = isU2 ? (config.universe2?.rarity || config.rarity) : config.rarity;
    const economyConfig = isU2 ? (config.universe2?.economy || config.economy) : config.economy;
    const typeMapU1ToU2 = {
      debris: 'echo',
      artifact: 'relic',
      creature: 'entity',
      anomaly: 'rift',
      asteroid: 'asteroid',
    };
    const typeMapU2ToU1 = {
      echo: 'debris',
      relic: 'artifact',
      entity: 'creature',
      rift: 'anomaly',
      asteroid: 'asteroid',
    };
    const cartographerRawTarget = buffs.cartographer?.metadata?.targetType;
    const cartographerTarget = findTypesConfig?.[cartographerRawTarget]
      ? cartographerRawTarget
      : (isU2 ? typeMapU1ToU2[cartographerRawTarget] : typeMapU2ToU1[cartographerRawTarget]);
    const cartographerGuaranteedType = Boolean(
      cartographerTarget &&
      cartographerTarget !== 'nft_container' &&
      findTypesConfig?.[cartographerTarget]
    );
    const allowedTypes = isU2
      ? new Set(['echo', 'relic', 'entity', 'rift', 'asteroid'])
      : new Set(['asteroid', 'debris', 'artifact', 'creature', 'anomaly', 'nft_container']);
    const allowedRarities = isU2
      ? new Set(['exotic', 'ancient', 'relic', 'hybrid', 'singularity'])
      : new Set(['common', 'rare', 'epic', 'legendary', 'mythical']);

    // ── 1. NFT container check — no NFTs in U2 ──────────────────────────────
    if (!isU2 && !cartographerGuaranteedType && rng('nft') < config.nft.containerChance) {
      return await this._generateNFTContainer(rng, userId);
    }

    // ── 2. Service buffs: force_rarity / force_type (admin overrides, not shown to user) ──
    let forcedRarity = null;
    let forcedType   = null;
    const toConsume  = [];   // buffTypes to decrement after generation

    if (userId) {
      const forceRes = await query(
        `SELECT buff_type, metadata, uses_remaining
         FROM user_active_buffs
         WHERE user_id = $1
           AND buff_type IN ('force_rarity', 'force_type')
           AND uses_remaining > 0`,
        [userId]
      );
      for (const row of forceRes.rows) {
        if (row.buff_type === 'force_rarity' && row.metadata?.rarity) {
          forcedRarity = row.metadata.rarity;
          toConsume.push('force_rarity');
        }
        if (row.buff_type === 'force_type' && row.metadata?.findType) {
          forcedType = row.metadata.findType;
          toConsume.push('force_type');
        }
      }
    }

    // ── 2b. Normalize forced values to current universe ────────────────────
    const rarityMapU1ToU2 = {
      common: 'exotic',
      rare: 'ancient',
      epic: 'relic',
      legendary: 'hybrid',
      mythical: 'singularity',
    };
    const rarityMapU2ToU1 = {
      exotic: 'common',
      ancient: 'rare',
      relic: 'epic',
      hybrid: 'legendary',
      singularity: 'mythical',
    };
    if (forcedRarity) {
      if (!rarityConfig[forcedRarity]) {
        forcedRarity = isU2 ? (rarityMapU1ToU2[forcedRarity] || null) : (rarityMapU2ToU1[forcedRarity] || null);
      }
      if (forcedRarity && !rarityConfig[forcedRarity]) forcedRarity = null;
    }

    if (forcedType) {
      if (!findTypesConfig[forcedType] && !(forcedType === 'nft_container' && !isU2)) {
        forcedType = isU2 ? (typeMapU1ToU2[forcedType] || null) : (typeMapU2ToU1[forcedType] || null);
      }
      // No NFTs in U2 even if forced from admin.
      if (isU2 && forcedType === 'nft_container') forcedType = null;
      if (forcedType && !findTypesConfig[forcedType] && !(forcedType === 'nft_container' && !isU2)) {
        forcedType = null;
      }
    }

    // ── 3. Find type (with cartographer boost, or forced) ────────────────────
    let findType;
    if (forcedType) {
      findType = forcedType;
      rng('type'); // consume the RNG slot to keep nonce sequence stable
    } else if (cartographerGuaranteedType) {
      // Cartographer guarantees a repeat of the last non-NFT find type.
      findType = cartographerTarget;
      rng('type'); // consume RNG slot to keep nonce sequence stable
    } else {
      const findTypeWeights = {};
      // Gather spawn_rate effects for this zone
      const zoneEventEffects = EventService.filterForZone(eventEffects, zone.id);
      for (const [type, cfg] of Object.entries(findTypesConfig)) {
        let weight = cfg.weight * (zone.findTypeModifiers?.[type] || 1.0);
        // Apply event spawn_rate effects (specific type or null = all types)
        for (const e of zoneEventEffects) {
          if (e.type === 'spawn_rate' && (e.findType === type || e.findType == null)) {
            weight *= e.multiplier;
          }
        }
        findTypeWeights[type] = { weight };
      }
      findType = this._weightedSelect(findTypeWeights, rng('type'));
    }

    // Safety: never allow unknown find types to proceed to DB insert.
    if (!allowedTypes.has(findType)) {
      findType = isU2 ? 'echo' : 'debris';
    }

    // ── 4. Rarity (zone + scanner + signal_amplifier + quantum_locator, or forced) ──
    let rarity;
    if (forcedRarity) {
      rarity = forcedRarity;
      rng('rarity'); // consume RNG slot
    } else {
      const rarityEffects = EventService.filterForZone(eventEffects, zone.id)
        .filter((e) => e.type === 'rarity_bonus' || e.type === 'common_reduction');
      rarity = this._selectRarity(
        rarityConfig,
        zone.rarityMultiplier * scannerModule.rarityMultiplier,
        rng('rarity'),
        buffs,
        rarityEffects
      );
    }

    // Safety: never allow unknown rarity values to proceed to DB insert.
    if (!allowedRarities.has(rarity)) {
      rarity = isU2 ? 'exotic' : 'common';
    }

    // ── 5. Generate object ────────────────────────────────────────────────────
    // NFT container forced via admin → use dedicated generator
    if (findType === 'nft_container') {
      // Consume force buffs before returning
      if (userId && toConsume.length > 0) {
        for (const buffType of toConsume) {
          await query(
            `UPDATE user_active_buffs SET uses_remaining = uses_remaining - 1
             WHERE user_id = $1 AND buff_type = $2`, [userId, buffType]);
          await query(
            `DELETE FROM user_active_buffs WHERE user_id = $1 AND buff_type = $2 AND uses_remaining <= 0`,
            [userId, buffType]);
        }
      }
      return await this._generateNFTContainer(rng, userId);
    }

    const find = isU2
      ? this._generateU2Find(findType, rarity, zone, scannerModule, config, rng, buffs)
      : this._generateFind(findType, rarity, zone, scannerModule, config, rng, buffs);

    // ── 5b. Asteroid scanner check ────────────────────────────────────────────
    // If scanner level doesn't cover the asteroid's rarity, the asteroid is
    // returned as 'common' rarity (unknown value). Real data is preserved in
    // objectData.actualRarity / objectData.realBaseCredits for future drills.
    if (findType === 'asteroid' && !find.scanned) {
      rarity = isU2 ? U2_LOWEST_RARITY : U1_LOWEST_RARITY;
      // Apply zone credit multiplier to real value so future drills have zone-adjusted price
      if (find.realBaseCredits != null) {
        find.realBaseCredits = Math.round(find.realBaseCredits * (zone.creditMultiplier || 1.0));
      }
    }

    // ── 6. Consume force buffs ────────────────────────────────────────────────
    if (userId && toConsume.length > 0) {
      for (const buffType of toConsume) {
        await query(
          `UPDATE user_active_buffs
           SET uses_remaining = uses_remaining - 1
           WHERE user_id = $1 AND buff_type = $2`,
          [userId, buffType]
        );
        await query(
          `DELETE FROM user_active_buffs
           WHERE user_id = $1 AND buff_type = $2 AND uses_remaining <= 0`,
          [userId, buffType]
        );
      }
    }

    // ── 7. XP = typeBase × zone multiplier (event bonus applied later at award time)
    const baseXP = Math.round((economyConfig.baseXP[findType] || 10) * (zone.xpMultiplier || 1.0));

    // ── 8. Credits = characteristic value × zone multiplier (event bonus applied later)
    // Unscanned asteroids: fixed coordinate sell price (not zone-modified — value is "unknown")
    const baseCredits = (findType === 'asteroid' && !find.scanned)
      ? 120
      : Math.round((find.baseCredits || 0) * (zone.creditMultiplier || 1.0));

    return { findType, rarity, templateId: find.templateId, objectData: find, baseCredits, baseXP };
  }

  _selectRarity(rarityConfig, totalMultiplier, rng, buffs = {}, eventRarityEffects = []) {
    const signalAmp = buffs.signal_amplifier;
    const quantumLoc = buffs.quantum_locator;
    const rarityKeys = Object.keys(rarityConfig || {});
    const isU2Scale = rarityKeys.includes('exotic') || rarityKeys.includes('ancient');
    const defaultLowest = isU2Scale ? U2_LOWEST_RARITY : U1_LOWEST_RARITY;
    const lowestRarity = rarityConfig?.[defaultLowest] ? defaultLowest : (rarityKeys[0] || U1_LOWEST_RARITY);
    const topRarities = isU2Scale ? U2_TOP_RARITIES : U1_TOP_RARITIES;
    const eventRarityAlias = isU2Scale
      ? {
          common: 'exotic',
          rare: 'ancient',
          epic: 'relic',
          legendary: 'hybrid',
          mythical: 'singularity',
        }
      : {
          exotic: 'common',
          ancient: 'rare',
          relic: 'epic',
          hybrid: 'legendary',
          singularity: 'mythical',
        };

    const adjusted = {};
    for (const [key, cfg] of Object.entries(rarityConfig)) {
      let weight = key === lowestRarity ? cfg.weight : cfg.weight * totalMultiplier;
      // Quantum locator: +50% to the top two rarity tiers.
      if (quantumLoc && topRarities.has(key)) weight *= 1.5;
      adjusted[key] = { weight };
    }

    // Signal amplifier: reduce the lowest-tier weight, distribute freed weight to rarer tiers.
    if (signalAmp && adjusted[lowestRarity]) {
      const rarityBonus = signalAmp.metadata?.rarityBonus || 0.05;
      const reduction = adjusted[lowestRarity].weight * rarityBonus;
      adjusted[lowestRarity].weight -= reduction;
      const nonCommonTotal = Object.entries(adjusted)
        .filter(([k]) => k !== lowestRarity)
        .reduce((s, [, v]) => s + v.weight, 0);
      for (const key of Object.keys(adjusted)) {
        if (key !== lowestRarity && nonCommonTotal > 0) {
          adjusted[key].weight += reduction * (adjusted[key].weight / nonCommonTotal);
        }
      }
    }

    // ── Event rarity effects ───────────────────────────────────────────────
    for (const e of eventRarityEffects) {
      if (e.type === 'rarity_bonus') {
        if (e.rarity == null) {
          // null = boost all non-lowest rarities.
          for (const key of Object.keys(adjusted)) {
            if (key !== lowestRarity) adjusted[key].weight *= e.multiplier;
          }
        } else {
          const normalizedRarity = adjusted[e.rarity] ? e.rarity : eventRarityAlias[e.rarity];
          if (normalizedRarity && adjusted[normalizedRarity]) {
            adjusted[normalizedRarity].weight *= e.multiplier;
          }
        }
      } else if (e.type === 'common_reduction') {
        // Reduce the lowest-tier weight, redistribute freed weight proportionally to rarer tiers.
        if (!adjusted[lowestRarity]) continue;
        const reduction = adjusted[lowestRarity].weight * Math.min(e.reduction, 0.95);
        adjusted[lowestRarity].weight -= reduction;
        const nonCommonTotal = Object.entries(adjusted)
          .filter(([k]) => k !== lowestRarity)
          .reduce((s, [, v]) => s + v.weight, 0);
        for (const key of Object.keys(adjusted)) {
          if (key !== lowestRarity && nonCommonTotal > 0) {
            adjusted[key].weight += reduction * (adjusted[key].weight / nonCommonTotal);
          }
        }
      }
    }

    const total = Object.values(adjusted).reduce((s, v) => s + v.weight, 0);
    const normalized = {};
    for (const [key, v] of Object.entries(adjusted)) {
      normalized[key] = { weight: (v.weight / total) * 100 };
    }
    return this._weightedSelect(normalized, rng);
  }

  _generateFind(findType, rarity, zone, scanner, config, rng, buffs = {}) {
    switch (findType) {
      case 'debris':   return this._generateDebris(rarity, rng);
      case 'artifact': return this._generateArtifact(rarity, rng);
      case 'creature': return this._generateCreature(rarity, rng, buffs);
      case 'anomaly':  return this._generateAnomaly(rarity, rng);
      case 'asteroid': return this._generateAsteroid(rarity, zone, scanner, config, rng);
      default:         return this._generateDebris(rarity, rng);
    }
  }

  _generateDebris(rarity, rng) {
    const pool = DEBRIS_TEMPLATES[rarity] || DEBRIS_TEMPLATES.common;
    const tmpl = this._selectTemplate(pool, rng('debris_tmpl'));
    const mass   = parseFloat(this._biasedRange(tmpl.minMass, tmpl.maxMass, rarity, rng, 'mass').toFixed(1));
    const volume = parseFloat(this._biasedRange(tmpl.minVol,  tmpl.maxVol,  rarity, rng, 'volume').toFixed(1));
    const basePrice = this._range(tmpl.minPrice, tmpl.maxPrice, rng('price'));
    // Heavier items slightly more valuable, but material matters more than weight
    const charBonus = 1 + (mass / 200) * 0.3;
    return {
      templateId: tmpl.id,
      name: tmpl.name,
      mass,
      volume,
      baseCredits: Math.round(basePrice * charBonus),
    };
  }

  _generateArtifact(rarity, rng) {
    const pool = ARTIFACT_TEMPLATES[rarity] || ARTIFACT_TEMPLATES.common;
    const tmpl = this._selectTemplate(pool, rng('artifact_tmpl'));
    const mass   = parseFloat(this._biasedRange(tmpl.minMass, tmpl.maxMass, rarity, rng, 'mass').toFixed(3));
    const volume = parseFloat(this._biasedRange(tmpl.minVol,  tmpl.maxVol,  rarity, rng, 'volume').toFixed(2));
    const basePrice = this._range(tmpl.minPrice, tmpl.maxPrice, rng('price'));
    return {
      templateId: tmpl.id,
      name: tmpl.name,
      race: tmpl.race,
      mass,
      volume,
      baseCredits: Math.round(basePrice),
    };
  }

  _generateCreature(rarity, rng, buffs = {}) {
    const pool = CREATURE_TEMPLATES[rarity] || CREATURE_TEMPLATES.common;
    const tmpl = this._selectTemplate(pool, rng('creature_tmpl'));
    // Quantum locator: creature mass can exceed standard max by 1.5×
    const maxMassMult = buffs.quantum_locator ? 1.5 : 1.0;
    const mass = parseFloat(this._biasedRange(tmpl.minMass, tmpl.maxMass * maxMassMult, rarity, rng, 'mass').toFixed(4));
    const basePrice = this._range(tmpl.minPrice, tmpl.maxPrice, rng('price'));
    // Bounded mass value prevents extreme high-mass jackpots.
    const massFactor = this._massValueMultiplier(mass);
    // Intelligent creatures cost more
    const intelligenceMult = tmpl.isIntelligent ? 2.5 : 1.0;
    return {
      templateId: tmpl.id,
      name: tmpl.name,
      isIntelligent: tmpl.isIntelligent,
      mass,
      baseCredits: Math.round(basePrice * massFactor * intelligenceMult),
    };
  }

  _generateAnomaly(rarity, rng) {
    const pool = ANOMALY_TEMPLATES[rarity] || ANOMALY_TEMPLATES.common;
    const tmpl = this._selectTemplate(pool, rng('anomaly_tmpl'));
    // Container mass is the stabilizing equipment — doesn't affect sell price
    const mass   = parseFloat(this._biasedRange(tmpl.minMass, tmpl.maxMass, rarity, rng, 'mass').toFixed(4));
    const volume = parseFloat(this._biasedRange(tmpl.minVol,  tmpl.maxVol,  rarity, rng, 'volume').toFixed(2));
    const basePrice = this._range(tmpl.minPrice, tmpl.maxPrice, rng('price'));
    return {
      templateId: tmpl.id,
      name: tmpl.name,
      mass,
      volume,
      containerIntegrity: parseFloat((50 + rng('integrity') * 50).toFixed(1)),
      baseCredits: Math.round(basePrice),
    };
  }

  // ── U2 generators ─────────────────────────────────────────────────────────

  _generateU2Find(findType, rarity, zone, scanner, config, rng, buffs = {}) {
    switch (findType) {
      case 'echo':    return this._generateEcho(rarity, rng);
      case 'relic':   return this._generateRelic(rarity, rng);
      case 'entity':  return this._generateEntity(rarity, rng, buffs);
      case 'rift':    return this._generateRift(rarity, rng);
      case 'asteroid': return this._generateU2Asteroid(rarity, zone, scanner, config, rng);
      default:        return this._generateEcho(rarity, rng);
    }
  }

  /**
   * Biased range for the U2 5-tier rarity scale.
   * Uses a center-weighted distribution so edge values appear less often.
   */
  _u2BiasedRange(min, max, rarity, rng, label = 'center') {
    const sampleCountByRarity = {
      exotic: 2,
      ancient: 3,
      relic: 3,
      hybrid: 4,
      singularity: 5,
    };
    const samples = sampleCountByRarity[rarity] || 2;
    return this._range(min, max, this._centerWeightedRandom(rng, samples, label));
  }

  _generateEcho(rarity, rng) {
    const pool = ECHO_TEMPLATES[rarity] || ECHO_TEMPLATES.common;
    const tmpl = this._selectTemplate(pool, rng('echo_tmpl'));
    const mass   = parseFloat(this._u2BiasedRange(tmpl.minMass, tmpl.maxMass, rarity, rng, 'mass').toFixed(1));
    const volume = parseFloat(this._u2BiasedRange(tmpl.minVol,  tmpl.maxVol,  rarity, rng, 'volume').toFixed(1));
    const basePrice = this._range(tmpl.minPrice, tmpl.maxPrice, rng('price'));
    const charBonus = 1 + (mass / 200) * 0.3;
    return {
      templateId: tmpl.id,
      name: tmpl.name,
      nameEn: tmpl.nameEn,
      mass,
      volume,
      universe: 2,
      baseCredits: Math.round(basePrice * charBonus),
    };
  }

  _generateRelic(rarity, rng) {
    const pool = RELIC_TEMPLATES[rarity] || RELIC_TEMPLATES.common;
    const tmpl = this._selectTemplate(pool, rng('relic_tmpl'));
    const mass   = parseFloat(this._u2BiasedRange(tmpl.minMass, tmpl.maxMass, rarity, rng, 'mass').toFixed(3));
    const volume = parseFloat(this._u2BiasedRange(tmpl.minVol,  tmpl.maxVol,  rarity, rng, 'volume').toFixed(2));
    const basePrice = this._range(tmpl.minPrice, tmpl.maxPrice, rng('price'));
    return {
      templateId: tmpl.id,
      name: tmpl.name,
      nameEn: tmpl.nameEn,
      race: tmpl.race,
      mass,
      volume,
      universe: 2,
      baseCredits: Math.round(basePrice),
    };
  }

  _generateEntity(rarity, rng, buffs = {}) {
    const pool = ENTITY_TEMPLATES[rarity] || ENTITY_TEMPLATES.common;
    const tmpl = this._selectTemplate(pool, rng('entity_tmpl'));
    // Cap infinity-like masses to keep omega-scale entities bounded.
    const maxMass = Number.isFinite(tmpl.maxMass) ? Math.min(tmpl.maxMass, 100000) : 100000;
    const maxMassMult = buffs.quantum_locator ? 1.5 : 1.0;
    const mass = parseFloat(this._u2BiasedRange(tmpl.minMass, maxMass * maxMassMult, rarity, rng, 'mass').toFixed(4));
    const basePrice = this._range(tmpl.minPrice, tmpl.maxPrice, rng('price'));
    const massFactor = this._massValueMultiplier(mass);
    const intelligenceMult = tmpl.isIntelligent ? 2.5 : 1.0;
    return {
      templateId: tmpl.id,
      name: tmpl.name,
      nameEn: tmpl.nameEn,
      isIntelligent: tmpl.isIntelligent,
      mass,
      universe: 2,
      baseCredits: Math.round(basePrice * massFactor * intelligenceMult),
    };
  }

  _generateRift(rarity, rng) {
    const pool = RIFT_TEMPLATES[rarity] || RIFT_TEMPLATES.common;
    const tmpl = this._selectTemplate(pool, rng('rift_tmpl'));
    const mass   = parseFloat(this._u2BiasedRange(tmpl.minMass, tmpl.maxMass, rarity, rng, 'mass').toFixed(4));
    const volume = parseFloat(this._u2BiasedRange(tmpl.minVol,  tmpl.maxVol,  rarity, rng, 'volume').toFixed(2));
    const basePrice = this._range(tmpl.minPrice, tmpl.maxPrice, rng('price'));
    return {
      templateId: tmpl.id,
      name: tmpl.name,
      nameEn: tmpl.nameEn,
      mass,
      volume,
      containerIntegrity: parseFloat((50 + rng('integrity') * 50).toFixed(1)),
      universe: 2,
      baseCredits: Math.round(basePrice),
    };
  }

  _generateU2Asteroid(rarity, zone, scanner, config, rng) {
    const u2Resources = config.universe2?.asteroidResources || {};
    const resources = u2Resources[rarity] || u2Resources.exotic || config.asteroidResources.common;
    const resource = this._selectTemplate(resources, rng('res'));

    const sectors = config.universe2?.sectors || config.sectors;
    const sector = sectors[Math.floor(rng('sector') * sectors.length)];
    const coords = {
      sector,
      x: parseFloat((rng('cx') * 1000).toFixed(1)),
      y: parseFloat((rng('cy') * 1000).toFixed(1)),
      z: parseFloat((rng('cz') * 1000).toFixed(1)),
    };

    const volRange  = ASTEROID_VOLUME_U2[rarity]   || ASTEROID_VOLUME_U2.exotic;
    const condRange = ASTEROID_CONDITION_U2[rarity] || ASTEROID_CONDITION_U2.exotic;

    const volumeTons = parseFloat(this._range(volRange.min, volRange.max, rng('vol')).toFixed(3));
    const condition  = parseFloat(this._range(condRange.min, condRange.max, rng('cond')).toFixed(1));

    const depletionFactor = (condition / 100) * 0.8 + 0.2;
    const realBaseCredits = Math.round(volumeTons * resource.pricePerTon * depletionFactor);

    // Scanner covers U2 rarity if scansUpTo >= rarity index (exotic=6 ... singularity=10)
    const U2_RARITY_ORDER = ['exotic', 'ancient', 'relic', 'hybrid', 'singularity'];
    const rarityIdx = U2_RARITY_ORDER.indexOf(rarity);
    const requiredScanTier = rarityIdx >= 0 ? 6 + rarityIdx : 6;
    const scansUpTo = Number(scanner?.scansUpTo ?? scanner?.level ?? 0);
    const scanned = scansUpTo >= requiredScanTier;

    return {
      templateId: 'asteroid',
      name: `Астероид ${sector}-${Math.floor(rng('id') * 9999).toString().padStart(4, '0')}`,
      coordinates: coords,
      resourceType: resource.id,
      resourceName: resource.name,
      condition,
      estimatedVolume: volumeTons,
      actualRarity: rarity,
      scanned,
      universe: 2,
      baseCredits: scanned ? realBaseCredits : 0,
      ...(!scanned && { realBaseCredits }),
    };
  }

  _generateAsteroid(rarity, zone, scanner, config, rng) {
    const resources = config.asteroidResources[rarity] || config.asteroidResources.common;
    const resource = this._selectTemplate(resources, rng('res'));

    const sectors = config.sectors;
    const sector = sectors[Math.floor(rng('sector') * sectors.length)];
    const coords = {
      sector,
      x: parseFloat((rng('cx') * 1000).toFixed(1)),
      y: parseFloat((rng('cy') * 1000).toFixed(1)),
      z: parseFloat((rng('cz') * 1000).toFixed(1)),
    };

    const volRange  = ASTEROID_VOLUME[rarity]   || ASTEROID_VOLUME.common;
    const condRange = ASTEROID_CONDITION[rarity] || ASTEROID_CONDITION.common;

    const volumeTons = parseFloat(this._range(volRange.min, volRange.max, rng('vol')).toFixed(3));
    const condition  = parseFloat(this._range(condRange.min, condRange.max, rng('cond')).toFixed(1));

    // Price formula: volume × price/ton × depletion factor (0.2 empty → 1.0 full)
    const depletionFactor = (condition / 100) * 0.8 + 0.2;
    const realBaseCredits = Math.round(volumeTons * resource.pricePerTon * depletionFactor);

    // Scanner covers rarity if scanner level ≥ rarity index + 1
    // common=1, rare=2, epic=3, legendary=4, mythical=5
    const RARITY_ORDER = ['common', 'rare', 'epic', 'legendary', 'mythical'];
    const scanned = scanner.level >= RARITY_ORDER.indexOf(rarity) + 1;

    return {
      templateId: 'asteroid',
      name: `Астероид ${sector}-${Math.floor(rng('id') * 9999).toString().padStart(4, '0')}`,
      coordinates: coords,
      resourceType: resource.id,
      resourceName: resource.name,
      condition,
      estimatedVolume: volumeTons,
      // actualRarity always stored — used by future drills regardless of scanner
      actualRarity: rarity,
      scanned,
      // If unscanned: display price = 0 (unknown value), real price stored for future use.
      // If scanned: use real price.
      baseCredits: scanned ? realBaseCredits : 0,
      ...(!scanned && { realBaseCredits }),
    };
  }

  async _generateNFTContainer(rng, userId = null) {
    const config = this.cfg.config;
    const roll = rng('nft_outcome');
    let isTelegramGift = roll < config.nft.outcomes.telegramGift.chance;

    // If user already owns a unique_ship, always give telegram_gift instead
    if (!isTelegramGift && userId) {
      const shipCheck = await query(
        `SELECT 1 FROM inventory_items
         WHERE user_id = $1 AND find_type = 'nft_container'
           AND status IN ('in_inventory','saved_coords')
           AND object_data->>'outcomeType' = 'unique_ship'
         LIMIT 1`,
        [userId]
      );
      if (shipCheck.rows.length > 0) {
        isTelegramGift = true;
      }
    }

    return {
      findType: 'nft_container',
      rarity: 'mythical',
      templateId: 'nft_container',
      objectData: {
        templateId: 'nft_container',
        name: 'NFT Контейнер',
        outcomeType: isTelegramGift ? 'telegram_gift' : 'unique_ship',
        outcomeLabel: isTelegramGift
          ? config.nft.outcomes.telegramGift.label
          : config.nft.outcomes.uniqueShip.label,
        isOpened: false,
        baseCredits: 0,
      },
      baseCredits: 0,
      baseXP: 500,
    };
  }
}

module.exports = FindGeneratorService;
