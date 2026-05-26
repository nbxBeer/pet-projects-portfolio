'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
// pg Pool loaded below

const PORT = 8765;
const CONFIG_FILE = path.join(__dirname, 'config.json');
const BACKEND_GAME_CONFIG_FILE = path.join(__dirname, '..', 'backend', 'src', 'config', 'gameConfig.js');

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
  catch { return { connectionString: '', botToken: '' }; }
}
function saveConfig(cfg) { fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2)); }

function loadDefaultQuestTemplates() {
  try {
    const gameConfig = require(BACKEND_GAME_CONFIG_FILE);
    const templates = gameConfig?.quests?.templates;
    return Array.isArray(templates) ? templates : [];
  } catch {
    return [];
  }
}

function loadFactionsConfig() {
  try {
    const gameConfig = require(BACKEND_GAME_CONFIG_FILE);
    const factions = gameConfig?.factions || {};
    return {
      ids: new Set((factions.list || []).map((f) => f.id).filter(Boolean)),
      minReputation: Number.isFinite(Number(factions.minReputation)) ? Number(factions.minReputation) : -1000,
      maxReputation: Number.isFinite(Number(factions.maxReputation)) ? Number(factions.maxReputation) : 1000,
    };
  } catch {
    return {
      ids: new Set(['bioengineers', 'tech_institute', 'industrial_league', 'navigators_order', 'black_market']),
      minReputation: -1000,
      maxReputation: 1000,
    };
  }
}

const { Pool } = require('pg');
let _pool = null;
let _poolConnStr = null;

function getPool() {
  const { connectionString } = loadConfig();
  if (_pool && _poolConnStr === connectionString) return _pool;
  if (_pool) { _pool.end().catch(()=>{}); }
  _pool = new Pool({ connectionString, ssl: { rejectUnauthorized: false }, max: 5, connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000 });
  _pool.on('error', () => { _pool = null; });
  _poolConnStr = connectionString;
  return _pool;
}

async function query(sql, params = []) {
  try {
    const result = await getPool().query(sql, params);
    return result.rows;
  } catch (err) {
    // SSL failed — retry without SSL
    _pool = null;
    const { connectionString } = loadConfig();
    const pool2 = new Pool({ connectionString, ssl: false, max: 5, connectionTimeoutMillis: 10000 });
    const result = await pool2.query(sql, params);
    _pool = pool2;
    return result.rows;
  }
}

// Отправка сообщения через Telegram Bot API
function sendTelegramMessage(chatId, text) {
  const { botToken } = loadConfig();
  if (!botToken || !chatId) {
    console.warn('[notify] skip: botToken or chatId missing', { hasBotToken: !!botToken, chatId });
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const body = JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    });
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${botToken}/sendMessage`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          console.error('[notify] Telegram API error', res.statusCode, data);
          // Auto-migrate if group was upgraded to supergroup
          try {
            const parsed = JSON.parse(data);
            const newId = parsed?.parameters?.migrate_to_chat_id;
            if (newId) {
              console.log('[notify] chat migrated %s → %s, updating config', chatId, newId);
              const cfg = loadConfig();
              if (String(cfg.gameChatId) === String(chatId)) {
                cfg.gameChatId = String(newId);
                saveConfig(cfg);
              }
              sendTelegramMessage(String(newId), text).then(resolve);
              return;
            }
          } catch {}
        } else {
          console.log('[notify] sent to', chatId);
        }
        resolve();
      });
    });
    req.on('error', (e) => { console.error('[notify] request error', e.message); resolve(); });
    req.write(body);
    req.end();
  });
}

function broadcastMessage(cfg, text) {
  const ids = getAnnouncementChatIds(cfg);
  console.log('[notify] broadcastMessage announceTarget=%s ids=%j', cfg.announceTarget, ids);
  for (const id of ids) sendTelegramMessage(id, text).catch((e) => console.error('[notify] broadcast error', e.message));
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;');
}

const MIRROR_CHANNEL_ID = '-1003692333086';

// Returns array of chat IDs to send announcements to.
// 'admin' mode → only admin DM (debug). 'game' mode → game chat + mirror channel.
function getAnnouncementChatIds(cfg) {
  if (cfg.announceTarget === 'admin') {
    return cfg.adminChatId ? [cfg.adminChatId] : [];
  }
  const ids = new Set();
  if (cfg.gameChatId) ids.add(cfg.gameChatId);
  ids.add(MIRROR_CHANNEL_ID);
  return [...ids];
}

function getRewardWinnersLimit(topRewards) {
  if (!Array.isArray(topRewards) || topRewards.length === 0) return 10;
  let maxPlace = 0;
  for (const r of topRewards) {
    if (typeof r === 'string') {
      maxPlace += 1;
      continue;
    }
    const from = Number(r?.from);
    const to = Number(r?.to);
    if (Number.isFinite(from) && Number.isFinite(to)) {
      maxPlace = Math.max(maxPlace, to);
    } else if (Number.isFinite(from)) {
      maxPlace = Math.max(maxPlace, from);
    }
  }
  if (maxPlace <= 0) maxPlace = 10;
  return Math.min(maxPlace, 100);
}

async function autoCompleteTournaments() {
  try {
    const expiredTournaments = await query(
      `SELECT id, title, icon, metric, top_rewards, starts_at, ends_at, description
       FROM tournaments
       WHERE is_active = true AND ends_at < NOW()`
    );
    
    if (expiredTournaments.length === 0) return;
    
    const cfg = loadConfig();

    for (const tournament of expiredTournaments) {
      // Mark as inactive
      await query(`UPDATE tournaments SET is_active = false WHERE id = $1`, [tournament.id]);

      const winnersLimit = getRewardWinnersLimit(tournament.top_rewards || []);
      const winners = await getTournamentWinners(tournament.id, winnersLimit);

      const winnerLines = winners.length
        ? winners.map((w, i) => {
            const displayName = w.username ? `@${w.username}` : (w.first_name || `ID ${w.user_id}`);
            const linked = `<a href=\"tg://user?id=${w.user_id}\">${escapeHtml(displayName)}</a>`;
            return `${i + 1}. ${linked} (ID: <code>${w.user_id}</code>)`;
          }).join('\n')
        : 'Участников не было.';

      const rewardsText = formatTournamentRewards(tournament.top_rewards || []);
      const rewardsSection = rewardsText ? `\n\n<b>🎁 Награды:</b>\n<blockquote>${rewardsText}</blockquote>` : '';

      const startDate = new Date(tournament.starts_at);
      const endDate = new Date(tournament.ends_at);
      const fmtDate = (d) => d.toLocaleDateString('ru-RU', {day:'2-digit', month:'2-digit', year:'2-digit'}).replace(/\//g, '.');
      const fmtTime = (d) => d.toLocaleTimeString('ru-RU', {hour:'2-digit', minute:'2-digit'}).replace(/:/g, '.');
      const dateRange = `${fmtDate(startDate)} ${fmtTime(startDate)} — ${fmtDate(endDate)} ${fmtTime(endDate)}`;

      const endMsg = `${tournament.icon || '🏆'} <b>Турнир завершён: ${escapeHtml(tournament.title)}</b>
${tournament.description ? escapeHtml(tournament.description) + '\n' : ''}
⏰ <b>${dateRange}</b>

<b>🏁 Результаты:</b>
<blockquote>${winnerLines}</blockquote>${rewardsSection}`;

      broadcastMessage(cfg, endMsg);
    }
  } catch (e) {
    // Silently fail - don't break the admin panel
  }
}

async function getTournamentWinners(tournamentId, limit = 10) {
  const rows = await query(
    `SELECT
        u.id AS user_id,
        u.first_name,
        u.username,
        u.level,
        CASE
          WHEN COALESCE(t.scoring_type, t.metric, 'xp_earned') IN ('xp_earned', 'xp_gained')
          THEN GREATEST(COALESCE(u.xp, 0) - COALESCE(ts.baseline_value, 0), 0)
          ELSE COALESCE(ts.current_value, 0)
        END AS score
     FROM tournament_scores ts
     JOIN users u ON u.id = ts.user_id
     JOIN tournaments t ON t.id = ts.tournament_id
     WHERE ts.tournament_id = $1
       AND u.is_banned = false AND u.hidden_from_leaderboards = false
     ORDER BY score DESC, u.id ASC
     LIMIT $2`,
    [tournamentId, limit]
  );
  return rows;
}

function formatTournamentRewards(topRewards) {
  if (!Array.isArray(topRewards) || topRewards.length === 0) return '';
  const lines = [];
  for (const r of topRewards) {
    if (typeof r === 'string') {
      lines.push(r);
      continue;
    }
    const from = Number(r?.from);
    const to = Number(r?.to);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from < 1 || to < from) continue;
    const placeLabel = from === to ? `${from} место` : `${from}-${to} места`;
    const description = String(r?.description || '').trim();
    const nftLink = String(r?.nftLink || '').trim();
    
    if (description) {
      let reward = escapeHtml(description);
      // Ссылка кликабельная, а preview отключен через disable_web_page_preview.
      if (nftLink) {
        reward = `<a href="${escapeHtml(nftLink)}">${reward}</a>`;
      }
      lines.push(`${placeLabel}: ${reward}`);
    }
  }
  return lines.join('\n');
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function avg(list) {
  if (!list.length) return 0;
  return list.reduce((sum, n) => sum + n, 0) / list.length;
}

function stddev(list, mean) {
  if (!list.length) return 0;
  const m = Number.isFinite(mean) ? mean : avg(list);
  const variance = list.reduce((sum, n) => sum + Math.pow(n - m, 2), 0) / list.length;
  return Math.sqrt(variance);
}

function toLocalDateKey(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function buildSuspicionProfile(userRows) {
  const sorted = [...userRows].sort((a, b) => new Date(a.started_at) - new Date(b.started_at));
  const starts = sorted.map((r) => new Date(r.started_at));
  const count = starts.length;

  const intervalsMin = [];
  for (let i = 1; i < starts.length; i++) {
    const diffMin = (starts[i] - starts[i - 1]) / 60000;
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

  const dominantModulo = Math.max(...mod10Buckets);
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

async function fetchExpeditionRowsForSuspicion(days) {
  const res = await getPool().query(
    `SELECT
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
     ORDER BY e.user_id ASC, e.started_at ASC`,
    [String(days)]
  );
  return res.rows;
}

// Fetch from backend with admin secret
function fetchBackend(url, method, body, secret, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https');
    const lib = isHttps ? https : http;
    const parsed = new URL(url);
    const bodyStr = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method,
      timeout: timeoutMs,
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Secret': secret,
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
      },
    };
    const req = lib.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
          try { resolve({ ...JSON.parse(d), _status: res.statusCode }); }
          catch { resolve({ error: `HTTP ${res.statusCode}: ${d.slice(0,200)}`, _status: res.statusCode }); }
        });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Backend request timeout')); });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function timestampForFilename() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

function pgToolCandidates(toolName, preferredBinPath = '') {
  const candidates = [];
  const preferred = String(preferredBinPath || '').trim();
  if (preferred) {
    candidates.push(path.join(preferred, `${toolName}.exe`));
    candidates.push(path.join(preferred, toolName));
  }

  if (process.platform !== 'win32') return [toolName];
  candidates.push(...[
    `${toolName}.exe`,
    toolName,
    `C:/Program Files/PostgreSQL/18/bin/${toolName}.exe`,
    `C:/Program Files/PostgreSQL/17/bin/${toolName}.exe`,
    `C:/Program Files/PostgreSQL/16/bin/${toolName}.exe`,
    `C:/Program Files/PostgreSQL/15/bin/${toolName}.exe`,
    `C:/Program Files/PostgreSQL/14/bin/${toolName}.exe`,
    `C:/Program Files/PostgreSQL/13/bin/${toolName}.exe`,
  ]);

  // Deduplicate while preserving order.
  return [...new Set(candidates)];
}

function runPgTool(toolName, args, input = null, preferredBinPath = '') {
  const candidates = pgToolCandidates(toolName, preferredBinPath);

  return new Promise((resolve, reject) => {
    let idx = 0;
    let lastErr = null;

    const tryNext = () => {
      if (idx >= candidates.length) {
        const baseMsg = `${toolName} не найден в системе.`;
        const hint = process.platform === 'win32'
          ? ' Установи PostgreSQL client tools и добавь bin в PATH.'
          : ' Установи PostgreSQL client tools.';
        return reject(new Error(baseMsg + hint + (lastErr ? ` (${lastErr.message})` : '')));
      }

      const bin = candidates[idx++];
      const isAbsolute = path.isAbsolute(bin);
      if (isAbsolute && !fs.existsSync(bin)) {
        tryNext();
        return;
      }
      const child = spawn(bin, args, { shell: false, windowsHide: true });
      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
      child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

      child.on('error', (err) => {
        lastErr = err;
        if (err.code === 'ENOENT') {
          tryNext();
          return;
        }
        reject(err);
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve({ stdout, stderr, code });
          return;
        }
        reject(new Error(`${toolName} exited with code ${code}: ${stderr || stdout}`));
      });

      if (input) child.stdin.write(input);
      child.stdin.end();
    };

    tryNext();
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const json = (data, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };
  const body = () => new Promise(resolve => {
    let d = '';
    req.on('data', c => d += c);
    req.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve({}); } });
  });

  try {
    // ── Static ──────────────────────────────────────────────────────────────
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(path.join(__dirname, 'index.html'))); return;
    }

    // ── Auth check for API routes ────────────────────────────────────────────
    if (url.pathname.startsWith('/api/') && url.pathname !== '/api/config' && url.pathname !== '/api/test') {
      const cfg = loadConfig();
      const authHeader = req.headers['authorization'] || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
      if (!cfg.adminSecret || token !== cfg.adminSecret) {
        json({ error: 'Unauthorized — provide Authorization: Bearer <adminSecret>' }, 401);
        return;
      }
    }

    // ── Config (no auth — needed for initial setup) ──────────────────────────
    if (url.pathname === '/api/config') {
      if (req.method === 'GET') { json(loadConfig()); return; }
      if (req.method === 'POST') { saveConfig(await body()); json({ ok: true }); return; }
    }

    if (url.pathname === '/api/test' && req.method === 'POST') {
      const b = await body();
      saveConfig(b);
      await query('SELECT 1');
      json({ ok: true }); return;
    }

    // ── Full DB Backup / Restore ────────────────────────────────────────────
    if (url.pathname === '/api/db/backup' && req.method === 'GET') {
      const cfg = loadConfig();
      if (!cfg.connectionString) {
        json({ error: 'Не задан connectionString в настройках' }, 400);
        return;
      }

      const args = [
        '--dbname', cfg.connectionString,
        '--format=plain',
        '--encoding=UTF8',
        '--blobs',
        '--clean',
        '--if-exists',
      ];

      const result = await runPgTool('pg_dump', args, null, cfg.pgBinPath || '');
      const filename = `starloot_backup_${timestampForFilename()}.sql`;
      res.writeHead(200, {
        'Content-Type': 'application/sql; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      });
      res.end(result.stdout);
      return;
    }

    if (url.pathname === '/api/db/restore' && req.method === 'POST') {
      const cfg = loadConfig();
      if (!cfg.connectionString) {
        json({ error: 'Не задан connectionString в настройках' }, 400);
        return;
      }

      const { sql, confirmationText, acknowledgeDestructive } = await body();
      const requiredPhrase = 'RESTORE STARLOOT DB';

      if (!acknowledgeDestructive || confirmationText !== requiredPhrase) {
        json({ error: `Подтверждение не пройдено. Введи фразу: ${requiredPhrase}` }, 400);
        return;
      }
      if (!sql || typeof sql !== 'string' || sql.trim().length < 20) {
        json({ error: 'Некорректный SQL-дамп' }, 400);
        return;
      }

      await runPgTool('psql', [
        '--dbname', cfg.connectionString,
        '--single-transaction',
        '--set', 'ON_ERROR_STOP=1',
      ], sql, cfg.pgBinPath || '');

      json({ ok: true, message: 'База успешно восстановлена' });
      return;
    }

    // ── Players list ─────────────────────────────────────────────────────────
    if (url.pathname === '/api/players' && req.method === 'GET') {
      const rows = await query(`
        SELECT u.id, u.username, u.first_name, u.last_name, u.level, u.xp,
               u.credits, u.stars_balance, u.total_expeditions, u.total_finds,
               u.is_banned, u.hidden_from_leaderboards, u.created_at, u.last_active_at, u.expedition_cooldown_until,
               COUNT(DISTINCT e.id) FILTER (WHERE e.status = 'in_progress') AS active_expeditions
        FROM users u LEFT JOIN expeditions e ON e.user_id = u.id
        GROUP BY u.id ORDER BY u.last_active_at DESC`);
      json(rows); return;
    }

    // ── Player detail ─────────────────────────────────────────────────────────
    if (url.pathname.match(/^\/api\/player\/[^/]+$/) && req.method === 'GET') {
      const userId = url.pathname.split('/')[3];
      const [user] = await query('SELECT * FROM users WHERE id = $1', [userId]);
      if (!user) { json({ error: 'Not found' }, 404); return; }

      const expeditions = await query(`
        SELECT e.id, e.zone_id, e.status, e.started_at, e.created_at, e.was_sped_up,
               er.find_type, er.rarity, er.final_credits, er.base_credits, er.action_taken
        FROM expeditions e
        LEFT JOIN expedition_results er ON er.expedition_id = e.id
        WHERE e.user_id = $1 ORDER BY e.created_at DESC LIMIT 20`, [userId]);

      const inventoryAll = await query(`
        SELECT id, find_type, rarity, status, object_data, sold_for, xp_gained, acquired_at, sold_at
        FROM inventory_items WHERE user_id = $1 ORDER BY acquired_at DESC LIMIT 200`, [userId]);

      const buffs = await query(`
        SELECT id, buff_type, expires_at, uses_remaining, metadata, created_at
        FROM user_active_buffs WHERE user_id = $1 ORDER BY created_at DESC`, [userId]);

      const modules = await query(`
        SELECT module_type, level, upgraded_at, created_at
        FROM ship_modules WHERE user_id = $1 ORDER BY module_type`, [userId]);

      const nfts = await query(`
        SELECT * FROM nft_notifications WHERE user_id = $1 ORDER BY created_at DESC`, [userId]);

      const reputations = await query(`
        SELECT faction_id, reputation
        FROM user_faction_reputation
        WHERE user_id = $1
        ORDER BY faction_id`, [userId]);

      json({ user, expeditions, inventory: inventoryAll, buffs, modules, nfts, reputations }); return;
    }

    // ── Delete buff ───────────────────────────────────────────────────────────
    if (url.pathname.startsWith('/api/buff/') && req.method === 'DELETE') {
      const buffId = url.pathname.split('/')[3];
      await query(`DELETE FROM user_active_buffs WHERE id = $1`, [buffId]);
      json({ ok: true, message: 'Бафф удалён' }); return;
    }

    // ── Admin actions ─────────────────────────────────────────────────────────
    if (url.pathname === '/api/admin/action' && req.method === 'POST') {
      const { action, userId, value, value2, reason } = await body();

      switch (action) {
        case 'give_credits':
          await query(`UPDATE users SET credits = credits + $1 WHERE id = $2`, [value, userId]);
          json({ ok: true, message: `Выдано ${value} кредитов` }); break;

        case 'take_credits':
          await query(`UPDATE users SET credits = GREATEST(0, credits - $1) WHERE id = $2`, [value, userId]);
          json({ ok: true, message: `Снято ${value} кредитов` }); break;

        case 'give_crystals':
          await query(`UPDATE users SET crystals = COALESCE(crystals, 0) + $1 WHERE id = $2`, [value, userId]);
          json({ ok: true, message: `Выдано ${value} кристаллов` }); break;

        case 'take_crystals':
          await query(`UPDATE users SET crystals = GREATEST(0, COALESCE(crystals, 0) - $1) WHERE id = $2`, [value, userId]);
          json({ ok: true, message: `Снято ${value} кристаллов` }); break;

        case 'give_xp':
          await query(`UPDATE users SET xp = xp + $1, level = calculate_level(xp + $1) WHERE id = $2`, [value, userId]);
          json({ ok: true, message: `Выдано ${value} XP` }); break;

        case 'set_level': {
          const xpMap = {1:0,2:200,3:500,4:900,5:1500,6:2300,7:3300,8:4600,9:6200,10:8200,
            11:10700,12:13700,13:17200,14:21200,15:26200,16:32200,17:39200,18:47200,19:56200,20:66200};
          await query(`UPDATE users SET level = $1, xp = $2 WHERE id = $3`, [value, xpMap[value]||0, userId]);
          json({ ok: true, message: `Уровень: ${value}` }); break;
        }

        case 'ban':
          await query(`UPDATE users SET is_banned = true, ban_reason = $1 WHERE id = $2`, [reason||'Admin ban', userId]);
          json({ ok: true, message: 'Забанен' }); break;

        case 'unban':
          await query(`UPDATE users SET is_banned = false, ban_reason = null WHERE id = $1`, [userId]);
          json({ ok: true, message: 'Бан снят' }); break;

        case 'reset_cooldown':
          await query(`UPDATE users SET expedition_cooldown_until = null WHERE id = $1`, [userId]);
          json({ ok: true, message: 'Кулдаун сброшен' }); break;

        case 'speedup_active_expedition': {
          const rows = await query(
            `UPDATE expeditions
             SET ends_at = NOW() - INTERVAL '1 second',
                 was_sped_up = true
             WHERE id = (
               SELECT id
               FROM expeditions
               WHERE user_id = $1 AND status = 'in_progress'
               ORDER BY created_at DESC
               LIMIT 1
             )
             RETURNING id`,
            [userId]
          );
          if (!rows.length) {
            json({ ok: true, message: 'Нет активной экспедиции' });
            break;
          }
          json({ ok: true, message: 'Экспедиция ускорена: готова к сбору' });
          break;
        }

        case 'speedup_universe_travel': {
          const rows = await query(
            `UPDATE users
             SET current_universe = CASE WHEN current_universe = 1 THEN 2 ELSE 1 END,
                 universe_travel_until = NULL
             WHERE id = $1
               AND universe_travel_until IS NOT NULL
               AND universe_travel_until > NOW()
             RETURNING current_universe`,
            [userId]
          );
          if (!rows.length) {
            json({ ok: true, message: 'Нет активного перелёта между вселенными' });
            break;
          }
          json({ ok: true, message: `Перелёт завершён, текущая вселенная: ${rows[0].current_universe}` });
          break;
        }

        case 'hide_from_leaderboards':
          await query(`UPDATE users SET hidden_from_leaderboards = true WHERE id = $1`, [userId]);
          json({ ok: true, message: 'Скрыт из топов' }); break;

        case 'show_in_leaderboards':
          await query(`UPDATE users SET hidden_from_leaderboards = false WHERE id = $1`, [userId]);
          json({ ok: true, message: 'Показан в топах' }); break;

        case 'give_stars':
          await query(`UPDATE users SET stars_balance = stars_balance + $1 WHERE id = $2`, [value, userId]);
          json({ ok: true, message: `Выдано ${value} Stars` }); break;

        case 'set_reputation': {
          const factionId = String(value2 || '').trim();
          const requested = Number.parseInt(value, 10);
          const factionsCfg = loadFactionsConfig();

          if (!factionId || !factionsCfg.ids.has(factionId)) {
            json({ error: 'Неизвестная фракция' }, 400); break;
          }
          if (!Number.isFinite(requested)) {
            json({ error: 'Некорректное значение репутации' }, 400); break;
          }

          const bounded = clamp(requested, factionsCfg.minReputation, factionsCfg.maxReputation);
          await query(
            `INSERT INTO user_faction_reputation (user_id, faction_id, reputation)
             VALUES ($1, $2, $3)
             ON CONFLICT (user_id, faction_id)
             DO UPDATE SET reputation = $3`,
            [userId, factionId, bounded]
          );

          json({ ok: true, message: `Репутация ${factionId}: ${bounded}` });
          break;
        }

        case 'add_reputation': {
          const factionId = String(value2 || '').trim();
          const delta = Number.parseInt(value, 10);
          const factionsCfg = loadFactionsConfig();

          if (!factionId || !factionsCfg.ids.has(factionId)) {
            json({ error: 'Неизвестная фракция' }, 400); break;
          }
          if (!Number.isFinite(delta) || delta === 0) {
            json({ error: 'Укажи изменение репутации (не 0)' }, 400); break;
          }

          const [row] = await query(
            `INSERT INTO user_faction_reputation (user_id, faction_id, reputation)
             VALUES ($1, $2, GREATEST($4::int, LEAST($5::int, $3::int)))
             ON CONFLICT (user_id, faction_id)
             DO UPDATE
               SET reputation = GREATEST($4::int, LEAST($5::int, user_faction_reputation.reputation + $3::int))
             RETURNING reputation`,
            [userId, factionId, delta, factionsCfg.minReputation, factionsCfg.maxReputation]
          );

          json({ ok: true, message: `Репутация ${factionId}: ${row?.reputation ?? 0}` });
          break;
        }

        case 'reset_tos_consent':
          await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS tos_accepted BOOLEAN NOT NULL DEFAULT false`);
          await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS tos_accepted_at TIMESTAMPTZ`);
          await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS tos_version INT`);
          await query(`
            UPDATE users
            SET tos_accepted = false,
                tos_accepted_at = null,
                tos_version = null,
                updated_at = NOW()
            WHERE id = $1
          `, [userId]);
          json({ ok: true, message: 'Согласие с ToS сброшено. При следующем входе откроется окно реферала/ToS.' }); break;

        // ── Баффы ─────────────────────────────────────────────────────────────
        case 'give_buff': {
          // value = buff_type, value2 = hours OR uses (зависит от типа)
          const timeBased = ['signal_amplifier', 'turbo_engine', 'insurance_policy', 'pirate_shield'];
          const useBased = ['cartographer', 'quantum_locator'];
          let metadata = {};
          let expiresAt = null;
          let usesRemaining = null;

          if (value === 'signal_amplifier') metadata = { tier: 'base' };

          if (timeBased.includes(value)) {
            const hours = parseInt(value2) || 2;
            expiresAt = new Date(Date.now() + hours * 3600 * 1000).toISOString();
          } else if (useBased.includes(value)) {
            usesRemaining = parseInt(value2) || 1;
          }

          await query(`
            INSERT INTO user_active_buffs (user_id, buff_type, expires_at, uses_remaining, metadata)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (user_id, buff_type) DO UPDATE
            SET expires_at = $3, uses_remaining = $4, metadata = $5`,
            [userId, value, expiresAt, usesRemaining, JSON.stringify(metadata)]);
          json({ ok: true, message: `Бафф "${value}" выдан` }); break;
        }

        case 'force_next_rarity':
          await query(`
            INSERT INTO user_active_buffs (user_id, buff_type, uses_remaining, metadata)
            VALUES ($1, 'force_rarity', 1, $2)
            ON CONFLICT (user_id, buff_type) DO UPDATE SET uses_remaining=1, metadata=$2`,
            [userId, JSON.stringify({ rarity: value })]);
          json({ ok: true, message: `Следующая редкость: ${value}` }); break;

        case 'force_next_type':
          await query(`
            INSERT INTO user_active_buffs (user_id, buff_type, uses_remaining, metadata)
            VALUES ($1, 'force_type', 1, $2)
            ON CONFLICT (user_id, buff_type) DO UPDATE SET uses_remaining=1, metadata=$2`,
            [userId, JSON.stringify({ findType: value })]);
          json({ ok: true, message: `Следующий тип: ${value}` }); break;

        case 'mark_nft_processed':
          await query(`UPDATE nft_notifications SET admin_processed = true, processed_at = NOW() WHERE id = $1`, [value]);
          json({ ok: true, message: 'NFT помечен как выданный' }); break;

        case 'clear_inventory':
          await query(`DELETE FROM inventory_items WHERE user_id = $1`, [userId]);
          json({ ok: true, message: 'Инвентарь очищен' }); break;

        default: json({ error: 'Unknown action' }, 400);
      }
      return;
    }

    // ── Events (direct DB — no proxy needed) ─────────────────────────────────

    if (url.pathname === '/api/db-check' && req.method === 'GET') {
      const results = {};
      try {
        const cols = await query(
          `SELECT column_name, data_type FROM information_schema.columns
           WHERE table_name = 'global_events' ORDER BY ordinal_position`);
        results.columns = cols.map(r => r.column_name);
      } catch(e) { results.columns = { error: e.message }; }
      try {
        const [r] = await query('SELECT COUNT(*) AS cnt FROM global_events');
        results.selectTest = { ok: true, count: r.cnt };
      } catch(e) { results.selectTest = { ok: false, error: e.message }; }
      try {
        const endsAt = new Date(Date.now() + 3600000);
        const [ins] = await query(
          `INSERT INTO global_events (title, description, icon, effects, ends_at)
           VALUES ('__test__','','🔧','[]',$1) RETURNING id`, [endsAt]);
        await query('DELETE FROM global_events WHERE id = $1', [ins.id]);
        results.insertTest = { ok: true };
      } catch(e) { results.insertTest = { ok: false, error: e.message }; }
      json(results); return;
    }

    if (url.pathname === '/api/events' && req.method === 'GET') {
      const rows = await query(
        `SELECT id, title, description, icon, effects, is_active, starts_at, ends_at, created_at
         FROM global_events ORDER BY created_at DESC LIMIT 50`);
      const events = rows.map(r => ({
        ...r,
        effects: Array.isArray(r.effects) ? r.effects : (typeof r.effects === 'string' ? JSON.parse(r.effects) : []),
      }));
      json({ events }); return;
    }

    if (url.pathname === '/api/events' && req.method === 'POST') {
      const b = await body();
      const { title, description = '', icon = '🎉', durationHours, effects = [] } = b;
      if (!title || !durationHours) { json({ error: 'title и durationHours обязательны' }, 400); return; }

      const cfg_ev = loadConfig();

      // Direct DB insert first (fast and reliable)
      try {
        const endsAt = new Date(Date.now() + Number(durationHours) * 3600000);
        await query(`UPDATE global_events SET is_active = false WHERE is_active = true AND ends_at > NOW()`);
        const rows = await query(
          `INSERT INTO global_events (title, description, icon, effects, ends_at)
           VALUES ($1,$2,$3,$4,$5)
           RETURNING id, title, description, icon, effects, is_active, starts_at, ends_at`,
          [title, description, icon, JSON.stringify(effects), endsAt]);
        if (!rows || rows.length === 0) { json({ error: 'INSERT вернул 0 строк' }, 500); return; }
        const ev = rows[0];
        ev.effects = Array.isArray(ev.effects) ? ev.effects : [];

        // Send Telegram notification (non-blocking)
        const diffH_ev = Math.round((endsAt - Date.now()) / 3600000);
        const dur_ev = diffH_ev >= 24 ? `${Math.floor(diffH_ev/24)} дн. ${diffH_ev%24} ч.` : `${diffH_ev} ч.`;
        const efxLines = (effects||[]).map(e => {
          if (e.type==='xp_bonus') return `⭐ XP: ×${e.multiplier}`;
          if (e.type==='credits_bonus') return `💰 Кредиты: ×${e.multiplier}`;
          if (e.type==='spawn_rate') return `👾 Спавн (${e.findType||'all'}): ×${e.multiplier}`;
          if (e.type==='rarity_bonus') return `✨ Редкость: ×${e.multiplier}`;
          if (e.type==='common_reduction') return `📈 Common -${(e.reduction||0)*100}%`;
          return e.type;
        }).join('\n');
        const notif = `${icon||'🎉'} <b>Новое событие: ${title}</b>${description?'\n'+description:''}\n⏱ Длительность: ${dur_ev}${efxLines?'\n\n'+efxLines:''}`;
        broadcastMessage(cfg_ev, notif);

        console.log('[events] Event created via direct DB:', ev.id, title);
        json({ ok: true, event: ev }); return;
      } catch(dbErr) {
        console.error('[events] DB insert failed:', dbErr.message);
        json({ error: 'DB ошибка: ' + dbErr.message }, 500); return;
      }
    }

    if (url.pathname.match(/^\/api\/events\/[^/]+\/end$/) && req.method === 'POST') {
      const eventId = url.pathname.split('/')[3];
      await query(`UPDATE global_events SET is_active = false WHERE id = $1`, [eventId]);
      json({ ok: true }); return;
    }

    if (url.pathname.match(/^\/api\/events\/[^/]+$/) && req.method === 'DELETE') {
      const eventId = url.pathname.split('/')[3];
      await query(`DELETE FROM global_events WHERE id = $1`, [eventId]);
      json({ ok: true }); return;
    }


    // ── Tournaments (direct DB) ────────────────────────────────────────────────

    if (url.pathname === '/api/tournaments' && req.method === 'GET') {
      try {
        // Fallback auto-complete: if backend timer missed, finalize expired tournaments on list open.
        await autoCompleteTournaments();

        const rows = await query(
          `SELECT t.id, t.title, t.description, t.icon, t.metric, t.starts_at, t.ends_at,
                  t.is_active, t.top_rewards, t.created_at,
                  (SELECT COUNT(*) FROM tournament_scores ts WHERE ts.tournament_id = t.id) AS participants
           FROM tournaments t ORDER BY t.created_at DESC LIMIT 50`);
        const tournaments = rows.map(r => ({ ...r, topRewards: r.top_rewards || [] }));
        json({ tournaments });
      } catch(e) {
        // Table might not exist yet (first deploy)
        if (e.code === '42P01') { json({ tournaments: [], note: 'Таблица ещё не создана — задеплой backend' }); }
        else json({ error: e.message }, 500);
      }
      return;
    }

    if (url.pathname === '/api/tournaments' && req.method === 'POST') {
      const b = await body();
      const { title, description='', icon='🏆', metric, startsAt, endsAt, topRewards=[] } = b;
      if (!title || !metric || !startsAt || !endsAt) {
        json({ error: 'title, metric, startsAt, endsAt обязательны' }, 400); return;
      }
      const VALID_METRICS = ['credits_earned','xp_gained','xp_earned','expedition_count','rare_finds','mythical_finds','heaviest_debris','heaviest_creature','heaviest_artifact','heaviest_anomaly'];
      if (!VALID_METRICS.includes(metric)) {
        json({ error: 'Неверный metric: ' + metric + '. Допустимые: ' + VALID_METRICS.join(', ') }, 400); return;
      }
      try {
        // Deactivate any currently active tournaments before creating a new one
        await query(`UPDATE tournaments SET is_active = false WHERE is_active = true AND ends_at > NOW()`);
        const [row] = await query(
          `INSERT INTO tournaments (title, description, icon, metric, scoring_type, starts_at, ends_at, top_rewards)
           VALUES ($1,$2,$3,$4,$4,$5,$6,$7) RETURNING id, title, icon, metric, scoring_type, starts_at, ends_at, is_active`,
          [title, description, icon, metric, startsAt, endsAt, JSON.stringify(topRewards)]);
        // Notify via Telegram
        const cfg_trn = loadConfig();
        const startD = new Date(startsAt), endD = new Date(endsAt);
        const fmtDate = (d) => d.toLocaleDateString('ru-RU', {day:'2-digit', month:'2-digit', year:'2-digit'}).replace(/\//g, '.');
        const fmtTime = (d) => d.toLocaleTimeString('ru-RU', {hour:'2-digit', minute:'2-digit'}).replace(/:/g, '.');
        const dateRange = `${fmtDate(startD)} ${fmtTime(startD)} — ${fmtDate(endD)} ${fmtTime(endD)}`;
        const rewardsText = formatTournamentRewards(topRewards || []);
        const rewardsSection = rewardsText ? `\n\n<b>🎁 Награды:</b>\n<blockquote>${rewardsText}</blockquote>` : '';
        const trnMsg = `${icon||'🏆'} <b>Новый турнир: ${escapeHtml(title)}</b>
${description ? escapeHtml(description) + '\n' : ''}
⏰ <b>${dateRange}</b>${rewardsSection}`;
        broadcastMessage(cfg_trn, trnMsg);
        json({ ok: true, tournament: row });
      } catch(e) {
        if (e.code === '42P01') json({ error: 'Таблица tournaments не создана. Задеплой backend сначала.' }, 500);
        else json({ error: e.message }, 500);
      }
      return;
    }

    if (url.pathname.match(/^\/api\/tournaments\/[^/]+\/end$/) && req.method === 'POST') {
      const id = url.pathname.split('/')[3];
      const [tournament] = await query(
        `UPDATE tournaments
         SET is_active = false
         WHERE id = $1
         RETURNING id, title, icon, metric, top_rewards, starts_at, ends_at`,
        [id]
      );
      if (!tournament) { json({ error: 'Турнир не найден' }, 404); return; }

      const cfg_end = loadConfig();
      const winnersLimit = getRewardWinnersLimit(tournament.top_rewards || []);
      const winners = await getTournamentWinners(id, winnersLimit);

      const winnerLines = winners.length
        ? winners.map((w, i) => {
            const displayName = w.username ? `@${w.username}` : (w.first_name || `ID ${w.user_id}`);
            const linked = `<a href=\"tg://user?id=${w.user_id}\">${escapeHtml(displayName)}</a>`;
            return `${i + 1}. ${linked} (ID: <code>${w.user_id}</code>)`;
          }).join('\n')
        : 'Участников не было.';

      const rewardsText = formatTournamentRewards(tournament.top_rewards || []);
      const rewardsSection = rewardsText ? `\n\n<b>🎁 Награды:</b>\n<blockquote>${rewardsText}</blockquote>` : '';

      const startDate = new Date(tournament.starts_at);
      const endDate = new Date(tournament.ends_at);
      const fmtDate = (d) => d.toLocaleDateString('ru-RU', {day:'2-digit', month:'2-digit', year:'2-digit'}).replace(/\//g, '.');
      const fmtTime = (d) => d.toLocaleTimeString('ru-RU', {hour:'2-digit', minute:'2-digit'}).replace(/:/g, '.');
      const dateRange = `${fmtDate(startDate)} ${fmtTime(startDate)} — ${fmtDate(endDate)} ${fmtTime(endDate)}`;

      const endMsg = `${tournament.icon || '🏆'} <b>Турнир завершён: ${escapeHtml(tournament.title)}</b>
${tournament.description ? escapeHtml(tournament.description) + '\n' : ''}
⏰ <b>${dateRange}</b>

<b>🏁 Результаты:</b>
<blockquote>${winnerLines}</blockquote>${rewardsSection}`;
      broadcastMessage(cfg_end, endMsg);
      json({ ok: true }); return;
    }

    if (url.pathname.match(/^\/api\/tournaments\/[^/]+\/leaderboard$/) && req.method === 'GET') {
      const id = url.pathname.split('/')[3];
      const rows = await query(
        `SELECT
            CASE
              WHEN COALESCE(t.scoring_type, t.metric, 'xp_earned') IN ('xp_earned', 'xp_gained')
              THEN GREATEST(COALESCE(u.xp, 0) - COALESCE(ts.baseline_value, 0), 0)
              ELSE COALESCE(ts.current_value, 0)
            END AS score,
            u.first_name, u.username, u.level, u.id as user_id
         FROM tournament_scores ts
         JOIN users u ON u.id = ts.user_id
         JOIN tournaments t ON t.id = ts.tournament_id
         WHERE ts.tournament_id = $1 AND u.is_banned = false AND u.hidden_from_leaderboards = false
         ORDER BY score DESC LIMIT 50`, [id]);
      json({ leaderboard: rows }); return;
    }

    if (url.pathname.match(/^\/api\/tournaments\/[^/]+\/reset-scores$/) && req.method === 'POST') {
      const id = url.pathname.split('/')[3];
      const res = await query('DELETE FROM tournament_scores WHERE tournament_id = $1', [id]);
      json({ ok: true, deleted: res.length || 0 }); return;
    }

    if (url.pathname.match(/^\/api\/tournaments\/[^/]+$/) && req.method === 'DELETE') {
      const id = url.pathname.split('/')[3];
      await query('DELETE FROM tournaments WHERE id = $1', [id]);
      json({ ok: true }); return;
    }

    // ── Inventory for player (paginated) ───────────────────────────────────
    if (url.pathname.match(/^\/api\/player\/[^/]+\/inventory$/) && req.method === 'GET') {
      const userId = url.pathname.split('/')[3];
      const page = parseInt(url.searchParams.get('page') || '1');
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 100);
      const offset = (page - 1) * limit;
      const status = url.searchParams.get('status') || 'all';
      const VALID_STATUS = { all: '', in_inventory: `AND status IN ('in_inventory','saved_coords')`, sold: `AND status = 'sold'` };
      const statusFilter = VALID_STATUS[status] ?? '';
      const [countRow] = await query(
        `SELECT COUNT(*) AS total FROM inventory_items WHERE user_id = $1 ${statusFilter}`, [userId]);
      const total = parseInt(countRow.total);
      const items = await query(
        `SELECT id, find_type, rarity, status, object_data, sold_for, xp_gained, acquired_at, sold_at
         FROM inventory_items WHERE user_id = $1 ${statusFilter}
         ORDER BY acquired_at DESC LIMIT $2 OFFSET $3`, [userId, limit, offset]);
      json({ items, total, page, pages: Math.ceil(total / limit) }); return;
    }

    // ── Stars transactions for player (paginated) ─────────────────────────
    if (url.pathname.match(/^\/api\/player\/[^/]+\/stars$/) && req.method === 'GET') {
      const userId = url.pathname.split('/')[3];
      const page = parseInt(url.searchParams.get('page') || '1');
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 100);
      const offset = (page - 1) * limit;
      const [countRow] = await query(
        'SELECT COUNT(*) AS total FROM stars_transactions WHERE user_id = $1', [userId]);
      const total = parseInt(countRow.total);
      const transactions = await query(
        `SELECT id, type, amount, balance_before, balance_after,
                telegram_payment_charge_id, telegram_invoice_payload,
                description, created_at
         FROM stars_transactions WHERE user_id = $1
         ORDER BY created_at DESC LIMIT $2 OFFSET $3`, [userId, limit, offset]);
      json({ items: transactions, total, page, pages: Math.ceil(total / limit) }); return;
    }

    // ── Donations (topup only, paginated) ────────────────────────────────────
    if (url.pathname.match(/^\/api\/player\/[^/]+\/donations$/) && req.method === 'GET') {
      const userId = url.pathname.split('/')[3];
      const page = parseInt(url.searchParams.get('page') || '1');
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '25'), 100);
      const offset = (page - 1) * limit;
      const [countRow] = await query(
        `SELECT COUNT(*) AS total FROM stars_transactions WHERE user_id = $1 AND type = 'topup'`, [userId]);
      const total = parseInt(countRow.total);
      const donations = await query(
        `SELECT id, amount, balance_before, balance_after,
                telegram_payment_charge_id, telegram_invoice_payload,
                description, created_at,
                EXISTS(SELECT 1 FROM stars_transactions r WHERE r.user_id = st.user_id
                  AND r.type = 'refund'
                  AND r.telegram_payment_charge_id = st.telegram_payment_charge_id)
                  AS is_refunded
         FROM stars_transactions st WHERE st.user_id = $1 AND st.type = 'topup'
         ORDER BY st.created_at DESC LIMIT $2 OFFSET $3`, [userId, limit, offset]);
      json({ items: donations, total, page, pages: Math.ceil(total / limit) }); return;
    }

    // ── Refund star payment ─────────────────────────────────────────────────
    if (url.pathname === '/api/admin/refund' && req.method === 'POST') {
      const { userId, telegramPaymentChargeId, reason } = await body();
      if (!userId || !telegramPaymentChargeId) {
        json({ error: 'userId и telegramPaymentChargeId обязательны' }, 400); return;
      }
      const cfg = loadConfig();
      if (!cfg.backendUrl || !cfg.adminSecret) {
        json({ error: 'Настрой backendUrl и adminSecret в настройках' }, 400); return;
      }
      try {
        const result = await fetchBackend(
          `${cfg.backendUrl}/api/admin/refund`,
          'POST',
          { userId: Number(userId), telegramPaymentChargeId, reason: reason || 'Admin refund' },
          cfg.adminSecret
        );
        if (result._status >= 400) {
          json({ error: result.error || result.message || `HTTP ${result._status}` }, result._status); return;
        }
        json({ ok: true, ...result }); return;
      } catch (err) {
        json({ error: 'Backend error: ' + err.message }, 500); return;
      }
    }

    // ── Referral Config ────────────────────────────────────────────────────────
    if (url.pathname === '/api/referral-config' && req.method === 'GET') {
      const rows = await query(
        `SELECT key, value FROM game_config WHERE key LIKE 'referral.%' AND is_active = true`
      );
      const overrides = {};
      for (const r of rows) {
        try { overrides[r.key] = JSON.parse(r.value); } catch { overrides[r.key] = r.value; }
      }
      json(overrides); return;
    }

    if (url.pathname === '/api/referral-config' && req.method === 'POST') {
      // Save referral config overrides to game_config table
      const entries = Object.entries(body);
      for (const [key, value] of entries) {
        if (!key.startsWith('referral.')) continue;
        await query(
          `INSERT INTO game_config (key, value, updated_by, updated_at)
           VALUES ($1, $2, 'admin', NOW())
           ON CONFLICT (key) DO UPDATE SET value = $2, updated_by = 'admin', updated_at = NOW()`,
          [key, JSON.stringify(value)]
        );
      }
      json({ ok: true, updated: entries.length }); return;
    }

    if (url.pathname === '/api/referral-stats' && req.method === 'GET') {
      const statsRow = await query(`
        SELECT
          (SELECT COUNT(*) FROM users WHERE referred_by IS NOT NULL AND is_banned = false) AS total_referrals,
          (SELECT COUNT(*) FROM users WHERE referred_by IS NOT NULL AND referral_activated = true AND is_banned = false) AS activated_referrals,
          (SELECT COALESCE(SUM(amount), 0) FROM referral_earnings WHERE currency = 'credits') AS total_credits_awarded,
          (SELECT COALESCE(SUM(amount), 0) FROM referral_earnings WHERE currency = 'stars') AS total_stars_awarded,
          (SELECT COUNT(DISTINCT referrer_id) FROM referral_earnings) AS referrers_with_income
      `);
      const raw = statsRow[0] || {};
      const stats = {
        totalReferrals: Number(raw.total_referrals || 0),
        activatedReferrals: Number(raw.activated_referrals || 0),
        totalCreditsAwarded: Number(raw.total_credits_awarded || 0),
        totalStarsAwarded: Number(raw.total_stars_awarded || 0),
        referrersWithIncome: Number(raw.referrers_with_income || 0),
      };
      const topReferrers = await query(`
        SELECT u.id AS user_id, u.first_name, u.username,
               COUNT(*) FILTER (WHERE r.referral_activated = true) AS activated_count,
               COUNT(*) AS referral_count
        FROM users u
        JOIN users r ON r.referred_by = u.id AND r.is_banned = false
        GROUP BY u.id, u.first_name, u.username
        ORDER BY activated_count DESC
        LIMIT 10
      `);
      json({ ...stats, topReferrers }); return;
    }

    // ── Chat Source Analytics ────────────────────────────────────────────────
    if (url.pathname === '/api/chat-sources' && req.method === 'GET') {
      await query(`ALTER TABLE chat_sources ADD COLUMN IF NOT EXISTS chat_auto_delete_low_rarity BOOLEAN NOT NULL DEFAULT false`);
      const rows = await query(`
        SELECT
          cs.id,
          cs.chat_id,
          cs.chat_title,
          cs.owner_user_id,
          cs.owner_username,
          ou.username AS owner_current_username,
          cs.chat_auto_delete_low_rarity,
          cs.group_id,
          cs.link_code,
          cs.owner_share_percent,
          cs.stars_total_received,
          cs.stars_since_clear,
          cs.created_at,
          cs.updated_at,
          COALESCE((
            SELECT COUNT(*)::int
            FROM users u
            WHERE u.registration_chat_id = cs.chat_id
          ), 0) AS registrations,
          COALESCE((
            SELECT COALESCE(SUM(st.amount), 0)::bigint
            FROM users u
            JOIN stars_transactions st ON st.user_id = u.id AND st.type = 'topup'
            WHERE u.registration_chat_id = cs.chat_id
          ), 0) AS donated_stars_total
        FROM chat_sources cs
        LEFT JOIN users ou ON ou.id = cs.owner_user_id
        ORDER BY registrations DESC, cs.updated_at DESC
      `);
      json({ chatSources: rows }); return;
    }

    if (url.pathname === '/api/chat-sources' && req.method === 'POST') {
      await query(`ALTER TABLE chat_sources ADD COLUMN IF NOT EXISTS chat_auto_delete_low_rarity BOOLEAN NOT NULL DEFAULT false`);
      const b = await body();
      const { chatId, chatTitle, ownerUserId, ownerUsername, ownerSharePercent, linkCode, chatAutoDeleteLowRarity } = b || {};
      if (!chatId) { json({ error: 'chatId required' }, 400); return; }

      const code = String(linkCode || `chat_${Math.abs(Number(chatId)) || Date.now()}`)
        .trim()
        .replace(/[^a-zA-Z0-9_-]/g, '_');

      const rows = await query(
        `INSERT INTO chat_sources (
           chat_id, chat_title, owner_user_id, owner_username, link_code, owner_share_percent, chat_auto_delete_low_rarity,
           stars_total_received, stars_since_clear, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, 0, 0, NOW())
         ON CONFLICT (chat_id) DO UPDATE SET
           chat_title = EXCLUDED.chat_title,
           owner_user_id = EXCLUDED.owner_user_id,
           owner_username = EXCLUDED.owner_username,
           link_code = COALESCE(EXCLUDED.link_code, chat_sources.link_code),
           owner_share_percent = EXCLUDED.owner_share_percent,
           chat_auto_delete_low_rarity = EXCLUDED.chat_auto_delete_low_rarity,
           updated_at = NOW()
         RETURNING *`,
        [chatId, chatTitle || null, ownerUserId || null, ownerUsername || null, code, ownerSharePercent || 0, Boolean(chatAutoDeleteLowRarity)]
      );
      json({ ok: true, chatSource: rows[0] }); return;
    }

    if (url.pathname.match(/^\/api\/chat-sources\/[^/]+$/) && req.method === 'PATCH') {
      const chatId = url.pathname.split('/')[3];
      const b = await body();
      await query(`ALTER TABLE chat_sources ADD COLUMN IF NOT EXISTS chat_auto_delete_low_rarity BOOLEAN NOT NULL DEFAULT false`);
      const { ownerUserId, ownerUsername, ownerSharePercent, chatTitle, linkCode, chatAutoDeleteLowRarity } = b || {};
      console.log('[PATCH] chatId:', chatId, 'body:', JSON.stringify(b), 'ownerSharePercent:', ownerSharePercent, 'type:', typeof ownerSharePercent);
      const fields = [];
      const values = [];
      let idx = 1;

      // Only update fields that are explicitly provided (not undefined)
      if (ownerUserId !== undefined) { fields.push(`owner_user_id = $${idx++}`); values.push(ownerUserId || null); }
      if (ownerUsername !== undefined) { fields.push(`owner_username = $${idx++}`); values.push(ownerUsername || null); }
      if (ownerSharePercent !== undefined) { fields.push(`owner_share_percent = $${idx++}`); values.push(ownerSharePercent || 0); }
      if (chatAutoDeleteLowRarity !== undefined) { fields.push(`chat_auto_delete_low_rarity = $${idx++}`); values.push(Boolean(chatAutoDeleteLowRarity)); }
      if (chatTitle !== undefined) { fields.push(`chat_title = $${idx++}`); values.push(chatTitle || null); }
      if (linkCode !== undefined) {
        fields.push(`link_code = $${idx++}`);
        values.push(String(linkCode || '').trim() || null);
      }
      
      // If no fields to update, still set updated_at and return the current record
      if (!fields.length) {
        fields.push('updated_at = NOW()');
        const rows = await query(
          `UPDATE chat_sources SET ${fields.join(', ')} WHERE chat_id = $1 RETURNING *`,
          [chatId]
        );
        json({ ok: true, chatSource: rows[0] || null }); return;
      }

      fields.push('updated_at = NOW()');
      values.push(chatId);
      const rows = await query(
        `UPDATE chat_sources SET ${fields.join(', ')} WHERE chat_id = $${idx} RETURNING *`,
        values
      );
      json({ ok: true, chatSource: rows[0] || null }); return;
    }

    if (url.pathname.match(/^\/api\/chat-sources\/[^/]+\/clear-stars$/) && req.method === 'POST') {
      const chatId = url.pathname.split('/')[3];
      const rows = await query(
        `UPDATE chat_sources
         SET stars_since_clear = 0,
             updated_at = NOW()
         WHERE chat_id = $1
         RETURNING *`,
        [chatId]
      );
      json({ ok: true, chatSource: rows[0] || null }); return;
    }

    if (url.pathname.match(/^\/api\/chat-sources\/[^/]+\/users$/) && req.method === 'GET') {
      const chatId = url.pathname.split('/')[3];
      const limitRaw = parseInt(url.searchParams.get('limit') || '100', 10);
      const offsetRaw = parseInt(url.searchParams.get('offset') || '0', 10);
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 500)) : 100;
      const offset = Number.isFinite(offsetRaw) ? Math.max(0, offsetRaw) : 0;

      const users = await query(
        `SELECT
           u.id,
           u.username,
           u.first_name,
           u.last_name,
           u.level,
           u.total_stars_spent,
           u.total_expeditions,
           u.registration_source_type,
           u.created_at,
           u.last_active_at,
           COALESCE((
             SELECT SUM(st.amount)::bigint
             FROM stars_transactions st
             WHERE st.user_id = u.id AND st.type = 'topup'
           ), 0) AS total_stars_donated
         FROM users u
         WHERE u.registration_chat_id = $1
         ORDER BY u.created_at DESC
         LIMIT $2 OFFSET $3`,
        [chatId, limit, offset]
      );

      const total = await query(
        'SELECT COUNT(*)::int AS cnt FROM users WHERE registration_chat_id = $1',
        [chatId]
      );

      json({ users, total: Number(total[0]?.cnt || 0) }); return;
    }

    if (url.pathname.match(/^\/api\/referral-referrer\/[^/]+$/) && req.method === 'GET') {
      const referrerId = url.pathname.split('/')[3];
      const limitRaw = parseInt(url.searchParams.get('limit') || '200', 10);
      const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 1000)) : 200;

      const [referrer] = await query(
        `SELECT id, username, first_name, last_name
         FROM users
         WHERE id = $1`,
        [referrerId]
      );
      if (!referrer) { json({ error: 'Referrer not found' }, 404); return; }

      const referrals = await query(
        `SELECT
            r.id,
            r.username,
            r.first_name,
            r.last_name,
            r.referral_activated,
            r.total_expeditions,
            r.total_finds,
            r.credits,
            r.created_at,
            r.last_active_at,
            r.is_banned
         FROM users r
         WHERE r.referred_by = $1
         ORDER BY r.created_at DESC
         LIMIT $2`,
        [referrerId, limit]
      );

      const [totals] = await query(
        `SELECT
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE referral_activated = true) AS activated
         FROM users
         WHERE referred_by = $1`,
        [referrerId]
      );

      json({
        referrer,
        total: Number(totals?.total || 0),
        activated: Number(totals?.activated || 0),
        referrals,
      });
      return;
    }

    // ── Quest Templates Config ──────────────────────────────────────────────

    if ((url.pathname === '/api/quest-config' || url.pathname === '/api/admin/quests/config') && req.method === 'GET') {
      // Return quest config overrides (or empty if defaults)
      const rows = await query(
        `SELECT key, value FROM game_config WHERE key LIKE 'quests.%' AND is_active = true`
      );
      const overrides = {};
      for (const r of rows) {
        try { overrides[r.key] = JSON.parse(r.value); } catch { overrides[r.key] = r.value; }
      }
      json(overrides); return;
    }

    if ((url.pathname === '/api/quest-config' && req.method === 'POST') || (url.pathname === '/api/admin/quests/config' && req.method === 'PUT')) {
      const entries = await body();
      for (const [key, value] of Object.entries(entries)) {
        // Support both payload styles:
        // 1) {"quests.daily": {...}}
        // 2) {daily: {...}, weekly: {...}}
        const cfgKey = key.startsWith('quests.') ? key : `quests.${key}`;
        await query(
          `INSERT INTO game_config (key, value, updated_by, updated_at)
           VALUES ($1, $2, 'admin', NOW())
           ON CONFLICT (key) DO UPDATE SET value = $2, updated_by = 'admin', updated_at = NOW(), is_active = true`,
          [cfgKey, JSON.stringify(value)]
        );
      }
      json({ ok: true }); return;
    }

    if ((url.pathname === '/api/quest-templates' || url.pathname === '/api/admin/quests/templates') && req.method === 'GET') {
      // Load DB overrides first; if missing, use defaults from backend gameConfig.js.
      const rows = await query(
        `SELECT value FROM game_config WHERE key = 'quests.templates' AND is_active = true`
      );
      if (rows.length) {
        try {
          const parsed = JSON.parse(rows[0].value);
          if (Array.isArray(parsed)) {
            json({ templates: parsed, source: 'db' });
          } else {
            json({ templates: loadDefaultQuestTemplates(), source: 'gameConfig' });
          }
        } catch {
          json({ templates: loadDefaultQuestTemplates(), source: 'gameConfig' });
        }
      } else {
        json({ templates: loadDefaultQuestTemplates(), source: 'gameConfig' });
      }
      return;
    }

    if ((url.pathname === '/api/quest-templates' && req.method === 'POST') || (url.pathname === '/api/admin/quests/templates-bulk' && req.method === 'PUT')) {
      const { templates } = await body();
      if (!Array.isArray(templates)) { json({ error: 'templates array required' }, 400); return; }
      await query(
        `INSERT INTO game_config (key, value, updated_by, updated_at)
         VALUES ('quests.templates', $1, 'admin', NOW())
         ON CONFLICT (key) DO UPDATE SET value = $1, updated_by = 'admin', updated_at = NOW(), is_active = true`,
        [JSON.stringify(templates)]
      );
      json({ ok: true, count: templates.length }); return;
    }

    if ((url.pathname === '/api/quest-templates/reset' || url.pathname === '/api/admin/quests/templates-reset') && req.method === 'POST') {
      await query(`DELETE FROM game_config WHERE key = 'quests.templates'`);
      json({ ok: true, message: 'Templates reset to defaults' }); return;
    }

    if ((url.pathname === '/api/quest-wipe-refresh' || url.pathname === '/api/admin/quests/wipe-refresh') && req.method === 'POST') {
      await query('DELETE FROM user_quest_refresh WHERE TRUE');
      await query(`DELETE FROM user_quests WHERE status = 'active'`);
      json({ ok: true, message: 'Quest refresh timers and active quests wiped' }); return;
    }

    // ── Analytics: tracking links ─────────────────────────────────────────────
    if (url.pathname === '/api/analytics/links' && req.method === 'GET') {
      const links = await query(
        `SELECT source, label, starts_count, unique_users, created_at, last_start_at, updated_at
         FROM start_link_analytics ORDER BY created_at DESC`
      );
      json({ links }); return;
    }

    if (url.pathname === '/api/analytics/links' && req.method === 'POST') {
      const { source, label } = await body();
      if (!source || !/^[a-zA-Z0-9_-]+$/.test(source) || source.length > 80) {
        json({ error: 'source: только латиница, цифры, _ и -, макс 80 символов' }, 400); return;
      }
      await query(
        `INSERT INTO start_link_analytics (source, label, starts_count, unique_users, created_at)
         VALUES ($1, $2, 0, 0, NOW())
         ON CONFLICT (source) DO UPDATE SET label = $2, updated_at = NOW()`,
        [source, label || '']
      );
      json({ ok: true }); return;
    }

    // Delete a tracking link
    if (url.pathname.startsWith('/api/analytics/links/') && req.method === 'DELETE') {
      const src = decodeURIComponent(url.pathname.split('/').pop());
      await query('DELETE FROM link_start_events WHERE source = $1', [src]);
      await query('DELETE FROM start_link_analytics WHERE source = $1', [src]);
      json({ ok: true }); return;
    }

    // Detailed events for a specific source
    if (url.pathname.startsWith('/api/analytics/events/') && req.method === 'GET') {
      const src = decodeURIComponent(url.pathname.split('/').pop());
      const days = parseInt(url.searchParams?.get('days') || '30') || 30;
      // Daily breakdown
      const daily = await query(
        `SELECT DATE(created_at) AS day,
                COUNT(*)::int AS starts,
                COUNT(DISTINCT user_id)::int AS unique_users,
                COUNT(*) FILTER (WHERE is_new_user)::int AS new_users
         FROM link_start_events
         WHERE source = $1 AND created_at > NOW() - ($2 || ' days')::INTERVAL
         GROUP BY DATE(created_at) ORDER BY day DESC`,
        [src, String(days)]
      );
      // Recent events
      const recent = await query(
        `SELECT e.user_id, u.username, e.is_new_user, e.created_at
         FROM link_start_events e
         LEFT JOIN users u ON u.id = e.user_id
         WHERE e.source = $1
         ORDER BY e.created_at DESC LIMIT 50`,
        [src]
      );
      json({ daily, recent }); return;
    }

    // Bot username for generating links
    if (url.pathname === '/api/analytics/bot-info' && req.method === 'GET') {
      const { botToken } = loadConfig();
      if (!botToken) { json({ username: null }); return; }
      try {
        const data = await new Promise((resolve, reject) => {
          https.get(`https://api.telegram.org/bot${botToken}/getMe`, (r) => {
            let d = '';
            r.on('data', c => d += c);
            r.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(e); } });
          }).on('error', reject);
        });
        json({ username: data?.result?.username || null });
      } catch { json({ username: null }); }
      return;
    }

    if (url.pathname === '/api/analytics/suspicious-expeditions' && req.method === 'GET') {
      const daysRaw = parseInt(url.searchParams?.get('days') || '30', 10);
      const topRaw = parseInt(url.searchParams?.get('top') || '20', 10);
      const minRaw = parseInt(url.searchParams?.get('min') || '80', 10);
      const userId = String(url.searchParams?.get('userId') || '').trim() || null;

      const days = clamp(Number.isFinite(daysRaw) ? daysRaw : 30, 1, 365);
      const topN = clamp(Number.isFinite(topRaw) ? topRaw : 20, 1, 200);
      const minExpeditions = clamp(Number.isFinite(minRaw) ? minRaw : 80, 1, 10000);

      let rows;
      try {
        rows = await fetchExpeditionRowsForSuspicion(days);
      } catch {
        _pool = null;
        const { connectionString } = loadConfig();
        _pool = new Pool({ connectionString, ssl: false, max: 5, connectionTimeoutMillis: 10000 });
        rows = await fetchExpeditionRowsForSuspicion(days);
      }

      if (!rows.length) {
        json({
          ok: true,
          meta: { days, topN, minExpeditions, totalRows: 0, analyzedUsers: 0 },
          top: [],
          user: null,
        });
        return;
      }

      const byUser = new Map();
      for (const row of rows) {
        const key = String(row.user_id);
        if (!byUser.has(key)) byUser.set(key, []);
        byUser.get(key).push(row);
      }

      const profiles = [];
      for (const userRows of byUser.values()) {
        if (userRows.length < minExpeditions) continue;
        profiles.push(buildSuspicionProfile(userRows));
      }

      profiles.sort((a, b) => b.suspicion - a.suspicion);
      const top = profiles.slice(0, topN);

      let user = null;
      if (userId) {
        user = profiles.find((p) => String(p.userId) === userId) || null;
        if (!user) {
          const directRows = byUser.get(userId);
          if (directRows && directRows.length) user = buildSuspicionProfile(directRows);
        }
      }

      json({
        ok: true,
        meta: {
          days,
          topN,
          minExpeditions,
          totalRows: rows.length,
          analyzedUsers: profiles.length,
          totalUsersInWindow: byUser.size,
        },
        top,
        user,
      });
      return;
    }

    // ── Prestige management ───────────────────────────────────────────────────
    if (url.pathname === '/api/admin/prestiges' && req.method === 'GET') {
      const limit = Math.min(Number(url.searchParams.get('limit') || 50), 200);
      const offset = Number(url.searchParams.get('offset') || 0);
      try {
        const history = await query(
          `SELECT p.*, u.username, u.first_name
           FROM user_prestiges p
           JOIN users u ON u.id = p.user_id
           ORDER BY p.achieved_at DESC
           LIMIT $1 OFFSET $2`,
          [limit, offset]
        );
        json({ history }); return;
      } catch(e) {
        if (e.code === '42P01') { json({ history: [], note: 'Table user_prestiges does not exist yet' }); return; }
        json({ error: e.message }, 500); return;
      }
    }

    if (url.pathname.match(/^\/api\/admin\/prestiges\/[^/]+\/set$/) && req.method === 'POST') {
      const userId = url.pathname.split('/')[4];
      const { prestigeLevel } = await body();
      if (prestigeLevel === undefined || prestigeLevel < 0 || prestigeLevel > 3) {
        json({ error: 'prestigeLevel must be 0–3' }, 400); return;
      }
      await query('UPDATE users SET prestige_level = $1 WHERE id = $2', [prestigeLevel, userId]);
      json({ ok: true, userId, prestigeLevel }); return;
    }

    if (url.pathname.match(/^\/api\/admin\/prestiges\/[^/]+$/) && req.method === 'GET') {
      const userId = url.pathname.split('/')[4];
      try {
        const history = await query(
          `SELECT prestige_level, achieved_at FROM user_prestiges
           WHERE user_id = $1 ORDER BY prestige_level`,
          [userId]
        );
        const [row] = await query('SELECT prestige_level FROM users WHERE id = $1', [userId]);
        const status = row ? { prestigeLevel: Number(row.prestige_level || 0) } : null;
        json({ history, status }); return;
      } catch(e) {
        if (e.code === '42P01') { json({ history: [], status: null }); return; }
        json({ error: e.message }, 500); return;
      }
    }

    // ── News management ───────────────────────────────────────────────────────
    if (url.pathname === '/api/admin/news' && req.method === 'GET') {
      const rows = await query(
        `SELECT id, title_ru, title_en, description_ru, description_en, icon, is_visible, updated_at
         FROM game_news LIMIT 1`
      );
      const news = rows[0] || null;
      json({ news: news ? {
        id: news.id,
        titleRu: news.title_ru,
        titleEn: news.title_en,
        descriptionRu: news.description_ru,
        descriptionEn: news.description_en,
        icon: news.icon,
        isVisible: news.is_visible,
        updatedAt: news.updated_at,
      } : null }); return;
    }

    if (url.pathname === '/api/admin/news' && req.method === 'POST') {
      const { titleRu, titleEn, descriptionRu, descriptionEn, icon } = await body();
      const existing = await query(`SELECT id FROM game_news LIMIT 1`);
      if (existing.length) {
        await query(
          `UPDATE game_news SET title_ru=$1, title_en=$2, description_ru=$3, description_en=$4, icon=$5, updated_at=NOW() WHERE id=$6`,
          [titleRu || '', titleEn || '', descriptionRu || '', descriptionEn || '', icon || '📰', existing[0].id]
        );
      } else {
        await query(
          `INSERT INTO game_news (title_ru, title_en, description_ru, description_en, icon, is_visible) VALUES ($1,$2,$3,$4,$5,false)`,
          [titleRu || '', titleEn || '', descriptionRu || '', descriptionEn || '', icon || '📰']
        );
      }
      json({ ok: true }); return;
    }

    if (url.pathname === '/api/admin/news/visibility' && req.method === 'POST') {
      const { visible } = await body();
      const existing = await query(`SELECT id FROM game_news LIMIT 1`);
      if (!existing.length) { json({ error: 'Новость не создана' }, 400); return; }
      await query(`UPDATE game_news SET is_visible=$1, updated_at=NOW()`, [Boolean(visible)]);
      json({ ok: true }); return;
    }

    // ── Stats ─────────────────────────────────────────────────────────────────
    if (url.pathname === '/api/stats' && req.method === 'GET') {
      const [s] = await query(`SELECT
        (SELECT COUNT(*) FROM users) AS total_users,
        (SELECT COUNT(*) FROM users WHERE last_active_at > NOW() - INTERVAL '24 hours') AS active_today,
        (SELECT COUNT(*) FROM expeditions WHERE status = 'in_progress') AS active_expeditions,
        (SELECT COUNT(*) FROM nft_notifications WHERE admin_processed = false) AS pending_nfts,
        (SELECT COUNT(*) FROM users WHERE is_banned = true) AS banned_users,
        CASE
          WHEN to_regclass('public.start_link_analytics') IS NULL THEN 0
          ELSE (SELECT COALESCE(SUM(starts_count), 0) FROM start_link_analytics)
        END AS ad_starts`);
      json(s); return;
    }

    res.writeHead(404); res.end('Not found');
  } catch (err) {
    console.error(err.message);
    json({ error: err.message }, 500);
  }
});

server.listen(PORT, () => {
  console.log(`\n🚀 Admin Panel: http://localhost:${PORT}\n`);
  require('child_process').exec(`start http://localhost:${PORT}`);
});
