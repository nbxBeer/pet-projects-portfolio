'use strict';

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');
const { query } = require('../db/pool');
const logger = require('../utils/logger');

let sharp;
try { sharp = require('sharp'); } catch (_) { /* optional dep */ }

const BOT_CARDS_DIR = path.join(__dirname, '..', 'assets', 'bot-cards');

// Words that trigger zone picker from group chat.
const ZONE_TRIGGERS = new Set(['zone', 'зона', 'зоны']);

// Words that trigger expedition command from group chat.
// NOTE: Telegram bots must have privacy mode DISABLED via BotFather (/setprivacy → Disable)
// to receive all messages in groups, not just commands.
const EXPEDITION_TRIGGERS = new Set([
  // English
  'fly', 'ship',
  // Russian transliterations
  'флай', 'шип',
  // Russian keyboard layout — typing English letters while RU layout is active:
  // fly: f→а, l→л, y→н
  'алн',
  // ship: s→ы, h→р, i→ш, p→з
  'ыршз',
  // English keyboard with Russian layout active (typing "флай"/"шип" in EN mode):
  // флай: ф→a, л→k, а→f, й→q
  'akfq',
  // шип: ш→i, и→b, п→g
  'ibg',
  // Other languages — fly
  'fliege', 'fliegen',          // German
  'voler',                      // French
  'volar',                      // Spanish
  'volare',                     // Italian
  'uçmak', 'uç',                // Turkish
  'leti', 'leteti',             // Croatian / Serbian / Czech / Bulgarian
  'latać', 'lec', 'leci',       // Polish
  'repül', 'repülni',           // Hungarian
  'lentää', 'lennä',            // Finnish
  'flyga', 'flyg',              // Swedish
  'flyve',                      // Danish / Norwegian
  'lennata',                    // Estonian
  'lidot',                      // Latvian
  'skristi',                    // Lithuanian
  'летати', 'лети',             // Ukrainian / Bulgarian (fly)
  // Other languages — ship
  'schiff',                     // German
  'nave',                       // Italian / Spanish
  'navio', 'barco',             // Portuguese / Spanish
  'bateau',                     // French
  'skip',                       // Norwegian
  'skepp',                      // Swedish
  'laiva',                      // Finnish
  'loď',                        // Czech
  'statek',                     // Polish
  'hajó',                       // Hungarian
  'laev',                       // Estonian
  'kuģis',                      // Latvian
  'laivas',                     // Lithuanian
  'корабель',                   // Ukrainian
  'gemi',                       // Turkish
]);

const RARITY_LABELS = {
  ru: {
    common:      '⚪ Обычный',
    rare:        '🔵 Редкий',
    epic:        '🟣 Эпический',
    legendary:   '🟡 Легендарный',
    mythical:    '🔴 Мифический',
    exotic:      '🟢 Экзотический',
    ancient:     '🟤 Древний',
    relic:       '🟠 Реликтовый',
    hybrid:      '💠 Гибридный',
    singularity: '⚫ Сингулярность',
  },
  en: {
    common:      '⚪ Common',
    rare:        '🔵 Rare',
    epic:        '🟣 Epic',
    legendary:   '🟡 Legendary',
    mythical:    '🔴 Mythical',
    exotic:      '🟢 Exotic',
    ancient:     '🟤 Ancient',
    relic:       '🟠 Relic',
    hybrid:      '💠 Hybrid',
    singularity: '⚫ Singularity',
  },
};

const FIND_TYPE_LABELS = {
  ru: {
    asteroid:      'Астероид',
    debris:        'Обломки',
    artifact:      'Артефакт',
    creature:      'Существо',
    anomaly:       'Аномалия',
    nft_container: 'NFT-контейнер',
    scrap:         'Металлолом',
    story_item:    'Сюжетный предмет',
    echo:          'Эхо',
    relic:         'Реликт',
    entity:        'Сущность',
    rift:          'Разлом',
    collectible:   'Коллекционный предмет',
  },
  en: {
    asteroid:      'Asteroid',
    debris:        'Debris',
    artifact:      'Artifact',
    creature:      'Creature',
    anomaly:       'Anomaly',
    nft_container: 'NFT Container',
    scrap:         'Scrap',
    story_item:    'Story Item',
    echo:          'Echo',
    relic:         'Relic',
    entity:        'Entity',
    rift:          'Rift',
    collectible:   'Collectible',
  },
};

// Voice title shown above item card for notable finds
const RARITY_VOICE = {
  ru: {
    common:      '',
    rare:        '',
    epic:        '🟣 ЭПИЧЕСКИЙ трофей',
    legendary:   '⚡ ЛЕГЕНДАРНОЕ открытие!',
    mythical:    '👑 МИФИЧЕСКИЙ трофей из глубин космоса',
    exotic:      '🌿 Экзотическая добыча',
    ancient:     '🏺 ДРЕВНЯЯ находка',
    relic:       '🟠 РЕЛИКТОВАЯ добыча',
    hybrid:      '💠 ГИБРИДНАЯ аномалия',
    singularity: '⚫ СИНГУЛЯРНОСТЬ ОБНАРУЖЕНА',
  },
  en: {
    common:      '',
    rare:        '',
    epic:        '🟣 EPIC trophy',
    legendary:   '⚡ LEGENDARY discovery!',
    mythical:    '👑 MYTHICAL trophy from the cosmos',
    exotic:      '🌿 Exotic catch',
    ancient:     '🏺 ANCIENT discovery',
    relic:       '🟠 RELIC find',
    hybrid:      '💠 HYBRID anomaly',
    singularity: '⚫ SINGULARITY DETECTED',
  },
};

const TYPE_EMOJI = {
  asteroid:      '🪨',
  debris:        '🔩',
  artifact:      '🏺',
  creature:      '🦠',
  anomaly:       '⚡',
  nft_container: '💎',
  scrap:         '🗑',
  story_item:    '📖',
  echo:          '🌀',
  relic:         '📿',
  entity:        '👁',
  rift:          '🌊',
  collectible:   '🎁',
};

const PRICE_MULT = {
  common: 1, rare: 2, epic: 4, legendary: 8, mythical: 20,
  exotic: 1.5, ancient: 4, relic: 9, hybrid: 20, singularity: 50,
};

const CHAT_CLEANUP_DELAY_MS = 60_000;
const CHAT_CLEANUP_KEEP_RARITIES = new Set([
  'legendary', 'mythical',
  'relic', 'hybrid', 'singularity',
]);

// Format large numbers with space thousand-separator (18 000)
function fmtNum(n) {
  return String(Math.round(n || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

// Format precise float value: 6.143 (up to 3 decimals, trim trailing zeros)
function fmtPrecise(n) {
  const v = Number(n || 0);
  if (Number.isNaN(v)) return '0';
  return v % 1 === 0 ? String(v) : v.toFixed(3).replace(/\.?0+$/, '');
}

// Rarities that deserve a "voice" exclamation line (legendary and above only)
const HIGH_RARITY_VOICE = new Set(['legendary', 'mythical', 'hybrid', 'singularity']);

// Rarity → hex color (matches frontend RARITY_CONFIG)
const RARITY_COLOR = {
  common:      '#9e9e9e',
  rare:        '#2196f3',
  epic:        '#9c27b0',
  legendary:   '#ffc107',
  mythical:    '#f44336',
  exotic:      '#26c6da',
  ancient:     '#8d6e63',
  relic:       '#ff7043',
  hybrid:      '#ab47bc',
  singularity: '#e040fb',
};

// SVG paths from frontend GameIcons.jsx (viewBox 0 0 24 24, stroke-based)
const ICON_SVG = {
  debris:        '<polygon points="5,4 17,3 21,9 17,19 7,20 3,13"/>'
    + '<path d="M12 4 L11 9 L15 12 L13 18" stroke-width="1.2"/>'
    + '<circle cx="7" cy="8" r="1" stroke-width="1.2"/>'
    + '<circle cx="17" cy="6" r="1" stroke-width="1.2"/>'
    + '<polygon points="18,19 22,16 23,21 19,22" stroke-width="1.2"/>',
  artifact:      '<path d="M6 3h12l4 6-10 13L2 9z"/>'
    + '<line x1="2" y1="9" x2="22" y2="9"/>'
    + '<line x1="6" y1="3" x2="12" y2="9"/>'
    + '<line x1="18" y1="3" x2="12" y2="9"/>',
  creature:      '<ellipse cx="6" cy="10" rx="1.8" ry="2.3"/>'
    + '<ellipse cx="10" cy="7" rx="1.8" ry="2.3"/>'
    + '<ellipse cx="14" cy="7" rx="1.8" ry="2.3"/>'
    + '<ellipse cx="18" cy="10" rx="1.8" ry="2.3"/>'
    + '<path d="M7 17 Q12 13 17 17 L16 21 Q12 23 8 21 Z"/>',
  anomaly:       '<circle cx="12" cy="12" r="2"/>'
    + '<path d="M12 10a5 5 0 0 1 5 5 7.1 7.1 0 0 1-12.3 2.4"/>'
    + '<path d="M17.8 7A10 10 0 0 1 5.3 19.3"/>',
  asteroid:      '<path d="M15 3 Q20 3 22 7 Q24 12 22 16 Q20 20 16 21 Q11 22 7 19 Q3 16 2 12 Q1 7 4 5 Q8 2 15 3Z"/>'
    + '<circle cx="12" cy="12" r="2.2" stroke-width="1.2"/>'
    + '<circle cx="17" cy="16" r="1.3" stroke-width="1.2"/>'
    + '<line x1="3" y1="9" x2="1" y2="5"/>'
    + '<line x1="5" y1="6" x2="3" y2="3"/>'
    + '<line x1="7" y1="4" x2="6" y2="1"/>',
  nft_container: '<polyline points="20 12 20 22 4 22 4 12"/>'
    + '<rect x="2" y="7" width="20" height="5"/>'
    + '<line x1="12" y1="22" x2="12" y2="7"/>'
    + '<path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/>'
    + '<path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/>',
  story_item:    '<circle cx="12" cy="17" r="2"/>'
    + '<line x1="12" y1="19" x2="12" y2="22"/>'
    + '<path d="M8.5 14 Q8.5 9 12 7.5 Q15.5 9 15.5 14"/>'
    + '<path d="M5 16.5 Q5 6 12 3 Q19 6 19 16.5"/>',
  echo:          '<path d="M3 8 Q6 5 9 8 Q12 11 15 8 Q18 5 21 8"/>'
    + '<path d="M3 12 Q6 9 9 12 Q12 15 15 12 Q18 9 21 12"/>'
    + '<path d="M3 16 Q6 13 9 16 Q12 19 15 16 Q18 13 21 16"/>',
  relic:         '<path d="M9 21V4a3 3 0 0 1 6 0v17"/>'
    + '<line x1="7" y1="21" x2="17" y2="21"/>'
    + '<circle cx="12" cy="9" r="1.5"/>'
    + '<line x1="10" y1="13" x2="14" y2="13"/>',
  entity:        '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>'
    + '<circle cx="12" cy="12" r="3"/>',
  rift:          '<circle cx="12" cy="12" r="4"/>'
    + '<line x1="12" y1="2" x2="12" y2="7"/>'
    + '<line x1="12" y1="17" x2="12" y2="22"/>'
    + '<line x1="2" y1="12" x2="7" y2="12"/>'
    + '<line x1="17" y1="12" x2="22" y2="12"/>'
    + '<line x1="5.6" y1="5.6" x2="8.9" y2="8.9"/>'
    + '<line x1="15.1" y1="15.1" x2="18.4" y2="18.4"/>'
    + '<line x1="18.4" y1="5.6" x2="15.1" y2="8.9"/>'
    + '<line x1="8.9" y1="15.1" x2="5.6" y2="18.4"/>',
  scrap:         '<polygon points="5,4 17,3 21,9 17,19 7,20 3,13"/>'
    + '<path d="M12 4 L11 9 L15 12 L13 18" stroke-width="1.2"/>'
    + '<circle cx="7" cy="8" r="1" stroke-width="1.2"/>'
    + '<circle cx="17" cy="6" r="1" stroke-width="1.2"/>',
};

async function makeIconPng(findType, rarityColor) {
  const paths = ICON_SVG[findType] || ICON_SVG.debris;
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 24 24">',
    '  <rect width="24" height="24" fill="#0d0d1a"/>',
    `  <circle cx="12" cy="12" r="9" fill="${rarityColor}" fill-opacity="0.18"/>`,
    `  <g fill="none" stroke="${rarityColor}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">`,
    paths,
    '  </g>',
    '</svg>',
  ].join('');
  return sharp(Buffer.from(svg)).png().toBuffer();
}

function isTriggerWord(text) {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  // Must be exactly one word (no spaces)
  if (trimmed.includes(' ') || trimmed.includes('\n')) return false;
  return EXPEDITION_TRIGGERS.has(trimmed.toLowerCase());
}

function isZoneTrigger(text) {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (trimmed.includes(' ') || trimmed.includes('\n')) return false;
  return ZONE_TRIGGERS.has(trimmed.toLowerCase());
}

function isGroupChat(msg) {
  const type = msg?.chat?.type;
  return type === 'group' || type === 'supergroup';
}

function formatTime(seconds, lang) {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) {
    return lang === 'ru' ? `${s} сек.` : `${s}s`;
  }
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  if (lang === 'ru') {
    return secs > 0 ? `${mins} мин. ${secs} сек.` : `${mins} мин.`;
  }
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

function getLang(user, msg) {
  const code = String(user?.language_code || msg?.from?.language_code || '').toLowerCase();
  return code.startsWith('ru') ? 'ru' : 'en';
}

// Escape Markdown v1 special chars: _ * ` [
function escMd(str) {
  return String(str || '').replace(/[_*`[]/g, '\\$&');
}

class ChatExpeditionService {
  constructor(expeditionService, configManager) {
    this.expeditionService = expeditionService;
    this.configManager = configManager;
    this._photoFileIds = new Map(); // rarity → cached Telegram file_id
    this._userLongMode = new Map(); // userId → boolean (long expedition preference)
    this._userZonePref = new Map(); // userId → zoneId (preferred zone)
    this._botStartLinkBuilder = null;
  }

  isTriggerWord(text) { return isTriggerWord(text); }
  isGroupChat(msg)    { return isGroupChat(msg); }
  isZoneTrigger(text) { return isZoneTrigger(text); }

  setBotStartLinkBuilder(builder) {
    this._botStartLinkBuilder = typeof builder === 'function' ? builder : null;
  }

  async _getChatCleanupState(chatId) {
    try {
      const res = await query(
        `SELECT COALESCE(chat_auto_delete_low_rarity, false) AS enabled
         FROM chat_sources
         WHERE chat_id = $1
         LIMIT 1`,
        [chatId]
      );
      return {
        enabled: Boolean(res.rows[0]?.enabled),
        messageIds: new Set(),
      };
    } catch (err) {
      logger.warn({ err, chatId }, 'chat cleanup config read failed');
      return { enabled: false, messageIds: new Set() };
    }
  }

  _trackCleanupMessage(cleanup, sent) {
    const messageId = sent?.message_id;
    if (cleanup && messageId) cleanup.messageIds.add(messageId);
  }

  async _sendPersistentMessage(bot, chatId, text, opts) {
    return bot.sendMessage(chatId, text, opts);
  }

  async _sendCleanupMessage(bot, cleanup, chatId, text, opts) {
    const sent = await bot.sendMessage(chatId, text, opts);
    this._trackCleanupMessage(cleanup, sent);
    return sent;
  }

  _scheduleMessageDelete(bot, chatId, messageId) {
    if (!messageId || typeof bot.deleteMessage !== 'function') return;
    setTimeout(() => {
      bot.deleteMessage(chatId, messageId).catch((err) => {
        logger.warn({ err, chatId, messageId }, 'chat cleanup delete failed');
      });
    }, CHAT_CLEANUP_DELAY_MS);
  }

  _scheduleCleanup(bot, chatId, cleanup) {
    if (!cleanup?.enabled || !cleanup.messageIds.size || typeof bot.deleteMessage !== 'function') return;
    const messageIds = Array.from(cleanup.messageIds);
    setTimeout(() => {
      for (const messageId of messageIds) {
        bot.deleteMessage(chatId, messageId).catch((err) => {
          logger.warn({ err, chatId, messageId }, 'chat cleanup delete failed');
        });
      }
    }, CHAT_CLEANUP_DELAY_MS);
  }

  async _buildOpenBotMarkup(msg, lang) {
    if (!this._botStartLinkBuilder) return undefined;
    try {
      const link = await this._botStartLinkBuilder(msg);
      return { inline_keyboard: [[{ text: lang === 'ru' ? 'Перейти в бота' : 'Open bot', url: link }]] };
    } catch (err) {
      logger.warn({ err, chatId: msg.chat?.id }, 'failed to build open bot link');
      return undefined;
    }
  }

  /**
   * Generate a unique link code for a chat (UUID-based)
   */
  _generateLinkCode() {
    const crypto = require('crypto');
    return crypto.randomBytes(6).toString('hex');
  }

  /**
   * Register or update chat owner and generate link
   */
  async registerChatOwner(chatId, ownerUserId, ownerUsername) {
    try {
      const linkCode = this._generateLinkCode();
      
      const res = await query(
        `INSERT INTO chat_sources (chat_id, link_code, owner_user_id, owner_username, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (chat_id) DO UPDATE SET
           link_code = EXCLUDED.link_code,
           owner_user_id = EXCLUDED.owner_user_id,
           owner_username = EXCLUDED.owner_username,
           updated_at = NOW()
         RETURNING link_code, chat_title`,
        [chatId, linkCode, ownerUserId, ownerUsername || null]
      );
      
      return res.rows[0] || { link_code: linkCode };
    } catch (err) {
      logger.warn({ err, chatId }, 'Failed to register chat owner');
      throw err;
    }
  }

  /**
   * Main entry point: handle an expedition trigger word from a group chat.
   */
  async handleCommand(bot, msg) {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    const chatTitle = msg.chat.title || '';
    const cleanup = { enabled: false, messageIds: new Set() };

    try {
      const { user, isNew } = await this._getOrCreateUser(msg, chatId, chatTitle);
      const lang = getLang(user, msg);

      if (isNew) {
        const name = escMd(user.first_name || (lang === 'ru' ? 'Пилот' : 'Pilot'));
        await this._sendCleanupMessage(bot, cleanup, chatId,
          lang === 'ru'
            ? `👋 Привет, *${name}*! Аккаунт создан. Запускаю первую экспедицию...`
            : `👋 Hi, *${name}*! Account created. Launching your first expedition...`,
          { parse_mode: 'Markdown', reply_to_message_id: msg.message_id }
        );
      }

      const active = await this.expeditionService.getActiveExpedition(userId);

      if (active) {
        if (active.status === 'in_progress') {
          const remaining = Math.max(0, Math.ceil((new Date(active.endsAt) - Date.now()) / 1000));

          // ends_at already passed (e.g. sped up via game) — collect now
          if (remaining === 0) {
            await this._collectAndStartNext(bot, msg, userId, user, active, lang, cleanup);
            return;
          }

          const cost = this._getSpeedupCost(active);
          const opts = { parse_mode: 'Markdown', reply_to_message_id: msg.message_id };
          if (!active.wasSpedUp) {
            opts.reply_markup = {
              inline_keyboard: [[{
                text: lang === 'ru' ? `⚡ Ускорить за ${cost} ⭐` : `⚡ Speed up for ${cost} ⭐`,
                callback_data: `cxsc:${userId}:${active.expeditionId}`,
              }]],
            };
          }
          await this._sendCleanupMessage(bot, cleanup, chatId,
            lang === 'ru'
              ? `🛸 Экспедиция в процессе...\nОсталось: *${formatTime(remaining, lang)}*`
              : `🛸 Expedition in progress...\nTime left: *${formatTime(remaining, lang)}*`,
            opts
          );
          return;
        }

        if (active.status === 'pirate_pending') {
          const replyMarkup = await this._buildOpenBotMarkup(msg, lang);
          await this._sendCleanupMessage(bot, cleanup, chatId,
            lang === 'ru'
              ? '⚠️ Встреча с пиратами! Открой игру, чтобы принять решение.'
              : '⚠️ Pirate encounter! Open the game to make a decision.',
            { reply_to_message_id: msg.message_id, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) }
          );
          return;
        }

        if (active.status === 'completed') {
          await this._collectAndStartNext(bot, msg, userId, user, active, lang, cleanup);
          return;
        }
      }

      await this._startExpedition(bot, msg, userId, user, lang, cleanup);

    } catch (err) {
      logger.warn({ err, userId, chatId }, 'Chat expedition command failed');
    } finally {
      cleanup.enabled = (await this._getChatCleanupState(chatId)).enabled;
      this._scheduleCleanup(bot, chatId, cleanup);
    }
  }

  async _getOrCreateUser(msg, chatId, chatTitle) {
    const { id, username, first_name, last_name, language_code } = msg.from;

    const existing = await query('SELECT * FROM users WHERE id = $1', [id]);
    if (existing.rows.length > 0) {
      return { user: existing.rows[0], isNew: false };
    }

    const res = await query(
      `INSERT INTO users
         (id, username, first_name, last_name, language_code,
          registration_chat_id, registration_chat_title, registration_source_type, last_active_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'group_chat', NOW())
       ON CONFLICT (id) DO UPDATE SET last_active_at = NOW()
       RETURNING *`,
      [id, username || null, first_name || null, last_name || null,
       language_code || 'ru', chatId, chatTitle || null]
    );

    await query(
      `INSERT INTO ship_modules (user_id, module_type, level)
       VALUES ($1, 'scanner', 0), ($1, 'engine', 0), ($1, 'cargo', 0), ($1, 'capsule', 0)
       ON CONFLICT (user_id, module_type) DO NOTHING`,
      [id]
    );

    // Track the chat as a registration source (non-critical)
    query(
      `INSERT INTO chat_sources (chat_id, chat_title, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (chat_id) DO UPDATE SET
         chat_title = EXCLUDED.chat_title,
         updated_at = NOW()`,
      [chatId, chatTitle || null]
    ).catch((err) => logger.warn({ err, chatId }, 'chat_sources upsert failed'));

    return { user: res.rows[0], isNew: true };
  }

  async _startExpedition(bot, msg, userId, user, lang, cleanup = null) {
    const chatId = msg.chat.id;
    const isRu = lang === 'ru';
    const config = this.configManager.config;
    const universe = user.current_universe || 1;

    // Use user's zone preference if set and accessible, otherwise pick best available
    let zone = null;
    const prefZoneId = this._userZonePref.get(userId);
    if (prefZoneId) {
      const allZones = universe === 2 ? (config.universe2?.zones || []) : (config.zones || []);
      const prefZone = allZones.find((z) => z.id === prefZoneId);
      if (prefZone && (prefZone.minLevel || 1) <= (user.level || 1)) {
        zone = prefZone;
      }
    }
    if (!zone) {
      zone = this._getBestZone(user.level || 1, config, universe);
    }

    if (!zone) {
      await this._sendCleanupMessage(bot, cleanup, chatId,
        isRu
          ? '❌ Нет доступных зон. Открой игру, чтобы начать.'
          : '❌ No zones available. Open the game to start.',
        { reply_to_message_id: msg.message_id }
      );
      return;
    }

    // Long expedition mode: check preference and Particle Decelerator
    let longExpedition = this._userLongMode.get(userId) || false;
    if (longExpedition) {
      try {
        const hasDecelerator = await query(
          `SELECT 1 FROM user_story_items WHERE user_id = $1 AND item_key = 'particle_decelerator'`,
          [userId]
        );
        if (!hasDecelerator.rows.length) {
          this._userLongMode.set(userId, false);
          longExpedition = false;
          await this._sendCleanupMessage(bot, cleanup, chatId,
            isRu
              ? '⚡ Нет _Замедлителя частиц_ — переключаюсь на быструю экспедицию'
              : '⚡ No _Particle Decelerator_ — switching to fast expedition',
            { parse_mode: 'Markdown', reply_to_message_id: msg.message_id }
          );
        }
      } catch (_) { longExpedition = false; }
    }

    const clientSeed = crypto.randomBytes(16).toString('hex').slice(0, 32);

    try {
      const result = await this.expeditionService.startExpedition(userId, {
        zoneId: zone.id,
        clientSeed,
        longExpedition,
      });

      const endsAt = new Date(result.endsAt);
      const timeStr = endsAt.toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Europe/Moscow',
      });
      const zoneName = escMd(zone.name || zone.id);
      const modePrefix = longExpedition
        ? (isRu ? '⚡ *Долгая* экспедиция' : '⚡ *Long* expedition')
        : (isRu ? '🚀 Экспедиция' : '🚀 Expedition');

      await this._sendPersistentMessage(bot, chatId,
        isRu
          ? `${modePrefix} запущена!\nЗона: *${zoneName}*\nПрибудет ~${timeStr} МСК`
          : `${modePrefix} launched!\nZone: *${zoneName}*\nArrives ~${timeStr} MSK`,
        { parse_mode: 'Markdown', reply_to_message_id: msg.message_id }
      );
    } catch (err) {
      if (err?.status === 403 && err.cooldownUntil) {
        const remaining = Math.max(0, Math.ceil((new Date(err.cooldownUntil) - Date.now()) / 1000));
        await this._sendCleanupMessage(bot, cleanup, chatId,
          isRu
            ? `⛔ Корабль повреждён после пиратов. Ремонт: *${formatTime(remaining, lang)}*`
            : `⛔ Ship damaged by pirates. Repair time: *${formatTime(remaining, lang)}*`,
          { parse_mode: 'Markdown', reply_to_message_id: msg.message_id }
        );
      } else if (err?.status === 409 && err.travelUntil) {
        // Traveling between universes
        const remaining = Math.max(0, Math.ceil((new Date(err.travelUntil) - Date.now()) / 1000));
        await this._sendCleanupMessage(bot, cleanup, chatId,
          isRu
            ? `🌌 Корабль в перелёте между вселенными...\nОсталось: *${formatTime(remaining, lang)}*`
            : `🌌 Ship is traveling between universes...\nTime left: *${formatTime(remaining, lang)}*`,
          { parse_mode: 'Markdown', reply_to_message_id: msg.message_id }
        );
      } else if (err?.status === 409) {
        // Race condition — expedition started between check and start
        const active = await this.expeditionService.getActiveExpedition(userId).catch(() => null);
        if (active?.status === 'in_progress') {
          const remaining = Math.max(0, Math.ceil((new Date(active.endsAt) - Date.now()) / 1000));
          await this._sendCleanupMessage(bot, cleanup, chatId,
            isRu
              ? `🛸 Экспедиция уже в пути...\nОсталось: *${formatTime(remaining, lang)}*`
              : `🛸 Expedition already in progress...\nTime left: *${formatTime(remaining, lang)}*`,
            { parse_mode: 'Markdown', reply_to_message_id: msg.message_id }
          );
        }
      } else {
        logger.warn({ err, userId, zoneId: zone.id }, 'Failed to start chat expedition');
      }
    }
  }

  async _collectAndStartNext(bot, msg, userId, user, active, lang, cleanup = null) {
    const chatId = msg.chat.id;

    try {
      const result = await this.expeditionService.collectExpedition(userId, active.expeditionId);

      // Pirate encounter — user must resolve in the game
      if (result.outcome === 'pirate_encounter') {
        const replyMarkup = await this._buildOpenBotMarkup(msg, lang);
        await this._sendCleanupMessage(bot, cleanup, chatId,
          lang === 'ru'
            ? '\u2694\uFE0F *\u041F\u0438\u0440\u0430\u0442\u044B \u043F\u0435\u0440\u0435\u0445\u0432\u0430\u0442\u0438\u043B\u0438 \u043A\u043E\u0440\u0430\u0431\u043B\u044C!*\n\u041E\u0442\u043A\u0440\u043E\u0439 \u0438\u0433\u0440\u0443, \u0447\u0442\u043E\u0431\u044B \u043F\u0440\u0438\u043D\u044F\u0442\u044C \u0440\u0435\u0448\u0435\u043D\u0438\u0435.'
            : '\u2694\uFE0F *Pirates intercepted your ship!*\nOpen the game to decide.',
          { parse_mode: 'Markdown', reply_to_message_id: msg.message_id, ...(replyMarkup ? { reply_markup: replyMarkup } : {}) }
        );
        return;
      }

      // Auto-take action for results that still need it
      let finalResult = result;
      if (result.resultId && result.outcome !== 'cargo_full' && result.outcome !== 'no_capsule') {
        const action = this._chooseAction(result.findType);
        try {
          const actionResult = await this.expeditionService.takeAction(userId, result.resultId, action);
          finalResult = { ...result, ...actionResult, universe: active.universe || 1 };
        } catch (actionErr) {
          if (actionErr?.status !== 409) {
            logger.warn({ actionErr, userId, resultId: result.resultId }, 'Auto-action failed in chat expedition');
          }
        }
      }

      const text = this._formatResultText(finalResult, lang);
      const skipPhoto = finalResult.outcome === 'cargo_full'
        || finalResult.outcome === 'no_capsule'
        || finalResult.findType === 'nft_container';

      const resultCleanup = CHAT_CLEANUP_KEEP_RARITIES.has(finalResult.rarity) ? null : cleanup;

      if (skipPhoto) {
        if (resultCleanup) {
          await this._sendCleanupMessage(bot, resultCleanup, chatId, text, { parse_mode: 'Markdown', reply_to_message_id: msg.message_id });
        } else {
          await this._sendPersistentMessage(bot, chatId, text, { parse_mode: 'Markdown', reply_to_message_id: msg.message_id });
        }
      } else {
        await this._sendResultWithPhoto(bot, chatId, msg.message_id, finalResult, text, resultCleanup).catch(async () => {
          if (resultCleanup) {
            await this._sendCleanupMessage(bot, resultCleanup, chatId, text, { parse_mode: 'Markdown', reply_to_message_id: msg.message_id });
          } else {
            await this._sendPersistentMessage(bot, chatId, text, { parse_mode: 'Markdown', reply_to_message_id: msg.message_id });
          }
        });
      }

      // Immediately start next expedition after successful collection
      const freshUser = await query('SELECT * FROM users WHERE id = $1', [userId])
        .then((r) => r.rows[0])
        .catch(() => user);
      await this._startExpedition(bot, msg, userId, freshUser || user, lang, cleanup);

    } catch (err) {
      if (err?.status === 425) {
        const remaining = err.remainingSeconds || 0;
        await this._sendCleanupMessage(bot, cleanup, chatId,
          lang === 'ru'
            ? `🛸 Экспедиция ещё в пути...\nОсталось: *${formatTime(remaining, lang)}*`
            : `🛸 Expedition still in progress...\nTime left: *${formatTime(remaining, lang)}*`,
          { parse_mode: 'Markdown', reply_to_message_id: msg.message_id }
        );
      } else {
        logger.warn({ err, userId }, 'Failed to collect chat expedition');
      }
    }
  }

  async _sendResultWithPhoto(bot, chatId, replyMsgId, result, text, cleanup = null) {
    const rarity   = result.rarity   || 'common';
    const findType = result.findType || 'debris';
    const color    = RARITY_COLOR[rarity] || '#9e9e9e';
    const cacheKey = `${findType}:${rarity}`;
    const opts     = { caption: text, parse_mode: 'Markdown', reply_to_message_id: replyMsgId };

    // Return cached Telegram file_id — zero overhead
    const cached = this._photoFileIds.get(cacheKey);
    if (cached) {
      const sent = await bot.sendPhoto(chatId, cached, opts);
      this._trackCleanupMessage(cleanup, sent);
      return;
    }

    // 1. Static file dropped by operator (e.g. GPT-generated art)
    let png = null;
    const staticFile = path.join(BOT_CARDS_DIR, `${findType}.png`);
    if (fs.existsSync(staticFile)) {
      png = fs.readFileSync(staticFile);
    } else if (sharp) {
      // 2. Generate on-the-fly via sharp (SVG icon + rarity glow)
      try {
        png = await makeIconPng(findType, color);
      } catch (genErr) {
        logger.warn({ genErr, findType, rarity }, 'makeIconPng failed');
      }
    }

    if (!png) throw new Error(`No image for ${findType}`);

    const sent = await bot.sendPhoto(chatId, png, opts, { filename: `${findType}.png`, contentType: 'image/png' });
    this._trackCleanupMessage(cleanup, sent);
    const fileId = sent?.photo?.[sent.photo.length - 1]?.file_id;
    if (fileId) this._photoFileIds.set(cacheKey, fileId);
  }

  _chooseAction(findType) {
    if (findType === 'asteroid') return 'sell';
    if (findType === 'nft_container') return 'save_coords';
    if (findType === 'story_item') return 'collect';
    return 'collect';
  }

  _getSpeedupCost(expedition) {
    const base = this.configManager.config.expedition?.speedUpCostStars ?? 3;
    return expedition.isLongExpedition ? 20 : base;
  }

  // ── Speedup via inline button callbacks (cxsc / cxsd / cxsx) ─────────────

  async handleSpeedupConfirm(bot, cbq) {
    // cxsc:<userId>:<expeditionId>
    const [, userIdStr, expeditionId] = cbq.data.split(':');
    if (String(cbq.from.id) !== userIdStr) {
      await bot.answerCallbackQuery(cbq.id, { text: '⛔', show_alert: false });
      return;
    }
    const userId = parseInt(userIdStr);
    const userRow = await query(
      'SELECT language_code, stars_balance FROM users WHERE id = $1', [userId]
    ).then((r) => r.rows[0]).catch(() => null);

    const lang = getLang(userRow, null);
    const isRu = lang === 'ru';

    const active = await this.expeditionService.getActiveExpedition(userId).catch(() => null);
    if (!active || active.wasSpedUp) {
      await bot.answerCallbackQuery(cbq.id, {
        text: isRu ? 'Уже ускорена или завершена!' : 'Already sped up or done!',
        show_alert: true,
      });
      await bot.editMessageReplyMarkup(
        { inline_keyboard: [] },
        { chat_id: cbq.message.chat.id, message_id: cbq.message.message_id }
      ).catch(() => {});
      return;
    }

    const cost = this._getSpeedupCost(active);
    const balance = Number(userRow?.stars_balance ?? 0);

    await bot.answerCallbackQuery(cbq.id);

    if (balance < cost) {
      await bot.editMessageText(
        isRu
          ? `⭐ Недостаточно Stars!\nНужно: *${cost}*  •  Есть: *${balance}*`
          : `⭐ Not enough Stars!\nNeed: *${cost}*  •  Have: *${balance}*`,
        {
          chat_id: cbq.message.chat.id,
          message_id: cbq.message.message_id,
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [] },
        }
      ).catch(() => {});
      return;
    }

    await bot.editMessageText(
      isRu
        ? `⚡ Потратить *${cost} ⭐* на ускорение?`
        : `⚡ Spend *${cost} ⭐* to speed up?`,
      {
        chat_id: cbq.message.chat.id,
        message_id: cbq.message.message_id,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: isRu ? '✅ Да' : '✅ Yes', callback_data: `cxsd:${userIdStr}:${expeditionId}` },
            { text: isRu ? '❌ Нет' : '❌ No',  callback_data: `cxsx:${userIdStr}` },
          ]],
        },
      }
    ).catch(() => {});

    const cleanup = await this._getChatCleanupState(cbq.message.chat.id);
    if (cleanup.enabled) {
      this._scheduleMessageDelete(bot, cbq.message.chat.id, cbq.message.message_id);
    }
  }

  async handleSpeedupDo(bot, cbq) {
    // cxsd:<userId>:<expeditionId>
    const [, userIdStr, expeditionId] = cbq.data.split(':');
    if (String(cbq.from.id) !== userIdStr) {
      await bot.answerCallbackQuery(cbq.id, { text: '⛔', show_alert: false });
      return;
    }
    const userId = parseInt(userIdStr);
    const userRow = await query(
      'SELECT * FROM users WHERE id = $1', [userId]
    ).then((r) => r.rows[0]).catch(() => null);

    const lang = getLang(userRow, null);
    const isRu = lang === 'ru';

    await bot.answerCallbackQuery(cbq.id);

    try {
      await this.expeditionService.speedUpExpedition(userId, expeditionId);

      // Remove buttons from the confirmation message
      await bot.editMessageReplyMarkup(
        { inline_keyboard: [] },
        { chat_id: cbq.message.chat.id, message_id: cbq.message.message_id }
      ).catch(() => {});

      // Collect result and start next expedition
      const active = await this.expeditionService.getActiveExpedition(userId).catch(() => null);
      if (active) {
        const cleanup = await this._getChatCleanupState(cbq.message.chat.id);
        const fakeMsg = {
          chat: cbq.message.chat,
          message_id: cbq.message.message_id,
          from: { id: userId, language_code: userRow?.language_code },
        };
        await this._collectAndStartNext(bot, fakeMsg, userId, userRow || { id: userId }, active, lang, cleanup);
        this._scheduleCleanup(bot, cbq.message.chat.id, cleanup);
      }
    } catch (err) {
      let errText;
      if (err?.status === 402) {
        errText = isRu
          ? `⭐ Недостаточно Stars. Нужно ${err.required}, есть ${err.current}`
          : `⭐ Not enough Stars. Need ${err.required}, have ${err.current}`;
      } else if (err?.status === 409) {
        errText = isRu
          ? '⚠️ Экспедиция уже ускорена или завершена.'
          : '⚠️ Already sped up or completed.';
      } else {
        errText = isRu ? '❌ Ошибка при ускорении.' : '❌ Speed-up failed.';
        logger.warn({ err, userId, expeditionId }, 'Chat speedup failed');
      }
      await bot.editMessageText(errText, {
        chat_id: cbq.message.chat.id,
        message_id: cbq.message.message_id,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [] },
      }).catch(() => {});
    }
  }

  async handleSpeedupCancel(bot, cbq) {
    // cxsx:<userId>
    const [, userIdStr] = cbq.data.split(':');
    if (String(cbq.from.id) !== userIdStr) {
      await bot.answerCallbackQuery(cbq.id);
      return;
    }
    await bot.editMessageReplyMarkup(
      { inline_keyboard: [] },
      { chat_id: cbq.message.chat.id, message_id: cbq.message.message_id }
    ).catch(() => {});
    await bot.answerCallbackQuery(cbq.id);
  }

  // ── Zone picker ───────────────────────────────────────────────────────────

  async handleZoneCommand(bot, msg) {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    const chatTitle = msg.chat.title || '';

    try {
      // Auto-register if user doesn't exist
      let userRes = await query('SELECT level, current_universe, language_code FROM users WHERE id = $1', [userId]);
      if (!userRes.rows.length) {
        await this._getOrCreateUser(msg, chatId, chatTitle);
        userRes = await query('SELECT level, current_universe, language_code FROM users WHERE id = $1', [userId]);
      }
      if (!userRes.rows.length) {
        await bot.sendMessage(chatId,
          '❌ Сначала запусти экспедицию (напиши fly)',
          { reply_to_message_id: msg.message_id }
        );
        return;
      }

      const user = userRes.rows[0];
      const lang = getLang(user, msg);
      const isRu = lang === 'ru';
      const config = this.configManager.config;
      const universe = user.current_universe || 1;
      const zones = universe === 2 ? (config.universe2?.zones || []) : (config.zones || []);

      if (!zones.length) {
        await bot.sendMessage(chatId, isRu ? '❌ Зоны не найдены' : '❌ No zones found', { reply_to_message_id: msg.message_id });
        return;
      }

      const userLevel = user.level || 1;
      const currentZone = this._userZonePref.get(userId);

      // Build inline keyboard: 2 zones per row
      const keyboard = [];
      for (let i = 0; i < zones.length; i += 2) {
        const row = [];
        for (let j = i; j < Math.min(i + 2, zones.length); j++) {
          const z = zones[j];
          const locked = userLevel < (z.minLevel || 1);
          const isCurrent = z.id === currentZone;
          const zoneName = isRu ? (z.name || z.id) : (z.nameEn || z.name || z.id);
          if (locked) {
            row.push({
              text: `🔒 ${zoneName} (ур. ${z.minLevel || 1})`,
              callback_data: `cxzlock:${userId}:${z.minLevel || 1}`,
            });
          } else {
            row.push({
              text: `${isCurrent ? '✅ ' : ''}${zoneName}`,
              callback_data: `cxzone:${userId}:${z.id}`,
            });
          }
        }
        keyboard.push(row);
      }

      await bot.sendMessage(chatId,
        isRu ? '🗺 *Выбери зону экспедиции:*' : '🗺 *Select expedition zone:*',
        {
          parse_mode: 'Markdown',
          reply_to_message_id: msg.message_id,
          reply_markup: { inline_keyboard: keyboard },
        }
      );
    } catch (err) {
      logger.warn({ err, userId, chatId: msg.chat.id }, 'Zone command failed');
    }
  }

  async handleZoneSelect(bot, cbq) {
    // cxzone:<requestingUserId>:<zoneId>
    const parts = cbq.data.split(':');
    const reqUserIdStr = parts[1];
    const zoneId = parts.slice(2).join(':');

    if (String(cbq.from.id) !== reqUserIdStr) {
      await bot.answerCallbackQuery(cbq.id, { text: '⛔', show_alert: false });
      return;
    }

    const userId = parseInt(reqUserIdStr);
    const userRow = await query('SELECT language_code, current_universe FROM users WHERE id = $1', [userId])
      .then((r) => r.rows[0]).catch(() => null);
    const lang = getLang(userRow, null);
    const isRu = lang === 'ru';

    const config = this.configManager.config;
    const universe = userRow?.current_universe || 1;
    const zones = universe === 2 ? (config.universe2?.zones || []) : (config.zones || []);
    const zone = zones.find((z) => z.id === zoneId);

    if (!zone) {
      await bot.answerCallbackQuery(cbq.id, { text: isRu ? '❌ Зона не найдена' : '❌ Zone not found', show_alert: true });
      return;
    }

    this._userZonePref.set(userId, zoneId);
    const zoneName = isRu ? (zone.name || zoneId) : (zone.nameEn || zone.name || zoneId);

    await bot.answerCallbackQuery(cbq.id, {
      text: isRu ? `✅ ${zoneName}` : `✅ ${zoneName}`,
      show_alert: false,
    });

    await bot.editMessageText(
      isRu ? `✅ Зона выбрана: *${escMd(zoneName)}*` : `✅ Zone selected: *${escMd(zoneName)}*`,
      {
        chat_id: cbq.message.chat.id,
        message_id: cbq.message.message_id,
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [] },
      }
    ).catch(() => {});
  }

  async handleZoneLocked(bot, cbq) {
    // cxzlock:<userId>:<minLevel>
    const [, , minLevelStr] = cbq.data.split(':');
    const minLevel = parseInt(minLevelStr);
    const userRow = await query('SELECT language_code FROM users WHERE id = $1', [cbq.from.id])
      .then((r) => r.rows[0]).catch(() => null);
    const lang = getLang(userRow, null);
    const isRu = lang === 'ru';

    await bot.answerCallbackQuery(cbq.id, {
      text: isRu ? `🔒 Требуется уровень ${minLevel}` : `🔒 Requires level ${minLevel}`,
      show_alert: true,
    });
  }

  // ── Long expedition toggle ─────────────────────────────────────────────────

  async handleLongToggle(bot, msg) {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    const chatTitle = msg.chat.title || '';

    try {
      // Auto-register if user doesn't exist
      let userRes = await query('SELECT language_code FROM users WHERE id = $1', [userId]);
      if (!userRes.rows.length) {
        await this._getOrCreateUser(msg, chatId, chatTitle);
        userRes = await query('SELECT language_code FROM users WHERE id = $1', [userId]);
      }
      if (!userRes.rows.length) return;

      const user = userRes.rows[0];
      const lang = getLang(user, msg);
      const isRu = lang === 'ru';

      // Check if user has Particle Decelerator
      const hasDecelerator = await query(
        `SELECT 1 FROM user_story_items WHERE user_id = $1 AND item_key = 'particle_decelerator'`,
        [userId]
      );

      if (!hasDecelerator.rows.length) {
        await bot.sendMessage(chatId,
          isRu
            ? '⚡ *Долгая экспедиция недоступна*\n\nТребуется: _Замедлитель частиц_\nНайди его в игре во время экспедиции.'
            : '⚡ *Long expedition unavailable*\n\nRequired: _Particle Decelerator_\nFind it in the game during an expedition.',
          { parse_mode: 'Markdown', reply_to_message_id: msg.message_id }
        );
        return;
      }

      const current = this._userLongMode.get(userId) || false;
      const newMode = !current;
      this._userLongMode.set(userId, newMode);

      await bot.sendMessage(chatId,
        isRu
          ? (newMode
            ? '⚡ *Долгая экспедиция* включена\n⏱ ~2 часа • 💫 Гарантировано Редкий+'
            : '🚀 *Быстрая экспедиция* включена')
          : (newMode
            ? '⚡ *Long expedition* enabled\n⏱ ~2 hours • 💫 Guaranteed Rare+'
            : '🚀 *Fast expedition* enabled'),
        { parse_mode: 'Markdown', reply_to_message_id: msg.message_id }
      );
    } catch (err) {
      logger.warn({ err, userId, chatId }, 'Long toggle failed');
    }
  }

  _getBestZone(userLevel, config, universe) {
    const zones = universe === 2
      ? (config.universe2?.zones || [])
      : (config.zones || []);

    const accessible = zones.filter((z) => (z.minLevel || 1) <= userLevel);
    const pool = accessible.length > 0 ? accessible : zones.slice(0, 1);
    if (!pool.length) return null;

    return pool.reduce((best, z) =>
      (z.creditMultiplier || 1) > (best.creditMultiplier || 1) ? z : best
    );
  }

  /**
   * Generate a unique link code for a chat (6-char hex)
   */
  _generateLinkCode() {
    const crypto = require('crypto');
    return crypto.randomBytes(6).toString('hex');
  }

  /**
   * Register or update chat owner and generate/return link code
   */
  async registerChatOwner(chatId, ownerUserId, ownerUsername) {
    try {
      // Check if link already exists
      const existing = await query('SELECT link_code, owner_user_id FROM chat_sources WHERE chat_id = $1', [chatId]);
      let linkCode = null;

      if (existing.rows.length > 0) {
        const rec = existing.rows[0];
        linkCode = rec.link_code;
        // If already has owner and trying to register with different user - flag security issue
        if (rec.owner_user_id && rec.owner_user_id !== ownerUserId) {
          return { error: 'owner_mismatch', existingOwnerId: rec.owner_user_id, linkCode };
        }
      }

      if (!linkCode) {
        linkCode = this._generateLinkCode();
      }
      
      const res = await query(
        `INSERT INTO chat_sources (chat_id, link_code, owner_user_id, owner_username, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (chat_id) DO UPDATE SET
           link_code = COALESCE(EXCLUDED.link_code, chat_sources.link_code),
           owner_user_id = EXCLUDED.owner_user_id,
           owner_username = EXCLUDED.owner_username,
           updated_at = NOW()
         RETURNING link_code, chat_title`,
        [chatId, linkCode, ownerUserId, ownerUsername || null]
      );
      
      return { success: true, linkCode, chatTitle: res.rows[0]?.chat_title };
    } catch (err) {
      logger.warn({ err, chatId }, 'Failed to register chat owner');
      throw err;
    }
  }

  _estimateSellPrice(result) {
    const base = result.baseCredits ?? result.creditsGained ?? result.finalCredits ?? 0;
    const mult = PRICE_MULT[result.rarity] ?? 1;
    return Math.round(base * mult);
  }

  _buildDetailParts(result, isRu) {
    const d = result.objectData || {};
    const ft = result.findType;
    const parts = [];

    const mass = (n) => `${isRu ? 'Масса' : 'Mass'}: ${fmtPrecise(n)} ${isRu ? 'кг' : 'kg'}`;
    const vol  = (n) => `${isRu ? 'Объём' : 'Volume'}: ${fmtPrecise(n)} ${isRu ? 'м³' : 'm³'}`;

    if (ft === 'asteroid') {
      if (d.scanned) {
        if (d.resourceName) parts.push(escMd(String(d.resourceName)));
        if (d.estimatedVolume != null) parts.push(`${isRu ? 'Объём' : 'Volume'}: ${fmtPrecise(d.estimatedVolume)} т`);
        if (d.condition != null) parts.push(`${isRu ? 'Состояние' : 'Condition'}: ${d.condition}%`);
      } else {
        parts.push(isRu ? 'Ресурс не сканирован' : 'Resource unscanned');
      }
    } else if (ft === 'artifact' || ft === 'relic') {
      if (d.race) parts.push(`${isRu ? 'Цивилизация' : 'Civilization'}: ${escMd(String(d.race))}`);
      if (d.mass != null) parts.push(mass(d.mass));
    } else if (ft === 'creature' || ft === 'entity') {
      if (d.mass != null) parts.push(mass(d.mass));
      if (d.isIntelligent != null) {
        parts.push(d.isIntelligent
          ? (isRu ? 'Разумное существо' : 'Sentient')
          : (isRu ? 'Животное' : 'Animal'));
      }
    } else if (ft === 'anomaly' || ft === 'rift') {
      if (d.mass != null) parts.push(mass(d.mass));
      if (d.containerIntegrity != null) parts.push(`${isRu ? 'Целостность' : 'Integrity'}: ${d.containerIntegrity}%`);
    } else if (ft === 'debris' || ft === 'echo' || ft === 'scrap') {
      if (d.mass != null) parts.push(mass(d.mass));
      if (d.volume != null) parts.push(vol(d.volume));
    } else if (ft === 'story_item') {
      if (d.description) parts.push(escMd(String(d.description)));
    }

    return parts;
  }

  _formatResultText(result, lang) {
    const isRu = lang === 'ru';
    const rarity = result.rarity || 'common';
    const findType = result.findType || 'debris';

    const rLabel    = (RARITY_LABELS[lang]    || RARITY_LABELS.ru)[rarity]    || rarity;
    const tLabel    = (FIND_TYPE_LABELS[lang]  || FIND_TYPE_LABELS.ru)[findType] || findType;
    const voice     = HIGH_RARITY_VOICE.has(rarity) ? ((RARITY_VOICE[lang] || RARITY_VOICE.ru)[rarity] || '') : '';
    const typeEmoji = TYPE_EMOJI[findType] || '🔭';

    const objData = result.objectData || {};
    const rawName = objData.name || objData.nameRu || objData.nameEn || tLabel;
    const name = escMd(rawName);

    // Currency: credits or crystals (Universe 2 sells)
    const isUniverse2 = (result.universe || 1) === 2;
    const crystalsGained = result.crystalsGained ?? 0;
    const isU2Sale = result.saleCurrency === 'crystals';
    const actualCredits = isU2Sale ? 0 : (result.creditsGained ?? result.finalCredits ?? 0);
    const estimatedPrice = actualCredits === 0 && !isU2Sale ? this._estimateSellPrice(result) : 0;
    const coinEmoji = isUniverse2 ? '💎' : '🪙';
    const creditLine = isU2Sale && crystalsGained > 0
      ? `💎 +${fmtNum(crystalsGained)}`
      : (actualCredits > 0
        ? `${coinEmoji} +${fmtNum(actualCredits)}`
        : (estimatedPrice > 0 ? `${coinEmoji} ~${fmtNum(estimatedPrice)}` : null));
    const xp = result.xpGained ?? 0;

    const rarityLine = `${isRu ? 'Редкость' : 'Rarity'}: ${rLabel}`;
    const typeLine   = `${isRu ? 'Тип' : 'Type'}: ${tLabel}`;

    const lines = [isRu ? '🛸 *Экспедиция вернулась!*' : '🛸 *Expedition returned!*'];

    if (result.outcome === 'no_capsule') {
      if (voice) lines.push(`*${escMd(voice)}*`);
      lines.push(`${typeEmoji} *${name}*`);
      lines.push(rarityLine);
      lines.push(typeLine);
      lines.push(isRu ? '_Нет капсулы — существо улетело_' : '_No capsule — creature escaped_');
      return lines.join('\n');
    }

    if (result.outcome === 'cargo_full') {
      lines.push(`${typeEmoji} *${name}*`);
      lines.push(rarityLine);
      lines.push(typeLine);
      lines.push(isRu ? '_Трюм переполнен_' : '_Cargo full_');
      if (creditLine) lines.push(creditLine);
      if (xp > 0) lines.push(`✨ +${xp} XP`);
      if (result.leveledUp) lines.push(isRu ? `🧬 *Уровень ${result.newLevel}!*` : `🧬 *Level ${result.newLevel}!*`);
      return lines.join('\n');
    }

    if (findType === 'nft_container') {
      lines.push(`💎 *NFT-контейнер!* ${isRu ? 'Администратор уведомлён' : 'Admin notified'}`);
      return lines.join('\n');
    }

    // Voice title only for legendary+ rarities
    if (voice) lines.push(`*${escMd(voice)}*`);

    // Name first, then labeled rarity and type
    lines.push(`${typeEmoji} *${name}*`);
    lines.push(rarityLine);
    lines.push(typeLine);

    // Type-specific details — each on its own line
    const details = this._buildDetailParts(result, isRu);
    for (const d of details) lines.push(d);

    // Credits/crystals + XP on one line
    const rewardParts = [];
    if (creditLine) rewardParts.push(creditLine);
    if (xp > 0) rewardParts.push(`✨ +${fmtNum(xp)} XP`);
    if (rewardParts.length > 0) lines.push(rewardParts.join('  '));

    if (result.geneEnhancerProc) {
      const { originalRarity, upgradedRarity } = result.geneEnhancerProc;
      const from = (RARITY_LABELS[lang] || RARITY_LABELS.ru)[originalRarity] || originalRarity;
      const to   = (RARITY_LABELS[lang] || RARITY_LABELS.ru)[upgradedRarity] || upgradedRarity;
      lines.push(isRu ? `🧬 Генный усилитель: ${from} → ${to}` : `🧬 Gene enhancer: ${from} → ${to}`);
    }

    if (result.leveledUp) lines.push(isRu ? `🧬 *Уровень ${result.newLevel}!*` : `🧬 *Level ${result.newLevel}!*`);

    return lines.join('\n');
  }
}

module.exports = ChatExpeditionService;
