'use strict';

const TelegramBot = require('node-telegram-bot-api');
const crypto = require('crypto');
const logger = require('../utils/logger');
const { query } = require('../db/pool');

const MESSAGES = {
  ru: {
    pilot: 'Пилот',
    startTitle: '🚀 Привет, {{name}}!',
    startBody:
      'StarLoot — космическая игра об экспедициях.\n\n' +
      'Отправляйте корабль исследовать сектора галактики, находите объекты, артефакты и аномалии, зарабатывайте кредиты и улучшайте корабль для более дальних экспедиций.\n\n' +
      'Иногда среди находок встречаются NFT-контейнеры с подарками.',
    appGroupMessage:
      'Привет, {{name}}! StarLoot — космическая игра об экспедициях!\n\n' +
      'Чтобы открыть приложение, перейди в бота по ссылке внизу.',
    openBot: 'Перейти в бота',
    launchGame: '🚀 Запустить игру',
    helpText:
      '📖 Как играть\n\n' +
      '1️⃣ Отправьте экспедицию и выберите сектор галактики.\n' +
      '2️⃣ Корабль отправится на исследование и вернётся через некоторое время.\n' +
      '3️⃣ После возвращения вы получите находку: ресурс, артефакт, существо или аномалию.\n' +
      '4️⃣ Найденный объект можно сохранить или продать за кредиты.\n' +
      '5️⃣ Используйте кредиты для улучшения корабля и повышения шансов редких находок.\n\n' +
      'Чем дальше и опаснее сектор — тем выше шанс найти ценные объекты.',
    supportPrompt:
      '📋 *Обращение в поддержку по оплате*\n\n' +
      'Опишите вашу проблему одним сообщением — укажите:\n' +
      '• Что именно произошло\n• Когда (примерная дата/время)\n• Сумму Stars\n\n' +
      'Мы ответим вам как можно скорее.',
    generalSupportPrompt:
      '📋 *Обращение в поддержку*\n\n' +
      'Опишите вашу проблему или вопрос одним сообщением.\n\n' +
      'Мы ответим вам как можно скорее.',
    supportReceived: '✅ Ваше обращение получено! Мы рассмотрим его и ответим вам.',
    supportReply: '💬 *Ответ от поддержки:*\n\n{{text}}',
    goToGame: '🌌 В игру',
  },
  en: {
    pilot: 'Pilot',
    startTitle: '🚀 Hi, {{name}}!',
    startBody:
      'StarLoot is a space expedition game.\n\n' +
      'Send your ship to explore galaxy sectors, discover objects, artifacts and anomalies, earn credits, and upgrade your ship for longer expeditions.\n\n' +
      'Sometimes you can find NFT containers with rewards.',
    appGroupMessage:
      'Hi, {{name}}! StarLoot is a space expedition game!\n\n' +
      'To open the app, go to the bot using the link below.',
    openBot: 'Open bot',
    launchGame: '🚀 Launch game',
    helpText:
      '📖 How to play\n\n' +
      '1️⃣ Start an expedition and choose a galaxy sector.\n' +
      '2️⃣ Your ship explores and returns after some time.\n' +
      '3️⃣ When it returns, you get a find: resource, artifact, creature, or anomaly.\n' +
      '4️⃣ You can keep the found object or sell it for credits.\n' +
      '5️⃣ Use credits to upgrade your ship and increase rare find chances.\n\n' +
      'The farther and more dangerous the sector, the better the potential rewards.',
    supportPrompt:
      '📋 *Payment support request*\n\n' +
      'Describe your issue in one message and include:\n' +
      '• What happened\n• When it happened (approx date/time)\n• Stars amount\n\n' +
      'We will reply as soon as possible.',
    generalSupportPrompt:
      '📋 *Support request*\n\n' +
      'Describe your issue or question in one message.\n\n' +
      'We will reply as soon as possible.',
    supportReceived: '✅ Your request has been received. We will get back to you soon.',
    supportReply: '💬 *Support reply:*\n\n{{text}}',
    goToGame: '🌌 Open game',
  },
};

// ── Helper functions ──────────────────────────────────────────────────────

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

class SpaceGameBot {
  constructor() {
    this.token = process.env.TELEGRAM_BOT_TOKEN;
    this.appUrl = process.env.MINI_APP_URL;
    this.adminId = process.env.ADMIN_TELEGRAM_ID
      ? parseInt(process.env.ADMIN_TELEGRAM_ID)
      : null;
    this.bot = null;
    this.botUsername = null;
    this.starsWalletService = null;
    this.nftNotificationService = null;
    this.miniTournamentService = null;
    this.expeditionService = null;
    this.chatExpeditionService = null;
    // Tracks users who sent /paysupport and are waiting to type their message
    // Map<userId, timestamp>
    this._pendingSupport = new Map();
    // Tracks admin pending reply to a support user
    // Map<adminId, { targetUserId, targetName, timestamp }>
    this._pendingReply = new Map();
    // Tracks users in /link owner registration flow
    // Map<userId, { step, chatId, chatTitle, isOwner, timestamp }>
    this._pendingLinkRegistration = new Map();
  }

  injectServices({ starsWalletService, nftNotificationService, miniTournamentService, chatExpeditionService, expeditionService }) {
    this.starsWalletService = starsWalletService;
    this.nftNotificationService = nftNotificationService;
    this.miniTournamentService = miniTournamentService;
    this.chatExpeditionService = chatExpeditionService;
    this.expeditionService = expeditionService;
    if (this.chatExpeditionService?.setBotStartLinkBuilder) {
      this.chatExpeditionService.setBotStartLinkBuilder(async (msg) => {
        const payload = await this._ensureChatLinkPayload(msg);
        return this._buildBotStartLink(payload);
      });
    }
  }

  async init() {
    if (!this.token) {
      logger.warn('TELEGRAM_BOT_TOKEN not set, bot disabled');
      return;
    }
    this.bot = new TelegramBot(this.token, {
      polling: process.env.BOT_POLLING === 'true',
    });

    // Fetch and cache bot username for deep links
    try {
      const me = await this.bot.getMe();
      this.botUsername = me.username;
      logger.info({ botUsername: this.botUsername }, 'Bot username fetched');
    } catch (err) {
      logger.warn({ err }, 'Could not fetch bot username');
    }

    this._registerHandlers();
    await this._setLocalizedCommands();
    logger.info('Telegram bot initialized');
    if (!this.adminId) {
      logger.warn('ADMIN_TELEGRAM_ID not set — admin notifications disabled');
    }
  }

  async setWebhook(webhookUrl) {
    if (!this.bot) return;
    await this.bot.setWebHook(`${webhookUrl}/bot-webhook`, {
      secret_token: process.env.BOT_WEBHOOK_SECRET,
      allowed_updates: ['message','callback_query','pre_checkout_query'],
    });
    logger.info({ webhookUrl }, 'Webhook set');
  }

  processUpdate(update) {
    if (!this.bot) return;
    this.bot.processUpdate(update);
  }

  getBotUsername() {
    return this.botUsername;
  }

  /**
   * Check if a user is a member of the StarLoot Telegram channel.
   * Returns true for statuses: member, administrator, creator.
   */
  async checkChannelMembership(userId) {
    const CHANNEL_ID = '-1003692333086';
    if (!this.bot) return false;
    try {
      const member = await this.bot.getChatMember(CHANNEL_ID, userId);
      const status = member?.status;
      return ['member', 'administrator', 'creator'].includes(status);
    } catch {
      return false;
    }
  }

  _isPrivateChat(msg) {
    return msg?.chat?.type === 'private';
  }

  _lang(input) {
    const code = String(input || '').toLowerCase();
    if (!code) return 'ru';
    return code.startsWith('ru') ? 'ru' : 'en';
  }

  _msg(lang, key, vars = {}) {
    let text = (MESSAGES[lang] && MESSAGES[lang][key]) || MESSAGES.en[key] || '';
    for (const [k, v] of Object.entries(vars)) {
      text = text.replace(new RegExp(`{{${k}}}`, 'g'), String(v));
    }
    return text;
  }

  async _setLocalizedCommands() {
    if (!this.bot) return;
    const ruCommands = [
      { command: 'start', description: 'Открыть игру' },
      { command: 'help', description: 'Как играть' },
      { command: 'fly', description: '🚀 Отправить экспедицию' },
      { command: 'status', description: '📊 Статус игрока' },
      { command: 'support', description: 'Поддержка' },
      { command: 'paysupport', description: 'Поддержка по оплате' },
    ];
    const enCommands = [
      { command: 'start', description: 'Open game' },
      { command: 'help', description: 'How to play' },
      { command: 'fly', description: '🚀 Send expedition' },
      { command: 'status', description: '📊 Player status' },
      { command: 'support', description: 'Support' },
      { command: 'paysupport', description: 'Payment support' },
    ];

    const groupRuCommands = [
      { command: 'app', description: '🚀 Открыть приложение' },
      { command: 'fly', description: '🚀 Отправить экспедицию' },
      { command: 'status', description: '📊 Статус игрока' },
      { command: 'long', description: '⚡ Долгая / быстрая экспедиция' },
      { command: 'zone', description: '🗺 Выбрать зону' },
    ];
    const groupEnCommands = [
      { command: 'app', description: '🚀 Open app' },
      { command: 'fly', description: '🚀 Send expedition' },
      { command: 'status', description: '📊 Player status' },
      { command: 'long', description: '⚡ Long / fast expedition' },
      { command: 'zone', description: '🗺 Select zone' },
    ];

    try {
      // Clear default scope
      await this.bot.setMyCommands([], { scope: { type: 'default' } });

      // Group chats: only expedition controls
      await this.bot.setMyCommands(groupRuCommands, { scope: { type: 'all_group_chats' }, language_code: 'ru' });
      await this.bot.setMyCommands(groupEnCommands, { scope: { type: 'all_group_chats' }, language_code: 'en' });
      await this.bot.setMyCommands(groupRuCommands, { scope: { type: 'all_group_chats' } });

      // Set commands only for private chats (DMs with the bot)
      await this.bot.setMyCommands(ruCommands, { scope: { type: 'all_private_chats' }, language_code: 'ru' });
      await this.bot.setMyCommands(enCommands, { scope: { type: 'all_private_chats' }, language_code: 'en' });
      await this.bot.setMyCommands(ruCommands, { scope: { type: 'all_private_chats' } });
    } catch (err) {
      logger.warn({ err }, 'Failed to set localized bot commands');
    }
  }

  async _trackStartPayload(payload, userId) {
    if (!payload) return;

    // Determine tracking source:
    //   src_<code>  → track as <code>
    //   chat_<code> → chat deep link source
    //   ad / ad_*   → track as "ad" (legacy compat)
    //   ref_*       → not tracked here (referral system)
    //   paysupport  → not tracked
    let source = null;
    if (payload.startsWith('src_') && payload.length > 4) {
      source = payload.slice(4);
    } else if (payload.startsWith('chat_') && payload.length > 5) {
      source = payload;
    } else if (payload === 'ad' || payload.startsWith('ad_')) {
      source = 'ad';
    }
    if (!source) {
      try {
        const rows = await query(
          'SELECT 1 FROM chat_sources WHERE link_code = $1 LIMIT 1',
          [payload]
        );
        if (rows.rows?.length) source = `chat_${payload}`;
      } catch (err) {
        logger.warn({ err, payload }, 'Failed to resolve start payload as chat link');
      }
    }
    if (!source) return;

    try {
      // Check if user already existed before this /start
      const existingUser = await query(
        'SELECT 1 FROM users WHERE id = $1', [userId]
      );
      const isNewUser = !existingUser.rows?.length;

      // Upsert aggregate counter
      await query(
        `INSERT INTO start_link_analytics (source, starts_count, unique_users, updated_at, last_start_at)
         VALUES ($1, 1, 1, NOW(), NOW())
         ON CONFLICT (source) DO UPDATE
           SET starts_count = start_link_analytics.starts_count + 1,
               last_start_at = NOW(),
               updated_at = NOW()`,
        [source]
      );

      // Update unique_users only if this user hasn't started via this source before
      const alreadyTracked = await query(
        'SELECT 1 FROM link_start_events WHERE source = $1 AND user_id = $2 LIMIT 1',
        [source, userId]
      );
      if (!alreadyTracked.rows?.length) {
        await query(
          'UPDATE start_link_analytics SET unique_users = unique_users + 1 WHERE source = $1',
          [source]
        );
      }

      // Record individual event
      await query(
        `INSERT INTO link_start_events (source, user_id, is_new_user)
         VALUES ($1, $2, $3)`,
        [source, userId, isNewUser]
      );
    } catch (err) {
      logger.warn({ err, payload, source }, 'Failed to track start payload');
    }
  }

  _registerHandlers() {
    this.bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
      if (!this._isPrivateChat(msg)) return;

      const lang = this._lang(msg.from?.language_code);
      const firstName = msg.from?.first_name || this._msg(lang, 'pilot');
      const payload = match?.[1]?.trim();

      await this._trackStartPayload(payload, msg.from?.id);
      await this._registerStartUser(msg, payload).catch((err) => {
        logger.warn({ err, userId: msg.from?.id, payload }, 'Failed to register user on /start');
      });

      // Deep link: /start paysupport — immediately enter support flow
      if (payload === 'paysupport') {
        return this._promptSupportMessage(msg.chat.id, msg.from.id, msg.from?.language_code, 'payment');
      }
      // Deep link: /start support — general support flow
      if (payload === 'support') {
        return this._promptSupportMessage(msg.chat.id, msg.from.id, msg.from?.language_code, 'general');
      }

      // Deep link: /start ref_<userId> — referral link, pass to webapp
      let webAppUrl = this.appUrl;
      if (payload && payload.startsWith('ref_')) {
        const refId = payload.slice(4);
        webAppUrl = `${this.appUrl}?ref=${refId}`;
        // Also save as pending_referrer in DB so frontend can pick it up even
        // if the ?ref= URL param gets lost (e.g. user presses old Launch button)
        try {
          const { query: dbQuery } = require('../db/pool');
          await dbQuery(
            `UPDATE users SET pending_referrer_id = $1
             WHERE id = $2 AND referred_by IS NULL AND pending_referrer_id IS NULL`,
            [refId, msg.from.id]
          );
        } catch (_) { /* non-critical */ }
      }

      // Deep link: /start chat_<code> — chat registration link, pass through to webapp
      if (payload && payload.startsWith('chat_')) {
        webAppUrl = `${this.appUrl}?chat=${encodeURIComponent(payload)}`;
      }

      await this.bot.sendMessage(msg.chat.id,
        `${this._msg(lang, 'startTitle', { name: firstName })}\n\n` +
        `${this._msg(lang, 'startBody')}`,
        {
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: this._msg(lang, 'launchGame'), web_app: { url: webAppUrl } }]] },
        }
      );
    });

    this.bot.onText(/\/help/, async (msg) => {
      if (!this._isPrivateChat(msg)) return;
      const lang = this._lang(msg.from?.language_code);

      await this.bot.sendMessage(msg.chat.id,
        this._msg(lang, 'helpText'),
        { parse_mode: 'Markdown' }
      );
    });

    // ── /fly command: Send expedition from private chat ──────────────────
    this.bot.onText(/^\/fly(?:\s|$)/, async (msg) => {
      if (!this._isPrivateChat(msg)) return;

      try {
        const userId = msg.from.id;
        const chatId = msg.chat.id;
        const { username, first_name, language_code } = msg.from;

        // Get or create user
        let userRes = await query('SELECT * FROM users WHERE id = $1', [userId]);
        let isNew = false;

        if (!userRes.rows.length) {
          isNew = true;
          const registerRes = await query(
            `INSERT INTO users
               (id, username, first_name, language_code, registration_source_type, last_active_at)
             VALUES ($1, $2, $3, $4, 'private_chat', NOW())
             ON CONFLICT (id) DO UPDATE SET last_active_at = NOW()
             RETURNING *`,
            [userId, username || null, first_name || null, language_code || 'ru']
          );
          userRes = registerRes;

          // Create ship modules
          await query(
            `INSERT INTO ship_modules (user_id, module_type, level)
             VALUES ($1, 'scanner', 0), ($1, 'engine', 0), ($1, 'cargo', 0), ($1, 'capsule', 0)
             ON CONFLICT (user_id, module_type) DO NOTHING`,
            [userId]
          );

          const lang = this._lang(language_code);
          const name = first_name || (lang === 'ru' ? 'Пилот' : 'Pilot');
          await this.bot.sendMessage(chatId,
            lang === 'ru'
              ? `👋 Привет, *${name}*! Аккаунт создан. Отправляю экспедицию...`
              : `👋 Hi, *${name}*! Account created. Sending expedition...`,
            { parse_mode: 'Markdown' }
          );
        }

        const user = userRes.rows[0];
        const lang = this._lang(user.language_code || language_code);

        // Check for active expedition
        const active = await this.expeditionService.getActiveExpedition(userId);

        if (active && active.status === 'in_progress') {
          const remaining = Math.max(0, Math.ceil((new Date(active.endsAt) - Date.now()) / 1000));
          if (remaining > 0) {
            await this.bot.sendMessage(chatId,
              lang === 'ru'
                ? `🛸 Экспедиция уже в процессе.\nОсталось: *${formatTime(remaining, lang)}*`
                : `🛸 Expedition already in progress.\nTime left: *${formatTime(remaining, lang)}*`,
              { parse_mode: 'Markdown' }
            );
            return;
          }
        }

        // Collect completed or start new
        if (active && (active.status === 'completed' || active.endsAt <= new Date())) {
          await this.expeditionService.collectExpedition(userId);
        }

        const newExpRes = await this.expeditionService.startExpedition(userId);
        const expName = newExpRes.zoneName || 'Unknown Zone';
        const duration = Math.ceil((new Date(newExpRes.endsAt) - Date.now()) / 1000);

        await this.bot.sendMessage(chatId,
          lang === 'ru'
            ? `🚀 Экспедиция отправлена!\n\n📍 Зона: *${expName}*\n⏱ Вернётся через: *${formatTime(duration, lang)}*`
            : `🚀 Expedition sent!\n\n📍 Zone: *${expName}*\n⏱ Returns in: *${formatTime(duration, lang)}*`,
          { parse_mode: 'Markdown' }
        );
      } catch (err) {
        logger.warn({ err, userId: msg.from?.id }, '/fly command failed');
        const lang = this._lang(msg.from?.language_code);
        await this.bot.sendMessage(msg.chat.id,
          lang === 'ru' ? '❌ Ошибка при запуске экспедиции' : '❌ Error sending expedition',
          { parse_mode: 'Markdown' }
        );
      }
    });

    // Group chat: /app command — show app launch link tied to this chat
    this.bot.onText(/^\/app(?:@\S+)?(?:\s|$)/i, async (msg) => {
      if (!this.chatExpeditionService?.isGroupChat(msg)) return;

      const lang = this._lang(msg.from?.language_code);
      const firstName = msg.from?.first_name || this._msg(lang, 'pilot');

      try {
        const payload = await this._ensureChatLinkPayload(msg);
        const startLink = this._buildBotStartLink(payload);

        await this.bot.sendMessage(msg.chat.id,
          this._msg(lang, 'appGroupMessage', { name: firstName }),
          {
            parse_mode: 'Markdown',
            reply_to_message_id: msg.message_id,
            reply_markup: { inline_keyboard: [[{ text: this._msg(lang, 'openBot'), url: startLink }]] },
          }
        );
      } catch (err) {
        logger.warn({ err, chatId: msg.chat?.id }, '/app command failed');
        await this.bot.sendMessage(msg.chat.id,
          lang === 'ru' ? 'Не удалось создать ссылку на приложение' : 'Could not create app link',
          { reply_to_message_id: msg.message_id }
        ).catch(() => {});
      }
    });

    // ── /status command: Show player info ───────────────────────────────
    this.bot.onText(/^\/status(?:@\S+)?(?:\s|$)/i, async (msg) => {
      // Works in both private and group chats

      try {
        const userId = msg.from.id;
        const chatId = msg.chat.id;
        const { username, first_name, language_code } = msg.from;

        // Get or create user
        let userRes = await query('SELECT * FROM users WHERE id = $1', [userId]);

        if (!userRes.rows.length) {
          const registerRes = await query(
            `INSERT INTO users
               (id, username, first_name, language_code, registration_source_type, last_active_at)
             VALUES ($1, $2, $3, $4, 'private_chat', NOW())
             ON CONFLICT (id) DO UPDATE SET last_active_at = NOW()
             RETURNING *`,
            [userId, username || null, first_name || null, language_code || 'ru']
          );
          userRes = registerRes;

          // Create ship modules
          await query(
            `INSERT INTO ship_modules (user_id, module_type, level)
             VALUES ($1, 'scanner', 0), ($1, 'engine', 0), ($1, 'cargo', 0), ($1, 'capsule', 0)
             ON CONFLICT (user_id, module_type) DO NOTHING`,
            [userId]
          );

          const lang = this._lang(language_code);
          const name = first_name || (lang === 'ru' ? 'Пилот' : 'Pilot');
          await this.bot.sendMessage(chatId,
            lang === 'ru'
              ? `👋 Привет, *${name}*! Аккаунт создан.`
              : `👋 Hi, *${name}*! Account created.`,
            { parse_mode: 'Markdown', reply_to_message_id: msg.message_id }
          );
        }

        const user = userRes.rows[0];
        const lang = this._lang(user.language_code || language_code);
        const isRu = lang === 'ru';

        // Get active expedition info and zone
        const active = await this.expeditionService.getActiveExpedition(userId);
        let expeditionStatus = isRu ? '❌ Нет' : '❌ None';
        let currentZone = '';
        
        if (active && active.status === 'in_progress') {
          const remaining = Math.max(0, Math.ceil((new Date(active.endsAt) - Date.now()) / 1000));
          if (remaining > 0) {
            expeditionStatus = isRu
              ? `⏱ В процессе (${formatTime(remaining, lang)})`
              : `⏱ In progress (${formatTime(remaining, lang)})`;
          }
        }

        // Get current zone from active expedition or first available zone
        if (active && active.zoneId) {
          currentZone = active.zoneId;
        } else {
          // Get first available zone for this player
          const config = this.expeditionService.configManager?.config;
          const universe = user.current_universe || 1;
          const zones = universe === 2 
            ? (config?.universe2?.zones || []) 
            : (config?.zones || []);
          const userLevel = user.level || 1;
          
          // Find first zone that's accessible
          const accessibleZone = zones.find(z => (z.minLevel || 1) <= userLevel);
          if (accessibleZone) {
            currentZone = isRu ? (accessibleZone.name || accessibleZone.id) : (accessibleZone.nameEn || accessibleZone.name || accessibleZone.id);
          }
        }
        
        // Resolve zone ID to zone name
        if (currentZone) {
          const config = this.expeditionService.configManager?.config;
          const universe = user.current_universe || 1;
          const zones = universe === 2 
            ? (config?.universe2?.zones || []) 
            : (config?.zones || []);
          const zone = zones.find(z => z.id === currentZone);
          if (zone) {
            currentZone = isRu ? (zone.name || zone.id) : (zone.nameEn || zone.name || zone.id);
          }
        }

        // Get long expedition status - check if particle_decelerator is unlocked
        const deceleratorRes = await query(
          `SELECT 1 FROM user_story_items WHERE user_id = $1 AND item_key = 'particle_decelerator' LIMIT 1`,
          [userId]
        );
        const hasDecelerator = deceleratorRes.rows.length > 0;
        
        let longModeStatus = '';
        if (hasDecelerator) {
          longModeStatus = isRu 
            ? '⚡ Включена долгая экспедиция'
            : '⚡ Long expedition enabled';
        }

        // Build status message
        let statusMsg = isRu ? '📊 *Статус игрока*\n\n' : '📊 *Player Status*\n\n';
        
        statusMsg += isRu 
          ? `👤 Имя: *${user.first_name || 'Пилот'}*\n`
          : `👤 Name: *${user.first_name || 'Pilot'}*\n`;
        
        statusMsg += isRu
          ? `💫 Уровень: *${user.level || 1}*\n`
          : `💫 Level: *${user.level || 1}*\n`;
        
        // Show XP after level
        statusMsg += isRu
          ? `📈 Опыт: *${(user.xp || 0).toLocaleString('ru-RU')}*\n`
          : `📈 Experience: *${(user.xp || 0).toLocaleString('en-US')}*\n`;
        
        statusMsg += isRu
          ? `💳 Кредиты: *${(user.credits || 0).toLocaleString('ru-RU')}*\n`
          : `💳 Credits: *${(user.credits || 0).toLocaleString('en-US')}*\n`;
        
        // Show crystals only if > 0
        if ((user.crystals || 0) > 0) {
          statusMsg += isRu
            ? `💎 Кристаллы: *${(user.crystals || 0).toLocaleString('ru-RU')}*\n`
            : `💎 Crystals: *${(user.crystals || 0).toLocaleString('en-US')}*\n`;
        }
        
        // Show prestige only if > 0
        if ((user.prestige_level || 0) > 0) {
          statusMsg += isRu
            ? `🎖️ Престиж: *${user.prestige_level}*\n`
            : `🎖️ Prestige: *${user.prestige_level}*\n`;
        }
        
        // Show current zone if available
        if (currentZone) {
          statusMsg += isRu
            ? `🗺️ Зона: *${currentZone}*\n`
            : `🗺️ Zone: *${currentZone}*\n`;
        }
        
        statusMsg += isRu
          ? `🚀 Экспедиция: ${expeditionStatus}\n`
          : `🚀 Expedition: ${expeditionStatus}\n`;
        
        // Show long expedition status only if particle_decelerator is unlocked
        if (hasDecelerator) {
          statusMsg += longModeStatus;
        }

        await this.bot.sendMessage(chatId, statusMsg, { parse_mode: 'Markdown', reply_to_message_id: msg.message_id });
      } catch (err) {
        logger.warn({ err, userId: msg.from?.id }, '/status command failed');
        const lang = this._lang(msg.from?.language_code);
        await this.bot.sendMessage(msg.chat.id,
          lang === 'ru' ? '❌ Ошибка при получении статуса' : '❌ Error getting status',
          { parse_mode: 'Markdown', reply_to_message_id: msg.message_id }
        );
      }
    });

    this.bot.onText(/^\/chatlink(?:\s+(.+))?$/i, async (msg, match) => {
      if (!this._isPrivateChat(msg)) return;
      const code = String(match?.[1] || '').trim();
      if (!code) {
        await this.bot.sendMessage(msg.chat.id, 'Использование: /chatlink <code>\n\nКод создаётся в админ-панели и ведёт на chat_<code>.');
        return;
      }
      if (!/^[a-zA-Z0-9_-]+$/.test(code)) {
        await this.bot.sendMessage(msg.chat.id, 'Код может содержать только латиницу, цифры, _ и -');
        return;
      }
      if (!this.botUsername) {
        await this.bot.sendMessage(msg.chat.id, 'Не удалось определить username бота');
        return;
      }
      const link = `https://t.me/${this.botUsername}?start=chat_${code}`;
      await this.bot.sendMessage(msg.chat.id, `Ссылка для чата:\n${link}`);
    });

    // ── General support command ─────────────────────────────────────────
    this.bot.onText(/^\/support(?:\s|$)/, async (msg) => {
      if (!this._isPrivateChat(msg)) return;

      await this._promptSupportMessage(msg.chat.id, msg.from.id, msg.from?.language_code, 'general');
    });

    // ── Payment support command ───────────────────────────────────────────
    this.bot.onText(/\/paysupport/, async (msg) => {
      if (!this._isPrivateChat(msg)) return;

      await this._promptSupportMessage(msg.chat.id, msg.from.id, msg.from?.language_code, 'payment');
    });

    // ── Hidden /link command: register chat owner ───────────────────────────
    this.bot.onText(/^\/link(?:\s|$)/, async (msg) => {
      if (!this._isPrivateChat(msg)) return;

      await this._startLinkRegistration(msg);
    });

    // CRITICAL: must answer pre_checkout within 10 seconds
    this.bot.on('pre_checkout_query', async (query) => {
      logger.info({ queryId: query.id, userId: query.from.id, amount: query.total_amount }, 'Pre-checkout');
      if (this.starsWalletService) {
        await this.starsWalletService.handlePreCheckout(query);
      } else {
        await this.bot.answerPreCheckoutQuery(query.id, true);
      }
    });

    // Group chat: /long command — toggle long/fast expedition mode
    this.bot.onText(/^\/long(?:@\S+)?(?:\s|$)/i, async (msg) => {
      if (!this.chatExpeditionService?.isGroupChat(msg)) return;
      await this.chatExpeditionService.handleLongToggle(this.bot, msg);
    });

    // Group chat: /fly command — send expedition
    this.bot.onText(/^\/fly(?:@\S+)?(?:\s|$)/i, async (msg) => {
      if (!this.chatExpeditionService?.isGroupChat(msg)) return;
      await this.chatExpeditionService.handleCommand(this.bot, msg);
    });

    // Group chat: /zone command — show zone picker
    this.bot.onText(/^\/zone(?:@\S+)?(?:\s|$)/i, async (msg) => {
      if (!this.chatExpeditionService?.isGroupChat(msg)) return;
      await this.chatExpeditionService.handleZoneCommand(this.bot, msg);
    });

    // Group chat expedition trigger handler
    // Works in all group/supergroup chats where the bot is present.
    // Requires privacy mode DISABLED in BotFather (/setprivacy → Disable)
    // so the bot receives all messages, not just commands.
    this.bot.on('message', async (msg) => {
      if (!this.chatExpeditionService) return;
      if (!this.chatExpeditionService.isGroupChat(msg)) return;
      if (!msg.text) return;

      const text = msg.text;
      if (this.chatExpeditionService.isZoneTrigger(text)) {
        await this.chatExpeditionService.handleZoneCommand(this.bot, msg);
      } else if (this.chatExpeditionService.isTriggerWord(text)) {
        await this.chatExpeditionService.handleCommand(this.bot, msg);
      }
    });

    // Main message handler
    this.bot.on('message', async (msg) => {
      // Bot-user flows are private-chat only.
      if (!this._isPrivateChat(msg)) return;

      // 1. Stars payment confirmation
      if (msg.successful_payment) {
        logger.info({ userId: msg.from.id, chargeId: msg.successful_payment.telegram_payment_charge_id }, 'Stars payment success');
        if (this.starsWalletService) {
          const result = await this.starsWalletService.handleSuccessfulPayment(msg.from.id, msg.successful_payment);
          if (result && !result.alreadyProcessed) {
            await this.bot.sendMessage(msg.chat.id,
              `✅ *Баланс пополнен!*\n\n⭐ +${msg.successful_payment.total_amount} Stars\n💫 Баланс: *${result.newBalance} Stars*`,
              { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🌌 В игру', web_app: { url: this.appUrl } }]] } }
            );
          }
        }
        return;
      }

      // 2. Skip commands (handled by onText)
      if (msg.text?.startsWith('/')) return;

      // 3. Admin reply-through-bot flow
      if (msg.from && msg.from.id === this.adminId && this._pendingReply.has(this.adminId)) {
        const { targetUserId, targetName } = this._pendingReply.get(this.adminId);
        this._pendingReply.delete(this.adminId);
        await this._deliverAdminReply(msg, targetUserId, targetName);
        return;
      }

      // 4. Support message flow
      if (msg.from && this._pendingSupport.has(msg.from.id)) {
        const supportInfo = this._pendingSupport.get(msg.from.id);
        this._pendingSupport.delete(msg.from.id);
        await this._forwardSupportMessage(msg, supportInfo?.type || 'payment');
        return;
      }

      // 5. Chat /link owner registration flow
      if (msg.from && this._pendingLinkRegistration.has(msg.from.id)) {
        await this._handleLinkRegistrationInput(msg);
        return;
      }
    });

    // Callback queries (NFT + support reply + mini-tournament)
    this.bot.on('callback_query', async (cbq) => {
      if (cbq.data?.startsWith('nft_done:') && this.nftNotificationService) {
        await this.nftNotificationService.handleAdminCallback(cbq);
      } else if (cbq.data?.startsWith('mini_tournament_mark_gift:') && cbq.from.id === this.adminId) {
        const parts = cbq.data.split(':');
        const targetUserId = parseInt(parts[1]);
        const milestone = parseInt(parts[2]);
        try {
          if (this.miniTournamentService && typeof this.miniTournamentService.markGiftAsIssued === 'function') {
            await this.miniTournamentService.markGiftAsIssued(targetUserId, milestone);
            await this.bot.editMessageReplyMarkup(
              { inline_keyboard: [] },
              { chat_id: cbq.message.chat.id, message_id: cbq.message.message_id }
            );
            await this.bot.answerCallbackQuery(cbq.id, {
              text: 'Подарок учтён. Счётчик обновлен.',
              show_alert: false,
            });
            logger.info({ adminId: cbq.from.id, targetUserId, milestone }, 'Admin marked mini-tournament gift as issued via button');
          } else {
            throw new Error('Mini-tournament service not available');
          }
        } catch (err) {
          logger.warn({ err, targetUserId, milestone }, 'Failed to process mini-tournament mark-gift callback');
          await this.bot.answerCallbackQuery(cbq.id, { text: '❌ Ошибка: ' + err.message, show_alert: true });
        }
      } else if (cbq.data?.startsWith('support_reply:') && cbq.from.id === this.adminId) {
        const parts = cbq.data.split(':');
        const targetUserId = parseInt(parts[1]);
        const targetName = parts.slice(2).join(':') || 'Пользователь';
        this._pendingReply.set(this.adminId, { targetUserId, targetName, timestamp: Date.now() });
        // Auto-expire after 10 min
        setTimeout(() => { this._pendingReply.delete(this.adminId); }, 10 * 60 * 1000);
        await this.bot.answerCallbackQuery(cbq.id, { text: '✏️ Напишите ответ следующим сообщением' });
        await this.bot.sendMessage(cbq.message.chat.id,
          `✏️ Напишите ответ для *${targetName}* (ID: \`${targetUserId}\`).\n\nСледующее ваше сообщение будет отправлено пользователю от имени бота.`,
          { parse_mode: 'Markdown' }
        );
      } else if (this.chatExpeditionService && (
        cbq.data?.startsWith('cxsc:') ||
        cbq.data?.startsWith('cxsd:') ||
        cbq.data?.startsWith('cxsx:')
      )) {
        try {
          if (cbq.data.startsWith('cxsc:')) {
            await this.chatExpeditionService.handleSpeedupConfirm(this.bot, cbq);
          } else if (cbq.data.startsWith('cxsd:')) {
            await this.chatExpeditionService.handleSpeedupDo(this.bot, cbq);
          } else {
            await this.chatExpeditionService.handleSpeedupCancel(this.bot, cbq);
          }
        } catch (err) {
          logger.warn({ err }, 'Chat speedup callback failed');
          await this.bot.answerCallbackQuery(cbq.id).catch(() => {});
        }
      } else if (this.chatExpeditionService && cbq.data?.startsWith('cxzone:')) {
        try {
          await this.chatExpeditionService.handleZoneSelect(this.bot, cbq);
        } catch (err) {
          logger.warn({ err }, 'Zone select callback failed');
          await this.bot.answerCallbackQuery(cbq.id).catch(() => {});
        }
      } else if (this.chatExpeditionService && cbq.data?.startsWith('cxzlock:')) {
        try {
          await this.chatExpeditionService.handleZoneLocked(this.bot, cbq);
        } catch (err) {
          await this.bot.answerCallbackQuery(cbq.id).catch(() => {});
        }
      } else if (cbq.data?.startsWith('link_')) {
        // /link registration flow callbacks
        try {
          await this._handleLinkRegistrationCallback(this.bot, cbq);
        } catch (err) {
          logger.warn({ err }, 'Link registration callback failed');
          await this.bot.answerCallbackQuery(cbq.id, { text: '❌ Ошибка', show_alert: false }).catch(() => {});
        }
      } else {
        await this.bot.answerCallbackQuery(cbq.id);
      }
    });

    this.bot.on('polling_error', (err) => logger.error({ err }, 'Bot polling error'));
    this.bot.on('error', (err) => logger.error({ err }, 'Bot error'));
  }

  _buildBotStartLink(payload) {
    if (!this.botUsername) throw new Error('Bot username is not available');
    return `https://t.me/${this.botUsername}?start=${encodeURIComponent(payload)}`;
  }

  async _ensureChatLinkPayload(msg) {
    const chatId = msg.chat.id;
    const chatTitle = msg.chat.title || null;

    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const linkCode = crypto.randomBytes(6).toString('hex');
      try {
        const res = await query(
          `INSERT INTO chat_sources (chat_id, chat_title, link_code, updated_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (chat_id) DO UPDATE SET
             chat_title = COALESCE(EXCLUDED.chat_title, chat_sources.chat_title),
             link_code = COALESCE(chat_sources.link_code, EXCLUDED.link_code),
             updated_at = NOW()
           RETURNING link_code`,
          [chatId, chatTitle, linkCode]
        );

        const finalCode = res.rows[0]?.link_code;
        if (finalCode) return `chat_${finalCode}`;
      } catch (err) {
        lastErr = err;
        if (err?.code !== '23505') throw err;
      }
    }

    throw lastErr || new Error('Failed to create chat link payload');
  }

  // ── Support flow helpers ────────────────────────────────────────────────

  async _promptSupportMessage(chatId, userId, languageCode, type = 'payment') {
    // Expire old pending after 10 min
    this._pendingSupport.set(userId, { timestamp: Date.now(), type });
    setTimeout(() => {
      if (this._pendingSupport.has(userId)) this._pendingSupport.delete(userId);
    }, 10 * 60 * 1000);

    const lang = this._lang(languageCode);
    const msgKey = type === 'general' ? 'generalSupportPrompt' : 'supportPrompt';
    await this.bot.sendMessage(chatId,
      this._msg(lang, msgKey),
      { parse_mode: 'Markdown' }
    );
  }

  async _registerStartUser(msg, payload) {
    const userId = msg.from?.id;
    if (!userId) return;

    const username = msg.from?.username || null;
    const firstName = msg.from?.first_name || null;
    const lastName = msg.from?.last_name || null;
    const languageCode = msg.from?.language_code || 'ru';

    let registrationChatId = null;
    let registrationChatTitle = null;
    let registrationSourceType = 'organic';

    const linkPayload = String(payload || '').trim();
    if (linkPayload.startsWith('chat_') && linkPayload.length > 5) {
      const linkCode = linkPayload.slice(5);
      const rows = await query(
        'SELECT chat_id, chat_title FROM chat_sources WHERE link_code = $1 LIMIT 1',
        [linkCode]
      );
      if (rows.rows?.length) {
        registrationChatId = rows.rows[0].chat_id;
        registrationChatTitle = rows.rows[0].chat_title || null;
        registrationSourceType = 'chat_link';
      }
    }

    await query(
      `INSERT INTO users (
         id, username, first_name, last_name, language_code, last_active_at,
         registration_chat_id, registration_chat_title, registration_source_type
       )
       VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET
         username = COALESCE(EXCLUDED.username, users.username),
         first_name = COALESCE(EXCLUDED.first_name, users.first_name),
         last_name = COALESCE(EXCLUDED.last_name, users.last_name),
         language_code = COALESCE(EXCLUDED.language_code, users.language_code),
         last_active_at = NOW()`,
      [
        userId,
        username,
        firstName,
        lastName,
        languageCode,
        registrationChatId,
        registrationChatTitle,
        registrationSourceType,
      ]
    );

    await query(
      `INSERT INTO ship_modules (user_id, module_type, level)
       VALUES ($1, 'scanner', 0), ($1, 'engine', 0), ($1, 'cargo', 0), ($1, 'capsule', 0)
       ON CONFLICT (user_id, module_type) DO NOTHING`,
      [userId]
    );
  }

  async _forwardSupportMessage(msg, type = 'payment') {
    const userId = msg.from.id;
    const username = msg.from.username ? `@${msg.from.username}` : '—';
    const firstName = msg.from.first_name || '';
    const text = msg.text || '[не текст]';

    logger.info({ userId, username, text, type }, 'Support message received');

    // Confirm to user
    const lang = this._lang(msg.from?.language_code);
    await this.bot.sendMessage(msg.chat.id,
      this._msg(lang, 'supportReceived'),
      { parse_mode: 'Markdown' }
    );

    // Notify admin
    if (!this.adminId) return;
    const typeLabel = type === 'general' ? '🆘 *Обращение в поддержку*' : '🆘 *Обращение по оплате*';
    try {
      await this.bot.sendMessage(this.adminId,
        `${typeLabel}\n\n` +
        `👤 *Пользователь:* ${firstName} ${username}\n` +
        `🆔 *ID:* \`${userId}\`\n\n` +
        `📝 *Сообщение:*\n${text}`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              { text: '✉️ Ответить через бота', callback_data: `support_reply:${userId}:${firstName}` },
            ]],
          },
        }
      );
    } catch (err) {
      logger.warn({ err }, 'Failed to notify admin about support message');
    }
  }

  async _deliverAdminReply(msg, targetUserId, targetName) {
    const replyText = msg.text || '[не текст]';
    logger.info({ targetUserId, replyText }, 'Admin reply to support user');

    try {
      const langRows = await query('SELECT language_code FROM users WHERE id = $1 LIMIT 1', [targetUserId]);
      const lang = this._lang(langRows[0]?.language_code);
      // Deliver to user
      await this.bot.sendMessage(targetUserId,
        this._msg(lang, 'supportReply', { text: replyText }),
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              { text: this._msg(lang, 'goToGame'), web_app: { url: this.appUrl } },
            ]],
          },
        }
      );
      // Confirm to admin
      await this.bot.sendMessage(msg.chat.id,
        `✅ Ответ отправлен пользователю *${targetName}* (ID: \`${targetUserId}\`)`,
        { parse_mode: 'Markdown' }
      );
    } catch (err) {
      logger.warn({ err, targetUserId }, 'Failed to deliver admin reply');
      await this.bot.sendMessage(msg.chat.id,
        `❌ Не удалось отправить ответ пользователю ${targetUserId}: ${err.message}`,
        { parse_mode: 'Markdown' }
      );
    }
  }

  // ── /link registration flow helpers ────────────────────────────────────

  async _startLinkRegistration(msg) {
    const userId = msg.from.id;
    const username = msg.from.username ? `@${msg.from.username}` : null;
    
    // Expire old pending after 15 min
    this._pendingLinkRegistration.set(userId, { 
      step: 'waiting_chat_id', 
      timestamp: Date.now(),
      username 
    });
    setTimeout(() => {
      if (this._pendingLinkRegistration.has(userId)) this._pendingLinkRegistration.delete(userId);
    }, 15 * 60 * 1000);

    const prompt = await this.bot.sendMessage(msg.chat.id,
      '🔗 *Регистрация ссылки для чата*\n\n' +
      'Введите ID чата (числовой идентификатор, например: -1001234567890)\n\n' +
      '_Отправьте /cancel чтобы отменить_',
      { 
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '❌ Отмена', callback_data: 'link_cancel' }
          ]]
        }
      }
    );

    const state = this._pendingLinkRegistration.get(userId);
    if (state) state.promptMessageId = prompt?.message_id || null;
  }

  async _handleLinkRegistrationInput(msg) {
    const userId = msg.from.id;
    const state = this._pendingLinkRegistration.get(userId);
    if (!state) return;

    const text = (msg.text || '').trim();
    
    // Cancel
    if (text.toLowerCase() === '/cancel' || text === '') {
      if (state.promptMessageId) {
        await this.bot.editMessageText('❌ Регистрация отменена', {
          chat_id: msg.chat.id,
          message_id: state.promptMessageId,
          reply_markup: { inline_keyboard: [] },
        }).catch(() => {});
      }
      if (state.confirmMessageId) {
        await this.bot.editMessageText('❌ Регистрация отменена', {
          chat_id: msg.chat.id,
          message_id: state.confirmMessageId,
          reply_markup: { inline_keyboard: [] },
        }).catch(() => {});
      }
      if (state.usernamePromptMessageId) {
        await this.bot.editMessageText('❌ Регистрация отменена', {
          chat_id: msg.chat.id,
          message_id: state.usernamePromptMessageId,
          reply_markup: { inline_keyboard: [] },
        }).catch(() => {});
      }
      this._pendingLinkRegistration.delete(userId);
      await this.bot.sendMessage(msg.chat.id, '❌ Регистрация отменена');
      return;
    }

    if (state.step === 'waiting_chat_id') {
      // Parse chat ID
      const chatId = parseInt(text);
      if (isNaN(chatId)) {
        await this.bot.sendMessage(msg.chat.id,
          '❌ Неверный формат. Введите числовой ID чата (например: -1001234567890)\n\n_Отправьте /cancel чтобы отменить_',
          { parse_mode: 'Markdown' }
        );
        return;
      }

      // Move to next step
      state.step = 'confirm_owner';
      state.chatId = chatId;

      if (state.promptMessageId) {
        await this.bot.editMessageText(`✅ Chat ID: \`${chatId}\`\n\n🔐 Переходим к следующему шагу`, {
          chat_id: msg.chat.id,
          message_id: state.promptMessageId,
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [] },
        }).catch(() => {});
      }
      
      const confirmPrompt = await this.bot.sendMessage(msg.chat.id,
        `✅ Chat ID: \`${chatId}\`\n\n` +
        '🔐 Ты владелец этого чата?',
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              { text: '✅ Да, я владелец', callback_data: `link_owner:${chatId}` },
              { text: '❌ Нет', callback_data: `link_not_owner:${chatId}` }
            ], [
              { text: '❌ Отмена', callback_data: 'link_cancel' }
            ]]
          }
        }
      );
      state.confirmMessageId = confirmPrompt?.message_id || null;
    } else if (state.step === 'waiting_owner_username') {
      // Owner username for non-owner claim
      const ownerUsername = text.replace(/^@/, '').trim();
      if (!ownerUsername || ownerUsername.length < 3) {
        await this.bot.sendMessage(msg.chat.id,
          '❌ Username должен быть минимум 3 символа. Попробуй ещё раз\n\n_Отправьте /cancel чтобы отменить_',
          { parse_mode: 'Markdown' }
        );
        return;
      }

      if (state.usernamePromptMessageId) {
        await this.bot.editMessageText(`✅ Username принят: @${ownerUsername}`, {
          chat_id: msg.chat.id,
          message_id: state.usernamePromptMessageId,
          reply_markup: { inline_keyboard: [] },
        }).catch(() => {});
      }

      await this._completeOwnerRegistration(msg.chat.id, userId, state.chatId, false, ownerUsername);
      this._pendingLinkRegistration.delete(userId);
    }
  }

  async _handleLinkRegistrationCallback(bot, cbq) {
    const userId = cbq.from.id;
    const state = this._pendingLinkRegistration.get(userId);
    const [action, chatIdStr] = cbq.data.slice(5).split(':');
    const chatId = chatIdStr ? parseInt(chatIdStr) : null;

    if (cbq.data === 'link_cancel') {
      await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
        chat_id: cbq.message.chat.id,
        message_id: cbq.message.message_id,
      }).catch(() => {});
      this._pendingLinkRegistration.delete(userId);
      await bot.answerCallbackQuery(cbq.id, { text: 'Отменено', show_alert: false });
      await bot.editMessageText('❌ Регистрация отменена',
        { chat_id: cbq.message.chat.id, message_id: cbq.message.message_id, reply_markup: { inline_keyboard: [] } }
      ).catch(() => {});
      return;
    }

    if (cbq.data.startsWith('link_owner:') && state && chatId) {
      await bot.answerCallbackQuery(cbq.id, { text: '✅ Регистрирую...', show_alert: false });
      if (state.confirmMessageId) {
        await bot.editMessageText('✅ Да, я владелец', {
          chat_id: cbq.message.chat.id,
          message_id: state.confirmMessageId,
          reply_markup: { inline_keyboard: [] },
        }).catch(() => {});
      } else {
        await bot.editMessageText('✅ Да, я владелец', {
          chat_id: cbq.message.chat.id,
          message_id: cbq.message.message_id,
          reply_markup: { inline_keyboard: [] },
        }).catch(() => {});
      }
      await this._completeOwnerRegistration(cbq.message.chat.id, userId, chatId, true, cbq.from.username ? `@${cbq.from.username}` : null);
      this._pendingLinkRegistration.delete(userId);
    } else if (cbq.data.startsWith('link_not_owner:') && state && chatId) {
      // Ask for owner username
      state.step = 'waiting_owner_username';
      state.chatId = chatId;
      
      await bot.answerCallbackQuery(cbq.id, { text: '📝 Напиши юзернейм владельца', show_alert: false });
      await bot.editMessageText(
        '✅ Нет, я не владелец\n\nВведи юзернейм владельца чата (например: @myusername)\n\n_Отправьте /cancel чтобы отменить_',
        {
          chat_id: cbq.message.chat.id,
          message_id: cbq.message.message_id,
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              { text: '❌ Отмена', callback_data: 'link_cancel' }
            ]]
          }
        }
      );

      state.usernamePromptMessageId = cbq.message.message_id;
    }
  }

  async _completeOwnerRegistration(chatId, userId, targetChatId, isOwner, ownerUsername) {
    try {
      // Check if this user already registered a link for a different chat
      const existing = await query(
        'SELECT link_code, owner_user_id FROM chat_sources WHERE owner_user_id = $1 AND chat_id != $2',
        [userId, targetChatId]
      );

      if (existing.rows.length > 0) {
        await this.bot.sendMessage(chatId,
          '⚠️ Ты уже зарегистрировал ссылку для другого чата. Система позволит добавить только одну основную ссылку.\n\n' +
          'Свяжись с администратором если нужна помощь.',
          { parse_mode: 'Markdown' }
        );
        return;
      }

      // Register / update the owner
      const result = await this.chatExpeditionService.registerChatOwner(
        targetChatId,
        userId,
        isOwner ? (ownerUsername || null) : ownerUsername
      );

      if (result.error === 'owner_mismatch') {
        // Security alert: someone trying to claim already-owned link
        const alertMsg = 
          `🚨 *ПОПЫТКА ПОДМЕНЫ ССЫЛКИ*\n\n` +
          `Пользователь: ${userId}\n` +
          `Username: ${ownerUsername || '—'}\n` +
          `Chat ID: ${targetChatId}\n` +
          `Существующий owner ID: ${result.existingOwnerId}\n\n` +
          `Действие: попытка зарегистрировать ссылку на чат, уже имеющий владельца`;
        
        if (this.adminId) {
          try {
            await this.bot.sendMessage(this.adminId, alertMsg, { parse_mode: 'Markdown' });
            logger.warn({ userId, chatId: targetChatId, existingOwnerId: result.existingOwnerId }, 'Link registration security alert sent to admin');
          } catch (err) {
            logger.warn({ err }, 'Failed to send security alert to admin');
          }
        }

        await this.bot.sendMessage(chatId,
          '⚠️ Этот чат уже зарегистрирован другим владельцем.\n\n' +
          'Администратор уведомлен о данной попытке.',
          { parse_mode: 'Markdown' }
        );
        return;
      }

      if (!result.success) {
        await this.bot.sendMessage(chatId,
          '❌ Ошибка регистрации. Попробуй ещё раз позже.',
          { parse_mode: 'Markdown' }
        );
        return;
      }

      // Success
      const botUrl = this.botUsername ? `https://t.me/${this.botUsername}` : 'бот';
      const link = `${botUrl}?start=chat_${result.linkCode}`;
      
      await this.bot.sendMessage(chatId,
        `✅ *Ссылка создана успешно!*\n\n` +
        `🔗 Ссылка для приглашения:\n\`${link}\`\n\n` +
        `📌 Чат: ${result.chatTitle || `ID ${targetChatId}`}\n\n` +
        `_Поделись этой ссылкой с новичками, чтобы они присоединились к экспедициям вашего чата_`,
        { 
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              { text: '📋 Копировать ссылку', url: link }
            ]]
          }
        }
      );

      logger.info({ userId, chatId: targetChatId, isOwner, linkCode: result.linkCode }, 'Chat owner registered via /link');
    } catch (err) {
      logger.warn({ err, userId, targetChatId }, 'Failed to complete owner registration');
      await this.bot.sendMessage(chatId,
        `❌ Ошибка: ${err.message}`,
        { parse_mode: 'Markdown' }
      );
    }
  }

  _getUsernameForId(userId) {
    // This is a simple placeholder - in real app might need to cache this
    return null;
  }

  async notifyExpeditionReady(telegramUserId, expeditionData) {
    if (!this.bot) return;
    try {
      await this.bot.sendMessage(telegramUserId,
        `🛸 *Экспедиция вернулась!*\n\nЗона: ${expeditionData.zoneName}\nСектор: ${expeditionData.sector}\n\nЗабери находку!`,
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🔍 Забрать', web_app: { url: this.appUrl } }]] } }
      );
    } catch (err) { logger.warn({ err, telegramUserId }, 'notify expedition failed'); }
  }

  async sendShareMessage(telegramUserId, shareText, languageCode, imageBase64) {
    if (!this.bot) return { ok: false, reason: 'bot_unavailable' };

    const safeText = String(shareText || '').trim();
    if (!safeText) return { ok: false, reason: 'empty_text' };

    try {
      if (imageBase64) {
        const buf = Buffer.from(imageBase64, 'base64');
        await this.bot.sendPhoto(telegramUserId, buf, {
          caption: safeText,
          parse_mode: 'Markdown',
        }, { filename: 'item.png', contentType: 'image/png' });
      } else {
        await this.bot.sendMessage(telegramUserId, safeText, {
          parse_mode: 'Markdown',
          disable_web_page_preview: true,
        });
      }
      return { ok: true };
    } catch (err) {
      const msg = String(err?.message || '').toLowerCase();
      if (msg.includes("can't parse entities")) {
        try {
          if (imageBase64) {
            const buf = Buffer.from(imageBase64, 'base64');
            await this.bot.sendPhoto(telegramUserId, buf, {
              caption: safeText,
            }, { filename: 'item.png', contentType: 'image/png' });
          } else {
            await this.bot.sendMessage(telegramUserId, safeText, {
              disable_web_page_preview: true,
            });
          }
          return { ok: true };
        } catch (fallbackErr) {
          logger.warn({ fallbackErr, telegramUserId }, 'Failed to send share message in plain mode');
          return { ok: false, reason: 'send_failed' };
        }
      }

      if (
        msg.includes('forbidden') ||
        msg.includes('chat not found') ||
        msg.includes('bot was blocked')
      ) {
        return { ok: false, reason: 'dm_unavailable' };
      }

      logger.warn({ err, telegramUserId }, 'Failed to send share message');
      return { ok: false, reason: 'send_failed' };
    }
  }

  async notifyLevelUp(telegramUserId, newLevel, unlockedZone) {
    if (!this.bot) return;
    try {
      let text = `🧬 *Уровень ${newLevel}!*`;
      if (unlockedZone) text += `\n\n🗺 Открыта зона: *${unlockedZone}*`;
      await this.bot.sendMessage(telegramUserId, text, { parse_mode: 'Markdown' });
    } catch (err) { logger.warn({ err }, 'notify levelup failed'); }
  }

  _getAnnouncementChatIds() {
    const configured = process.env.EVENT_GROUP_CHAT_ID || process.env.BOT_GROUP_CHAT_ID;
    const mirrorChannelId = '-1003692333086';
    const ids = [configured, mirrorChannelId]
      .map((id) => (id == null ? '' : String(id).trim()))
      .filter(Boolean);
    return [...new Set(ids)];
  }

  /**
   * Send a global event announcement to a Telegram group/channel.
   * Set EVENT_GROUP_CHAT_ID env var to the group/channel ID (e.g. -100123456789).
   */
  async notifyGroupEventStarted(event) {
    if (!this.bot) return;
    const chatIds = this._getAnnouncementChatIds();
    if (!chatIds.length) return;

    const endsAt = new Date(event.endsAt);
    const now = new Date();
    const diffH = Math.round((endsAt - now) / 3600000);
    const durationText = diffH >= 24
      ? `${Math.floor(diffH / 24)} дн. ${diffH % 24} ч.`
      : `${diffH} ч.`;

    const TYPE_LABELS = {
      xp_bonus: '🧬 Бонус XP',
      credits_bonus: '🪙 Бонус кредитов',
      spawn_rate: '🔀 Изменение появления',
      rarity_bonus: '✨ Бонус редкости',
      common_reduction: '📈 Редкие находки чаще',
    };
    const FIND_LABELS = { asteroid: 'Астероиды', debris: 'Мусор', artifact: 'Артефакты', creature: 'Существа', anomaly: 'Аномалии' };
    const RARITY_LABELS = {
      common: 'Обычные',
      rare: 'Редкие',
      epic: 'Эпические',
      legendary: 'Легендарные',
      mythical: 'Мифические',
      exotic: 'Экзотические',
      ancient: 'Древние',
      relic: 'Реликтовые',
      hybrid: 'Гибридные',
      singularity: 'Сингулярности',
    };

    const effectLines = (event.effects || []).map((e) => {
      const zoneNote = e.zones ? ` (зоны: ${e.zones.join(', ')})` : '';
      if (e.type === 'xp_bonus') return `${TYPE_LABELS.xp_bonus}: ×${e.multiplier}${zoneNote}`;
      if (e.type === 'credits_bonus') return `${TYPE_LABELS.credits_bonus}: ×${e.multiplier}${zoneNote}`;
      if (e.type === 'spawn_rate') {
        const what = e.findType ? FIND_LABELS[e.findType] || e.findType : 'Все типы';
        return `${TYPE_LABELS.spawn_rate} (${what}): ×${e.multiplier}${zoneNote}`;
      }
      if (e.type === 'rarity_bonus') {
        const what = e.rarity ? RARITY_LABELS[e.rarity] || e.rarity : 'редкости выше базовой';
        return `${TYPE_LABELS.rarity_bonus} (${what}): ×${e.multiplier}${zoneNote}`;
      }
      if (e.type === 'common_reduction') return `${TYPE_LABELS.common_reduction}: −${Math.round(e.reduction * 100)}% обычных${zoneNote}`;
      return e.type;
    });

    const text = [
      `${event.icon} *Начинается событие: ${event.title}*`,
      event.description ? `\n${event.description}` : '',
      '',
      effectLines.length ? effectLines.join('\n') : '',
      '',
      `⏱ Длительность: *${durationText}*`,
    ].filter((l) => l !== undefined).join('\n').trim();

    for (const chatId of chatIds) {
      try {
        await this.bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
        logger.info({ chatId, eventId: event.id }, 'Event notification sent');
      } catch (err) {
        const newId = err?.response?.body?.parameters?.migrate_to_chat_id;
        if (newId) {
          logger.info({ oldChatId: chatId, newChatId: newId }, 'Chat migrated, retrying');
          try { await this.bot.sendMessage(String(newId), text, { parse_mode: 'Markdown' }); } catch {}
        } else {
          logger.warn({ err, chatId }, 'Failed to send event notification');
        }
      }
    }
  }

  /**
   * Send a tournament announcement to the Telegram group/channel.
   * Falls back to ADMIN_TELEGRAM_ID if EVENT_GROUP_CHAT_ID is not set.
   */
  async notifyGroupTournamentStarted(tournament) {
    if (!this.bot) return;
    const chatIds = this._getAnnouncementChatIds();
    if (!chatIds.length) return;

    const startDate = new Date(tournament.starts_at || tournament.startsAt);
    const endDate = new Date(tournament.ends_at || tournament.endsAt);
    
    const fmtDate = (d) => d.toLocaleDateString('ru-RU', {day:'2-digit', month:'2-digit', year:'2-digit'}).replace(/\//g, '.');
    const fmtTime = (d) => d.toLocaleTimeString('ru-RU', {hour:'2-digit', minute:'2-digit'}).replace(/:/g, '.');
    const dateRange = `${fmtDate(startDate)} ${fmtTime(startDate)} — ${fmtDate(endDate)} ${fmtTime(endDate)}`;
    
    const esc = (s) => String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

    // Format rewards/prizes if available
    const topRewards = tournament.top_rewards || tournament.topRewards || [];
    let rewardsSection = '';
    if (Array.isArray(topRewards) && topRewards.length > 0) {
      const rewardLines = topRewards.map(r => {
        if (typeof r === 'string') return r;
        const from = Number(r?.from);
        const to = Number(r?.to);
        if (!Number.isFinite(from) || !Number.isFinite(to)) return '';
        const placeLabel = from === to ? `${from} место` : `${from}-${to} места`;
        const description = String(r?.description || '').trim();
        const nftLink = String(r?.nftLink || '').trim();
        if (!description) return '';
        const safeDescription = esc(description);
        if (nftLink) {
          return `${placeLabel}: <a href="${esc(nftLink)}">${safeDescription}</a>`;
        }
        return `${placeLabel}: ${safeDescription}`;
      }).filter(Boolean);
      
      if (rewardLines.length > 0) {
        rewardsSection = `\n\n<b>🎁 Награды:</b>\n<blockquote>${rewardLines.join('\n')}</blockquote>`;
      }
    }

    const text = `${tournament.icon || '🏆'} <b>Новый турнир: ${esc(tournament.title)}</b>
${tournament.description ? esc(tournament.description) + '\n' : ''}
  ⏰ <b>${dateRange}</b>${rewardsSection}`;

    for (const chatId of chatIds) {
      try {
        await this.bot.sendMessage(chatId, text, {
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        });
        logger.info({ chatId, tournamentId: tournament.id }, 'Tournament notification sent');
      } catch (err) {
        const newId = err?.response?.body?.parameters?.migrate_to_chat_id;
        if (newId) {
          logger.info({ oldChatId: chatId, newChatId: newId }, 'Chat migrated, retrying');
          try { await this.bot.sendMessage(String(newId), text, { parse_mode: 'HTML', disable_web_page_preview: true }); } catch {}
        } else {
          logger.warn({ err, chatId }, 'Failed to send tournament notification');
        }
      }
    }
  }

  async notifyNFTFound(telegramUserId) {
    if (!this.bot) return;
    try {
      await this.bot.sendMessage(telegramUserId,
        `💎 *NFT КОНТЕЙНЕР!*\n\nАдминистратор уведомлён и скоро отправит награду! 🎉`,
        { parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🌌 Открыть игру', web_app: { url: this.appUrl } }]] } }
      );
    } catch (err) { logger.warn({ err }, 'notify nft failed'); }
  }

  async notifyMiniTournamentReached({ userId, username, firstName, milestone, expeditionsCount, giftsIssued, giftsPending, expeditionsPerGift }) {
    if (!this.bot) throw new Error('Bot not initialized');
    if (!this.adminId) throw new Error('ADMIN_TELEGRAM_ID not configured — set it in env to receive mini-tournament notifications');

    const displayName = firstName || username || `User ${userId}`;
    const milestoneExpeditions = Number(milestone || 0) * Number(expeditionsPerGift || 100);
    const lines = [
        '🏁 *Mini-tournament threshold reached*',
        '',
        `Player: *${String(displayName).replace(/[*_`\\]/g, '')}*`,
        `Telegram ID: \`${userId}\``,
        username ? `Username: @${String(username).replace(/[^a-zA-Z0-9_]/g, '')}` : null,
        '',
        `Threshold: *${milestoneExpeditions} expeditions*`,
        `Total expeditions: *${expeditionsCount}*`,
        `Gifts issued: *${giftsIssued}*`,
        `Pending gifts: *${giftsPending}*`,
    ].filter(Boolean);

    try {
      await this.bot.sendMessage(this.adminId, lines.join('\n'), {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: '✅ Выдал подарок',
                  callback_data: `mini_tournament_mark_gift:${userId}:${milestone}`,
                },
              ],
            ],
          },
      });
      logger.info({ userId, milestone, expeditionsCount, giftsPending }, 'Mini-tournament admin notified with button');
    } catch (err) {
      logger.warn({ err, userId, milestone }, 'Mini-tournament admin notification failed');
      throw err;
    }
  }
}

module.exports = new SpaceGameBot();
