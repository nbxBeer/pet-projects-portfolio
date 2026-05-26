'use strict';

const Fastify = require('fastify');

jest.mock('../db/pool', () => ({ query: jest.fn() }));
const { query } = require('../db/pool');
const adminRoutes = require('./adminRoutes');

function buildDeps() {
  return {
    nftNotificationService: { getPendingNotifications: jest.fn().mockResolvedValue([]) },
    userService: {},
    eventService: { createEvent: jest.fn(), endEvent: jest.fn(), listEvents: jest.fn().mockResolvedValue([]) },
    tournamentService: { createTournament: jest.fn(), endTournament: jest.fn(), listTournaments: jest.fn().mockResolvedValue([]) },
    bot: null,
    starsWalletService: null,
    configManager: { get: jest.fn().mockReturnValue({}) },
    questService: {},
    newsService: { getNews: jest.fn(), upsertNews: jest.fn(), setVisibility: jest.fn() },
    prestigeService: { getHistory: jest.fn().mockResolvedValue([]) },
  };
}

describe('admin chat-sources endpoints', () => {
  let app;

  beforeEach(async () => {
    process.env.ADMIN_SECRET = 'adm';
    query.mockReset();
    app = Fastify({ logger: false });
    await app.register(adminRoutes, buildDeps());
  });

  afterEach(async () => {
    delete process.env.ADMIN_SECRET;
    await app.close();
  });

  test('GET /api/admin/chat-sources returns list', async () => {
    const rows = [{ id: 1, chat_id: -100, chat_title: 'C1', registrations: 3 }];
    query.mockResolvedValueOnce(rows);

    const res = await app.inject({ method: 'GET', url: '/api/admin/chat-sources', headers: { 'x-admin-secret': 'adm' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().chatSources).toEqual(rows);
  });

  test('GET /api/admin/chat-sources/:chatId/users returns users and total', async () => {
    const users = [{ id: 10, username: 'u1' }];
    // first call: users array, second call: total.rows
    query.mockResolvedValueOnce(users).mockResolvedValueOnce({ rows: [{ cnt: 1 }] });

    const res = await app.inject({ method: 'GET', url: '/api/admin/chat-sources/123/users', headers: { 'x-admin-secret': 'adm' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().users).toEqual(users);
    expect(res.json().total).toBe(1);
  });

  test('PATCH /api/admin/chat-sources/:chatId updates owner/group/title', async () => {
    query.mockResolvedValue({});

    const payload = { ownerUserId: 555, groupId: 'g-1', chatTitle: 'New title' };
    const res = await app.inject({ method: 'PATCH', url: '/api/admin/chat-sources/999', headers: { 'x-admin-secret': 'adm', 'content-type': 'application/json' }, payload });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
    // ensure UPDATE query was called with chatId param last
    const lastCallArgs = query.mock.calls[query.mock.calls.length - 1];
    const calledParams = lastCallArgs[1] || [];
    expect(calledParams[calledParams.length - 1]).toBe(999);
  });

  test('GET /api/admin/chat-sources/stats/summary returns structure', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ source_type: 'organic', registrations: 10, total_stars_spent: 0 }] })
      .mockResolvedValueOnce({ rows: [{ chat_id: -100, chat_title: 'C1', registrations: 5, total_stars_spent: 0 }] })
      .mockResolvedValueOnce({ rows: [{ source: 'vk', starts_count: 3, unique_users: 2, last_start_at: null }] });

    const res = await app.inject({ method: 'GET', url: '/api/admin/chat-sources/stats/summary', headers: { 'x-admin-secret': 'adm' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().bySource).toBeDefined();
    expect(res.json().topChats).toBeDefined();
    expect(res.json().adsLinks).toBeDefined();
  });
});
