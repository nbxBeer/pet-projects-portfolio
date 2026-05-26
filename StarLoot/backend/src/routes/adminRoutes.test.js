'use strict';

const Fastify = require('fastify');

jest.mock('../db/pool', () => ({
  query: jest.fn(),
}));

const { query } = require('../db/pool');
const adminRoutes = require('./adminRoutes');

function buildDeps(configManager) {
  return {
    nftNotificationService: {
      getPendingNotifications: jest.fn().mockResolvedValue([]),
      sendAdminNotification: jest.fn().mockResolvedValue(undefined),
    },
    userService: {},
    eventService: {
      createEvent: jest.fn(),
      endEvent: jest.fn(),
      listEvents: jest.fn().mockResolvedValue([]),
    },
    tournamentService: {
      createTournament: jest.fn(),
      endTournament: jest.fn(),
      listTournaments: jest.fn().mockResolvedValue([]),
    },
    bot: null,
    starsWalletService: null,
    configManager,
    questService: {},
  };
}

describe('admin quest routes', () => {
  let app;
  let configManager;

  beforeEach(async () => {
    process.env.ADMIN_SECRET = 'test-admin-secret';

    configManager = {
      get: jest.fn((key) => {
        if (key === 'quests') {
          return {
            templates: [{ id: 'q1', faction: 'bioengineers', type: 'find_object' }],
            daily: { count: 3 },
          };
        }
        if (key === 'quests.templates') {
          return [{ id: 'q1', faction: 'bioengineers', type: 'find_object' }];
        }
        return undefined;
      }),
      set: jest.fn().mockResolvedValue(undefined),
    };

    query.mockReset();

    app = Fastify({ logger: false });
    await app.register(adminRoutes, buildDeps(configManager));
  });

  afterEach(async () => {
    delete process.env.ADMIN_SECRET;
    await app.close();
  });

  test('rejects access without admin secret', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/quests/templates',
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'Forbidden' });
  });

  test('returns templates with valid admin secret', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/quests/templates',
      headers: { 'x-admin-secret': 'test-admin-secret' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().templates).toHaveLength(1);
    expect(res.json().templates[0].id).toBe('q1');
  });

  test('validates templates-bulk payload', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/quests/templates-bulk',
      headers: { 'x-admin-secret': 'test-admin-secret' },
      payload: { templates: 'not-an-array' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'templates array required' });
    expect(configManager.set).not.toHaveBeenCalled();
  });

  test('wipe-refresh executes both cleanup queries', async () => {
    query.mockResolvedValue({ rows: [], rowCount: 0 });

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/quests/wipe-refresh',
      headers: { 'x-admin-secret': 'test-admin-secret' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenNthCalledWith(1, "DELETE FROM user_quests WHERE status IN ('active', 'completed')");
    expect(query).toHaveBeenNthCalledWith(2, 'DELETE FROM user_quest_refresh WHERE TRUE');
  });
});

// ── Prestige admin routes ─────────────────────────────────────────────────────

function buildDepsWithPrestige(overrides = {}) {
  return {
    nftNotificationService: { getPendingNotifications: jest.fn().mockResolvedValue([]) },
    userService: {},
    eventService: { createEvent: jest.fn(), endEvent: jest.fn(), listEvents: jest.fn().mockResolvedValue([]) },
    tournamentService: { createTournament: jest.fn(), endTournament: jest.fn(), listTournaments: jest.fn().mockResolvedValue([]) },
    bot: null,
    starsWalletService: null,
    configManager: { get: jest.fn().mockReturnValue({}), set: jest.fn() },
    questService: {},
    newsService: { getNews: jest.fn(), upsertNews: jest.fn(), setVisibility: jest.fn() },
    prestigeService: {
      getHistory: jest.fn().mockResolvedValue([]),
      getUserHistory: jest.fn().mockResolvedValue([]),
      getStatus: jest.fn().mockResolvedValue({ prestigeLevel: 0, eligible: false }),
      ...overrides,
    },
  };
}

describe('admin prestige routes', () => {
  let app;

  beforeEach(async () => {
    process.env.ADMIN_SECRET = 'secret123';
    query.mockReset();
    app = Fastify({ logger: false });
    await app.register(adminRoutes, buildDepsWithPrestige());
  });

  afterEach(async () => {
    delete process.env.ADMIN_SECRET;
    await app.close();
  });

  test('GET /api/admin/prestiges returns history', async () => {
    const mockHistory = [
      { id: 1, user_id: 100, prestige_level: 1, achieved_at: '2026-01-01', username: 'pilot' },
    ];
    app.close();
    app = Fastify({ logger: false });
    await app.register(adminRoutes, buildDepsWithPrestige({
      getHistory: jest.fn().mockResolvedValue(mockHistory),
    }));

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/prestiges',
      headers: { 'x-admin-secret': 'secret123' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().history).toEqual(mockHistory);
  });

  test('GET /api/admin/prestiges requires auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/prestiges',
    });
    expect(res.statusCode).toBe(403);
  });

  test('GET /api/admin/prestiges/:userId returns user history and status', async () => {
    const mockUserHistory = [{ prestige_level: 1, achieved_at: '2026-01-01' }];
    const mockStatus = { prestigeLevel: 1, eligible: false };
    app.close();
    app = Fastify({ logger: false });
    await app.register(adminRoutes, buildDepsWithPrestige({
      getUserHistory: jest.fn().mockResolvedValue(mockUserHistory),
      getStatus: jest.fn().mockResolvedValue(mockStatus),
    }));

    const res = await app.inject({
      method: 'GET',
      url: '/api/admin/prestiges/42',
      headers: { 'x-admin-secret': 'secret123' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().history).toEqual(mockUserHistory);
    expect(res.json().status).toEqual(mockStatus);
  });

  test('POST /api/admin/prestiges/:userId/set sets prestige level', async () => {
    query.mockResolvedValue({ rows: [] });

    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/prestiges/99/set',
      headers: { 'x-admin-secret': 'secret123', 'content-type': 'application/json' },
      payload: JSON.stringify({ prestigeLevel: 2 }),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, userId: 99, prestigeLevel: 2 });
    expect(query).toHaveBeenCalledWith(
      'UPDATE users SET prestige_level = $1 WHERE id = $2',
      [2, 99]
    );
  });

  test('POST /api/admin/prestiges/:userId/set rejects invalid level (-1)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/prestiges/99/set',
      headers: { 'x-admin-secret': 'secret123', 'content-type': 'application/json' },
      payload: JSON.stringify({ prestigeLevel: -1 }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('0–3');
  });

  test('POST /api/admin/prestiges/:userId/set rejects level > 3', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/prestiges/99/set',
      headers: { 'x-admin-secret': 'secret123', 'content-type': 'application/json' },
      payload: JSON.stringify({ prestigeLevel: 4 }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('0–3');
  });

  test('POST /api/admin/prestiges/:userId/set rejects missing level', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/prestiges/99/set',
      headers: { 'x-admin-secret': 'secret123', 'content-type': 'application/json' },
      payload: JSON.stringify({}),
    });
    expect(res.statusCode).toBe(400);
  });

  test('POST /api/admin/prestiges/:userId/set allows level 0 (reset)', async () => {
    query.mockResolvedValue({ rows: [] });
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/prestiges/77/set',
      headers: { 'x-admin-secret': 'secret123', 'content-type': 'application/json' },
      payload: JSON.stringify({ prestigeLevel: 0 }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().prestigeLevel).toBe(0);
    expect(query).toHaveBeenCalledWith(
      'UPDATE users SET prestige_level = $1 WHERE id = $2',
      [0, 77]
    );
  });

  test('POST /api/admin/prestiges/:userId/set allows level 3', async () => {
    query.mockResolvedValue({ rows: [] });
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/prestiges/55/set',
      headers: { 'x-admin-secret': 'secret123', 'content-type': 'application/json' },
      payload: JSON.stringify({ prestigeLevel: 3 }),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().prestigeLevel).toBe(3);
  });

  test('GET /api/admin/prestiges passes limit and offset to getHistory', async () => {
    const mockGetHistory = jest.fn().mockResolvedValue([]);
    app.close();
    app = Fastify({ logger: false });
    await app.register(adminRoutes, buildDepsWithPrestige({ getHistory: mockGetHistory }));

    await app.inject({
      method: 'GET',
      url: '/api/admin/prestiges?limit=10&offset=20',
      headers: { 'x-admin-secret': 'secret123' },
    });

    expect(mockGetHistory).toHaveBeenCalledWith({ limit: 10, offset: 20 });
  });

  test('GET /api/admin/prestiges clamps limit to 200', async () => {
    const mockGetHistory = jest.fn().mockResolvedValue([]);
    app.close();
    app = Fastify({ logger: false });
    await app.register(adminRoutes, buildDepsWithPrestige({ getHistory: mockGetHistory }));

    await app.inject({
      method: 'GET',
      url: '/api/admin/prestiges?limit=999',
      headers: { 'x-admin-secret': 'secret123' },
    });

    expect(mockGetHistory).toHaveBeenCalledWith({ limit: 200, offset: 0 });
  });
});
