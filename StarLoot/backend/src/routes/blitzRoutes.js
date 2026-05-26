'use strict';

const { z } = require('zod');
const { telegramAuthMiddleware, validateNonce } = require('../middleware/telegramAuth');
const { logSecurityEvent } = require('../utils/securityLogger');

const StartSchema = z.object({
  zoneId: z.string().min(1).max(100),
  nonce:  z.string().min(16).max(128).regex(/^[a-zA-Z0-9_-]+$/),
});

const SessionSchema = z.object({
  sessionId: z.string().uuid(),
  nonce:     z.string().min(16).max(128).regex(/^[a-zA-Z0-9_-]+$/),
});

const NonceOnlySchema = z.object({
  nonce: z.string().min(16).max(128).regex(/^[a-zA-Z0-9_-]+$/),
});

async function blitzRoutes(fastify, { blitzExpeditionService, questService }) {
  fastify.addHook('preHandler', telegramAuthMiddleware);

  fastify.get('/api/blitz/status', async (req, reply) => {
    const result = await blitzExpeditionService.getStatus(req.user.id);
    return reply.send(result);
  });

  fastify.post('/api/blitz/start', { schema: { body: { type: 'object' } } }, async (req, reply) => {
    const parsed = StartSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid request', details: parsed.error.issues });

    const nonceValid = await validateNonce(parsed.data.nonce, req.user.id);
    if (!nonceValid) {
      logSecurityEvent(req.user.id, 'blitz_nonce_reuse', { endpoint: 'start', nonce: parsed.data.nonce });
      return reply.code(409).send({ error: 'Invalid or replayed nonce' });
    }

    try {
      const result = await blitzExpeditionService.startSession(req.user.id, { zoneId: parsed.data.zoneId });
      return reply.code(201).send(result);
    } catch (err) {
      if (err.status === 429) {
        // Cooldown bypass attempt: client manipulated status response to hide cooldown, server caught it
        logSecurityEvent(req.user.id, 'blitz_cooldown_bypass', { cooldownUntil: err.cooldownUntil });
        return reply.code(429).send({ error: err.message, cooldownUntil: err.cooldownUntil });
      }
      throw err;
    }
  });

  fastify.post('/api/blitz/continue', { schema: { body: { type: 'object' } } }, async (req, reply) => {
    const parsed = SessionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid request', details: parsed.error.issues });

    const nonceValid = await validateNonce(parsed.data.nonce, req.user.id);
    if (!nonceValid) {
      logSecurityEvent(req.user.id, 'blitz_nonce_reuse', { endpoint: 'continue', sessionId: parsed.data.sessionId });
      return reply.code(409).send({ error: 'Invalid or replayed nonce' });
    }

    const result = await blitzExpeditionService.continueSession(req.user.id, { sessionId: parsed.data.sessionId });
    return reply.send(result);
  });

  fastify.post('/api/blitz/cashout', { schema: { body: { type: 'object' } } }, async (req, reply) => {
    const parsed = SessionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid request', details: parsed.error.issues });

    const nonceValid = await validateNonce(parsed.data.nonce, req.user.id);
    if (!nonceValid) {
      logSecurityEvent(req.user.id, 'blitz_nonce_reuse', { endpoint: 'cashout', sessionId: parsed.data.sessionId });
      return reply.code(409).send({ error: 'Invalid or replayed nonce' });
    }

    const result = await blitzExpeditionService.cashoutSession(req.user.id, { sessionId: parsed.data.sessionId });
    if (questService && result?.collected) {
      setImmediate(() => questService.trackProgress(req.user.id, 'blitz_complete', {}).catch(() => {}));
    }
    return reply.send(result);
  });

  fastify.post('/api/blitz/sell-cashout', { schema: { body: { type: 'object' } } }, async (req, reply) => {
    const parsed = SessionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid request', details: parsed.error.issues });

    const nonceValid = await validateNonce(parsed.data.nonce, req.user.id);
    if (!nonceValid) return reply.code(409).send({ error: 'Invalid or replayed nonce' });

    const result = await blitzExpeditionService.sellCashout(req.user.id, { sessionId: parsed.data.sessionId });
    return reply.send(result);
  });

  fastify.post('/api/blitz/keep-cashout', { schema: { body: { type: 'object' } } }, async (req, reply) => {
    const parsed = SessionSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid request', details: parsed.error.issues });

    const nonceValid = await validateNonce(parsed.data.nonce, req.user.id);
    if (!nonceValid) return reply.code(409).send({ error: 'Invalid or replayed nonce' });

    const result = await blitzExpeditionService.keepCashout(req.user.id, { sessionId: parsed.data.sessionId });
    return reply.send(result);
  });

  fastify.post('/api/blitz/skip-cooldown', { schema: { body: { type: 'object' } } }, async (req, reply) => {
    const parsed = NonceOnlySchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Invalid request', details: parsed.error.issues });

    const nonceValid = await validateNonce(parsed.data.nonce, req.user.id);
    if (!nonceValid) return reply.code(409).send({ error: 'Invalid or replayed nonce' });

    const result = await blitzExpeditionService.skipCooldown(req.user.id);
    return reply.send(result);
  });
}

module.exports = blitzRoutes;
