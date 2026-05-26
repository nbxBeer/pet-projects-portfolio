'use strict';

const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { z } = require('zod');

function createServer({
  adminUrl = process.env.STARLOOT_ADMIN_URL || 'http://127.0.0.1:8765',
  adminSecret = process.env.STARLOOT_ADMIN_SECRET,
} = {}) {
  if (!adminSecret || !adminSecret.trim()) {
    throw new Error('STARLOOT_ADMIN_SECRET is required (admin-panel/config.json: adminSecret)');
  }

  const baseUrl = new URL(adminUrl);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(baseUrl.hostname);
  if (baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash ||
      (baseUrl.protocol !== 'https:' && !(local && baseUrl.protocol === 'http:'))) {
    throw new Error('STARLOOT_ADMIN_URL must use HTTPS, or HTTP on localhost, without credentials/query/hash');
  }
  baseUrl.pathname = `${baseUrl.pathname.replace(/\/+$/, '')}/`;

  async function get(path) {
    let response;
    try {
      response = await fetch(new URL(path, baseUrl), {
        method: 'GET',
        headers: { Authorization: `Bearer ${adminSecret}`, Accept: 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      throw new Error('Admin panel request failed or timed out; check STARLOOT_ADMIN_URL');
    }
    // Do not expose upstream error bodies: they can contain database credentials.
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Admin panel returned HTTP ${response.status}`);
    }
    try {
      return await response.json();
    } catch {
      throw new Error('Admin panel returned invalid JSON');
    }
  }

  const server = new McpServer({ name: 'starloot-admin', version: '0.1.0' });
  function tool(name, description, inputSchema, run) {
    server.registerTool(name, {
      description,
      inputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, async (args) => {
      try {
        const data = await run(args);
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      } catch (err) {
        return { isError: true, content: [{ type: 'text', text: err.message }] };
      }
    });
  }

  tool('get_stats', 'Get player, expedition and pending NFT totals.', {}, () => get('api/stats'));

  tool('list_players', 'List recent players, optionally filtered by ID, username or name. Pagination is applied after filtering.', {
    search: z.string().max(100).optional(),
    limit: z.number().int().min(1).max(100).default(20),
    offset: z.number().int().min(0).default(0),
  }, async ({ search, limit, offset }) => {
    const players = await get('api/players');
    if (!Array.isArray(players)) throw new Error('Admin panel returned an invalid player list');
    const term = (search || '').trim().toLowerCase().replace(/^@/, '');
    const matches = players.filter(player => !term ||
      [player.id, player.username, player.first_name, player.last_name]
        .some(value => String(value ?? '').toLowerCase().includes(term)));
    return { players: matches.slice(offset, offset + limit), total: matches.length, offset, limit };
  });

  tool('get_player', 'Get a player profile, recent expeditions, inventory, buffs, modules, NFTs and reputations.', {
    userId: z.string().regex(/^[1-9][0-9]{0,15}$/).describe('Telegram user ID as a string'),
  }, ({ userId }) => get(`api/player/${userId}`));

  tool('list_events', 'List the latest global events, including past events.', {}, () => get('api/events'));

  return server;
}

if (require.main === module) {
  (async () => {
    await createServer().connect(new StdioServerTransport());
  })().catch(err => {
    console.error(err.message);
    process.exitCode = 1;
  });
}

module.exports = { createServer };
