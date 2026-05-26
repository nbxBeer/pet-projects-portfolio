'use strict';

const { query, withTransaction } = require('../db/pool');
const logger = require('../utils/logger');

const STORY_TEMPLATE_IDS = [
  'bio_story_gene_enhancer',
  'tech_story_divine_shard',
  'nav_story_particle_decelerator',
];

const PRESTIGE_LEVELS = [
  { level: 1, label: 'Первый Горизонт', icon: '✦' },
  { level: 2, label: 'Второй Горизонт', icon: '✦✦' },
  { level: 3, label: 'Третий Горизонт', icon: '✦✦✦' },
];

class PrestigeService {
  constructor(nftNotificationService, achievementService) {
    this.nftNotificationService = nftNotificationService;
    this.achievementService = achievementService;
  }

  async getStatus(userId) {
    const [userRes, modulesRes, storyQuestsRes, storyItemRes, signalRes, blackMarketRes] = await Promise.all([
      query('SELECT level, prestige_level FROM users WHERE id = $1', [userId]),
      query('SELECT module_type, level FROM ship_modules WHERE user_id = $1', [userId]),
      query(
        `SELECT template_id, status FROM user_quests
         WHERE user_id = $1 AND quest_type = 'story' AND template_id = ANY($2)`,
        [userId, STORY_TEMPLATE_IDS]
      ),
      query(
        `SELECT 1 FROM user_story_items WHERE user_id = $1
         AND item_key IN ('gene_enhancer','divine_shard','particle_decelerator') LIMIT 3`,
        [userId]
      ),
      query(
        `SELECT 1 FROM user_story_items
         WHERE user_id = $1 AND item_key = 'signal_from_another_universe' LIMIT 1`,
        [userId]
      ),
      query(
        `SELECT reputation FROM user_faction_reputation
         WHERE user_id = $1 AND faction_id = 'black_market' LIMIT 1`,
        [userId]
      ),
    ]);

    if (!userRes.rows.length) throw new Error('User not found');
    const user = userRes.rows[0];
    const prestigeLevel = Number(user.prestige_level || 0);

    if (prestigeLevel >= 3) {
      return {
        prestigeLevel,
        maxPrestige: true,
        conditions: null,
        eligible: false,
      };
    }

    const modules = {};
    for (const m of modulesRes.rows) modules[m.module_type] = Number(m.level);

    const claimedQuests = new Set(
      storyQuestsRes.rows
        .filter((r) => r.status === 'claimed')
        .map((r) => r.template_id)
    );

    const blackMarketRep = Number(blackMarketRes.rows[0]?.reputation || 0);

    const conditions = {
      level: {
        done: Number(user.level) >= 30,
        current: Number(user.level),
        required: 30,
      },
      modules: {
        done:
          (modules.scanner || 0) >= 10 &&
          (modules.cargo || 0) >= 10 &&
          (modules.capsule || 0) >= 10,
        scanner:  { current: modules.scanner  || 0, required: 10 },
        cargo:    { current: modules.cargo    || 0, required: 10 },
        capsule:  { current: modules.capsule  || 0, required: 10 },
      },
      storyMissions: {
        done:
          claimedQuests.has('bio_story_gene_enhancer') &&
          claimedQuests.has('tech_story_divine_shard') &&
          claimedQuests.has('nav_story_particle_decelerator') &&
          signalRes.rows.length > 0,
        bio:  claimedQuests.has('bio_story_gene_enhancer'),
        tech: claimedQuests.has('tech_story_divine_shard'),
        nav:  claimedQuests.has('nav_story_particle_decelerator'),
        signal: signalRes.rows.length > 0,
      },
      blackMarket: {
        done: blackMarketRep >= 500,
        current: blackMarketRep,
        required: 500,
      },
    };

    const eligible =
      conditions.level.done &&
      conditions.modules.done &&
      conditions.storyMissions.done &&
      conditions.blackMarket.done;

    return { prestigeLevel, maxPrestige: false, conditions, eligible };
  }

  async claimPrestige(userId) {
    const status = await this.getStatus(userId);
    if (status.maxPrestige) throw new Error('Max prestige reached');
    if (!status.eligible) throw new Error('Conditions not met');

    const newLevel = status.prestigeLevel + 1;

    return await withTransaction(async (client) => {
      // Snapshot state before reset
      const snapshotRes = await client.query(
        `SELECT xp, level, credits, crystals, current_universe,
                total_expeditions, total_finds, total_sold
         FROM users WHERE id = $1`,
        [userId]
      );
      const snapshot = snapshotRes.rows[0];

      // Record prestige history
      await client.query(
        `INSERT INTO user_prestiges (user_id, prestige_level, snapshot)
         VALUES ($1, $2, $3)`,
        [userId, newLevel, JSON.stringify(snapshot)]
      );

      // ── Reset users table ──────────────────────────────────────────────
      await client.query(
        `UPDATE users SET
           prestige_level        = $2,
           xp                    = 0,
           level                 = 1,
           credits               = 0,
           crystals              = 0,
           current_universe      = 1,
           universe_travel_until = NULL,
           expedition_cooldown_until = NULL,
           total_expeditions     = 0,
           total_finds           = 0,
           total_sold            = 0,
           total_speedups        = 0,
           pirate_encounters     = 0,
           pirate_fight_wins     = 0,
           pirate_fight_losses   = 0
         WHERE id = $1`,
        [userId, newLevel]
      );

      // ── Cancel active expeditions ──────────────────────────────────────
      await client.query(
        `UPDATE expeditions SET status = 'collected', collected_at = NOW()
         WHERE user_id = $1 AND status IN ('in_progress', 'completed')`,
        [userId]
      );

      // ── Wipe gameplay tables ───────────────────────────────────────────
      await client.query('DELETE FROM ship_modules WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM user_active_buffs WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM user_quests WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM user_quest_refresh WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM user_quest_items WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM user_faction_reputation WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM user_story_items WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM user_story_dialog_progress WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM user_drills WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM mini_tournament_progress WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM user_exhibitions WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM smuggler_exchanges WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM user_collections WHERE user_id = $1', [userId]);

      // ── Wipe inventory except NFT containers ──────────────────────────
      await client.query(
        `DELETE FROM inventory_items
         WHERE user_id = $1 AND find_type <> 'nft_container'`,
        [userId]
      );

      // ── Give prestige NFT container reward (direct inventory insert) ──
      const label = PRESTIGE_LEVELS[newLevel - 1]?.label || `Престиж ${newLevel}`;
      const outcomeLabel = `Контейнер Престижа ${newLevel} — ${label}`;
      await client.query(
        `INSERT INTO inventory_items
           (user_id, result_id, find_type, rarity, object_data, status)
         VALUES ($1, NULL, 'nft_container', 'legendary', $2, 'in_inventory')`,
        [userId, JSON.stringify({ outcomeType: 'prestige_nft', outcomeLabel, prestigeLevel: newLevel })]
      );

      logger.info({ userId, newLevel }, '🌟 Prestige claimed');
      return { prestigeLevel: newLevel, label, icon: PRESTIGE_LEVELS[newLevel - 1]?.icon };
    });
  }

  async checkPrestigeAchievements(userId) {
    if (this.achievementService) {
      await this.achievementService.checkAndAward(userId);
    }
  }

  // Called after transaction to fire admin notification (outside TX so it doesn't block)
  async notifyAdminPrestige(user, newLevel) {
    if (!this.nftNotificationService) return;
    const label = PRESTIGE_LEVELS[newLevel - 1]?.label || `Престиж ${newLevel}`;
    try {
      await this.nftNotificationService.sendAdminNotification({
        userId: user.id,
        username: user.username,
        firstName: user.first_name,
        outcomeType: 'prestige_reward',
        outcomeLabel: `🌟 ПРЕСТИЖ ${newLevel} — ${label}: отправь NFT контейнер игроку`,
      });
    } catch (err) {
      logger.error({ err, userId: user.id }, 'Failed to send prestige admin notification');
    }
  }

  async getHistory({ limit = 50, offset = 0 } = {}) {
    const res = await query(
      `SELECT p.*, u.username, u.first_name
       FROM user_prestiges p
       JOIN users u ON u.id = p.user_id
       ORDER BY p.achieved_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return res.rows;
  }

  async getUserHistory(userId) {
    const res = await query(
      `SELECT prestige_level, achieved_at FROM user_prestiges
       WHERE user_id = $1 ORDER BY prestige_level`,
      [userId]
    );
    return res.rows;
  }

  static get PRESTIGE_LEVELS() { return PRESTIGE_LEVELS; }
}

module.exports = PrestigeService;
