#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { Pool } = require('pg');

const CONFIG_FILE = path.join(__dirname, 'config.json');
const GAME_CONFIG_FILE = path.join(__dirname, '..', 'backend', 'src', 'config', 'gameConfig.js');
const FindGeneratorService = require('../backend/src/services/findGeneratorService');

const RARITY_KEYS = ['common', 'rare', 'epic', 'legendary', 'mythical'];
const TYPE_LABELS = {
  asteroid: 'Астероид',
  debris: 'Мусор',
  artifact: 'Артефакт',
  creature: 'Существо',
  anomaly: 'Аномалия',
  nft_container: 'NFT-контейнер',
};

function loadAdminConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return { connectionString: '' };
  }
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepMerge(base, override) {
  if (Array.isArray(base) || Array.isArray(override)) return deepClone(override);
  const out = { ...base };
  for (const [k, v] of Object.entries(override || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) {
      out[k] = deepMerge(out[k], v);
    } else {
      out[k] = deepClone(v);
    }
  }
  return out;
}

function setNestedKey(obj, dotPath, value) {
  const parts = String(dotPath || '').split('.').filter(Boolean);
  if (!parts.length) return;
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (!cur[p] || typeof cur[p] !== 'object' || Array.isArray(cur[p])) cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
}

async function loadConfigWithOverrides() {
  delete require.cache[require.resolve(GAME_CONFIG_FILE)];
  const defaults = require(GAME_CONFIG_FILE);
  const merged = deepClone(defaults);

  const { connectionString } = loadAdminConfig();
  if (!connectionString) {
    return { config: merged, dbOverridesCount: 0, dbConnected: false };
  }

  let pool;
  try {
    pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
      max: 2,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 10000,
    });
    let rows;
    try {
      const res = await pool.query('SELECT key, value FROM game_config WHERE is_active = true');
      rows = res.rows;
    } catch {
      await pool.end();
      pool = new Pool({ connectionString, ssl: false, max: 2, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000 });
      const res = await pool.query('SELECT key, value FROM game_config WHERE is_active = true');
      rows = res.rows;
    }

    const overrides = {};
    for (const row of rows) {
      try {
        setNestedKey(overrides, row.key, JSON.parse(row.value));
      } catch {
        continue;
      }
    }
    const finalConfig = deepMerge(merged, overrides);
    return { config: finalConfig, dbOverridesCount: rows.length, dbConnected: true };
  } catch {
    return { config: merged, dbOverridesCount: 0, dbConnected: false };
  } finally {
    if (pool) await pool.end().catch(() => {});
  }
}

function eventFilterForZone(effects, zoneId) {
  return (effects || []).filter((e) => e && (e.zones == null || (Array.isArray(e.zones) && e.zones.includes(zoneId))));
}

function pickSignalAmpBuff(config, mode) {
  if (mode === 'none') return null;
  if (mode === 'custom') return { metadata: { rarityBonus: 0.12 } };

  const items = config.shopItems || {};
  const idByMode = {
    basic: 'signal_amplifier_basic',
    advanced: 'signal_amplifier_advanced',
    star: 'signal_amplifier_star',
  };
  const item = items[idByMode[mode]];
  if (!item) return null;
  return { metadata: { rarityBonus: Number(item.metadata?.rarityBonus) || 0.05 } };
}

function calcSellPriceLikeGame(findResult, config) {
  const rarityMult = Number(config?.rarity?.[findResult.rarity]?.priceMultiplier || 1);
  if (findResult.findType === 'asteroid') {
    if (!findResult.objectData?.scanned) return 125;
    return Math.max(0, Math.round(Number(findResult.baseCredits || 0) * 0.2));
  }
  return Math.max(0, Math.round(Number(findResult.baseCredits || 0) * rarityMult));
}

function num(n) {
  return Number(n || 0).toLocaleString('ru-RU');
}

function pct(n, t) {
  if (!t) return '0.0000%';
  return `${((n / t) * 100).toFixed(4)}%`;
}

function bar(n, t, w = 18) {
  const f = t > 0 ? Math.round((n / t) * w) : 0;
  return '█'.repeat(f) + '░'.repeat(Math.max(0, w - f));
}

function pad(label, width = 14) {
  const s = String(label || '');
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

function printWeightsPreview(config, zone, scannerCfg, buffs, eventEffects, pirateChance) {
  const findTypes = config.findTypes || {};
  const rarityCfg = config.rarity || {};

  const typeWeights = {};
  const zoneEffects = eventFilterForZone(eventEffects, zone.id);
  const cartographerTarget = buffs.cartographer?.metadata?.targetType;

  for (const [type, cfg] of Object.entries(findTypes)) {
    let w = Number(cfg.weight || 0) * Number(zone.findTypeModifiers?.[type] || 1.0);
    for (const e of zoneEffects) {
      if (e.type === 'spawn_rate' && (e.findType === type || e.findType == null)) {
        w *= Number(e.multiplier || 1.0);
      }
    }
    if (cartographerTarget && cartographerTarget === type) w *= 2.0;
    typeWeights[type] = Math.max(0, w);
  }

  const rarityWeights = {};
  const totalMultiplier = Number(zone.rarityMultiplier || 1) * Number(scannerCfg.rarityMultiplier || 1);
  for (const [key, cfg] of Object.entries(rarityCfg)) {
    let w = Number(cfg.weight || 0);
    if (key !== 'common') w *= totalMultiplier;
    if (buffs.quantum_locator && (key === 'legendary' || key === 'mythical')) w *= 1.5;
    rarityWeights[key] = Math.max(0, w);
  }

  if (buffs.signal_amplifier) {
    const rarityBonus = Number(buffs.signal_amplifier.metadata?.rarityBonus || 0.05);
    const reduction = rarityWeights.common * rarityBonus;
    rarityWeights.common -= reduction;
    const nonCommonTotal = RARITY_KEYS.filter((k) => k !== 'common').reduce((s, k) => s + (rarityWeights[k] || 0), 0);
    if (nonCommonTotal > 0) {
      for (const k of RARITY_KEYS) {
        if (k === 'common') continue;
        rarityWeights[k] += reduction * ((rarityWeights[k] || 0) / nonCommonTotal);
      }
    }
  }

  for (const e of zoneEffects) {
    if (e.type === 'rarity_bonus') {
      if (e.rarity == null) {
        for (const k of RARITY_KEYS) if (k !== 'common') rarityWeights[k] *= Number(e.multiplier || 1.0);
      } else if (rarityWeights[e.rarity] != null) {
        rarityWeights[e.rarity] *= Number(e.multiplier || 1.0);
      }
    }
    if (e.type === 'common_reduction') {
      const reduction = rarityWeights.common * Math.min(Number(e.reduction || 0), 0.95);
      rarityWeights.common -= reduction;
      const nonCommonTotal = RARITY_KEYS.filter((k) => k !== 'common').reduce((s, k) => s + (rarityWeights[k] || 0), 0);
      if (nonCommonTotal > 0) {
        for (const k of RARITY_KEYS) {
          if (k === 'common') continue;
          rarityWeights[k] += reduction * ((rarityWeights[k] || 0) / nonCommonTotal);
        }
      }
    }
  }

  const typeTotal = Object.values(typeWeights).reduce((s, v) => s + v, 0) || 1;
  const rarityTotal = Object.values(rarityWeights).reduce((s, v) => s + v, 0) || 1;

  console.log('\n  ТЕОРЕТИЧЕСКИЕ ШАНСЫ (до RNG):');
  console.log('  ' + '─'.repeat(62));
  console.log(`  NFT шанс:        ${(Number(config?.nft?.containerChance || 0) * 100).toFixed(4)}%`);
  console.log(`  Пираты (после NFT): ${(pirateChance * 100).toFixed(4)}%`);
  console.log('  Типы (при non-NFT/non-pirate):');
  for (const [type, w] of Object.entries(typeWeights)) {
    console.log(`    ${pad(TYPE_LABELS[type] || type)} ${(100 * w / typeTotal).toFixed(4)}%`);
  }
  console.log('  Редкость (до скрытия астероидов сканером):');
  for (const k of RARITY_KEYS) {
    console.log(`    ${pad(config.rarity?.[k]?.label || k)} ${(100 * (rarityWeights[k] || 0) / rarityTotal).toFixed(4)}%`);
  }
}

async function simulate(iters, zone, opts, config, generator) {
  const findTypes = config.findTypes || {};
  const rarityCfg = config.rarity || {};

  const s = {
    zone: zone.name,
    total: iters,
    pirateEncounters: 0,
    pirateWins: 0,
    pirateLosses: 0,
    nftContainers: 0,
    hiddenAsteroids: 0,
    findTypes: Object.fromEntries([...Object.keys(findTypes), 'nft_container'].map((k) => [k, 0])),
    rarities: Object.fromEntries(RARITY_KEYS.map((k) => [k, 0])),
    totalCredits: 0,
    totalXP: 0,
    best: { price: 0, rarity: '', type: '' },
  };

  const scannerCfg = config.modules?.scanner?.levels?.[opts.scannerLevel] || { level: 0, rarityMultiplier: 1.0 };
  const pirateChance = opts.stealth ? 0 : Math.max(0, Number(config?.pirates?.chance || 0));

  const buffsMap = {};
  const signalBuff = pickSignalAmpBuff(config, opts.signalAmpMode);
  if (signalBuff) buffsMap.signal_amplifier = signalBuff;
  if (opts.quantumLocator) buffsMap.quantum_locator = { metadata: {} };
  if (opts.stealth) buffsMap.stealth_module = { metadata: {} };
  if (opts.insurance) buffsMap.insurance_policy = { metadata: {} };
  if (opts.cartographerType && findTypes[opts.cartographerType]) {
    buffsMap.cartographer = { metadata: { targetType: opts.cartographerType } };
  }

  const eventEffects = opts.eventEffects;

  for (let i = 0; i < iters; i++) {
    const serverSeed = `${Date.now()}_${Math.random().toString(36).slice(2)}_${i}`;
    const clientSeed = `sim_${i}`;

    let find = await generator.generate(serverSeed, clientSeed, zone, scannerCfg, buffsMap, null, eventEffects);

    // Insurance policy reroll logic (as in expeditionService): only for common non-NFT.
    if (opts.insurance && find.rarity === 'common' && find.findType !== 'nft_container') {
      const rerollFind = await generator.generate(`${serverSeed}_reroll`, clientSeed, zone, scannerCfg, { ...buffsMap, insurance_policy: undefined }, null, eventEffects);
      if (rerollFind && rerollFind.findType !== 'nft_container') {
        const origRank = RARITY_KEYS.indexOf(find.rarity);
        const rerollRank = RARITY_KEYS.indexOf(rerollFind.rarity);
        if (rerollRank > origRank || (rerollRank === origRank && Number(rerollFind.baseCredits || 0) > Number(find.baseCredits || 0))) {
          find = rerollFind;
        }
      }
    }

    if (find.findType === 'nft_container') {
      s.nftContainers++;
      s.findTypes.nft_container++;
      s.totalXP += Number(find.baseXP || 0);
      continue;
    }

    if (Math.random() < pirateChance) {
      s.pirateEncounters++;
      if (Math.random() < Number(config?.pirates?.fightWinChance || 0.5)) {
        s.pirateWins++;
      } else {
        s.pirateLosses++;
        continue;
      }
    }

    const sell = calcSellPriceLikeGame(find, config);

    s.findTypes[find.findType] = (s.findTypes[find.findType] || 0) + 1;
    s.rarities[find.rarity] = (s.rarities[find.rarity] || 0) + 1;
    s.totalCredits += sell;
    s.totalXP += Number(find.baseXP || 0);

    if (find.findType === 'asteroid' && !find.objectData?.scanned) s.hiddenAsteroids++;

    if (sell > s.best.price) {
      s.best = { price: sell, rarity: find.rarity, type: find.findType };
    }
  }

  return { stats: s, scannerCfg, pirateChance, buffsMap };
}

function print(stats, opts, config, scannerCfg, pirateChance, buffsMap) {
  const s = stats;
  const W = 70;
  const ln = '═'.repeat(W);
  const sep = '─'.repeat(W);

  console.log('\n' + ln);
  console.log(`  🚀 StarLoot — ${s.zone} (${num(s.total)} экспедиций)`);

  const active = [];
  active.push(`🔬 Сканер ${scannerCfg.level || 0} ур.`);
  if (buffsMap.signal_amplifier) active.push(`📡 Усилитель +${Math.round((Number(buffsMap.signal_amplifier.metadata?.rarityBonus || 0)) * 100)}%`);
  if (opts.quantumLocator) active.push('🔭 Квантовый локатор');
  if (opts.cartographerType) active.push(`🗺️ Картограф: ${TYPE_LABELS[opts.cartographerType] || opts.cartographerType}`);
  if (opts.insurance) active.push('📜 Страховой полис');
  if (opts.stealth) active.push('🛡️ Маскировка');
  if (opts.eventEffects.length) active.push(`🎉 Эффекты события: ${opts.eventEffects.length}`);

  console.log('  ' + active.join(' · '));
  console.log(ln);

  console.log('\n  ПИРАТЫ');
  console.log('  ' + sep);
  if (opts.stealth) {
    console.log('  Заблокированы маскировочным модулем');
  } else {
    console.log(`  Шанс пирата: ${(pirateChance * 100).toFixed(4)}%`);
    console.log(`  Встречи:  ${num(s.pirateEncounters).padStart(8)} (${pct(s.pirateEncounters, s.total)})`);
    console.log(`  Победы:   ${num(s.pirateWins).padStart(8)} · Поражения: ${num(s.pirateLosses)}`);
  }

  console.log('\n  ТИП НАХОДКИ');
  console.log('  ' + sep);
  const ft = Object.values(s.findTypes).reduce((a, b) => a + b, 0) || 1;
  for (const type of Object.keys(s.findTypes)) {
    const c = s.findTypes[type] || 0;
    console.log(`  ${pad(TYPE_LABELS[type] || type, 14)} ${bar(c, ft)} ${num(c).padStart(8)} ${pct(c, s.total).padStart(8)}`);
  }

  console.log('\n  РЕДКОСТЬ (от сохранённых находок)');
  console.log('  ' + sep);
  const rt = Object.values(s.rarities).reduce((a, b) => a + b, 0) || 1;
  for (const key of RARITY_KEYS) {
    const c = s.rarities[key] || 0;
    const label = config.rarity?.[key]?.label || key;
    console.log(`  ${pad(label, 14)} ${bar(c, rt)} ${num(c).padStart(8)} ${pct(c, rt).padStart(8)}`);
  }

  console.log('\n  ЭКОНОМИКА');
  console.log('  ' + sep);
  console.log(`  Суммарный доход:     ${num(s.totalCredits)} 🪙`);
  console.log(`  Суммарный опыт:      ${num(s.totalXP)} XP`);
  console.log(`  Средний доход/экс:   ${num(Math.round(s.totalCredits / Math.max(s.total, 1)))} 🪙`);
  console.log(`  Средний XP/экс:      ${num(Math.round(s.totalXP / Math.max(s.total, 1)))} XP`);
  console.log(`  Скрытых астероидов:  ${num(s.hiddenAsteroids)} (${pct(s.hiddenAsteroids, s.total)})`);

  console.log('\n  ЛУЧШИЙ SELL RESULT');
  console.log('  ' + sep);
  const b = s.best;
  const tLabel = TYPE_LABELS[b.type] || b.type;
  const rLabel = config.rarity?.[b.rarity]?.label || b.rarity;
  console.log(`  ${tLabel} · ${rLabel}`);
  console.log(`  Цена продажи: ${num(b.price)} 🪙`);
  console.log('\n' + ln + '\n');
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

function parseYesNo(v, fallback = false) {
  const s = String(v || '').trim().toLowerCase();
  if (!s) return fallback;
  return s === 'y' || s === 'yes' || s === 'д' || s === 'да';
}

function parseEventEffects(input) {
  const s = String(input || '').trim();
  if (!s) return [];
  try {
    const data = JSON.parse(s);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function main() {
  console.log('\n╔════════════════════════════════════════════════════╗');
  console.log('║   🚀 StarLoot Loot Simulator v2.0 (dynamic)      ║');
  console.log('╚════════════════════════════════════════════════════╝\n');

  const { config, dbOverridesCount, dbConnected } = await loadConfigWithOverrides();
  const cfgInfo = dbConnected
    ? `Конфиг: defaults + DB overrides (${dbOverridesCount})`
    : 'Конфиг: только defaults (DB overrides недоступны)';
  console.log(`ℹ️  ${cfgInfo}`);

  const generator = new FindGeneratorService({ config });

  const iterStr = await ask('Количество итераций: ');
  const iters = Math.max(1, parseInt(iterStr, 10) || 1000);

  const zones = Array.isArray(config.zones) ? config.zones : [];
  console.log('\nЗоны:');
  zones.forEach((z, i) => console.log(`  ${i + 1}. ${z.name} (${z.id})`));
  const zs = await ask('Зона (номер, Enter = все): ');
  const zi = parseInt(zs, 10) - 1;

  const maxScannerLevel = Number(config?.modules?.scanner?.maxLevel || 5);
  const scannerRaw = await ask(`Уровень сканера (0-${maxScannerLevel}) [${maxScannerLevel}]: `);
  let scannerLevel = scannerRaw.trim() === '' ? maxScannerLevel : parseInt(scannerRaw, 10);
  if (!Number.isFinite(scannerLevel)) scannerLevel = maxScannerLevel;
  scannerLevel = Math.max(0, Math.min(maxScannerLevel, scannerLevel));

  console.log('\nУсилитель сигнала:');
  console.log('  0. Нет');
  console.log('  1. Basic (из конфига)');
  console.log('  2. Advanced (из конфига)');
  console.log('  3. Star (из конфига)');
  const ampRaw = await ask('Выбор [0]: ');
  const ampMap = { '0': 'none', '1': 'basic', '2': 'advanced', '3': 'star' };
  const signalAmpMode = ampMap[String(ampRaw).trim()] || 'none';

  const stealth = parseYesNo(await ask('Маскировочный модуль (блок пиратов)? (y/n) [n]: '), false);
  const insurance = parseYesNo(await ask('Страховой полис (reroll common)? (y/n) [n]: '), false);
  const quantumLocator = parseYesNo(await ask('Квантовый локатор (+50% Legendary/Mythical)? (y/n) [n]: '), false);

  const cartographerTypeRaw = await ask('Картограф targetType (asteroid/debris/artifact/creature/anomaly, Enter = off): ');
  const cartographerType = String(cartographerTypeRaw || '').trim() || null;

  const eventEffectsRaw = await ask('Эффекты события JSON-массивом (Enter = none): ');
  const eventEffects = parseEventEffects(eventEffectsRaw);

  const opts = {
    scannerLevel,
    signalAmpMode,
    stealth,
    insurance,
    quantumLocator,
    cartographerType,
    eventEffects,
  };

  console.log(`\n⏳ Симулируем ${num(iters)} экспедиций...\n`);

  const zonesToRun = (!Number.isNaN(zi) && zi >= 0 && zi < zones.length) ? [zones[zi]] : zones;
  for (const zone of zonesToRun) {
    const scannerCfg = config.modules?.scanner?.levels?.[opts.scannerLevel] || { level: 0, rarityMultiplier: 1.0 };
    const pirateChance = opts.stealth ? 0 : Math.max(0, Number(config?.pirates?.chance || 0));

    const signalBuff = pickSignalAmpBuff(config, opts.signalAmpMode);
    const previewBuffs = {};
    if (signalBuff) previewBuffs.signal_amplifier = signalBuff;
    if (opts.quantumLocator) previewBuffs.quantum_locator = { metadata: {} };
    if (opts.cartographerType) previewBuffs.cartographer = { metadata: { targetType: opts.cartographerType } };

    printWeightsPreview(config, zone, scannerCfg, previewBuffs, opts.eventEffects, pirateChance);

    const { stats, buffsMap } = await simulate(iters, zone, opts, config, generator);
    print(stats, opts, config, scannerCfg, pirateChance, buffsMap);
  }

  console.log('Примечание: множитель NFT от supporter в live-логике генератора не применяется, поэтому здесь не учитывается.');
  rl.close();
}

main().catch((err) => {
  console.error('Simulator error:', err?.stack || err?.message || err);
  rl.close();
});
