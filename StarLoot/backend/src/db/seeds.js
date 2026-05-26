'use strict';

const { query } = require('./pool');
const logger = require('../utils/logger');

const ACHIEVEMENT_DEFS = [
  {
    id: 'first_expedition',
    name: 'Первый шаг',
    description: 'Завершите первую экспедицию',
    icon: '🚀',
    reward_credits: 100,
    reward_xp: 20,
    conditions: { type: 'expedition_count', count: 1 },
  },
  {
    id: 'explorer_10',
    name: 'Исследователь',
    description: 'Завершите 10 экспедиций',
    icon: '🔭',
    reward_credits: 500,
    reward_xp: 100,
    conditions: { type: 'expedition_count', count: 10 },
  },
  {
    id: 'debris_collector_5',
    name: 'Сборщик мусора',
    description: 'Найдите 5 объектов космического мусора',
    icon: '🔩',
    reward_credits: 200,
    reward_xp: 40,
    conditions: { type: 'find_count', find_type: 'debris', count: 5 },
  },
  {
    id: 'artifact_hunter',
    name: 'Охотник за артефактами',
    description: 'Найдите 3 артефакта',
    icon: '💎',
    reward_credits: 400,
    reward_xp: 80,
    conditions: { type: 'find_count', find_type: 'artifact', count: 3 },
  },
  {
    id: 'creature_tamer',
    name: 'Укротитель',
    description: 'Найдите 3 существа',
    icon: '🐾',
    reward_credits: 400,
    reward_xp: 80,
    conditions: { type: 'find_count', find_type: 'creature', count: 3 },
  },
  {
    id: 'anomaly_specialist',
    name: 'Специалист по аномалиям',
    description: 'Найдите 2 аномалии',
    icon: '🌀',
    reward_credits: 600,
    reward_xp: 120,
    conditions: { type: 'find_count', find_type: 'anomaly', count: 2 },
  },
  {
    id: 'first_legendary',
    name: 'Легенда',
    description: 'Найдите легендарный объект',
    icon: '🟡',
    reward_credits: 1000,
    reward_xp: 200,
    conditions: { type: 'rarity_find', rarity: 'legendary', count: 1 },
  },
  {
    id: 'first_mythical',
    name: 'Мифический искатель',
    description: 'Найдите мифический объект',
    icon: '🔴',
    reward_credits: 5000,
    reward_xp: 1000,
    conditions: { type: 'rarity_find', rarity: 'mythical', count: 1 },
  },
  {
    id: 'rich_100k',
    name: 'Состоятельный',
    description: 'Накопите 100 000 кредитов',
    icon: '🪙',
    reward_credits: 2000,
    reward_xp: 500,
    conditions: { type: 'credits_total', amount: 100000 },
  },
  {
    id: 'level_5',
    name: 'Опытный пилот',
    description: 'Достигните 5 уровня',
    icon: '🛸',
    reward_credits: 500,
    reward_xp: 0,
    conditions: { type: 'level', level: 5 },
  },
  {
    id: 'level_10',
    name: 'Ветеран',
    description: 'Достигните 10 уровня',
    icon: '🎖️',
    reward_credits: 2000,
    reward_xp: 0,
    conditions: { type: 'level', level: 10 },
  },
  {
    id: 'level_20',
    name: 'Легенда галактики',
    description: 'Достигните 20 уровня',
    icon: '👑',
    reward_credits: 10000,
    reward_xp: 0,
    conditions: { type: 'level', level: 20 },
  },
  {
    id: 'u2_echo_hunter',
    name: 'Охотник за Эхо',
    description: 'Найдите 10 объектов типа Эхо во Вселенной II',
    icon: '〰️',
    reward_credits: 2500,
    reward_xp: 450,
    conditions: { type: 'find_count', find_type: 'echo', count: 10 },
  },
  {
    id: 'u2_rift_walker',
    name: 'Странник Разломов',
    description: 'Найдите 5 разломов во Вселенной II',
    icon: '🌌',
    reward_credits: 3500,
    reward_xp: 650,
    conditions: { type: 'find_count', find_type: 'rift', count: 5 },
  },

  // ── Hidden prestige achievements ─────────────────────────────────────────
  {
    id: 'prestige_1',
    name: 'Первый Горизонт',
    description: 'Достичь первого уровня престижа',
    icon: 'Ⅰ',
    reward_credits: 0,
    reward_xp: 0,
    is_hidden: true,
    conditions: { type: 'prestige', level: 1 },
  },
  {
    id: 'prestige_2',
    name: 'Второй Горизонт',
    description: 'Достичь второго уровня престижа',
    icon: 'Ⅱ',
    reward_credits: 0,
    reward_xp: 0,
    is_hidden: true,
    conditions: { type: 'prestige', level: 2 },
  },
  {
    id: 'prestige_3',
    name: 'Третий Горизонт',
    description: 'Достичь третьего уровня престижа',
    icon: 'Ⅲ',
    reward_credits: 0,
    reward_xp: 0,
    is_hidden: true,
    conditions: { type: 'prestige', level: 3 },
  },
];

/**
 * Upsert achievement definitions using Node.js strings (always correct UTF-8).
 * Fixes encoding issues that occur when SQL is run from terminals with wrong locale.
 */
async function seedAchievements() {
  for (const def of ACHIEVEMENT_DEFS) {
    await query(
      `INSERT INTO achievement_definitions (id, name, description, icon, reward_credits, reward_xp, conditions, is_hidden)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET
         name        = EXCLUDED.name,
         description = EXCLUDED.description,
         icon        = EXCLUDED.icon,
         conditions  = EXCLUDED.conditions,
         is_hidden   = EXCLUDED.is_hidden`,
      [def.id, def.name, def.description, def.icon,
       def.reward_credits, def.reward_xp, JSON.stringify(def.conditions),
       def.is_hidden ?? false]
    );
  }
  logger.info('Achievement definitions seeded OK');
}

// ─── Drill types ──────────────────────────────────────────────────────────
const DRILL_TYPES = [
  { id: 'standard_drill',   name: 'Стандартный бур',  name_en: 'Standard Drill',   base_yield: 1,  cycle: 900,  storage: 400, fossil: 0.020, cost_credits: 2000, cost_stars: null, icon: '⛏️' },
  { id: 'deep_core_drill',  name: 'Глубинный бур',    name_en: 'Deep Core Drill',  base_yield: 2,  cycle: 900,  storage: 400, fossil: 0.005, cost_credits: 8000, cost_stars: null, icon: '🔨' },
  { id: 'precision_drill',  name: 'Точный бур',       name_en: 'Precision Drill',  base_yield: 1,  cycle: 1800, storage: 400, fossil: 0.080, cost_credits: null, cost_stars: 15,  icon: '🔬' },
];

// ─── Collectible templates ────────────────────────────────────────────────
const COLLECTIBLE_TEMPLATES = [
  // Common
  { id: 'iron_fragment',      name: 'Осколок железа',       name_en: 'Iron Fragment',       rarity: 'common',    sell_price: 10, icon: '🪨', desc: 'Обычный кусок космического железа', desc_en: 'A common chunk of space iron' },
  { id: 'dust_crystal',       name: 'Пылевой кристалл',     name_en: 'Dust Crystal',        rarity: 'common',    sell_price: 12, icon: '💎', desc: 'Мутный кристалл из пыли', desc_en: 'A cloudy crystal formed from dust' },
  { id: 'meteor_pebble',      name: 'Метеоритная галька',    name_en: 'Meteor Pebble',       rarity: 'common',    sell_price: 10, icon: '🪨', desc: 'Мелкий обломок метеорита', desc_en: 'A small meteorite fragment' },
  { id: 'space_sediment',     name: 'Космический осадок',    name_en: 'Space Sediment',      rarity: 'common',    sell_price: 11, icon: '🧱', desc: 'Спрессованный космический осадок', desc_en: 'Compressed space sediment' },
  // Rare
  { id: 'fossil_coral',       name: 'Ископаемый коралл',     name_en: 'Fossil Coral',        rarity: 'rare',      sell_price: 18, icon: '🪸', desc: 'Окаменевший космический коралл', desc_en: 'Petrified space coral' },
  { id: 'ancient_shell',      name: 'Древняя раковина',      name_en: 'Ancient Shell',       rarity: 'rare',      sell_price: 20, icon: '🐚', desc: 'Раковина неизвестного существа', desc_en: 'Shell of an unknown creature' },
  { id: 'void_amber',         name: 'Янтарь пустоты',        name_en: 'Void Amber',          rarity: 'rare',      sell_price: 22, icon: '🟠', desc: 'Застывшая энергия пустоты', desc_en: 'Solidified void energy' },
  { id: 'stellar_imprint',    name: 'Звёздный отпечаток',    name_en: 'Stellar Imprint',     rarity: 'rare',      sell_price: 19, icon: '⭐', desc: 'Отпечаток звёздного излучения', desc_en: 'Imprint of stellar radiation' },
  // Epic
  { id: 'crystal_bone',       name: 'Кристаллическая кость', name_en: 'Crystal Bone',        rarity: 'epic',      sell_price: 28, icon: '🦴', desc: 'Окаменевшая кость с кристаллами', desc_en: 'Fossilized bone with crystal growths' },
  { id: 'nebula_pearl',       name: 'Жемчужина туманности',  name_en: 'Nebula Pearl',        rarity: 'epic',      sell_price: 30, icon: '🫧', desc: 'Сформировалась в глубине туманности', desc_en: 'Formed deep inside a nebula' },
  { id: 'gravity_fossil',     name: 'Гравитационный фоссил', name_en: 'Gravity Fossil',      rarity: 'epic',      sell_price: 32, icon: '🌀', desc: 'Следы искажённого гравитационного поля', desc_en: 'Traces of a distorted gravity field' },
  // Legendary
  { id: 'chrono_shard',       name: 'Осколок времени',       name_en: 'Chrono Shard',        rarity: 'legendary', sell_price: 40, icon: '⏳', desc: 'Фрагмент застывшего времени', desc_en: 'A fragment of frozen time' },
  { id: 'plasma_fossil',      name: 'Плазменный фоссил',     name_en: 'Plasma Fossil',       rarity: 'legendary', sell_price: 42, icon: '🔥', desc: 'Окаменевшая плазма древней звезды', desc_en: 'Petrified plasma of an ancient star' },
  // Mythical
  { id: 'singularity_echo',   name: 'Эхо сингулярности',     name_en: 'Singularity Echo',    rarity: 'mythical',  sell_price: 50, icon: '🕳️', desc: 'Отголосок начала вселенной', desc_en: 'An echo from the birth of the universe' },
];

// ─── Collections ──────────────────────────────────────────────────────────
const COLLECTIONS = [
  {
    id: 'asteroid_fossils',
    name: 'Астероидные окаменелости', name_en: 'Asteroid Fossils',
    desc: 'Древние окаменелости из пояса астероидов', desc_en: 'Ancient fossils from the asteroid belt',
    reward_credits: 2000, reward_xp: 500, icon: '🪨',
    items: [
      { collectible_id: 'fossil_coral', quantity: 5 },
      { collectible_id: 'ancient_shell', quantity: 3 },
      { collectible_id: 'crystal_bone', quantity: 2 },
    ],
  },
  {
    id: 'stellar_minerals',
    name: 'Звёздные минералы', name_en: 'Stellar Minerals',
    desc: 'Редкие минералы звёздного происхождения', desc_en: 'Rare minerals of stellar origin',
    reward_credits: 1500, reward_xp: 300, icon: '💎',
    items: [
      { collectible_id: 'dust_crystal', quantity: 6 },
      { collectible_id: 'void_amber', quantity: 3 },
      { collectible_id: 'nebula_pearl', quantity: 1 },
    ],
  },
  {
    id: 'cosmic_traces',
    name: 'Космические следы', name_en: 'Cosmic Traces',
    desc: 'Следы древних космических явлений', desc_en: 'Traces of ancient cosmic phenomena',
    reward_credits: 3000, reward_xp: 800, icon: '🌀',
    items: [
      { collectible_id: 'stellar_imprint', quantity: 4 },
      { collectible_id: 'gravity_fossil', quantity: 2 },
      { collectible_id: 'chrono_shard', quantity: 1 },
    ],
  },
  {
    id: 'primordial_relics',
    name: 'Первозданные реликвии', name_en: 'Primordial Relics',
    desc: 'Реликвии рождения вселенной', desc_en: 'Relics from the birth of the universe',
    reward_credits: 5000, reward_xp: 1500, icon: '🕳️',
    items: [
      { collectible_id: 'plasma_fossil', quantity: 2 },
      { collectible_id: 'singularity_echo', quantity: 1 },
      { collectible_id: 'chrono_shard', quantity: 2 },
    ],
  },
];

async function seedDrillsAndCollectibles() {
  // Seed drill types
  for (const d of DRILL_TYPES) {
    await query(
      `INSERT INTO drill_types (id, name, name_en, base_yield_per_cycle, cycle_duration_seconds, base_storage_limit, base_fossil_chance, cost_credits, cost_stars, icon)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name, name_en = EXCLUDED.name_en,
         base_yield_per_cycle = EXCLUDED.base_yield_per_cycle,
         cycle_duration_seconds = EXCLUDED.cycle_duration_seconds,
         base_storage_limit = EXCLUDED.base_storage_limit,
         base_fossil_chance = EXCLUDED.base_fossil_chance,
         cost_credits = EXCLUDED.cost_credits, cost_stars = EXCLUDED.cost_stars,
         icon = EXCLUDED.icon`,
      [d.id, d.name, d.name_en, d.base_yield, d.cycle, d.storage, d.fossil, d.cost_credits, d.cost_stars, d.icon]
    );
  }

  // Seed collectible templates
  for (const c of COLLECTIBLE_TEMPLATES) {
    await query(
      `INSERT INTO collectible_templates (id, name, name_en, rarity, sell_price, icon, description, description_en)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name, name_en = EXCLUDED.name_en,
         rarity = EXCLUDED.rarity, sell_price = EXCLUDED.sell_price,
         icon = EXCLUDED.icon, description = EXCLUDED.description,
         description_en = EXCLUDED.description_en`,
      [c.id, c.name, c.name_en, c.rarity, c.sell_price, c.icon, c.desc, c.desc_en]
    );
  }

  // Seed collections
  for (const col of COLLECTIONS) {
    await query(
      `INSERT INTO collections (id, name, name_en, description, description_en, reward_credits, reward_xp, icon)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name, name_en = EXCLUDED.name_en,
         description = EXCLUDED.description, description_en = EXCLUDED.description_en,
         reward_credits = EXCLUDED.reward_credits, reward_xp = EXCLUDED.reward_xp,
         icon = EXCLUDED.icon`,
      [col.id, col.name, col.name_en, col.desc, col.desc_en, col.reward_credits, col.reward_xp, col.icon]
    );
    // Seed collection requirements
    for (const item of col.items) {
      await query(
        `INSERT INTO collection_requirements (collection_id, collectible_id, quantity)
         VALUES ($1, $2, $3)
         ON CONFLICT (collection_id, collectible_id) DO UPDATE SET quantity = EXCLUDED.quantity`,
        [col.id, item.collectible_id, item.quantity]
      );
    }
  }

  logger.info('Drills, collectibles & collections seeded OK');
}

module.exports = { seedAchievements, seedDrillsAndCollectibles };
