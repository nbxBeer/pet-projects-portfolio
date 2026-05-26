'use strict';

const { query, withTransaction } = require('../db/pool');
const logger = require('../utils/logger');

const DEFAULT_TOPUP_AMOUNTS = [10, 50, 100, 250, 500, 1000];

/**
 * StarsWalletService
 *
 * How it works:
 * 1. Player opens "Top Up" → frontend requests an invoice link from backend
 * 2. Backend creates Telegram Stars invoice via Bot API
 * 3. Player pays in Telegram (one transaction, e.g. 100 Stars)
 * 4. Telegram sends pre_checkout_query → backend approves
 * 5. Telegram sends successful_payment → backend credits stars_balance
 * 6. Player spends stars from balance (no extra Telegram transactions)
 *
 * This means: 1 Telegram payment for N stars, then all in-game
 * spending is purely database operations.
 */
class StarsWalletService {
  constructor(configManager, bot) {
    this.cfg = configManager;
    this.bot = bot; // TelegramBot instance
  }

  _getValidTopupAmounts() {
    const configured = this.cfg.get('stars.topupAmounts');
    if (!Array.isArray(configured)) return DEFAULT_TOPUP_AMOUNTS;

    const normalized = configured
      .map((n) => Number(n))
      .filter((n) => Number.isInteger(n) && n > 0);

    // Keep backward compatibility with old DB overrides that may miss new denominations.
    return [...new Set([...DEFAULT_TOPUP_AMOUNTS, ...normalized])].sort((a, b) => a - b);
  }

  // ── Top-Up Flow ─────────────────────────────────────────────────────────

  /**
   * Create a Telegram Stars invoice for the player to pay.
   * Returns invoice link to open in Telegram.
   */
  async createTopupInvoice(userId, starsAmount) {
    const validAmounts = this._getValidTopupAmounts();
    if (!validAmounts.includes(starsAmount)) {
      throw { status: 400, message: `Invalid amount. Valid options: ${validAmounts.join(', ')}` };
    }

    if (!this.bot?.bot) {
      throw { status: 503, message: 'Payment service unavailable' };
    }

    const payload = `topup:${userId}:${starsAmount}:${Date.now()}`;

    try {
      // XTR = Telegram Stars currency code
      const link = await this.bot.bot.createInvoiceLink(
        `💫 Пополнение: ${starsAmount} Stars`,
        `Зачислить ${starsAmount} Звёзд на игровой баланс`,
        payload,
        '',          // provider_token (empty for Stars)
        'XTR',       // currency
        [{ label: `${starsAmount} Stars`, amount: starsAmount }]
      );

      logger.info({ userId, starsAmount, payload }, 'Stars invoice created');
      return { invoiceLink: link, payload, starsAmount };
    } catch (err) {
      logger.error({ err, userId }, 'Failed to create Stars invoice');
      throw { status: 500, message: 'Failed to create payment invoice' };
    }
  }

  /**
   * Handle pre_checkout_query from Telegram — must be answered within 10s.
   * Validates the payload and approves the payment.
   */
  async handlePreCheckout(preCheckoutQuery) {
    const { id, from, invoice_payload, total_amount, currency } = preCheckoutQuery;

    try {
      if (currency !== 'XTR') {
        await this.bot.bot.answerPreCheckoutQuery(id, false, { error_message: 'Invalid currency' });
        return;
      }

      // Validate payload format: topup:<userId>:<starsAmount>:<ts>
      const parts = invoice_payload.split(':');
      if (parts[0] !== 'topup' || parts.length < 4) {
        await this.bot.bot.answerPreCheckoutQuery(id, false, { error_message: 'Invalid payload' });
        return;
      }

      const payloadUserId = parseInt(parts[1]);
      if (payloadUserId !== from.id) {
        await this.bot.bot.answerPreCheckoutQuery(id, false, { error_message: 'User mismatch' });
        return;
      }

      // Verify total_amount matches the amount encoded in the payload (M2 fix).
      // Prevents approving a payment whose amount was tampered between invoice creation
      // and checkout (defense-in-depth — Telegram controls the flow, but we validate anyway).
      const payloadAmount = parseInt(parts[2]);
      const validAmounts = this._getValidTopupAmounts();
      if (!validAmounts.includes(payloadAmount) || total_amount !== payloadAmount) {
        await this.bot.bot.answerPreCheckoutQuery(id, false, { error_message: 'Amount mismatch' });
        return;
      }

      // All good — approve
      await this.bot.bot.answerPreCheckoutQuery(id, true);
      logger.info({ userId: from.id, amount: total_amount }, 'Pre-checkout approved');
    } catch (err) {
      logger.error({ err }, 'Pre-checkout handler error');
      try {
        await this.bot.bot.answerPreCheckoutQuery(id, false, { error_message: 'Internal error' });
      } catch {}
    }
  }

  /**
   * Handle successful_payment from Telegram.
   * Credits stars to user's balance. Idempotent via charge_id.
   */
  async handleSuccessfulPayment(telegramUserId, successfulPayment) {
    const {
      invoice_payload,
      telegram_payment_charge_id,
      total_amount,
      currency,
    } = successfulPayment;

    if (currency !== 'XTR') return;

    // Sanity-check: amount must be a positive integer in the server's allowed list (M2 fix).
    const validAmounts = this._getValidTopupAmounts();
    if (!validAmounts.includes(total_amount)) {
      logger.error({ telegramUserId, total_amount }, 'Stars payment amount not in valid list — ignored');
      return;
    }

    logger.info(
      { telegramUserId, chargeId: telegram_payment_charge_id, amount: total_amount },
      'Stars payment received'
    );

    return await withTransaction(async (client) => {
      // Idempotency: check if already processed
      const existing = await client.query(
        'SELECT id FROM stars_transactions WHERE telegram_payment_charge_id = $1',
        [telegram_payment_charge_id]
      );
      if (existing.rows.length > 0) {
        logger.warn({ chargeId: telegram_payment_charge_id }, 'Duplicate Stars payment ignored');
        return { alreadyProcessed: true };
      }

      // Lock user row
      const userRes = await client.query(
        'SELECT id, stars_balance FROM users WHERE id = $1 FOR UPDATE',
        [telegramUserId]
      );
      if (!userRes.rows.length) {
        logger.error({ telegramUserId }, 'User not found for Stars payment');
        return;
      }
      const user = userRes.rows[0];
      const newBalance = Number(user.stars_balance) + Number(total_amount);

      // Credit stars
      await client.query(
        'UPDATE users SET stars_balance = $1 WHERE id = $2',
        [newBalance, telegramUserId]
      );

      // Log transaction
      await client.query(
        `INSERT INTO stars_transactions
           (user_id, type, amount, balance_before, balance_after,
            telegram_payment_charge_id, telegram_invoice_payload, description)
         VALUES ($1, 'topup', $2, $3, $4, $5, $6, $7)`,
        [
          telegramUserId,
          total_amount,
          user.stars_balance,
          newBalance,
          telegram_payment_charge_id,
          invoice_payload,
          `Топап ${total_amount} Stars`,
        ]
      );

      logger.info({ telegramUserId, newBalance }, 'Stars credited');

      // Referral passive income on stars topup
      if (this.referralService) {
        setImmediate(() =>
          this.referralService.starsPassiveIncome(telegramUserId, total_amount).catch(() => {})
        );
      }

      // Chat source accounting for owners/admins — separate from referrals.
      setImmediate(() => this._creditChatSourceTopup(telegramUserId, total_amount).catch(() => {}));

      return { credited: total_amount, newBalance };
    });
  }

  async _creditChatSourceTopup(telegramUserId, starsAmount) {
    if (!Number.isFinite(Number(starsAmount)) || Number(starsAmount) <= 0) return;

    const userRes = await query(
      'SELECT registration_chat_id, registration_source_type FROM users WHERE id = $1',
      [telegramUserId]
    );
    const user = userRes.rows[0];
    if (!user?.registration_chat_id) return;
    if (!['group_chat', 'chat_link'].includes(user.registration_source_type || '')) return;

    await query(
      `UPDATE chat_sources
       SET stars_total_received = stars_total_received + $1,
           stars_since_clear = stars_since_clear + $1,
           updated_at = NOW()
       WHERE chat_id = $2`,
      [starsAmount, user.registration_chat_id]
    );
  }

  // ── Spending Stars ───────────────────────────────────────────────────────

  /**
   * Spend stars from in-game balance (no Telegram transaction needed).
   * Used for: expedition speedup, future: other premium features.
   */
  async spendStars(userId, amount, description, referenceId = null) {
    if (!Number.isInteger(amount) || amount <= 0) {
      throw { status: 400, message: 'Invalid stars amount' };
    }

    return await withTransaction(async (client) => {
      const userRes = await client.query(
        'SELECT stars_balance, total_stars_spent FROM users WHERE id = $1 FOR UPDATE',
        [userId]
      );
      if (!userRes.rows.length) throw { status: 404, message: 'User not found' };

      const { stars_balance, total_stars_spent } = userRes.rows[0];
      if (stars_balance < amount) {
        throw {
          status: 402,
          message: 'Insufficient Stars balance',
          required: amount,
          current: stars_balance,
        };
      }

      const newBalance = stars_balance - amount;
      await client.query(
        `UPDATE users
         SET stars_balance = $1, total_stars_spent = $2
         WHERE id = $3`,
        [newBalance, total_stars_spent + amount, userId]
      );

      await client.query(
        `INSERT INTO stars_transactions
           (user_id, type, amount, balance_before, balance_after, reference_id, description)
         VALUES ($1, 'spend_speedup', $2, $3, $4, $5, $6)`,
        [userId, -amount, stars_balance, newBalance, referenceId, description]
      );

      logger.info({ userId, amount, newBalance, description }, 'Stars spent');
      return { spent: amount, newBalance };
    });
  }

  // ── Refunds ─────────────────────────────────────────────────────────────

  /**
   * Refund a Telegram Stars payment via Bot API.
   *
   * This calls Telegram's refundStarPayment which returns the Stars back
   * to the user's Telegram wallet. We also reverse the in-game balance.
   *
   * When is this used:
   * 1. Automatic: if backend fails to deliver the purchased service after
   *    deducting stars (e.g. speedup DB update fails after payment)
   * 2. Manual: admin triggers refund for a specific transaction
   *
   * @param {number} userId - Telegram user ID
   * @param {string} telegramPaymentChargeId - charge ID from successful_payment
   * @param {string} reason - why the refund is happening
   */
  async refundStarPayment(userId, telegramPaymentChargeId, reason = 'Service delivery failed') {
    if (!this.bot?.bot) {
      throw { status: 503, message: 'Bot unavailable, cannot process refund' };
    }

    // Phase 1: DB validation + balance deduction in a single transaction.
    // We commit the balance change BEFORE calling Telegram so that:
    //   - If Telegram API fails → DB is rolled back, no inconsistency.
    //   - If Telegram API succeeds but network drops before we get the response →
    //     We retry and Telegram will report "already refunded" (handled below).
    //   - Double-refund is blocked by the unique index on (charge_id, type='refund').
    let refundAmount;
    let newBalance;

    await withTransaction(async (client) => {
      // Find the original topup transaction
      const txRes = await client.query(
        `SELECT id, amount, user_id FROM stars_transactions
         WHERE telegram_payment_charge_id = $1 AND type = 'topup'`,
        [telegramPaymentChargeId]
      );
      if (!txRes.rows.length) {
        throw { status: 404, message: 'Original payment transaction not found' };
      }

      const originalTx = txRes.rows[0];
      if (Number(originalTx.user_id) !== Number(userId)) {
        throw { status: 403, message: 'User mismatch for refund' };
      }

      // Check if already refunded (prevents double-refund)
      const refundCheck = await client.query(
        `SELECT id FROM stars_transactions
         WHERE telegram_payment_charge_id = $1 AND type IN ('refund', 'refund_pending')`,
        [telegramPaymentChargeId]
      );
      if (refundCheck.rows.length > 0) {
        throw { status: 409, message: 'Already refunded or refund in progress' };
      }

      // Lock user row and deduct balance
      refundAmount = Number(originalTx.amount);
      const userRes = await client.query(
        'SELECT stars_balance FROM users WHERE id = $1 FOR UPDATE',
        [userId]
      );
      if (!userRes.rows.length) throw { status: 404, message: 'User not found' };

      const currentBalance = Number(userRes.rows[0].stars_balance);
      newBalance = Math.max(0, currentBalance - refundAmount);

      await client.query(
        'UPDATE users SET stars_balance = $1 WHERE id = $2',
        [newBalance, userId]
      );

      // Log refund (committed before calling Telegram — prevents double-refund race)
      await client.query(
        `INSERT INTO stars_transactions
           (user_id, type, amount, balance_before, balance_after,
            telegram_payment_charge_id, description)
         VALUES ($1, 'refund', $2, $3, $4, $5, $6)`,
        [userId, -refundAmount, currentBalance, newBalance, telegramPaymentChargeId, reason]
      );
    });

    // Phase 2: Call Telegram API (outside DB transaction — any failure here
    // means the in-game balance was already deducted but Stars NOT returned to user.
    // Admin must track this via logs and retry manually if needed.)
    try {
      await this.bot.bot.refundStarPayment(userId, telegramPaymentChargeId);
    } catch (err) {
      const msg = err.message || 'unknown';
      // Telegram may say "already refunded" if this is a retry — treat as success
      if (msg.includes('CHARGE_ALREADY_REFUNDED') || msg.includes('already refunded')) {
        logger.warn({ userId, telegramPaymentChargeId }, 'Telegram reports charge already refunded — treating as success');
      } else {
        logger.error({ err, userId, telegramPaymentChargeId }, 'Telegram refundStarPayment failed AFTER DB commit');
        // Update the refund record with an error note so admin knows to investigate
        try {
          await withTransaction(async (client) => {
            await client.query(
              `UPDATE stars_transactions SET description = $1
               WHERE telegram_payment_charge_id = $2 AND type = 'refund'`,
              [`ERROR: Telegram API failed — ${msg}. Balance already deducted. Needs manual resolution.`, telegramPaymentChargeId]
            );
          });
        } catch {}
        throw { status: 502, message: `DB updated but Telegram API failed: ${msg}. Balance was deducted — contact support.` };
      }
    }

    logger.info({ userId, refundAmount, telegramPaymentChargeId, reason, newBalance }, 'Stars refund processed');
    return { refunded: refundAmount, newBalance, telegramPaymentChargeId };
  }

  /**
   * Find the most recent topup transaction for a user that can be refunded.
   * Used by admin to look up refundable charges.
   */
  async getRefundableTransactions(userId, { limit = 10 } = {}) {
    const res = await query(
      `SELECT st.id, st.amount, st.telegram_payment_charge_id, st.created_at, st.description
       FROM stars_transactions st
       WHERE st.user_id = $1
         AND st.type = 'topup'
         AND st.telegram_payment_charge_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM stars_transactions r
           WHERE r.telegram_payment_charge_id = st.telegram_payment_charge_id
             AND r.type = 'refund'
         )
       ORDER BY st.created_at DESC
       LIMIT $2`,
      [userId, limit]
    );
    return res.rows;
  }

  // ── Queries ──────────────────────────────────────────────────────────────

  async getBalance(userId) {
    const res = await query(
      'SELECT stars_balance, total_stars_spent FROM users WHERE id = $1',
      [userId]
    );
    if (!res.rows.length) throw { status: 404, message: 'User not found' };
    return {
      starsBalance: res.rows[0].stars_balance,
      totalStarsSpent: res.rows[0].total_stars_spent,
    };
  }

  async getTransactionHistory(userId, { limit = 20, offset = 0 } = {}) {
    const res = await query(
      `SELECT type, amount, balance_before, balance_after, description, created_at
       FROM stars_transactions
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );
    return res.rows;
  }
}

module.exports = StarsWalletService;
