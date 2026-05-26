'use strict';

const { query, withTransaction } = require('../db/pool');
const logger = require('../utils/logger');

const EXHIBITION_DURATION_HOURS = 4;
const LEGENDARY_PLUS = new Set(['legendary', 'mythical', 'hybrid', 'singularity']);
const EXHIBITION_TYPES = new Set(['artifact', 'relic']);
const STOLEN_CHANCE = 0.005;

// priceMult mirrors InventoryDetailModal getRarityConfig
const RARITY_PRICE_MULT = {
  common: 1.0, rare: 2.0, epic: 4.0, legendary: 8.0, mythical: 20.0,
  exotic: 1.5, ancient: 4.0, relic: 9.0, hybrid: 20.0, singularity: 50.0,
};

class ExhibitionService {
  constructor(configManager) {
    this.cfg = configManager;
  }

  _calcSellPrice(item) {
    const mult = RARITY_PRICE_MULT[item.rarity] || 1.0;
    return Math.round(Number(item.base_credits || 0) * mult);
  }

  async sendToExhibition(userId, inventoryItemId) {
    const passRes = await query(
      `SELECT 1 FROM user_story_items WHERE user_id = $1 AND item_key = 'exhibition_pass'`,
      [userId]
    );
    if (!passRes.rows.length) {
      throw { status: 403, message: 'Exhibition pass required' };
    }

    return await withTransaction(async (client) => {
      const activeRes = await client.query(
        `SELECT id FROM user_exhibitions WHERE user_id = $1 AND status = 'active' LIMIT 1`,
        [userId]
      );
      if (activeRes.rows.length > 0) {
        throw { status: 409, message: 'Exhibition already active' };
      }

      const itemRes = await client.query(
        `SELECT ii.*, COALESCE(er.base_credits, 0) AS base_credits
         FROM inventory_items ii
         LEFT JOIN expedition_results er ON er.id = ii.result_id
         WHERE ii.id = $1 AND ii.user_id = $2 AND ii.status = 'in_inventory'
         FOR UPDATE OF ii`,
        [inventoryItemId, userId]
      );
      if (!itemRes.rows.length) {
        throw { status: 404, message: 'Item not found in inventory' };
      }
      const item = itemRes.rows[0];

      if (!EXHIBITION_TYPES.has(item.find_type)) {
        throw { status: 400, message: 'Only artifacts and relics can be exhibited' };
      }
      if (!LEGENDARY_PLUS.has(item.rarity)) {
        throw { status: 400, message: 'Only Legendary+ items can be exhibited' };
      }

      // Sympathy is permanent per item — generate once on first exhibition
      let sympathy = item.viewer_sympathy;
      if (sympathy == null) {
        sympathy = Math.floor(Math.random() * 100) + 1;
        await client.query(
          `UPDATE inventory_items SET viewer_sympathy = $1 WHERE id = $2`,
          [sympathy, inventoryItemId]
        );
      }

      const sellPrice = this._calcSellPrice(item);
      const endsAt = new Date(Date.now() + EXHIBITION_DURATION_HOURS * 3600 * 1000);

      await client.query(
        `UPDATE inventory_items SET status = 'on_exhibition' WHERE id = $1`,
        [inventoryItemId]
      );

      const snapshot = {
        id: item.id, find_type: item.find_type, rarity: item.rarity,
        object_data: item.object_data, template_id: item.template_id,
        base_credits: item.base_credits, sellPrice, sympathy,
      };

      const exhRes = await client.query(
        `INSERT INTO user_exhibitions (user_id, inventory_item_id, item_snapshot, ends_at, sympathy_percent)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [userId, inventoryItemId, JSON.stringify(snapshot), endsAt, sympathy]
      );

      logger.info({ userId, inventoryItemId, sympathy, endsAt }, 'Item sent to exhibition');
      return { ok: true, exhibitionId: exhRes.rows[0].id, endsAt, sympathyPercent: sympathy };
    });
  }

  async getExhibitionStatus(userId) {
    const res = await query(
      `SELECT ue.*, ii.viewer_sympathy, ii.object_data,
              COALESCE(er.base_credits, 0) AS base_credits
       FROM user_exhibitions ue
       LEFT JOIN inventory_items ii ON ii.id = ue.inventory_item_id
       LEFT JOIN expedition_results er ON er.id = ii.result_id
       WHERE ue.user_id = $1
       ORDER BY ue.started_at DESC LIMIT 1`,
      [userId]
    );
    if (!res.rows.length) return { hasExhibition: false };

    const ex = res.rows[0];
    const isActive = ex.status === 'active';
    const isReady = isActive && new Date(ex.ends_at) <= new Date();

    return {
      hasExhibition: true,
      status: ex.status,
      isActive,
      isReady,
      endsAt: ex.ends_at,
      sympathyPercent: ex.sympathy_percent,
      creditsEarned: ex.credits_earned,
      inventoryItemId: ex.inventory_item_id,
      itemSnapshot: ex.item_snapshot,
    };
  }

  async collectExhibitionResult(userId) {
    return await withTransaction(async (client) => {
      const exhRes = await client.query(
        `SELECT * FROM user_exhibitions WHERE user_id = $1 AND status = 'active' FOR UPDATE`,
        [userId]
      );
      if (!exhRes.rows.length) {
        throw { status: 404, message: 'No active exhibition' };
      }
      const ex = exhRes.rows[0];

      if (new Date(ex.ends_at) > new Date()) {
        throw { status: 400, message: 'Exhibition not finished yet', endsAt: ex.ends_at };
      }

      const itemRes = await client.query(
        `SELECT ii.*, COALESCE(er.base_credits, 0) AS base_credits
         FROM inventory_items ii
         LEFT JOIN expedition_results er ON er.id = ii.result_id
         WHERE ii.id = $1`,
        [ex.inventory_item_id]
      );
      if (!itemRes.rows.length) {
        throw { status: 404, message: 'Exhibition item not found' };
      }
      const item = itemRes.rows[0];

      if (Math.random() < STOLEN_CHANCE) {
        await client.query(
          `UPDATE inventory_items SET status = 'sold', sold_at = NOW() WHERE id = $1`,
          [ex.inventory_item_id]
        );
        await client.query(
          `UPDATE user_exhibitions SET status = 'stolen' WHERE id = $1`,
          [ex.id]
        );
        logger.info({ userId, exhibitionId: ex.id }, 'Exhibition item stolen');
        return { outcome: 'stolen', sympathyPercent: ex.sympathy_percent };
      }

      await client.query(
        `UPDATE inventory_items SET status = 'in_inventory' WHERE id = $1`,
        [ex.inventory_item_id]
      );

      const sellPrice = this._calcSellPrice(item);
      const baseSympathy = ex.sympathy_percent;
      // ±5% variance each exhibition run (does not change the stored base value)
      const variance = (Math.random() * 10 - 5); // -5 to +5
      const sympathy = Math.min(100, Math.max(1, Math.round(baseSympathy + variance)));
      const sympathyMultiplier = Number(ex.sympathy_multiplier || 1.0);
      const priceMultiplier = Number(ex.price_multiplier || 1.0);
      const creditsEarned = Math.round((sympathy / 100) * 0.5 * sellPrice * sympathyMultiplier * priceMultiplier);

      await client.query(`UPDATE users SET credits = credits + $1 WHERE id = $2`, [creditsEarned, userId]);
      await client.query(
        `UPDATE user_exhibitions SET status = 'completed', credits_earned = $1 WHERE id = $2`,
        [creditsEarned, ex.id]
      );

      const userRes = await client.query(`SELECT credits FROM users WHERE id = $1`, [userId]);

      logger.info({ userId, exhibitionId: ex.id, baseSympathy, sympathy, creditsEarned }, 'Exhibition completed');
      return {
        outcome: 'returned',
        sympathyPercent: sympathy,       // final value (base ±5%)
        baseSympathy,                    // stored base on item
        creditsEarned,
        creditsRemaining: Number(userRes.rows[0].credits),
        inventoryItemId: ex.inventory_item_id,
      };
    });
  }
}

module.exports = ExhibitionService;
