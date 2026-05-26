'use strict';

const userRoutes = require('./userRoutes');
const expeditionRoutes = require('./expeditionRoutes');
const upgradeRoutes = require('./upgradeRoutes');
const adminRoutes = require('./adminRoutes');
const blitzRoutes = require('./blitzRoutes');
const logger = require('../utils/logger');

// ─── Telegram-authed routes (registered inside an encapsulated context) ─────

async function routes(fastify, services) {
  await userRoutes(fastify, services);
  await expeditionRoutes(fastify, services);
  await upgradeRoutes(fastify, services);
  await blitzRoutes(fastify, services);
  // Note: tournamentRoutes are registered separately in app.js alongside this
}

// ─── Global error handler ───────────────────────────────────────────────────

// Intentional extra fields that business-error objects may include.
// Whitelisting prevents accidentally leaking internal state via ...error spread (H3 fix).
const SAFE_ERROR_KEYS = [
  'cooldownUntil', 'required', 'current', 'expedition',
  'action', 'remainingSeconds', 'retryAfter',
];

function registerErrorHandler(fastify) {
  fastify.setErrorHandler((error, req, reply) => {
    // Custom business errors
    if (error.status && error.message) {
      if (error.status >= 500) {
        logger.error({
          err: error,
          path: req?.url,
          method: req?.method,
          userId: req?.user?.id,
        }, 'Business error 500+');
      }
      const body = { error: error.message };
      for (const key of SAFE_ERROR_KEYS) {
        if (error[key] !== undefined) body[key] = error[key];
      }
      return reply.code(error.status).send(body);
    }
    // Fastify validation errors
    if (error.validation) {
      return reply.code(400).send({ error: 'Validation failed', details: error.validation });
    }
    logger.error({
      err: error,
      path: req?.url,
      method: req?.method,
      userId: req?.user?.id,
    }, 'Unhandled route error');
    return reply.code(500).send({ error: 'Internal server error' });
  });
}

module.exports = { routes, adminRoutes, registerErrorHandler };
