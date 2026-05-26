'use strict';

const { telegramAuthMiddleware } = require('../middleware/telegramAuth');

module.exports = async function drillRoutes(fastify, { drillService }) {
  fastify.addHook('preHandler', telegramAuthMiddleware);

  // Get all drills + available types + collectibles + collections
  fastify.get('/api/drills', async (req, reply) => {
    try {
      const [drillsData, collectibles, collections] = await Promise.all([
        drillService.getDrills(req.user.id),
        drillService.getCollectibles(req.user.id),
        drillService.getCollections(req.user.id),
      ]);
      return reply.send({ ...drillsData, collectibles, collections });
    } catch (error) {
      fastify.log.error({
        err: error,
        userId: req?.user?.id,
        path: req?.url,
      }, 'Failed to load drills payload');
      throw error;
    }
  });

  // Collect credits from a drill
  fastify.post('/api/drills/collect/:id', async (req, reply) => {
    try {
      const result = await drillService.collectDrill(req.user.id, req.params.id);
      return reply.send(result);
    } catch (error) {
      fastify.log.error({
        err: error,
        userId: req?.user?.id,
        drillId: req?.params?.id,
        path: req?.url,
      }, 'Failed to collect drill rewards');
      throw error;
    }
  });

  // Assign an asteroid to a drill
  fastify.post('/api/drills/assign-asteroid', async (req, reply) => {
    try {
      const { drillId, asteroidId } = req.body || {};
      if (!drillId || !asteroidId) {
        return reply.code(400).send({ error: 'drillId and asteroidId required' });
      }
      const result = await drillService.assignAsteroid(req.user.id, drillId, asteroidId);
      return reply.send(result);
    } catch (error) {
      fastify.log.error({
        err: error,
        userId: req?.user?.id,
        drillId: req?.body?.drillId,
        asteroidId: req?.body?.asteroidId,
        path: req?.url,
      }, 'Failed to assign asteroid to drill');
      throw error;
    }
  });

  // Purchase a new drill
  fastify.post('/api/drills/purchase', async (req, reply) => {
    const { drillTypeId, payWith, slotIndex } = req.body || {};
    if (!drillTypeId) return reply.code(400).send({ error: 'drillTypeId required' });
    if (!slotIndex) return reply.code(400).send({ error: 'slotIndex required' });
    const result = await drillService.purchaseDrill(req.user.id, drillTypeId, payWith || 'credits', slotIndex);
    return reply.send(result);
  });

  // Unlock next drill slot for stars
  fastify.post('/api/drills/unlock-slot', async (req, reply) => {
    try {
      const result = await drillService.unlockNextSlot(req.user.id);
      return reply.send(result);
    } catch (error) {
      fastify.log.error({
        err: error,
        userId: req?.user?.id,
        path: req?.url,
      }, 'Failed to unlock drill slot');
      throw error;
    }
  });

  // Upgrade a drill
  fastify.post('/api/drills/upgrade/:id', async (req, reply) => {
    const { upgradeType } = req.body || {};
    if (!upgradeType) return reply.code(400).send({ error: 'upgradeType required' });
    const result = await drillService.upgradeDrill(req.user.id, req.params.id, upgradeType);
    return reply.send(result);
  });

  // Delete a drill from slot
  fastify.delete('/api/drills/:id', async (req, reply) => {
    const result = await drillService.deleteDrill(req.user.id, req.params.id);
    return reply.send(result);
  });

  // Sell a collectible item
  fastify.post('/api/drills/sell-collectible', async (req, reply) => {
    const { itemId } = req.body || {};
    if (!itemId) return reply.code(400).send({ error: 'itemId required' });
    const result = await drillService.sellCollectible(req.user.id, itemId);
    return reply.send(result);
  });

  // Submit a completed collection
  fastify.post('/api/drills/submit-collection', async (req, reply) => {
    const { collectionId } = req.body || {};
    if (!collectionId) return reply.code(400).send({ error: 'collectionId required' });
    const result = await drillService.submitCollection(req.user.id, collectionId);
    return reply.send(result);
  });
};
