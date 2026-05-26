'use strict';

const crypto = require('crypto');
const { query } = require('../db/pool');
const logger = require('../utils/logger');

/**
 * Validates Telegram WebApp initData according to official Telegram documentation.
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 * Security properties:
 * - HMAC-SHA256 signature verification
 * - Timestamp freshness check (max 1 hour)
 * - Nonce replay attack prevention
 */

const MAX_AUTH_AGE_SECONDS = 3600; // 1 hour

/**
 * Parse and validate Telegram initData string.
 * @param {string} initData - Raw initData from Telegram.WebApp.initData
 * @param {string} botToken - Telegram bot token
 * @returns {{ valid: boolean, userData?: object, error?: string }}
 */
function validateTelegramInitData(initData, botToken) {
  if (!initData || typeof initData !== 'string') {
    return { valid: false, error: 'Missing initData' };
  }

  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return { valid: false, error: 'Missing hash' };

    // Build data-check-string: sorted key=value pairs excluding hash
    const entries = [];
    for (const [key, value] of params.entries()) {
      if (key !== 'hash') entries.push(`${key}=${value}`);
    }
    entries.sort();
    const dataCheckString = entries.join('\n');

    // Derive secret key: HMAC-SHA256("WebAppData", botToken)
    const secretKey = crypto
      .createHmac('sha256', 'WebAppData')
      .update(botToken)
      .digest();

    // Compute expected hash
    const expectedHash = crypto
      .createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest('hex');

    // Timing-safe comparison to prevent HMAC oracle / bot-token brute-force
    const expectedBuf = Buffer.from(expectedHash, 'hex');
    const actualBuf   = Buffer.from(hash.length === expectedHash.length ? hash : '', 'hex');
    if (expectedBuf.length !== actualBuf.length || !crypto.timingSafeEqual(expectedBuf, actualBuf)) {
      return { valid: false, error: 'Invalid signature' };
    }

    // Check freshness
    const authDate = parseInt(params.get('auth_date') || '0', 10);
    const now = Math.floor(Date.now() / 1000);
    if (now - authDate > MAX_AUTH_AGE_SECONDS) {
      return { valid: false, error: 'InitData expired' };
    }

    // Parse user data
    const userRaw = params.get('user');
    if (!userRaw) return { valid: false, error: 'Missing user data' };

    const userData = JSON.parse(userRaw);
    if (!userData.id) return { valid: false, error: 'Missing user id' };

    return {
      valid: true,
      userData,
      authDate,
      queryId: params.get('query_id'),
    };
  } catch (err) {
    logger.warn({ err }, 'initData validation error');
    return { valid: false, error: 'Validation failed' };
  }
}

/**
 * Fastify preHandler hook: authenticate and attach user to request.
 */
async function telegramAuthMiddleware(request, reply) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    logger.error('TELEGRAM_BOT_TOKEN is not set');
    return reply.code(500).send({ error: 'Server misconfiguration' });
  }

  const initData = request.headers['x-telegram-init-data'];
  if (!initData) {
    return reply.code(401).send({ error: 'Missing Telegram auth data' });
  }
  const startParam = String(request.headers['x-telegram-start-param'] || '').trim();
  request.telegramStartParam = startParam || null;

  const result = validateTelegramInitData(initData, botToken);
  if (!result.valid) {
    logger.warn({ ip: request.ip, error: result.error }, 'Auth failed');
    return reply.code(401).send({ error: result.error });
  }

  // Check/create user in DB
  try {
    const user = await upsertUser(result.userData, request.telegramStartParam);
    if (user.is_banned) {
      return reply.code(403).send({ error: 'Account suspended', reason: user.ban_reason });
    }
    request.telegramUser = result.userData;
    request.user = user;
  } catch (err) {
    logger.error({ err }, 'Failed to upsert user');
    return reply.code(500).send({ error: 'Internal server error' });
  }
}

async function upsertUser(telegramUser, startParam = null) {
  const { id, username, first_name, last_name, language_code } = telegramUser;

  const registration = await resolveRegistrationContext(startParam);

  const result = await query(
    `INSERT INTO users (
       id, username, first_name, last_name, language_code, last_active_at,
       registration_chat_id, registration_chat_title, registration_source_type
     )
     VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7, $8)
     ON CONFLICT (id) DO UPDATE SET
       username = EXCLUDED.username,
       first_name = EXCLUDED.first_name,
       last_name = EXCLUDED.last_name,
       last_active_at = NOW()
     RETURNING *`,
    [
      id,
      username,
      first_name,
      last_name,
      language_code || 'ru',
      registration.chatId,
      registration.chatTitle,
      registration.sourceType,
    ]
  );

  // Ensure ship modules exist
  await initializeShipModules(id);

  return result.rows[0];
}

async function resolveRegistrationContext(startParam) {
  const payload = String(startParam || '').trim();
  if (!payload) {
    return { chatId: null, chatTitle: null, sourceType: 'organic' };
  }

  const linkCode = payload.startsWith('chat_') && payload.length > 5 ? payload.slice(5) : payload;
  if (linkCode) {
    const result = await query(
      `SELECT chat_id, chat_title FROM chat_sources WHERE link_code = $1 LIMIT 1`,
      [linkCode]
    );
    if (result.rows.length > 0) {
      return { chatId: result.rows[0].chat_id, chatTitle: result.rows[0].chat_title || null, sourceType: 'chat_link' };
    }
  }

  if (payload.startsWith('src_') && payload.length > 4) {
    return { chatId: null, chatTitle: null, sourceType: 'ads_link' };
  }

  if (payload === 'ad' || payload.startsWith('ad_')) {
    return { chatId: null, chatTitle: null, sourceType: 'ads_link' };
  }

  return { chatId: null, chatTitle: null, sourceType: 'organic' };
}

async function initializeShipModules(userId) {
  await query(
    `INSERT INTO ship_modules (user_id, module_type, level)
     VALUES ($1, 'scanner', 0), ($1, 'engine', 0), ($1, 'cargo', 0), ($1, 'capsule', 0)
     ON CONFLICT (user_id, module_type) DO NOTHING`,
    [userId]
  );
}

/**
 * Anti-replay: check and consume a nonce.
 */
async function validateNonce(nonce, userId) {
  if (!nonce || nonce.length < 16 || nonce.length > 128) return false;

  // Check nonce format
  if (!/^[a-zA-Z0-9_-]+$/.test(nonce)) return false;

  try {
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes
    const result = await query(
      `INSERT INTO used_nonces (nonce, user_id, expires_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (nonce) DO NOTHING
       RETURNING nonce`,
      [nonce, userId, expiresAt]
    );
    return result.rows.length > 0;
  } catch {
    return false;
  }
}

/**
 * Cleanup expired nonces (call periodically).
 */
async function cleanupNonces() {
  const result = await query('DELETE FROM used_nonces WHERE expires_at < NOW()');
  logger.debug(`Cleaned up ${result.rowCount} expired nonces`);
}

module.exports = {
  telegramAuthMiddleware,
  validateTelegramInitData,
  validateNonce,
  cleanupNonces,
  resolveRegistrationContext,
  upsertUser,
};
