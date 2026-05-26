'use strict';

const { query } = require('../db/pool');
const logger = require('./logger');

/**
 * Records a suspicious security event to the DB and structured log.
 * Fails silently so it never blocks the main request path.
 */
async function logSecurityEvent(userId, eventType, metadata = {}) {
  logger.warn({ userId, eventType, metadata }, '[IDS] Suspicious activity detected');
  try {
    await query(
      `INSERT INTO security_events (user_id, event_type, metadata) VALUES ($1, $2, $3)`,
      [userId, eventType, JSON.stringify(metadata)]
    );
  } catch (err) {
    logger.error({ err, userId, eventType }, '[IDS] Failed to persist security event');
  }
}

module.exports = { logSecurityEvent };
