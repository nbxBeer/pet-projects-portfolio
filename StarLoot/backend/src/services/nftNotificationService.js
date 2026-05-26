'use strict';

const { query, withTransaction } = require('../db/pool');
const logger = require('../utils/logger');

/**
 * NftNotificationService
 *
 * When a player finds an NFT container, the system:
 * 1. Records the event in nft_notifications table
 * 2. Sends a Telegram message to the admin (ADMIN_TELEGRAM_ID)
 *    with full player info so admin can manually send the gift
 * 3. Admin marks it as processed via admin API
 *
 * Re: Telegram Stars as NFT — Stars themselves are NFT-based on TON blockchain.
 * The "telegram_gift" outcome represents sending a Telegram Gift (digital collectible).
 * Since automated gifting is not available via Bot API, we use manual admin flow.
 */
class NftNotificationService {
  constructor(bot) {
    this.bot = bot;
    this.adminId = process.env.ADMIN_TELEGRAM_ID
      ? parseInt(process.env.ADMIN_TELEGRAM_ID)
      : null;
  }

  /**
   * Called when an NFT container is found during expedition collection.
   * Creates DB record and notifies admin.
   */
  async handleNftFound(user, expeditionResult) {
    const { objectData, findType } = expeditionResult;
    logger.info(
      { userId: user?.id, findType, hasBot: !!this.bot?.bot, adminId: this.adminId },
      'handleNftFound called'
    );
    if (findType !== 'nft_container') return;

    const outcomeType = objectData?.outcomeType || 'unknown';
    const outcomeLabel = objectData?.outcomeLabel || 'Неизвестная награда';

    logger.info(
      { userId: user.id, username: user.username, outcomeType, outcomeLabel },
      '💎 NFT Container found!'
    );

    return await withTransaction(async (client) => {
      // Save notification record
      const res = await client.query(
        `INSERT INTO nft_notifications
           (user_id, username, first_name, expedition_id, result_id, outcome_type, outcome_label)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id`,
        [
          user.id,
          user.username,
          user.first_name,
          expeditionResult.expeditionId,
          expeditionResult.resultId,
          outcomeType,
          outcomeLabel,
        ]
      );
      const notifId = res.rows[0].id;

      // Notify admin
      await this._notifyAdmin(user, outcomeType, outcomeLabel, notifId);

      // Mark as notified
      await client.query(
        'UPDATE nft_notifications SET admin_notified = true WHERE id = $1',
        [notifId]
      );

      return { notifId, outcomeType, outcomeLabel };
    });
  }

  /**
   * Called from admin panel to manually trigger a notification.
   * Creates DB record (no expedition/result linked) and notifies admin.
   */
  async sendAdminNotification({ userId, username, firstName, outcomeType, outcomeLabel }) {
    const user = { id: userId, username, first_name: firstName };

    return await withTransaction(async (client) => {
      const res = await client.query(
        `INSERT INTO nft_notifications
           (user_id, username, first_name, outcome_type, outcome_label)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [userId, username || null, firstName || null, outcomeType, outcomeLabel]
      );
      const notifId = res.rows[0].id;

      await this._notifyAdmin(user, outcomeType, outcomeLabel, notifId);

      await client.query(
        'UPDATE nft_notifications SET admin_notified = true WHERE id = $1',
        [notifId]
      );

      logger.info({ userId, outcomeType, notifId }, 'Admin notification sent via admin panel');
      return { notifId };
    });
  }

  /**
   * Send Telegram message to admin with full player details.
   */
  async _notifyAdmin(user, outcomeType, outcomeLabel, notifId) {
    if (!this.bot?.bot || !this.adminId) {
      logger.warn(
        { adminId: this.adminId, hasBot: !!this.bot, hasBotInstance: !!this.bot?.bot },
        'Admin notification skipped: no bot or adminId'
      );
      return;
    }

    const playerTag = user.username ? `@${user.username}` : `[${user.first_name}](tg://user?id=${user.id})`;
    const outcomeEmoji = outcomeType === 'telegram_gift' ? '💎' : '🚀';

    const text =
      `🎉 *NFT КОНТЕЙНЕР ВЫБИТ!*\n\n` +
      `👤 *Игрок:* ${playerTag}\n` +
      `🆔 *ID:* \`${user.id}\`\n` +
      `👤 *Имя:* ${user.first_name || '—'}${user.last_name ? ' ' + user.last_name : ''}\n\n` +
      `${outcomeEmoji} *Тип награды:* ${outcomeLabel}\n\n` +
      `📋 *Notification ID:* \`${notifId}\`\n\n` +
      (outcomeType === 'telegram_gift'
        ? `📌 *Действие:* Отправь игроку Telegram Gift (цифровой подарок) вручную через Telegram.\n\nПосле отправки нажми кнопку ниже.`
        : `📌 *Действие:*\n• Выдай роль «Капитан» в чате\n• Уникальный корабль уже активирован в игре\n\nПосле выдачи роли нажми кнопку ниже.`
      );

    try {
      await this.bot.bot.sendMessage(this.adminId, text, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            {
              text: '✅ Отмечено как выданное',
              callback_data: `nft_done:${notifId}`,
            },
          ]],
        },
      });
      logger.info({ adminId: this.adminId, notifId }, 'Admin NFT notification sent');
    } catch (err) {
      logger.error({ err, adminId: this.adminId }, 'Failed to send admin NFT notification');
    }
  }

  /**
   * Handle admin callback: mark NFT as processed.
   * Called when admin taps "✅ Отмечено как выданное".
   */
  async handleAdminCallback(callbackQuery) {
    if (!this.bot?.bot) return;

    const { id, from, data, message } = callbackQuery;

    if (!data?.startsWith('nft_done:')) {
      await this.bot.bot.answerCallbackQuery(id);
      return;
    }

    // Verify it's the admin
    if (from.id !== this.adminId) {
      await this.bot.bot.answerCallbackQuery(id, { text: 'Недостаточно прав' });
      return;
    }

    const notifId = data.replace('nft_done:', '');

    try {
      const res = await query(
        `UPDATE nft_notifications
         SET admin_processed = true, processed_at = NOW(), admin_note = 'Processed by admin'
         WHERE id = $1 AND admin_processed = false
         RETURNING user_id, outcome_type`,
        [notifId]
      );

      if (!res.rows.length) {
        await this.bot.bot.answerCallbackQuery(id, { text: '⚠️ Уже обработано или не найдено' });
        return;
      }

      const { user_id, outcome_type } = res.rows[0];

      // Edit original message to mark as done
      if (message) {
        await this.bot.bot.editMessageText(
          `${message.text}\n\n✅ *Обработано ${new Date().toLocaleString('ru-RU')}*`,
          {
            chat_id: message.chat.id,
            message_id: message.message_id,
            parse_mode: 'Markdown',
          }
        );
      }

      await this.bot.bot.answerCallbackQuery(id, { text: '✅ Отмечено как выданное!' });

      // Notify player that their reward is ready
      await this._notifyPlayer(user_id, outcome_type);

      logger.info({ notifId, userId: user_id }, 'NFT notification processed by admin');
    } catch (err) {
      logger.error({ err, notifId }, 'Failed to process NFT callback');
      await this.bot.bot.answerCallbackQuery(id, { text: 'Ошибка обработки' });
    }
  }

  /**
   * Notify the player that their NFT reward has been sent.
   */
  async _notifyPlayer(userId, outcomeType) {
    if (!this.bot?.bot) return;
    try {
      const text =
        outcomeType === 'telegram_gift'
          ? `💎 *Твоя награда отправлена!*\n\nАдминистратор отправил тебе Telegram Gift!\nПроверь раздел подарков в своём профиле Telegram.`
          : `🚀 *Твой уникальный корабль готов!*\n\nАдминистратор выдал тебе уникальный корабль!\nОткрой игру, чтобы увидеть его в своём гараже.`;

      await this.bot.bot.sendMessage(userId, text, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '🌌 Открыть игру', web_app: { url: process.env.MINI_APP_URL } },
          ]],
        },
      });
    } catch (err) {
      logger.warn({ err, userId }, 'Failed to notify player about NFT reward');
    }
  }

  // ── Admin Queries ────────────────────────────────────────────────────────

  /**
   * Get pending NFT notifications (for admin panel / API).
   */
  async getPendingNotifications() {
    const res = await query(
      `SELECT n.*, u.username, u.first_name, u.last_name
       FROM nft_notifications n
       JOIN users u ON n.user_id = u.id
       WHERE n.admin_processed = false
       ORDER BY n.created_at DESC`,
      []
    );
    return res.rows;
  }

  async getAllNotifications({ limit = 50, offset = 0 } = {}) {
    const res = await query(
      `SELECT n.*, u.username, u.first_name
       FROM nft_notifications n
       JOIN users u ON n.user_id = u.id
       ORDER BY n.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    return res.rows;
  }
}

module.exports = NftNotificationService;
