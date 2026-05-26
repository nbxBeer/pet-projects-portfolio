'use strict';

const { query, withTransaction } = require('../db/pool');
const logger = require('../utils/logger');

/**
 * Story quest definitions for legacy /api/story claim flow.
 * Active story gameplay questing now goes through questService quest_type='story'.
 * /api/story is kept to expose obtained story items for the shop tab.
 */
const STORY_QUESTS = [];

const STORY_ITEM_FALLBACKS = {
  signal_from_another_universe: {
    icon: '📡',
    nameRu: 'Сигнал из другой вселенной',
    nameEn: 'Signal from Another Universe',
    descRu: 'Странный мифический сигнал, указывающий путь во Вселенную II.',
    descEn: 'A strange mythical signal pointing the way to Universe II.',
  },
  particle_decelerator: {
    icon: '⚛️',
    nameRu: 'Децелератор частиц',
    nameEn: 'Particle Decelerator',
    descRu: 'Стабилизирует полёт в долгих экспедициях и открывает режим на 2 часа.',
    descEn: 'Stabilizes long-run flights and unlocks the 2-hour expedition mode.',
  },
  chrono_timer: {
    icon: '⏳',
    nameRu: 'Хроно-таймер',
    nameEn: 'Chrono Timer',
    descRu: 'Снижает кулдаун серии быстрых экспедиций до 5 часов.',
    descEn: 'Reduces blitz cooldown to 5 hours.',
  },
  void_cannon: {
    icon: '💀',
    nameRu: 'Пустотная пушка',
    nameEn: 'Void Cannon',
    descRu: 'При нападении пиратов открывает кнопку уничтожения с гарантированной победой. Перезарядка 24 часа.',
    descEn: 'When pirates attack, unlocks a Destroy button with a guaranteed win. 24 hour cooldown.',
  },
  resonator_particle: {
    icon: '⚛️',
    nameRu: 'Резонатор частиц',
    nameEn: 'Resonator Particle',
    descRu: 'Позволяет задать тип следующей экспедиционной находки.',
    descEn: 'Lets you choose the type of the next expedition find.',
  },
  hyperlane_beacon: {
    icon: '🚚',
    nameRu: 'Гиперлинейный маяк',
    nameEn: 'Hyperlane Beacon',
    descRu: 'Сокращает время перелёта между вселенными вдвое.',
    descEn: 'Halves the travel time between universes.',
  },
  divine_shard: {
    icon: '💎',
    nameRu: 'Божественный осколок',
    nameEn: 'Divine Shard',
    descRu: 'Осколок неизвестной цивилизации, мерцающий энергией обеих вселенных. Технологический институт заинтересован в нём.',
    descEn: 'A shard of an unknown civilization, shimmering with energy from both universes. The Technology Institute is interested in it.',
  },
  exhibition_pass: {
    icon: '🏛️',
    nameRu: 'Доступ к выставке',
    nameEn: 'Exhibition Pass',
    descRu: 'Технологический институт открыл вам доступ к галерее артефактов. Отправляйте легендарные артефакты на выставку.',
    descEn: 'The Technology Institute has granted you access to the artifact gallery. Send legendary artifacts to the exhibition.',
  },
};

class StoryService {
  constructor(configManager) {
    this.cfg = configManager;
  }

  /**
   * Get all story quests with progress for a user.
   */
  async getStoryQuests(userId) {
    // Get user stats for condition checks
    const userRes = await query(
      'SELECT total_speedups, level FROM users WHERE id = $1',
      [userId]
    );
    if (!userRes.rows.length) return { quests: [], items: [] };
    const user = userRes.rows[0];

    // Get already obtained story items
    const itemsRes = await query(
      'SELECT item_key, item_data, obtained_at FROM user_story_items WHERE user_id = $1',
      [userId]
    );
    const obtainedKeys = new Set(itemsRes.rows.map(r => r.item_key));

    const quests = STORY_QUESTS.map(sq => {
      const completed = obtainedKeys.has(sq.rewardItemKey);
      let progress = 0;
      let target = sq.conditionValue;

      switch (sq.conditionType) {
        case 'total_speedups':
          progress = Math.min(user.total_speedups || 0, target);
          break;
      }

      return {
        id: sq.id,
        nameRu: sq.nameRu,
        nameEn: sq.nameEn,
        descRu: sq.descRu,
        descEn: sq.descEn,
        icon: sq.icon,
        progress,
        target,
        completed,
        canClaim: !completed && progress >= target,
      };
    });

    const items = itemsRes.rows.map((r) => {
      const raw = (r.item_data && typeof r.item_data === 'object') ? r.item_data : {};
      const fallback = STORY_ITEM_FALLBACKS[r.item_key] || {};
      const cooldownHours = Number(raw.cooldownHours || fallback.cooldownHours || 0);
      const lastUsedAt = raw.lastUsedAt || null;
      const cooldownUntil = lastUsedAt && cooldownHours > 0
        ? new Date(new Date(lastUsedAt).getTime() + cooldownHours * 3600 * 1000).toISOString()
        : null;

      const nameRu = raw.nameRu || raw.name || fallback.nameRu || r.item_key;
      const nameEn = raw.nameEn || fallback.nameEn || nameRu;
      const descRu = raw.descRu || raw.description || fallback.descRu || '';
      const descEn = raw.descEn || raw.descriptionEn || fallback.descEn || descRu;

      return {
        key: r.item_key,
        ...raw,
        icon: raw.icon || fallback.icon || '📜',
        nameRu,
        nameEn,
        descRu,
        descEn,
        obtainedAt: r.obtained_at,
        cooldownHours,
        cooldownUntil,
        lastUsedAt,
      };
    });

    return { quests, items };
  }

  /**
   * Claim a completed story quest reward.
   */
  async claimStoryQuest(userId, questId) {
    const sqDef = STORY_QUESTS.find(q => q.id === questId);
    if (!sqDef) throw { status: 400, message: 'Unknown story quest' };

    return await withTransaction(async (client) => {
      // Check not already obtained
      const existing = await client.query(
        'SELECT 1 FROM user_story_items WHERE user_id = $1 AND item_key = $2',
        [userId, sqDef.rewardItemKey]
      );
      if (existing.rows.length > 0) {
        throw { status: 409, message: 'Already claimed' };
      }

      // Check condition
      const userRes = await client.query(
        'SELECT total_speedups, level FROM users WHERE id = $1 FOR UPDATE',
        [userId]
      );
      if (!userRes.rows.length) throw { status: 404, message: 'User not found' };
      const user = userRes.rows[0];

      let progress = 0;
      switch (sqDef.conditionType) {
        case 'total_speedups':
          progress = user.total_speedups || 0;
          break;
      }

      if (progress < sqDef.conditionValue) {
        throw { status: 403, message: 'Quest not completed yet', progress, target: sqDef.conditionValue };
      }

      // Grant story item
      await client.query(
        `INSERT INTO user_story_items (user_id, item_key, item_data)
         VALUES ($1, $2, $3)`,
        [userId, sqDef.rewardItemKey, JSON.stringify(sqDef.rewardItemData)]
      );

      logger.info({ userId, questId, itemKey: sqDef.rewardItemKey }, 'Story quest claimed');

      return {
        claimed: true,
        item: {
          key: sqDef.rewardItemKey,
          ...sqDef.rewardItemData,
        },
      };
    });
  }

  /**
   * Check if user has a specific story item.
   */
  async hasStoryItem(userId, itemKey) {
    const res = await query(
      'SELECT 1 FROM user_story_items WHERE user_id = $1 AND item_key = $2',
      [userId, itemKey]
    );
    return res.rows.length > 0;
  }

  async useStoryItem(userId, itemKey, payload = {}) {
    return await withTransaction(async (client) => {
      const userRes = await client.query(
        'SELECT current_universe FROM users WHERE id = $1 FOR UPDATE',
        [userId]
      );
      if (!userRes.rows.length) throw { status: 404, message: 'User not found' };
      const currentUniverse = Number(userRes.rows[0].current_universe || 1);

      const itemRes = await client.query(
        `SELECT item_key, item_data FROM user_story_items
         WHERE user_id = $1 AND item_key = $2
         FOR UPDATE`,
        [userId, itemKey]
      );
      if (!itemRes.rows.length) throw { status: 404, message: 'Story item not found' };

      if (itemKey === 'resonator_particle') {
        const allowedTypes = currentUniverse === 2
          ? ['echo', 'relic', 'entity', 'rift', 'asteroid']
          : ['debris', 'artifact', 'creature', 'anomaly'];
        const selectedType = String(payload.selectedType || '');
        if (!allowedTypes.includes(selectedType)) {
          throw {
            status: 400,
            message: currentUniverse === 2
              ? 'Selected type is not available in Universe 1'
              : 'Selected type is not available in Universe 2',
            currentUniverse,
            allowedTypes,
          };
        }

        const updatedData = {
          ...(itemRes.rows[0].item_data || {}),
          selectedType,
          selectedAt: new Date().toISOString(),
          sourceUniverse: currentUniverse,
        };

        await client.query(
          `INSERT INTO user_active_buffs (user_id, buff_type, expires_at, uses_remaining, metadata)
           VALUES ($1, 'force_type', NULL, 1, $2)
           ON CONFLICT (user_id, buff_type)
           DO UPDATE SET expires_at = NULL,
                         uses_remaining = 1,
                         metadata = EXCLUDED.metadata`,
          [userId, JSON.stringify({ findType: selectedType, source: itemKey, universe: currentUniverse })]
        );

        await client.query(
          `UPDATE user_story_items SET item_data = $1 WHERE user_id = $2 AND item_key = $3`,
          [JSON.stringify(updatedData), userId, itemKey]
        );

        return {
          activated: true,
          itemKey,
          selectedType,
          universe: currentUniverse,
        };
      }

      return { error: 'This story item cannot be used directly' };
    });
  }
}

module.exports = StoryService;
