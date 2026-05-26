#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { Pool } = require('pg');

const CONFIG_FILE = path.join(__dirname, 'config.json');

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    return { connectionString: '' };
  }
}

function createRl() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function ask(rl, prompt, fallback) {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      const v = String(answer || '').trim();
      resolve(v || String(fallback));
    });
  });
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function avg(list) {
  if (!list.length) return 0;
  return list.reduce((s, n) => s + n, 0) / list.length;
}

function stddev(list, mean) {
  if (!list.length) return 0;
  const m = Number.isFinite(mean) ? mean : avg(list);
  const variance = list.reduce((s, n) => s + Math.pow(n - m, 2), 0) / list.length;
  return Math.sqrt(variance);
}

function toLocalDateKey(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatNum(n, digits = 2) {
  return Number(n || 0).toFixed(digits);
}

function parseArgs(argv) {
  const args = { days: null, top: null, minExpeditions: null, userId: null };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === '--days' && v) args.days = Number(v);
    if (k === '--top' && v) args.top = Number(v);
    if (k === '--min' && v) args.minExpeditions = Number(v);
    if (k === '--user' && v) args.userId = v;
  }
  return args;
}

function buildProfile(userRows) {
  const sorted = [...userRows].sort((a, b) => new Date(a.started_at) - new Date(b.started_at));
  const starts = sorted.map((r) => new Date(r.started_at));
  const count = starts.length;

  const intervalsMin = [];
  for (let i = 1; i < starts.length; i++) {
    const diffMs = starts[i] - starts[i - 1];
    const diffMin = diffMs / 60000;
    if (diffMin > 0 && diffMin < 24 * 60) intervalsMin.push(diffMin);
  }

  const meanInterval = avg(intervalsMin);
  const sdInterval = stddev(intervalsMin, meanInterval);
  const cv = meanInterval > 0 ? sdInterval / meanInterval : 0;
  const nearTenCount = intervalsMin.filter((v) => v >= 9 && v <= 11).length;
  const nearTenRatio = intervalsMin.length ? nearTenCount / intervalsMin.length : 0;

  const mod10Buckets = Array(10).fill(0);
  const hoursBuckets = Array(24).fill(0);
  let nightCount = 0;

  for (const d of starts) {
    mod10Buckets[d.getMinutes() % 10] += 1;
    hoursBuckets[d.getHours()] += 1;
    if (d.getHours() <= 5) nightCount += 1;
  }

  const dominantModulo = mod10Buckets.length ? Math.max(...mod10Buckets) : 0;
  const dominantModuloShare = count ? dominantModulo / count : 0;
  const uniqueHours = hoursBuckets.filter((n) => n > 0).length;
  const nightShare = count ? nightCount / count : 0;

  const byDay = new Map();
  for (const d of starts) {
    const key = toLocalDateKey(d);
    byDay.set(key, (byDay.get(key) || 0) + 1);
  }
  const dayCounts = [...byDay.values()];
  const activeDays = dayCounts.length;
  const avgPerDay = activeDays ? count / activeDays : 0;
  const maxPerDay = dayCounts.length ? Math.max(...dayCounts) : 0;

  const speedups = sorted.filter((r) => r.was_sped_up).length;
  const speedupShare = count ? speedups / count : 0;

  const cvScore = intervalsMin.length >= 20 ? clamp((0.25 - cv) / 0.25, 0, 1) * 100 : 0;
  const regularityScore = intervalsMin.length >= 20
    ? (cvScore * 0.6 + nearTenRatio * 100 * 0.4)
    : 0;

  const moduloScore = clamp((dominantModuloShare - 0.35) / 0.45, 0, 1) * 100;
  const volumeScore = clamp((avgPerDay - 15) / 45, 0, 1) * 100;
  const aroundClockBase = uniqueHours >= 16 ? clamp((uniqueHours - 16) / 8, 0, 1) * 65 : 0;
  const aroundClockNight = clamp((nightShare - 0.08) / 0.22, 0, 1) * 35;
  const aroundClockScore = avgPerDay >= 20 ? aroundClockBase + aroundClockNight : 0;

  const rawScore = regularityScore * 0.42 + moduloScore * 0.23 + volumeScore * 0.22 + aroundClockScore * 0.13;

  const confidence = clamp((count - 40) / 180, 0, 1);
  const suspicion = clamp(rawScore * (0.55 + 0.45 * confidence), 0, 100);

  const reasons = [];
  if (nearTenRatio >= 0.6 && intervalsMin.length >= 20) reasons.push(`high 10m cadence (${(nearTenRatio * 100).toFixed(1)}%)`);
  if (cv <= 0.18 && intervalsMin.length >= 20) reasons.push(`very stable intervals (cv=${cv.toFixed(3)})`);
  if (dominantModuloShare >= 0.55) reasons.push(`same minute%10 bucket (${(dominantModuloShare * 100).toFixed(1)}%)`);
  if (avgPerDay >= 30) reasons.push(`high daily volume (${avgPerDay.toFixed(1)} / day)`);
  if (uniqueHours >= 18 && nightShare >= 0.18) reasons.push(`near 24h pattern (hours=${uniqueHours}, night=${(nightShare * 100).toFixed(1)}%)`);
  if (!reasons.length) reasons.push('no strong bot-like signal');

  return {
    userId: sorted[0]?.user_id,
    username: sorted[0]?.username || '',
    firstName: sorted[0]?.first_name || '',
    expeditions: count,
    activeDays,
    avgPerDay,
    maxPerDay,
    intervalsCount: intervalsMin.length,
    meanInterval,
    sdInterval,
    cv,
    nearTenRatio,
    dominantModuloShare,
    uniqueHours,
    nightShare,
    speedupShare,
    suspicion,
    confidence,
    reasons,
  };
}

async function fetchRows(pool, days) {
  const sql = `
    SELECT
      e.user_id,
      e.started_at,
      e.was_sped_up,
      e.status,
      u.username,
      u.first_name
    FROM expeditions e
    JOIN users u ON u.id = e.user_id
    WHERE e.started_at >= NOW() - ($1 || ' days')::INTERVAL
      AND e.status IN ('completed', 'collected')
      AND u.is_banned = false
    ORDER BY e.user_id ASC, e.started_at ASC
  `;
  const res = await pool.query(sql, [String(days)]);
  return res.rows;
}

function groupByUser(rows) {
  const map = new Map();
  for (const row of rows) {
    const key = String(row.user_id);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(row);
  }
  return map;
}

function displayName(profile) {
  if (profile.username) return `@${profile.username}`;
  if (profile.firstName) return profile.firstName;
  return `ID ${profile.userId}`;
}

function printTop(top) {
  console.log('\nTop suspicious accounts');
  console.log('='.repeat(120));
  console.log('Rank | User ID      | Name                | Score | Exp  | Avg/day | 10m%  | CV    | min%10 | Reasons');
  console.log('-'.repeat(120));

  top.forEach((p, idx) => {
    const reason = p.reasons.slice(0, 2).join('; ');
    const row = [
      String(idx + 1).padStart(4, ' '),
      String(p.userId).padEnd(12, ' '),
      displayName(p).slice(0, 18).padEnd(18, ' '),
      formatNum(p.suspicion, 1).padStart(5, ' '),
      String(p.expeditions).padStart(4, ' '),
      formatNum(p.avgPerDay, 1).padStart(7, ' '),
      formatNum(p.nearTenRatio * 100, 1).padStart(5, ' ') + '%',
      formatNum(p.cv, 3).padStart(5, ' '),
      formatNum(p.dominantModuloShare * 100, 1).padStart(6, ' ') + '%',
      reason,
    ].join(' | ');
    console.log(row);
  });
}

function printUser(profile) {
  console.log('\nUser suspicion details');
  console.log('='.repeat(72));
  console.log(`User: ${displayName(profile)} (${profile.userId})`);
  console.log(`Suspicion score: ${formatNum(profile.suspicion, 1)}%`);
  console.log(`Data confidence: ${formatNum(profile.confidence * 100, 1)}%`);
  console.log(`Expeditions: ${profile.expeditions}`);
  console.log(`Active days: ${profile.activeDays}`);
  console.log(`Avg per day: ${formatNum(profile.avgPerDay, 2)}`);
  console.log(`Max per day: ${profile.maxPerDay}`);
  console.log(`Intervals sampled: ${profile.intervalsCount}`);
  console.log(`Mean interval (min): ${formatNum(profile.meanInterval, 2)}`);
  console.log(`StdDev interval (min): ${formatNum(profile.sdInterval, 2)}`);
  console.log(`CV interval: ${formatNum(profile.cv, 3)}`);
  console.log(`Intervals in 9-11 min: ${formatNum(profile.nearTenRatio * 100, 2)}%`);
  console.log(`Dominant minute%10 bucket: ${formatNum(profile.dominantModuloShare * 100, 2)}%`);
  console.log(`Unique active hours: ${profile.uniqueHours}`);
  console.log(`Night share (00:00-05:59): ${formatNum(profile.nightShare * 100, 2)}%`);
  console.log(`Speedup share: ${formatNum(profile.speedupShare * 100, 2)}%`);
  console.log('Reasons:');
  for (const r of profile.reasons) console.log(`  - ${r}`);
}

async function run() {
  const cfg = loadConfig();
  if (!cfg.connectionString) {
    console.error('Missing connectionString in admin-panel/config.json');
    process.exit(1);
  }

  const args = parseArgs(process.argv.slice(2));
  let days = Number.isFinite(args.days) && args.days > 0 ? Math.floor(args.days) : null;
  let topN = Number.isFinite(args.top) && args.top > 0 ? Math.floor(args.top) : null;
  let minExpeditions = Number.isFinite(args.minExpeditions) && args.minExpeditions > 0 ? Math.floor(args.minExpeditions) : null;
  let userId = args.userId || null;

  if (!days || !topN || !minExpeditions) {
    const rl = createRl();
    if (!days) days = Number(await ask(rl, 'Window in days [30]: ', 30));
    if (!topN) topN = Number(await ask(rl, 'Top suspicious accounts [20]: ', 20));
    if (!minExpeditions) minExpeditions = Number(await ask(rl, 'Min expeditions per user [80]: ', 80));
    if (!userId) {
      const x = await ask(rl, 'Optional user ID to inspect (empty to skip): ', '');
      userId = String(x || '').trim() || null;
    }
    rl.close();
  }

  days = clamp(Math.floor(days || 30), 1, 365);
  topN = clamp(Math.floor(topN || 20), 1, 200);
  minExpeditions = clamp(Math.floor(minExpeditions || 80), 1, 10000);

  let pool = null;
  try {
    pool = new Pool({
      connectionString: cfg.connectionString,
      ssl: { rejectUnauthorized: false },
      max: 4,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 15000,
    });

    let rows;
    try {
      rows = await fetchRows(pool, days);
    } catch {
      await pool.end().catch(() => {});
      pool = new Pool({
        connectionString: cfg.connectionString,
        ssl: false,
        max: 4,
        connectionTimeoutMillis: 10000,
        idleTimeoutMillis: 15000,
      });
      rows = await fetchRows(pool, days);
    }

    if (!rows.length) {
      console.log('No expedition data found for selected window.');
      return;
    }

    const grouped = groupByUser(rows);
    const profiles = [];
    for (const userRows of grouped.values()) {
      if (userRows.length < minExpeditions) continue;
      profiles.push(buildProfile(userRows));
    }

    if (!profiles.length) {
      console.log(`No users with >= ${minExpeditions} completed expeditions in last ${days} days.`);
      return;
    }

    profiles.sort((a, b) => b.suspicion - a.suspicion);
    printTop(profiles.slice(0, topN));

    if (userId) {
      let p = profiles.find((x) => String(x.userId) === String(userId));
      if (!p) {
        const rowsForUser = grouped.get(String(userId));
        if (rowsForUser && rowsForUser.length) p = buildProfile(rowsForUser);
      }
      if (!p) {
        console.log(`\nUser ${userId} has no completed expeditions in selected window.`);
      } else {
        printUser(p);
      }
    }

    console.log('\nNote: this is heuristic scoring, not a ban verdict.');
  } catch (err) {
    console.error('Analyzer failed:', err.message);
    process.exitCode = 1;
  } finally {
    if (pool) await pool.end().catch(() => {});
  }
}

run();
