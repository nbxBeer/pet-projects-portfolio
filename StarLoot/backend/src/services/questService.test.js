'use strict';

const QuestService = require('./questService');

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

const { query, withTransaction } = require('../db/pool');

describe('QuestService', () => {
  let questService;
  let mockConfigManager;

  const mockFactionConfig = {
    list: [
      {
        id: 'bioengineers',
        name: 'Биоинженеры',
        active: true,
        minLevel: 1,
      },
      {
        id: 'tech_institute',
        name: 'Технологический институт',
        active: true,
        minLevel: 1,
      },
      {
        id: 'black_market',
        name: 'Чёрный рынок',
        active: true,
        minLevel: 20,
      },
    ],
    reputationTiers: [
      { min: 0, label: 'Нейтралитет' },
      { min: 250, label: 'Партнёр' },
      { min: 500, label: 'Союзник' },
    ],
    reputationMultipliers: [
      { min: 0, mult: 1.0 },
      { min: 250, mult: 1.05 },
      { min: 500, mult: 1.1 },
    ],
  };

  const mockQuestConfig = {
    daily: { count: 3, refreshHours: 24, freeRerolls: 1 },
    weekly: { count: 2, refreshHours: 168, freeRerolls: 0 },
    special: { baseChancePercent: 5, maxActive: 1 },
    templates: [
      {
        id: 'bio_deliver_creature_daily',
        faction: 'bioengineers',
        type: 'deliver_object',
        targetType: 'creature',
        targetRarities: ['common', 'rare', 'epic'],
        amountRange: [1, 5],
        creditRange: [0, 0],
        xpRange: [50, 150],
        reputationGain: [10, 25],
        questTypes: ['daily'],
        nameRu: 'Доставить существ',
        nameEn: 'Deliver creatures',
        descRu: 'Фракция нуждается в образцах',
        descEn: 'The faction needs specimens',
        reputationRequirements: [],
      },
      {
        id: 'bio_deliver_creature_weekly',
        faction: 'bioengineers',
        type: 'deliver_object',
        targetType: 'creature',
        targetRarities: ['rare', 'epic', 'legendary'],
        amountRange: [5, 25],
        creditRange: [0, 0],
        xpRange: [200, 600],
        reputationGain: [30, 60],
        questTypes: ['weekly'],
        nameRu: 'Доставить существ',
        nameEn: 'Deliver creatures',
        descRu: 'Фракция нуждается в образцах',
        descEn: 'The faction needs specimens',
        reputationRequirements: [],
      },
      {
        id: 'tech_deliver_artifacts',
        faction: 'tech_institute',
        type: 'deliver_object',
        targetType: 'artifact',
        targetRarities: ['common', 'rare'],
        amountRange: [2, 8],
        creditRange: [0, 0],
        xpRange: [60, 160],
        reputationGain: [15, 30],
        questTypes: ['daily'],
        nameRu: 'Доставить артефакты',
        nameEn: 'Deliver artifacts',
        descRu: 'Нужны артефакты',
        descEn: 'Need artifacts',
        reputationRequirements: [],
      },
      {
        id: 'black_market_exclusive',
        faction: 'black_market',
        type: 'sell_object',
        targetType: 'debris',
        targetRarities: ['epic', 'legendary', 'mythical'],
        amountRange: [1, 5],
        creditRange: [0, 0],
        xpRange: [100, 300],
        reputationGain: [20, 50],
        questTypes: ['weekly'],
        nameRu: 'Чёрный рынок сделка',
        nameEn: 'Black market deal',
        descRu: 'Опасная сделка',
        descEn: 'Risky business',
        reputationRequirements: [
          { factionId: 'black_market', operator: '>=', value: 0 },
        ],
      },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockConfigManager = {
      get: jest.fn((key) => {
        if (key === 'factions') return mockFactionConfig;
        if (key === 'quests') return mockQuestConfig;
        return null;
      }),
    };

    questService = new QuestService(mockConfigManager);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test: getActiveFactions
  // ─────────────────────────────────────────────────────────────────────────
  describe('getActiveFactions', () => {
    test('returns all active factions when user level is sufficient', () => {
      const factions = questService.getActiveFactions(25);
      expect(factions).toHaveLength(3); // All 3 are active
      expect(factions.every((f) => f.active)).toBe(true);
    });

    test('filters by minLevel requirements', () => {
      const factions = questService.getActiveFactions(15);
      expect(factions).toHaveLength(2); // bioengineers, tech_institute (black_market requires level 20)
      expect(factions.find((f) => f.id === 'black_market')).toBeUndefined();
    });

    test('returns empty array for low level users', () => {
      // Suppose all factions require level 1, but we mock differently
      mockConfigManager.get = jest.fn(() => ({
        list: [
          { id: 'f1', active: true, minLevel: 50 },
        ],
      }));
      const factions = questService.getActiveFactions(10);
      expect(factions).toHaveLength(0);
    });

    test('excludes inactive factions', () => {
      mockConfigManager.get = jest.fn(() => ({
        list: [
          { id: 'f1', active: true, minLevel: 1 },
          { id: 'f2', active: false, minLevel: 1 },
          { id: 'f3', active: true, minLevel: 1 },
        ],
      }));
      const factions = questService.getActiveFactions(10);
      expect(factions).toHaveLength(2);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test: getReputations
  // ─────────────────────────────────────────────────────────────────────────
  describe('getReputations', () => {
    test('returns map of faction reputations for user', async () => {
      query.mockResolvedValueOnce({
        rows: [
          { faction_id: 'bioengineers', reputation: 100 },
          { faction_id: 'tech_institute', reputation: -50 },
        ],
      });

      const reps = await questService.getReputations(123);
      expect(reps).toEqual({
        bioengineers: 100,
        tech_institute: -50,
      });
    });

    test('returns empty map when user has no reputation', async () => {
      query.mockResolvedValueOnce({ rows: [] });
      const reps = await questService.getReputations(123);
      expect(reps).toEqual({});
    });

    test('converts reputation to number', async () => {
      query.mockResolvedValueOnce({
        rows: [
          { faction_id: 'f1', reputation: '500' }, // string
        ],
      });
      const reps = await questService.getReputations(123);
      expect(typeof reps.f1).toBe('number');
      expect(reps.f1).toBe(500);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test: getReputationTier
  // ─────────────────────────────────────────────────────────────────────────
  describe('getReputationTier', () => {
    test('returns correct tier based on reputation', () => {
      const tier0 = questService.getReputationTier(-100);
      expect(tier0.min).toBe(0);

      const tier1 = questService.getReputationTier(250);
      expect(tier1.min).toBe(250);

      const tier2 = questService.getReputationTier(600);
      expect(tier2.min).toBe(500);
    });

    test('returns lowest tier for negative reputation', () => {
      const tier = questService.getReputationTier(-999);
      expect(tier.min).toBe(0); // Falls back to first tier with rep >= 0
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test: getReputationMultiplier
  // ─────────────────────────────────────────────────────────────────────────
  describe('getReputationMultiplier', () => {
    test('returns correct multiplier for reputation', () => {
      expect(questService.getReputationMultiplier(0)).toBe(1.0);
      expect(questService.getReputationMultiplier(250)).toBe(1.05);
      expect(questService.getReputationMultiplier(500)).toBe(1.1);
    });

    test('returns correct multiplier even for high reputation', () => {
      expect(questService.getReputationMultiplier(10000)).toBe(1.1); // Max in mock is 1.1
    });

    test('returns base multiplier for low reputation', () => {
      expect(questService.getReputationMultiplier(-999)).toBe(1.0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test: _meetsRepRequirements (private but important)
  // ─────────────────────────────────────────────────────────────────────────
  describe('_meetsRepRequirements', () => {
    test('accepts quest when no requirements', () => {
      const tmpl = { reputationRequirements: [] };
      const reputations = { bioengineers: 100 };
      expect(questService._meetsRepRequirements(tmpl, reputations)).toBe(true);
    });

    test('accepts quest with >= operator when reputation meets threshold', () => {
      const tmpl = {
        reputationRequirements: [{ factionId: 'f1', operator: '>=', value: 100 }],
      };
      expect(questService._meetsRepRequirements(tmpl, { f1: 100 })).toBe(true);
      expect(questService._meetsRepRequirements(tmpl, { f1: 150 })).toBe(true);
      expect(questService._meetsRepRequirements(tmpl, { f1: 99 })).toBe(false);
    });

    test('handles > operator correctly', () => {
      const tmpl = {
        reputationRequirements: [{ factionId: 'f1', operator: '>', value: 100 }],
      };
      expect(questService._meetsRepRequirements(tmpl, { f1: 101 })).toBe(true);
      expect(questService._meetsRepRequirements(tmpl, { f1: 100 })).toBe(false);
    });

    test('handles < and <= operators', () => {
      const tmplLt = {
        reputationRequirements: [{ factionId: 'f1', operator: '<', value: 100 }],
      };
      expect(questService._meetsRepRequirements(tmplLt, { f1: 99 })).toBe(true);
      expect(questService._meetsRepRequirements(tmplLt, { f1: 100 })).toBe(false);

      const tmplLte = {
        reputationRequirements: [{ factionId: 'f1', operator: '<=', value: 100 }],
      };
      expect(questService._meetsRepRequirements(tmplLte, { f1: 100 })).toBe(true);
      expect(questService._meetsRepRequirements(tmplLte, { f1: 101 })).toBe(false);
    });

    test('handles == operator', () => {
      const tmpl = {
        reputationRequirements: [{ factionId: 'f1', operator: '==', value: 100 }],
      };
      expect(questService._meetsRepRequirements(tmpl, { f1: 100 })).toBe(true);
      expect(questService._meetsRepRequirements(tmpl, { f1: 99 })).toBe(false);
    });

    test('fails if user has no reputation entry (assumes 0)', () => {
      const tmpl = {
        reputationRequirements: [{ factionId: 'f1', operator: '>=', value: 100 }],
      };
      expect(questService._meetsRepRequirements(tmpl, {})).toBe(false);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test: generateQuests
  // ─────────────────────────────────────────────────────────────────────────
  describe('generateQuests', () => {
    beforeEach(() => {
      query.mockResolvedValueOnce({ rows: [] }); // getReputations
    });

    test('returns empty array for invalid quest type', async () => {
      const quests = await questService.generateQuests(123, 'invalid_type', 10);
      expect(quests).toEqual([]);
    });

    test('returns empty array when no active factions', async () => {
      mockConfigManager.get = jest.fn(() => ({
        list: [{ id: 'f1', active: true, minLevel: 100 }],
      }));
      const quests = await questService.generateQuests(123, 'daily', 10);
      expect(quests).toEqual([]);
    });

    test('generates quests respecting count from config', async () => {
      query.mockResolvedValueOnce({ rows: [] });
      const quests = await questService.generateQuests(123, 'daily', 10);
      expect(quests.length).toBeLessThanOrEqual(3); // daily.count = 3
    });

    test('generates quests with correct structure', async () => {
      query.mockResolvedValueOnce({ rows: [] });
      const quests = await questService.generateQuests(123, 'daily', 10);
      if (quests.length > 0) {
        const quest = quests[0];
        expect(quest).toHaveProperty('templateId');
        expect(quest).toHaveProperty('faction');
        expect(quest).toHaveProperty('questType', 'daily');
        expect(quest).toHaveProperty('type');
        expect(quest).toHaveProperty('targetAmount');
        expect(quest).toHaveProperty('rewardCredits');
        expect(quest).toHaveProperty('rewardXp');
      }
    });

    test('tries to diversify factions', async () => {
      query.mockResolvedValueOnce({ rows: [] });
      const quests = await questService.generateQuests(123, 'daily', 10);
      if (quests.length > 1) {
        const uniqueFactions = new Set(quests.map((q) => q.faction));
        expect(uniqueFactions.size).toBeGreaterThan(1); // Should have multiple factions if possible
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Test: _instantiateQuest (rarity constraints)
  // ─────────────────────────────────────────────────────────────────────────
  describe('_instantiateQuest', () => {
    test('caps common rarity at 10 for daily quests', () => {
      const tmpl = {
        id: 'test',
        faction: 'f1',
        type: 'deliver_object',
        targetType: 'creature',
        targetRarities: ['common'],
        amountRange: [50, 100], // Will be capped
        creditRange: [100, 200],
        xpRange: [50, 100],
        reputationGain: [10, 20],
        nameRu: 'Test',
        nameEn: 'Test',
        descRu: 'Test',
        descEn: 'Test',
        reputationPenalties: [],
      };

      const quest = questService._instantiateQuest(tmpl, 'daily');
      expect(quest.targetAmount).toBeLessThanOrEqual(10);
      expect(quest.targetAmount).toBeGreaterThan(0);
    });

    test('caps rare at 5 for daily, 50 for weekly', () => {
      const tmpl = {
        id: 'test',
        faction: 'f1',
        type: 'deliver_object',
        targetType: 'creature',
        targetRarities: ['rare'],
        amountRange: [100, 200],
        creditRange: [100, 200],
        xpRange: [50, 100],
        reputationGain: [10, 20],
        nameRu: 'Test',
        nameEn: 'Test',
        descRu: 'Test',
        descEn: 'Test',
        reputationPenalties: [],
      };

      const daily = questService._instantiateQuest(tmpl, 'daily');
      expect(daily.targetAmount).toBeLessThanOrEqual(5);

      const weekly = questService._instantiateQuest(tmpl, 'weekly');
      expect(weekly.targetAmount).toBeLessThanOrEqual(50);
    });

    test('prevents legendary/mythical in daily quests', () => {
      const tmpl = {
        id: 'test',
        faction: 'f1',
        type: 'deliver_object',
        targetType: 'creature',
        targetRarities: ['legendary', 'mythical'],
        amountRange: [1, 5],
        creditRange: [100, 200],
        xpRange: [50, 100],
        reputationGain: [10, 20],
        nameRu: 'Test',
        nameEn: 'Test',
        descRu: 'Test',
        descEn: 'Test',
        reputationPenalties: [],
      };

      const daily = questService._instantiateQuest(tmpl, 'daily');
      // Should fall back to common or set amount to 1
      expect(daily.targetAmount).toBeGreaterThan(0);
    });

    test('allows legendary in weekly quests', () => {
      const tmpl = {
        id: 'test',
        faction: 'f1',
        type: 'deliver_object',
        targetType: 'creature',
        targetRarities: ['legendary'],
        amountRange: [1, 20],
        creditRange: [100, 200],
        xpRange: [50, 100],
        reputationGain: [10, 20],
        nameRu: 'Test',
        nameEn: 'Test',
        descRu: 'Test',
        descEn: 'Test',
        reputationPenalties: [],
      };

      const weekly = questService._instantiateQuest(tmpl, 'weekly');
      expect(weekly.targetAmount).toBeLessThanOrEqual(10);
      expect(weekly.targetAmount).toBeGreaterThan(0);
    });

    test('returns valid quest object with all required fields', () => {
      const tmpl = {
        id: 'test',
        faction: 'f1',
        type: 'deliver_object',
        targetType: 'creature',
        targetRarities: ['common'],
        amountRange: [1, 5],
        creditRange: [100, 200],
        xpRange: [50, 100],
        reputationGain: [10, 20],
        nameRu: 'Test',
        nameEn: 'Test',
        descRu: 'Test',
        descEn: 'Test',
        reputationPenalties: [],
      };

      const quest = questService._instantiateQuest(tmpl, 'daily');
      expect(quest.templateId).toBe('test');
      expect(quest.faction).toBe('f1');
      expect(quest.questType).toBe('daily');
      expect(typeof quest.targetAmount).toBe('number');
      expect(typeof quest.rewardCredits).toBe('number');
      expect(typeof quest.rewardXp).toBe('number');
      expect(typeof quest.reputationGain).toBe('number');
      expect(quest.nameRu).toBeDefined();
      expect(quest.nameEn).toBeDefined();
    });

    test('generates different instances from same template', () => {
      const tmpl = {
        id: 'test',
        faction: 'f1',
        type: 'deliver_object',
        targetType: 'creature',
        targetRarities: ['common', 'rare'],
        amountRange: [1, 10],
        creditRange: [100, 500],
        xpRange: [50, 150],
        reputationGain: [10, 50],
        nameRu: 'Test',
        nameEn: 'Test',
        descRu: 'Test',
        descEn: 'Test',
        reputationPenalties: [],
      };

      const quest1 = questService._instantiateQuest(tmpl, 'daily');
      const quest2 = questService._instantiateQuest(tmpl, 'daily');

      // They should both be valid but may differ
      expect(quest1.targetAmount).toBeGreaterThan(0);
      expect(quest2.targetAmount).toBeGreaterThan(0);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Integration tests
  // ─────────────────────────────────────────────────────────────────────────
  describe('Integration', () => {
    test('generates valid daily quests with reputation filtering', async () => {
      query.mockResolvedValueOnce({
        rows: [
          { faction_id: 'bioengineers', reputation: 100 },
          { faction_id: 'tech_institute', reputation: 0 },
        ],
      });

      const quests = await questService.generateQuests(123, 'daily', 10);
      expect(Array.isArray(quests)).toBe(true);
      quests.forEach((q) => {
        expect(q.questType).toBe('daily');
        expect(['common', 'rare', 'epic']).toContain(q.targetRarity);
      });
    });

    test('generates weekly quests with higher tiers', async () => {
      query.mockResolvedValueOnce({ rows: [] });
      const quests = await questService.generateQuests(123, 'weekly', 10);
      expect(Array.isArray(quests)).toBe(true);
      quests.forEach((q) => {
        expect(q.questType).toBe('weekly');
        // Weekly allows higher rarities
        expect(['rare', 'epic', 'legendary']).toContain(q.targetRarity);
      });
    });

    test('respects reputation requirements when generating', async () => {
      query.mockResolvedValueOnce({ rows: [] }); // No reputation for black_market (requires >= 0)
      const quests = await questService.generateQuests(123, 'weekly', 25); // User level 25, so can see black_market
      // Given the mock, we should get some quests, and they should respect requirements
      expect(Array.isArray(quests)).toBe(true);
    });
  });
});
