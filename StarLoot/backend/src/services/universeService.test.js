'use strict';

const UniverseService = require('./universeService');

jest.mock('../db/pool', () => ({
  query: jest.fn(),
  withTransaction: jest.fn(),
}));

jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const { query, withTransaction } = require('../db/pool');

describe('UniverseService', () => {
  let service;

  beforeEach(() => {
    jest.clearAllMocks();

    service = new UniverseService({
      config: {
        zones: [
          { id: 'u1-z1', minLevel: 1 },
          { id: 'u1-z2', minLevel: 10 },
        ],
        universe2: {
          travelDurationHours: 6,
          zones: [
            { id: 'u2-z1', minLevel: 5 },
            { id: 'u2-z2', minLevel: 20 },
          ],
        },
      },
    });
  });

  describe('getUniverseState', () => {
    test('returns normalized state for existing user', async () => {
      const future = new Date(Date.now() + 5 * 60 * 1000);
      query.mockResolvedValueOnce({
        rows: [{ current_universe: 2, crystals: '42', universe_travel_until: future }],
      });

      const result = await service.getUniverseState(100);

      expect(result.currentUniverse).toBe(2);
      expect(result.crystals).toBe(42);
      expect(result.isTraveling).toBe(true);
      expect(result.travelUntil).toEqual(future);
    });

    test('returns not traveling when travel_until is null', async () => {
      query.mockResolvedValueOnce({
        rows: [{ current_universe: 1, crystals: 0, universe_travel_until: null }],
      });

      const result = await service.getUniverseState(100);

      expect(result.isTraveling).toBe(false);
      expect(result.travelUntil).toBeNull();
    });

    test('throws 404 when user is missing', async () => {
      query.mockResolvedValueOnce({ rows: [] });

      await expect(service.getUniverseState(404)).rejects.toEqual({
        status: 404,
        message: 'User not found',
      });
    });
  });

  describe('startTravel', () => {
    function buildTxClient(overrides = {}) {
      const state = {
        user: { current_universe: 1, universe_travel_until: null, level: 10 },
        hasSignal: true,
        hasActiveExpedition: false,
        ...overrides,
      };

      return {
        query: jest.fn(async (sql) => {
          if (sql.includes('FROM users') && sql.includes('FOR UPDATE')) {
            return { rows: [state.user] };
          }
          if (sql.includes('FROM user_story_items')) {
            return { rows: state.hasSignal ? [{ 1: 1 }] : [] };
          }
          if (sql.includes('FROM expeditions')) {
            return { rows: state.hasActiveExpedition ? [{ 1: 1 }] : [] };
          }
          if (sql.includes('UPDATE users SET universe_travel_until')) {
            return { rows: [] };
          }
          return { rows: [] };
        }),
      };
    }

    test('starts travel from U1 to U2 when requirements pass', async () => {
      const client = buildTxClient();
      withTransaction.mockImplementation(async (cb) => cb(client));

      const result = await service.startTravel(10);

      expect(result.traveling).toBe(true);
      expect(result.from).toBe(1);
      expect(result.to).toBe(2);
      expect(typeof result.travelUntil).toBe('string');
      expect(client.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE users SET universe_travel_until = $1 WHERE id = $2'),
        expect.any(Array)
      );
    });

    test('starts travel from U2 to U1 without requiring signal', async () => {
      const client = buildTxClient({ user: { current_universe: 2, universe_travel_until: null, level: 20 } });
      withTransaction.mockImplementation(async (cb) => cb(client));

      const result = await service.startTravel(10);

      expect(result.from).toBe(2);
      expect(result.to).toBe(1);
    });

    test('rejects when user already traveling', async () => {
      const client = buildTxClient({ user: { current_universe: 1, universe_travel_until: new Date(Date.now() + 60000), level: 10 } });
      withTransaction.mockImplementation(async (cb) => cb(client));

      await expect(service.startTravel(10)).rejects.toEqual({
        status: 409,
        message: 'Already traveling between universes',
      });
    });

    test('rejects first travel without signal item', async () => {
      const client = buildTxClient({ hasSignal: false });
      withTransaction.mockImplementation(async (cb) => cb(client));

      await expect(service.startTravel(10)).rejects.toEqual({
        status: 403,
        message: 'Signal from Another Universe required to travel to Universe 2',
      });
    });

    test('rejects when active expedition exists', async () => {
      const client = buildTxClient({ hasActiveExpedition: true });
      withTransaction.mockImplementation(async (cb) => cb(client));

      await expect(service.startTravel(10)).rejects.toEqual({
        status: 409,
        message: 'Complete active expedition before traveling',
      });
    });

    test('throws 404 if user not found in transaction', async () => {
      const client = {
        query: jest.fn(async (sql) => {
          if (sql.includes('FROM users') && sql.includes('FOR UPDATE')) return { rows: [] };
          return { rows: [] };
        }),
      };
      withTransaction.mockImplementation(async (cb) => cb(client));

      await expect(service.startTravel(999)).rejects.toEqual({
        status: 404,
        message: 'User not found',
      });
    });
  });

  describe('completeTravel', () => {
    test('returns null when user does not exist', async () => {
      query.mockResolvedValueOnce({ rows: [] });

      const result = await service.completeTravel(1);
      expect(result).toBeNull();
    });

    test('returns null when no travel timer is set', async () => {
      query.mockResolvedValueOnce({
        rows: [{ current_universe: 1, universe_travel_until: null }],
      });

      const result = await service.completeTravel(1);
      expect(result).toBeNull();
    });

    test('returns null while still traveling', async () => {
      query.mockResolvedValueOnce({
        rows: [{ current_universe: 1, universe_travel_until: new Date(Date.now() + 60000) }],
      });

      const result = await service.completeTravel(1);
      expect(result).toBeNull();
    });

    test('completes travel to U2 and stores visited marker', async () => {
      query
        .mockResolvedValueOnce({
          rows: [{ current_universe: 1, universe_travel_until: new Date(Date.now() - 60000) }],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const result = await service.completeTravel(77);

      expect(result).toEqual({ completed: true, newUniverse: 2 });
      expect(query).toHaveBeenNthCalledWith(
        2,
        'UPDATE users SET current_universe = $1, universe_travel_until = NULL WHERE id = $2',
        [2, 77]
      );
      expect(query).toHaveBeenNthCalledWith(
        3,
        expect.stringContaining('visited_universe2'),
        [77]
      );
    });

    test('completes travel to U1 and keeps visited marker sticky', async () => {
      query
        .mockResolvedValueOnce({
          rows: [{ current_universe: 2, universe_travel_until: new Date(Date.now() - 60000) }],
        })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const result = await service.completeTravel(77);

      expect(result).toEqual({ completed: true, newUniverse: 1 });
      expect(query).toHaveBeenCalledTimes(3);
      expect(query).toHaveBeenNthCalledWith(
        3,
        expect.stringContaining('visited_universe2'),
        [77]
      );
    });
  });

  describe('getZonesForUniverse', () => {
    test('returns U1 zones with universe marker and lock state', () => {
      const zones = service.getZonesForUniverse(1, 7);

      expect(zones).toEqual([
        { id: 'u1-z1', minLevel: 1, universe: 1, locked: false },
        { id: 'u1-z2', minLevel: 10, universe: 1, locked: true },
      ]);
    });

    test('returns U2 zones with lock state', () => {
      const zones = service.getZonesForUniverse(2, 10);

      expect(zones).toEqual([
        { id: 'u2-z1', minLevel: 5, locked: false },
        { id: 'u2-z2', minLevel: 20, locked: true },
      ]);
    });

    test('returns empty list for U2 when not configured', () => {
      const localService = new UniverseService({ config: { zones: [] } });
      expect(localService.getZonesForUniverse(2, 99)).toEqual([]);
    });
  });
});
