'use strict';

const { z } = require('zod');
const { query, withTransaction } = require('../db/pool');
const { telegramAuthMiddleware, validateNonce } = require('../middleware/telegramAuth');

const UpgradeSchema = z.object({
  moduleType: z.enum(['scanner', 'cargo', 'capsule']),
  nonce: z.string().min(16).max(128).regex(/^[a-zA-Z0-9_-]+$/),
});

async function upgradeRoutes(fastify, { upgradeService, starsWalletService }) {
  fastify.addHook('preHandler', telegramAuthMiddleware);

  // ── Module upgrade routes ───────────────────────────────────────────────────

  fastify.get('/api/upgrades', async (req, reply) => {
    const info = await upgradeService.getUpgradeInfo(req.user.id);
    return reply.send({ modules: info });
  });

  fastify.post('/api/upgrades/upgrade', async (req, reply) => {
    const parsed = UpgradeSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid request', details: parsed.error.issues });
    }
    const nonceValid = await validateNonce(parsed.data.nonce, req.user.id);
    if (!nonceValid) return reply.code(409).send({ error: 'Invalid or replayed nonce' });
    const result = await upgradeService.upgradeModule(req.user.id, parsed.data.moduleType);
    return reply.send(result);
  });

  // ── Stars wallet routes ─────────────────────────────────────────────────────

  fastify.get('/api/stars/balance', async (req, reply) => {
    const balance = await starsWalletService.getBalance(req.user.id);
    return reply.send(balance);
  });

  fastify.get('/api/stars/history', async (req, reply) => {
    const { limit, offset } = req.query;
    const history = await starsWalletService.getTransactionHistory(req.user.id, {
      limit: parseInt(limit || '20'),
      offset: parseInt(offset || '0'),
    });
    return reply.send({ transactions: history });
  });

  fastify.post('/api/stars/topup', async (req, reply) => {
    const { amount } = req.body || {};
    if (!amount || typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
      return reply.code(400).send({ error: 'amount required (positive finite number)' });
    }
    const result = await starsWalletService.createTopupInvoice(req.user.id, amount);
    return reply.send(result);
  });

  // ── Star Upgrades (persistent, multi-level) ─────────────────────────────────

  fastify.get('/api/star-upgrades', async (req, reply) => {
    const cfg = fastify.gameConfig.config;
    const starDefs = cfg.starUpgrades || {};
    const userId = req.user.id;

    // Get user's current levels
    const res = await query(
      'SELECT upgrade_id, level FROM user_star_upgrades WHERE user_id = $1',
      [userId]
    );
    const owned = Object.fromEntries(res.rows.map(r => [r.upgrade_id, r.level]));

    // Get scanner level for unlock check
    let scannerLevel = 1;
    try {
      const info = await upgradeService.getUpgradeInfo(userId);
      scannerLevel = info?.scanner?.currentLevel ?? 1;
    } catch {}

    const result = {};
    for (const [id, def] of Object.entries(starDefs)) {
      const currentLevel = owned[id] || 0;
      const locked = def.requiresScannerLevel
        ? scannerLevel < def.requiresScannerLevel
        : false;
      result[id] = {
        ...def,
        currentLevel,
        isMaxed: currentLevel >= def.maxLevel,
        locked,
        canAfford: (req.user.starsBalance ?? 0) >= def.costStarsPerLevel,
      };
    }
    return reply.send({ starUpgrades: result });
  });

  fastify.post('/api/star-upgrades/purchase', async (req, reply) => {
    const { upgradeId } = req.body || {};
    if (!upgradeId) return reply.code(400).send({ error: 'upgradeId required' });

    const cfg = fastify.gameConfig.config;
    const def = cfg.starUpgrades?.[upgradeId];
    if (!def) return reply.code(404).send({ error: 'Unknown upgrade' });

    const userId = req.user.id;

    // Check scanner requirement
    if (def.requiresScannerLevel) {
      const info = await upgradeService.getUpgradeInfo(userId);
      const scannerLevel = info?.scanner?.currentLevel ?? 1;
      if (scannerLevel < def.requiresScannerLevel) {
        return reply.code(403).send({ error: `Требуется Сканер уровня ${def.requiresScannerLevel}` });
      }
    }

    const txResult = await withTransaction(async (client) => {
      const cur = await client.query(
        'SELECT level FROM user_star_upgrades WHERE user_id = $1 AND upgrade_id = $2',
        [userId, upgradeId]
      );
      const currentLevel = cur.rows[0]?.level || 0;
      if (currentLevel >= def.maxLevel) {
        throw Object.assign(new Error('Максимальный уровень уже достигнут'), { status: 409 });
      }

      const userRow = await client.query(
        'SELECT stars_balance FROM users WHERE id = $1 FOR UPDATE',
        [userId]
      );
      const balance = Number(userRow.rows[0]?.stars_balance ?? 0);
      if (balance < def.costStarsPerLevel) {
        throw Object.assign(new Error('Недостаточно Stars'), { status: 402 });
      }

      await client.query(
        'UPDATE users SET stars_balance = stars_balance - $1, total_stars_spent = total_stars_spent + $1 WHERE id = $2',
        [def.costStarsPerLevel, userId]
      );

      const newLevel = currentLevel + 1;
      await client.query(
        `INSERT INTO user_star_upgrades (user_id, upgrade_id, level)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, upgrade_id) DO UPDATE SET level = EXCLUDED.level`,
        [userId, upgradeId, newLevel]
      );

      return { newLevel, starsRemaining: balance - def.costStarsPerLevel };
    });

    return reply.send({ ok: true, upgradeId, newLevel: txResult.newLevel, starsRemaining: txResult.starsRemaining });
  });
}

module.exports = upgradeRoutes;
