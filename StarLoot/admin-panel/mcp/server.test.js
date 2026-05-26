'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const http = require('node:http');
const path = require('node:path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const { createServer } = require('./server');

test('configuration requires a secret and a trusted transport', () => {
  assert.throws(() => createServer({ adminSecret: '' }), /STARLOOT_ADMIN_SECRET is required/);
  for (const adminUrl of ['http://example.com', 'https://user:pass@example.com',
    'https://example.com/?token=secret', 'https://example.com/#secret', 'file:///tmp/admin']) {
    assert.throws(() => createServer({ adminUrl, adminSecret: 'test-secret' }), /STARLOOT_ADMIN_URL/);
  }
});

test('stdio tools use the authenticated admin API', async (t) => {
  const requests = [];
  let failure = null;
  const stats = { total_users: '2', active_today: '1', pending_nfts: '0' };
  const players = [
    { id: '123456789', username: 'pilot', first_name: 'Alex' },
    { id: '987654321', username: 'miner', first_name: 'Anna' },
  ];
  const profile = { user: players[0], expeditions: [], inventory: [], buffs: [], modules: [], nfts: [], reputations: [] };
  const events = { events: [{ id: 'event-1', title: 'Double XP', is_active: true }] };
  const api = http.createServer((req, res) => {
    requests.push({ method: req.method, url: req.url, auth: req.headers.authorization });
    if (failure === 'redirect') {
      res.writeHead(302, { Location: '/should-not-follow' });
      res.end();
      return;
    }
    if (failure === 'invalid-json') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('private database connection error');
      return;
    }
    if (failure || req.headers.authorization !== 'Bearer test-secret') {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'test-secret; postgresql://private-password@db' }));
      return;
    }
    const routes = {
      '/api/stats': stats,
      '/api/players': players,
      '/api/player/123456789': profile,
      '/api/events': events,
    };
    res.writeHead(routes[req.url] ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(routes[req.url] || { error: 'Not found' }));
  });
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => api.close(resolve)));

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(__dirname, 'server.js')],
    env: {
      STARLOOT_ADMIN_URL: `http://127.0.0.1:${api.address().port}`,
      STARLOOT_ADMIN_SECRET: 'test-secret',
    },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'starloot-mcp-test', version: '1.0.0' });
  t.after(() => client.close());
  await client.connect(transport);

  const call = (name, args = {}) => client.callTool({ name, arguments: args });
  const data = result => {
    assert.notEqual(result.isError, true);
    return JSON.parse(result.content[0].text);
  };

  await t.test('initializes and advertises four read-only tools', async () => {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(tool => tool.name).sort(),
      ['get_player', 'get_stats', 'list_events', 'list_players']);
    assert.ok(tools.every(tool => tool.annotations.readOnlyHint));
    assert.ok(tools.every(tool => tool.annotations.destructiveHint === false));
  });

  await t.test('returns stats, player detail and events from existing routes', async () => {
    assert.deepEqual(data(await call('get_stats')), stats);
    assert.deepEqual(data(await call('get_player', { userId: '123456789' })), profile);
    assert.deepEqual(data(await call('list_events')), events);
  });

  await t.test('filters players and paginates the matching list', async () => {
    assert.deepEqual(data(await call('list_players', { search: '@PILOT', limit: 1 })),
      { players: [players[0]], total: 1, offset: 0, limit: 1 });
    assert.deepEqual(data(await call('list_players', { offset: 1, limit: 1 })),
      { players: [players[1]], total: 2, offset: 1, limit: 1 });
  });

  await t.test('rejects invalid IDs and unbounded page sizes before HTTP', async () => {
    const before = requests.length;
    assert.equal((await call('get_player', { userId: '../config' })).isError, true);
    assert.equal((await call('list_players', { limit: 101 })).isError, true);
    assert.equal(requests.length, before);
  });

  await t.test('reports upstream failures without exposing secrets', async () => {
    failure = 'unauthorized';
    const result = await call('get_stats');
    assert.equal(result.isError, true);
    assert.equal(result.content[0].text, 'Admin panel returned HTTP 401');
    failure = 'invalid-json';
    const invalid = await call('get_stats');
    assert.equal(invalid.isError, true);
    assert.equal(invalid.content[0].text, 'Admin panel returned invalid JSON');
  });

  await t.test('does not follow redirects with admin credentials', async () => {
    failure = 'redirect';
    const before = requests.length;
    assert.equal((await call('get_stats')).isError, true);
    assert.equal(requests.length, before + 1);
    assert.ok(!requests.some(req => req.url === '/should-not-follow'));
  });

  assert.ok(requests.every(req => req.method === 'GET' && req.auth === 'Bearer test-secret'));
});
