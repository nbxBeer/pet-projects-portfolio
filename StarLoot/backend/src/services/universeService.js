'use strict';

const { query, withTransaction } = require('../db/pool');
const logger = require('../utils/logger');

class UniverseService {
  constructor(configManager) {
    this.cfg = configManager;
  }

  /**
   * Get universe state for a user.
   */
  async getUniverseState(userId) {
    const res = await query(
      'SELECT current_universe, crystals, universe_travel_until FROM users WHERE id = $1',
      [userId]
    );
    if (!res.rows.length) throw { status: 404, message: 'User not found' };
    const user = res.rows[0];

    // Auto-complete travel when timer is over so UI always receives fresh universe.
    if (user.universe_travel_until && new Date(user.universe_travel_until) <= new Date()) {
      await this.completeTravel(userId);
      const updatedRes = await query(
        'SELECT current_universe, crystals, universe_travel_until FROM users WHERE id = $1',
        [userId]
      );
      const updatedUser = updatedRes.rows[0];
      return {
        currentUniverse: updatedUser.current_universe,
        crystals: Number(updatedUser.crystals),
        isTraveling: false,
        travelUntil: null,
      };
    }

    const isTraveling = Boolean(
      user.universe_travel_until && new Date(user.universe_travel_until) > new Date()
    );
    return {
      currentUniverse: user.current_universe,
      crystals: Number(user.crystals),
      isTraveling,
      travelUntil: isTraveling ? user.universe_travel_until : null,
    };
  }

  /**
   * Start traveling to the other universe. Takes 6 hours.
    * While travel is active, user cannot start regular expeditions.
   * After travel completes, the first call to getUniverseState or any expedition action
   * will auto-complete the travel.
   */
  async startTravel(userId) {
    const u2Config = this.cfg.config.universe2;
    const travelHours = u2Config?.travelDurationHours || 6;

    return await withTransaction(async (client) => {
      const userRes = await client.query(
        'SELECT current_universe, universe_travel_until, level FROM users WHERE id = $1 FOR UPDATE',
        [userId]
      );
      if (!userRes.rows.length) throw { status: 404, message: 'User not found' };
      const user = userRes.rows[0];

      // Check if already traveling
      if (user.universe_travel_until && new Date(user.universe_travel_until) > new Date()) {
        throw { status: 409, message: 'Already traveling between universes' };
      }

      // Check if has Signal from Another Universe (required for first travel to U2)
      if (user.current_universe === 1) {
        const signal = await client.query(
          `SELECT 1 FROM user_story_items WHERE user_id = $1 AND item_key = 'signal_from_another_universe'`,
          [userId]
        );
        if (!signal.rows.length) {
          throw { status: 403, message: 'Signal from Another Universe required to travel to Universe 2' };
        }
      }

      const hasTravelReducer = await client.query(
        `SELECT 1 FROM user_story_items WHERE user_id = $1 AND item_key = 'hyperlane_beacon'`,
        [userId]
      );

      // Check no active expedition
      const activeExp = await client.query(
        `SELECT 1 FROM expeditions WHERE user_id = $1 AND status IN ('in_progress', 'completed') LIMIT 1`,
        [userId]
      );
      if (activeExp.rows.length > 0) {
        throw { status: 409, message: 'Complete active expedition before traveling' };
      }

      const effectiveHours = hasTravelReducer.rows.length > 0 ? Math.max(1, travelHours * 0.5) : travelHours;
      const travelUntil = new Date(Date.now() + effectiveHours * 3600 * 1000);
      const targetUniverse = user.current_universe === 1 ? 2 : 1;

      await client.query(
        'UPDATE users SET universe_travel_until = $1 WHERE id = $2',
        [travelUntil, userId]
      );

      logger.info({ userId, from: user.current_universe, to: targetUniverse, travelUntil }, 'Universe travel started');

      return {
        traveling: true,
        from: user.current_universe,
        to: targetUniverse,
        travelUntil: travelUntil.toISOString(),
        travelHours: effectiveHours,
      };
    });
  }

  /**
   * Complete travel if timer expired. Called automatically on state checks.
   */
  async completeTravel(userId) {
    const res = await query(
      'SELECT current_universe, universe_travel_until FROM users WHERE id = $1',
      [userId]
    );
    if (!res.rows.length) return null;
    const user = res.rows[0];

    if (!user.universe_travel_until) return null;
    if (new Date(user.universe_travel_until) > new Date()) return null; // still traveling

    const newUniverse = user.current_universe === 1 ? 2 : 1;
    await query(
      'UPDATE users SET current_universe = $1, universe_travel_until = NULL WHERE id = $2',
      [newUniverse, userId]
    );

    // Insert when arriving at U2 OR when returning from U2 — keeps the flag sticky
    await query(
      `INSERT INTO user_story_items (user_id, item_key, item_data)
       VALUES ($1, 'visited_universe2', '{}'::jsonb)
       ON CONFLICT (user_id, item_key) DO NOTHING`,
      [userId]
    );

    logger.info({ userId, newUniverse }, 'Universe travel completed');
    return { completed: true, newUniverse };
  }

  /**
   * Get zones available for the user's current universe.
   */
  getZonesForUniverse(universe, userLevel) {
    const config = this.cfg.config;
    if (universe === 2) {
      const u2Zones = config.universe2?.zones || [];
      return u2Zones.map(z => ({
        ...z,
        locked: userLevel < z.minLevel,
      }));
    }
    // Universe 1 zones
    return (config.zones || []).map(z => ({
      ...z,
      universe: 1,
      locked: userLevel < z.minLevel,
    }));
  }
}

module.exports = UniverseService;
