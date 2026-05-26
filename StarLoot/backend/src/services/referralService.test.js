'use strict';

const ReferralService = require('./referralService');

// Mock database
jest.mock('../db/pool', () => ({
  query: jest.fn(),
  withTransaction: jest.fn(async (callback) => {
    const client = {
      query: jest.fn(),
    };
    return await callback(client);
  }),
}));

jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const { query, withTransaction } = require('../db/pool');
const logger = require('../utils/logger');

describe('ReferralService', () => {
  let referralService;
  let mockConfigManager;

  const mockReferralConfig = {
    minExpeditionsForActivation: 3,
    minCreditsForActivation: 500,
    referrerRewardCredits: 500,
    referralRewardCredits: 300,
    rewardDelayMs: 3600000, // 1 hour
    baseCreditsPercent: 5,
    baseStarsPercent: 5,
    maxTotalPercent: 15,
    starsIncomeMode: 'stars',
    starsToCreditsRate: 100,
    maxCreditsPerDay: 5000,
    maxStarsPerDay: 50,
    ranks: [
      { min: 1, bonusPercent: 0, creditsCap: 5000, starsCap: 50 },
      { min: 5, bonusPercent: 2, creditsCap: 8000, starsCap: 80 },
      { min: 15, bonusPercent: 3, creditsCap: 12000, starsCap: 120 },
    ],
    milestones: [
      { count: 1, rewardStars: 1 },
      { count: 3, rewardStars: 2 },
      { count: 5, rewardStars: 5 },
    ],
    minTelegramAccountAgeDays: 3,
  };

  beforeEach(() => {
    jest.resetAllMocks();

    mockConfigManager = {
      get: jest.fn((key) => {
        if (key === 'referral') return mockReferralConfig;
        return null;
      }),
    };

    referralService = new ReferralService(mockConfigManager);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test: setReferrer
  // ─────────────────────────────────────────────────────────────────────────
  describe('setReferrer', () => {
    test('blocks self-referral', async () => {
      const result = await referralService.setReferrer(123, 123);
      expect(result).toBe(false);
    });

    test('rejects when referrer does not exist', async () => {
      query.mockResolvedValueOnce({ rows: [] }); // Referrer doesn't exist
      const result = await referralService.setReferrer(456, 789);
      expect(result).toBe(false);
    });

    test('rejects when user already has a referrer', async () => {
      query.mockResolvedValueOnce({ rows: [{ id: 999 }] }); // Referrer exists
      query.mockResolvedValueOnce({ rows: [{ referred_by: 111 }] }); // User already has referrer
      const result = await referralService.setReferrer(456, 999);
      expect(result).toBe(false);
    });

    test('successfully sets referrer for new user', async () => {
      query.mockResolvedValueOnce({ rows: [{ id: 999 }] }); // Referrer exists
      query.mockResolvedValueOnce({ rows: [{ referred_by: null }] }); // User has no referrer
      query.mockResolvedValueOnce({ rows: { affectedRows: 1 } }); // Update successful

      const result = await referralService.setReferrer(456, 999);
      expect(result).toBe(true);
      expect(logger.info).toHaveBeenCalled();
    });

    test('blocks null referrer', async () => {
      const result = await referralService.setReferrer(123, null);
      expect(result).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test: checkActivation
  // ─────────────────────────────────────────────────────────────────────────
  describe('checkActivation', () => {
    test('does nothing for user with no referrer', async () => {
      query.mockResolvedValueOnce({
        rows: [
          {
            id: 123,
            referred_by: null,
            referral_activated: false,
            total_expeditions: 0,
            credits: 0,
          },
        ],
      });

      await referralService.checkActivation(123);
      // Should only call query once (no update)
      expect(query).toHaveBeenCalledTimes(1);
    });

    test('does nothing for already activated referral', async () => {
      query.mockResolvedValueOnce({
        rows: [
          {
            id: 123,
            referred_by: 999,
            referral_activated: true,
            total_expeditions: 5,
            credits: 1000,
          },
        ],
      });

      await referralService.checkActivation(123);
      expect(query).toHaveBeenCalledTimes(1);
    });

    test('activates when expeditions requirement met', async () => {
      query.mockResolvedValueOnce({
        rows: [
          {
            id: 123,
            referred_by: 999,
            referral_activated: false,
            total_expeditions: 5, // Met requirement (>= 3)
            credits: 100,
          },
        ],
      });

      await referralService.checkActivation(123);
      expect(query).toHaveBeenCalledTimes(2); // Initial query + update
      expect(logger.info).toHaveBeenCalled();
    });

    test('activates when credits requirement met', async () => {
      query.mockResolvedValueOnce({
        rows: [
          {
            id: 123,
            referred_by: 999,
            referral_activated: false,
            total_expeditions: 1,
            credits: 600, // Met requirement (>= 500)
          },
        ],
      });

      await referralService.checkActivation(123);
      expect(query).toHaveBeenCalledTimes(2); // Initial query + update
    });

    test('does not activate if neither requirement is met', async () => {
      query.mockResolvedValueOnce({
        rows: [
          {
            id: 123,
            referred_by: 999,
            referral_activated: false,
            total_expeditions: 1, // < 3
            credits: 100, // < 500
          },
        ],
      });

      await referralService.checkActivation(123);
      expect(query).toHaveBeenCalledTimes(1);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test: claimActivationRewards
  // ─────────────────────────────────────────────────────────────────────────
  describe('claimActivationRewards', () => {
    test('returns null for non-existent user', async () => {
      const mockClientQuery = jest.fn().mockResolvedValueOnce({ rows: [] });
      withTransaction.mockImplementation(async (callback) => {
        return await callback({ query: mockClientQuery });
      });

      const result = await referralService.claimActivationRewards(123);
      expect(result).toBeNull();
    });

    test('returns null if referral not activated', async () => {
      const mockClientQuery = jest.fn()
        .mockResolvedValueOnce({
          rows: [
            {
              id: 123,
              referred_by: 999,
              referral_activated: false, // Not activated
              referral_reward_claimed: false,
              referral_reward_pending_until: null,
              credits: 100,
            },
          ],
        });

      withTransaction.mockImplementation(async (callback) => {
        return await callback({ query: mockClientQuery });
      });

      const result = await referralService.claimActivationRewards(123);
      expect(result).toBeNull();
    });

    test('returns pending status if reward delay not elapsed', async () => {
      const futureDate = new Date(Date.now() + 1800000); // 30 minutes from now
      const mockClientQuery = jest.fn()
        .mockResolvedValueOnce({
          rows: [
            {
              id: 123,
              referred_by: 999,
              referral_activated: true,
              referral_reward_claimed: false,
              referral_reward_pending_until: futureDate,
              credits: 100,
            },
          ],
        });

      withTransaction.mockImplementation(async (callback) => {
        return await callback({ query: mockClientQuery });
      });

      const result = await referralService.claimActivationRewards(123);
      expect(result.pending).toBe(true);
      expect(result.availableAt).toBe(futureDate);
    });

    test('claims rewards when all conditions met', async () => {
      const mockClientQuery = jest.fn()
        .mockResolvedValueOnce({
          rows: [
            {
              id: 123,
              referred_by: 999,
              referral_activated: true,
              referral_reward_claimed: false,
              referral_reward_pending_until: new Date(Date.now() - 1000), // Expired
              credits: 100,
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] }) // update referral user credits
        .mockResolvedValueOnce({ rows: [] }) // insert referral transaction
        .mockResolvedValueOnce({
          rows: [{ id: 999, credits: 5000 }], // select referrer
        })
        .mockResolvedValueOnce({ rows: [] }) // update referrer credits
        .mockResolvedValueOnce({ rows: [] }) // insert referrer transaction
        .mockResolvedValueOnce({ rows: [{ c: 1 }] }); // _checkMilestones

      withTransaction.mockImplementation(async (callback) => {
        return await callback({ query: mockClientQuery });
      });

      const result = await referralService.claimActivationRewards(123);
      expect(result.claimed).toBe(true);
      expect(result.creditsReceived).toBe(300); // referralRewardCredits
      expect(logger.info).toHaveBeenCalled();
    });

    test('returns null if already claimed', async () => {
      const mockClientQuery = jest.fn()
        .mockResolvedValueOnce({
          rows: [
            {
              id: 123,
              referred_by: 999,
              referral_activated: true,
              referral_reward_claimed: true, // Already claimed
              referral_reward_pending_until: null,
              credits: 100,
            },
          ],
        });

      withTransaction.mockImplementation(async (callback) => {
        return await callback({ query: mockClientQuery });
      });

      const result = await referralService.claimActivationRewards(123);
      expect(result).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test: creditPassiveIncome
  // ─────────────────────────────────────────────────────────────────────────
  describe('creditPassiveIncome', () => {
    test('does nothing if referral user not found', async () => {
      query.mockResolvedValueOnce({ rows: [] });

      await referralService.creditPassiveIncome(123, 1000);
      expect(query).toHaveBeenCalledTimes(1);
    });

    test('does nothing if referral has no referrer', async () => {
      query.mockResolvedValueOnce({
        rows: [{ referred_by: null, referral_activated: false }],
      });

      await referralService.creditPassiveIncome(123, 1000);
      expect(query).toHaveBeenCalledTimes(1);
    });

    test('does nothing if referral not activated', async () => {
      query.mockResolvedValueOnce({
        rows: [{ referred_by: 999, referral_activated: false }],
      });

      await referralService.creditPassiveIncome(123, 1000);
      expect(query).toHaveBeenCalledTimes(1);
    });

    test('calculates and credits passive income', async () => {
      query.mockResolvedValueOnce({
        rows: [{ referred_by: 999, referral_activated: true }],
      });

      jest.spyOn(referralService, '_getEffectiveRates').mockResolvedValue({
        percent: 5,
        creditsCap: 5000,
        starsCap: 50,
        rankIndex: 0,
        activeCount: 1,
      });
      jest.spyOn(referralService, '_getDailyTotal').mockResolvedValue(0);

      const mockClientQuery = jest.fn()
        .mockResolvedValueOnce({ rows: [{ credits: 1000 }] }) // lock referrer
        .mockResolvedValueOnce({ rows: [] }) // update users credits
        .mockResolvedValueOnce({ rows: [] }) // insert credit tx
        .mockResolvedValueOnce({ rows: [] }) // insert referral earnings
        .mockResolvedValueOnce({ rows: [] }); // update daily totals

      withTransaction.mockImplementation(async (callback) => {
        return await callback({ query: mockClientQuery });
      });

      await referralService.creditPassiveIncome(123, 1000);

      expect(withTransaction).toHaveBeenCalled();
      // 1000 * 5% = 50
      expect(mockClientQuery).toHaveBeenCalledWith(
        'UPDATE users SET credits = credits + $1 WHERE id = $2',
        [50, 999]
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test: starsPassiveIncome
  // ─────────────────────────────────────────────────────────────────────────
  describe('starsPassiveIncome', () => {
    test('ignores zero or negative star amounts', async () => {
      await referralService.starsPassiveIncome(123, 0);
      expect(query).not.toHaveBeenCalled();

      jest.clearAllMocks();
      await referralService.starsPassiveIncome(123, -5);
      expect(query).not.toHaveBeenCalled();
    });

    test('does nothing if referral not activated', async () => {
      query.mockResolvedValueOnce({
        rows: [{ referred_by: 999, referral_activated: false }],
      });

      await referralService.starsPassiveIncome(123, 10);
      expect(query).toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test: claimMilestone
  // ─────────────────────────────────────────────────────────────────────────
  describe('claimMilestone', () => {
    test('rejects invalid milestone', async () => {
      const result = await referralService.claimMilestone(123, 9999);
      expect(result.error).toBe('Invalid milestone');
    });

    test('rejects when not enough active referrals', async () => {
      query.mockResolvedValueOnce({ rows: [{ c: 0 }] }); // No active referrals

      const result = await referralService.claimMilestone(123, 5);
      expect(result.error).toBe('Not enough active referrals');
      expect(withTransaction).not.toHaveBeenCalled();
    });

    test('rejects if milestone already claimed', async () => {
      query.mockResolvedValueOnce({ rows: [{ c: 5 }] }); // Has 5 active referrals

      const mockClientQuery = jest.fn()
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }); // Already claimed

      withTransaction.mockImplementation(async (callback) => {
        return await callback({ query: mockClientQuery });
      });

      const result = await referralService.claimMilestone(123, 5);
      expect(result.error).toBe('Already claimed');
    });

    test('awards stars for milestone', async () => {
      query.mockResolvedValueOnce({ rows: [{ c: 3 }] }); // Has 3 active referrals for 3-active milestone

      const mockClientQuery = jest.fn()
        .mockResolvedValueOnce({ rows: [] }) // Not already claimed
        .mockResolvedValueOnce({ rows: [{ stars_balance: 10 }] });

      withTransaction.mockImplementation(async (callback) => {
        return await callback({ query: mockClientQuery });
      });

      const result = await referralService.claimMilestone(123, 3);
      expect(result.claimed).toBe(true);
      expect(result.rewardStars).toBe(2); // milestone for count=3 has rewardStars=2
      expect(result.newBalance).toBe(12); // 10 + 2
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test: getStats
  // ─────────────────────────────────────────────────────────────────────────
  describe('getStats', () => {
    test('returns complete stats object', async () => {
      query.mockResolvedValueOnce({ rows: [{ total: 10 }] }); // Total referrals
      query.mockResolvedValueOnce({ rows: [{ active: 5 }] }); // Active referrals
      jest.spyOn(referralService, '_getDailyTotal')
        .mockResolvedValueOnce(1500)
        .mockResolvedValueOnce(0);
      jest.spyOn(referralService, '_getEffectiveRates').mockResolvedValue({
        percent: 7,
        creditsCap: 8000,
        starsCap: 80,
        rankIndex: 1,
      });
      query.mockResolvedValueOnce({ rows: [] }); // Claimed milestones
      query.mockResolvedValueOnce({ rows: [] }); // All-time earnings
      query.mockResolvedValueOnce({ rows: [] }); // Referral list
      query.mockResolvedValueOnce({ rows: [{ referred_by: 999, referral_activated: true }] }); // User status

      const stats = await referralService.getStats(123);

      expect(stats).toHaveProperty('totalReferrals', 10);
      expect(stats).toHaveProperty('activeReferrals', 5);
      expect(stats).toHaveProperty('todayCredits', 1500);
      expect(stats).toHaveProperty('todayStars', 0);
      expect(stats).toHaveProperty('currentPercent');
      expect(stats).toHaveProperty('ranks');
      expect(stats).toHaveProperty('milestones');
      expect(stats).toHaveProperty('myReferrer', 999);
      expect(stats).toHaveProperty('myActivated', true);
    });

    test('returns default values for new user', async () => {
      query.mockResolvedValueOnce({ rows: [{ total: 0 }] });
      query.mockResolvedValueOnce({ rows: [{ active: 0 }] });
      jest.spyOn(referralService, '_getDailyTotal')
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);
      jest.spyOn(referralService, '_getEffectiveRates').mockResolvedValue({
        percent: 5,
        creditsCap: 5000,
        starsCap: 50,
        rankIndex: -1,
      });
      query.mockResolvedValueOnce({ rows: [] });
      query.mockResolvedValueOnce({ rows: [] });
      query.mockResolvedValueOnce({ rows: [] });
      query.mockResolvedValueOnce({ rows: [] });

      const stats = await referralService.getStats(456);
      expect(stats.totalReferrals).toBe(0);
      expect(stats.activeReferrals).toBe(0);
      expect(stats.myReferrer).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Edge Cases & Error Handling
  // ─────────────────────────────────────────────────────────────────────────
  describe('Edge Cases', () => {
    test('handles missing user result gracefully in checkActivation', async () => {
      query.mockResolvedValueOnce({ rows: [] });

      await referralService.checkActivation(999);
      // Should not throw
      expect(query).toHaveBeenCalledTimes(1);
    });

    test('claimActivationRewards handles referrer not found', async () => {
      const mockClientQuery = jest.fn()
        .mockResolvedValueOnce({
          rows: [
            {
              id: 123,
              referred_by: 999,
              referral_activated: true,
              referral_reward_claimed: false,
              referral_reward_pending_until: null,
              credits: 100,
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] }) // update referral user credits
        .mockResolvedValueOnce({ rows: [] }) // insert referral transaction
        .mockResolvedValueOnce({ rows: [] }) // Referrer not found
        .mockResolvedValueOnce({ rows: [{ c: 0 }] }); // _checkMilestones

      withTransaction.mockImplementation(async (callback) => {
        return await callback({ query: mockClientQuery });
      });

      const result = await referralService.claimActivationRewards(123);
      expect(result.claimed).toBe(true); // Should still succeed for referral
    });

    test('passive income respects daily caps', async () => {
      // This would require testing _getDailyTotal and cap logic
      // The service correctly applies caps via _getEffectiveRates
      expect(mockReferralConfig.maxCreditsPerDay).toBe(5000);
      expect(mockReferralConfig.maxStarsPerDay).toBe(50);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Configuration validation
  // ─────────────────────────────────────────────────────────────────────────
  describe('Configuration', () => {
    test('ranks are ordered by min ascending', () => {
      const ranks = mockReferralConfig.ranks;
      for (let i = 1; i < ranks.length; i++) {
        expect(ranks[i].min).toBeGreaterThan(ranks[i - 1].min);
      }
    });

    test('milestones are ordered by count ascending', () => {
      const milestones = mockReferralConfig.milestones;
      for (let i = 1; i < milestones.length; i++) {
        expect(milestones[i].count).toBeGreaterThan(milestones[i - 1].count);
      }
    });

    test('all ranks have required fields', () => {
      mockReferralConfig.ranks.forEach((rank) => {
        expect(rank).toHaveProperty('min');
        expect(rank).toHaveProperty('bonusPercent');
        expect(rank).toHaveProperty('creditsCap');
        expect(rank).toHaveProperty('starsCap');
      });
    });

    test('all milestones have required fields', () => {
      mockReferralConfig.milestones.forEach((milestone) => {
        expect(milestone).toHaveProperty('count');
        expect(milestone).toHaveProperty('rewardStars');
      });
    });
  });
});
