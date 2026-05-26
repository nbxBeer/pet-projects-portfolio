'use strict';

const { UserService } = require('./userService');

jest.mock('../db/pool', () => ({
  query: jest.fn(),
  withTransaction: jest.fn(),
}));

jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const { query } = require('../db/pool');

describe('UserService universe travel sync', () => {
  let service;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UserService({
      config: {
        zones: [{ id: 'u1-zone', name: 'U1', minLevel: 1, creditMultiplier: 1, xpMultiplier: 1 }],
        universe2: {
          zones: [{ id: 'u2-zone', name: 'U2', nameEn: 'U2', minLevel: 1, creditMultiplier: 1, xpMultiplier: 1 }],
        },
      },
    });
  });

  test('auto-completes expired travel before returning zones', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ current_universe: 2 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ level: 5, current_universe: 2 }] });

    const zones = await service.getAvailableZones(101);

    expect(zones).toHaveLength(1);
    expect(zones[0].universe).toBe(2);
    expect(zones[0].id).toBe('u2-zone');

    expect(query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('UPDATE users'),
      [101]
    );
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('visited_universe2'),
      [101]
    );
  });

  test('does not insert visited marker when no auto-complete happened', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ level: 3, current_universe: 1 }] });

    const zones = await service.getAvailableZones(202);

    expect(zones).toHaveLength(1);
    expect(zones[0].universe).toBe(1);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenNthCalledWith(
      2,
      'SELECT level, current_universe FROM users WHERE id = $1',
      [202]
    );
  });
});
