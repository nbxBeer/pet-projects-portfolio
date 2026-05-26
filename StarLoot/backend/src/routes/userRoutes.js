'use strict';

const { query } = require('../db/pool');
const { telegramAuthMiddleware, validateNonce } = require('../middleware/telegramAuth');

async function userRoutes(fastify, { userService, achievementService, eventService, customizationService, referralService, questService, newsService, miniTournamentService, bot }) {
  fastify.addHook('preHandler', telegramAuthMiddleware);

  const langFromCode = (code) => String(code || '').toLowerCase().startsWith('ru') ? 'ru' : 'en';

  const sendShareFallback = async ({ tgUserId, text, lang, appUrl }) => {
    const title = lang === 'ru' ? '📤 *Сообщение для пересылки*' : '📤 *Message to Forward*';
    const hint = lang === 'ru'
      ? '_Перешлите это сообщение в нужный чат._'
      : '_Forward this message to the target chat._';
    const buttonText = lang === 'ru' ? '🌌 В игру' : '🌌 Open game';

    const botClient = bot?.bot;
    if (!botClient || typeof botClient.sendMessage !== 'function') {
      return { ok: false, reason: 'bot_unavailable' };
    }

    const mdMessage = `${title}\n\n${text}\n\n${hint}`;

    try {
      await botClient.sendMessage(tgUserId, mdMessage, {
        parse_mode: 'Markdown',
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: [[{ text: buttonText, web_app: { url: appUrl } }]],
        },
      });
      return { ok: true };
    } catch (err) {
      const msg = String(err?.message || '').toLowerCase();
      if (
        msg.includes('forbidden') ||
        msg.includes('chat not found') ||
        msg.includes('bot was blocked')
      ) {
        return { ok: false, reason: 'dm_unavailable' };
      }
      return { ok: false, reason: 'send_failed' };
    }
  };

  fastify.get('/api/user/profile', async (req, reply) => {
    const profile = await userService.getProfile(req.user.id);
    // Eagerly initialize quests so trackProgress works from the first expedition
    if (questService) {
      setImmediate(() => questService.refreshIfNeeded(req.user.id, profile.level || 1, profile.currentUniverse || 1).catch(() => {}));
    }
    return reply.send(profile);
  });

  fastify.post('/api/user/accept-tos', async (req, reply) => {
    const incomingVersion = Number(req.body?.version || 1);
    const version = Number.isInteger(incomingVersion) && incomingVersion > 0 ? incomingVersion : 1;

    await query(
      `UPDATE users
       SET tos_accepted = true,
           tos_accepted_at = NOW(),
           tos_version = $1
       WHERE id = $2`,
      [version, req.user.id]
    );

    return reply.send({ ok: true, tosAccepted: true, tosVersion: version });
  });

  fastify.get('/api/user/stats', async (req, reply) => {
    const stats = await userService.getUserStats(req.user.id);
    return reply.send(stats);
  });

  fastify.get('/api/user/mini-tournament', async (req, reply) => {
    if (!miniTournamentService) {
      return reply.code(503).send({ error: 'Mini tournament service unavailable' });
    }
    const stats = await miniTournamentService.getUserStats(req.user.id);
    return reply.send(stats);
  });

  fastify.post('/api/admin/mini-tournament/mark-gift-issued', async (req, reply) => {
    if (!miniTournamentService) {
      return reply.code(503).send({ error: 'Mini tournament service unavailable' });
    }

    const adminId = process.env.ADMIN_TELEGRAM_ID ? parseInt(process.env.ADMIN_TELEGRAM_ID) : null;
    if (req.user.id !== adminId) {
      return reply.code(403).send({ error: 'Admin only' });
    }

    const { userId, milestone } = req.body || {};
    if (!userId || !milestone) {
      return reply.code(400).send({ error: 'Missing userId or milestone' });
    }

    try {
      const stats = await miniTournamentService.markGiftAsIssued(userId, milestone);
      return reply.send({ ok: true, stats });
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
  });

  fastify.get('/api/user/achievements', async (req, reply) => {
    const achievements = await userService.getUserAchievements(req.user.id);
    return reply.send({ achievements });
  });

  fastify.post('/api/user/select-achievement', async (req, reply) => {
    const { achievementId } = req.body || {};
    await userService.setSelectedAchievement(req.user.id, achievementId ?? null);
    return reply.send({ ok: true });
  });

  fastify.get('/api/user/zones', async (req, reply) => {
    const zones = await userService.getAvailableZones(req.user.id);
    return reply.send({ zones });
  });

  fastify.get('/api/user/inventory', async (req, reply) => {
    const { type, sortBy, sortDir, limit, offset } = req.query;
    const inventory = await userService.getInventory(req.user.id, {
      type,
      sortBy: sortBy || 'date',
      sortDir: sortDir || 'desc',
      limit: parseInt(limit || '50'),
      offset: parseInt(offset || '0'),
    });
    return reply.send(inventory);
  });

  fastify.post('/api/user/inventory/remote-scan', async (req, reply) => {
    const { itemId } = req.body || {};
    if (!itemId || typeof itemId !== 'string') {
      return reply.code(400).send({ error: 'itemId required' });
    }
    const result = await userService.remoteScanAsteroid(req.user.id, itemId);
    return reply.send(result);
  });

  fastify.post('/api/user/inventory/sell', async (req, reply) => {
    const { itemId, nonce } = req.body || {};
    if (!itemId || typeof itemId !== 'string') {
      return reply.code(400).send({ error: 'itemId required' });
    }
    if (!nonce) {
      return reply.code(400).send({ error: 'nonce required' });
    }
    const nonceValid = await validateNonce(nonce, req.user.id);
    if (!nonceValid) return reply.code(409).send({ error: 'Invalid or replayed nonce' });

    const result = await userService.sellInventoryItem(req.user.id, itemId);
    if (achievementService) setImmediate(() => achievementService.checkAndAward(req.user.id).catch(() => {}));
    if (referralService && result.creditsGained > 0) {
      setImmediate(() => referralService.creditPassiveIncome(req.user.id, result.creditsGained, 'sell_item').catch(() => {}));
    }
    if (questService && result.findType) {
      setImmediate(() => questService.trackProgress(req.user.id, 'sell', {
        findType: result.findType, rarity: result.rarity, amount: 1,
      }).catch(() => {}));
    }
    return reply.send(result);
  });

  fastify.post('/api/user/inventory/bulk-sell', async (req, reply) => {
    const { itemIds, nonce } = req.body || {};
    if (!Array.isArray(itemIds) || itemIds.length === 0) {
      return reply.code(400).send({ error: 'itemIds array required' });
    }
    if (!nonce) {
      return reply.code(400).send({ error: 'nonce required' });
    }
    const nonceValid = await validateNonce(nonce, req.user.id);
    if (!nonceValid) return reply.code(409).send({ error: 'Invalid or replayed nonce' });

    const result = await userService.bulkSellItems(req.user.id, itemIds);
    if (achievementService) setImmediate(() => achievementService.checkAndAward(req.user.id).catch(() => {}));
    if (referralService && result.totalCredits > 0) {
      setImmediate(() => referralService.creditPassiveIncome(req.user.id, result.totalCredits, 'sell_item').catch(() => {}));
    }
    return reply.send(result);
  });

  fastify.post('/api/user/share-message', async (req, reply) => {
    const text = String(req.body?.text || '').trim();
    if (!text) {
      return reply.code(400).send({ error: 'text required' });
    }
    if (text.length > 3500) {
      return reply.code(400).send({ error: 'text too long' });
    }

    const imageBase64 = req.body?.image || null;
    // Limit image size to ~5MB base64
    if (imageBase64 && imageBase64.length > 7_000_000) {
      return reply.code(400).send({ error: 'image too large' });
    }

    // Preferred path for updated backend versions.
    if (bot && typeof bot.sendShareMessage === 'function') {
      const result = await bot.sendShareMessage(req.user.id, text, req.user.language_code, imageBase64);
      return reply.send(result);
    }

    // Backward-compatible fallback
    const lang = langFromCode(req.user.language_code);
    const result = await sendShareFallback({
      tgUserId: req.user.id,
      text,
      lang,
      appUrl: process.env.MINI_APP_URL,
    });

    if (result.reason === 'bot_unavailable') {
      return reply.code(503).send({ error: 'Bot unavailable', reason: 'bot_unavailable' });
    }

    return reply.send(result);
  });

  fastify.get('/api/leaderboard', async (req, reply) => {
    const board = await userService.getLeaderboard({ by: req.query.by, requestingUserId: req.user.id });
    return reply.send(board);
  });

  // ── Global Events routes ───────────────────────────────────────────────────

  fastify.get('/api/events/active', async (req, reply) => {
    const event = await eventService.getActiveEvent();
    return reply.send({ event });
  });

  // ── News route ─────────────────────────────────────────────────────────────

  fastify.get('/api/news/active', async (req, reply) => {
    const news = newsService ? await newsService.getActiveNews() : null;
    return reply.send({ news });
  });

  // ── Customization routes ───────────────────────────────────────────────────

  fastify.get('/api/user/customization', async (req, reply) => {
    const data = await customizationService.getUserCustomization(req.user.id);
    return reply.send({ ...data, catalog: customizationService.catalog });
  });

  fastify.post('/api/user/customization/header-color', async (req, reply) => {
    const { color } = req.body || {};
    if (!color) return reply.code(400).send({ error: 'color required' });
    const result = await customizationService.setHeaderColor(req.user.id, color);
    return reply.send(result);
  });

  fastify.post('/api/user/customization/avatar', async (req, reply) => {
    const { avatarId } = req.body || {};
    if (!avatarId) return reply.code(400).send({ error: 'avatarId required' });
    const result = await customizationService.setAvatar(req.user.id, avatarId);
    return reply.send(result);
  });

  fastify.post('/api/user/customization/buy-decor', async (req, reply) => {
    const { decorId, nonce } = req.body || {};
    if (!decorId || !nonce) return reply.code(400).send({ error: 'decorId and nonce required' });
    const nonceValid = await validateNonce(nonce, req.user.id);
    if (!nonceValid) return reply.code(409).send({ error: 'Invalid or replayed nonce' });
    const result = await customizationService.purchaseDecor(req.user.id, decorId);
    return reply.send(result);
  });

  fastify.post('/api/user/customization/buy-support', async (req, reply) => {
    const { nonce } = req.body || {};
    if (!nonce) return reply.code(400).send({ error: 'nonce required' });
    const nonceValid = await validateNonce(nonce, req.user.id);
    if (!nonceValid) return reply.code(409).send({ error: 'Invalid or replayed nonce' });
    const result = await customizationService.purchaseSupport(req.user.id);
    // Award hidden achievement
    if (achievementService) setImmediate(() => achievementService.checkAndAward(req.user.id).catch(() => {}));
    return reply.send(result);
  });

  fastify.post('/api/user/customization/set-decor', async (req, reply) => {
    const { decorId } = req.body || {};
    const result = await customizationService.setDecor(req.user.id, decorId ?? null);
    return reply.send(result);
  });

  fastify.post('/api/user/customization/zone-glow', async (req, reply) => {
    const { glow } = req.body || {};
    const result = await customizationService.setZoneGlow(req.user.id, glow ?? null);
    return reply.send(result);
  });
}

module.exports = userRoutes;
