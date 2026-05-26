'use strict';

/**
 * U2 (Second Universe) find templates.
 * Structure mirrors the U1 templates in findGeneratorService.js.
 * Uses the merged 10-tier rarity scale.
 */

// ── Echo templates (debris analog) ──────────────────────────────────────────
const ECHO_TEMPLATES = {
  common: [
    { id: 'u2_void_shard',       name: 'Осколок пустоты',         nameEn: 'Void Shard',           minMass: 50,  maxMass: 150,  minVol: 10, maxVol: 35,  minPrice: 18, maxPrice: 48 },
    { id: 'u2_resonance_dust',   name: 'Резонансная пыль',        nameEn: 'Resonance Dust',       minMass: 5,   maxMass: 30,   minVol: 5,  maxVol: 20,  minPrice: 12, maxPrice: 35 },
    { id: 'u2_phase_debris',     name: 'Фазовый обломок',         nameEn: 'Phase Debris',         minMass: 80,  maxMass: 250,  minVol: 15, maxVol: 50,  minPrice: 15, maxPrice: 42 },
  ],
  exotic: [
    { id: 'u2_echo_fragment',    name: 'Фрагмент эха',            nameEn: 'Echo Fragment',        minMass: 30,  maxMass: 100,  minVol: 8,  maxVol: 25,  minPrice: 25, maxPrice: 55 },
    { id: 'u2_mirror_plate',     name: 'Зеркальная пластина',     nameEn: 'Mirror Plate',         minMass: 60,  maxMass: 180,  minVol: 12, maxVol: 40,  minPrice: 28, maxPrice: 58 },
  ],
  rare: [
    { id: 'u2_temporal_coil',    name: 'Темпоральная катушка',    nameEn: 'Temporal Coil',        minMass: 20,  maxMass: 80,   minVol: 5,  maxVol: 18,  minPrice: 35, maxPrice: 65 },
    { id: 'u2_crystal_lattice',  name: 'Кристаллическая решётка', nameEn: 'Crystal Lattice',      minMass: 40,  maxMass: 120,  minVol: 10, maxVol: 30,  minPrice: 38, maxPrice: 68 },
  ],
  ancient: [
    { id: 'u2_entropy_shell',    name: 'Энтропийная оболочка',    nameEn: 'Entropy Shell',        minMass: 100, maxMass: 350,  minVol: 20, maxVol: 70,  minPrice: 55, maxPrice: 90 },
    { id: 'u2_void_conduit',     name: 'Пустотный проводник',     nameEn: 'Void Conduit',         minMass: 15,  maxMass: 60,   minVol: 3,  maxVol: 15,  minPrice: 50, maxPrice: 85 },
  ],
  epic: [
    { id: 'u2_warp_fragment',    name: 'Фрагмент варпа',          nameEn: 'Warp Fragment',        minMass: 200, maxMass: 600,  minVol: 30, maxVol: 90,  minPrice: 75, maxPrice: 120 },
    { id: 'u2_quantum_chassis',  name: 'Квантовый каркас',        nameEn: 'Quantum Chassis',      minMass: 80,  maxMass: 250,  minVol: 15, maxVol: 50,  minPrice: 70, maxPrice: 115 },
  ],
  relic: [
    { id: 'u2_time_lock',        name: 'Темпоральный замок',      nameEn: 'Time Lock',            minMass: 10,  maxMass: 40,   minVol: 2,  maxVol: 10,  minPrice: 100, maxPrice: 160 },
  ],
  legendary: [
    { id: 'u2_dimension_anchor', name: 'Якорь измерений',         nameEn: 'Dimension Anchor',     minMass: 5,   maxMass: 25,   minVol: 1,  maxVol: 8,   minPrice: 150, maxPrice: 240 },
  ],
  hybrid: [
    { id: 'u2_paradox_core',     name: 'Ядро парадокса',          nameEn: 'Paradox Core',         minMass: 1,   maxMass: 10,   minVol: 0.5, maxVol: 4,  minPrice: 220, maxPrice: 350 },
  ],
  mythical: [
    { id: 'u2_null_engine',      name: 'Нуль-двигатель',          nameEn: 'Null Engine',          minMass: 0.5, maxMass: 5,    minVol: 0.2, maxVol: 2,  minPrice: 400, maxPrice: 600 },
  ],
  singularity: [
    { id: 'u2_infinity_shard',   name: 'Осколок бесконечности',   nameEn: 'Infinity Shard',       minMass: 0.01, maxMass: 1,   minVol: 0.01, maxVol: 0.5, minPrice: 380, maxPrice: 500 },
  ],
};

// ── Relic templates (artifact analog) ───────────────────────────────────────
const RELIC_TEMPLATES = {
  common: [
    { id: 'u2_dim_idol',         name: 'Идол из другого мира',    nameEn: 'Otherworld Idol',      race: 'Забытые',         minMass: 30,  maxMass: 200,  minVol: 8,  maxVol: 45, minPrice: 20, maxPrice: 50 },
    { id: 'u2_phase_tablet',     name: 'Фазовая табличка',        nameEn: 'Phase Tablet',         race: 'Строители теней', minMass: 10,  maxMass: 80,   minVol: 3,  maxVol: 20, minPrice: 22, maxPrice: 52 },
  ],
  exotic: [
    { id: 'u2_memory_crystal',   name: 'Кристалл памяти',         nameEn: 'Memory Crystal',       race: 'Хранители эха',  minMass: 5,   maxMass: 40,   minVol: 2,  maxVol: 12, minPrice: 32, maxPrice: 62 },
    { id: 'u2_star_map',         name: 'Карта мёртвых звёзд',     nameEn: 'Dead Star Map',        race: 'Навигаторы',      minMass: 2,   maxMass: 15,   minVol: 1,  maxVol: 8,  minPrice: 30, maxPrice: 60 },
  ],
  rare: [
    { id: 'u2_prism_key',        name: 'Призматический ключ',     nameEn: 'Prismatic Key',        race: 'Архитекторы',     minMass: 8,   maxMass: 50,   minVol: 2,  maxVol: 15, minPrice: 40, maxPrice: 72 },
    { id: 'u2_soul_vessel',      name: 'Сосуд душ',               nameEn: 'Soul Vessel',          race: 'Духоводы',        minMass: 15,  maxMass: 80,   minVol: 5,  maxVol: 25, minPrice: 42, maxPrice: 75 },
  ],
  ancient: [
    { id: 'u2_time_cipher',      name: 'Шифр времени',            nameEn: 'Time Cipher',          race: 'Хронисты',        minMass: 3,   maxMass: 20,   minVol: 1,  maxVol: 8,  minPrice: 60, maxPrice: 100 },
    { id: 'u2_void_scripture',   name: 'Писание пустоты',         nameEn: 'Void Scripture',       race: 'Забытые',         minMass: 5,   maxMass: 30,   minVol: 2,  maxVol: 10, minPrice: 58, maxPrice: 95 },
  ],
  epic: [
    { id: 'u2_nexus_compass',    name: 'Компас нексуса',          nameEn: 'Nexus Compass',        race: 'Навигаторы',      minMass: 2,   maxMass: 12,   minVol: 1,  maxVol: 5,  minPrice: 80, maxPrice: 130 },
    { id: 'u2_entropy_codex',    name: 'Кодекс энтропии',         nameEn: 'Entropy Codex',        race: 'Хронисты',        minMass: 8,   maxMass: 40,   minVol: 3,  maxVol: 15, minPrice: 85, maxPrice: 135 },
  ],
  relic: [
    { id: 'u2_genesis_seal',     name: 'Печать генезиса',         nameEn: 'Genesis Seal',         race: 'Архитекторы',     minMass: 1,   maxMass: 8,    minVol: 0.5, maxVol: 4, minPrice: 120, maxPrice: 190 },
  ],
  legendary: [
    { id: 'u2_world_heart',      name: 'Сердце мира',             nameEn: 'World Heart',          race: 'Перворождённые',  minMass: 0.5, maxMass: 5,    minVol: 0.3, maxVol: 2, minPrice: 180, maxPrice: 280 },
  ],
  hybrid: [
    { id: 'u2_convergence_key',  name: 'Ключ конвергенции',       nameEn: 'Convergence Key',      race: 'Между-миры',      minMass: 0.1, maxMass: 2,    minVol: 0.1, maxVol: 1, minPrice: 260, maxPrice: 400 },
  ],
  mythical: [
    { id: 'u2_origin_fragment',  name: 'Фрагмент истока',         nameEn: 'Origin Fragment',      race: 'Неизвестно',      minMass: 0.01, maxMass: 0.5, minVol: 0.01, maxVol: 0.3, minPrice: 500, maxPrice: 750 },
  ],
  singularity: [
    { id: 'u2_omega_relic',      name: 'Реликвия Омега',          nameEn: 'Omega Relic',          race: 'За пределами',    minMass: 0.001, maxMass: 0.1, minVol: 0.001, maxVol: 0.05, minPrice: 380, maxPrice: 500 },
  ],
};

// ── Entity templates (creature analog) ──────────────────────────────────────
const ENTITY_TEMPLATES = {
  // All base prices now aligned with U1 creature templates
  common: [
    { id: 'u2_phase_moth',       name: 'Фазовый мотылёк',        nameEn: 'Phase Moth',           isIntelligent: false, minMass: 0.01,  maxMass: 0.5,  minPrice: 10, maxPrice: 30 },
    { id: 'u2_crystal_polyp',    name: 'Кристаллический полип',   nameEn: 'Crystal Polyp',        isIntelligent: false, minMass: 1,     maxMass: 10,   minPrice: 14, maxPrice: 36 },
    { id: 'u2_void_mite',        name: 'Пустотный клещ',          nameEn: 'Void Mite',            isIntelligent: false, minMass: 0.001, maxMass: 0.1,  minPrice: 18, maxPrice: 42 },
  ],
  exotic: [
    { id: 'u2_echo_serpent',     name: 'Эхо-змей',                nameEn: 'Echo Serpent',         isIntelligent: false, minMass: 5,     maxMass: 50,   minPrice: 22, maxPrice: 46 },
    { id: 'u2_mirror_jellyfish', name: 'Зеркальная медуза',       nameEn: 'Mirror Jellyfish',     isIntelligent: false, minMass: 0.5,   maxMass: 8,    minPrice: 26, maxPrice: 50 },
  ],
  rare: [
    { id: 'u2_nebula_whale',     name: 'Туманный кит',            nameEn: 'Nebula Whale',         isIntelligent: false, minMass: 100,   maxMass: 1000, minPrice: 20, maxPrice: 44 },
    { id: 'u2_crystal_spider',   name: 'Кристаллический паук',    nameEn: 'Crystal Spider',       isIntelligent: false, minMass: 10,    maxMass: 80,   minPrice: 55, maxPrice: 90 },
  ],
  ancient: [
    { id: 'u2_time_worm',        name: 'Временной червь',         nameEn: 'Time Worm',            isIntelligent: false, minMass: 50,    maxMass: 500,  minPrice: 22, maxPrice: 40 },
    { id: 'u2_shadow_stalker',   name: 'Теневой охотник',         nameEn: 'Shadow Stalker',       isIntelligent: false, minMass: 30,    maxMass: 200,  minPrice: 50, maxPrice: 85 },
  ],
  epic: [
    { id: 'u2_rift_guardian',    name: 'Страж разлома',            nameEn: 'Rift Guardian',        isIntelligent: true,  minMass: 200,   maxMass: 2000, minPrice: 115, maxPrice: 185 },
    { id: 'u2_plasma_elemental', name: 'Плазменный элементаль',   nameEn: 'Plasma Elemental',     isIntelligent: false, minMass: 0.1,   maxMass: 5,    minPrice: 45, maxPrice: 80 },
  ],
  relic: [
    { id: 'u2_ancient_sentinel', name: 'Древний дозорный',        nameEn: 'Ancient Sentinel',     isIntelligent: true,  minMass: 500,   maxMass: 5000, minPrice: 40, maxPrice: 72 },
  ],
  legendary: [
    { id: 'u2_void_leviathan',   name: 'Пустотный левиафан',      nameEn: 'Void Leviathan',       isIntelligent: false, minMass: 1000,  maxMass: 50000, minPrice: 120, maxPrice: 200 },
    { id: 'u2_mind_weaver',      name: 'Плетущий разум',          nameEn: 'Mind Weaver',          isIntelligent: true,  minMass: 5,     maxMass: 50,   minPrice: 120, maxPrice: 200 },
  ],
  hybrid: [
    { id: 'u2_paradox_being',    name: 'Парадоксальное существо',  nameEn: 'Paradox Being',        isIntelligent: true,  minMass: 0.01,  maxMass: 100000, minPrice: 45, maxPrice: 80 },
  ],
  mythical: [
    { id: 'u2_cosmic_phoenix',   name: 'Космический феникс',      nameEn: 'Cosmic Phoenix',       isIntelligent: true,  minMass: 0.001, maxMass: 1000000, minPrice: 120, maxPrice: 200 },
  ],
  singularity: [
    { id: 'u2_omega_entity',     name: 'Омега-сущность',          nameEn: 'Omega Entity',         isIntelligent: true,  minMass: 0.0001, maxMass: 100000, minPrice: 120, maxPrice: 200 },
  ],
};

// ── Rift templates (anomaly analog) ─────────────────────────────────────────
const RIFT_TEMPLATES = {
  common: [
    { id: 'u2_micro_rift',       name: 'Микроразлом',             nameEn: 'Micro Rift',           minMass: 0.01, maxMass: 1,    minVol: 0.1, maxVol: 5,   minPrice: 20, maxPrice: 45 },
    { id: 'u2_phase_pocket',     name: 'Фазовый карман',          nameEn: 'Phase Pocket',         minMass: 0.1,  maxMass: 5,    minVol: 1,   maxVol: 15,  minPrice: 18, maxPrice: 42 },
  ],
  exotic: [
    { id: 'u2_echo_anomaly',     name: 'Эхо-аномалия',            nameEn: 'Echo Anomaly',         minMass: 1,    maxMass: 20,   minVol: 2,   maxVol: 25,  minPrice: 30, maxPrice: 60 },
    { id: 'u2_gravity_knot',     name: 'Гравитационный узел',     nameEn: 'Gravity Knot',         minMass: 5,    maxMass: 50,   minVol: 5,   maxVol: 30,  minPrice: 32, maxPrice: 62 },
  ],
  rare: [
    { id: 'u2_time_bubble',      name: 'Временной пузырь',        nameEn: 'Time Bubble',          minMass: 10,   maxMass: 100,  minVol: 8,   maxVol: 40,  minPrice: 40, maxPrice: 72 },
    { id: 'u2_void_tear',        name: 'Разрыв пустоты',          nameEn: 'Void Tear',            minMass: 0.5,  maxMass: 10,   minVol: 1,   maxVol: 12,  minPrice: 38, maxPrice: 70 },
  ],
  ancient: [
    { id: 'u2_entropy_well',     name: 'Колодец энтропии',        nameEn: 'Entropy Well',         minMass: 20,   maxMass: 200,  minVol: 10,  maxVol: 50,  minPrice: 55, maxPrice: 92 },
  ],
  epic: [
    { id: 'u2_reality_crack',    name: 'Трещина реальности',      nameEn: 'Reality Crack',        minMass: 50,   maxMass: 500,  minVol: 15,  maxVol: 70,  minPrice: 78, maxPrice: 125 },
    { id: 'u2_quantum_storm',    name: 'Квантовый шторм',         nameEn: 'Quantum Storm',        minMass: 100,  maxMass: 1000, minVol: 20,  maxVol: 100, minPrice: 82, maxPrice: 130 },
  ],
  relic: [
    { id: 'u2_dimension_fold',   name: 'Складка измерений',       nameEn: 'Dimension Fold',       minMass: 5,    maxMass: 50,   minVol: 3,   maxVol: 20,  minPrice: 110, maxPrice: 175 },
  ],
  legendary: [
    { id: 'u2_wormhole_core',    name: 'Ядро червоточины',        nameEn: 'Wormhole Core',        minMass: 1,    maxMass: 15,   minVol: 0.5, maxVol: 8,   minPrice: 170, maxPrice: 270 },
  ],
  hybrid: [
    { id: 'u2_multiverse_gate',  name: 'Врата мультивселенной',   nameEn: 'Multiverse Gate',      minMass: 0.1,  maxMass: 5,    minVol: 0.1, maxVol: 3,   minPrice: 250, maxPrice: 380 },
  ],
  mythical: [
    { id: 'u2_origin_rift',      name: 'Исходный разлом',         nameEn: 'Origin Rift',          minMass: 0.01, maxMass: 1,    minVol: 0.01, maxVol: 1,  minPrice: 450, maxPrice: 680 },
  ],
  singularity: [
    { id: 'u2_omega_rift',       name: 'Омега-разлом',            nameEn: 'Omega Rift',           minMass: 0.001, maxMass: 0.1, minVol: 0.001, maxVol: 0.05, minPrice: 380, maxPrice: 500 },
  ],
};

module.exports = {
  ECHO_TEMPLATES,
  RELIC_TEMPLATES,
  ENTITY_TEMPLATES,
  RIFT_TEMPLATES,
};
