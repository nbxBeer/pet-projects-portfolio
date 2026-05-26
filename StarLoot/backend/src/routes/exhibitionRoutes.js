'use strict';

const { telegramAuthMiddleware } = require('../middleware/telegramAuth');

async function exhibitionRoutes(fastify, { exhibitionService }) {
  fastify.addHook('preHandler', telegramAuthMiddleware);

  fastify.post('/api/exhibition/send', async (req, reply) => {
    try {
      const { inventoryItemId } = req.body || {};
      if (!inventoryItemId) return reply.code(400).send({ error: 'inventoryItemId required' });
      const result = await exhibitionService.sendToExhibition(req.user.id, inventoryItemId);
      return reply.send(result);
    } catch (err) {
      const status = err.status || 500;
      const message = err.message || String(err);
      return reply.code(status).send({ error: message });
    }
  });

  fastify.get('/api/exhibition/status', async (req, reply) => {
    try {
      const status = await exhibitionService.getExhibitionStatus(req.user.id);
      return reply.send(status);
    } catch (err) {
      const status = err.status || 500;
      return reply.code(status).send({ error: err.message || String(err) });
    }
  });

  fastify.post('/api/exhibition/collect', async (req, reply) => {
    try {
      const result = await exhibitionService.collectExhibitionResult(req.user.id);
      return reply.send(result);
    } catch (err) {
      const status = err.status || 500;
      return reply.code(status).send({ error: err.message || String(err) });
    }
  });
}

module.exports = exhibitionRoutes;
