'use strict';

const crypto = require('crypto');
const { query } = require('../db/pool');

async function adminAuthMiddleware(req, reply) {
  const secret = req.headers['x-admin-secret'];
  const adminSecret = process.env.ADMIN_SECRET || '';
  // Timing-safe comparison to prevent secret enumeration via timing (H1 fix)
  if (!secret || !adminSecret) {
    return reply.code(403).send({ error: 'Forbidden' });
  }
  const secretBuf   = Buffer.from(secret);
  const expectedBuf = Buffer.from(adminSecret);
  const valid = secretBuf.length === expectedBuf.length &&
    crypto.timingSafeEqual(secretBuf, expectedBuf);
  if (!valid) {
    return reply.code(403).send({ error: 'Forbidden' });
  }
}

async function adminRoutes(fastify, { nftNotificationService, userService, eventService, tournamentService, bot, starsWalletService, configManager, questService, newsService, prestigeService }) {

  // ── NFT pending (also accessible from Telegram-authed scope in old code) ──

  fastify.get('/api/admin/nft-pending', {
    preHandler: adminAuthMiddleware,
  }, async (req, reply) => {
    const items = await nftNotificationService.getPendingNotifications();
    return reply.send({ items });
  });

  // ── Global Events admin ───────────────────────────────────────────────────
  /**
   * POST /api/admin/events
   * Create a global event.
   * Body: { title, description, icon, type, multiplier, durationHours }
   *   type: 'xp_boost' | 'credit_boost' | 'rare_chance' | 'custom'
   *   multiplier: number (e.g. 2.0 for double XP)
   *   durationHours: how many hours the event lasts
   * Example:
   *   curl -X POST https://yourhost/api/admin/events \
   *     -H "X-Admin-Secret: <secret>" \
   *     -H "Content-Type: application/json" \
   *     -d '{"title":"Двойной опыт!","description":"Все экспедиции дают x2 XP","icon":"⭐","type":"xp_boost","multiplier":2,"durationHours":24}'
   */
  fastify.post('/api/admin/events', {
    preHandler: adminAuthMiddleware,
  }, async (req, reply) => {
    const { title, description, icon, durationHours, effects } = req.body || {};
    if (!title || !durationHours) {
      return reply.code(400).send({ error: 'title and durationHours are required' });
    }
    const event = await eventService.createEvent({ title, description, icon, durationHours, effects: effects || [] });
    // Notify Telegram group if bot is configured
    if (bot) setImmediate(() => bot.notifyGroupEventStarted(event).catch(() => {}));
    return reply.send({ ok: true, event });
  });

  /**
   * POST /api/admin/events/:id/end
   * End an active event early.
   * Example:
   *   curl -X POST https://yourhost/api/admin/events/<event-uuid>/end \
   *     -H "X-Admin-Secret: <secret>"
   */
  fastify.post('/api/admin/events/:id/end', {
    preHandler: adminAuthMiddleware,
  }, async (req, reply) => {
    const event = await eventService.endEvent(req.params.id);
    return reply.send({ ok: true, event });
  });

  /**
   * GET /api/admin/events
   * List all events (active and past).
   */
  fastify.get('/api/admin/events', {
    preHandler: adminAuthMiddleware,
  }, async (req, reply) => {
    const events = await eventService.listEvents();
    return reply.send({ events });
  });

  // ── Tournaments admin ─────────────────────────────────────────────────────

  /**
   * POST /api/admin/tournaments
   * Create a tournament.
   * Body: { title, description, icon, durationHours, scoringType, prizeDescription }
   *   scoringType: 'xp_earned' | 'finds_count' | 'credits_earned'
   */
  fastify.post('/api/admin/tournaments', {
    preHandler: adminAuthMiddleware,
  }, async (req, reply) => {
    const { title, description, icon, durationHours, scoringType, prizeDescription } = req.body || {};
    if (!title || !durationHours) {
      return reply.code(400).send({ error: 'title and durationHours are required' });
    }
    const tournament = await tournamentService.createTournament({
      title, description, icon, durationHours, scoringType, prizeDescription,
    });
    if (bot) setImmediate(() => bot.notifyGroupTournamentStarted(tournament).catch(() => {}));
    return reply.send({ ok: true, tournament });
  });

  /**
   * POST /api/admin/tournaments/:id/end
   * End a tournament early.
   */
  fastify.post('/api/admin/tournaments/:id/end', {
    preHandler: adminAuthMiddleware,
  }, async (req, reply) => {
    const tournament = await tournamentService.endTournament(req.params.id);
    return reply.send({ ok: true, tournament });
  });

  /**
   * GET /api/admin/tournaments
   * List all tournaments.
   */
  fastify.get('/api/admin/tournaments', {
    preHandler: adminAuthMiddleware,
  }, async (req, reply) => {
    const tournaments = await tournamentService.listTournaments();
    return reply.send({ tournaments });
  });

  // ── Stars Refunds ────────────────────────────────────────────────────────

  /**
   * GET /api/admin/refundable/:userId
   * List refundable (non-refunded) topup transactions for a user.
   */
  fastify.get('/api/admin/refundable/:userId', {
    preHandler: adminAuthMiddleware,
  }, async (req, reply) => {
    if (!starsWalletService) return reply.code(503).send({ error: 'Stars service unavailable' });
    const transactions = await starsWalletService.getRefundableTransactions(Number(req.params.userId));
    return reply.send({ transactions });
  });

  /**
   * POST /api/admin/refund
   * Refund a Telegram Stars payment.
   * Body: { userId, telegramPaymentChargeId, reason? }
   *
   * This calls Telegram's refundStarPayment API — Stars go back to user's
   * Telegram wallet, and in-game balance is reduced accordingly.
   *
   * Example:
   *   curl -X POST https://yourhost/api/admin/refund \
   *     -H "X-Admin-Secret: <secret>" \
   *     -H "Content-Type: application/json" \
   *     -d '{"userId":123456789,"telegramPaymentChargeId":"charge_abc123","reason":"По запросу пользователя"}'
   */
  fastify.post('/api/admin/refund', {
    preHandler: adminAuthMiddleware,
  }, async (req, reply) => {
    if (!starsWalletService) return reply.code(503).send({ error: 'Stars service unavailable' });
    const { userId, telegramPaymentChargeId, reason } = req.body || {};
    if (!userId || !telegramPaymentChargeId) {
      return reply.code(400).send({ error: 'userId and telegramPaymentChargeId required' });
    }
    const result = await starsWalletService.refundStarPayment(
      Number(userId), telegramPaymentChargeId, reason || 'Admin refund'
    );
    return reply.send({ ok: true, ...result });
  });

  fastify.post('/api/admin/notify-nft', {
    preHandler: adminAuthMiddleware,
  }, async (req, reply) => {
    const { userId, outcomeType, outcomeLabel } = req.body || {};
    if (!userId || !outcomeType || !outcomeLabel) {
      return reply.code(400).send({ error: 'userId, outcomeType and outcomeLabel are required' });
    }

    // Fetch user from DB
    const userRes = await query(
      'SELECT id, username, first_name FROM users WHERE id = $1',
      [String(userId)]
    );
    if (!userRes.rows.length) {
      return reply.code(404).send({ error: 'User not found' });
    }
    const user = userRes.rows[0];

    await nftNotificationService.sendAdminNotification({
      userId: user.id,
      username: user.username,
      firstName: user.first_name,
      outcomeType,
      outcomeLabel,
    });

    return reply.send({ ok: true });
  });

  // ── Quest Templates admin ─────────────────────────────────────────────────

  /**
   * GET /api/admin/quests/templates
   * List all quest templates (merged config).
   */
  fastify.get('/api/admin/quests/templates', {
    preHandler: adminAuthMiddleware,
  }, async (req, reply) => {
    const cfg = configManager.get('quests');
    return reply.send({ templates: cfg.templates || [] });
  });

  /**
   * PUT /api/admin/quests/templates/:id
   * Update a single quest template field(s).
   * Body: partial template object, e.g. { amountRange: [1,2], targetRarities: ['rare'] }
   */
  fastify.put('/api/admin/quests/templates/:id', {
    preHandler: adminAuthMiddleware,
  }, async (req, reply) => {
    const templateId = req.params.id;
    const updates = req.body || {};
    if (!templateId || Object.keys(updates).length === 0) {
      return reply.code(400).send({ error: 'Template ID and update fields required' });
    }

    const templates = [...(configManager.get('quests.templates') || configManager.get('quests')?.templates || [])];
    const idx = templates.findIndex(t => t.id === templateId);
    if (idx === -1) return reply.code(404).send({ error: 'Template not found' });

    // Merge updates (don't allow changing id/faction)
    const { id: _id, faction: _f, ...safeUpdates } = updates;
    templates[idx] = { ...templates[idx], ...safeUpdates };

    await configManager.set('quests.templates', templates);
    return reply.send({ ok: true, template: templates[idx] });
  });

  /**
   * POST /api/admin/quests/templates
   * Add a new quest template.
   */
  fastify.post('/api/admin/quests/templates', {
    preHandler: adminAuthMiddleware,
  }, async (req, reply) => {
    const tmpl = req.body || {};
    if (!tmpl.id || !tmpl.faction || !tmpl.type) {
      return reply.code(400).send({ error: 'id, faction and type are required' });
    }
    const templates = [...(configManager.get('quests.templates') || configManager.get('quests')?.templates || [])];
    if (templates.find(t => t.id === tmpl.id)) {
      return reply.code(409).send({ error: 'Template with this id already exists' });
    }
    templates.push(tmpl);
    await configManager.set('quests.templates', templates);
    return reply.send({ ok: true, template: tmpl });
  });

  /**
   * DELETE /api/admin/quests/templates/:id
   * Remove a quest template.
   */
  fastify.delete('/api/admin/quests/templates/:id', {
    preHandler: adminAuthMiddleware,
  }, async (req, reply) => {
    const templateId = req.params.id;
    const templates = [...(configManager.get('quests.templates') || configManager.get('quests')?.templates || [])];
    const filtered = templates.filter(t => t.id !== templateId);
    if (filtered.length === templates.length) {
      return reply.code(404).send({ error: 'Template not found' });
    }
    await configManager.set('quests.templates', filtered);
    return reply.send({ ok: true });
  });

  /**
   * PUT /api/admin/quests/templates-bulk
   * Replace ALL quest templates at once.
   */
  fastify.put('/api/admin/quests/templates-bulk', {
    preHandler: adminAuthMiddleware,
  }, async (req, reply) => {
    const { templates } = req.body || {};
    if (!Array.isArray(templates)) {
      return reply.code(400).send({ error: 'templates array required' });
    }
    await configManager.set('quests.templates', templates);
    return reply.send({ ok: true, count: templates.length });
  });

  /**
   * POST /api/admin/quests/templates-reset
   * Reset templates to gameConfig.js defaults.
   */
  fastify.post('/api/admin/quests/templates-reset', {
    preHandler: adminAuthMiddleware,
  }, async (req, reply) => {
    const gameConfig = require('../config/gameConfig');
    const defaults = gameConfig.quests?.templates || [];
    await configManager.set('quests.templates', defaults);
    return reply.send({ ok: true, count: defaults.length });
  });

  /**
   * POST /api/admin/quests/wipe-refresh
   * Force all users to regenerate quests on next load.
   */
  fastify.post('/api/admin/quests/wipe-refresh', {
    preHandler: adminAuthMiddleware,
  }, async (req, reply) => {
    // Delete all active/completed quests and refresh timers so everyone regenerates fresh
    await query("DELETE FROM user_quests WHERE status IN ('active', 'completed')");
    await query('DELETE FROM user_quest_refresh WHERE TRUE');
    return reply.send({ ok: true, message: 'All quests and refresh timers cleared' });
  });

  /**
   * GET /api/admin/quests/config
   * Get full quest config (counts, buyout settings, etc).
   */
  fastify.get('/api/admin/quests/config', {
    preHandler: adminAuthMiddleware,
  }, async (req, reply) => {
    const cfg = configManager.get('quests');
    const { templates, ...rest } = cfg;
    return reply.send(rest);
  });

  /**
   * PUT /api/admin/quests/config
   * Update quest config fields (daily.count, buyout.enabled, etc).
   */
  fastify.put('/api/admin/quests/config', {
    preHandler: adminAuthMiddleware,
  }, async (req, reply) => {
    const updates = req.body || {};
    // Save each top-level key separately
    for (const [key, value] of Object.entries(updates)) {
      if (key === 'templates') continue; // templates managed separately
      await configManager.set(`quests.${key}`, value);
    }
    const cfg = configManager.get('quests');
    const { templates, ...rest } = cfg;
    return reply.send({ ok: true, config: rest });
  });

  // ── News admin ────────────────────────────────────────────────────────────

  /**
   * GET /api/admin/news
   * Get current news record.
   */
  fastify.get('/api/admin/news', {
    preHandler: adminAuthMiddleware,
  }, async (req, reply) => {
    const news = await newsService.getNews();
    return reply.send({ news });
  });

  /**
   * POST /api/admin/news
   * Create or update the news record.
   * Body: { titleRu, titleEn, descriptionRu, descriptionEn, icon }
   */
  fastify.post('/api/admin/news', {
    preHandler: adminAuthMiddleware,
  }, async (req, reply) => {
    const { titleRu, titleEn, descriptionRu, descriptionEn, icon } = req.body || {};
    const news = await newsService.upsertNews({ titleRu, titleEn, descriptionRu, descriptionEn, icon });
    return reply.send({ ok: true, news });
  });

  /**
   * POST /api/admin/news/visibility
   * Toggle news visibility.
   * Body: { visible: boolean }
   */
  fastify.post('/api/admin/news/visibility', {
    preHandler: adminAuthMiddleware,
  }, async (req, reply) => {
    const { visible } = req.body || {};
    const result = await newsService.setVisibility(Boolean(visible));
    return reply.send(result);
  });

  // ── Prestige admin ────────────────────────────────────────────────────────

  /**
   * GET /api/admin/prestiges
   * List all prestige events (most recent first).
   * Query: ?limit=50&offset=0
   */
  fastify.get('/api/admin/prestiges', {
    preHandler: adminAuthMiddleware,
  }, async (req, reply) => {
    const limit = Math.min(Number(req.query.limit || 50), 200);
    const offset = Number(req.query.offset || 0);
    const history = await prestigeService.getHistory({ limit, offset });
    return reply.send({ history });
  });

  /**
   * GET /api/admin/prestiges/:userId
   * Get prestige history for a specific user.
   */
  fastify.get('/api/admin/prestiges/:userId', {
    preHandler: adminAuthMiddleware,
  }, async (req, reply) => {
    const userId = Number(req.params.userId);
    const history = await prestigeService.getUserHistory(userId);
    const status = await prestigeService.getStatus(userId).catch(() => null);
    return reply.send({ history, status });
  });

  /**
   * POST /api/admin/prestiges/:userId/set
   * Manually set a user's prestige level (admin override).
   * Body: { prestigeLevel: 0|1|2|3 }
   */
  fastify.post('/api/admin/prestiges/:userId/set', {
    preHandler: adminAuthMiddleware,
  }, async (req, reply) => {
    const userId = Number(req.params.userId);
    const { prestigeLevel } = req.body || {};
    if (prestigeLevel === undefined || prestigeLevel < 0 || prestigeLevel > 3) {
      return reply.code(400).send({ error: 'prestigeLevel must be 0–3' });
    }
    await query(
      'UPDATE users SET prestige_level = $1 WHERE id = $2',
      [prestigeLevel, userId]
    );
    return reply.send({ ok: true, userId, prestigeLevel });
  });

  // ── Chat Source Analytics ─────────────────────────────────────────────────

  /**
   * GET /api/admin/chat-sources
   * List all chats that have produced registrations, with stats.
   * Optional query params: ?groupId=<uuid> to filter by group
   */
  fastify.get('/api/admin/chat-sources', {
    preHandler: adminAuthMiddleware,
  }, async (req, reply) => {
    const { groupId } = req.query || {};

    const rows = await query(
      `SELECT
         cs.id,
         cs.chat_id,
         cs.chat_title,
         cs.owner_user_id,
         cs.chat_auto_delete_low_rarity,
         cs.group_id,
         csg.name AS group_name,
         cs.created_at,
         cs.updated_at,
         COUNT(u.id)::int                           AS registrations,
         SUM(u.total_stars_spent)::bigint           AS total_stars_spent,
         SUM(u.total_expeditions)::int              AS total_expeditions
       FROM chat_sources cs
       LEFT JOIN chat_source_groups csg ON csg.id = cs.group_id
       LEFT JOIN users u ON u.registration_chat_id = cs.chat_id
       ${groupId ? 'WHERE cs.group_id = $1' : ''}
       GROUP BY cs.id, csg.name
       ORDER BY registrations DESC`,
      groupId ? [groupId] : []
    );

    return reply.send({ chatSources: rows });
  });

  /**
   * GET /api/admin/chat-sources/:chatId/users
   * List users who registered from a specific chat.
   * Query params: ?limit=50&offset=0
   */
  fastify.get('/api/admin/chat-sources/:chatId/users', {
    preHandler: adminAuthMiddleware,
  }, async (req, reply) => {
    const chatId = Number(req.params.chatId);
    const limit = Math.min(parseInt(req.query.limit || '50'), 200);
    const offset = parseInt(req.query.offset || '0');

    const rows = await query(
      `SELECT
         u.id,
         u.username,
         u.first_name,
         u.last_name,
         u.level,
         u.total_stars_spent,
         u.total_expeditions,
         u.created_at,
         u.registration_source_type
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

    return reply.send({ users: rows, total: total.rows[0]?.cnt || 0 });
  });

  /**
   * GET /api/admin/chat-source-groups
   * List all chat groups.
   */
  fastify.get('/api/admin/chat-source-groups', {
    preHandler: adminAuthMiddleware,
  }, async (req, reply) => {
    const rows = await query(
      `SELECT
         csg.*,
         COUNT(cs.id)::int AS chat_count,
         SUM(sub.regs)::int AS registrations
       FROM chat_source_groups csg
       LEFT JOIN chat_sources cs ON cs.group_id = csg.id
       LEFT JOIN (
         SELECT registration_chat_id, COUNT(*)::int AS regs
         FROM users
         WHERE registration_chat_id IS NOT NULL
         GROUP BY registration_chat_id
       ) sub ON sub.registration_chat_id = cs.chat_id
       GROUP BY csg.id
       ORDER BY csg.created_at DESC`,
      []
    );
    return reply.send({ groups: rows });
  });

  /**
   * POST /api/admin/chat-source-groups
   * Create a new chat group.
   * Body: { name, ownerUserId }
   */
  fastify.post('/api/admin/chat-source-groups', {
    preHandler: adminAuthMiddleware,
  }, async (req, reply) => {
    const { name, ownerUserId } = req.body || {};
    if (!name) return reply.code(400).send({ error: 'name required' });

    const res = await query(
      `INSERT INTO chat_source_groups (name, owner_user_id) VALUES ($1, $2) RETURNING *`,
      [name, ownerUserId || null]
    );
    return reply.send({ ok: true, group: res.rows[0] });
  });

  /**
   * PATCH /api/admin/chat-sources/:chatId
   * Update chat source metadata (assign owner or group).
   * Body: { ownerUserId?, groupId?, chatTitle?, chatAutoDeleteLowRarity? }
   */
  fastify.patch('/api/admin/chat-sources/:chatId', {
    preHandler: adminAuthMiddleware,
  }, async (req, reply) => {
    const chatId = Number(req.params.chatId);
    const { ownerUserId, groupId, chatTitle, chatAutoDeleteLowRarity } = req.body || {};

    const fields = [];
    const values = [];
    let idx = 1;

    if (ownerUserId !== undefined) { fields.push(`owner_user_id = $${idx++}`); values.push(ownerUserId); }
    if (groupId !== undefined)     { fields.push(`group_id = $${idx++}`);      values.push(groupId); }
    if (chatTitle !== undefined)   { fields.push(`chat_title = $${idx++}`);    values.push(chatTitle); }
    if (chatAutoDeleteLowRarity !== undefined) {
      fields.push(`chat_auto_delete_low_rarity = $${idx++}`);
      values.push(Boolean(chatAutoDeleteLowRarity));
    }
    fields.push(`updated_at = NOW()`);

    if (fields.length === 1) return reply.code(400).send({ error: 'Nothing to update' });

    values.push(chatId);
    await query(
      `UPDATE chat_sources SET ${fields.join(', ')} WHERE chat_id = $${idx}`,
      values
    );
    return reply.send({ ok: true });
  });

  /**
   * GET /api/admin/chat-sources/stats/summary
   * Overall summary: total registrations by source type + ads links.
   */
  fastify.get('/api/admin/chat-sources/stats/summary', {
    preHandler: adminAuthMiddleware,
  }, async (req, reply) => {
    const bySource = await query(
      `SELECT
         COALESCE(registration_source_type, 'organic') AS source_type,
         COUNT(*)::int                                  AS registrations,
         SUM(total_stars_spent)::bigint                AS total_stars_spent
       FROM users
       GROUP BY COALESCE(registration_source_type, 'organic')
       ORDER BY registrations DESC`,
      []
    );

    const topChats = await query(
      `SELECT
         u.registration_chat_id  AS chat_id,
         MAX(cs.chat_title)       AS chat_title,
         COUNT(u.id)::int         AS registrations,
         SUM(u.total_stars_spent)::bigint AS total_stars_spent
       FROM users u
       LEFT JOIN chat_sources cs ON cs.chat_id = u.registration_chat_id
       WHERE u.registration_chat_id IS NOT NULL
       GROUP BY u.registration_chat_id
       ORDER BY registrations DESC
       LIMIT 20`,
      []
    );

    const adsLinks = await query(
      `SELECT source, starts_count, unique_users, last_start_at
       FROM start_link_analytics
       ORDER BY starts_count DESC
       LIMIT 50`,
      []
    );

    return reply.send({ bySource: bySource.rows, topChats: topChats.rows, adsLinks: adsLinks.rows });
  });
}

module.exports = adminRoutes;
