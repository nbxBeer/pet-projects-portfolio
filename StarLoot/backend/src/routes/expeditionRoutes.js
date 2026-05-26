'use strict';

const { z } = require('zod');
const { telegramAuthMiddleware, validateNonce } = require('../middleware/telegramAuth');
const logger = require('../utils/logger');

const StartExpeditionSchema = z.object({
  zoneId: z.string().min(1).max(100),
  clientSeed: z.string().min(8).max(64).regex(/^[a-zA-Z0-9_-]+$/),
  nonce: z.string().min(16).max(128).regex(/^[a-zA-Z0-9_-]+$/),
  longExpedition: z.boolean().optional().default(false),
});

const CollectSchema = z.object({
  expeditionId: z.string().uuid(),
  nonce: z.string().min(16).max(128).regex(/^[a-zA-Z0-9_-]+$/),
});

const ActionSchema = z.object({
  resultId: z.string().uuid(),
  action: z.enum(['sell', 'save_coords', 'collect']),
  nonce: z.string().min(16).max(128).regex(/^[a-zA-Z0-9_-]+$/),
});

async function expeditionRoutes(fastify, { expeditionService, buffService, achievementService, referralService, questService }) {
  fastify.addHook('preHandler', telegramAuthMiddleware);

  // ── Expedition routes ──────────────────────────────────────────────────────

  fastify.get('/api/expedition/active', async (req, reply) => {
    const active = await expeditionService.getActiveExpedition(req.user.id);
    return reply.send({ expedition: active });
  });

  fastify.get('/api/expedition/history', async (req, reply) => {
    const { limit, offset } = req.query;
    const history = await expeditionService.getExpeditionHistory(req.user.id, {
      limit: parseInt(limit || '20'),
      offset: parseInt(offset || '0'),
    });
    return reply.send({ expeditions: history });
  });

  fastify.post('/api/expedition/start', {
    schema: { body: { type: 'object' } },
  }, async (req, reply) => {
    // Validate body
    const parsed = StartExpeditionSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request', details: parsed.error.issues });
    }

    // Anti-replay: consume nonce
    const nonceValid = await validateNonce(parsed.data.nonce, req.user.id);
    if (!nonceValid) {
      return reply.code(409).send({ error: 'Invalid or replayed nonce' });
    }

    const result = await expeditionService.startExpedition(req.user.id, {
      zoneId: parsed.data.zoneId,
      clientSeed: parsed.data.clientSeed,
      longExpedition: parsed.data.longExpedition,
    });
    return reply.code(201).send(result);
  });

  fastify.post('/api/expedition/collect', async (req, reply) => {
    const parsed = CollectSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request', details: parsed.error.issues });
    }

    const nonceValid = await validateNonce(parsed.data.nonce, req.user.id);
    if (!nonceValid) {
      return reply.code(409).send({ error: 'Invalid or replayed nonce' });
    }

    let result;
    try {
      result = await expeditionService.collectExpedition(
        req.user.id,
        parsed.data.expeditionId
      );
    } catch (err) {
      logger.error({
        err,
        userId: req.user?.id,
        expeditionId: parsed.data.expeditionId,
      }, 'Collect expedition failed');
      throw err;
    }
    if (achievementService) setImmediate(() => achievementService.checkAndAward(req.user.id).catch(() => {}));
    // Check referral activation after each expedition
    if (referralService) {
      setImmediate(() => referralService.checkActivation(req.user.id).catch(() => {}));
      // Auto-complete (cargo_full) passive income
      if (result.outcome === 'cargo_full' && result.creditsGained > 0) {
        setImmediate(() => referralService.creditPassiveIncome(req.user.id, result.creditsGained, 'sell_item').catch(() => {}));
      }
    }
    // Quest progress: expedition complete + find
    if (questService) {
      setImmediate(() => {
        questService.trackProgress(req.user.id, 'expedition_complete', {}).catch(() => {});
        if (result.findType) {
          questService.trackProgress(req.user.id, 'find', {
            findType: result.findType,
            rarity: result.rarity,
            amount: 1,
          }).catch(() => {});
        }
      });
    }
    return reply.send(result);
  });

  fastify.post('/api/expedition/action', async (req, reply) => {
    const parsed = ActionSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request', details: parsed.error.issues });
    }

    const nonceValid = await validateNonce(parsed.data.nonce, req.user.id);
    if (!nonceValid) {
      return reply.code(409).send({ error: 'Invalid or replayed nonce' });
    }

    const result = await expeditionService.takeAction(
      req.user.id,
      parsed.data.resultId,
      parsed.data.action
    );
    if (achievementService) setImmediate(() => achievementService.checkAndAward(req.user.id).catch(() => {}));
    // Referral passive income on sell
    if (referralService && parsed.data.action === 'sell' && result.creditsGained > 0) {
      setImmediate(() => {
        referralService.creditPassiveIncome(req.user.id, result.creditsGained, 'sell_item').catch(() => {});
        referralService.checkActivation(req.user.id).catch(() => {});
      });
    }
    // Quest progress: sell or collect
    if (questService && result.findType) {
      if (parsed.data.action === 'sell') {
        setImmediate(() => questService.trackProgress(req.user.id, 'sell', { findType: result.findType, rarity: result.rarity, amount: 1 }).catch(() => {}));
      } else if (parsed.data.action === 'collect') {
        setImmediate(() => questService.trackProgress(req.user.id, 'collect', { findType: result.findType, rarity: result.rarity, amount: 1 }).catch(() => {}));
      }
    }
    return reply.send(result);
  });

  fastify.post('/api/expedition/speedup', async (req, reply) => {
    const { expeditionId, nonce } = req.body || {};
    if (!expeditionId || !nonce) {
      return reply.code(400).send({ error: 'expeditionId and nonce required' });
    }
    const nonceValid = await validateNonce(nonce, req.user.id);
    if (!nonceValid) return reply.code(409).send({ error: 'Invalid or replayed nonce' });

    // Stars are spent from in-game wallet balance — no Telegram transaction needed
    const result = await expeditionService.speedUpExpedition(req.user.id, expeditionId);
    // Track speedup for story quests
    if (questService) {
      setImmediate(() => questService.trackProgress(req.user.id, 'speedup', {
        amount: 1,
        costStars: result.starsSpent,
      }).catch(() => {}));
    }
    return reply.send(result);
  });

  fastify.post('/api/expedition/pirate-action', async (req, reply) => {
    const { expeditionId, choice, nonce } = req.body || {};
    if (!expeditionId || !choice || !nonce) {
      return reply.code(400).send({ error: 'expeditionId, choice, and nonce required' });
    }
    if (!['pay', 'fight', 'destroy'].includes(choice)) {
      return reply.code(400).send({ error: "choice must be 'pay', 'fight', or 'destroy'" });
    }
    const nonceValid = await validateNonce(nonce, req.user.id);
    if (!nonceValid) return reply.code(409).send({ error: 'Invalid or replayed nonce' });

    const result = await expeditionService.pirateAction(req.user.id, expeditionId, choice);
    return reply.send(result);
  });

  // ── Shop / Buff routes ─────────────────────────────────────────────────────

  fastify.get('/api/shop/active-buffs', async (req, reply) => {
    const buffs = await buffService.getActiveBuffs(req.user.id);
    return reply.send({ buffs });
  });

  fastify.post('/api/shop/purchase', async (req, reply) => {
    const { itemType, nonce } = req.body || {};
    if (!itemType || typeof itemType !== 'string') {
      return reply.code(400).send({ error: 'itemType required' });
    }
    if (!nonce) return reply.code(400).send({ error: 'nonce required' });
    const nonceValid = await validateNonce(nonce, req.user.id);
    if (!nonceValid) return reply.code(409).send({ error: 'Invalid or replayed nonce' });

    const def = buffService.cfg.config.shopItems?.[itemType];
    if (!def) return reply.code(400).send({ error: 'Unknown item type' });

    const result = def.costStars
      ? await buffService.purchaseBuffStars(req.user.id, itemType)
      : await buffService.purchaseBuff(req.user.id, itemType);
    return reply.send(result);
  });

  fastify.post('/api/shop/purchase-credits', async (req, reply) => {
    const { itemType, nonce } = req.body || {};
    if (!itemType || !nonce) return reply.code(400).send({ error: 'itemType and nonce required' });
    const nonceValid = await validateNonce(nonce, req.user.id);
    if (!nonceValid) return reply.code(409).send({ error: 'Invalid or replayed nonce' });
    const result = await buffService.purchaseBuff(req.user.id, itemType);
    return reply.send(result);
  });

  fastify.post('/api/shop/purchase-stars', async (req, reply) => {
    const { itemType, nonce } = req.body || {};
    if (!itemType || !nonce) return reply.code(400).send({ error: 'itemType and nonce required' });
    const nonceValid = await validateNonce(nonce, req.user.id);
    if (!nonceValid) return reply.code(409).send({ error: 'Invalid or replayed nonce' });
    const result = await buffService.purchaseBuffStars(req.user.id, itemType);
    return reply.send(result);
  });
}

module.exports = expeditionRoutes;
