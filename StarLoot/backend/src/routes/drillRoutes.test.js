'use strict';

const Fastify = require('fastify');

jest.mock('../middleware/telegramAuth', () => ({
  telegramAuthMiddleware: async (req) => {
    req.user = { id: 1001, level: 20 };
  },
}));

const drillRoutes = require('./drillRoutes');

describe('drillRoutes', () => {
  let app;
  let drillService;

  beforeEach(async () => {
    jest.clearAllMocks();

    drillService = {
      getDrills: jest.fn().mockResolvedValue({ drills: [{ id: 'd-1' }], availableDrills: [] }),
      getCollectibles: jest.fn().mockResolvedValue([{ id: 'c-1' }]),
      getCollections: jest.fn().mockResolvedValue([{ id: 'col-1' }]),
      collectDrill: jest.fn().mockResolvedValue({ collected: true, creditsCollected: 123 }),
      assignAsteroid: jest.fn().mockResolvedValue({ assigned: true, drillId: 'd-1', asteroidId: 'a-1' }),
      purchaseDrill: jest.fn().mockResolvedValue({ drillId: 'new-drill', slotIndex: 2 }),
      unlockNextSlot: jest.fn().mockResolvedValue({ unlockedSlots: 2, starsRemaining: 50 }),
      upgradeDrill: jest.fn().mockResolvedValue({ upgraded: true, newTypeLevel: 1 }),
      deleteDrill: jest.fn().mockResolvedValue({ deleted: true, slotIndex: 2 }),
      sellCollectible: jest.fn().mockResolvedValue({ creditsGained: 11 }),
      submitCollection: jest.fn().mockResolvedValue({ rewardCredits: 500, rewardXp: 100 }),
    };

    app = Fastify({ logger: false });
    await app.register(drillRoutes, { drillService });
  });

  afterEach(async () => {
    await app.close();
  });

  test('GET /api/drills aggregates payload from 3 service calls', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/drills' });

    expect(res.statusCode).toBe(200);
    expect(drillService.getDrills).toHaveBeenCalledWith(1001);
    expect(drillService.getCollectibles).toHaveBeenCalledWith(1001);
    expect(drillService.getCollections).toHaveBeenCalledWith(1001);
    expect(res.json()).toEqual({
      drills: [{ id: 'd-1' }],
      availableDrills: [],
      collectibles: [{ id: 'c-1' }],
      collections: [{ id: 'col-1' }],
    });
  });

  test('POST /api/drills/collect/:id calls collectDrill', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/drills/collect/dr-5' });

    expect(res.statusCode).toBe(200);
    expect(drillService.collectDrill).toHaveBeenCalledWith(1001, 'dr-5');
    expect(res.json()).toEqual({ collected: true, creditsCollected: 123 });
  });

  test('POST /api/drills/assign-asteroid validates required fields', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/drills/assign-asteroid', payload: { drillId: 'd-1' } });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'drillId and asteroidId required' });
    expect(drillService.assignAsteroid).not.toHaveBeenCalled();
  });

  test('POST /api/drills/assign-asteroid delegates to service', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/drills/assign-asteroid',
      payload: { drillId: 'd-1', asteroidId: 'a-1' },
    });

    expect(res.statusCode).toBe(200);
    expect(drillService.assignAsteroid).toHaveBeenCalledWith(1001, 'd-1', 'a-1');
    expect(res.json()).toEqual({ assigned: true, drillId: 'd-1', asteroidId: 'a-1' });
  });

  test('POST /api/drills/purchase validates drillTypeId', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/drills/purchase', payload: { slotIndex: 1 } });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'drillTypeId required' });
    expect(drillService.purchaseDrill).not.toHaveBeenCalled();
  });

  test('POST /api/drills/purchase validates slotIndex', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/drills/purchase', payload: { drillTypeId: 'standard_drill' } });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'slotIndex required' });
    expect(drillService.purchaseDrill).not.toHaveBeenCalled();
  });

  test('POST /api/drills/purchase calls service with default payWith', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/drills/purchase',
      payload: { drillTypeId: 'standard_drill', slotIndex: 2 },
    });

    expect(res.statusCode).toBe(200);
    expect(drillService.purchaseDrill).toHaveBeenCalledWith(1001, 'standard_drill', 'credits', 2);
    expect(res.json()).toEqual({ drillId: 'new-drill', slotIndex: 2 });
  });

  test('POST /api/drills/unlock-slot calls service', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/drills/unlock-slot' });

    expect(res.statusCode).toBe(200);
    expect(drillService.unlockNextSlot).toHaveBeenCalledWith(1001);
    expect(res.json()).toEqual({ unlockedSlots: 2, starsRemaining: 50 });
  });

  test('POST /api/drills/upgrade/:id validates upgradeType', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/drills/upgrade/dr-1', payload: {} });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'upgradeType required' });
    expect(drillService.upgradeDrill).not.toHaveBeenCalled();
  });

  test('POST /api/drills/upgrade/:id delegates upgrade call', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/drills/upgrade/dr-1',
      payload: { upgradeType: 'yield' },
    });

    expect(res.statusCode).toBe(200);
    expect(drillService.upgradeDrill).toHaveBeenCalledWith(1001, 'dr-1', 'yield');
    expect(res.json()).toEqual({ upgraded: true, newTypeLevel: 1 });
  });

  test('DELETE /api/drills/:id delegates delete call', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/drills/dr-8' });

    expect(res.statusCode).toBe(200);
    expect(drillService.deleteDrill).toHaveBeenCalledWith(1001, 'dr-8');
    expect(res.json()).toEqual({ deleted: true, slotIndex: 2 });
  });

  test('POST /api/drills/sell-collectible validates itemId', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/drills/sell-collectible', payload: {} });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'itemId required' });
    expect(drillService.sellCollectible).not.toHaveBeenCalled();
  });

  test('POST /api/drills/sell-collectible delegates sell call', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/drills/sell-collectible',
      payload: { itemId: 'item-77' },
    });

    expect(res.statusCode).toBe(200);
    expect(drillService.sellCollectible).toHaveBeenCalledWith(1001, 'item-77');
    expect(res.json()).toEqual({ creditsGained: 11 });
  });

  test('POST /api/drills/submit-collection validates collectionId', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/drills/submit-collection', payload: {} });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'collectionId required' });
    expect(drillService.submitCollection).not.toHaveBeenCalled();
  });

  test('POST /api/drills/submit-collection delegates submit call', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/drills/submit-collection',
      payload: { collectionId: 'set_ancient' },
    });

    expect(res.statusCode).toBe(200);
    expect(drillService.submitCollection).toHaveBeenCalledWith(1001, 'set_ancient');
    expect(res.json()).toEqual({ rewardCredits: 500, rewardXp: 100 });
  });
});
