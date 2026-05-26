'use strict';

require('dotenv').config();

const buildApp = require('./app');
const logger = require('./utils/logger');
const bot = require('./bot/telegramBot');
const { getPool } = require('./db/pool');

const PORT = parseInt(process.env.PORT || '3000');
const HOST = process.env.HOST || '0.0.0.0';

// Global safety net — log unhandled rejections instead of crashing
process.on('unhandledRejection', (err) => {
  logger.error({ err }, 'Unhandled promise rejection');
});

async function start() {
  try {
    const app = await buildApp();

    await app.listen({ port: PORT, host: HOST });
    logger.info(`🚀 Space Game backend running on ${HOST}:${PORT}`);

    // Initialize bot (async — fetches bot username via getMe())
    await bot.init();
    if (process.env.BOT_POLLING !== 'true' && process.env.WEBHOOK_BASE_URL) {
      await bot.setWebhook(process.env.WEBHOOK_BASE_URL);
    }

    // Graceful shutdown
    const shutdown = async (signal) => {
      logger.info({ signal }, 'Shutting down...');
      await app.close();
      await getPool().end();
      process.exit(0);
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

  } catch (err) {
    logger.error({ err }, 'Failed to start server');
    process.exit(1);
  }
}

start();
