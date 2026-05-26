'use strict';

const defaultConfig = require('./gameConfig');
const logger = require('../utils/logger');

/**
 * ConfigManager — merges default game config with database overrides.
 * Supports hot-reload without server restart.
 */
class ConfigManager {
  constructor(db) {
    this.db = db;
    this.config = { ...defaultConfig };
    this.lastLoaded = null;
    this.reloadInterval = null;
  }

  async load() {
    try {
      const { rows } = await this.db.query(
        'SELECT key, value FROM game_config WHERE is_active = true'
      );

      const overrides = {};
      for (const row of rows) {
        // Support nested keys: "rarity.common.weight" => { rarity: { common: { weight: val } } }
        this._setNestedKey(overrides, row.key, JSON.parse(row.value));
      }

      this.config = this._deepMerge({ ...defaultConfig }, overrides);
      this.lastLoaded = new Date();
      logger.info(`GameConfig loaded: ${rows.length} overrides from DB`);
    } catch (err) {
      logger.warn({ err }, 'Failed to load config overrides from DB, using defaults');
    }
    return this.config;
  }

  // Start hot-reload every N ms (default 60s)
  startAutoReload(intervalMs = 60000) {
    this.reloadInterval = setInterval(() => this.load(), intervalMs);
    logger.info(`Config auto-reload enabled every ${intervalMs / 1000}s`);
  }

  stopAutoReload() {
    if (this.reloadInterval) clearInterval(this.reloadInterval);
  }

  get(path) {
    if (!path) return this.config;
    return path.split('.').reduce((obj, key) => obj?.[key], this.config);
  }

  /** Persist a config override to DB and reload */
  async set(dotPath, value) {
    await this.db.query(
      `INSERT INTO game_config (key, value, is_active)
       VALUES ($1, $2, true)
       ON CONFLICT (key) DO UPDATE SET value = $2, is_active = true, updated_at = NOW()`,
      [dotPath, JSON.stringify(value)]
    );
    await this.load();
  }

  /** Delete a config override (revert to default) */
  async unset(dotPath) {
    await this.db.query('DELETE FROM game_config WHERE key = $1', [dotPath]);
    await this.load();
  }

  // Utility: deeply merge b into a (non-destructive to a)
  _deepMerge(a, b) {
    const result = { ...a };
    for (const key of Object.keys(b)) {
      if (b[key] && typeof b[key] === 'object' && !Array.isArray(b[key])) {
        result[key] = this._deepMerge(a[key] || {}, b[key]);
      } else {
        result[key] = b[key];
      }
    }
    return result;
  }

  _setNestedKey(obj, dotPath, value) {
    const parts = dotPath.split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!cur[parts[i]]) cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
  }
}

module.exports = ConfigManager;
