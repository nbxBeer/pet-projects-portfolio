'use strict';

const { query } = require('../db/pool');

class NewsService {
  async getActiveNews() {
    const res = await query(
      `SELECT id, title_ru, title_en, description_ru, description_en, icon, is_visible
       FROM game_news
       WHERE is_visible = true
       ORDER BY updated_at DESC
       LIMIT 1`
    );
    const rows = res.rows;
    if (!rows.length) return null;
    return this._format(rows[0]);
  }

  async getNews() {
    const res = await query(
      `SELECT id, title_ru, title_en, description_ru, description_en, icon, is_visible, created_at, updated_at
       FROM game_news
       ORDER BY created_at DESC
       LIMIT 1`
    );
    const rows = res.rows;
    if (!rows.length) return null;
    return this._format(rows[0]);
  }

  async upsertNews({ titleRu, titleEn, descriptionRu, descriptionEn, icon }) {
    const existingRes = await query(`SELECT id FROM game_news LIMIT 1`);
    const existing = existingRes.rows;
    if (existing.length) {
      const rows = await query(
        `UPDATE game_news
         SET title_ru=$1, title_en=$2, description_ru=$3, description_en=$4, icon=$5, updated_at=NOW()
         WHERE id=$6
         RETURNING *`,
        [titleRu || '', titleEn || '', descriptionRu || '', descriptionEn || '', icon || '📰', existing[0].id]
      );
      return this._format(rows.rows[0]);
    } else {
      const rows = await query(
        `INSERT INTO game_news (title_ru, title_en, description_ru, description_en, icon, is_visible)
         VALUES ($1, $2, $3, $4, $5, false)
         RETURNING *`,
        [titleRu || '', titleEn || '', descriptionRu || '', descriptionEn || '', icon || '📰']
      );
      return this._format(rows.rows[0]);
    }
  }

  async setVisibility(visible) {
    const existingRes = await query(`SELECT id FROM game_news LIMIT 1`);
    const existing = existingRes.rows;
    if (!existing.length) return { ok: false, error: 'No news record exists' };
    await query(
      `UPDATE game_news SET is_visible=$1, updated_at=NOW()`,
      [Boolean(visible)]
    );
    return { ok: true };
  }

  _format(row) {
    if (!row) return null;
    return {
      id: row.id,
      titleRu: row.title_ru,
      titleEn: row.title_en,
      descriptionRu: row.description_ru,
      descriptionEn: row.description_en,
      icon: row.icon,
      isVisible: row.is_visible,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

module.exports = NewsService;
