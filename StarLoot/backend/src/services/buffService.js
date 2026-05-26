'use strict';

const { query, withTransaction } = require('../db/pool');
const logger = require('../utils/logger');

class BuffService {
  constructor(configManager) {
    this.cfg = configManager;
  }

  // Returns array of active (non-expired, non-exhausted) buff rows
  async getActiveBuffs(userId) {
    const result = await query(
      `SELECT * FROM user_active_buffs
       WHERE user_id = $1
         AND (expires_at IS NULL OR expires_at > NOW())
         AND (uses_remaining IS NULL OR uses_remaining > 0)
       ORDER BY created_at DESC`,
      [userId]
    );
    return result.rows;
  }

  // Returns a map of buffType → buff row for quick lookup
  async getActiveBuffsMap(userId) {
    const buffs = await this.getActiveBuffs(userId);
    const map = {};
    for (const b of buffs) {
      map[b.buff_type] = b;
    }
    return map;
  }

  // Purchase a buff with credits
  async purchaseBuff(userId, itemType) {
    const config = this.cfg.config;
    const def = config.shopItems?.[itemType];
    if (!def) throw { status: 400, message: 'Unknown item type' };
    if (def.hidden) throw { status: 403, message: 'This item is currently unavailable' };
    if (!def.costCredits) throw { status: 400, message: 'This item requires Stars, not credits' };

    return await withTransaction(async (client) => {
      const userRes = await client.query(
        'SELECT * FROM users WHERE id = $1 FOR UPDATE',
        [userId]
      );
      if (!userRes.rows.length) throw { status: 404, message: 'User not found' };
      const user = userRes.rows[0];

      if (def.minLevel && user.level < def.minLevel) {
        throw { status: 403, message: `Требуется уровень ${def.minLevel}` };
      }

      if (Number(user.credits) < def.costCredits) {
        throw {
          status: 402,
          message: 'Недостаточно кредитов',
          required: def.costCredits,
          current: Number(user.credits),
        };
      }

      // Cartographer: requires a completed expedition to know the last find type
      let metadata = { ...def.metadata };
      if (def.buffType === 'cartographer') {
        const lastRes = await client.query(
          `SELECT er.find_type
           FROM expedition_results er
           JOIN expeditions e ON e.id = er.expedition_id
           WHERE er.user_id = $1
             AND e.status IN ('completed', 'collected')
             AND er.find_type NOT IN ('nft_container')
           ORDER BY er.created_at DESC LIMIT 1`,
          [userId]
        );
        if (!lastRes.rows.length) {
          throw {
            status: 409,
            message: 'Нет завершённых экспедиций. Картограф не активирован, кредиты не списаны.',
          };
        }
        metadata.targetType = lastRes.rows[0].find_type;
      }

      await client.query(
        'UPDATE users SET credits = credits - $1 WHERE id = $2',
        [def.costCredits, userId]
      );

      await client.query(
        `INSERT INTO credit_transactions
           (user_id, type, amount, balance_before, balance_after)
         VALUES ($1, 'spend_buff_credits', $2, $3, $4)`,
        [userId, -def.costCredits, Number(user.credits), Number(user.credits) - def.costCredits]
      );

      const expiresAt = def.durationHours
        ? new Date(Date.now() + def.durationHours * 3600 * 1000)
        : null;
      const usesRemaining = def.usesTotal ?? null;

      // stackable buffs (e.g. remote_scanner) accumulate uses; others replace
      const conflictUpdate = def.stackable
        ? `uses_remaining = COALESCE(user_active_buffs.uses_remaining, 0) + EXCLUDED.uses_remaining,
           metadata       = EXCLUDED.metadata,
           created_at     = NOW()`
        : `expires_at     = EXCLUDED.expires_at,
           uses_remaining = EXCLUDED.uses_remaining,
           metadata       = EXCLUDED.metadata,
           created_at     = NOW()`;

      await client.query(
        `INSERT INTO user_active_buffs (user_id, buff_type, expires_at, uses_remaining, metadata)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id, buff_type) DO UPDATE SET ${conflictUpdate}`,
        [userId, def.buffType, expiresAt, usesRemaining, JSON.stringify(metadata)]
      );

      logger.info({ userId, itemType, buffType: def.buffType, cost: def.costCredits }, 'Buff purchased (credits)');

      return {
        success: true,
        buffType: def.buffType,
        label: def.label,
        expiresAt,
        usesRemaining,
        creditsRemaining: Number(user.credits) - def.costCredits,
        metadata,
      };
    });
  }

  // Purchase a buff with Stars
  async purchaseBuffStars(userId, itemType) {
    const config = this.cfg.config;
    const def = config.shopItems?.[itemType];
    if (!def) throw { status: 400, message: 'Unknown item type' };
    if (def.hidden) throw { status: 403, message: 'This item is currently unavailable' };
    if (!def.costStars) throw { status: 400, message: 'This item requires credits, not Stars' };

    return await withTransaction(async (client) => {
      const userRes = await client.query(
        'SELECT * FROM users WHERE id = $1 FOR UPDATE',
        [userId]
      );
      if (!userRes.rows.length) throw { status: 404, message: 'User not found' };
      const user = userRes.rows[0];

      if (user.stars_balance < def.costStars) {
        throw {
          status: 402,
          message: 'Недостаточно Stars',
          required: def.costStars,
          current: user.stars_balance,
        };
      }

      await client.query(
        `UPDATE users
         SET stars_balance = stars_balance - $1,
             total_stars_spent = total_stars_spent + $1
         WHERE id = $2`,
        [def.costStars, userId]
      );

      await client.query(
        `INSERT INTO stars_transactions
           (user_id, type, amount, balance_before, balance_after, description)
         VALUES ($1, 'spend_other', $2, $3, $4, $5)`,
        [userId, -def.costStars, user.stars_balance, user.stars_balance - def.costStars, def.label]
      );

      const expiresAt = def.durationHours
        ? new Date(Date.now() + def.durationHours * 3600 * 1000)
        : null;
      const usesRemaining = def.usesTotal ?? null;

      // stackable buffs (e.g. remote_scanner) accumulate uses; others replace
      const conflictUpdate = def.stackable
        ? `uses_remaining = COALESCE(user_active_buffs.uses_remaining, 0) + EXCLUDED.uses_remaining,
           metadata       = EXCLUDED.metadata,
           created_at     = NOW()`
        : `expires_at     = EXCLUDED.expires_at,
           uses_remaining = EXCLUDED.uses_remaining,
           metadata       = EXCLUDED.metadata,
           created_at     = NOW()`;

      await client.query(
        `INSERT INTO user_active_buffs (user_id, buff_type, expires_at, uses_remaining, metadata)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (user_id, buff_type) DO UPDATE SET ${conflictUpdate}`,
        [userId, def.buffType, expiresAt, usesRemaining, JSON.stringify(def.metadata)]
      );

      logger.info({ userId, itemType, buffType: def.buffType, costStars: def.costStars }, 'Buff purchased (stars)');

      return {
        success: true,
        buffType: def.buffType,
        label: def.label,
        expiresAt,
        usesRemaining,
        starsRemaining: user.stars_balance - def.costStars,
      };
    });
  }

  // Consume one use from a use-based buff (cartographer, quantum_locator)
  async consumeUseBuff(userId, buffType) {
    await query(
      `UPDATE user_active_buffs
       SET uses_remaining = uses_remaining - 1
       WHERE user_id = $1 AND buff_type = $2 AND uses_remaining > 0`,
      [userId, buffType]
    );
    await query(
      `DELETE FROM user_active_buffs
       WHERE user_id = $1 AND buff_type = $2 AND uses_remaining IS NOT NULL AND uses_remaining <= 0`,
      [userId, buffType]
    );
  }
}

module.exports = BuffService;
