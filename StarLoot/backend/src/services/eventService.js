'use strict';

const { query } = require('../db/pool');
const logger = require('../utils/logger');

/**
 * Effect types supported by global events:
 *
 * { type: 'xp_bonus',       multiplier: 1.5,  zones: null }          — +50% XP (all zones)
 * { type: 'credits_bonus',  multiplier: 1.3,  zones: ['asteroid_field'] } — +30% credits in zone
 * { type: 'spawn_rate',     findType: 'creature', multiplier: 2.0, zones: null } — 2× creature chance
 * { type: 'rarity_bonus',   rarity: 'rare',   multiplier: 1.5, zones: null }  — 1.5× specific rarity weight
 * { type: 'rarity_bonus',   rarity: null,     multiplier: 1.3, zones: null }  — 1.3× all non-common (rare+)
 * { type: 'common_reduction', reduction: 0.3, zones: null }          — reduce common weight by 30%, spread to rarer
 *
 * zones: null → applies to all zones; array of zone IDs → applies to specific zones only.
 *
 * Multiple effects can be stacked in one event.
 *
 * Admin API usage (via X-Admin-Secret header):
 *
 * POST /api/admin/events
 * {
 *   "title": "Нашествие тварей",
 *   "description": "На окраинах участились появления существ",
 *   "icon": "🐾",
 *   "durationHours": 24,
 *   "effects": [
 *     { "type": "spawn_rate", "findType": "creature", "multiplier": 2.5, "zones": ["galaxy_outskirts"] },
 *     { "type": "spawn_rate", "findType": "asteroid", "multiplier": 0.3, "zones": ["galaxy_outskirts"] },
 *     { "type": "xp_bonus",   "multiplier": 1.2,                         "zones": null }
 *   ]
 * }
 *
 * POST /api/admin/events/:id/end   — end event early
 * GET  /api/admin/events           — list all events
 */
class EventService {
  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Returns the current active event (ends_at > NOW(), is_active = true), or null.
   */
  async getActiveEvent() {
    const res = await query(
      `SELECT id, title, description, icon, effects, starts_at, ends_at
       FROM global_events
       WHERE is_active = true AND ends_at > NOW()
       ORDER BY starts_at DESC
       LIMIT 1`
    );
    if (!res.rows.length) return null;
    return this._format(res.rows[0]);
  }

  /**
   * Get any event by ID, regardless of active status.
   * Used to restore event effects from expedition snapshot.
   */
  async getEventById(id) {
    const res = await query(
      `SELECT id, title, description, icon, effects, starts_at, ends_at
       FROM global_events WHERE id = $1`,
      [id]
    );
    if (!res.rows.length) return null;
    return this._format(res.rows[0]);
  }

  /**
   * Creates a new global event and ends any currently active ones.
   * @param {object} params
   * @param {string} params.title
   * @param {string} [params.description]
   * @param {string} [params.icon]
   * @param {number} params.durationHours
   * @param {Array}  params.effects  — array of effect objects (see module JSDoc)
   */
  async createEvent({ title, description = '', icon = '🎉', durationHours, effects = [] }) {
    try { this._validateEffects(effects); } catch (e) {
      if (!(e instanceof Error)) { const err = new Error(e.message || String(e)); err.status = e.status || 400; throw err; }
      throw e;
    }
    const endsAt = new Date(Date.now() + durationHours * 3600 * 1000);

    // End any currently running events
    await query(
      `UPDATE global_events SET is_active = false WHERE is_active = true AND ends_at > NOW()`
    );

    const res = await query(
      `INSERT INTO global_events (title, description, icon, effects, ends_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, title, description, icon, effects, starts_at, ends_at`,
      [title, description, icon, JSON.stringify(effects), endsAt]
    );
    const event = this._format(res.rows[0]);
    logger.info({ eventId: event.id, title, durationHours, effectCount: effects.length }, 'Global event created');
    return event;
  }

  /**
   * End an event early.
   */
  async endEvent(id) {
    const res = await query(
      `UPDATE global_events SET is_active = false WHERE id = $1 RETURNING id, title`,
      [id]
    );
    if (!res.rows.length) { const e = new Error('Event not found'); e.status = 404; throw e; }
    logger.info({ eventId: id }, 'Global event ended early');
    return res.rows[0];
  }

  /**
   * List all events (newest first, up to 50).
   */
  async listEvents() {
    const res = await query(
      `SELECT id, title, description, icon, effects, is_active, starts_at, ends_at, created_at
       FROM global_events
       ORDER BY created_at DESC LIMIT 50`
    );
    return res.rows.map((r) => {
      let effects = r.effects;
      // Defensive: if stored as string (e.g. old rows), parse it
      if (typeof effects === 'string') {
        try { effects = JSON.parse(effects); } catch { effects = []; }
      }
      if (!Array.isArray(effects)) effects = [];
      return { ...r, effects };
    });
  }

  // ── Effect helpers (used by FindGeneratorService) ──────────────────────────

  /**
   * Filter effects applicable to a given zone.
   * zones: null = all zones; array = specific zones.
   */
  static filterForZone(effects, zoneId) {
    return (effects || []).filter(
      (e) => e.zones == null || (Array.isArray(e.zones) && e.zones.includes(zoneId))
    );
  }

  /**
   * Get combined multiplier for a scalar effect type (xp_bonus / credits_bonus).
   * Multiple stacked effects are multiplied together.
   */
  static getMultiplier(effects, type, zoneId) {
    const applicable = EventService.filterForZone(effects, zoneId).filter((e) => e.type === type);
    return applicable.reduce((acc, e) => acc * (e.multiplier || 1.0), 1.0);
  }

  // ── Private ────────────────────────────────────────────────────────────────

  _format(row) {
    return {
      id: row.id,
      title: row.title,
      description: row.description || '',
      icon: row.icon || '🎉',
      effects: Array.isArray(row.effects) ? row.effects : (row.effects || []),
      startsAt: row.starts_at,
      endsAt: row.ends_at,
    };
  }

  _validateEffects(effects) {
    const VALID_TYPES = ['xp_bonus', 'credits_bonus', 'spawn_rate', 'rarity_bonus', 'common_reduction'];
    const VALID_FIND_TYPES = ['asteroid', 'debris', 'artifact', 'creature', 'anomaly'];
    const VALID_RARITIES = ['common', 'rare', 'epic', 'legendary', 'mythical', 'exotic', 'ancient', 'relic', 'hybrid', 'singularity'];

    for (const e of effects) {
      // Coerce string numbers (from HTML inputs / JSON form fields)
      if (e.multiplier !== undefined) e.multiplier = parseFloat(e.multiplier);
      if (e.reduction  !== undefined) e.reduction  = parseFloat(e.reduction);

      if (!VALID_TYPES.includes(e.type)) {
        { const _e = new Error(`Unknown effect type: ${e.type}. Valid: ${VALID_TYPES.join(', ')}`); _e.status = 400; throw _e; };
      }
      if (e.type === 'spawn_rate' && e.findType && !VALID_FIND_TYPES.includes(e.findType)) {
        { const _e = new Error(`Unknown findType: ${e.findType}`); _e.status = 400; throw _e; };
      }
      if (e.type === 'rarity_bonus' && e.rarity && !VALID_RARITIES.includes(e.rarity)) {
        { const _e = new Error(`Unknown rarity: ${e.rarity}`); _e.status = 400; throw _e; };
      }
      if (e.zones != null && !Array.isArray(e.zones)) {
        { const _e = new Error('zones must be null (all) or an array of zone IDs'); _e.status = 400; throw _e; };
      }
      if (['xp_bonus', 'credits_bonus', 'spawn_rate', 'rarity_bonus'].includes(e.type)) {
        if (isNaN(e.multiplier) || e.multiplier <= 0) {
          { const _e = new Error(`Effect ${e.type} requires a positive multiplier`); _e.status = 400; throw _e; };
        }
      }
      if (e.type === 'common_reduction') {
        if (isNaN(e.reduction) || e.reduction <= 0 || e.reduction >= 1) {
          { const _e = new Error('common_reduction requires reduction in (0, 1)'); _e.status = 400; throw _e; };
        }
      }
    }
  }
}

module.exports = EventService;
