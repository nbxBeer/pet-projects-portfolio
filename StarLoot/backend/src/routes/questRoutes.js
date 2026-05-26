'use strict';

const { telegramAuthMiddleware } = require('../middleware/telegramAuth');

async function questRoutes(fastify, { questService, storyDialogService }) {
  fastify.addHook('preHandler', telegramAuthMiddleware);

  // Dashboard: factions + quests + timers + pending story dialogs
  fastify.get('/api/quests/dashboard', async (req) => {
    const universe = req.user.current_universe || 1;
    const dashboard = await questService.getDashboard(req.user.id, req.user.level || 1, universe);
    if (storyDialogService) {
      const repMap = {};
      for (const f of dashboard.factions) repMap[f.id] = f.reputation;
      const [seenIds, ownedItems] = await Promise.all([
        storyDialogService.getSeenDialogIds(req.user.id),
        storyDialogService.getOwnedStoryItems(req.user.id),
      ]);
      dashboard.pendingDialogs = storyDialogService.getPendingDialogs(repMap, seenIds, ownedItems);
    } else {
      dashboard.pendingDialogs = [];
    }
    return dashboard;
  });

  // Claim completed quest
  fastify.post('/api/quests/claim', async (req, reply) => {
    const { questId } = req.body || {};
    if (!questId) return reply.code(400).send({ error: 'Missing questId' });
    try {
      const result = await questService.claimQuest(req.user.id, questId);
      if (result.error) return reply.code(400).send(result);
      return result;
    } catch (err) {
      req.log.error(err, 'Quest claim failed');
      return reply.code(500).send({ error: err.message || 'Claim failed' });
    }
  });

  // Buyout quest (skip item requirement)
  fastify.post('/api/quests/buyout', async (req, reply) => {
    const { questId } = req.body || {};
    if (!questId) return reply.code(400).send({ error: 'Missing questId' });
    try {
      const result = await questService.buyoutQuest(req.user.id, questId);
      if (result.error) return reply.code(400).send(result);
      return result;
    } catch (err) {
      req.log.error(err, 'Quest buyout failed');
      return reply.code(500).send({ error: 'Buyout failed' });
    }
  });

  // Reroll quest (free rerolls)
  fastify.post('/api/quests/reroll', async (req, reply) => {
    const { questId } = req.body || {};
    if (!questId) return reply.code(400).send({ error: 'Missing questId' });
    const universe = req.user.current_universe || 1;
    const result = await questService.rerollQuest(req.user.id, questId, req.user.level || 1, universe);
    if (result.error) return reply.code(400).send(result);
    return result;
  });

  // Smuggler exchange (credits → star)
  fastify.post('/api/quests/smuggler', async (req, reply) => {
    const result = await questService.smugglerExchange(req.user.id);
    if (result.error) return reply.code(400).send(result);
    return result;
  });

  // Get matching inventory items for deliver/sell quest
  fastify.get('/api/quests/items', async (req, reply) => {
    const { questId } = req.query || {};
    if (!questId) return reply.code(400).send({ error: 'Missing questId' });
    const result = await questService.getQuestItems(req.user.id, questId);
    if (result.error) return reply.code(400).send(result);
    return result;
  });

  // Deliver items from inventory to complete deliver quest
  fastify.post('/api/quests/deliver', async (req, reply) => {
    const { questId, itemIds } = req.body || {};
    if (!questId || !itemIds?.length) return reply.code(400).send({ error: 'Missing questId or itemIds' });
    try {
      const result = await questService.deliverQuestItems(req.user.id, questId, itemIds);
      if (result.error) return reply.code(400).send(result);
      return result;
    } catch (err) {
      req.log.error(err, 'Quest deliver failed');
      console.error('DELIVER ERROR:', err.message, err.stack);
      return reply.code(500).send({ error: `Deliver failed: ${err.message}` });
    }
  });

  // Sell items through sell quest (market price + quest bonus)
  fastify.post('/api/quests/sell', async (req, reply) => {
    const { questId, itemIds } = req.body || {};
    if (!questId || !itemIds?.length) return reply.code(400).send({ error: 'Missing questId or itemIds' });
    try {
      const result = await questService.sellQuestItems(req.user.id, questId, itemIds);
      if (result.error) return reply.code(400).send(result);
      return result;
    } catch (err) {
      req.log.error(err, 'Quest sell failed');
      console.error('SELL ERROR:', err.message, err.stack);
      return reply.code(500).send({ error: `Sell failed: ${err.message}` });
    }
  });
}

module.exports = questRoutes;
