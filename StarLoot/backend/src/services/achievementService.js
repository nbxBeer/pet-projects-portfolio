'use strict';

const { query, withTransaction } = require('../db/pool');
const FindGeneratorService = require('./findGeneratorService');
const logger = require('../utils/logger');

/**
 * Checks all incomplete achievements for a user and updates progress / awards rewards.
 * Idempotent: safe to call multiple times (uses ON CONFLICT upsert).
 * Should be called after: expedition collect, expedition action (sell/save), inventory sell.
 */
class AchievementService {
  constructor(configManager) {
    this.cfg = configManager;
  }

  _calculateLevel(xp, levelTable) {
    let level = 1;
    for (const entry of levelTable) {
      if (xp >= entry.xpRequired) level = entry.level;
      else break;
    }
    return level;
  }

  async checkAndAward(userId) {
    try {
      // Correct level if XP has outpaced it (e.g. from prior awards that skipped level calc)
      const levelTable = this.cfg?.config?.xp?.levelTable;
      if (levelTable) {
        const fixRes = await query('SELECT xp, level FROM users WHERE id = $1', [userId]);
        if (fixRes.rows[0]) {
          const correctLevel = this._calculateLevel(Number(fixRes.rows[0].xp), levelTable);
          if (correctLevel !== fixRes.rows[0].level) {
            await query('UPDATE users SET level = $1 WHERE id = $2', [correctLevel, userId]);
          }
        }
      }

      // Fetch only achievements that are not yet completed for this user
      const [defsRes, userRes, findCountRes, rarityCountRes, creditsRes, uniqueTemplatesRes] = await Promise.all([
        query(
          `SELECT ad.id, ad.name, ad.conditions, ad.reward_credits, ad.reward_xp
           FROM achievement_definitions ad
           LEFT JOIN user_achievements ua ON ua.achievement_id = ad.id AND ua.user_id = $1
           WHERE COALESCE(ua.completed, false) = false`,
          [userId]
        ),
        query(
          `SELECT total_expeditions, level, is_supporter, prestige_level FROM users WHERE id = $1`,
          [userId]
        ),
        query(
          `SELECT find_type, COUNT(*)::int AS cnt
           FROM expedition_results WHERE user_id = $1
           GROUP BY find_type`,
          [userId]
        ),
        query(
          `SELECT rarity, COUNT(*)::int AS cnt
           FROM expedition_results
           WHERE user_id = $1 AND (action_taken IS NULL OR action_taken != 'pirate_defeat')
           GROUP BY rarity`,
          [userId]
        ),
        query(
          `SELECT COALESCE(SUM(amount), 0)::bigint AS total
           FROM credit_transactions WHERE user_id = $1 AND amount > 0`,
          [userId]
        ),
        // Unique named template IDs found (excluding asteroids/nft)
        query(
          `SELECT COUNT(DISTINCT template_id)::int AS cnt
           FROM expedition_results
           WHERE user_id = $1 AND template_id IS NOT NULL
             AND find_type NOT IN ('asteroid', 'nft_container')`,
          [userId]
        ),
      ]);

      const user = userRes.rows[0];
      if (!user) return;

      const findCounts   = Object.fromEntries(findCountRes.rows.map((r) => [r.find_type, r.cnt]));
      const rarityCounts = Object.fromEntries(rarityCountRes.rows.map((r) => [r.rarity, r.cnt]));
      const totalCredits = Number(creditsRes.rows[0].total);
      const uniqueTemplates = Number(uniqueTemplatesRes.rows[0]?.cnt || 0);

      for (const def of defsRes.rows) {
        const cond = def.conditions;
        let progress = 0;
        let target   = 1;

        switch (cond.type) {
          case 'expedition_count':
            progress = Number(user.total_expeditions);
            target   = cond.count;
            break;
          case 'find_count':
            progress = findCounts[cond.find_type] || 0;
            target   = cond.count;
            break;
          case 'rarity_find':
            progress = rarityCounts[cond.rarity] || 0;
            target   = cond.count;
            break;
          case 'credits_total':
            progress = totalCredits;
            target   = cond.amount;
            break;
          case 'level':
            progress = Number(user.level);
            target   = cond.level;
            break;
          case 'supporter':
            progress = user.is_supporter ? 1 : 0;
            target   = 1;
            break;
          case 'unique_templates':
            progress = uniqueTemplates;
            // Use dynamic count so achievement auto-updates if new templates are added
            target   = FindGeneratorService.TOTAL_UNIQUE_TEMPLATES;
            break;
          case 'prestige':
            progress = Number(user.prestige_level || 0);
            target   = cond.level;
            break;
          default:
            continue;
        }

        const clampedProgress = Math.min(progress, target);
        const nowCompleted    = progress >= target;

        // Upsert progress row; set completed_at only on the first completion
        await query(
          `INSERT INTO user_achievements (user_id, achievement_id, progress, completed, completed_at)
           VALUES ($1, $2, $3, $4, CASE WHEN $4 THEN NOW() ELSE NULL END)
           ON CONFLICT (user_id, achievement_id) DO UPDATE SET
             progress     = EXCLUDED.progress,
             completed    = EXCLUDED.completed,
             completed_at = CASE
               WHEN EXCLUDED.completed AND NOT user_achievements.completed THEN NOW()
               ELSE user_achievements.completed_at
             END`,
          [userId, def.id, clampedProgress, nowCompleted]
        );

        // Award rewards — def was not completed before (guaranteed by WHERE in query above)
        if (nowCompleted) {
          await withTransaction(async (client) => {
            const userRow = await client.query('SELECT credits, xp FROM users WHERE id = $1 FOR UPDATE', [userId]);
            const user = userRow.rows[0];

            if (def.reward_credits > 0) {
              const before = Number(user.credits);
              await client.query('UPDATE users SET credits = credits + $1 WHERE id = $2', [def.reward_credits, userId]);
              await client.query(
                `INSERT INTO credit_transactions (user_id, type, amount, balance_before, balance_after)
                 VALUES ($1, 'achievement_reward', $2, $3, $4)`,
                [userId, def.reward_credits, before, before + def.reward_credits]
              );
            }
            if (def.reward_xp > 0) {
              const newXP = Number(user.xp) + def.reward_xp;
              const lt    = this.cfg?.config?.xp?.levelTable;
              const newLevel = lt ? this._calculateLevel(newXP, lt) : null;
              if (newLevel !== null) {
                await client.query('UPDATE users SET xp = $1, level = $2 WHERE id = $3', [newXP, newLevel, userId]);
              } else {
                await client.query('UPDATE users SET xp = xp + $1 WHERE id = $2', [def.reward_xp, userId]);
              }
            }
          });
          logger.info({ userId, achievementId: def.id }, 'Achievement unlocked and rewarded');
        }
      }
    } catch (err) {
      logger.error({ err, userId }, 'Achievement check failed');
    }
  }
}

module.exports = AchievementService;
