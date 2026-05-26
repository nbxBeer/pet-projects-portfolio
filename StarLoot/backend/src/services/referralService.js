'use strict';

const { query, withTransaction } = require('../db/pool');
const logger = require('../utils/logger');

class ReferralService {
  constructor(configManager) {
    this.cfg = configManager;
  }

  _config() {
    return this.cfg.get('referral');
  }

  // ── Set referrer for a new user (called once during registration) ──────────
  async setReferrer(userId, referrerId) {
    if (!referrerId || userId === referrerId) return false;

    // Check referrer exists
    if (referrerId === userId) return false; // self-referral blocked

    const ref = await query('SELECT id FROM users WHERE id = $1', [referrerId]);
    if (ref.rows.length === 0) return false;

    // Check user doesn't already have a referrer
    const user = await query('SELECT referred_by FROM users WHERE id = $1', [userId]);
    if (!user.rows.length || user.rows[0].referred_by) return false;

    await query('UPDATE users SET referred_by = $1, pending_referrer_id = NULL WHERE id = $2 AND referred_by IS NULL', [referrerId, userId]);
    logger.info({ userId, referrerId }, 'Referrer set');
    return true;
  }

  // ── Check & activate referral if conditions met ───────────────────────────
  async checkActivation(userId) {
    const cfg = this._config();
    const user = await query(
      'SELECT id, referred_by, referral_activated, total_expeditions, credits FROM users WHERE id = $1',
      [userId]
    );
    if (!user.rows.length) return;
    const u = user.rows[0];

    // Already activated, no referrer, or self-referral
    if (u.referral_activated || !u.referred_by || u.referred_by === u.id) return;

    const meetsExpeditions = u.total_expeditions >= cfg.minExpeditionsForActivation;
    const meetsCredits = Number(u.credits) >= cfg.minCreditsForActivation;

    if (!meetsExpeditions && !meetsCredits) return;

    // Activate
    const pendingUntil = new Date(Date.now() + cfg.rewardDelayMs);
    await query(
      `UPDATE users SET referral_activated = true, referral_activated_at = NOW(),
       referral_reward_pending_until = $1 WHERE id = $2`,
      [pendingUntil, userId]
    );
    logger.info({ userId, referrerId: u.referred_by }, 'Referral activated');
  }

  // ── Claim one-time activation rewards (called periodically or on demand) ──
  async claimActivationRewards(userId) {
    const cfg = this._config();

    return await withTransaction(async (client) => {
      const res = await client.query(
        `SELECT id, referred_by, referral_activated, referral_reward_claimed,
                referral_reward_pending_until, credits
         FROM users WHERE id = $1 FOR UPDATE`,
        [userId]
      );
      if (!res.rows.length) return null;
      const u = res.rows[0];

      if (!u.referral_activated || u.referral_reward_claimed || !u.referred_by || u.referred_by === u.id) return null;
      if (u.referral_reward_pending_until && new Date(u.referral_reward_pending_until) > new Date()) {
        return { pending: true, availableAt: u.referral_reward_pending_until };
      }

      // Award referral (this user)
      const referralReward = cfg.referralRewardCredits;
      const userCredits = Number(u.credits);
      await client.query('UPDATE users SET credits = credits + $1, referral_reward_claimed = true WHERE id = $2',
        [referralReward, userId]);
      await client.query(
        `INSERT INTO credit_transactions (user_id, type, amount, balance_before, balance_after, metadata)
         VALUES ($1, 'referral_activation', $2, $3, $4, $5)`,
        [userId, referralReward, userCredits, userCredits + referralReward,
         JSON.stringify({ role: 'referral', referrer: u.referred_by })]
      );

      // Award referrer
      const referrer = await client.query('SELECT id, credits FROM users WHERE id = $1 FOR UPDATE', [u.referred_by]);
      if (referrer.rows.length) {
        const ref = referrer.rows[0];
        const refCredits = Number(ref.credits);
        const referrerReward = cfg.referrerRewardCredits;
        await client.query('UPDATE users SET credits = credits + $1 WHERE id = $2', [referrerReward, ref.id]);
        await client.query(
          `INSERT INTO credit_transactions (user_id, type, amount, balance_before, balance_after, metadata)
           VALUES ($1, 'referral_activation', $2, $3, $4, $5)`,
          [ref.id, referrerReward, refCredits, refCredits + referrerReward,
           JSON.stringify({ role: 'referrer', referral: userId })]
        );
      }

      // Check milestones for referrer
      await this._checkMilestones(client, u.referred_by);

      logger.info({ userId, referrerId: u.referred_by, referralReward, referrerReward: cfg.referrerRewardCredits },
        'Activation rewards claimed');
      return { claimed: true, creditsReceived: referralReward };
    });
  }

  // ── Passive income: credit referrer when referral sells items ──────────────
  async creditPassiveIncome(referralUserId, earnedCredits, sourceType = 'sell_item') {
    if (earnedCredits <= 0) return;
    const cfg = this._config();

    const user = await query(
      'SELECT referred_by, referral_activated FROM users WHERE id = $1',
      [referralUserId]
    );
    if (!user.rows.length || !user.rows[0].referred_by || !user.rows[0].referral_activated) return;

    const referrerId = user.rows[0].referred_by;
    if (referrerId === referralUserId) return; // self-referral guard
    const { percent, creditsCap } = await this._getEffectiveRates(referrerId);
    const rawAmount = Math.floor(earnedCredits * percent / 100);
    if (rawAmount <= 0) return;

    // Check daily limit
    const todayEarned = await this._getDailyTotal(referrerId, 'credits');
    const remaining = Math.max(0, creditsCap - todayEarned);
    const amount = Math.min(rawAmount, remaining);
    if (amount <= 0) return;

    await withTransaction(async (client) => {
      const ref = await client.query('SELECT credits FROM users WHERE id = $1 FOR UPDATE', [referrerId]);
      if (!ref.rows.length) return;
      const refCredits = Number(ref.rows[0].credits);

      await client.query('UPDATE users SET credits = credits + $1 WHERE id = $2', [amount, referrerId]);
      await client.query(
        `INSERT INTO credit_transactions (user_id, type, amount, balance_before, balance_after, metadata)
         VALUES ($1, 'referral_bonus', $2, $3, $4, $5)`,
        [referrerId, amount, refCredits, refCredits + amount,
         JSON.stringify({ referral: referralUserId, source: sourceType, sourceAmount: earnedCredits, percent })]
      );
      await client.query(
        `INSERT INTO referral_earnings (referrer_id, referral_id, currency, amount, source_amount, source_type)
         VALUES ($1, $2, 'credits', $3, $4, $5)`,
        [referrerId, referralUserId, amount, earnedCredits, sourceType]
      );
      await this._updateDailyTotal(client, referrerId, 'credits', amount);
    });
  }

  // ── Passive income: credit referrer when referral tops up stars ────────────
  async starsPassiveIncome(referralUserId, starsAmount) {
    if (starsAmount <= 0) return;
    const cfg = this._config();

    const user = await query(
      'SELECT referred_by, referral_activated FROM users WHERE id = $1',
      [referralUserId]
    );
    if (!user.rows.length || !user.rows[0].referred_by || !user.rows[0].referral_activated) return;

    const referrerId = user.rows[0].referred_by;
    if (referrerId === referralUserId) return; // self-referral guard
    const { percent, starsCap } = await this._getEffectiveRates(referrerId);

    if (cfg.starsIncomeMode === 'credits') {
      // Convert to credits
      const rawCredits = Math.floor(starsAmount * percent / 100 * cfg.starsToCreditsRate);
      if (rawCredits <= 0) return;

      const todayCredits = await this._getDailyTotal(referrerId, 'credits');
      const { creditsCap } = await this._getEffectiveRates(referrerId);
      const amount = Math.min(rawCredits, Math.max(0, creditsCap - todayCredits));
      if (amount <= 0) return;

      await withTransaction(async (client) => {
        const ref = await client.query('SELECT credits FROM users WHERE id = $1 FOR UPDATE', [referrerId]);
        if (!ref.rows.length) return;
        const refCredits = Number(ref.rows[0].credits);
        await client.query('UPDATE users SET credits = credits + $1 WHERE id = $2', [amount, referrerId]);
        await client.query(
          `INSERT INTO credit_transactions (user_id, type, amount, balance_before, balance_after, metadata)
           VALUES ($1, 'referral_bonus', $2, $3, $4, $5)`,
          [referrerId, amount, refCredits, refCredits + amount,
           JSON.stringify({ referral: referralUserId, source: 'stars_topup', starsAmount, percent })]
        );
        await client.query(
          `INSERT INTO referral_earnings (referrer_id, referral_id, currency, amount, source_amount, source_type)
           VALUES ($1, $2, 'credits', $3, $4, 'stars_topup')`,
          [referrerId, referralUserId, amount, starsAmount]
        );
        await this._updateDailyTotal(client, referrerId, 'credits', amount);
      });
    } else {
      // Pay in stars
      const rawStars = Math.floor(starsAmount * percent / 100);
      if (rawStars <= 0) return;

      const todayStars = await this._getDailyTotal(referrerId, 'stars');
      const amount = Math.min(rawStars, Math.max(0, starsCap - todayStars));
      if (amount <= 0) return;

      await withTransaction(async (client) => {
        const ref = await client.query('SELECT stars_balance FROM users WHERE id = $1 FOR UPDATE', [referrerId]);
        if (!ref.rows.length) return;
        const refStars = ref.rows[0].stars_balance;
        await client.query('UPDATE users SET stars_balance = stars_balance + $1 WHERE id = $2', [amount, referrerId]);
        await client.query(
          `INSERT INTO stars_transactions (user_id, type, amount, balance_before, balance_after, description)
           VALUES ($1, 'referral_passive', $2, $3, $4, $5)`,
          [referrerId, amount, refStars, refStars + amount,
           `Referral passive: ${referralUserId} topped up ${starsAmount} stars`]
        );
        await client.query(
          `INSERT INTO referral_earnings (referrer_id, referral_id, currency, amount, source_amount, source_type)
           VALUES ($1, $2, 'stars', $3, $4, 'stars_topup')`,
          [referrerId, referralUserId, amount, starsAmount]
        );
        await this._updateDailyTotal(client, referrerId, 'stars', amount);
      });
    }
  }

  // ── Get referral stats for UI ─────────────────────────────────────────────
  async getStats(userId) {
    const cfg = this._config();

    // Count referrals
    const totalRes = await query(
      'SELECT COUNT(*) as total FROM users WHERE referred_by = $1 AND is_banned = false', [userId]
    );
    const activeRes = await query(
      'SELECT COUNT(*) as active FROM users WHERE referred_by = $1 AND referral_activated = true AND is_banned = false', [userId]
    );
    const totalReferrals = parseInt(totalRes.rows[0].total);
    const activeReferrals = parseInt(activeRes.rows[0].active);

    // Today's earnings
    const todayCredits = await this._getDailyTotal(userId, 'credits');
    const todayStars = await this._getDailyTotal(userId, 'stars');

    // Effective rates
    const { percent, creditsCap, starsCap, rankIndex } = await this._getEffectiveRates(userId);

    // Claimed milestones
    const milestonesRes = await query(
      'SELECT milestone_count FROM referral_milestones WHERE user_id = $1',
      [userId]
    );
    const claimedMilestones = milestonesRes.rows.map(r => r.milestone_count);

    // All-time earnings
    const allTimeRes = await query(
      `SELECT currency, COALESCE(SUM(amount), 0) as total
       FROM referral_earnings WHERE referrer_id = $1 GROUP BY currency`,
      [userId]
    );
    const allTime = { credits: 0, stars: 0 };
    for (const r of allTimeRes.rows) {
      allTime[r.currency] = parseInt(r.total);
    }

    // Referral list (recent 20)
    const referralsList = await query(
      `SELECT u.id, u.first_name, u.username, u.level, u.referral_activated,
              u.referral_activated_at, u.created_at
       FROM users u WHERE u.referred_by = $1 AND u.is_banned = false
       ORDER BY u.created_at DESC LIMIT 20`,
      [userId]
    );

    // User's own referral status
    const userRes = await query(
      `SELECT referred_by, referral_activated, referral_reward_claimed,
              referral_reward_pending_until
       FROM users WHERE id = $1`,
      [userId]
    );
    const user = userRes.rows[0] || {};

    return {
      totalReferrals,
      activeReferrals,
      todayCredits,
      todayStars,
      todayCreditsLimit: creditsCap,
      todayStarsLimit: starsCap,
      currentPercent: percent,
      rankIndex,
      ranks: cfg.ranks,
      milestones: cfg.milestones,
      claimedMilestones,
      allTimeCredits: allTime.credits,
      allTimeStars: allTime.stars,
      referrals: referralsList.rows,
      // Own referral info
      myReferrer: user.referred_by || null,
      myActivated: user.referral_activated || false,
      myRewardClaimed: user.referral_reward_claimed || false,
      myRewardPendingUntil: user.referral_reward_pending_until || null,
    };
  }

  // ── Claim milestone reward ────────────────────────────────────────────────
  async claimMilestone(userId, milestoneCount) {
    const cfg = this._config();
    const milestone = cfg.milestones.find(m => m.count === milestoneCount);
    if (!milestone) return { error: 'Invalid milestone' };

    // Check active referrals count
    const activeRes = await query(
      'SELECT COUNT(*) as c FROM users WHERE referred_by = $1 AND referral_activated = true AND is_banned = false',
      [userId]
    );
    if (parseInt(activeRes.rows[0].c) < milestoneCount) {
      return { error: 'Not enough active referrals' };
    }

    return await withTransaction(async (client) => {
      // Check not already claimed
      const existing = await client.query(
        'SELECT id FROM referral_milestones WHERE user_id = $1 AND milestone_count = $2',
        [userId, milestoneCount]
      );
      if (existing.rows.length > 0) return { error: 'Already claimed' };

      // Award stars
      const ref = await client.query('SELECT stars_balance FROM users WHERE id = $1 FOR UPDATE', [userId]);
      if (!ref.rows.length) return { error: 'User not found' };
      const balance = ref.rows[0].stars_balance;

      await client.query('UPDATE users SET stars_balance = stars_balance + $1 WHERE id = $2',
        [milestone.rewardStars, userId]);
      await client.query(
        `INSERT INTO stars_transactions (user_id, type, amount, balance_before, balance_after, description)
         VALUES ($1, 'referral_milestone', $2, $3, $4, $5)`,
        [userId, milestone.rewardStars, balance, balance + milestone.rewardStars,
         `Referral milestone: ${milestoneCount} active referrals`]
      );
      await client.query(
        'INSERT INTO referral_milestones (user_id, milestone_count, reward_stars) VALUES ($1, $2, $3)',
        [userId, milestoneCount, milestone.rewardStars]
      );

      logger.info({ userId, milestoneCount, rewardStars: milestone.rewardStars }, 'Milestone claimed');
      return { claimed: true, rewardStars: milestone.rewardStars, newBalance: balance + milestone.rewardStars };
    });
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  async _getEffectiveRates(userId) {
    const cfg = this._config();
    const activeRes = await query(
      'SELECT COUNT(*) as c FROM users WHERE referred_by = $1 AND referral_activated = true AND is_banned = false',
      [userId]
    );
    const activeCount = parseInt(activeRes.rows[0].c);

    let rankIndex = -1;
    let bonusPercent = 0;
    let creditsCap = cfg.maxCreditsPerDay;
    let starsCap = cfg.maxStarsPerDay;

    for (let i = cfg.ranks.length - 1; i >= 0; i--) {
      if (activeCount >= cfg.ranks[i].min) {
        rankIndex = i;
        bonusPercent = cfg.ranks[i].bonusPercent;
        creditsCap = cfg.ranks[i].creditsCap;
        starsCap = cfg.ranks[i].starsCap;
        break;
      }
    }

    const percent = Math.min(cfg.baseCreditsPercent + bonusPercent, cfg.maxTotalPercent);

    return { percent, creditsCap, starsCap, rankIndex, activeCount };
  }

  async _getDailyTotal(userId, currency) {
    const res = await query(
      `SELECT ${currency === 'stars' ? 'stars_earned' : 'credits_earned'} as total
       FROM referral_daily_totals
       WHERE user_id = $1 AND day = CURRENT_DATE`,
      [userId]
    );
    return res.rows.length > 0 ? parseInt(res.rows[0].total) : 0;
  }

  async _updateDailyTotal(client, userId, currency, amount) {
    const col = currency === 'stars' ? 'stars_earned' : 'credits_earned';
    await client.query(
      `INSERT INTO referral_daily_totals (user_id, day, ${col})
       VALUES ($1, CURRENT_DATE, $2)
       ON CONFLICT (user_id, day) DO UPDATE SET ${col} = referral_daily_totals.${col} + $2`,
      [userId, amount]
    );
  }

  async _checkMilestones(client, userId) {
    // Just logs — user claims milestones manually via API
    const cfg = this._config();
    const activeRes = await client.query(
      'SELECT COUNT(*) as c FROM users WHERE referred_by = $1 AND referral_activated = true AND is_banned = false',
      [userId]
    );
    const activeCount = parseInt(activeRes.rows[0].c);
    const unclaimed = cfg.milestones.filter(m => m.count <= activeCount);
    if (unclaimed.length > 0) {
      logger.info({ userId, activeCount, availableMilestones: unclaimed.length }, 'Milestones available');
    }
  }
}

module.exports = ReferralService;
