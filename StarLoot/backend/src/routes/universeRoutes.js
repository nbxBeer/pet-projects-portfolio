'use strict';

const { telegramAuthMiddleware, validateNonce } = require('../middleware/telegramAuth');

async function universeRoutes(fastify, { universeService }) {
  fastify.addHook('preHandler', telegramAuthMiddleware);

  // Get universe state (also auto-completes travel if timer expired)
  fastify.get('/api/universe', async (req, reply) => {
    // Auto-complete travel if timer expired
    await universeService.completeTravel(req.user.id);
    const state = await universeService.getUniverseState(req.user.id);
    return reply.send(state);
  });

  // Get zones for current universe
  fastify.get('/api/universe/zones', async (req, reply) => {
    await universeService.completeTravel(req.user.id);
    const state = await universeService.getUniverseState(req.user.id);
    const zones = universeService.getZonesForUniverse(state.currentUniverse, req.user.level || 1);
    return reply.send({ zones, currentUniverse: state.currentUniverse });
  });

  // Start travel to the other universe
  fastify.post('/api/universe/travel', async (req, reply) => {
    const { nonce } = req.body || {};
    if (!nonce) return reply.code(400).send({ error: 'nonce required' });
    const nonceValid = await validateNonce(nonce, req.user.id);
    if (!nonceValid) return reply.code(409).send({ error: 'Invalid or replayed nonce' });

    const result = await universeService.startTravel(req.user.id);
    return reply.send(result);
  });
}

module.exports = universeRoutes;
