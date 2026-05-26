'use strict';

const { query, withTransaction } = require('../db/pool');
const logger = require('../utils/logger');

const VALID_SCORING_TYPES = [
  'xp_earned', 'credits_earned', 'expedition_count',
  'heaviest_debris', 'heaviest_creature', 'heaviest_artifact', 'heaviest_anomaly',
  'rare_finds', 'mythical_finds',
];

/**
 * TournamentService — adapted to the ACTUAL production schema:
 *
 * tournament_scores (
 *   id            UUID PK,
 *   tournament_id UUID NOT NULL,
 *   user_id       BIGINT NOT NULL,
 *   baseline_value BIGINT DEFAULT 0,
 *   current_value  BIGINT DEFAULT 0,   ← universal score accumulator
 *   updated_at     TIMESTAMPTZ DEFAULT now()
 *   UNIQUE (tournament_id, user_id)
 * )
 */
class TournamentService {
  // ── Public API ─────────────────────────────────────────────────────────────

  _isXpScoring(tournament) {
    const scoringType = tournament?.scoring_type || tournament?.metric || 'xp_earned';
    return scoringType === 'xp_earned' || scoringType === 'xp_gained';
  }

  async _ensureXpBaselineSnapshot(tournamentId, client = null) {
    const db = client || { query };

    await db.query(
      `INSERT INTO tournament_scores (tournament_id, user_id, baseline_value, current_value)
       SELECT $1,
              u.id,
              CASE
                WHEN ts.user_id IS NULL THEN COALESCE(u.xp, 0)
                ELSE GREATEST(COALESCE(u.xp, 0) - COALESCE(ts.current_value, 0), 0)
              END,
              COALESCE(ts.current_value, 0)
       FROM users u
       LEFT JOIN tournament_scores ts
         ON ts.tournament_id = $1 AND ts.user_id = u.id
       ON CONFLICT (tournament_id, user_id) DO UPDATE SET
         baseline_value = EXCLUDED.baseline_value,
         current_value = EXCLUDED.current_value,
         updated_at = NOW()`,
      [tournamentId]
    );

    await db.query(
      'UPDATE tournaments SET xp_baseline_initialized = true WHERE id = $1',
      [tournamentId]
    );
  }

  /**
   * Get the currently active tournament (started and not ended), or null.
   */
  async getActiveTournament() {
    try {
      const res = await query(
        `SELECT id, title, description, icon, is_active, starts_at, ends_at, created_at,
                scoring_type, metric, top_rewards, xp_baseline_initialized
         FROM tournaments
         WHERE is_active = true AND starts_at <= NOW() AND ends_at > NOW()
         ORDER BY starts_at DESC
         LIMIT 1`
      );
      if (!res.rows.length) return null;
      logger.info({ tournamentId: res.rows[0].id }, 'Active tournament found');
      return this._format(res.rows[0]);
    } catch (err) {
      logger.warn({ err: err.message }, 'getActiveTournament fallback (column missing)');
      try {
        const res = await query(
          `SELECT id, title, description, icon, is_active, starts_at, ends_at, created_at
           FROM tournaments
           WHERE is_active = true AND starts_at <= NOW() AND ends_at > NOW()
           ORDER BY starts_at DESC
           LIMIT 1`
        );
        if (!res.rows.length) return null;
        return this._format(res.rows[0]);
      } catch (err2) {
        logger.error({ err: err2.message }, 'getActiveTournament fallback also failed');
        return null;
      }
    }
  }

  /**
   * Get the upcoming or active tournament for display (includes pending).
   * Used by frontend to show banner with countdown.
   */
  async getVisibleTournament() {
    try {
      const res = await query(
        `SELECT id, title, description, icon, is_active, starts_at, ends_at, created_at,
                scoring_type, metric, top_rewards, xp_baseline_initialized
         FROM tournaments
         WHERE is_active = true AND ends_at > NOW()
         ORDER BY starts_at DESC
         LIMIT 1`
      );
      if (!res.rows.length) return null;
      return this._format(res.rows[0]);
    } catch (err) {
      logger.warn({ err: err.message }, 'getVisibleTournament fallback');
      try {
        const res = await query(
          `SELECT id, title, description, icon, is_active, starts_at, ends_at, created_at
           FROM tournaments
           WHERE is_active = true AND ends_at > NOW()
           ORDER BY starts_at DESC
           LIMIT 1`
        );
        if (!res.rows.length) return null;
        return this._format(res.rows[0]);
      } catch (err2) {
        logger.error({ err: err2.message }, 'getVisibleTournament fallback also failed');
        return null;
      }
    }
  }

  /**
   * List all tournaments (newest first, up to 50).
   */
  async listTournaments() {
    try {
      const res = await query(
        `SELECT id, title, icon, scoring_type, metric, top_rewards,
                is_active, starts_at, ends_at, created_at
         FROM tournaments
         ORDER BY created_at DESC LIMIT 50`
      );
      return res.rows.map((r) => this._format(r));
    } catch (err) {
      logger.warn({ err: err.message }, 'listTournaments fallback');
      const res = await query(
        `SELECT id, title, icon, is_active, starts_at, ends_at, created_at
         FROM tournaments
         ORDER BY created_at DESC LIMIT 50`
      );
      return res.rows.map((r) => this._format(r));
    }
  }

  /**
   * Create a new tournament and end any currently active ones.
   */
  async createTournament({ title, description = '', icon = '🏆', durationHours, scoringType = 'xp_earned', prizeDescription = '' }) {
    if (!title) throw { status: 400, message: 'title is required' };
    if (!durationHours || durationHours <= 0) throw { status: 400, message: 'durationHours must be positive' };
    if (!VALID_SCORING_TYPES.includes(scoringType)) {
      throw { status: 400, message: `scoringType must be one of: ${VALID_SCORING_TYPES.join(', ')}` };
    }

    const endsAt = new Date(Date.now() + durationHours * 3600 * 1000);

    const tournament = await withTransaction(async (client) => {
      // End any currently running tournaments
      await client.query(`UPDATE tournaments SET is_active = false WHERE is_active = true AND ends_at > NOW()`);

      const res = await client.query(
        `INSERT INTO tournaments
           (title, description, icon, scoring_type, ends_at)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, title, description, icon, scoring_type,
                   is_active, starts_at, ends_at, created_at`,
        [title, description, icon, scoringType, endsAt]
      );

      const inserted = res.rows[0];
      if (this._isXpScoring(inserted)) {
        await this._ensureXpBaselineSnapshot(inserted.id, client);
      }

      return this._format(inserted);
    });

    logger.info({ tournamentId: tournament.id, title, durationHours, scoringType }, 'Tournament created');
    return tournament;
  }

  /**
   * End a tournament early.
   */
  async endTournament(id) {
    const res = await query(
      `UPDATE tournaments SET is_active = false WHERE id = $1 RETURNING id, title`,
      [id]
    );
    if (!res.rows.length) throw { status: 404, message: 'Tournament not found' };
    logger.info({ tournamentId: id }, 'Tournament ended early');
    return res.rows[0];
  }

  /**
   * Get the leaderboard for a specific tournament.
   * Uses only `current_value` column — the universal score accumulator.
   */
  async getLeaderboard(tournamentId, { limit = 50, requestingUserId = null } = {}) {
    let tRes;
    try {
      tRes = await query('SELECT id, scoring_type, metric, xp_baseline_initialized FROM tournaments WHERE id = $1', [tournamentId]);
    } catch {
      tRes = await query('SELECT id FROM tournaments WHERE id = $1', [tournamentId]);
    }
    if (!tRes.rows.length) throw { status: 404, message: 'Tournament not found' };
    const tournament = tRes.rows[0];

    if (this._isXpScoring(tournament) && !tournament.xp_baseline_initialized) {
      await this._ensureXpBaselineSnapshot(tournamentId);
      tournament.xp_baseline_initialized = true;
    }

    const useXpBaseline = this._isXpScoring(tournament);
    const scoreExpr = useXpBaseline
      ? `GREATEST(COALESCE(u.xp, 0) - COALESCE(ts.baseline_value, 0), 0)`
      : `COALESCE(ts.current_value, 0)`;
    const scoreOrderExpr = useXpBaseline
      ? `GREATEST(COALESCE(u.xp, 0) - COALESCE(ts.baseline_value, 0), 0)`
      : `COALESCE(ts.current_value, 0)`;

    const topQuery = useXpBaseline
      ? `WITH scores AS (
           SELECT u.id AS user_id,
                  ${scoreExpr} AS score,
                  u.username, u.first_name, u.level,
                  ad.id AS ach_id, ad.icon AS ach_icon, ad.name AS ach_name
           FROM users u
           LEFT JOIN tournament_scores ts
             ON ts.tournament_id = $1 AND ts.user_id = u.id
           LEFT JOIN achievement_definitions ad ON ad.id = u.selected_achievement_id
           WHERE u.is_banned = false AND u.hidden_from_leaderboards = false
         )
         SELECT * FROM scores
         ORDER BY score DESC
         LIMIT $2`
      : `SELECT ts.user_id,
                ${scoreExpr} AS score,
                u.username, u.first_name, u.level,
                ad.id AS ach_id, ad.icon AS ach_icon, ad.name AS ach_name
         FROM tournament_scores ts
         JOIN users u ON u.id = ts.user_id
         LEFT JOIN achievement_definitions ad ON ad.id = u.selected_achievement_id
         WHERE ts.tournament_id = $1
           AND u.is_banned = false AND u.hidden_from_leaderboards = false
         ORDER BY ${scoreOrderExpr} DESC
         LIMIT $2`;

    const topRes = await query(topQuery, [tournamentId, Math.min(limit, 100)]);

    const top = topRes.rows.map((r, i) => ({
      rank: i + 1,
      userId: String(r.user_id),
      name: r.username || r.first_name || `User ${r.user_id}`,
      level: r.level,
      score: Number(r.score || 0),
      xpEarned: Number(r.score || 0),
      creditsEarned: 0,
      findsCount: 0,
      achievement: r.ach_id ? { id: r.ach_id, icon: r.ach_icon || '🏆', name: r.ach_name } : null,
    }));

    let me = null;
    if (requestingUserId) {
      const inTop = top.find((r) => r.userId === String(requestingUserId));
      if (inTop) {
        me = inTop;
      } else {
        const myRow = await query(
          useXpBaseline
            ? `SELECT ${scoreExpr} AS score,
                      u.username, u.first_name, u.level
               FROM users u
               LEFT JOIN tournament_scores ts
                 ON ts.tournament_id = $1 AND ts.user_id = u.id
               WHERE u.id = $2`
            : `SELECT COALESCE(ts.current_value, 0) AS score,
                      u.username, u.first_name, u.level
               FROM tournament_scores ts
               JOIN users u ON u.id = ts.user_id
               WHERE ts.tournament_id = $1 AND ts.user_id = $2`,
          [tournamentId, requestingUserId]
        );
        if (myRow.rows.length) {
          const myScore = Number(myRow.rows[0].score || 0);
          const rankRes = await query(
            useXpBaseline
              ? `WITH scores AS (
                   SELECT u2.id AS user_id,
                          GREATEST(COALESCE(u2.xp, 0) - COALESCE(ts2.baseline_value, 0), 0) AS score
                   FROM users u2
                   LEFT JOIN tournament_scores ts2
                     ON ts2.tournament_id = $1 AND ts2.user_id = u2.id
                   WHERE u2.is_banned = false AND u2.hidden_from_leaderboards = false
                 )
                 SELECT COUNT(*) + 1 AS rank
                 FROM scores
                 WHERE score > $2`
              : `SELECT COUNT(*) + 1 AS rank
                 FROM tournament_scores ts2
                 JOIN users u2 ON u2.id = ts2.user_id
                 WHERE ts2.tournament_id = $1
                   AND u2.is_banned = false AND u2.hidden_from_leaderboards = false
                   AND COALESCE(ts2.current_value, 0) > $2`,
            [tournamentId, myScore]
          );
          const r = myRow.rows[0];
          me = {
            rank: Number(rankRes.rows[0].rank),
            userId: String(requestingUserId),
            name: r.username || r.first_name || `User ${requestingUserId}`,
            level: r.level,
            score: myScore,
            xpEarned: myScore,
            creditsEarned: 0,
            findsCount: 0,
            achievement: null,
          };
        }
      }
    }

    return { top, me, scoringType: tournament.scoring_type || tournament.metric || 'xp_earned' };
  }

  /**
   * Record expedition result towards tournament score.
   * Uses only columns guaranteed to exist: tournament_id, user_id, current_value, updated_at.
   * Safe to call even if no active tournament exists.
   */
  async recordExpeditionResult(userId, {
    xpGained = 0, creditsGained = 0, expeditionCount = 1,
    wasSpedUp = false, findType = null, rarity = null, weight = 0,
  } = {}) {
    try {
      const tournament = await this.getActiveTournament();
      if (!tournament) return;

      const metric = tournament.metric || tournament.scoringType || 'xp_earned';
      let metricDelta = 0;
      let useMax = false; // for "heaviest" metrics, keep max instead of sum

      if (metric === 'xp_gained' || metric === 'xp_earned') {
        metricDelta = xpGained;
      } else if (metric === 'credits_earned') {
        metricDelta = creditsGained;
      } else if (metric === 'expedition_count') {
        // Exclude sped-up expeditions
        metricDelta = wasSpedUp ? 0 : expeditionCount;
      } else if (metric === 'rare_finds') {
        // Count epic+ finds
        metricDelta = ['epic', 'legendary', 'mythical'].includes(rarity) ? 1 : 0;
      } else if (metric === 'mythical_finds') {
        metricDelta = rarity === 'mythical' ? 1 : 0;
      } else if (metric.startsWith('heaviest_')) {
        // heaviest_debris, heaviest_creature, heaviest_artifact, heaviest_anomaly
        const targetType = metric.replace('heaviest_', '');
        if (findType === targetType && weight > 0) {
          metricDelta = Math.round(weight);
          useMax = true;
        } else {
          return; // not relevant find type
        }
      } else {
        metricDelta = xpGained; // fallback
      }

      if (metricDelta === 0 && !useMax) return;

      if (useMax) {
        // For "heaviest" metrics: keep the maximum value, not a sum
        await query(
          `INSERT INTO tournament_scores (tournament_id, user_id, current_value)
           VALUES ($1, $2, $3)
           ON CONFLICT (tournament_id, user_id) DO UPDATE SET
             current_value = GREATEST(tournament_scores.current_value, $3),
             updated_at    = NOW()`,
          [tournament.id, userId, metricDelta]
        );
      } else {
        await query(
          `INSERT INTO tournament_scores (tournament_id, user_id, current_value)
           VALUES ($1, $2, $3)
           ON CONFLICT (tournament_id, user_id) DO UPDATE SET
             current_value = tournament_scores.current_value + $3,
             updated_at    = NOW()`,
          [tournament.id, userId, metricDelta]
        );
      }

      logger.info({ userId, tournamentId: tournament.id, metric, metricDelta, useMax }, 'Tournament score recorded');
    } catch (err) {
      logger.warn({ err: err.message, userId }, 'Tournament score update failed');
    }
  }

  // ── Private ────────────────────────────────────────────────────────────────

  _format(row) {
    return {
      id: row.id,
      title: row.title,
      description: row.description || '',
      icon: row.icon || '🏆',
      scoringType: row.scoring_type || row.metric || 'xp_earned',
      metric: row.metric || row.scoring_type || 'xp_earned',
      xpBaselineInitialized: row.xp_baseline_initialized,
      prizeDescription: row.prize_description || '',
      topRewards: row.top_rewards || [],
      isActive: row.is_active,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      createdAt: row.created_at,
    };
  }
}

module.exports = TournamentService;
