'use strict';

jest.mock('../db/pool', () => ({ query: jest.fn() }));
jest.mock('../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const { query } = require('../db/pool');
const ChatExpeditionService = require('./chatExpeditionService');

// ── Shared fixtures ─────────────────────────────────────────────────────────

const MOCK_CONFIG = {
  zones: [
    { id: 'galaxy_outskirts', name: 'Окраина галактики', minLevel: 1,  creditMultiplier: 1.0 },
    { id: 'asteroid_field',   name: 'Астероидное поле',  minLevel: 5,  creditMultiplier: 1.1 },
    { id: 'anomalous_zone',   name: 'Аномальная зона',   minLevel: 20, creditMultiplier: 1.8 },
  ],
  universe2: {
    zones: [
      { id: 'u2_shattered_void', name: 'Расколотая пустота', nameEn: 'Shattered Void', minLevel: 1,  creditMultiplier: 1.0 },
      { id: 'u2_temporal_rift',  name: 'Временной разлом',   nameEn: 'Temporal Rift',   minLevel: 20, creditMultiplier: 1.6 },
    ],
  },
  expedition: { speedUpCostStars: 3 },
};

const makeMockBot = () => ({
  sendMessage:           jest.fn().mockResolvedValue({ message_id: 99 }),
  answerCallbackQuery:   jest.fn().mockResolvedValue(true),
  editMessageText:       jest.fn().mockResolvedValue(true),
  editMessageReplyMarkup: jest.fn().mockResolvedValue(true),
  deleteMessage:         jest.fn().mockResolvedValue(true),
  sendPhoto:             jest.fn().mockResolvedValue({ photo: [{ file_id: 'fid1' }] }),
});

const makeMockExpeditionService = () => ({
  getActiveExpedition: jest.fn(),
  startExpedition:     jest.fn(),
  collectExpedition:   jest.fn(),
  takeAction:          jest.fn(),
  speedUpExpedition:   jest.fn(),
});

const makeService = (expSvc, config = MOCK_CONFIG) =>
  new ChatExpeditionService(expSvc || makeMockExpeditionService(), { config });

// ── Helper to make a group chat message ────────────────────────────────────

const makeMsg = (text, opts = {}) => ({
  chat: { id: -100, type: opts.chatType || 'supergroup', title: 'Test Chat' },
  from: {
    id: opts.userId || 111,
    username: opts.username || 'pilot',
    first_name: opts.firstName || 'Alex',
    language_code: opts.lang || 'ru',
  },
  message_id: 42,
  text,
});

// ════════════════════════════════════════════════════════════════════════════
// 1. Trigger-word detection
// ════════════════════════════════════════════════════════════════════════════

describe('isTriggerWord', () => {
  let svc;
  beforeEach(() => { svc = makeService(); });

  test.each(['fly', 'ship', 'флай', 'шип', 'FLY', 'Fly', 'SHIP'])(
    '"%s" is a trigger word', (word) => {
      expect(svc.isTriggerWord(word)).toBe(true);
    }
  );

  test.each(['zone', 'зона', 'зоны', 'fly zone', 'flying', '', '  ', 'hello', '/fly'])(
    '"%s" is NOT a trigger word', (word) => {
      expect(svc.isTriggerWord(word)).toBe(false);
    }
  );

  test('returns false for null/undefined', () => {
    expect(svc.isTriggerWord(null)).toBe(false);
    expect(svc.isTriggerWord(undefined)).toBe(false);
  });

  test('multi-word message is not a trigger', () => {
    expect(svc.isTriggerWord('fly now')).toBe(false);
  });
});

describe('isZoneTrigger', () => {
  let svc;
  beforeEach(() => { svc = makeService(); });

  test.each(['zone', 'зона', 'зоны', 'ZONE', 'Зона', 'ЗОНЫ'])(
    '"%s" is a zone trigger', (word) => {
      expect(svc.isZoneTrigger(word)).toBe(true);
    }
  );

  test.each(['fly', 'ship', 'zones', 'зонка', 'change zone', '/zone', ''])(
    '"%s" is NOT a zone trigger', (word) => {
      expect(svc.isZoneTrigger(word)).toBe(false);
    }
  );

  test('multi-word is not a zone trigger', () => {
    expect(svc.isZoneTrigger('zone 1')).toBe(false);
  });
});

describe('isGroupChat', () => {
  let svc;
  beforeEach(() => { svc = makeService(); });

  test('supergroup is group chat', () => {
    expect(svc.isGroupChat({ chat: { type: 'supergroup' } })).toBe(true);
  });

  test('group is group chat', () => {
    expect(svc.isGroupChat({ chat: { type: 'group' } })).toBe(true);
  });

  test('private is not group chat', () => {
    expect(svc.isGroupChat({ chat: { type: 'private' } })).toBe(false);
  });

  test('channel is not group chat', () => {
    expect(svc.isGroupChat({ chat: { type: 'channel' } })).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. _getBestZone
// ════════════════════════════════════════════════════════════════════════════

describe('_getBestZone', () => {
  let svc;
  beforeEach(() => { svc = makeService(); jest.clearAllMocks(); });

  test('returns highest creditMultiplier zone accessible to user level', () => {
    const zone = svc._getBestZone(10, MOCK_CONFIG, 1);
    expect(zone.id).toBe('asteroid_field'); // level 5, mult 1.1 (level 20 is locked)
  });

  test('returns only accessible zone when level is 1', () => {
    const zone = svc._getBestZone(1, MOCK_CONFIG, 1);
    expect(zone.id).toBe('galaxy_outskirts');
  });

  test('returns highest zone when all are accessible', () => {
    const zone = svc._getBestZone(25, MOCK_CONFIG, 1);
    expect(zone.id).toBe('anomalous_zone');
  });

  test('falls back to first zone if none accessible (edge case)', () => {
    // level 0 — nothing accessible, should fall back
    const zone = svc._getBestZone(0, MOCK_CONFIG, 1);
    expect(zone).not.toBeNull();
    expect(zone.id).toBe('galaxy_outskirts');
  });

  test('returns null for empty zones', () => {
    const cfg = { zones: [], universe2: { zones: [] } };
    expect(svc._getBestZone(5, cfg, 1)).toBeNull();
  });

  test('uses universe2 zones when universe === 2', () => {
    const zone = svc._getBestZone(1, MOCK_CONFIG, 2);
    expect(zone.id).toBe('u2_shattered_void');
  });

  test('respects minLevel for U2 zones', () => {
    const zone = svc._getBestZone(25, MOCK_CONFIG, 2);
    expect(zone.id).toBe('u2_temporal_rift');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. _getSpeedupCost & _chooseAction
// ════════════════════════════════════════════════════════════════════════════

describe('_getSpeedupCost', () => {
  let svc;
  beforeEach(() => { svc = makeService(); });

  test('returns config value for normal expedition', () => {
    expect(svc._getSpeedupCost({ isLongExpedition: false })).toBe(3);
  });

  test('returns 20 for long expedition', () => {
    expect(svc._getSpeedupCost({ isLongExpedition: true })).toBe(20);
  });

  test('falls back to 3 if config missing', () => {
    const svc2 = new ChatExpeditionService({}, { config: { zones: [] } });
    expect(svc2._getSpeedupCost({ isLongExpedition: false })).toBe(3);
  });
});

describe('_chooseAction', () => {
  let svc;
  beforeEach(() => { svc = makeService(); });

  test('asteroid → sell', () => expect(svc._chooseAction('asteroid')).toBe('sell'));
  test('nft_container → save_coords', () => expect(svc._chooseAction('nft_container')).toBe('save_coords'));
  test('story_item → collect', () => expect(svc._chooseAction('story_item')).toBe('collect'));
  test('artifact → collect', () => expect(svc._chooseAction('artifact')).toBe('collect'));
  test('creature → collect', () => expect(svc._chooseAction('creature')).toBe('collect'));
  test('debris → collect', () => expect(svc._chooseAction('debris')).toBe('collect'));
  test('echo → collect', () => expect(svc._chooseAction('echo')).toBe('collect'));
});

// ════════════════════════════════════════════════════════════════════════════
// 4. _buildDetailParts
// ════════════════════════════════════════════════════════════════════════════

describe('_buildDetailParts', () => {
  let svc;
  beforeEach(() => { svc = makeService(); });

  describe('artifact / relic', () => {
    test('uses "Цивилизация" label (not "Раса")', () => {
      const parts = svc._buildDetailParts(
        { findType: 'artifact', objectData: { race: 'Навигаторы', mass: 10 } },
        true
      );
      expect(parts.some(p => p.includes('Цивилизация'))).toBe(true);
      expect(parts.some(p => p.includes('Раса'))).toBe(false);
    });

    test('uses "Civilization" label in English', () => {
      const parts = svc._buildDetailParts(
        { findType: 'artifact', objectData: { race: 'Navigators', mass: 10 } },
        false
      );
      expect(parts.some(p => p.includes('Civilization'))).toBe(true);
      expect(parts.some(p => p.includes('Race'))).toBe(false);
    });

    test('shows precise mass for relic', () => {
      const parts = svc._buildDetailParts(
        { findType: 'relic', objectData: { race: 'Древние', mass: 6.143 } },
        true
      );
      expect(parts.some(p => p.includes('6.143'))).toBe(true);
    });

    test('omits race if not present', () => {
      const parts = svc._buildDetailParts(
        { findType: 'artifact', objectData: { mass: 5 } },
        true
      );
      expect(parts.every(p => !p.includes('Цивилизация'))).toBe(true);
    });
  });

  describe('creature / entity', () => {
    test('shows mass and "Разумное существо"', () => {
      const parts = svc._buildDetailParts(
        { findType: 'creature', objectData: { mass: 30, isIntelligent: true } },
        true
      );
      expect(parts.some(p => p.includes('Масса'))).toBe(true);
      expect(parts.some(p => p.includes('Разумное'))).toBe(true);
    });

    test('shows "Животное" for non-intelligent', () => {
      const parts = svc._buildDetailParts(
        { findType: 'creature', objectData: { mass: 5, isIntelligent: false } },
        true
      );
      expect(parts.some(p => p.includes('Животное'))).toBe(true);
    });

    test('entity type also shows mass', () => {
      const parts = svc._buildDetailParts(
        { findType: 'entity', objectData: { mass: 2.7 } },
        true
      );
      expect(parts.some(p => p.includes('2.7'))).toBe(true);
    });
  });

  describe('asteroid', () => {
    test('scanned asteroid shows resource, volume, condition', () => {
      const parts = svc._buildDetailParts({
        findType: 'asteroid',
        objectData: { scanned: true, resourceName: 'Железо', estimatedVolume: 42.5, condition: 90 },
      }, true);
      expect(parts.some(p => p.includes('Железо'))).toBe(true);
      expect(parts.some(p => p.includes('42.5'))).toBe(true);
      expect(parts.some(p => p.includes('90%'))).toBe(true);
    });

    test('unscanned asteroid shows placeholder', () => {
      const parts = svc._buildDetailParts(
        { findType: 'asteroid', objectData: { scanned: false } },
        true
      );
      expect(parts[0]).toMatch(/не сканирован/i);
    });
  });

  describe('anomaly / rift', () => {
    test('shows mass and integrity', () => {
      const parts = svc._buildDetailParts({
        findType: 'anomaly',
        objectData: { mass: 100, containerIntegrity: 75 },
      }, true);
      expect(parts.some(p => p.includes('Масса'))).toBe(true);
      expect(parts.some(p => p.includes('75%'))).toBe(true);
    });
  });

  describe('debris / echo / scrap', () => {
    test('shows mass and volume for debris', () => {
      const parts = svc._buildDetailParts({
        findType: 'debris',
        objectData: { mass: 20.5, volume: 3.1 },
      }, true);
      expect(parts.some(p => p.includes('20.5'))).toBe(true);
      expect(parts.some(p => p.includes('3.1'))).toBe(true);
    });

    test('shows mass and volume for echo (U2)', () => {
      const parts = svc._buildDetailParts({
        findType: 'echo',
        objectData: { mass: 8, volume: 2 },
      }, true);
      expect(parts.length).toBeGreaterThan(0);
    });
  });

  describe('story_item', () => {
    test('shows description', () => {
      const parts = svc._buildDetailParts({
        findType: 'story_item',
        objectData: { description: 'Загадочный артефакт' },
      }, true);
      expect(parts[0]).toContain('Загадочный артефакт');
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 5. _formatResultText
// ════════════════════════════════════════════════════════════════════════════

describe('_formatResultText', () => {
  let svc;
  beforeEach(() => { svc = makeService(); });

  const baseResult = (overrides = {}) => ({
    rarity: 'common', findType: 'debris', outcome: 'success',
    objectData: { name: 'Тестовый объект', mass: 10 },
    creditsGained: 0, crystalsGained: 0,
    xpGained: 20, saleCurrency: 'credits',
    baseCredits: 100, universe: 1,
    ...overrides,
  });

  describe('header', () => {
    test('starts with "Экспедиция вернулась!" in Russian', () => {
      const text = svc._formatResultText(baseResult(), 'ru');
      expect(text).toMatch(/Экспедиция вернулась/);
    });

    test('starts with "Expedition returned!" in English', () => {
      const text = svc._formatResultText(baseResult(), 'en');
      expect(text).toMatch(/Expedition returned/);
    });
  });

  describe('item name placement', () => {
    test('item name appears before Редкость line', () => {
      const text = svc._formatResultText(baseResult({ objectData: { name: 'Металлолом', mass: 5 } }), 'ru');
      const nameIdx = text.indexOf('Металлолом');
      const rarityIdx = text.indexOf('Редкость');
      expect(nameIdx).toBeGreaterThan(-1);
      expect(rarityIdx).toBeGreaterThan(nameIdx);
    });

    test('labeled Редкость line present', () => {
      const text = svc._formatResultText(baseResult({ rarity: 'rare' }), 'ru');
      expect(text).toMatch(/Редкость:/);
    });

    test('labeled Тип line present', () => {
      const text = svc._formatResultText(baseResult({ findType: 'artifact' }), 'ru');
      expect(text).toMatch(/Тип:/);
    });
  });

  describe('voice lines (only legendary+)', () => {
    const rarityVoiceExpected = [
      ['legendary',   true],
      ['mythical',    true],
      ['hybrid',      true],
      ['singularity', true],
      ['epic',        false],
      ['exotic',      false],
      ['ancient',     false],
      ['relic',       false],
      ['common',      false],
      ['rare',        false],
    ];

    test.each(rarityVoiceExpected)(
      'rarity "%s" voice present: %s',
      (rarity, expectVoice) => {
        const text = svc._formatResultText(baseResult({ rarity }), 'ru');
        // Voice lines are bolded with * and contain all-caps words
        const lines = text.split('\n');
        // Voice line is the one that's bolded *...* and not the header
        const voiceLine = lines.slice(1).find(l =>
          l.startsWith('*') && l.endsWith('*') && l.length > 2
        );
        if (expectVoice) {
          expect(voiceLine).toBeTruthy();
        } else {
          expect(voiceLine).toBeFalsy();
        }
      }
    );
  });

  describe('currency display', () => {
    test('U1 collected item shows 🪙 estimate', () => {
      const text = svc._formatResultText(baseResult({ universe: 1, baseCredits: 100 }), 'ru');
      expect(text).toMatch(/🪙.*~100/);
    });

    test('U1 sold item shows 🪙 actual amount', () => {
      const text = svc._formatResultText(
        baseResult({ universe: 1, creditsGained: 250, baseCredits: 100 }),
        'ru'
      );
      expect(text).toMatch(/🪙.*\+250/);
    });

    test('U2 collected item shows 💎 estimate', () => {
      const text = svc._formatResultText(
        baseResult({ universe: 2, baseCredits: 55, saleCurrency: 'credits' }),
        'ru'
      );
      expect(text).toMatch(/💎.*~55/);
      expect(text).not.toMatch(/🪙/);
    });

    test('U2 sold item shows 💎 actual crystals', () => {
      const text = svc._formatResultText(
        baseResult({ universe: 2, crystalsGained: 38, creditsGained: 38, saleCurrency: 'crystals' }),
        'ru'
      );
      expect(text).toMatch(/💎.*\+38/);
      expect(text).not.toMatch(/🪙/);
    });

    test('no currency line when everything is zero', () => {
      const text = svc._formatResultText(
        baseResult({ creditsGained: 0, baseCredits: 0, crystalsGained: 0, xpGained: 0 }),
        'ru'
      );
      expect(text).not.toMatch(/🪙|💎/);
    });

    test('XP shown on same line as currency', () => {
      const text = svc._formatResultText(
        baseResult({ creditsGained: 100, xpGained: 30 }),
        'ru'
      );
      // Both on one line (no newline between them)
      const rewardLine = text.split('\n').find(l => l.includes('🪙') || l.includes('XP'));
      expect(rewardLine).toMatch(/🪙/);
      expect(rewardLine).toMatch(/XP/);
    });
  });

  describe('special outcomes', () => {
    test('cargo_full shows "Трюм переполнен"', () => {
      const text = svc._formatResultText(
        baseResult({ outcome: 'cargo_full', creditsGained: 50, xpGained: 10 }),
        'ru'
      );
      expect(text).toMatch(/Трюм переполнен/);
      expect(text).toMatch(/Редкость:/);
      expect(text).toMatch(/Тип:/);
    });

    test('no_capsule shows "Нет капсулы"', () => {
      const text = svc._formatResultText(
        baseResult({ outcome: 'no_capsule', findType: 'creature' }),
        'ru'
      );
      expect(text).toMatch(/Нет капсулы/);
    });

    test('nft_container shows NFT message', () => {
      const text = svc._formatResultText(
        baseResult({ findType: 'nft_container' }),
        'ru'
      );
      expect(text).toMatch(/NFT/);
      expect(text).toMatch(/Администратор/);
    });
  });

  describe('level up and gene enhancer', () => {
    test('leveledUp shows level message', () => {
      const text = svc._formatResultText(
        baseResult({ leveledUp: true, newLevel: 7 }),
        'ru'
      );
      expect(text).toMatch(/Уровень 7/);
    });

    test('geneEnhancerProc shows upgrade line', () => {
      const text = svc._formatResultText(
        baseResult({ geneEnhancerProc: { originalRarity: 'common', upgradedRarity: 'rare' } }),
        'ru'
      );
      expect(text).toMatch(/Генный усилитель/);
      expect(text).toMatch(/→/);
    });
  });

  describe('precise mass in details', () => {
    test('mass 6.143 shown as 6.143 (not 6)', () => {
      const text = svc._formatResultText(
        baseResult({ findType: 'artifact', objectData: { name: 'Арт', race: 'X', mass: 6.143 } }),
        'ru'
      );
      expect(text).toMatch(/6\.143/);
    });

    test('integer mass shown without decimals', () => {
      const text = svc._formatResultText(
        baseResult({ findType: 'artifact', objectData: { name: 'Арт', mass: 10 } }),
        'ru'
      );
      // Should show "10 кг" not "10.000 кг"
      expect(text).toMatch(/10 кг/);
    });
  });

  describe('detail lines — each on own line', () => {
    test('Цивилизация and Масса are on separate lines', () => {
      const text = svc._formatResultText(
        baseResult({
          findType: 'relic',
          objectData: { name: 'Древний объект', race: 'Предтечи', mass: 15.5 },
        }),
        'ru'
      );
      const lines = text.split('\n');
      const civLine  = lines.find(l => l.includes('Цивилизация'));
      const massLine = lines.find(l => l.includes('Масса'));
      expect(civLine).toBeTruthy();
      expect(massLine).toBeTruthy();
      expect(civLine).not.toBe(massLine);
    });

    test('detail lines are NOT joined with " • "', () => {
      const text = svc._formatResultText(
        baseResult({
          findType: 'relic',
          objectData: { name: 'Obj', race: 'Aliens', mass: 5 },
        }),
        'ru'
      );
      expect(text).not.toContain(' • ');
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 6. handleLongToggle
// ════════════════════════════════════════════════════════════════════════════

describe('handleLongToggle', () => {
  let svc, bot, msg;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = makeService();
    bot = makeMockBot();
    msg = makeMsg('/long', { userId: 111, lang: 'ru' });
  });

  test('shows error if user not found in DB', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await svc.handleLongToggle(bot, msg);
    expect(bot.sendMessage).not.toHaveBeenCalled();
  });

  test('shows error if no Particle Decelerator', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ language_code: 'ru' }] })   // user lookup
      .mockResolvedValueOnce({ rows: [] });                           // no decelerator
    await svc.handleLongToggle(bot, msg);
    const text = bot.sendMessage.mock.calls[0][1];
    expect(text).toMatch(/Замедлитель/);
    expect(svc._userLongMode.get(111)).toBeFalsy();
  });

  test('toggles ON when off and decelerator available', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ language_code: 'ru' }] })
      .mockResolvedValueOnce({ rows: [{}] });
    svc._userLongMode.set(111, false);
    await svc.handleLongToggle(bot, msg);
    expect(svc._userLongMode.get(111)).toBe(true);
    const text = bot.sendMessage.mock.calls[0][1];
    expect(text).toMatch(/[Дд]олгая/);
  });

  test('toggles OFF when on', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ language_code: 'ru' }] })
      .mockResolvedValueOnce({ rows: [{}] });
    svc._userLongMode.set(111, true);
    await svc.handleLongToggle(bot, msg);
    expect(svc._userLongMode.get(111)).toBe(false);
    const text = bot.sendMessage.mock.calls[0][1];
    expect(text).toMatch(/[Бб]ыстрая/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 7. handleZoneCommand
// ════════════════════════════════════════════════════════════════════════════

describe('handleZoneCommand', () => {
  let svc, bot, msg;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = makeService();
    bot = makeMockBot();
    msg = makeMsg('зона', { userId: 111, lang: 'ru' });
  });

  test('shows error if user not in DB', async () => {
    // Make all DB calls return empty result to simulate user not present
    query.mockResolvedValue({ rows: [] });
    await svc.handleZoneCommand(bot, msg);
    expect(bot.sendMessage).toHaveBeenCalled();
    const text = bot.sendMessage.mock.calls[0][1] || '';
    expect(text).toMatch(/fly|Сначала/);
  });

  test('shows zone keyboard for U1 user', async () => {
    query.mockResolvedValueOnce({ rows: [{ level: 10, current_universe: 1, language_code: 'ru' }] });
    await svc.handleZoneCommand(bot, msg);
    const call = bot.sendMessage.mock.calls[0];
    const markup = call[2].reply_markup;
    const allButtons = markup.inline_keyboard.flat();
    // galaxy_outskirts and asteroid_field accessible, anomalous_zone locked
    expect(allButtons.some(b => b.callback_data.startsWith('cxzone:'))).toBe(true);
    expect(allButtons.some(b => b.text.includes('🔒'))).toBe(true);
  });

  test('locked zones use cxzlock callback', async () => {
    query.mockResolvedValueOnce({ rows: [{ level: 1, current_universe: 1, language_code: 'ru' }] });
    await svc.handleZoneCommand(bot, msg);
    const allButtons = bot.sendMessage.mock.calls[0][2].reply_markup.inline_keyboard.flat();
    const lockedButtons = allButtons.filter(b => b.callback_data.startsWith('cxzlock:'));
    expect(lockedButtons.length).toBeGreaterThan(0);
  });

  test('current preferred zone marked with ✅', async () => {
    svc._userZonePref.set(111, 'asteroid_field');
    query.mockResolvedValueOnce({ rows: [{ level: 10, current_universe: 1, language_code: 'ru' }] });
    await svc.handleZoneCommand(bot, msg);
    const allButtons = bot.sendMessage.mock.calls[0][2].reply_markup.inline_keyboard.flat();
    const current = allButtons.find(b => b.text.startsWith('✅'));
    expect(current).toBeTruthy();
    expect(current.callback_data).toContain('asteroid_field');
  });

  test('shows U2 zone names for U2 user', async () => {
    query.mockResolvedValueOnce({ rows: [{ level: 5, current_universe: 2, language_code: 'ru' }] });
    await svc.handleZoneCommand(bot, msg);
    const allButtons = bot.sendMessage.mock.calls[0][2].reply_markup.inline_keyboard.flat();
    const u2Zone = allButtons.find(b => b.callback_data.includes('u2_shattered_void'));
    expect(u2Zone).toBeTruthy();
    expect(u2Zone.text).toContain('Расколотая пустота');
  });

  test('shows English zone names for EN user', async () => {
    const enMsg = makeMsg('zone', { userId: 111, lang: 'en' });
    query.mockResolvedValueOnce({ rows: [{ level: 5, current_universe: 2, language_code: 'en' }] });
    await svc.handleZoneCommand(bot, enMsg);
    const allButtons = bot.sendMessage.mock.calls[0][2].reply_markup.inline_keyboard.flat();
    const u2Zone = allButtons.find(b => b.callback_data.includes('u2_shattered_void'));
    expect(u2Zone.text).toContain('Shattered Void');
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 8. handleZoneSelect
// ════════════════════════════════════════════════════════════════════════════

describe('handleZoneSelect', () => {
  let svc, bot;
  const makeCbq = (userId, zoneId, fromId = null) => ({
    id: 'cbq1',
    data: `cxzone:${userId}:${zoneId}`,
    from: { id: fromId ?? userId, language_code: 'ru' },
    message: { chat: { id: -100 }, message_id: 55 },
  });

  beforeEach(() => {
    jest.clearAllMocks();
    svc = makeService();
    bot = makeMockBot();
  });

  test('rejects if a different user clicks the button', async () => {
    const cbq = makeCbq(111, 'galaxy_outskirts', 222);
    await svc.handleZoneSelect(bot, cbq);
    expect(bot.answerCallbackQuery).toHaveBeenCalledWith('cbq1', { text: '⛔', show_alert: false });
    expect(svc._userZonePref.get(111)).toBeUndefined();
  });

  test('shows error if zone not found in config', async () => {
    query.mockResolvedValueOnce({ rows: [{ language_code: 'ru', current_universe: 1 }] });
    const cbq = makeCbq(111, 'nonexistent_zone');
    await svc.handleZoneSelect(bot, cbq);
    expect(bot.answerCallbackQuery).toHaveBeenCalledWith('cbq1', {
      text: expect.stringMatching(/не найдена|not found/i),
      show_alert: true,
    });
  });

  test('sets zone preference and edits message on valid selection', async () => {
    query.mockResolvedValueOnce({ rows: [{ language_code: 'ru', current_universe: 1 }] });
    const cbq = makeCbq(111, 'asteroid_field');
    await svc.handleZoneSelect(bot, cbq);
    expect(svc._userZonePref.get(111)).toBe('asteroid_field');
    expect(bot.editMessageText).toHaveBeenCalledWith(
      expect.stringMatching(/Астероидное поле/),
      expect.any(Object)
    );
  });

  test('uses nameEn for English U2 zone', async () => {
    query.mockResolvedValueOnce({ rows: [{ language_code: 'en', current_universe: 2 }] });
    const cbq = {
      id: 'cbq2',
      data: 'cxzone:111:u2_shattered_void',
      from: { id: 111 },
      message: { chat: { id: -100 }, message_id: 55 },
    };
    await svc.handleZoneSelect(bot, cbq);
    expect(bot.editMessageText).toHaveBeenCalledWith(
      expect.stringMatching(/Shattered Void/),
      expect.any(Object)
    );
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 9. handleZoneLocked
// ════════════════════════════════════════════════════════════════════════════

describe('handleZoneLocked', () => {
  let svc, bot;

  beforeEach(() => {
    jest.clearAllMocks();
    svc = makeService();
    bot = makeMockBot();
  });

  test('shows alert with required level', async () => {
    query.mockResolvedValueOnce({ rows: [{ language_code: 'ru' }] });
    const cbq = {
      id: 'cbq1',
      data: 'cxzlock:111:20',
      from: { id: 111 },
    };
    await svc.handleZoneLocked(bot, cbq);
    expect(bot.answerCallbackQuery).toHaveBeenCalledWith('cbq1', {
      text: expect.stringMatching(/20/),
      show_alert: true,
    });
  });

  test('shows alert in English', async () => {
    query.mockResolvedValueOnce({ rows: [{ language_code: 'en' }] });
    const cbq = {
      id: 'cbq2',
      data: 'cxzlock:111:15',
      from: { id: 111 },
    };
    await svc.handleZoneLocked(bot, cbq);
    const callArg = bot.answerCallbackQuery.mock.calls[0][1];
    expect(callArg.text).toMatch(/level 15/i);
    expect(callArg.show_alert).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 10. registerChatOwner
// ════════════════════════════════════════════════════════════════════════════

describe('registerChatOwner', () => {
  let svc;
  beforeEach(() => {
    jest.clearAllMocks();
    svc = makeService();
  });

  test('creates new link code when none exists', async () => {
    // Simulate no existing record and a successful INSERT returning chat_title
    query.mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ chat_title: 'Test Chat' }] });

    const res = await svc.registerChatOwner(-1000, 777, 'ownerUser');
    expect(res).toBeTruthy();
    expect(res.success).toBe(true);
    // linkCode is generated by the service; assert shape instead of exact value
    expect(typeof res.linkCode).toBe('string');
    expect(res.linkCode.length).toBeGreaterThanOrEqual(6);
    expect(res.chatTitle).toBe('Test Chat');
  });

  test('returns owner_mismatch when existing owner differs', async () => {
    query.mockResolvedValueOnce({ rows: [{ link_code: 'exist', owner_user_id: 999 }] });
    const res = await svc.registerChatOwner(-2000, 777, 'ownerUser');
    expect(res).toBeTruthy();
    expect(res.error).toBe('owner_mismatch');
    expect(res.existingOwnerId).toBe(999);
    expect(res.linkCode).toBe('exist');
  });
});


// ════════════════════════════════════════════════════════════════════════════
// 10. _startExpedition — zone preference, long mode, error handling
// ════════════════════════════════════════════════════════════════════════════

describe('_startExpedition', () => {
  let svc, bot, expSvc, msg, user;

  beforeEach(() => {
    jest.clearAllMocks();
    expSvc = makeMockExpeditionService();
    svc = makeService(expSvc);
    bot = makeMockBot();
    msg = makeMsg('fly', { userId: 111 });
    user = { id: 111, level: 10, current_universe: 1 };
  });

  const okStart = (overrides = {}) => expSvc.startExpedition.mockResolvedValueOnce({
    expeditionId: 'exp1',
    endsAt: new Date(Date.now() + 60_000),
    isLongExpedition: false,
    ...overrides,
  });

  test('uses preferred zone if set and accessible', async () => {
    svc._userZonePref.set(111, 'galaxy_outskirts');
    okStart();
    await svc._startExpedition(bot, msg, 111, user, 'ru');
    expect(expSvc.startExpedition).toHaveBeenCalledWith(111, expect.objectContaining({ zoneId: 'galaxy_outskirts' }));
  });

  test('falls back to best zone if preference level too high', async () => {
    svc._userZonePref.set(111, 'anomalous_zone'); // requires level 20, user is level 10
    okStart();
    await svc._startExpedition(bot, msg, 111, user, 'ru');
    // Should use best accessible zone (asteroid_field, creditMult 1.1) not galaxy_outskirts
    expect(expSvc.startExpedition).toHaveBeenCalledWith(111, expect.objectContaining({ zoneId: 'asteroid_field' }));
  });

  test('uses longExpedition=false by default', async () => {
    okStart();
    await svc._startExpedition(bot, msg, 111, user, 'ru');
    expect(expSvc.startExpedition).toHaveBeenCalledWith(111, expect.objectContaining({ longExpedition: false }));
  });

  test('long mode with decelerator sends longExpedition=true', async () => {
    svc._userLongMode.set(111, true);
    query.mockResolvedValueOnce({ rows: [{}] }); // has decelerator
    okStart({ isLongExpedition: true });
    await svc._startExpedition(bot, msg, 111, user, 'ru');
    expect(expSvc.startExpedition).toHaveBeenCalledWith(111, expect.objectContaining({ longExpedition: true }));
    const text = bot.sendMessage.mock.calls[0][1];
    expect(text).toMatch(/[Дд]олгая/);
  });

  test('long mode without decelerator auto-switches to fast and warns', async () => {
    svc._userLongMode.set(111, true);
    query.mockResolvedValueOnce({ rows: [] }); // no decelerator
    okStart();
    await svc._startExpedition(bot, msg, 111, user, 'ru');
    // First message is the warning — "Замедлите" is the common root (Замедлителя / Замедлитель)
    const warn = bot.sendMessage.mock.calls[0][1];
    expect(warn).toMatch(/Замедлите|Decelerator/);
    // Long mode cleared
    expect(svc._userLongMode.get(111)).toBe(false);
    // Still starts expedition
    expect(expSvc.startExpedition).toHaveBeenCalledWith(111, expect.objectContaining({ longExpedition: false }));
  });

  test('handles travelUntil error (universe travel in progress)', async () => {
    const travelUntil = new Date(Date.now() + 2 * 3600 * 1000);
    expSvc.startExpedition.mockRejectedValueOnce({ status: 409, travelUntil });
    await svc._startExpedition(bot, msg, 111, user, 'ru');
    const text = bot.sendMessage.mock.calls[0][1];
    expect(text).toMatch(/перелёт|universes/i);
    expect(text).toMatch(/Осталось:/);
  });

  test('handles pirate cooldown error', async () => {
    const cooldownUntil = new Date(Date.now() + 30 * 60 * 1000);
    expSvc.startExpedition.mockRejectedValueOnce({ status: 403, cooldownUntil });
    await svc._startExpedition(bot, msg, 111, user, 'ru');
    const text = bot.sendMessage.mock.calls[0][1];
    expect(text).toMatch(/пират|damaged/i);
  });

  test('handles race condition (409 without travelUntil)', async () => {
    expSvc.startExpedition.mockRejectedValueOnce({ status: 409 });
    expSvc.getActiveExpedition.mockResolvedValueOnce({
      status: 'in_progress', endsAt: new Date(Date.now() + 60_000),
    });
    await svc._startExpedition(bot, msg, 111, user, 'ru');
    const text = bot.sendMessage.mock.calls[0][1];
    expect(text).toMatch(/уже в пути|already in progress/i);
  });

  test('launch message shows zone name', async () => {
    okStart();
    await svc._startExpedition(bot, msg, 111, user, 'ru');
    const text = bot.sendMessage.mock.calls.slice(-1)[0][1];
    expect(text).toMatch(/Зона:/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 11. handleCommand — routing logic
// ════════════════════════════════════════════════════════════════════════════

describe('handleCommand routing', () => {
  let svc, bot, expSvc, msg;

  const userRow = { id: 111, level: 5, current_universe: 1, language_code: 'ru', first_name: 'Alex' };

  beforeEach(() => {
    jest.clearAllMocks();
    expSvc = makeMockExpeditionService();
    svc = makeService(expSvc);
    bot = makeMockBot();
    msg = makeMsg('fly', { userId: 111 });

    // _getOrCreateUser: existing user
    query.mockResolvedValue({ rows: [userRow] });
  });

  test('shows remaining time when expedition in_progress', async () => {
    expSvc.getActiveExpedition.mockResolvedValueOnce({
      status: 'in_progress',
      endsAt: new Date(Date.now() + 300_000), // 5 min
      expeditionId: 'exp1',
      wasSpedUp: false,
      isLongExpedition: false,
    });
    await svc.handleCommand(bot, msg);
    const text = bot.sendMessage.mock.calls.slice(-1)[0][1];
    expect(text).toMatch(/Осталось:/);
  });

  test('shows speedup button when not sped up', async () => {
    expSvc.getActiveExpedition.mockResolvedValueOnce({
      status: 'in_progress',
      endsAt: new Date(Date.now() + 300_000),
      expeditionId: 'exp1',
      wasSpedUp: false,
      isLongExpedition: false,
    });
    await svc.handleCommand(bot, msg);
    const call = bot.sendMessage.mock.calls.slice(-1)[0];
    expect(call[2]?.reply_markup?.inline_keyboard).toBeTruthy();
  });

  test('no speedup button when already sped up', async () => {
    expSvc.getActiveExpedition.mockResolvedValueOnce({
      status: 'in_progress',
      endsAt: new Date(Date.now() + 300_000),
      expeditionId: 'exp1',
      wasSpedUp: true,
      isLongExpedition: false,
    });
    await svc.handleCommand(bot, msg);
    const call = bot.sendMessage.mock.calls.slice(-1)[0];
    expect(call[2]?.reply_markup).toBeUndefined();
  });

  test('shows pirate message when pirate_pending', async () => {
    expSvc.getActiveExpedition.mockResolvedValueOnce({ status: 'pirate_pending' });
    await svc.handleCommand(bot, msg);
    const text = bot.sendMessage.mock.calls.slice(-1)[0][1];
    expect(text).toMatch(/пират/i);
  });

  test('new user gets welcome message before expedition start', async () => {
    // First call: user not found → _getOrCreateUser inserts
    query
      .mockResolvedValueOnce({ rows: [] })            // SELECT existing user
      .mockResolvedValueOnce({ rows: [userRow] })     // INSERT returning
      .mockResolvedValueOnce({ rows: [] })            // ship_modules insert
      .mockResolvedValueOnce({ rows: [] });           // chat_sources upsert

    expSvc.getActiveExpedition.mockResolvedValueOnce(null);
    expSvc.startExpedition.mockResolvedValueOnce({
      endsAt: new Date(Date.now() + 60_000),
      isLongExpedition: false,
    });

    await svc.handleCommand(bot, msg);
    // First bot message should be the welcome
    const firstText = bot.sendMessage.mock.calls[0][1];
    expect(firstText).toMatch(/Привет|Hi/);
  });

  test('starts new expedition when no active', async () => {
    expSvc.getActiveExpedition.mockResolvedValueOnce(null);
    expSvc.startExpedition.mockResolvedValueOnce({
      endsAt: new Date(Date.now() + 60_000),
      isLongExpedition: false,
    });
    await svc.handleCommand(bot, msg);
    expect(expSvc.startExpedition).toHaveBeenCalled();
  });
});

describe('chat cleanup behavior', () => {
  let svc, bot, expSvc, msg;
  const userRow = { id: 111, level: 5, current_universe: 1, language_code: 'ru', first_name: 'Alex' };
  const cleanupOn = { rows: [{ enabled: true }] };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    expSvc = makeMockExpeditionService();
    svc = makeService(expSvc);
    bot = makeMockBot();
    msg = makeMsg('fly', { userId: 111 });
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  test('does not delete user fly message or expedition launch message', async () => {
    query
      .mockResolvedValueOnce({ rows: [userRow] })
      .mockResolvedValueOnce(cleanupOn);
    expSvc.getActiveExpedition.mockResolvedValueOnce(null);
    expSvc.startExpedition.mockResolvedValueOnce({
      expeditionId: 'exp1',
      endsAt: new Date(Date.now() + 600_000),
      isLongExpedition: false,
    });
    bot.sendMessage.mockResolvedValueOnce({ message_id: 101 });

    await svc.handleCommand(bot, msg);
    jest.advanceTimersByTime(60_000);

    expect(bot.deleteMessage).not.toHaveBeenCalled();
  });

  test('deletes only low-rarity returned expedition message after one minute', async () => {
    query
      .mockResolvedValueOnce({ rows: [userRow] })
      .mockResolvedValueOnce({ rows: [userRow] })
      .mockResolvedValueOnce(cleanupOn);
    expSvc.getActiveExpedition.mockResolvedValueOnce({ status: 'completed', expeditionId: 'exp1', universe: 1 });
    expSvc.collectExpedition.mockResolvedValueOnce({
      outcome: 'cargo_full',
      rarity: 'common',
      findType: 'debris',
      objectData: { name: 'Scrap' },
      xpGained: 10,
    });
    expSvc.startExpedition.mockResolvedValueOnce({
      expeditionId: 'exp2',
      endsAt: new Date(Date.now() + 600_000),
      isLongExpedition: false,
    });
    bot.sendMessage
      .mockResolvedValueOnce({ message_id: 201 })
      .mockResolvedValueOnce({ message_id: 202 });

    await svc.handleCommand(bot, msg);
    jest.advanceTimersByTime(60_000);

    expect(bot.deleteMessage).toHaveBeenCalledTimes(1);
    expect(bot.deleteMessage).toHaveBeenCalledWith(-100, 201);
    expect(bot.deleteMessage).not.toHaveBeenCalledWith(-100, 42);
    expect(bot.deleteMessage).not.toHaveBeenCalledWith(-100, 202);
  });

  test('keeps required-rarity returned expedition message', async () => {
    query
      .mockResolvedValueOnce({ rows: [userRow] })
      .mockResolvedValueOnce({ rows: [userRow] })
      .mockResolvedValueOnce(cleanupOn);
    expSvc.getActiveExpedition.mockResolvedValueOnce({ status: 'completed', expeditionId: 'exp1', universe: 1 });
    expSvc.collectExpedition.mockResolvedValueOnce({
      outcome: 'cargo_full',
      rarity: 'legendary',
      findType: 'debris',
      objectData: { name: 'Relic' },
      xpGained: 10,
    });
    expSvc.startExpedition.mockResolvedValueOnce({
      expeditionId: 'exp2',
      endsAt: new Date(Date.now() + 600_000),
      isLongExpedition: false,
    });
    bot.sendMessage
      .mockResolvedValueOnce({ message_id: 301 })
      .mockResolvedValueOnce({ message_id: 302 });

    await svc.handleCommand(bot, msg);
    jest.advanceTimersByTime(60_000);

    expect(bot.deleteMessage).not.toHaveBeenCalled();
  });

  test('deletes speedup confirmation message after one minute', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ language_code: 'ru', stars_balance: 10 }] })
      .mockResolvedValueOnce(cleanupOn);
    expSvc.getActiveExpedition.mockResolvedValueOnce({
      expeditionId: 'exp1',
      wasSpedUp: false,
      isLongExpedition: false,
    });
    const cbq = {
      id: 'cbq1',
      data: 'cxsc:111:exp1',
      from: { id: 111 },
      message: { chat: { id: -100 }, message_id: 55 },
    };

    await svc.handleSpeedupConfirm(bot, cbq);
    jest.advanceTimersByTime(60_000);

    expect(bot.deleteMessage).toHaveBeenCalledTimes(1);
    expect(bot.deleteMessage).toHaveBeenCalledWith(-100, 55);
  });
});
