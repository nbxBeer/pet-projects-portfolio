'use strict';

const { telegramAuthMiddleware } = require('../middleware/telegramAuth');

async function prestigeRoutes(fastify, { prestigeService }) {
  fastify.addHook('preHandler', telegramAuthMiddleware);
  // GET /api/prestige/status — conditions check
  fastify.get('/api/prestige/status', async (req, reply) => {
    const status = await prestigeService.getStatus(req.user.id);
    return reply.send(status);
  });

  // POST /api/prestige/claim — execute prestige reset
  fastify.post('/api/prestige/claim', async (req, reply) => {
    const user = req.user;
    const result = await prestigeService.claimPrestige(user.id);

    setImmediate(() => Promise.all([
      prestigeService.notifyAdminPrestige(user, result.prestigeLevel).catch(() => {}),
      prestigeService.checkPrestigeAchievements(user.id).catch(() => {}),
    ]));

    return reply.send({ ok: true, ...result });
  });
}

module.exports = prestigeRoutes;
