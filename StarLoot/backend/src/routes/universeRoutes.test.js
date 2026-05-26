'use strict';

const Fastify = require('fastify');

const mockValidateNonce = jest.fn();

jest.mock('../middleware/telegramAuth', () => ({
  telegramAuthMiddleware: async (req) => {
    req.user = { id: 501, level: 12 };
  },
  validateNonce: (...args) => mockValidateNonce(...args),
}));

const universeRoutes = require('./universeRoutes');

describe('universeRoutes', () => {
  let app;
  let universeService;

  beforeEach(async () => {
    jest.clearAllMocks();

    universeService = {
      completeTravel: jest.fn().mockResolvedValue(null),
      getUniverseState: jest.fn().mockResolvedValue({
        currentUniverse: 1,
        crystals: 10,
        isTraveling: false,
        travelUntil: null,
      }),
      getZonesForUniverse: jest.fn().mockReturnValue([{ id: 'zone-1', minLevel: 1, locked: false }]),
      startTravel: jest.fn().mockResolvedValue({ traveling: true, from: 1, to: 2 }),
    };

    app = Fastify({ logger: false });
    await app.register(universeRoutes, { universeService });
  });

  afterEach(async () => {
    await app.close();
  });

  test('GET /api/universe auto-completes travel and returns state', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/universe' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      currentUniverse: 1,
      crystals: 10,
      isTraveling: false,
      travelUntil: null,
    });
    expect(universeService.completeTravel).toHaveBeenCalledWith(501);
    expect(universeService.getUniverseState).toHaveBeenCalledWith(501);
  });

  test('GET /api/universe/zones returns zones for current universe', async () => {
    universeService.getUniverseState.mockResolvedValueOnce({ currentUniverse: 2 });

    const res = await app.inject({ method: 'GET', url: '/api/universe/zones' });

    expect(res.statusCode).toBe(200);
    expect(universeService.completeTravel).toHaveBeenCalledWith(501);
    expect(universeService.getZonesForUniverse).toHaveBeenCalledWith(2, 12);
    expect(res.json()).toEqual({
      zones: [{ id: 'zone-1', minLevel: 1, locked: false }],
      currentUniverse: 2,
    });
  });

  test('POST /api/universe/travel validates nonce presence', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/universe/travel', payload: {} });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'nonce required' });
    expect(mockValidateNonce).not.toHaveBeenCalled();
    expect(universeService.startTravel).not.toHaveBeenCalled();
  });

  test('POST /api/universe/travel rejects invalid nonce', async () => {
    mockValidateNonce.mockResolvedValueOnce(false);

    const res = await app.inject({
      method: 'POST',
      url: '/api/universe/travel',
      payload: { nonce: 'nonce_1234567890123456' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'Invalid or replayed nonce' });
    expect(mockValidateNonce).toHaveBeenCalledWith('nonce_1234567890123456', 501);
    expect(universeService.startTravel).not.toHaveBeenCalled();
  });

  test('POST /api/universe/travel starts travel on valid nonce', async () => {
    mockValidateNonce.mockResolvedValueOnce(true);

    const res = await app.inject({
      method: 'POST',
      url: '/api/universe/travel',
      payload: { nonce: 'nonce_1234567890123456' },
    });

    expect(res.statusCode).toBe(200);
    expect(mockValidateNonce).toHaveBeenCalledWith('nonce_1234567890123456', 501);
    expect(universeService.startTravel).toHaveBeenCalledWith(501);
    expect(res.json()).toEqual({ traveling: true, from: 1, to: 2 });
  });
});
