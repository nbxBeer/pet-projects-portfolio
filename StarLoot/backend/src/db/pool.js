'use strict';

const { Pool } = require('pg');
const logger = require('../utils/logger');

let pool;

function getPool() {
  if (pool) return pool;

  pool = new Pool({
    host:     process.env.DB_HOST     || 'localhost',
    port:     parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME     || 'space_game',
    user:     process.env.DB_USER     || 'postgres',
    password: process.env.DB_PASSWORD || '',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  });

  pool.on('error', (err) => {
    logger.error({ err }, 'Unexpected DB pool error');
  });

  pool.on('connect', () => {
    logger.debug('New DB connection established');
  });

  return pool;
}

/**
 * Execute a query with parameters.
 * @param {string} text - SQL query
 * @param {Array} params - Query parameters
 */
async function query(text, params) {
  const start = Date.now();
  try {
    const res = await getPool().query(text, params);
    const duration = Date.now() - start;
    if (duration > 1000) {
      logger.warn({ text, duration }, 'Slow query detected');
    }
    return res;
  } catch (err) {
    logger.error({ err, text, params }, 'DB query error');
    throw err;
  }
}

/**
 * Get a dedicated client for transactions.
 */
async function getClient() {
  const client = await getPool().connect();
  const originalRelease = client.release.bind(client);
  // Warn if client is not released within 5s
  const timeout = setTimeout(() => {
    logger.warn('A DB client has been out for more than 5 seconds');
  }, 5000);
  client.release = () => {
    clearTimeout(timeout);
    originalRelease();
  };
  return client;
}

/**
 * Execute a callback inside a transaction.
 */
async function withTransaction(callback) {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { query, getClient, withTransaction, getPool };
