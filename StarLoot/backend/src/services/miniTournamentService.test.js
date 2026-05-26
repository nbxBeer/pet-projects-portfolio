'use strict';

jest.mock('../db/pool', () => ({
  query: jest.fn(),
}));

const { query } = require('../db/pool');
const MiniTournamentService = require('./miniTournamentService');

describe('MiniTournamentService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns zero progress when tournament is not active yet', async () => {
    const svc = new MiniTournamentService();
    svc.startAt = new Date('2100-01-01T00:00:00Z');

    const stats = await svc.getUserStats(1);

    expect(stats).toMatchObject({
      isActive: false,
      expeditionsCount: 0,
      giftsIssued: 0,
      giftsPending: 0,
      expeditionsPerGift: 100,
    });
    expect(query).not.toHaveBeenCalled();
  });

  test('updates pending gifts and notifies when milestone reached', async () => {
    const bot = { notifyMiniTournamentReached: jest.fn().mockResolvedValue(undefined) };
    const svc = new MiniTournamentService({ bot });
    svc.startAt = new Date('2020-01-01T00:00:00Z');

    // Query order: count → upsert → pending update → user fetch → _markMilestone
    query
      .mockResolvedValueOnce({ rows: [{ cnt: 200 }] })
      .mockResolvedValueOnce({ rows: [{ user_id: 10, expeditions_count: 200, gifts_issued: 1, gifts_pending: 0, last_notified_milestone: 1 }] })
      .mockResolvedValueOnce({ rows: [{ user_id: 10, expeditions_count: 200, gifts_issued: 1, gifts_pending: 1, last_notified_milestone: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 10, username: 'pilot', first_name: 'Ace' }] })
      .mockResolvedValueOnce({ rows: [] }); // _markMilestone

    const stats = await svc.trackCompletionAndNotify(10);

    expect(stats).toMatchObject({
      expeditionsCount: 200,
      giftsIssued: 1,
      giftsPending: 1,
    });
    expect(bot.notifyMiniTournamentReached).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 10,
        milestone: 2,
        expeditionsCount: 200,
        giftsPending: 1,
      })
    );
  });

  test('does not mark milestone when notification fails — retries on next expedition', async () => {
    const bot = { notifyMiniTournamentReached: jest.fn().mockRejectedValue(new Error('Telegram error')) };
    const svc = new MiniTournamentService({ bot });
    svc.startAt = new Date('2020-01-01T00:00:00Z');

    // count → upsert → (no pending update needed) → user fetch; no _markMilestone call
    query
      .mockResolvedValueOnce({ rows: [{ cnt: 100 }] })
      .mockResolvedValueOnce({ rows: [{ user_id: 5, expeditions_count: 100, gifts_issued: 0, gifts_pending: 1, last_notified_milestone: 0 }] })
      .mockResolvedValueOnce({ rows: [{ id: 5, username: 'pilot', first_name: 'Test' }] });

    await svc.trackCompletionAndNotify(5);

    expect(bot.notifyMiniTournamentReached).toHaveBeenCalled();
    // _markMilestone should NOT be called (only 3 queries issued)
    expect(query).toHaveBeenCalledTimes(3);
  });

  test('does not mark milestone when bot is unavailable — retries on next expedition', async () => {
    const svc = new MiniTournamentService({ bot: null });
    svc.startAt = new Date('2020-01-01T00:00:00Z');

    query
      .mockResolvedValueOnce({ rows: [{ cnt: 100 }] })
      .mockResolvedValueOnce({ rows: [{ user_id: 5, expeditions_count: 100, gifts_issued: 0, gifts_pending: 1, last_notified_milestone: 0 }] });

    await svc.trackCompletionAndNotify(5);

    // No user fetch, no _markMilestone — only 2 queries
    expect(query).toHaveBeenCalledTimes(2);
  });
});
