import { getLang } from './index';

const ZONE_NAMES_EN = {
  galaxy_outskirts: 'Edge of Galaxy',
  asteroid_field: 'Asteroid Field',
  abandoned_sector: 'Abandoned Sector',
  ancient_region: 'Temporal Ruins',
  anomalous_zone: 'Anomalous Zone',
};

const MODULE_NAMES = {
  scanner: { ru: 'Сканер', en: 'Scanner' },
  cargo: { ru: 'Грузовой отсек', en: 'Cargo Hold' },
  capsule: { ru: 'Капсула для существ', en: 'Creature Capsule' },
};

const STAR_UPGRADE_TEXT = {
  pirate_suppressor: {
    label: { ru: 'Подавитель пиратского сигнала', en: 'Pirate Signal Suppressor' },
    description: { ru: 'Снижает вероятность нападения пиратов на 1% за уровень', en: 'Reduces pirate attack chance by 1% per level' },
  },
  research_lab: {
    label: { ru: 'Исследовательская лаборатория', en: 'Research Laboratory' },
    description: { ru: '+10% опыта со всех находок', en: '+10% XP from all finds' },
  },
  gravity_stabilizer: {
    label: { ru: 'Гравитационный стабилизатор', en: 'Gravity Stabilizer' },
    description: { ru: 'Сокращает время каждой экспедиции на 10%', en: 'Reduces each expedition time by 10%' },
  },
  advanced_scanner: {
    label: { ru: 'Продвинутый сканирующий модуль', en: 'Advanced Scanner Module' },
    description: { ru: 'Повышает шанс Редкий +2% и Эпический +1% за уровень', en: 'Increases Rare chance by +2% and Epic by +1% per level' },
  },
};

const ACHIEVEMENTS_EN = {
  first_expedition: { name: 'First Step', description: 'Complete your first expedition' },
  explorer_10: { name: 'Explorer', description: 'Complete 10 expeditions' },
  debris_collector_5: { name: 'Scrap Collector', description: 'Find 5 space debris objects' },
  artifact_hunter: { name: 'Artifact Hunter', description: 'Find 3 artifacts' },
  creature_tamer: { name: 'Tamer', description: 'Find 3 creatures' },
  anomaly_specialist: { name: 'Anomaly Specialist', description: 'Find 2 anomalies' },
  first_legendary: { name: 'Legend', description: 'Find a legendary object' },
  first_mythical: { name: 'Mythic Seeker', description: 'Find a mythical object' },
  rich_100k: { name: 'Wealthy', description: 'Accumulate 100,000 credits' },
  level_5: { name: 'Experienced Pilot', description: 'Reach level 5' },
  level_10: { name: 'Veteran', description: 'Reach level 10' },
  level_20: { name: 'Galaxy Legend', description: 'Reach level 20' },
  u2_echo_hunter: { name: 'Echo Hunter', description: 'Find 10 Echo objects in Universe II' },
  u2_rift_walker: { name: 'Rift Walker', description: 'Find 5 rifts in Universe II' },
  project_supporter: { name: 'Guardian of the Galaxy', description: 'For supporting the StarLoot project' },
  full_collection: { name: 'Galactic Collector', description: 'Collect all 42 unique items of the galaxy' },
};

const TEMPLATE_NAME_EN = {
  hull_fragment: 'Hull Fragment',
  broken_arm: 'Broken Manipulator Arm',
  empty_fuel_tank: 'Empty Fuel Tank',
  nav_module: 'Navigation Module',
  engine_section: 'Engine Section',
  cargo_container: 'Cargo Container',
  military_drone: 'Military Drone (Inactive)',
  reactor_block: 'Reactor Block',
  cryo_chamber: 'Cryo Chamber',
  ai_core: 'AI Core (Damaged)',
  warp_coil: 'Warp Coil Prototype',
  singularity_gen: 'Singularity Generator',
  colony_relic: 'Old Colony Relic',
  broken_mechanoid: 'Broken Mechanoid',
  keiron_trade: 'Keiron Trade Mark',
  valtar_weapon: 'Valtar Empire Weapon',
  builder_relic: 'Ancient Builders Artifact',
  oro_biotech: 'Oro Symbiont Biotech',
  precursor_relic: 'Precursor Relic',
  unknown_x: 'Class X Object',
  space_plankton: 'Space Plankton',
  vacuum_jellyfish: 'Vacuum Jellyfish',
  dust_worm: 'Dust Worm',
  star_crab: 'Star Crab',
  ice_leviathan_s: 'Ice Leviathan (Juvenile)',
  crystal_swarm: 'Crystal Swarm',
  shadow_predator: 'Shadow Predator',
  kelo_shroom: 'Kelo Sentient Fungus',
  plasma_dragon: 'Plasma Dragon',
  ice_leviathan_a: 'Ice Leviathan (Adult)',
  ancient_guardian: 'Ancient Guardian',
  quantum_mimic: 'Quantum Mimic',
  living_star: 'Living Star (Fragment)',
  grav_lens: 'Gravitational Lens',
  mag_storm: 'Magnetic Storm (Sample)',
  time_bubble: 'Time Bubble',
  antigrav_pocket: 'Antigravity Pocket',
  space_fold: 'Space Fold',
  chrono_crystal: 'Chrono Crystal',
  mini_blackhole: 'Mini Black Hole',
  blocked_portal: 'Blocked Portal',
  consciousness_singularity: 'Consciousness Singularity',
};

const RUSSIAN_NAME_EN = {
  'Обломок обшивки': 'Hull Fragment',
  'Сломанный манипулятор': 'Broken Manipulator Arm',
  'Топливный бак (пустой)': 'Empty Fuel Tank',
  'Навигационный модуль': 'Navigation Module',
  'Двигательная секция': 'Engine Section',
  'Грузовой контейнер': 'Cargo Container',
  'Военный дрон (нерабочий)': 'Military Drone (Inactive)',
  'Блок реактора': 'Reactor Block',
  'Криокамера': 'Cryo Chamber',
  'ИИ-ядро (повреждённое)': 'AI Core (Damaged)',
  'Прототип варп-катушки': 'Warp Coil Prototype',
  'Сингулярный генератор': 'Singularity Generator',
  'Реликвия старой колонии': 'Old Colony Relic',
  'Сломанный механоид': 'Broken Mechanoid',
  'Торговый знак Кейрон': 'Keiron Trade Mark',
  'Оружие Империи Валтар': 'Valtar Empire Weapon',
  'Артефакт Древних Строителей': 'Ancient Builders Artifact',
  'Биотехнология Симбионтов Оро': 'Oro Symbiont Biotech',
  'Реликвия Предтеч': 'Precursor Relic',
  'Объект класса X': 'Class X Object',
  'Космический планктон': 'Space Plankton',
  'Вакуумная медуза': 'Vacuum Jellyfish',
  'Космическая медуза': 'Vacuum Jellyfish',
  'Пылевой червь': 'Dust Worm',
  'Звёздный краб': 'Star Crab',
  'Ледяной левиафан (малый)': 'Ice Leviathan (Juvenile)',
  'Кристаллический рой': 'Crystal Swarm',
  'Кристальный страж': 'Crystal Guardian',
  'Кристаллический страж': 'Crystal Guardian',
  'Теневой хищник': 'Shadow Predator',
  'Разумный гриб Кело': 'Kelo Sentient Fungus',
  'Плазменный дракон': 'Plasma Dragon',
  'Пустотный кит': 'Void Whale',
  'Ледяной левиафан (взрослый)': 'Ice Leviathan (Adult)',
  'Древний страж': 'Ancient Guardian',
  'Квантовый мимик': 'Quantum Mimic',
  'Живая звезда (фрагмент)': 'Living Star (Fragment)',
  'Гравитационная линза': 'Gravitational Lens',
  'Магнитный шторм (образец)': 'Magnetic Storm (Sample)',
  'Временной пузырь': 'Time Bubble',
  'Антигравитационный карман': 'Antigravity Pocket',
  'Складка пространства': 'Space Fold',
  'Хроно-кристалл': 'Chrono Crystal',
  'Мини-чёрная дыра': 'Mini Black Hole',
  'Портал (заблокированный)': 'Blocked Portal',
  'Сингулярность сознания': 'Consciousness Singularity',
};

const RESOURCE_EN = {
  iron: 'Iron',
  nickel: 'Nickel',
  silicate: 'Silicates',
  titanium: 'Titanium',
  cobalt: 'Cobalt',
  rare_earth: 'Rare Earth Elements',
  iridium: 'Iridium',
  platinum: 'Platinum',
  antimatter: 'Antimatter',
};

const RESOURCE_BY_RU = {
  'Железо': 'Iron',
  'Никель': 'Nickel',
  'Силикаты': 'Silicates',
  'Силикат': 'Silicate',
  'Титан': 'Titanium',
  'Кобальт': 'Cobalt',
  'Редкоземельные': 'Rare Earth Elements',
  'Иридий': 'Iridium',
  'Платина': 'Platinum',
  'Антиматерия': 'Antimatter',
};

const CIVILIZATION_EN = {
  'Люди (старая колония)': 'Humans (Old Colony)',
  'Механоиды': 'Mechanoids',
  'Торговцы Кейрон': 'Keiron Traders',
  'Империя Валтар': 'Valtar Empire',
  'Древние Строители': 'Ancient Builders',
  'Симбионты Оро': 'Oro Symbionts',
  'Предтечи': 'Precursors',
  'Неизвестная раса X': 'Unknown Race X',
};

export function isEnglish() {
  return getLang() === 'en';
}

export function localizeZoneName(zone) {
  if (!zone) return '';
  if (!isEnglish()) return zone.name;
  return zone.nameEn || ZONE_NAMES_EN[zone.id] || zone.name;
}

export function localizeModuleName(type, fallback) {
  const entry = MODULE_NAMES[type];
  if (!entry) return fallback || type;
  return isEnglish() ? entry.en : entry.ru;
}

export function localizeStarUpgradeLabel(def) {
  const key = def?.id;
  const entry = STAR_UPGRADE_TEXT[key];
  if (!entry) return def?.label || key;
  return isEnglish() ? entry.label.en : entry.label.ru;
}

export function localizeStarUpgradeDescription(def) {
  const key = def?.id;
  const entry = STAR_UPGRADE_TEXT[key];
  if (!entry) return def?.description || '';
  return isEnglish() ? entry.description.en : entry.description.ru;
}

export function localizeAchievement(achievement) {
  if (!achievement || !isEnglish()) return achievement;
  const tr = ACHIEVEMENTS_EN[achievement.id];
  if (!tr) return achievement;
  return { ...achievement, name: tr.name, description: tr.description };
}

export function localizeItemName({ objectData, templateId, fallback }) {
  if (!objectData) return fallback || '';
  if (!isEnglish()) return objectData.name || fallback || '';

  if (objectData.nameEn) return objectData.nameEn;

  if (templateId && TEMPLATE_NAME_EN[templateId]) {
    return TEMPLATE_NAME_EN[templateId];
  }

  if (objectData.templateId && TEMPLATE_NAME_EN[objectData.templateId]) {
    return TEMPLATE_NAME_EN[objectData.templateId];
  }

  if (objectData.templateId === 'nft_container') return 'NFT Container';

  if (objectData.templateId === 'asteroid' && typeof objectData.name === 'string') {
    return objectData.name.replace(/^Астероид\s+/i, 'Asteroid ');
  }

  if (typeof objectData.name === 'string' && RUSSIAN_NAME_EN[objectData.name]) {
    return RUSSIAN_NAME_EN[objectData.name];
  }

  return objectData.name || fallback || '';
}

export function localizeResourceName(resourceName, resourceType) {
  if (!isEnglish()) return resourceName || '';
  if (resourceType && RESOURCE_EN[resourceType]) return RESOURCE_EN[resourceType];
  if (resourceName && RESOURCE_BY_RU[resourceName]) return RESOURCE_BY_RU[resourceName];
  return resourceName || '';
}

export function localizeCivilizationName(civilization) {
  if (!isEnglish()) return civilization || '';
  return CIVILIZATION_EN[civilization] || civilization || '';
}

export function localizeStatsObjectName(name, templateId) {
  if (!isEnglish()) return name || '';
  if (templateId && TEMPLATE_NAME_EN[templateId]) return TEMPLATE_NAME_EN[templateId];
  if (name && RUSSIAN_NAME_EN[name]) return RUSSIAN_NAME_EN[name];
  return name || '';
}
