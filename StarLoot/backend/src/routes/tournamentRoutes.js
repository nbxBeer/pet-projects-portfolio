'use strict';

const { telegramAuthMiddleware } = require('../middleware/telegramAuth');

async function tournamentRoutes(fastify, { tournamentService }) {
  fastify.addHook('preHandler', telegramAuthMiddleware);

  // GET /api/tournaments/active — current active tournament or null
  fastify.get('/api/tournaments/active', async (req, reply) => {
    const tournament = await tournamentService.getVisibleTournament();
    return reply.send({ tournament });
  });

  // GET /api/tournaments/:id/leaderboard — leaderboard for a tournament
  fastify.get('/api/tournaments/:id/leaderboard', async (req, reply) => {
    const data = await tournamentService.getLeaderboard(req.params.id, {
      limit: 50,
      requestingUserId: req.user.id,
    });
    return reply.send(data);
  });
}

module.exports = tournamentRoutes;
