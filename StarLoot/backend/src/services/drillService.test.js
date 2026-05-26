'use strict';

const DrillService = require('./drillService');

jest.mock('../db/pool', () => ({
  query: jest.fn(),
  withTransaction: jest.fn(),
}));

jest.mock('../utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const { query, withTransaction } = require('../db/pool');
const logger = require('../utils/logger');

describe('DrillService', () => {
  let service;

  beforeEach(() => {
    jest.clearAllMocks();

    withTransaction.mockImplementation(async (callback) => {
      const client = {
        query: jest.fn(async () => ({ rows: [] })),
      };
      return callback(client);
    });

    service = new DrillService({
      config: {
        asteroidResources: {
          common: [{ id: 'iron', pricePerTon: 10, name: 'Iron' }],
        },
      },
    });
  });

  describe('internal math and normalization helpers', () => {
    test('_conditionFactor clamps values and applies formula', () => {
      expect(service._conditionFactor(100)).toBe(1);
      expect(service._conditionFactor(0)).toBe(0.2);
      expect(service._conditionFactor(50)).toBeCloseTo(0.6, 6);
      expect(service._conditionFactor(-100)).toBe(0.2);
      expect(service._conditionFactor(999)).toBe(1);
    });

    test('_valuePerTonWithUpgrades always increases or keeps value positive', () => {
      expect(service._valuePerTonWithUpgrades(1, 0)).toBe(1);
      expect(service._valuePerTonWithUpgrades(1, 1)).toBe(2);
      expect(service._valuePerTonWithUpgrades(10, 2)).toBe(12);
      expect(service._valuePerTonWithUpgrades(0, 3)).toBeGreaterThanOrEqual(1);
    });

    test('_getUpgradeLevels calculates total and next cost', () => {
      const levels = service._getUpgradeLevels({
        upgrade_yield_level: 2,
        upgrade_fossil_level: 1,
        upgrade_value_level: 0,
        upgrade_storage_level: 0,
      });

      expect(levels.totalUsed).toBe(3);
      expect(levels.nextCost).toBe(9000);
      expect(levels.canUpgrade).toBe(true);
      expect(levels.maxTotal).toBe(5);
    });

    test('_getUpgradeLevels disables upgrades at hard cap', () => {
      const levels = service._getUpgradeLevels({
        upgrade_yield_level: 3,
        upgrade_fossil_level: 3,
        upgrade_value_level: 3,
        upgrade_storage_level: 3,
      });

      expect(levels.totalUsed).toBe(12);
      expect(levels.canUpgrade).toBe(false);
      expect(levels.nextCost).toBeNull();
    });

    test('_drillStats applies upgrade impact to all stats', () => {
      const stats = service._drillStats(
        {
          base_yield_per_cycle: 2,
          cycle_duration_seconds: 900,
          base_storage_limit: 400,
          base_fossil_chance: 0.02,
        },
        {
          upgrade_yield_level: 2,
          upgrade_fossil_level: 1,
          upgrade_value_level: 0,
          upgrade_storage_level: 2,
        }
      );

      expect(stats.yieldPerCycle).toBe(4);
      expect(stats.cycleDurationSec).toBe(900);
      expect(stats.storageLimitCredits).toBe(800);
      expect(stats.fossilChance).toBeCloseTo(0.03, 6);
    });

    test('_computeAccumulated respects cycles, storage and asteroid volume limits', () => {
      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(now);

      const result = service._computeAccumulated(
        {
          balance: 100,
          last_cycle_at: new Date(now - 3 * 900 * 1000).toISOString(),
          asteroid_value_per_ton: 20,
          asteroid_remaining_volume: 5,
          upgrade_yield_level: 0,
          upgrade_fossil_level: 0,
          upgrade_value_level: 0,
          upgrade_storage_level: 0,
        },
        {
          base_yield_per_cycle: 2,
          cycle_duration_seconds: 900,
          base_storage_limit: 400,
          base_fossil_chance: 0.02,
        }
      );

      expect(result.cyclesElapsed).toBe(3);
      expect(result.accumulatedTons).toBe(5);
      expect(result.accumulatedCredits).toBe(100);
      expect(result.currentBalanceCredits).toBe(200);

      Date.now.mockRestore();
    });

    test('_computeAccumulated caps balance at storage limit when one iteration overflows it', () => {
      const now = Date.now();
      jest.spyOn(Date, 'now').mockReturnValue(now);

      const result = service._computeAccumulated(
        {
          balance: 0,
          last_cycle_at: new Date(now - 1 * 900 * 1000).toISOString(),
          asteroid_value_per_ton: 470,
          asteroid_remaining_volume: 10,
          upgrade_yield_level: 0,
          upgrade_fossil_level: 0,
          upgrade_value_level: 0,
          upgrade_storage_level: 0,
        },
        {
          base_yield_per_cycle: 1,
          cycle_duration_seconds: 900,
          base_storage_limit: 400,
          base_fossil_chance: 0.02,
        }
      );

      expect(result.cyclesElapsed).toBe(1);
      expect(result.accumulatedTons).toBe(1);
      expect(result.accumulatedCredits).toBe(400);
      expect(result.currentBalanceCredits).toBe(400);
      expect(result.isFull).toBe(true);
      expect(result.haltedByLimit).toBe(true);

      Date.now.mockRestore();
    });
  });

  describe('purchaseDrill', () => {
    function runPurchaseWithClient(client) {
      withTransaction.mockImplementation(async (cb) => cb(client));
      return service.purchaseDrill(10, 'standard_drill', 'credits', 2);
    }

    test('rejects invalid slot index', async () => {
      await expect(service.purchaseDrill(10, 'standard_drill', 'credits', 0)).rejects.toEqual({
        status: 400,
        message: 'Invalid slot index',
      });
    });

    test('rejects locked slot', async () => {
      const client = {
        query: jest.fn(async (sql) => {
          if (sql.includes('drill_slots_unlocked')) {
            return { rows: [{ stars_balance: 100, drill_slots_unlocked: 1 }] };
          }
          return { rows: [] };
        }),
      };

      await expect(runPurchaseWithClient(client)).rejects.toEqual({
        status: 400,
        message: 'Slot is locked',
      });
    });

    test('rejects when previous slot is empty', async () => {
      const client = {
        query: jest.fn(async (sql) => {
          if (sql.includes('drill_slots_unlocked')) {
            return { rows: [{ stars_balance: 100, drill_slots_unlocked: 3 }] };
          }
          if (sql.includes('slot_index = $2') && sql.includes('LIMIT 1')) {
            return { rows: [] };
          }
          return { rows: [] };
        }),
      };

      await expect(runPurchaseWithClient(client)).rejects.toEqual({
        status: 400,
        message: 'Previous slot must be occupied first',
      });
    });

    test('rejects occupied slot', async () => {
      const client = {
        query: jest.fn(async (sql, params) => {
          if (sql.includes('drill_slots_unlocked')) {
            return { rows: [{ stars_balance: 100, drill_slots_unlocked: 3 }] };
          }
          if (sql.includes('slot_index = $2') && sql.includes('LIMIT 1') && params[1] === 1) {
            return { rows: [{ 1: 1 }] };
          }
          if (sql.includes('slot_index = $2') && sql.includes('LIMIT 1') && params[1] === 2) {
            return { rows: [{ 1: 1 }] };
          }
          return { rows: [] };
        }),
      };

      await expect(runPurchaseWithClient(client)).rejects.toEqual({
        status: 400,
        message: 'Slot already has a drill',
      });
    });

    test('purchases drill for credits and creates drill row', async () => {
      const client = {
        query: jest.fn(async (sql, params) => {
          if (sql.includes('drill_slots_unlocked')) {
            return { rows: [{ stars_balance: 100, drill_slots_unlocked: 3 }] };
          }
          if (sql.includes('slot_index = $2') && sql.includes('LIMIT 1') && params[1] === 1) {
            return { rows: [{ 1: 1 }] };
          }
          if (sql.includes('slot_index = $2') && sql.includes('LIMIT 1') && params[1] === 2) {
            return { rows: [] };
          }
          if (sql.includes('SELECT * FROM drill_types')) {
            return { rows: [{ id: 'standard_drill', cost_credits: 2000, cost_stars: null }] };
          }
          if (sql.includes('SELECT credits FROM users')) {
            return { rows: [{ credits: 5000 }] };
          }
          if (sql.includes('UPDATE users SET credits = credits -')) {
            return { rows: [] };
          }
          if (sql.includes('INSERT INTO user_drills')) {
            return { rows: [{ id: 'dr-new' }] };
          }
          return { rows: [] };
        }),
      };

      const result = await runPurchaseWithClient(client);

      expect(result).toEqual({ drillId: 'dr-new', slotIndex: 2 });
      expect(client.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE users SET credits = credits - $1 WHERE id = $2'),
        [2000, 10]
      );
    });

    test('purchases star-priced drill with stars when requested', async () => {
      const client = {
        query: jest.fn(async (sql, params) => {
          if (sql.includes('drill_slots_unlocked')) {
            return { rows: [{ stars_balance: 20, drill_slots_unlocked: 3 }] };
          }
          if (sql.includes('slot_index = $2') && sql.includes('LIMIT 1') && params[1] === 1) {
            return { rows: [{ 1: 1 }] };
          }
          if (sql.includes('slot_index = $2') && sql.includes('LIMIT 1') && params[1] === 2) {
            return { rows: [] };
          }
          if (sql.includes('SELECT * FROM drill_types')) {
            return { rows: [{ id: 'precision_drill', cost_credits: null, cost_stars: 15 }] };
          }
          if (sql.includes('SELECT credits FROM users')) {
            return { rows: [{ credits: 10 }] };
          }
          if (sql.includes('UPDATE users SET stars_balance = stars_balance -')) {
            return { rows: [] };
          }
          if (sql.includes('INSERT INTO user_drills')) {
            return { rows: [{ id: 'dr-stars' }] };
          }
          return { rows: [] };
        }),
      };

      withTransaction.mockImplementation(async (cb) => cb(client));

      const result = await service.purchaseDrill(10, 'precision_drill', 'stars', 2);

      expect(result).toEqual({ drillId: 'dr-stars', slotIndex: 2 });
    });

    test('rejects insufficient credits', async () => {
      const client = {
        query: jest.fn(async (sql, params) => {
          if (sql.includes('drill_slots_unlocked')) return { rows: [{ stars_balance: 100, drill_slots_unlocked: 3 }] };
          if (sql.includes('slot_index = $2') && params[1] === 1) return { rows: [{ 1: 1 }] };
          if (sql.includes('slot_index = $2') && params[1] === 2) return { rows: [] };
          if (sql.includes('SELECT * FROM drill_types')) return { rows: [{ id: 'deep_core_drill', cost_credits: 8000, cost_stars: null }] };
          if (sql.includes('SELECT credits FROM users')) return { rows: [{ credits: 1000 }] };
          return { rows: [] };
        }),
      };
      withTransaction.mockImplementation(async (cb) => cb(client));

      await expect(service.purchaseDrill(10, 'deep_core_drill', 'credits', 2)).rejects.toEqual({
        status: 400,
        message: 'Not enough credits',
      });
    });
  });

  describe('unlockNextSlot', () => {
    test('rejects when all slots are already unlocked', async () => {
      const client = {
        query: jest.fn(async (sql) => {
          if (sql.includes('drill_slots_unlocked')) return { rows: [{ stars_balance: 100, drill_slots_unlocked: 3 }] };
          return { rows: [] };
        }),
      };
      withTransaction.mockImplementation(async (cb) => cb(client));

      await expect(service.unlockNextSlot(10)).rejects.toEqual({
        status: 400,
        message: 'All drill slots are already unlocked',
      });
    });

    test('rejects when previous slot has no drill', async () => {
      const client = {
        query: jest.fn(async (sql) => {
          if (sql.includes('drill_slots_unlocked')) return { rows: [{ stars_balance: 100, drill_slots_unlocked: 2 }] };
          if (sql.includes('SELECT 1 FROM user_drills')) return { rows: [] };
          return { rows: [] };
        }),
      };
      withTransaction.mockImplementation(async (cb) => cb(client));

      await expect(service.unlockNextSlot(10)).rejects.toEqual({
        status: 400,
        message: 'Previous slot must have a drill first',
      });
    });

    test('rejects when stars are insufficient', async () => {
      const client = {
        query: jest.fn(async (sql) => {
          if (sql.includes('drill_slots_unlocked')) return { rows: [{ stars_balance: 10, drill_slots_unlocked: 1 }] };
          if (sql.includes('SELECT 1 FROM user_drills')) return { rows: [{ 1: 1 }] };
          return { rows: [] };
        }),
      };
      withTransaction.mockImplementation(async (cb) => cb(client));

      await expect(service.unlockNextSlot(10)).rejects.toEqual({
        status: 400,
        message: 'Not enough stars to unlock slot',
      });
    });

    test('unlocks next slot when requirements are met', async () => {
      const client = {
        query: jest.fn(async (sql) => {
          if (sql.includes('drill_slots_unlocked')) return { rows: [{ stars_balance: 60, drill_slots_unlocked: 1 }] };
          if (sql.includes('SELECT 1 FROM user_drills')) return { rows: [{ 1: 1 }] };
          if (sql.includes('UPDATE users SET stars_balance')) return { rows: [] };
          return { rows: [] };
        }),
      };
      withTransaction.mockImplementation(async (cb) => cb(client));

      const result = await service.unlockNextSlot(10);

      expect(result).toEqual({ unlockedSlots: 2, starsRemaining: 10 });
    });
  });

  describe('upgradeDrill', () => {
    test('rejects unknown upgrade type', async () => {
      await expect(service.upgradeDrill(1, 'dr-1', 'speed')).rejects.toEqual({
        status: 400,
        message: 'Unknown upgrade type',
      });
    });

    test('rejects when drill does not exist', async () => {
      const client = {
        query: jest.fn(async (sql) => {
          if (sql.includes('SELECT * FROM user_drills')) return { rows: [] };
          return { rows: [] };
        }),
      };
      withTransaction.mockImplementation(async (cb) => cb(client));

      await expect(service.upgradeDrill(1, 'dr-404', 'yield')).rejects.toEqual({
        status: 404,
        message: 'Drill not found',
      });
    });

    test('rejects when total upgrades hit cap', async () => {
      const client = {
        query: jest.fn(async (sql) => {
          if (sql.includes('SELECT * FROM user_drills')) {
            return {
              rows: [{
                id: 'dr-1',
                upgrade_yield_level: 3,
                upgrade_fossil_level: 3,
                upgrade_value_level: 3,
                upgrade_storage_level: 3,
              }],
            };
          }
          return { rows: [] };
        }),
      };
      withTransaction.mockImplementation(async (cb) => cb(client));

      await expect(service.upgradeDrill(1, 'dr-1', 'yield')).rejects.toEqual({
        status: 400,
        message: 'Upgrade limit reached for this drill',
      });
    });

    test('rejects when chosen upgrade type is at max level', async () => {
      const client = {
        query: jest.fn(async (sql) => {
          if (sql.includes('SELECT * FROM user_drills')) {
            return {
              rows: [{
                id: 'dr-1',
                upgrade_yield_level: 3,
                upgrade_fossil_level: 0,
                upgrade_value_level: 0,
                upgrade_storage_level: 0,
              }],
            };
          }
          return { rows: [] };
        }),
      };
      withTransaction.mockImplementation(async (cb) => cb(client));

      await expect(service.upgradeDrill(1, 'dr-1', 'yield')).rejects.toEqual({
        status: 400,
        message: 'This upgrade is already at max level',
      });
    });

    test('rejects when user has insufficient credits', async () => {
      const client = {
        query: jest.fn(async (sql) => {
          if (sql.includes('SELECT * FROM user_drills')) {
            return {
              rows: [{
                id: 'dr-1',
                upgrade_yield_level: 0,
                upgrade_fossil_level: 0,
                upgrade_value_level: 0,
                upgrade_storage_level: 0,
              }],
            };
          }
          if (sql.includes('SELECT credits FROM users')) return { rows: [{ credits: 100 }] };
          return { rows: [] };
        }),
      };
      withTransaction.mockImplementation(async (cb) => cb(client));

      await expect(service.upgradeDrill(1, 'dr-1', 'yield')).rejects.toEqual({
        status: 400,
        message: 'Not enough credits',
      });
    });

    test('upgrades drill and returns new levels', async () => {
      const client = {
        query: jest.fn(async (sql) => {
          if (sql.includes('SELECT * FROM user_drills')) {
            return {
              rows: [{
                id: 'dr-1',
                upgrade_yield_level: 1,
                upgrade_fossil_level: 0,
                upgrade_value_level: 0,
                upgrade_storage_level: 0,
              }],
            };
          }
          if (sql.includes('SELECT credits FROM users')) return { rows: [{ credits: 999999 }] };
          if (sql.includes('UPDATE users SET credits = credits -')) return { rows: [] };
          if (sql.includes('UPDATE user_drills')) return { rows: [] };
          return { rows: [] };
        }),
      };
      withTransaction.mockImplementation(async (cb) => cb(client));

      const result = await service.upgradeDrill(1, 'dr-1', 'yield');

      expect(result).toEqual({
        upgraded: true,
        upgradeType: 'yield',
        newTypeLevel: 2,
        totalUsed: 2,
        maxTotal: 5,
      });
    });
  });

  describe('grantFreeDrill', () => {
    test('returns null when user already has slot 1 drill', async () => {
      query.mockResolvedValueOnce({ rows: [{ 1: 1 }] });

      const result = await service.grantFreeDrill(22);

      expect(result).toBeNull();
      expect(query).toHaveBeenCalledTimes(1);
    });

    test('returns new drill id when inserted', async () => {
      query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'free-1' }] });

      const result = await service.grantFreeDrill(22);

      expect(result).toBe('free-1');
    });

    test('returns null when insert conflict prevented creation', async () => {
      query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      const result = await service.grantFreeDrill(22);

      expect(result).toBeNull();
    });
  });

  describe('collectDrill', () => {
    test('does not decrease asteroid volume from previously buffered balance', async () => {
      const now = Date.now();
      const client = {
        query: jest.fn(async (sql) => {
          if (sql.includes('FROM user_drills d') && sql.includes('FOR UPDATE OF d')) {
            return {
              rows: [{
                id: 'dr-1',
                user_id: 7,
                drill_type_id: 'standard_drill',
                balance: 400,
                last_cycle_at: new Date(now - 3600 * 1000).toISOString(),
                asteroid_remaining_volume: 100,
                asteroid_value_per_ton: 20,
                assigned_asteroid_item_id: 'ast-1',
                base_yield_per_cycle: 2,
                cycle_duration_seconds: 900,
                base_storage_limit: 400,
                base_fossil_chance: 0,
                asteroid_template_id: 'tpl-1',
                asteroid_rarity: 'common',
                asteroid_object_data: { name: 'Asteroid', estimatedVolume: 120, resourceType: 'iron' },
                asteroid_base_credits: 2400,
                upgrade_yield_level: 0,
                upgrade_fossil_level: 0,
                upgrade_value_level: 0,
                upgrade_storage_level: 0,
              }],
            };
          }
          if (sql.includes('UPDATE user_drills')) {
            return { rows: [] };
          }
          if (sql.includes('SELECT credits FROM users WHERE id = $1 FOR UPDATE')) {
            return { rows: [{ credits: 1000 }] };
          }
          if (sql.includes('UPDATE users SET credits = credits + $1 WHERE id = $2')) {
            return { rows: [] };
          }
          if (sql.includes('INSERT INTO credit_transactions')) {
            return { rows: [] };
          }
          return { rows: [] };
        }),
      };
      withTransaction.mockImplementation(async (cb) => cb(client));

      const result = await service.collectDrill(7, 'dr-1');

      expect(result).toMatchObject({
        creditsCollected: 400,
        tonsCollected: 0,
        exhausted: false,
      });
      expect(client.query).toHaveBeenCalledWith(
        expect.stringContaining('SET balance = 0,'),
        expect.arrayContaining([expect.any(Date), 100, false, 'dr-1'])
      );
    });

    test('caps by storage limit without exhausting asteroid when value per ton is above remaining capacity', async () => {
      const now = Date.now();
      const client = {
        query: jest.fn(async (sql) => {
          if (sql.includes('FROM user_drills d') && sql.includes('FOR UPDATE OF d')) {
            return {
              rows: [{
                id: 'dr-overflow',
                user_id: 7,
                drill_type_id: 'standard_drill',
                balance: 0,
                last_cycle_at: new Date(now - 900 * 1000).toISOString(),
                asteroid_remaining_volume: 12,
                asteroid_value_per_ton: 420,
                assigned_asteroid_item_id: 'ast-overflow',
                base_yield_per_cycle: 12,
                cycle_duration_seconds: 900,
                base_storage_limit: 400,
                base_fossil_chance: 0,
                asteroid_template_id: 'tpl-overflow',
                asteroid_rarity: 'common',
                asteroid_object_data: { name: 'Asteroid', estimatedVolume: 12, resourceType: 'iron' },
                asteroid_base_credits: 5040,
                upgrade_yield_level: 0,
                upgrade_fossil_level: 0,
                upgrade_value_level: 0,
                upgrade_storage_level: 0,
              }],
            };
          }
          if (sql.includes('UPDATE user_drills')) {
            return { rows: [] };
          }
          if (sql.includes('SELECT credits FROM users WHERE id = $1 FOR UPDATE')) {
            return { rows: [{ credits: 1000 }] };
          }
          if (sql.includes('UPDATE users SET credits = credits + $1 WHERE id = $2')) {
            return { rows: [] };
          }
          if (sql.includes('INSERT INTO credit_transactions')) {
            return { rows: [] };
          }
          return { rows: [] };
        }),
      };
      withTransaction.mockImplementation(async (cb) => cb(client));

      const result = await service.collectDrill(7, 'dr-overflow');

      expect(result).toMatchObject({
        creditsCollected: 400,
        tonsCollected: 1,
        exhausted: false,
      });
      expect(client.query).toHaveBeenCalledWith(
        expect.stringContaining('SET balance = 0,'),
        expect.arrayContaining([expect.any(Date), 11, false, 'dr-overflow'])
      );
    });
  });

  describe('deleteDrill', () => {
    test('logs drill deletion for hosting logs', async () => {
      const client = {
        query: jest.fn(async (sql) => {
          if (sql.includes('SELECT id, slot_index FROM user_drills')) {
            return { rows: [{ id: 'dr-9', slot_index: 2 }] };
          }
          return { rows: [] };
        }),
      };
      withTransaction.mockImplementation(async (cb) => cb(client));

      const result = await service.deleteDrill(11, 'dr-9');

      expect(result).toEqual({ deleted: true, slotIndex: 2 });
      expect(logger.info).toHaveBeenCalledWith(
        { userId: 11, drillId: 'dr-9', slotIndex: 2 },
        'Drill deleted'
      );
    });
  });
});
