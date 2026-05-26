'use strict';

const { query } = require('../db/pool');
const logger = require('../utils/logger');

const DEFAULT_START_AT = '2026-04-08T16:00:00Z';
const EXPEDITIONS_PER_GIFT = 100;

class MiniTournamentService {
  constructor({ bot = null } = {}) {
    this.bot = bot;
    this.startAt = new Date(process.env.MINI_TOURNAMENT_START_AT || DEFAULT_START_AT);
    this.expeditionsPerGift = EXPEDITIONS_PER_GIFT;
  }

  _isActive() {
    return Number.isFinite(this.startAt.getTime()) && new Date() >= this.startAt;
  }

  _format(row) {
    const expeditionsCount = Number(row.expeditions_count || 0);
    const giftsIssued = Number(row.gifts_issued || 0);
    const giftsPending = Number(row.gifts_pending || 0);
    const perGift = this.expeditionsPerGift;
    const currentBlock = expeditionsCount % perGift;
    const expeditionsToNextGift = currentBlock === 0 ? perGift : (perGift - currentBlock);
    return {
      isActive: this._isActive(),
      startAt: this.startAt.toISOString(),
      expeditionsPerGift: perGift,
      expeditionsCount,
      giftsIssued,
      giftsPending,
      expeditionsToNextGift,
    };
  }

  async _syncProgress(userId) {
    if (!this._isActive()) {
      return {
        row: {
          expeditions_count: 0,
          gifts_issued: 0,
          gifts_pending: 0,
          last_notified_milestone: 0,
        },
        newlyReachedMilestone: 0,
      };
    }

    const countRes = await query(
      `SELECT COUNT(*)::INT AS cnt
       FROM expeditions
       WHERE user_id = $1
         AND status IN ('completed', 'collected')
         AND collected_at IS NOT NULL
         AND collected_at >= $2`,
      [userId, this.startAt.toISOString()]
    );
    const expeditionsCount = Number(countRes.rows[0]?.cnt || 0);

    const upsertRes = await query(
      `INSERT INTO mini_tournament_progress (user_id, expeditions_count)
       VALUES ($1, $2)
       ON CONFLICT (user_id)
       DO UPDATE SET expeditions_count = EXCLUDED.expeditions_count,
                     updated_at = NOW()
       RETURNING user_id, expeditions_count, gifts_issued, gifts_pending, last_notified_milestone`,
      [userId, expeditionsCount]
    );

    let row = upsertRes.rows[0];
    const giftsIssued = Number(row.gifts_issued || 0);
    const eligibleGifts = Math.floor(expeditionsCount / this.expeditionsPerGift);
    const requiredPending = Math.max(0, eligibleGifts - giftsIssued);

    if (requiredPending !== Number(row.gifts_pending || 0)) {
      const pendingRes = await query(
        `UPDATE mini_tournament_progress
         SET gifts_pending = $2,
             updated_at = NOW()
         WHERE user_id = $1
         RETURNING user_id, expeditions_count, gifts_issued, gifts_pending, last_notified_milestone`,
        [userId, requiredPending]
      );
      row = pendingRes.rows[0] || row;
    }

    const lastMilestone = Number(row.last_notified_milestone || 0);
    const newlyReachedMilestone = (eligibleGifts > lastMilestone && eligibleGifts > 0) ? eligibleGifts : 0;

    return { row, newlyReachedMilestone };
  }

  async getUserStats(userId) {
    const { row } = await this._syncProgress(userId);
    return this._format(row);
  }

  async _markMilestone(userId, milestone) {
    await query(
      `UPDATE mini_tournament_progress SET last_notified_milestone = $2, updated_at = NOW() WHERE user_id = $1`,
      [userId, milestone]
    );
  }

  async trackCompletionAndNotify(userId) {
    const { row, newlyReachedMilestone } = await this._syncProgress(userId);

    // DISABLED: Mini-tournament notifications are disabled
    // if (newlyReachedMilestone > 0) {
    //   if (!this.bot || typeof this.bot.notifyMiniTournamentReached !== 'function') {
    //     logger.warn({ userId, newlyReachedMilestone }, 'Mini-tournament: bot not available — will retry on next expedition');
    //   } else {
    //     try {
    //       const userRes = await query(
    //         `SELECT id, username, first_name FROM users WHERE id = $1`,
    //         [userId]
    //       );
    //       const user = userRes.rows[0] || { id: userId };

    //       await this.bot.notifyMiniTournamentReached({
    //         userId: user.id,
    //         username: user.username,
    //         firstName: user.first_name,
    //         milestone: newlyReachedMilestone,
    //         expeditionsCount: Number(row.expeditions_count || 0),
    //         giftsIssued: Number(row.gifts_issued || 0),
    //         giftsPending: Number(row.gifts_pending || 0),
    //         expeditionsPerGift: this.expeditionsPerGift,
    //       });
    //       // Mark milestone only after notification is confirmed sent
    //       await this._markMilestone(userId, newlyReachedMilestone);
    //     } catch (err) {
    //       logger.warn({ err, userId, newlyReachedMilestone }, 'Mini-tournament notify failed — will retry on next expedition');
    //     }
    //   }
    // }

    return this._format(row);
  }

  async markGiftAsIssued(userId, milestone) {
    if (!this._isActive()) {
      throw new Error('Mini tournament not active');
    }

    const updateRes = await query(
      `UPDATE mini_tournament_progress
       SET gifts_issued = gifts_issued + 1,
           gifts_pending = GREATEST(0, gifts_pending - 1),
           updated_at = NOW()
       WHERE user_id = $1
       RETURNING user_id, expeditions_count, gifts_issued, gifts_pending, last_notified_milestone`,
      [userId]
    );

    if (!updateRes.rows?.length) {
      throw new Error('User mini-tournament progress not found');
    }

    const row = updateRes.rows[0];
    logger.info({ userId, milestone, giftsIssued: row.gifts_issued, giftsPending: row.gifts_pending }, 'Gift marked as issued');
    return this._format(row);
  }
}

module.exports = MiniTournamentService;
