'use strict';

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
const PrestigeService = require('./prestigeService');

const FULL_CONDITIONS_ROWS = {
  // user: level 30, prestige 0
  user: [{ level: 30, prestige_level: 0 }],
  // modules: scanner 10, cargo 10, capsule 10
  modules: [
    { module_type: 'scanner', level: 10 },
    { module_type: 'cargo',   level: 10 },
    { module_type: 'capsule', level: 10 },
  ],
  // story quests: all 3 claimed
  storyQuests: [
    { template_id: 'bio_story_gene_enhancer',       status: 'claimed' },
    { template_id: 'tech_story_divine_shard',       status: 'claimed' },
    { template_id: 'nav_story_particle_decelerator', status: 'claimed' },
  ],
  // story items: bio/tech/nav items present (3 rows)
  storyItems: [{ item_key: 'gene_enhancer' }, { item_key: 'divine_shard' }, { item_key: 'particle_decelerator' }],
  // signal item present
  signalItem: [{ item_key: 'signal_from_another_universe' }],
  // black market rep: 500
  blackMarket: [{ reputation: 500 }],
};

function mockGetStatusQueries(overrides = {}) {
  const rows = { ...FULL_CONDITIONS_ROWS, ...overrides };
  query
    .mockResolvedValueOnce({ rows: rows.user })
    .mockResolvedValueOnce({ rows: rows.modules })
    .mockResolvedValueOnce({ rows: rows.storyQuests })
    .mockResolvedValueOnce({ rows: rows.storyItems })
    .mockResolvedValueOnce({ rows: rows.signalItem })
    .mockResolvedValueOnce({ rows: rows.blackMarket });
}

describe('PrestigeService.getStatus', () => {
  let service;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PrestigeService(null, null);
  });

  test('throws if user not found', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(service.getStatus(1)).rejects.toThrow('User not found');
  });

  test('returns eligible=true when all conditions met', async () => {
    mockGetStatusQueries();
    const result = await service.getStatus(1);

    expect(result.eligible).toBe(true);
    expect(result.prestigeLevel).toBe(0);
    expect(result.maxPrestige).toBe(false);
    expect(result.conditions.level.done).toBe(true);
    expect(result.conditions.modules.done).toBe(true);
    expect(result.conditions.storyMissions.done).toBe(true);
    expect(result.conditions.blackMarket.done).toBe(true);
  });

  test('eligible=false when level < 30', async () => {
    mockGetStatusQueries({ user: [{ level: 25, prestige_level: 0 }] });
    const result = await service.getStatus(1);

    expect(result.eligible).toBe(false);
    expect(result.conditions.level.done).toBe(false);
    expect(result.conditions.level.current).toBe(25);
    expect(result.conditions.level.required).toBe(30);
  });

  test('eligible=false when scanner module not maxed', async () => {
    mockGetStatusQueries({
      modules: [
        { module_type: 'scanner', level: 8 },
        { module_type: 'cargo',   level: 10 },
        { module_type: 'capsule', level: 10 },
      ],
    });
    const result = await service.getStatus(1);

    expect(result.eligible).toBe(false);
    expect(result.conditions.modules.done).toBe(false);
    expect(result.conditions.modules.scanner.current).toBe(8);
  });

  test('eligible=false when cargo module not maxed', async () => {
    mockGetStatusQueries({
      modules: [
        { module_type: 'scanner', level: 10 },
        { module_type: 'cargo',   level: 5 },
        { module_type: 'capsule', level: 10 },
      ],
    });
    const result = await service.getStatus(1);

    expect(result.eligible).toBe(false);
    expect(result.conditions.modules.done).toBe(false);
    expect(result.conditions.modules.cargo.current).toBe(5);
  });

  test('eligible=false when capsule module not maxed', async () => {
    mockGetStatusQueries({
      modules: [
        { module_type: 'scanner', level: 10 },
        { module_type: 'cargo',   level: 10 },
        { module_type: 'capsule', level: 0 },
      ],
    });
    const result = await service.getStatus(1);

    expect(result.eligible).toBe(false);
    expect(result.conditions.modules.capsule.current).toBe(0);
  });

  test('eligible=false when no modules at all', async () => {
    mockGetStatusQueries({ modules: [] });
    const result = await service.getStatus(1);

    expect(result.eligible).toBe(false);
    expect(result.conditions.modules.done).toBe(false);
    expect(result.conditions.modules.scanner.current).toBe(0);
    expect(result.conditions.modules.cargo.current).toBe(0);
    expect(result.conditions.modules.capsule.current).toBe(0);
  });

  test('eligible=false when bio story quest not claimed', async () => {
    mockGetStatusQueries({
      storyQuests: [
        { template_id: 'bio_story_gene_enhancer',       status: 'active' }, // not claimed
        { template_id: 'tech_story_divine_shard',       status: 'claimed' },
        { template_id: 'nav_story_particle_decelerator', status: 'claimed' },
      ],
    });
    const result = await service.getStatus(1);

    expect(result.eligible).toBe(false);
    expect(result.conditions.storyMissions.done).toBe(false);
    expect(result.conditions.storyMissions.bio).toBe(false);
    expect(result.conditions.storyMissions.tech).toBe(true);
    expect(result.conditions.storyMissions.nav).toBe(true);
  });

  test('eligible=false when signal_from_another_universe missing', async () => {
    mockGetStatusQueries({ signalItem: [] });
    const result = await service.getStatus(1);

    expect(result.eligible).toBe(false);
    expect(result.conditions.storyMissions.signal).toBe(false);
    expect(result.conditions.storyMissions.done).toBe(false);
  });

  test('eligible=false when black market rep < 500', async () => {
    mockGetStatusQueries({ blackMarket: [{ reputation: 499 }] });
    const result = await service.getStatus(1);

    expect(result.eligible).toBe(false);
    expect(result.conditions.blackMarket.done).toBe(false);
    expect(result.conditions.blackMarket.current).toBe(499);
  });

  test('eligible=false when black market rep is 0 (no row)', async () => {
    mockGetStatusQueries({ blackMarket: [] });
    const result = await service.getStatus(1);

    expect(result.eligible).toBe(false);
    expect(result.conditions.blackMarket.current).toBe(0);
  });

  test('returns maxPrestige=true when prestige_level=3', async () => {
    query.mockResolvedValueOnce({ rows: [{ level: 30, prestige_level: 3 }] });
    const result = await service.getStatus(1);

    expect(result.maxPrestige).toBe(true);
    expect(result.eligible).toBe(false);
    expect(result.conditions).toBeNull();
  });

  test('prestige_level=2 returns correct current level and can still progress', async () => {
    mockGetStatusQueries({ user: [{ level: 30, prestige_level: 2 }] });
    const result = await service.getStatus(1);

    expect(result.prestigeLevel).toBe(2);
    expect(result.maxPrestige).toBe(false);
    expect(result.eligible).toBe(true);
  });

  test('story quests with all active (none claimed) means storyMissions.done=false', async () => {
    mockGetStatusQueries({
      storyQuests: [
        { template_id: 'bio_story_gene_enhancer',       status: 'active' },
        { template_id: 'tech_story_divine_shard',       status: 'completed' },
        { template_id: 'nav_story_particle_decelerator', status: 'active' },
      ],
    });
    const result = await service.getStatus(1);

    expect(result.conditions.storyMissions.bio).toBe(false);
    expect(result.conditions.storyMissions.tech).toBe(false);
    expect(result.conditions.storyMissions.nav).toBe(false);
    expect(result.conditions.storyMissions.done).toBe(false);
  });

  test('exact boundary: level exactly 30 passes level check', async () => {
    mockGetStatusQueries({ user: [{ level: 30, prestige_level: 0 }] });
    const result = await service.getStatus(1);
    expect(result.conditions.level.done).toBe(true);
  });

  test('exact boundary: black market rep exactly 500 passes', async () => {
    mockGetStatusQueries({ blackMarket: [{ reputation: 500 }] });
    const result = await service.getStatus(1);
    expect(result.conditions.blackMarket.done).toBe(true);
  });

  test('multiple conditions failed — all reported correctly', async () => {
    mockGetStatusQueries({
      user: [{ level: 15, prestige_level: 0 }],
      modules: [],
      storyQuests: [],
      signalItem: [],
      blackMarket: [],
    });
    const result = await service.getStatus(1);

    expect(result.eligible).toBe(false);
    expect(result.conditions.level.done).toBe(false);
    expect(result.conditions.modules.done).toBe(false);
    expect(result.conditions.storyMissions.done).toBe(false);
    expect(result.conditions.blackMarket.done).toBe(false);
  });
});

describe('PrestigeService.claimPrestige', () => {
  let service;
  let clientMock;

  beforeEach(() => {
    jest.clearAllMocks();
    clientMock = { query: jest.fn() };
    service = new PrestigeService(null, null);
  });

  function setupEligibleStatus() {
    // getStatus makes 6 queries
    mockGetStatusQueries();
  }

  function setupTransactionSuccess() {
    withTransaction.mockImplementation(async (fn) => fn(clientMock));
    // snapshot query
    clientMock.query
      .mockResolvedValueOnce({ rows: [{ xp: 50000, level: 30, credits: 100000, crystals: 500, current_universe: 1, total_expeditions: 200, total_finds: 150, total_sold: 80 }] })
      // INSERT user_prestiges
      .mockResolvedValueOnce({ rows: [] })
      // UPDATE users
      .mockResolvedValueOnce({ rows: [] })
      // UPDATE expeditions
      .mockResolvedValueOnce({ rows: [] })
      // DELETE ship_modules
      .mockResolvedValueOnce({ rows: [] })
      // DELETE user_active_buffs
      .mockResolvedValueOnce({ rows: [] })
      // DELETE user_quests
      .mockResolvedValueOnce({ rows: [] })
      // DELETE user_quest_refresh
      .mockResolvedValueOnce({ rows: [] })
      // DELETE user_quest_items
      .mockResolvedValueOnce({ rows: [] })
      // DELETE user_faction_reputation
      .mockResolvedValueOnce({ rows: [] })
      // DELETE user_story_items
      .mockResolvedValueOnce({ rows: [] })
      // DELETE user_story_dialog_progress
      .mockResolvedValueOnce({ rows: [] })
      // DELETE user_drills
      .mockResolvedValueOnce({ rows: [] })
      // DELETE mini_tournament_progress
      .mockResolvedValueOnce({ rows: [] })
      // DELETE user_exhibitions
      .mockResolvedValueOnce({ rows: [] })
      // DELETE smuggler_exchanges
      .mockResolvedValueOnce({ rows: [] })
      // DELETE user_collections
      .mockResolvedValueOnce({ rows: [] })
      // DELETE inventory_items (except NFT containers)
      .mockResolvedValueOnce({ rows: [] })
      // INSERT inventory_items (NFT reward)
      .mockResolvedValueOnce({ rows: [] });
  }

  test('throws when conditions not met', async () => {
    mockGetStatusQueries({ user: [{ level: 10, prestige_level: 0 }] });
    await expect(service.claimPrestige(1)).rejects.toThrow('Conditions not met');
  });

  test('throws when max prestige already reached', async () => {
    query.mockResolvedValueOnce({ rows: [{ level: 30, prestige_level: 3 }] });
    await expect(service.claimPrestige(1)).rejects.toThrow('Max prestige reached');
  });

  test('successful claim returns prestigeLevel=1 for first prestige', async () => {
    setupEligibleStatus();
    setupTransactionSuccess();

    const result = await service.claimPrestige(1);

    expect(result.prestigeLevel).toBe(1);
    expect(result.label).toBe('Первый Горизонт');
    expect(result.icon).toBe('✦');
  });

  test('successful claim returns prestigeLevel=2 for second prestige', async () => {
    mockGetStatusQueries({ user: [{ level: 30, prestige_level: 1 }] });
    setupTransactionSuccess();

    const result = await service.claimPrestige(1);
    expect(result.prestigeLevel).toBe(2);
    expect(result.label).toBe('Второй Горизонт');
  });

  test('successful claim returns prestigeLevel=3 for third prestige', async () => {
    mockGetStatusQueries({ user: [{ level: 30, prestige_level: 2 }] });
    setupTransactionSuccess();

    const result = await service.claimPrestige(1);
    expect(result.prestigeLevel).toBe(3);
    expect(result.label).toBe('Третий Горизонт');
    expect(result.icon).toBe('✦✦✦');
  });

  test('resets user table with correct values', async () => {
    setupEligibleStatus();
    setupTransactionSuccess();

    await service.claimPrestige(42);

    const updateCall = clientMock.query.mock.calls.find(
      (args) => args[0].includes('UPDATE users SET') && args[0].includes('prestige_level')
    );
    expect(updateCall).toBeDefined();
    expect(updateCall[1]).toEqual([42, 1]);
  });

  test('cancels in-progress expeditions', async () => {
    setupEligibleStatus();
    setupTransactionSuccess();

    await service.claimPrestige(42);

    const expedCall = clientMock.query.mock.calls.find(
      (args) => args[0].includes('UPDATE expeditions') && args[0].includes('collected')
    );
    expect(expedCall).toBeDefined();
    expect(expedCall[1]).toEqual([42]);
  });

  test('deletes all ship modules', async () => {
    setupEligibleStatus();
    setupTransactionSuccess();

    await service.claimPrestige(42);

    const deleteCall = clientMock.query.mock.calls.find(
      (args) => args[0].includes('DELETE FROM ship_modules')
    );
    expect(deleteCall).toBeDefined();
    expect(deleteCall[1]).toEqual([42]);
  });

  test('deletes inventory items except NFT containers', async () => {
    setupEligibleStatus();
    setupTransactionSuccess();

    await service.claimPrestige(42);

    const invCall = clientMock.query.mock.calls.find(
      (args) => args[0].includes('DELETE FROM inventory_items') &&
                args[0].includes("find_type <> 'nft_container'")
    );
    expect(invCall).toBeDefined();
    expect(invCall[1]).toEqual([42]);
  });

  test('gives NFT container reward', async () => {
    setupEligibleStatus();
    setupTransactionSuccess();

    await service.claimPrestige(42);

    const nftCall = clientMock.query.mock.calls.find(
      (args) => args[0].includes('INSERT INTO inventory_items') &&
                args[0].includes('nft_container')
    );
    expect(nftCall).toBeDefined();
    expect(nftCall[1][0]).toBe(42);
    const objectData = JSON.parse(nftCall[1][1]);
    expect(objectData.outcomeType).toBe('prestige_nft');
    expect(objectData.prestigeLevel).toBe(1);
  });

  test('records prestige history', async () => {
    setupEligibleStatus();
    setupTransactionSuccess();

    await service.claimPrestige(99);

    const historyCall = clientMock.query.mock.calls.find(
      (args) => args[0].includes('INSERT INTO user_prestiges')
    );
    expect(historyCall).toBeDefined();
    expect(historyCall[1][0]).toBe(99);
    expect(historyCall[1][1]).toBe(1);
  });

  test('deletes all expected tables on reset', async () => {
    setupEligibleStatus();
    setupTransactionSuccess();

    await service.claimPrestige(42);

    const deletedTables = clientMock.query.mock.calls
      .filter((args) => String(args[0]).startsWith('DELETE FROM'))
      .map((args) => String(args[0]).match(/DELETE FROM (\w+)/)?.[1]);

    expect(deletedTables).toContain('ship_modules');
    expect(deletedTables).toContain('user_active_buffs');
    expect(deletedTables).toContain('user_quests');
    expect(deletedTables).toContain('user_quest_refresh');
    expect(deletedTables).toContain('user_quest_items');
    expect(deletedTables).toContain('user_faction_reputation');
    expect(deletedTables).toContain('user_story_items');
    expect(deletedTables).toContain('user_story_dialog_progress');
    expect(deletedTables).toContain('user_drills');
    expect(deletedTables).toContain('mini_tournament_progress');
    expect(deletedTables).toContain('user_exhibitions');
    expect(deletedTables).toContain('smuggler_exchanges');
    expect(deletedTables).toContain('user_collections');
    expect(deletedTables).toContain('inventory_items');
  });
});

describe('PrestigeService.notifyAdminPrestige', () => {
  test('calls sendAdminNotification with correct prestige info', async () => {
    const mockNft = { sendAdminNotification: jest.fn().mockResolvedValue(undefined) };
    const service = new PrestigeService(mockNft, null);

    await service.notifyAdminPrestige({ id: 1, username: 'testuser', first_name: 'Test' }, 1);

    expect(mockNft.sendAdminNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 1,
        username: 'testuser',
        outcomeType: 'prestige_reward',
      })
    );
    expect(mockNft.sendAdminNotification.mock.calls[0][0].outcomeLabel).toContain('ПРЕСТИЖ 1');
  });

  test('does not throw when nftNotificationService is null', async () => {
    const service = new PrestigeService(null, null);
    await expect(
      service.notifyAdminPrestige({ id: 1 }, 1)
    ).resolves.not.toThrow();
  });

  test('notifies with correct level 3 label', async () => {
    const mockNft = { sendAdminNotification: jest.fn().mockResolvedValue(undefined) };
    const service = new PrestigeService(mockNft, null);

    await service.notifyAdminPrestige({ id: 5, username: 'hero' }, 3);

    const label = mockNft.sendAdminNotification.mock.calls[0][0].outcomeLabel;
    expect(label).toContain('ПРЕСТИЖ 3');
    expect(label).toContain('Третий Горизонт');
  });
});

describe('PrestigeService.checkPrestigeAchievements', () => {
  test('calls achievementService.checkAndAward with userId', async () => {
    const mockAchievement = { checkAndAward: jest.fn().mockResolvedValue(undefined) };
    const service = new PrestigeService(null, mockAchievement);

    await service.checkPrestigeAchievements(42);
    expect(mockAchievement.checkAndAward).toHaveBeenCalledWith(42);
  });

  test('does not throw when achievementService is null', async () => {
    const service = new PrestigeService(null, null);
    await expect(service.checkPrestigeAchievements(1)).resolves.not.toThrow();
  });
});

describe('PrestigeService PRESTIGE_LEVELS constant', () => {
  test('has exactly 3 prestige levels', () => {
    expect(PrestigeService.PRESTIGE_LEVELS).toHaveLength(3);
  });

  test('levels are 1, 2, 3 in order', () => {
    const levels = PrestigeService.PRESTIGE_LEVELS.map((p) => p.level);
    expect(levels).toEqual([1, 2, 3]);
  });

  test('each level has label and icon', () => {
    for (const p of PrestigeService.PRESTIGE_LEVELS) {
      expect(typeof p.label).toBe('string');
      expect(p.label.length).toBeGreaterThan(0);
      expect(typeof p.icon).toBe('string');
    }
  });

  test('prestige 3 icon has three diamond symbols', () => {
    const p3 = PrestigeService.PRESTIGE_LEVELS.find((p) => p.level === 3);
    expect(p3.icon).toBe('✦✦✦');
  });
});
