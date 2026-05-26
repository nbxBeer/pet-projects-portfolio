'use strict';

const { query, withTransaction } = require('../db/pool');
const logger = require('../utils/logger');
const defaultConfig = require('../config/gameConfig');

class QuestService {
  constructor(configManager) {
    this.cfg = configManager;
  }

  static STORY_BIO_QUEST = {
    templateId: 'bio_story_gene_enhancer',
    factionId: 'bioengineers',
    reputationRequired: 400,
    targetAmount: 20,
    targetType: 'creature',
    rewardCredits: 2800,
    rewardXp: 520,
    reputationGain: 30,
    item: {
      key: 'gene_enhancer',
      data: {
        nameRu: 'Генный усилитель',
        nameEn: 'Gene Enhancer',
        descRu: 'Биотех-устройство, перестраивающее геном существ. Даёт 20% шанс повышения редкости существа на 1 уровень при поимке. Работает с капсулой уровня 5+.',
        descEn: 'A biotech device that rewrites creature genome. Gives a 20% chance to upgrade creature rarity by 1 tier on capture. Requires capsule level 5+.',
        icon: 'dna',
        effect: 'creature_rarity_upgrade',
      },
    },
  };
  static STORY_TECH_QUEST = {
    templateId: 'tech_story_divine_shard',
    factionId: 'tech_institute',
    reputationRequired: 444,
    targetAmount: 1,
    rewardCredits: 3500,
    rewardXp: 680,
    reputationGain: 32,
    item: {
      key: 'exhibition_pass',
      data: {
        nameRu: 'Доступ к выставке',
        nameEn: 'Exhibition Pass',
        descRu: 'Технологический институт открыл вам доступ к галерее артефактов. Отправляйте легендарные артефакты на выставку и получайте награду от зрителей.',
        descEn: 'The Technology Institute has granted access to the artifact gallery. Send legendary artifacts to the exhibition and earn visitor rewards.',
        icon: '🏛️',
        effect: 'unlocks_exhibition',
      },
    },
  };

  static STORY_PARTICLE_QUEST = {
    templateId: 'nav_story_particle_decelerator',
    factionId: 'navigators_order',
    reputationRequired: 500,
    targetAmount: 10,
    rewardCredits: 4200,
    rewardXp: 760,
    reputationGain: 35,
    item: {
      key: 'particle_decelerator',
      data: {
        nameRu: 'Замедлитель частиц',
        nameEn: 'Particle Decelerator',
        descRu: 'Древний артефакт, способный искривлять течение времени. Позволяет отправлять корабль в длинные экспедиции (2 часа) с гарантией редких находок.',
        descEn: 'An ancient artifact capable of bending the flow of time. Allows sending ships on long expeditions (2 hours) with guaranteed rare finds.',
        icon: '⚛️',
        effect: 'unlocks_long_expeditions',
      },
    },
  };

  static STORY_CHRONICLER_QUEST = {
    templateId: 'chr_story_chrono_timer',
    factionId: 'chroniclers',
    reputationRequired: 400,
    targetAmount: 10,
    rewardCredits: 5200,
    rewardXp: 900,
    reputationGain: 38,
    item: {
      key: 'chrono_timer',
      data: {
        nameRu: 'Хроно-таймер',
        nameEn: 'Chrono Timer',
        descRu: 'Хронометр Хронистов стабилизирует серию быстрых экспедиций. Снижает кулдаун блица с 6 до 5 часов.',
        descEn: 'The Chroniclers\' chronometer stabilizes blitz runs. Reduces blitz cooldown from 6 to 5 hours.',
        icon: 'hourglass',
        effect: 'blitz_cooldown_hours',
        cooldownHours: 5,
      },
    },
  };

  static STORY_VOID_QUEST = {
    templateId: 'void_story_void_cannon',
    factionId: 'void_seekers',
    reputationRequired: 400,
    targetAmount: 1,
    rewardCredits: 7000,
    rewardXp: 980,
    reputationGain: 40,
    item: {
      key: 'void_cannon',
      data: {
        nameRu: 'Пустотная пушка',
        nameEn: 'Void Cannon',
        descRu: 'При нападении пиратов позволяет выбрать «Уничтожить» и гарантированно победить. Перезарядка 24 часа.',
        descEn: 'When pirates attack, lets you choose Destroy and guarantees a win. 24 hour cooldown.',
        icon: 'skull',
        effect: 'pirate_destroy',
        cooldownHours: 24,
      },
    },
  };

  static STORY_RESONATOR_QUEST = {
    templateId: 'res_story_resonator_particle',
    factionId: 'resonators',
    reputationRequired: 500,
    targetAmount: 20,
    rewardCredits: 6200,
    rewardXp: 960,
    reputationGain: 42,
    item: {
      key: 'resonator_particle',
      data: {
        nameRu: 'Резонатор частиц',
        nameEn: 'Resonator Particle',
        descRu: 'Позволяет выбрать тип следующей экспедиционной находки. Работает только в своей вселенной.',
        descEn: 'Lets you choose the type of the next expedition find. Works only in the matching universe.',
        icon: 'atom',
        effect: 'force_find_type',
      },
    },
  };

  static STORY_HAULER_QUEST = {
    templateId: 'haul_story_hyperlane_beacon',
    factionId: 'haulers',
    reputationRequired: 200,
    targetAmount: 4,
    rewardCredits: 8500,
    rewardXp: 1120,
    reputationGain: 45,
    item: {
      key: 'hyperlane_beacon',
      data: {
        nameRu: 'Гиперлинейный маяк',
        nameEn: 'Hyperlane Beacon',
        descRu: 'Сокращает время перелёта между вселенными вдвое.',
        descEn: 'Halves the travel time between universes.',
        icon: 'rocket',
        effect: 'universe_travel_time_mult',
        travelMultiplier: 0.5,
      },
    },
  };

  _factionsCfg() { return this.cfg.get('factions'); }
  _questsCfg() {
    const cfg = this.cfg.get('quests');
    const defaultTemplates = defaultConfig.quests?.templates || [];
    const configuredTemplates = cfg?.templates || [];
    const existingIds = new Set(configuredTemplates.map((t) => t.id));
    const missingDefaultTemplates = defaultTemplates.filter((t) => !existingIds.has(t.id));
    return {
      ...cfg,
      templates: [...configuredTemplates, ...missingDefaultTemplates],
    };
  }

  // ── Get active factions for a user (filtered by universe) ──────────────────
  getActiveFactions(userLevel, universe = 1) {
    const cfg = this._factionsCfg();
    return cfg.list.filter(f =>
      f.active &&
      userLevel >= f.minLevel &&
      (f.universe || 1) === universe
    );
  }

  // ── Check if a faction belongs to Universe 2 ────────────────────────────────
  _isU2Faction(factionId) {
    const factions = this._factionsCfg().list;
    const f = factions.find(ff => ff.id === factionId);
    return f ? (f.universe || 1) === 2 : false;
  }

  // ── Get user reputation for all factions ────────────────────────────────────
  async getReputations(userId) {
    const rows = await query(
      'SELECT faction_id, reputation FROM user_faction_reputation WHERE user_id = $1',
      [userId]
    );
    const map = {};
    for (const r of rows.rows) map[r.faction_id] = Number(r.reputation);
    return map;
  }

  // ── Reputation tier label ───────────────────────────────────────────────────
  getReputationTier(rep) {
    const tiers = this._factionsCfg().reputationTiers;
    let tier = tiers[0];
    for (const t of tiers) {
      if (rep >= t.min) tier = t;
    }
    return tier;
  }

  // ── Reputation reward multiplier ────────────────────────────────────────────
  getReputationMultiplier(rep) {
    const mults = this._factionsCfg().reputationMultipliers;
    let mult = 1.0;
    for (const m of mults) {
      if (rep >= m.min) mult = m.mult;
    }
    return mult;
  }

  // ── Check reputation requirements for a template ────────────────────────────
  _meetsRepRequirements(tmpl, reputations) {
    const reqs = tmpl.reputationRequirements;
    if (!reqs || !Array.isArray(reqs) || reqs.length === 0) return true;
    for (const req of reqs) {
      const rep = reputations[req.factionId] || 0;
      if (req.operator === '>' && !(rep > req.value)) return false;
      if (req.operator === '>=' && !(rep >= req.value)) return false;
      if (req.operator === '<' && !(rep < req.value)) return false;
      if (req.operator === '<=' && !(rep <= req.value)) return false;
      if (req.operator === '==' && rep !== req.value) return false;
    }
    return true;
  }

  // ── Generate quests for a user ──────────────────────────────────────────────
  async generateQuests(userId, questType, userLevel, universe = 1) {
    const qCfg = this._questsCfg();
    const typeCfg = qCfg[questType];
    if (!typeCfg) return [];

    const activeFactions = this.getActiveFactions(userLevel, universe);
    if (activeFactions.length === 0) return [];

    // Get user reputations for filtering and reward baking
    const reputations = await this.getReputations(userId);

    const templates = qCfg.templates.filter(t =>
      t.questTypes.includes(questType) &&
      activeFactions.some(f => f.id === t.faction) &&
      this._meetsRepRequirements(t, reputations)
    );
    if (templates.length === 0) return [];

    const count = typeCfg.count;
    const selected = [];
    const usedFactions = new Set();

    // Shuffle templates
    const shuffled = [...templates].sort(() => Math.random() - 0.5);

    // Try to pick from different factions
    for (const tmpl of shuffled) {
      if (selected.length >= count) break;
      if (!usedFactions.has(tmpl.faction) || selected.length >= activeFactions.length) {
        selected.push(this._instantiateQuest(tmpl, questType, reputations));
        usedFactions.add(tmpl.faction);
      }
    }

    // Fill remaining
    for (const tmpl of shuffled) {
      if (selected.length >= count) break;
      if (!selected.some(s => s.templateId === tmpl.id)) {
        selected.push(this._instantiateQuest(tmpl, questType, reputations));
      }
    }

    return selected;
  }

  // ── Instantiate a quest from template ───────────────────────────────────────
  _instantiateQuest(tmpl, questType, reputations = {}) {
    const rand = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
    let amount = rand(tmpl.amountRange[0], tmpl.amountRange[1]);
    const xp = rand(tmpl.xpRange[0], tmpl.xpRange[1]);
    const repGain = rand(tmpl.reputationGain[0], tmpl.reputationGain[1]);

    // Pick a target rarity
    const targetRarity = tmpl.targetRarities.length > 0
      ? tmpl.targetRarities[Math.floor(Math.random() * tmpl.targetRarities.length)]
      : null;

    // Cap amount by rarity + schedule type
    // daily:   Common/Exotic 1-10, Rare/Ancient 1-5, Epic/Relic(U2) 1-2
    // weekly:  Common 20-70, Rare 15-50, Epic 10-35, Legendary 1-10, Mythical 1-3
    //          Exotic 20-70, Ancient 15-50, Relic(U2) 10-35, Hybrid 1-10, Singularity 1-3
    // special: Same as weekly
    const isDaily = questType === 'daily' || questType === 'repeatable';
    if (targetRarity === 'mythical' || targetRarity === 'singularity') {
      amount = isDaily ? 0 : Math.min(amount, 3);
    } else if (targetRarity === 'legendary' || targetRarity === 'hybrid') {
      amount = isDaily ? 0 : Math.min(amount, 10);
    } else if (targetRarity === 'epic' || targetRarity === 'relic') {
      amount = Math.min(amount, isDaily ? 2 : 35);
    } else if (targetRarity === 'rare' || targetRarity === 'ancient') {
      amount = Math.min(amount, isDaily ? 5 : 50);
    } else if (targetRarity === 'common' || targetRarity === 'exotic') {
      amount = Math.min(amount, isDaily ? 10 : 70);
    }
    // Skip if amount was capped to 0 (e.g. legendary in daily) — pick a different rarity
    if (amount <= 0 && tmpl.targetRarities.length > 1) {
      const fallback = tmpl.targetRarities.filter(r => r !== targetRarity);
      if (fallback.length) {
        return this._instantiateQuest(
          { ...tmpl, targetRarities: fallback },
          questType
        );
      }
      amount = 1; // absolute fallback
    } else if (amount <= 0) {
      amount = 1;
    }

    // Dynamic credit reward based on quest type and average item prices
    let credits;
    const dynamicCredits = this._calculateDynamicCredits(tmpl, amount, targetRarity);
    if (dynamicCredits !== null) {
      // Add ±5-10% randomization
      const variance = 0.9 + Math.random() * 0.2; // 0.9 to 1.1
      credits = Math.round(dynamicCredits * variance);
    } else {
      credits = rand(tmpl.creditRange[0], tmpl.creditRange[1]);
    }

    // Bake faction reputation multiplier into reward at generation time
    // so the displayed reward matches what the player actually receives.
    const factionRep = reputations[tmpl.faction] || 0;
    const repMult = this.getReputationMultiplier(factionRep);
    const negMult = factionRep < 0 ? Math.max(0.5, 1.0 + factionRep / 2000) : 1.0;
    credits = Math.round(credits * repMult * negMult);

    // Star reward chance (Black Market mainly)
    let starReward = 0;
    if (tmpl.starChance && Math.random() < tmpl.starChance) {
      starReward = rand(tmpl.starRange[0], tmpl.starRange[1]);
    }

    // Determine if this is a U2 faction quest (rewards in crystals)
    const isU2Quest = this._isU2Faction(tmpl.faction);

    // Build descriptive name based on type
    const RARITY_RU = {
      // U1
      common: 'Обычн.', rare: 'Редк.', epic: 'Эпич.', legendary: 'Легенд.', mythical: 'Мифич.',
      // U2
      exotic: 'Экзот.', ancient: 'Древн.', relic: 'Реликт.', hybrid: 'Гибрид.', singularity: 'Синг.',
    };
    const RARITY_EN = {
      // U1
      common: 'Common', rare: 'Rare', epic: 'Epic', legendary: 'Legendary', mythical: 'Mythical',
      // U2
      exotic: 'Exotic', ancient: 'Ancient', relic: 'Relic', hybrid: 'Hybrid', singularity: 'Singularity',
    };
    const TYPE_RU = {
      // U1
      debris: 'обломки', artifact: 'артефакты', creature: 'существ', anomaly: 'аномалии',
      // U2
      echo: 'эхо-объектов', relic: 'реликвий', entity: 'сущностей', rift: 'разломов', asteroid: 'астероидов',
    };
    const TYPE_EN = {
      // U1
      debris: 'debris', artifact: 'artifacts', creature: 'creatures', anomaly: 'anomalies',
      // U2
      echo: 'echo objects', relic: 'relics', entity: 'entities', rift: 'rifts', asteroid: 'asteroids',
    };
    const TYPE_ICON = {
      // U1
      debris: '🔩', artifact: '💎', creature: '🐾', anomaly: '🌀',
      // U2
      echo: '〰️', relic: '🗿', entity: '👁', rift: '🌌', asteroid: '☄️',
    };
    const ACTION_RU = { deliver_object: 'Доставьте', sell_object: 'Продайте', find_object: 'Найдите' };
    const ACTION_EN = { deliver_object: 'Deliver', sell_object: 'Sell', find_object: 'Find' };

    const rarityLabel = targetRarity ? RARITY_RU[targetRarity] || '' : '';
    const rarityLabelEn = targetRarity ? RARITY_EN[targetRarity] || '' : '';
    const typeLabel = tmpl.targetType ? TYPE_RU[tmpl.targetType] || tmpl.targetType : '';
    const typeLabelEn = tmpl.targetType ? TYPE_EN[tmpl.targetType] || tmpl.targetType : '';
    const typeIcon = tmpl.targetType ? TYPE_ICON[tmpl.targetType] || '' : '';

    let nameRu = tmpl.nameRu;
    let nameEn = tmpl.nameEn;
    let descRu = tmpl.descRu;
    let descEn = tmpl.descEn;

    // Make descriptions specific
    const actionRu = ACTION_RU[tmpl.type] || '';
    const actionEn = ACTION_EN[tmpl.type] || '';

    if (tmpl.type === 'deliver_object' || tmpl.type === 'find_object' || tmpl.type === 'sell_object') {
      if (tmpl.targetType) {
        nameRu = `${typeIcon} ${tmpl.nameRu}`;
        const rarityPart = rarityLabel ? `${rarityLabel} ` : '';
        descRu = `${actionRu} ${rarityPart}${typeLabel} × ${amount}`;
        descEn = `${actionEn} ${rarityLabelEn ? rarityLabelEn + ' ' : ''}${typeLabelEn} × ${amount}`;
      } else {
        const rarityPart = rarityLabel ? `${rarityLabel} ` : '';
        descRu = `${actionRu} ${rarityPart}предметы × ${amount}`;
        descEn = `${actionEn} ${rarityLabelEn ? rarityLabelEn + ' ' : ''}items × ${amount}`;
      }
    } else if (tmpl.type === 'expeditions') {
      descRu = `Завершите ${amount} экспедиций`;
      descEn = `Complete ${amount} expeditions`;
    }

    // Reputation penalties from template
    const reputationPenalties = tmpl.reputationPenalties || [];

    return {
      templateId: tmpl.id,
      faction: tmpl.faction,
      questType,
      type: tmpl.type,
      targetType: tmpl.targetType,
      targetRarity,
      targetAmount: amount,
      rewardCredits: isU2Quest ? 0 : credits,
      rewardCrystals: isU2Quest ? credits : 0,
      rewardXp: xp,
      rewardStars: starReward,
      reputationGain: repGain,
      reputationPenalties,
      nameRu,
      nameEn,
      descRu,
      descEn,
    };
  }

  // ── Refresh quests if timer expired ─────────────────────────────────────────
  async refreshIfNeeded(userId, userLevel, universe = 1) {
    const qCfg = this._questsCfg();

    for (const questType of ['daily', 'weekly', 'repeatable']) {
      const typeCfg = qCfg[questType];
      if (!typeCfg) continue;

      const lastRefresh = await query(
        `SELECT last_refresh FROM user_quest_refresh
         WHERE user_id = $1 AND quest_type = $2`,
        [userId, questType]
      );

      const now = new Date();
      let needsRefresh = false;

      if (!lastRefresh.rows.length) {
        needsRefresh = true;
      } else {
        const elapsed = now - new Date(lastRefresh.rows[0].last_refresh);
        if (elapsed >= typeCfg.refreshHours * 3600000) {
          needsRefresh = true;
        }
      }

      if (needsRefresh) {
        await this._doRefresh(userId, questType, userLevel);
      }
    }

    // Special quest chance (only for U1)
    if (universe === 1) {
      await this._checkSpecialQuest(userId, userLevel);
    }

    // One-time story quests are U1 only
    if (universe === 1) {
      await this._ensureStoryQuest(userId);
      await this._ensureBioStoryQuest(userId);
      await this._ensureTechStoryQuest(userId);
    }

    if (universe === 2) {
      await this._ensureChroniclerStoryQuest(userId);
      await this._ensureVoidStoryQuest(userId);
      await this._ensureResonatorStoryQuest(userId);
      await this._ensureHaulerStoryQuest(userId);
    }

    // Check passive have_in_inventory quest progress
    await this.checkInventoryProgress(userId);

    // Check passive have_story_item quest progress
    await this._checkStoryItemQuestProgress(userId);
  }

  // ── One-time story quest unlock ────────────────────────────────────────────
  async _ensureStoryQuest(userId) {
    const storyCfg = QuestService.STORY_PARTICLE_QUEST;

    // If reward already obtained, story quest should never appear again.
    const hasReward = await query(
      `SELECT 1 FROM user_story_items
       WHERE user_id = $1 AND item_key = $2
       LIMIT 1`,
      [userId, storyCfg.item.key]
    );
    if (hasReward.rows.length > 0) return;

    // Unlock condition: 500+ reputation with Navigators Order.
    const reputations = await this.getReputations(userId);
    const navRep = reputations[storyCfg.factionId] || 0;
    if (navRep < storyCfg.reputationRequired) return;

    const storyQuestData = {
      templateId: storyCfg.templateId,
      faction: storyCfg.factionId,
      questType: 'story',
      type: 'speedups',
      targetType: null,
      targetRarity: null,
      targetAmount: storyCfg.targetAmount,
      rewardCredits: storyCfg.rewardCredits,
      rewardXp: storyCfg.rewardXp,
      rewardStars: 0,
      reputationGain: storyCfg.reputationGain,
      reputationPenalties: [],
      nameRu: '⚛️ Протокол «Замедлитель»',
      nameEn: '⚛️ "Decelerator" Protocol',
      descRu: `Ускорьте экспедиции ${storyCfg.targetAmount} раз для Ордена навигаторов.`,
      descEn: `Speed up expeditions ${storyCfg.targetAmount} times for the Navigators Order.`,
      storyRewardItem: storyCfg.item,
    };

    // Keep only one story quest instance (active/completed/claimed).
    const existing = await query(
      `SELECT id, quest_data, target_amount FROM user_quests
       WHERE user_id = $1 AND template_id = $2
       LIMIT 1`,
      [userId, storyCfg.templateId]
    );
    if (existing.rows.length > 0) {
      const row = existing.rows[0];
      const currentData = row.quest_data || {};
      const needsMigration = currentData.type !== 'speedups' || Number(row.target_amount) !== storyCfg.targetAmount;
      if (needsMigration) {
        await query(
          `UPDATE user_quests
           SET quest_data = $1,
               target_amount = $2,
               progress = 0,
               status = 'active',
               free_rerolls = 0
           WHERE id = $3`,
          [JSON.stringify(storyQuestData), storyCfg.targetAmount, row.id]
        );
        } else {
          // Keep text/reward metadata current without resetting player progress.
          await query(
            `UPDATE user_quests
             SET quest_data = $1,
                 target_amount = $2
             WHERE id = $3`,
            [JSON.stringify({ ...currentData, ...storyQuestData }), storyCfg.targetAmount, row.id]
          );
      }
      return;
    }

    await query(
      `INSERT INTO user_quests
       (user_id, quest_type, template_id, faction_id, quest_data, target_amount, progress, status, free_rerolls)
       VALUES ($1, 'story', $2, $3, $4, $5, 0, 'active', 0)`,
      [userId, storyCfg.templateId, storyCfg.factionId, JSON.stringify(storyQuestData), storyCfg.targetAmount]
    );

    logger.info({ userId, templateId: storyCfg.templateId }, 'Story quest unlocked');
  }

  // ── One-time story quest unlock for Bioengineers ───────────────────────────
  async _ensureBioStoryQuest(userId) {
    const storyCfg = QuestService.STORY_BIO_QUEST;

    const hasReward = await query(
      `SELECT 1 FROM user_story_items WHERE user_id = $1 AND item_key = $2 LIMIT 1`,
      [userId, storyCfg.item.key]
    );
    if (hasReward.rows.length > 0) return;

    const reputations = await this.getReputations(userId);
    if ((reputations[storyCfg.factionId] || 0) < storyCfg.reputationRequired) return;

    const storyQuestData = {
      templateId: storyCfg.templateId,
      faction: storyCfg.factionId,
      questType: 'story',
      type: 'have_in_inventory',
      targetType: storyCfg.targetType,
      targetRarity: null,
      targetAmount: storyCfg.targetAmount,
      rewardCredits: storyCfg.rewardCredits,
      rewardXp: storyCfg.rewardXp,
      rewardStars: 0,
      reputationGain: storyCfg.reputationGain,
      reputationPenalties: [],
      nameRu: 'Живая коллекция',
      nameEn: 'Living Collection',
      descRu: `Одновременно держите ${storyCfg.targetAmount} существ в инвентаре для Биоинженеров.`,
      descEn: `Hold ${storyCfg.targetAmount} creatures simultaneously in inventory for the Bioengineers.`,
      storyRewardItem: storyCfg.item,
    };

    const existing = await query(
      `SELECT id, quest_data, target_amount FROM user_quests WHERE user_id = $1 AND template_id = $2 LIMIT 1`,
      [userId, storyCfg.templateId]
    );
    if (existing.rows.length > 0) {
      const row = existing.rows[0];
      await query(
        `UPDATE user_quests SET quest_data = $1, target_amount = $2 WHERE id = $3`,
        [JSON.stringify({ ...(row.quest_data || {}), ...storyQuestData }), storyCfg.targetAmount, row.id]
      );
      return;
    }

    await query(
      `INSERT INTO user_quests
       (user_id, quest_type, template_id, faction_id, quest_data, target_amount, progress, status, free_rerolls)
       VALUES ($1, 'story', $2, $3, $4, $5, 0, 'active', 0)`,
      [userId, storyCfg.templateId, storyCfg.factionId, JSON.stringify(storyQuestData), storyCfg.targetAmount]
    );

    logger.info({ userId, templateId: storyCfg.templateId }, 'Bio story quest unlocked');
  }

  // ── One-time story quest unlock for Technology Institute ──────────────────
  async _ensureTechStoryQuest(userId) {
    const storyCfg = QuestService.STORY_TECH_QUEST;

    const hasReward = await query(
      `SELECT 1 FROM user_story_items WHERE user_id = $1 AND item_key = $2 LIMIT 1`,
      [userId, storyCfg.item.key]
    );
    if (hasReward.rows.length > 0) return;

    const reputations = await this.getReputations(userId);
    if ((reputations[storyCfg.factionId] || 0) < storyCfg.reputationRequired) return;

    const storyQuestData = {
      templateId: storyCfg.templateId,
      faction: storyCfg.factionId,
      questType: 'story',
      type: 'have_story_item',
      targetStoryItem: 'divine_shard',
      consumeStoryItem: 'divine_shard',
      targetType: null,
      targetRarity: null,
      targetAmount: storyCfg.targetAmount,
      rewardCredits: storyCfg.rewardCredits,
      rewardXp: storyCfg.rewardXp,
      rewardStars: 0,
      reputationGain: storyCfg.reputationGain,
      reputationPenalties: [],
      nameRu: '💎 Божественный осколок',
      nameEn: '💎 Divine Shard',
      descRu: 'Найдите Божественный осколок в дальней экспедиции и передайте его Институту.',
      descEn: 'Find the Divine Shard in a long expedition and deliver it to the Institute.',
      storyRewardItem: storyCfg.item,
    };

    const existing = await query(
      `SELECT id, quest_data, target_amount FROM user_quests WHERE user_id = $1 AND template_id = $2 LIMIT 1`,
      [userId, storyCfg.templateId]
    );
    if (existing.rows.length > 0) {
      const row = existing.rows[0];
      await query(
        `UPDATE user_quests SET quest_data = $1, target_amount = $2 WHERE id = $3`,
        [JSON.stringify({ ...(row.quest_data || {}), ...storyQuestData }), storyCfg.targetAmount, row.id]
      );
      return;
    }

    await query(
      `INSERT INTO user_quests
       (user_id, quest_type, template_id, faction_id, quest_data, target_amount, progress, status, free_rerolls)
       VALUES ($1, 'story', $2, $3, $4, $5, 0, 'active', 0)`,
      [userId, storyCfg.templateId, storyCfg.factionId, JSON.stringify(storyQuestData), storyCfg.targetAmount]
    );

    logger.info({ userId, templateId: storyCfg.templateId }, 'Tech story quest unlocked');
  }

  async _ensureChroniclerStoryQuest(userId) {
    const storyCfg = QuestService.STORY_CHRONICLER_QUEST;
    const hasReward = await query(
      `SELECT 1 FROM user_story_items WHERE user_id = $1 AND item_key = $2 LIMIT 1`,
      [userId, storyCfg.item.key]
    );
    if (hasReward.rows.length > 0) return;

    const reputations = await this.getReputations(userId);
    if ((reputations[storyCfg.factionId] || 0) < storyCfg.reputationRequired) return;

    const storyQuestData = {
      templateId: storyCfg.templateId,
      faction: storyCfg.factionId,
      questType: 'story',
      type: 'blitz_complete',
      targetType: null,
      targetRarity: null,
      targetAmount: storyCfg.targetAmount,
      rewardCredits: storyCfg.rewardCredits,
      rewardXp: storyCfg.rewardXp,
      rewardStars: 0,
      reputationGain: storyCfg.reputationGain,
      reputationPenalties: [],
      nameRu: '⏳ Хроно-перегрузка',
      nameEn: '⏳ Chrono Overload',
      descRu: `Завершите ${storyCfg.targetAmount} серий быстрых экспедиций без взрыва.`,
      descEn: `Complete ${storyCfg.targetAmount} blitz runs without detonating.`,
      storyRewardItem: storyCfg.item,
    };

    await this._upsertStoryQuest(userId, storyCfg, storyQuestData, 'Chronicler story quest');
  }

  async _ensureVoidStoryQuest(userId) {
    const storyCfg = QuestService.STORY_VOID_QUEST;
    const hasReward = await query(
      `SELECT 1 FROM user_story_items WHERE user_id = $1 AND item_key = $2 LIMIT 1`,
      [userId, storyCfg.item.key]
    );
    if (hasReward.rows.length > 0) return;

    const reputations = await this.getReputations(userId);
    if ((reputations[storyCfg.factionId] || 0) < storyCfg.reputationRequired) return;

    const storyQuestData = {
      templateId: storyCfg.templateId,
      faction: storyCfg.factionId,
      questType: 'story',
      type: 'spend_resources',
      targetType: null,
      targetRarity: null,
      targetAmount: storyCfg.targetAmount,
      requiredCredits: 5000,
      requiredCrystals: 5000,
      rewardCredits: storyCfg.rewardCredits,
      rewardCrystals: 0,
      rewardXp: storyCfg.rewardXp,
      rewardStars: 0,
      reputationGain: storyCfg.reputationGain,
      reputationPenalties: [],
      nameRu: '🕳️ Пустотный контракт',
      nameEn: '🕳️ Void Contract',
      descRu: 'Передайте Пустотникам 5000 кредитов и 5000 кристаллов.',
      descEn: 'Deliver 5000 credits and 5000 crystals to the Void Seekers.',
      storyRewardItem: storyCfg.item,
    };

    await this._upsertStoryQuest(userId, storyCfg, storyQuestData, 'Void story quest');
  }

  async _ensureResonatorStoryQuest(userId) {
    const storyCfg = QuestService.STORY_RESONATOR_QUEST;
    const hasReward = await query(
      `SELECT 1 FROM user_story_items WHERE user_id = $1 AND item_key = $2 LIMIT 1`,
      [userId, storyCfg.item.key]
    );
    if (hasReward.rows.length > 0) return;

    const reputations = await this.getReputations(userId);
    if ((reputations[storyCfg.factionId] || 0) < storyCfg.reputationRequired) return;

    const storyQuestData = {
      templateId: storyCfg.templateId,
      faction: storyCfg.factionId,
      questType: 'story',
      type: 'deliver_object',
      targetType: 'echo',
      targetRarities: [],
      targetRarity: null,
      targetAmount: storyCfg.targetAmount,
      rewardCredits: storyCfg.rewardCredits,
      rewardXp: storyCfg.rewardXp,
      rewardStars: 0,
      reputationGain: storyCfg.reputationGain,
      reputationPenalties: [],
      nameRu: '〰️ Резонансная настройка',
      nameEn: '〰️ Resonance Calibration',
      descRu: `Передайте ${storyCfg.targetAmount} эхо любой редкости.`,
      descEn: `Deliver ${storyCfg.targetAmount} echo finds of any rarity.`,
      storyRewardItem: storyCfg.item,
    };

    await this._upsertStoryQuest(userId, storyCfg, storyQuestData, 'Resonator story quest');
  }

  async _ensureHaulerStoryQuest(userId) {
    const storyCfg = QuestService.STORY_HAULER_QUEST;
    const hasReward = await query(
      `SELECT 1 FROM user_story_items WHERE user_id = $1 AND item_key = $2 LIMIT 1`,
      [userId, storyCfg.item.key]
    );
    if (hasReward.rows.length > 0) return;

    const reputations = await this.getReputations(userId);
    if ((reputations[storyCfg.factionId] || 0) < storyCfg.reputationRequired) return;

    const storyQuestData = {
      templateId: storyCfg.templateId,
      faction: storyCfg.factionId,
      questType: 'story',
      type: 'deliver_object',
      targetType: null,
      targetTypes: ['debris', 'artifact', 'creature', 'anomaly'],
      targetRarity: null,
      targetAmount: storyCfg.targetAmount,
      rewardCredits: storyCfg.rewardCredits,
      rewardXp: storyCfg.rewardXp,
      rewardStars: 0,
      reputationGain: storyCfg.reputationGain,
      reputationPenalties: [],
      nameRu: '🚚 Полный груз',
      nameEn: '🚚 Full Cargo',
      descRu: 'Передайте по одному предмету каждого типа U1.',
      descEn: 'Deliver one item of every U1 type.',
      storyRewardItem: storyCfg.item,
    };

    await this._upsertStoryQuest(userId, storyCfg, storyQuestData, 'Hauler story quest');
  }

  async _upsertStoryQuest(userId, storyCfg, storyQuestData, logLabel) {
    const existing = await query(
      `SELECT id, quest_data, target_amount FROM user_quests
       WHERE user_id = $1 AND template_id = $2
       LIMIT 1`,
      [userId, storyCfg.templateId]
    );

    if (existing.rows.length > 0) {
      const row = existing.rows[0];
      const currentData = row.quest_data || {};
      const needsMigration =
        currentData.type !== storyQuestData.type ||
        Number(row.target_amount) !== storyCfg.targetAmount;

      if (needsMigration) {
        await query(
          `UPDATE user_quests
           SET quest_data = $1,
               target_amount = $2,
               progress = 0,
               status = 'active',
               free_rerolls = 0
           WHERE id = $3`,
          [JSON.stringify(storyQuestData), storyCfg.targetAmount, row.id]
        );
      } else {
        await query(
          `UPDATE user_quests
           SET quest_data = $1,
               target_amount = $2
           WHERE id = $3`,
          [JSON.stringify({ ...currentData, ...storyQuestData }), storyCfg.targetAmount, row.id]
        );
      }
      return;
    }

    await query(
      `INSERT INTO user_quests
       (user_id, quest_type, template_id, faction_id, quest_data, target_amount, progress, status, free_rerolls)
       VALUES ($1, 'story', $2, $3, $4, $5, 0, 'active', 0)`,
      [userId, storyCfg.templateId, storyCfg.factionId, JSON.stringify(storyQuestData), storyCfg.targetAmount]
    );

    logger.info({ userId, templateId: storyCfg.templateId }, `${logLabel} unlocked`);
  }

  // ── Passive have_story_item progress check ─────────────────────────────────
  async _checkStoryItemQuestProgress(userId) {
    const activeQuests = await query(
      `SELECT id, quest_data, target_amount, progress
       FROM user_quests
       WHERE user_id = $1 AND status = 'active'
         AND (quest_data->>'type') = 'have_story_item'`,
      [userId]
    );
    if (!activeQuests.rows.length) return;

    for (const quest of activeQuests.rows) {
      const targetKey = quest.quest_data?.targetStoryItem;
      if (!targetKey) continue;

      const hasItem = await query(
        `SELECT 1 FROM user_story_items WHERE user_id = $1 AND item_key = $2 LIMIT 1`,
        [userId, targetKey]
      );
      const progress = hasItem.rows.length > 0 ? 1 : 0;
      if (progress === quest.progress) continue;

      if (progress >= quest.target_amount) {
        await query(
          `UPDATE user_quests SET progress = $1, status = 'completed' WHERE id = $2`,
          [quest.target_amount, quest.id]
        );
      } else {
        await query(
          `UPDATE user_quests SET progress = $1 WHERE id = $2`,
          [progress, quest.id]
        );
      }
    }
  }

  // ── Passive spend_resources progress check ────────────────────────────────
  async checkResourceQuestProgress(userId) {
    const activeQuests = await query(
      `SELECT id, quest_data, target_amount, progress
       FROM user_quests
       WHERE user_id = $1 AND status = 'active'
         AND (quest_data->>'type') = 'spend_resources'`,
      [userId]
    );
    if (!activeQuests.rows.length) return;

    const userRes = await query(
      'SELECT credits, crystals FROM users WHERE id = $1',
      [userId]
    );
    if (!userRes.rows.length) return;
    const user = userRes.rows[0];

    for (const quest of activeQuests.rows) {
      const requiredCredits = Number(quest.quest_data?.requiredCredits || 0);
      const requiredCrystals = Number(quest.quest_data?.requiredCrystals || 0);
      const hasEnough = Number(user.credits || 0) >= requiredCredits && Number(user.crystals || 0) >= requiredCrystals;
      const newProgress = hasEnough ? quest.target_amount : 0;

      if (newProgress === quest.progress) continue;

      if (newProgress >= quest.target_amount) {
        await query(
          `UPDATE user_quests SET progress = $1, status = 'completed' WHERE id = $2`,
          [quest.target_amount, quest.id]
        );
      } else {
        await query(
          `UPDATE user_quests SET progress = $1 WHERE id = $2`,
          [newProgress, quest.id]
        );
      }
    }
  }
  // ── Passive have_in_inventory progress check ───────────────────────────────
  async checkInventoryProgress(userId) {
    const activeQuests = await query(
      `SELECT id, quest_data, target_amount, progress
       FROM user_quests
       WHERE user_id = $1 AND status = 'active'
         AND (quest_data->>'type') = 'have_in_inventory'`,
      [userId]
    );
    if (!activeQuests.rows.length) return;

    for (const quest of activeQuests.rows) {
      const targetType = quest.quest_data?.targetType;

      const countRes = targetType
        ? await query(
            `SELECT COUNT(*) AS cnt FROM inventory_items
             WHERE user_id = $1 AND find_type = $2 AND status = 'in_inventory'`,
            [userId, targetType]
          )
        : await query(
            `SELECT COUNT(*) AS cnt FROM inventory_items
             WHERE user_id = $1 AND status = 'in_inventory'`,
            [userId]
          );

      const count = parseInt(countRes.rows[0].cnt, 10);
      const newProgress = Math.min(count, quest.target_amount);

      if (newProgress === quest.progress) continue;

      if (newProgress >= quest.target_amount) {
        await query(
          `UPDATE user_quests SET progress = $1, status = 'completed' WHERE id = $2`,
          [quest.target_amount, quest.id]
        );
      } else {
        await query(
          `UPDATE user_quests SET progress = $1 WHERE id = $2`,
          [newProgress, quest.id]
        );
      }
    }
  }

  // ── Passive have_story_item progress check ─────────────────────────────────
  async _checkStoryItemQuestProgress(userId) {
    const activeQuests = await query(
      `SELECT id, quest_data, target_amount, progress
       FROM user_quests
       WHERE user_id = $1 AND status = 'active'
         AND (quest_data->>'type') = 'have_story_item'`,
      [userId]
    );
    if (!activeQuests.rows.length) return;

    for (const quest of activeQuests.rows) {
      const targetKey = quest.quest_data?.targetStoryItem;
      if (!targetKey) continue;

      const hasItem = await query(
        `SELECT 1 FROM user_story_items WHERE user_id = $1 AND item_key = $2 LIMIT 1`,
        [userId, targetKey]
      );
      const progress = hasItem.rows.length > 0 ? 1 : 0;
      if (progress === quest.progress) continue;

      if (progress >= quest.target_amount) {
        await query(
          `UPDATE user_quests SET progress = $1, status = 'completed' WHERE id = $2`,
          [quest.target_amount, quest.id]
        );
      } else {
        await query(
          `UPDATE user_quests SET progress = $1 WHERE id = $2`,
          [progress, quest.id]
        );
      }
    }
  }
  // ── Auto-claim rewards for a completed quest (used on pool refresh) ─────────
  async _autoClaimQuestRewards(client, userId, questRow) {
    const qd = questRow.quest_data;
    const credits = qd.rewardCredits || 0;
    const crystals = qd.rewardCrystals || 0;
    const xp = qd.rewardXp || 0;
    const stars = qd.rewardStars || 0;
    const repGain = qd.reputationGain || 0;

    const user = await client.query(
      'SELECT xp, level, stars_balance FROM users WHERE id = $1 FOR UPDATE',
      [userId]
    );
    if (!user.rows.length) return;
    const u = user.rows[0];

    const newXP = BigInt(u.xp) + BigInt(xp);
    const levelTable = this.cfg.config.xp.levelTable;
    let newLevel = u.level;
    for (const entry of levelTable) {
      if (Number(newXP) >= entry.xpRequired) newLevel = entry.level;
    }

    if (crystals > 0) {
      await client.query(
        'UPDATE users SET crystals = crystals + $1, xp = $2, level = $3 WHERE id = $4',
        [crystals, newXP, newLevel, userId]
      );
    } else {
      await client.query(
        'UPDATE users SET credits = credits + $1, xp = $2, level = $3 WHERE id = $4',
        [credits, newXP, newLevel, userId]
      );
    }

    if (stars > 0) {
      const balBefore = Number(u.stars_balance || 0);
      await client.query('UPDATE users SET stars_balance = stars_balance + $1 WHERE id = $2', [stars, userId]);
      await client.query(
        `INSERT INTO stars_transactions (user_id, type, amount, balance_before, balance_after, description)
         VALUES ($1, 'quest_reward', $2, $3, $4, $5)`,
        [userId, stars, balBefore, balBefore + stars, `Auto-claimed: ${questRow.template_id}`]
      );
    }

    if (repGain > 0) {
      await this._changeReputation(client, userId, questRow.faction_id, repGain);
      const conflicts = this._factionsCfg().conflicts.filter(c => c.source === questRow.faction_id);
      for (const conflict of conflicts) {
        const loss = Math.round(repGain * conflict.ratio);
        if (loss !== 0) await this._changeReputation(client, userId, conflict.target, loss);
      }
    }

    for (const penalty of (qd.reputationPenalties || [])) {
      if (penalty.factionId && penalty.amount) {
        await this._changeReputation(client, userId, penalty.factionId, -Math.abs(penalty.amount));
      }
    }
  }

  // ── Auto-claim rewards for a completed quest (used on pool refresh) ─────────
  async _autoClaimQuestRewards(client, userId, questRow) {
    const qd = questRow.quest_data;
    const credits = qd.rewardCredits || 0;
    const crystals = qd.rewardCrystals || 0;
    const xp = qd.rewardXp || 0;
    const stars = qd.rewardStars || 0;
    const repGain = qd.reputationGain || 0;

    const user = await client.query(
      'SELECT xp, level, stars_balance FROM users WHERE id = $1 FOR UPDATE',
      [userId]
    );
    if (!user.rows.length) return;
    const u = user.rows[0];

    const newXP = BigInt(u.xp) + BigInt(xp);
    const levelTable = this.cfg.config.xp.levelTable;
    let newLevel = u.level;
    for (const entry of levelTable) {
      if (Number(newXP) >= entry.xpRequired) newLevel = entry.level;
    }

    if (crystals > 0) {
      await client.query(
        'UPDATE users SET crystals = crystals + $1, xp = $2, level = $3 WHERE id = $4',
        [crystals, newXP, newLevel, userId]
      );
    } else {
      await client.query(
        'UPDATE users SET credits = credits + $1, xp = $2, level = $3 WHERE id = $4',
        [credits, newXP, newLevel, userId]
      );
    }

    if (stars > 0) {
      const balBefore = Number(u.stars_balance || 0);
      await client.query('UPDATE users SET stars_balance = stars_balance + $1 WHERE id = $2', [stars, userId]);
      await client.query(
        `INSERT INTO stars_transactions (user_id, type, amount, balance_before, balance_after, description)
         VALUES ($1, 'quest_reward', $2, $3, $4, $5)`,
        [userId, stars, balBefore, balBefore + stars, `Auto-claimed: ${questRow.template_id}`]
      );
    }

    if (repGain > 0) {
      await this._changeReputation(client, userId, questRow.faction_id, repGain);
      const conflicts = this._factionsCfg().conflicts.filter(c => c.source === questRow.faction_id);
      for (const conflict of conflicts) {
        const loss = Math.round(repGain * conflict.ratio);
        if (loss !== 0) await this._changeReputation(client, userId, conflict.target, loss);
      }
    }

    for (const penalty of (qd.reputationPenalties || [])) {
      if (penalty.factionId && penalty.amount) {
        await this._changeReputation(client, userId, penalty.factionId, -Math.abs(penalty.amount));
      }
    }
  }
  // ── Do refresh for a quest type ─────────────────────────────────────────────
  async _doRefresh(userId, questType, userLevel) {
    const questsByUniverse = await Promise.all(
      [1, 2].map((u) => this.generateQuests(userId, questType, userLevel, u))
    );
    const quests = questsByUniverse.flat();
    if (quests.length === 0) return;

    await withTransaction(async (client) => {
      // Auto-claim any completed-but-unclaimed quests so rewards are not lost on refresh.
      if (questType !== 'repeatable') {
        const completed = await client.query(
          `SELECT * FROM user_quests
           WHERE user_id = $1 AND quest_type = $2 AND status = 'completed'`,
          [userId, questType]
        );
        for (const q of completed.rows) {
          await this._autoClaimQuestRewards(client, userId, q);
          logger.info({ userId, questId: q.id, templateId: q.template_id }, 'Quest auto-claimed on pool refresh');
        }
      }

      // Delete all quests of this type (completed ones were just auto-claimed).
      await client.query(
        `DELETE FROM user_quests WHERE user_id = $1 AND quest_type = $2`,
        [userId, questType]
      );

      // Insert new quests
      for (const q of quests) {
        await client.query(
          `INSERT INTO user_quests
           (user_id, quest_type, template_id, faction_id, quest_data, target_amount, progress, status, free_rerolls)
           VALUES ($1, $2, $3, $4, $5, $6, 0, 'active', $7)`,
          [userId, questType, q.templateId, q.faction,
           JSON.stringify(q), q.targetAmount,
           this._questsCfg()[questType]?.freeRerolls || 0]
        );
      }

      // Update refresh timestamp
      await client.query(
        `INSERT INTO user_quest_refresh (user_id, quest_type, last_refresh)
         VALUES ($1, $2, NOW())
         ON CONFLICT (user_id, quest_type) DO UPDATE SET last_refresh = NOW()`,
        [userId, questType]
      );
    });

    logger.info({ userId, questType, count: quests.length }, 'Quests refreshed');
  }

  // ── Special quest check ─────────────────────────────────────────────────────
  // Special quest replaces one weekly quest slot. It uses weekly-tier templates
  // but with higher amounts (×1.3) and higher rewards (×1.1).
  async _checkSpecialQuest(userId, userLevel) {
    const qCfg = this._questsCfg();

    // Already have a special? Skip.
    const existing = await query(
      `SELECT id FROM user_quests
       WHERE user_id = $1 AND quest_type = 'special' AND status = 'active'`,
      [userId]
    );
    if (existing.rows.length >= qCfg.special.maxActive) return;

    // Roll chance
    if (Math.random() * 100 >= qCfg.special.baseChancePercent) return;

    // Must have at least one weekly quest to replace
    const weeklyQuests = await query(
      `SELECT id FROM user_quests
       WHERE user_id = $1 AND quest_type = 'weekly' AND status = 'active'
       ORDER BY random() LIMIT 1`,
      [userId]
    );
    if (!weeklyQuests.rows.length) return;

    // Generate from weekly templates (special is a harder weekly)
    const quests = await this.generateQuests(userId, 'weekly', userLevel);
    if (quests.length === 0) return;

    const q = quests[0];
    q.questType = 'special'; // Mark as special

    // Apply special multipliers: harder amounts, better rewards
    const amountMult = qCfg.special.amountMultiplier || 1.3;
    const rewardMult = qCfg.special.rewardMultiplier || 1.1;
    q.targetAmount = Math.max(1, Math.ceil(q.targetAmount * amountMult));
    q.rewardCredits = Math.round(q.rewardCredits * rewardMult);
    q.rewardXp = Math.round(q.rewardXp * rewardMult);
    q.reputationGain = Math.round(q.reputationGain * rewardMult);

    // Update description to reflect new amount
    if (q.type === 'expeditions') {
      q.descRu = `Завершите ${q.targetAmount} экспедиций`;
      q.descEn = `Complete ${q.targetAmount} expeditions`;
    } else if (q.type === 'deliver_object' || q.type === 'sell_object' || q.type === 'find_object') {
      const ACTION_RU = { deliver_object: 'Доставьте', sell_object: 'Продайте', find_object: 'Найдите' };
      const ACTION_EN = { deliver_object: 'Deliver', sell_object: 'Sell', find_object: 'Find' };
      const RARITY_RU = { common: 'Обычн.', rare: 'Редк.', epic: 'Эпич.', legendary: 'Легенд.', mythical: 'Мифич.' };
      const RARITY_EN = { common: 'Common', rare: 'Rare', epic: 'Epic', legendary: 'Legendary', mythical: 'Mythical' };
      const TYPE_RU = { debris: 'обломки', artifact: 'артефакты', creature: 'существ', anomaly: 'аномалии' };
      const TYPE_EN = { debris: 'debris', artifact: 'artifacts', creature: 'creatures', anomaly: 'anomalies' };
      const actRu = ACTION_RU[q.type] || '';
      const actEn = ACTION_EN[q.type] || '';
      const rarPart = q.targetRarity ? `${RARITY_RU[q.targetRarity] || ''} ` : '';
      const rarPartEn = q.targetRarity ? `${RARITY_EN[q.targetRarity] || ''} ` : '';
      if (q.targetType) {
        q.descRu = `${actRu} ${rarPart}${TYPE_RU[q.targetType] || q.targetType} × ${q.targetAmount}`;
        q.descEn = `${actEn} ${rarPartEn}${TYPE_EN[q.targetType] || q.targetType} × ${q.targetAmount}`;
      } else {
        q.descRu = `${actRu} ${rarPart}предметы × ${q.targetAmount}`;
        q.descEn = `${actEn} ${rarPartEn}items × ${q.targetAmount}`;
      }
    }

    // Replace the weekly quest with special
    const weeklyId = weeklyQuests.rows[0].id;
    await query(
      `UPDATE user_quests
       SET quest_type = 'special', template_id = $2, faction_id = $3,
           quest_data = $4, target_amount = $5, progress = 0, status = 'active', free_rerolls = 0
       WHERE id = $1`,
      [weeklyId, q.templateId, q.faction, JSON.stringify(q), q.targetAmount]
    );
    logger.info({ userId, templateId: q.templateId, replacedWeekly: weeklyId }, 'Special quest replaced weekly');
  }

  // ── Get all quests for user ─────────────────────────────────────────────────
  async getQuests(userId, userLevel, universe = 1) {
    await this.refreshIfNeeded(userId, userLevel, universe);

    const rows = await query(
      `SELECT * FROM user_quests
       WHERE user_id = $1 AND status IN ('active', 'completed', 'claimed')
       ORDER BY quest_type, created_at`,
      [userId]
    );
    return rows.rows.map(r => ({
      id: r.id,
      questType: r.quest_type,
      templateId: r.template_id,
      factionId: r.faction_id,
      data: r.quest_data,
      targetAmount: r.target_amount,
      progress: r.progress,
      status: r.status,
      freeRerolls: r.free_rerolls,
      createdAt: r.created_at,
    }));
  }

  // ── Track quest progress ────────────────────────────────────────────────────
  async trackProgress(userId, eventType, eventData) {
    // eventType: 'find', 'sell', 'expedition_complete'
    // eventData: { findType, rarity, amount, creditsGained }
    const activeQuests = await query(
      `SELECT * FROM user_quests
       WHERE user_id = $1 AND status = 'active'`,
      [userId]
    );

    for (const quest of activeQuests.rows) {
      const qd = quest.quest_data;
      let increment = 0;

      switch (qd.type) {
        case 'find_object':
          // Only 'find' event — counts when item is discovered (even if cargo full)
          if (eventType === 'find') {
            if (this._matchesTarget(qd, eventData)) {
              increment = eventData.amount || 1;
            }
          }
          break;

        case 'deliver_object':
          // Manual delivery only — tracked via deliverQuestItems(), not auto events
          break;

        case 'sell_object':
          // Manual sell via quest — tracked via sellQuestItems(), not auto sell
          break;

        case 'expeditions':
          if (eventType === 'expedition_complete') {
            increment = 1;
          }
          break;

        case 'speedups':
          if (eventType === 'speedup') {
            increment = eventData.amount || 1;
          }
          break;

        case 'blitz_complete':
          if (eventType === 'blitz_complete') {
            increment = 1;
          }
          break;

        case 'pirate_encounter':
          if (eventType === 'pirate_encounter') {
            increment = 1;
          }
          break;

        // discover_rarity removed — use find_object instead
      }

      if (increment > 0) {
        const newProgress = Math.min(quest.progress + increment, quest.target_amount);
        const newStatus = newProgress >= quest.target_amount ? 'completed' : 'active';
        await query(
          `UPDATE user_quests SET progress = $1, status = $2 WHERE id = $3`,
          [newProgress, newStatus, quest.id]
        );
      }
    }
  }

  _matchesTarget(qd, eventData) {
    if (qd.targetType && eventData.findType !== qd.targetType) return false;
    if (qd.targetRarity) {
      return this._rarityAtLeast(eventData.rarity, qd.targetRarity);
    }
    return true;
  }

  _matchesRarity(qd, eventData) {
    if (!qd.targetRarity) return true;
    return this._rarityAtLeast(eventData.rarity, qd.targetRarity);
  }

  _rarityAtLeast(actual, required) {
    const u2Order = ['exotic', 'ancient', 'relic', 'hybrid', 'singularity'];
    if (u2Order.includes(actual) || u2Order.includes(required)) {
      return u2Order.indexOf(actual) >= u2Order.indexOf(required);
    }
    const u1Order = ['common', 'rare', 'epic', 'legendary', 'mythical'];
    return u1Order.indexOf(actual) >= u1Order.indexOf(required);
  }

  // ── Average price lookup (credits for U1, crystals for U2 types) ──────────
  _getAveragePrice(findType, rarity) {
    const U2_RARITIES = new Set(['exotic', 'ancient', 'relic', 'hybrid', 'singularity']);

    if (U2_RARITIES.has(rarity)) {
      // U2 crystal prices by find type + rarity
      const U2_CRYSTAL_BASE = {
        echo:     { exotic: 28, ancient: 68, relic: 155, hybrid: 370, singularity: 980 },
        relic:    { exotic: 32, ancient: 75, relic: 170, hybrid: 410, singularity: 1150 },
        entity:   { exotic: 24, ancient: 60, relic: 140, hybrid: 330, singularity: 870 },
        rift:     { exotic: 28, ancient: 68, relic: 160, hybrid: 380, singularity: 1050 },
        asteroid: { exotic: 18, ancient: 48, relic: 115, hybrid: 260, singularity: 720 },
      };
      const u2RarityConfig = this.cfg.get('universe2')?.rarity || {};
      const u2Mult = u2RarityConfig[rarity]?.priceMultiplier || 1.0;
      const base = U2_CRYSTAL_BASE[findType]?.[rarity] || 28;
      return Math.round(base * u2Mult);
    }

    // U1 credit prices
    const rarityConfig = this.cfg.get('rarity') || {};
    const rarityMult = rarityConfig[rarity]?.priceMultiplier || 1.0;
    const AVG_BASE_PRICES = {
      debris:   { common: 30, rare: 40, epic: 75, legendary: 155, mythical: 400 },
      artifact: { common: 35, rare: 45, epic: 80, legendary: 165, mythical: 430 },
      creature: { common: 25, rare: 35, epic: 65, legendary: 130, mythical: 160 },
      anomaly:  { common: 30, rare: 40, epic: 80, legendary: 168, mythical: 430 },
    };
    const base = AVG_BASE_PRICES[findType]?.[rarity] || 50;
    return Math.round(base * rarityMult);
  }

  // ── Calculate dynamic credit/crystal reward based on quest type ──────────
  _calculateDynamicCredits(tmpl, targetAmount, targetRarity) {
    const rarity = targetRarity || 'common';
    const findType = tmpl.targetType || 'debris';

    // Haulers deliver U1 items but pay in crystals at special inter-universe rates
    if (tmpl.faction === 'haulers') {
      const HAULER_RATES = {
        creature: { common: 1.5, rare: 4.5, epic: 12, legendary: 32, mythical: 90 },
        artifact: { common: 2.0, rare: 5.0, epic: 14, legendary: 36, mythical: 100 },
        debris:   { common: 1.0, rare: 3.0, epic: 9,  legendary: 24, mythical: 70 },
        anomaly:  { common: 1.5, rare: 4.5, epic: 12, legendary: 32, mythical: 90 },
      };
      const rate = HAULER_RATES[findType]?.[rarity] || 2;
      return Math.round(rate * targetAmount * 1.2);
    }

    const avgPrice = this._getAveragePrice(findType, rarity);

    switch (tmpl.type) {
      case 'deliver_object':
        // Average price × 1.2 per item (items are taken away)
        return Math.round(avgPrice * targetAmount * 1.2);
      case 'sell_object':
        // 25% of average price per item (player keeps sell revenue)
        return Math.round(avgPrice * targetAmount * 0.25);
      case 'find_object':
        // 10% of average price per item
        return Math.round(avgPrice * targetAmount * 0.10);
      case 'expeditions':
        // 20 credits per expedition
        return Math.round(20 * targetAmount);
      default:
        return null;
    }
  }

  // ── Deliver items from inventory to complete quest ──────────────────────
  async deliverQuestItems(userId, questId, itemIds) {
    return await withTransaction(async (client) => {
      const res = await client.query(
        `SELECT * FROM user_quests WHERE id = $1 AND user_id = $2 FOR UPDATE`,
        [questId, userId]
      );
      if (!res.rows.length) return { error: 'Quest not found' };
      const quest = res.rows[0];
      if (quest.status !== 'active') return { error: 'Quest not active' };
      const qd = quest.quest_data;
      if (qd.type !== 'deliver_object') return { error: 'Quest type is not deliver' };

      const remaining = quest.target_amount - quest.progress;
      const toDeliver = Math.min(itemIds.length, remaining);

      if (toDeliver === 0) return { error: 'Nothing to deliver' };

      const requiredTypes = Array.isArray(qd.targetTypes) && qd.targetTypes.length > 0 ? new Set(qd.targetTypes) : null;
      const deliveredTypes = new Set();

      // Validate items exist in inventory and match quest requirements
      let delivered = 0;
      for (let i = 0; i < toDeliver; i++) {
        const itemId = itemIds[i];
        const item = await client.query(
          `SELECT id, find_type, rarity, object_data, status FROM inventory_items
           WHERE id = $1 AND user_id = $2 AND status = 'in_inventory' FOR UPDATE`,
          [itemId, userId]
        );
        if (!item.rows.length) continue;
        const it = item.rows[0];

        // Check type and exact rarity match (per-rarity templates — no substitution allowed)
  if (requiredTypes && !requiredTypes.has(it.find_type)) continue;
  if (requiredTypes && deliveredTypes.has(it.find_type)) continue;
        if (qd.targetType && it.find_type !== qd.targetType) continue;
        if (qd.targetRarity && it.rarity !== qd.targetRarity) continue;

        // Remove item from inventory (delivered to faction — uses 'sold' status)
        await client.query(
          `UPDATE inventory_items SET status = 'sold', sold_at = NOW(), sold_for = 0 WHERE id = $1`,
          [itemId]
        );
        delivered++;
        if (requiredTypes) deliveredTypes.add(it.find_type);
      }

      if (delivered === 0) return { error: 'No matching items found in inventory' };

      if (requiredTypes && deliveredTypes.size < requiredTypes.size) {
        return { error: 'Need one item of each required type' };
      }

      const newProgress = Math.min(quest.progress + delivered, quest.target_amount);
      const newStatus = newProgress >= quest.target_amount ? 'completed' : 'active';
      await client.query(
        `UPDATE user_quests SET progress = $1, status = $2 WHERE id = $3`,
        [newProgress, newStatus, quest.id]
      );

      return { delivered, progress: newProgress, targetAmount: quest.target_amount, status: newStatus };
    });
  }

  // ── Sell items through quest (market price + quest bonus) ───────────────
  async sellQuestItems(userId, questId, itemIds) {
    return await withTransaction(async (client) => {
      const res = await client.query(
        `SELECT * FROM user_quests WHERE id = $1 AND user_id = $2 FOR UPDATE`,
        [questId, userId]
      );
      if (!res.rows.length) return { error: 'Quest not found' };
      const quest = res.rows[0];
      if (quest.status !== 'active') return { error: 'Quest not active' };
      const qd = quest.quest_data;
      if (qd.type !== 'sell_object') return { error: 'Quest type is not sell' };

      const remaining = quest.target_amount - quest.progress;
      const toSell = Math.min(itemIds.length, remaining);
      if (toSell === 0) return { error: 'Nothing to sell' };

      const rarityConfig = this.cfg.get('rarity') || {};
      const u2RarityConfig = this.cfg.get('universe2')?.rarity || {};
      const user = await client.query('SELECT credits, crystals FROM users WHERE id = $1 FOR UPDATE', [userId]);
      if (!user.rows.length) return { error: 'User not found' };
      let totalCredits = 0;
      let totalCrystals = 0;
      let sold = 0;

      const U2_SELL_TYPES = new Set(['echo', 'entity', 'rift', 'asteroid', 'relic']);
      const U2_SELL_BASE = {
        echo:     { exotic: 28, ancient: 68, relic: 155, hybrid: 370, singularity: 980 },
        relic:    { exotic: 32, ancient: 75, relic: 170, hybrid: 410, singularity: 1150 },
        entity:   { exotic: 24, ancient: 60, relic: 140, hybrid: 330, singularity: 870 },
        rift:     { exotic: 28, ancient: 68, relic: 160, hybrid: 380, singularity: 1050 },
        asteroid: { exotic: 18, ancient: 48, relic: 115, hybrid: 260, singularity: 720 },
      };

      for (let i = 0; i < toSell; i++) {
        const itemId = itemIds[i];
        const item = await client.query(
          `SELECT ii.id, ii.find_type, ii.rarity, ii.object_data, ii.status,
                  er.base_credits
           FROM inventory_items ii
           LEFT JOIN expedition_results er ON er.id = ii.result_id
           WHERE ii.id = $1 AND ii.user_id = $2 AND ii.status = 'in_inventory'
           FOR UPDATE OF ii`,
          [itemId, userId]
        );
        if (!item.rows.length) continue;
        const it = item.rows[0];

        if (qd.targetType && it.find_type !== qd.targetType) continue;
        if (qd.targetRarity && it.rarity !== qd.targetRarity) continue;

        const isU2Item = U2_SELL_TYPES.has(it.find_type);
        let sellPrice;
        if (isU2Item) {
          const u2Mult = u2RarityConfig[it.rarity]?.priceMultiplier || 1.0;
          const u2Base = U2_SELL_BASE[it.find_type]?.[it.rarity] || 24;
          sellPrice = Math.round(u2Base * u2Mult * 0.25);
        } else {
          const baseCredits = Number(it.base_credits || 0);
          const rarityMult = rarityConfig[it.rarity]?.priceMultiplier || 1.0;
          sellPrice = Math.round(baseCredits * rarityMult);
        }

        await client.query(
          `UPDATE inventory_items SET status = 'sold', sold_at = NOW(), sold_for = $1 WHERE id = $2`,
          [sellPrice, itemId]
        );
        if (isU2Item) totalCrystals += sellPrice;
        else totalCredits += sellPrice;
        sold++;
      }

      if (sold === 0) return { error: 'No matching items found in inventory' };

      if (totalCrystals > 0) {
        await client.query('UPDATE users SET crystals = crystals + $1 WHERE id = $2', [totalCrystals, userId]);
      }
      if (totalCredits > 0) {
        await client.query('UPDATE users SET credits = credits + $1 WHERE id = $2', [totalCredits, userId]);
      }

      const newProgress = Math.min(quest.progress + sold, quest.target_amount);
      const newStatus = newProgress >= quest.target_amount ? 'completed' : 'active';
      await client.query(
        `UPDATE user_quests SET progress = $1, status = $2 WHERE id = $3`,
        [newProgress, newStatus, quest.id]
      );

      return {
        sold,
        creditsGained: totalCredits,
        crystalsGained: totalCrystals,
        progress: newProgress,
        targetAmount: quest.target_amount,
        status: newStatus,
      };
    });
  }

  // ── Get matching inventory items for a quest ────────────────────────────
  async getQuestItems(userId, questId) {
    const res = await query(
      'SELECT * FROM user_quests WHERE id = $1 AND user_id = $2',
      [questId, userId]
    );
    if (!res.rows.length) return { error: 'Quest not found' };
    const quest = res.rows[0];
    const qd = quest.quest_data;

    if (qd.type !== 'deliver_object' && qd.type !== 'sell_object') {
      return { error: 'Quest type does not require items' };
    }

    let sql = `SELECT id, find_type, rarity, object_data, acquired_at
               FROM inventory_items WHERE user_id = $1 AND status = 'in_inventory'`;
    const params = [userId];

    if (qd.targetType) {
      sql += ` AND find_type = $${params.length + 1}`;
      params.push(qd.targetType);
    } else if (Array.isArray(qd.targetTypes) && qd.targetTypes.length > 0) {
      sql += ` AND find_type = ANY($${params.length + 1})`;
      params.push(qd.targetTypes);
    }

    if (qd.targetRarity) {
      // Exact rarity match — per-rarity templates require precise items, not "this rarity or better"
      sql += ` AND rarity = $${params.length + 1}`;
      params.push(qd.targetRarity);
    }

    sql += ' ORDER BY acquired_at DESC LIMIT 50';
    const items = await query(sql, params);
    const remaining = quest.target_amount - quest.progress;

    return { items: items.rows, remaining, questType: qd.type };
  }

  // ── Claim quest reward ──────────────────────────────────────────────────────
  async claimQuest(userId, questId) {
    return await withTransaction(async (client) => {
      const res = await client.query(
        `SELECT * FROM user_quests WHERE id = $1 AND user_id = $2 FOR UPDATE`,
        [questId, userId]
      );
      if (!res.rows.length) return { error: 'Quest not found' };
      const quest = res.rows[0];

      if (quest.status === 'claimed') return { error: 'Already claimed' };
      if (quest.status !== 'completed') return { error: 'Quest not completed' };

      const qd = quest.quest_data;
      // Rewards are baked at generation time with the rep multiplier already applied.
      const credits = qd.rewardCredits || 0;
      const crystals = qd.rewardCrystals || 0;
      const xp = qd.rewardXp;
      const stars = qd.rewardStars || 0;
      const repGain = qd.reputationGain || 0;

      // Update user credits/crystals + XP
      const user = await client.query(
        'SELECT credits, crystals, xp, level, stars_balance FROM users WHERE id = $1 FOR UPDATE',
        [userId]
      );
      if (!user.rows.length) return { error: 'User not found' };
      const u = user.rows[0];

      // Calculate new level after XP gain
      const newXP = BigInt(u.xp) + BigInt(xp);
      const config = this.cfg.config;
      const levelTable = config.xp.levelTable;
      let newLevel = u.level;
      for (const entry of levelTable) {
        if (Number(newXP) >= entry.xpRequired) newLevel = entry.level;
      }

      if (crystals > 0) {
        await client.query(
          `UPDATE users SET crystals = crystals + $1, xp = $2, level = $3 WHERE id = $4`,
          [crystals, newXP, newLevel, userId]
        );
      } else {
        await client.query(
          `UPDATE users SET credits = credits + $1, xp = $2, level = $3 WHERE id = $4`,
          [credits, newXP, newLevel, userId]
        );
      }

      // Stars reward
      if (stars > 0) {
        await client.query(
          `UPDATE users SET stars_balance = stars_balance + $1 WHERE id = $2`,
          [stars, userId]
        );
        const starsBefore = Number(u.stars_balance || 0);
        await client.query(
          `INSERT INTO stars_transactions (user_id, type, amount, balance_before, balance_after, description)
           VALUES ($1, 'quest_reward', $2, $3, $4, $5)`,
          [userId, stars, starsBefore, starsBefore + stars, `Quest reward: ${quest.template_id}`]
        );
      }

      // Reputation change
      if (repGain > 0) {
        await this._changeReputation(client, userId, quest.faction_id, repGain);

        // Apply faction conflicts
        const conflicts = this._factionsCfg().conflicts.filter(c => c.source === quest.faction_id);
        for (const conflict of conflicts) {
          const loss = Math.round(repGain * conflict.ratio);
          if (loss !== 0) {
            await this._changeReputation(client, userId, conflict.target, loss);
          }
        }
      }

      // Apply quest-specific reputation penalties from template
      const penalties = qd.reputationPenalties || [];
      for (const penalty of penalties) {
        if (penalty.factionId && penalty.amount) {
          await this._changeReputation(client, userId, penalty.factionId, -Math.abs(penalty.amount));
        }
      }

      // One-time story item reward (for story quests)
      let storyItemReward = null;
      if (quest.quest_type === 'story' && qd.storyRewardItem?.key && qd.storyRewardItem?.data) {
        // Consume required story item before granting reward (e.g. divine_shard → exhibition_pass)
        if (qd.consumeStoryItem) {
          await client.query(
            `DELETE FROM user_story_items WHERE user_id = $1 AND item_key = $2`,
            [userId, qd.consumeStoryItem]
          );
        }
        await client.query(
          `INSERT INTO user_story_items (user_id, item_key, item_data)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_id, item_key) DO NOTHING`,
          [userId, qd.storyRewardItem.key, JSON.stringify(qd.storyRewardItem.data)]
        );
        storyItemReward = {
          key: qd.storyRewardItem.key,
          ...qd.storyRewardItem.data,
        };
      }

      if (quest.quest_type === 'story' && qd.type === 'spend_resources') {
        const spendCredits = Number(qd.requiredCredits || 0);
        const spendCrystals = Number(qd.requiredCrystals || 0);
        if (spendCredits > 0 || spendCrystals > 0) {
          const userBalance = await client.query(
            'SELECT credits, crystals FROM users WHERE id = $1 FOR UPDATE',
            [userId]
          );
          const balanceRow = userBalance.rows[0] || {};
          const currentCredits = Number(balanceRow.credits || 0);
          const currentCrystals = Number(balanceRow.crystals || 0);
          if (currentCredits < spendCredits || currentCrystals < spendCrystals) {
            return { error: 'Not enough resources', requiredCredits: spendCredits, requiredCrystals: spendCrystals };
          }
          await client.query(
            'UPDATE users SET credits = credits - $1, crystals = crystals - $2 WHERE id = $3',
            [spendCredits, spendCrystals, userId]
          );
        }
      }

      // Item reward check (special quests only, low chance)
      let itemReward = null;
      if (quest.quest_type === 'special') {
        itemReward = await this._tryItemReward(client, userId);
      }

      let repeatableReactivated = false;
      if (quest.quest_type === 'repeatable') {
        // Endless completion loop: immediately reopen after claim.
        await client.query(
          `UPDATE user_quests
           SET progress = 0, status = 'active', claimed_at = NULL
           WHERE id = $1`,
          [questId]
        );
        repeatableReactivated = true;
      } else {
        // Mark claimed for regular quest types.
        await client.query(
          `UPDATE user_quests SET status = 'claimed', claimed_at = NOW() WHERE id = $1`,
          [questId]
        );
      }

      logger.info({ userId, questId, credits, crystals, xp, stars, repGain }, 'Quest claimed');
      return {
        claimed: true,
        credits,
        crystals,
        xp,
        stars,
        newXP:   Number(newXP),
        newLevel,
        repeatableReactivated,
        reputationGain: repGain,
        reputationPenalties: penalties,
        itemReward,
        storyItemReward,
        multiplier: 1.0,
      };
    });
  }

  // ── Buyout quest (complete without items) ───────────────────────────────────
  async buyoutQuest(userId, questId) {
    const bCfg = this._questsCfg().buyout;
    if (!bCfg.enabled) return { error: 'Buyout disabled' };

    return await withTransaction(async (client) => {
      const res = await client.query(
        `SELECT * FROM user_quests WHERE id = $1 AND user_id = $2 FOR UPDATE`,
        [questId, userId]
      );
      if (!res.rows.length) return { error: 'Quest not found' };
      const quest = res.rows[0];

      if (!bCfg.allowedTypes.includes(quest.quest_type)) {
        return { error: 'Only daily quests can be bought out' };
      }
      if (quest.quest_type === 'repeatable') {
        return { error: 'Repeatable quests cannot be bought out' };
      }
      if (quest.status !== 'active') return { error: 'Quest not active' };

      // Check daily buyout limit
      const todayBuyouts = await client.query(
        `SELECT COUNT(*) as cnt FROM user_quests
         WHERE user_id = $1 AND bought_out = true AND bought_out_at::date = CURRENT_DATE`,
        [userId]
      );
      if (Number(todayBuyouts.rows[0].cnt) >= bCfg.maxPerDay) {
        return { error: 'Buyout limit reached for today' };
      }

      // Calculate cost
      const qd = quest.quest_data;
      const remaining = quest.target_amount - quest.progress;
      const isU2Quest = (qd.rewardCrystals || 0) > 0;
      const rewardValue = isU2Quest ? (qd.rewardCrystals || 0) : (qd.rewardCredits || 0);
      const cost = Math.ceil(remaining * rewardValue * bCfg.costMultiplier / quest.target_amount);

      // Check user balance
      const user = await client.query(
        'SELECT credits, crystals FROM users WHERE id = $1 FOR UPDATE',
        [userId]
      );
      const balance = isU2Quest
        ? Number(user.rows[0].crystals)
        : Number(user.rows[0].credits);
      if (balance < cost) {
        return { error: isU2Quest ? 'Not enough crystals' : 'Not enough credits', cost };
      }

      // Deduct and complete
      if (isU2Quest) {
        await client.query('UPDATE users SET crystals = crystals - $1 WHERE id = $2', [cost, userId]);
      } else {
        await client.query('UPDATE users SET credits = credits - $1 WHERE id = $2', [cost, userId]);
      }
      await client.query(
        `UPDATE user_quests SET progress = target_amount, status = 'completed',
         bought_out = true, bought_out_at = NOW() WHERE id = $1`,
        [questId]
      );

      return { boughtOut: true, cost };
    });
  }

  // ── Reroll quest ────────────────────────────────────────────────────────────
  async rerollQuest(userId, questId, userLevel, universe = 1) {
    return await withTransaction(async (client) => {
      const res = await client.query(
        `SELECT * FROM user_quests WHERE id = $1 AND user_id = $2 FOR UPDATE`,
        [questId, userId]
      );
      if (!res.rows.length) return { error: 'Quest not found' };
      const quest = res.rows[0];
      if (quest.status !== 'active') return { error: 'Quest not active' };
      if (quest.quest_type === 'repeatable') return { error: 'Repeatable quests cannot be rerolled' };
      if (quest.free_rerolls <= 0) return { error: 'No free rerolls left' };

      const keepFaction = quest.faction_id;

      // Generate candidates from ALL factions, then prefer same-faction templates
      const quests = await this.generateQuests(userId, quest.quest_type, userLevel, universe);
      if (quests.length === 0) return { error: 'No templates available' };

      // Pick a quest of the same faction, preferring a different template
      const sameFaction = quests.filter(q => q.faction === keepFaction);
      const pool = sameFaction.length > 0 ? sameFaction : quests;
      const newQ = pool.find(q => q.templateId !== quest.template_id) || pool[0];

      // Force the faction to match the original even if template came from elsewhere
      newQ.faction = keepFaction;

      await client.query(
        `UPDATE user_quests SET
         template_id = $1, faction_id = $2, quest_data = $3,
         target_amount = $4, progress = 0, free_rerolls = free_rerolls - 1
         WHERE id = $5`,
        [newQ.templateId, keepFaction, JSON.stringify(newQ), newQ.targetAmount, questId]
      );

      return { rerolled: true, quest: newQ };
    });
  }

  // ── Reputation change ───────────────────────────────────────────────────────
  async _changeReputation(client, userId, factionId, amount) {
    const cfg = this._factionsCfg();
    await client.query(
      `INSERT INTO user_faction_reputation (user_id, faction_id, reputation)
       VALUES ($1, $2, GREATEST($3::int, $4::int))
       ON CONFLICT (user_id, faction_id)
       DO UPDATE SET reputation = GREATEST($4::int, LEAST($5::int,
         user_faction_reputation.reputation + $3::int
       ))`,
      [userId, factionId, amount, cfg.minReputation, cfg.maxReputation]
    );
  }

  // ── Daily reputation decay ──────────────────────────────────────────────────
  async processReputationDecay() {
    const cfg = this._factionsCfg();
    if (!cfg.decayAmount || !cfg.decayThreshold) return;

    await query(
      `UPDATE user_faction_reputation
       SET reputation = reputation - $1
       WHERE reputation > $2`,
      [cfg.decayAmount, cfg.decayThreshold]
    );
  }

  // ── Try item reward (special quests) ────────────────────────────────────────
  async _tryItemReward(client, userId) {
    const items = this._questsCfg().itemRewards;
    if (!items || items.length === 0) return null;

    for (const item of items) {
      if (Math.random() >= item.chance) continue;

      // Check if user already has this item
      const existing = await client.query(
        `SELECT id FROM user_quest_items WHERE user_id = $1 AND item_id = $2`,
        [userId, item.id]
      );
      if (existing.rows.length > 0) {
        // Compensate with credits instead
        const comp = this._questsCfg().itemCompensationCredits;
        await client.query('UPDATE users SET credits = credits + $1 WHERE id = $2', [comp, userId]);
        return { compensation: true, credits: comp, itemName: item.nameRu };
      }

      // Grant item
      await client.query(
        `INSERT INTO user_quest_items (user_id, item_id, item_data) VALUES ($1, $2, $3)`,
        [userId, item.id, JSON.stringify(item)]
      );
      return { item: item.id, nameRu: item.nameRu, nameEn: item.nameEn, icon: item.icon };
    }
    return null;
  }

  // ── Smuggler: exchange credits for stars ────────────────────────────────────
  async smugglerExchange(userId) {
    const sCfg = this._questsCfg().smuggler;
    const reps = await this.getReputations(userId);
    const bmRep = reps[sCfg.factionId] || 0;

    if (bmRep < sCfg.minReputation) {
      return { error: 'Not enough Black Market reputation', required: sCfg.minReputation, current: bmRep };
    }

    return await withTransaction(async (client) => {
      // Check weekly limit
      const weekExchanges = await client.query(
        `SELECT COALESCE(SUM(stars), 0) as total FROM smuggler_exchanges
         WHERE user_id = $1 AND created_at > NOW() - INTERVAL '7 days'`,
        [userId]
      );
      const weekTotal = Number(weekExchanges.rows[0].total);
      if (weekTotal >= sCfg.maxStarsPerWeek) {
        return { error: 'Weekly star limit reached', limit: sCfg.maxStarsPerWeek, used: weekTotal };
      }

      // Check balance
      const user = await client.query(
        'SELECT credits, stars_balance FROM users WHERE id = $1 FOR UPDATE',
        [userId]
      );
      if (!user.rows.length) return { error: 'User not found' };
      const credits = Number(user.rows[0].credits);
      if (credits < sCfg.creditsPerStar) {
        return { error: 'Not enough credits', cost: sCfg.creditsPerStar, balance: credits };
      }

      // Exchange 1 star
      await client.query(
        'UPDATE users SET credits = credits - $1, stars_balance = stars_balance + 1 WHERE id = $2',
        [sCfg.creditsPerStar, userId]
      );
      await client.query(
        `INSERT INTO smuggler_exchanges (user_id, credits_spent, stars) VALUES ($1, $2, 1)`,
        [userId, sCfg.creditsPerStar]
      );

      return {
        exchanged: true,
        creditsSpent: sCfg.creditsPerStar,
        starsReceived: 1,
        weeklyUsed: weekTotal + 1,
        weeklyLimit: sCfg.maxStarsPerWeek,
      };
    });
  }

  // ── Full dashboard data ─────────────────────────────────────────────────────
  async getDashboard(userId, userLevel, universe = 1) {
    const [quests, reputations] = await Promise.all([
      this.getQuests(userId, userLevel, universe),
      this.getReputations(userId),
    ]);

    const cfg = this._factionsCfg();
    const qCfg = this._questsCfg();

    // Collect faction IDs visible in the current universe for quest filtering
    const universeFactionIds = new Set(
      cfg.list
        .filter(f => (f.universe || 1) === universe)
        .map(f => f.id)
    );

    // Filter quests to only show those belonging to the current universe's factions
    const filteredQuests = quests.filter(q => universeFactionIds.has(q.factionId));

    const factions = this.getActiveFactions(userLevel, universe).map(f => ({
      ...f,
      reputation: reputations[f.id] || 0,
      tier: this.getReputationTier(reputations[f.id] || 0),
      multiplier: this.getReputationMultiplier(reputations[f.id] || 0),
    }));

    // Next refresh times
    const refreshes = await query(
      `SELECT quest_type, last_refresh FROM user_quest_refresh WHERE user_id = $1`,
      [userId]
    );
    const timers = {};
    for (const r of refreshes.rows) {
      const cfg2 = qCfg[r.quest_type];
      if (cfg2) {
        const next = new Date(new Date(r.last_refresh).getTime() + cfg2.refreshHours * 3600000);
        timers[r.quest_type] = next.toISOString();
      }
    }

    // Smuggler info (U1 only — replaced by Haulers in U2)
    const sCfg = qCfg.smuggler;
    const bmRep = reputations[sCfg.factionId] || 0;
    let smuggler = null;
    if (universe === 1 && userLevel >= 20) {
      const weekExchanges = await query(
        `SELECT COALESCE(SUM(stars), 0) as total FROM smuggler_exchanges
         WHERE user_id = $1 AND created_at > NOW() - INTERVAL '7 days'`,
        [userId]
      );
      smuggler = {
        available: bmRep >= sCfg.minReputation,
        creditsPerStar: sCfg.creditsPerStar,
        weeklyUsed: Number(weekExchanges.rows[0].total),
        weeklyLimit: sCfg.maxStarsPerWeek,
        requiredReputation: sCfg.minReputation,
        currentReputation: bmRep,
      };
    }

    // Quest items owned
    const items = await query(
      'SELECT item_id, item_data FROM user_quest_items WHERE user_id = $1',
      [userId]
    );

    return {
      factions,
      quests: filteredQuests,
      timers,
      smuggler,
      items: items.rows.map(r => ({ id: r.item_id, ...r.item_data })),
      universe,
    };
  }
}

module.exports = QuestService;
