'use strict';

const { query, withTransaction } = require('../db/pool');

// ── Catalog ───────────────────────────────────────────────────────────────────

const NAME_DECORS = [
  { id: 'star_prefix',   label: '⭐ Пилот',      preview: (n) => `⭐ ${n}`,   costStars: 10 },
  { id: 'skull_prefix',  label: '💀 Пират',      preview: (n) => `💀 ${n}`,   costStars: 10 },
  { id: 'fire_prefix',   label: '🔥 Огненный',   preview: (n) => `🔥 ${n}`,   costStars: 10 },
  { id: 'crown_prefix',  label: '👑 Капитан',    preview: (n) => `👑 ${n}`,   costStars: 10 },
  { id: 'rocket_prefix', label: '🚀 Астронавт',  preview: (n) => `🚀 ${n}`,   costStars: 10 },
  { id: 'alien_prefix',  label: '👾 Пришелец',   preview: (n) => `👾 ${n}`,   costStars: 10 },
  { id: 'fx_brackets',   label: '[ Командир ]',  preview: (n) => `[${n}]`,    costStars: 10 },
  { id: 'fx_slashes',    label: '// Хакер //',   preview: (n) => `//${n}//`,  costStars: 10 },
  { id: 'fx_admiral',    label: '« Адмирал »',   preview: (n) => `«${n}»`,    costStars: 10 },
  { id: 'fx_elite',      label: '★ Элита ★',     preview: (n) => `★${n}★`,   costStars: 10 },
  { id: 'fx_legend',     label: '「Легенда」',    preview: (n) => `「${n}」`,  costStars: 10 },
  { id: 'fx_code',       label: '<< Призрак >>',  preview: (n) => `<<${n}>>`,  costStars: 10 },
  { id: 'fx_quantum',    label: '✶ Квантовый след ✶', preview: (n) => `✶${n}✶`, costStars: 0, costCrystals: 10000 },
  // Ship-owner exclusive (free, auto-granted)
  { id: 'fx_captain',    label: '⚓ Капитан ⚓',  preview: (n) => `⚓${n}⚓`,  costStars: 0 },
];

const HEADER_COLORS = [
  { id: 'blue',    label: 'Синий',       bg: 'linear-gradient(135deg,#0f0f2a,#1a1a4e)',   accent: '#4f8ef7' },
  { id: 'purple',  label: 'Фиолетовый', bg: 'linear-gradient(135deg,#1a0a2e,#2d1458)',   accent: '#9c27b0' },
  { id: 'teal',    label: 'Бирюзовый',  bg: 'linear-gradient(135deg,#091a1a,#0d3333)',   accent: '#06b6d4' },
  { id: 'green',   label: 'Зелёный',    bg: 'linear-gradient(135deg,#0a1a0d,#0d3318)',   accent: '#22c55e' },
  { id: 'red',     label: 'Красный',    bg: 'linear-gradient(135deg,#1a0a0a,#3d0f0f)',   accent: '#ef4444' },
  { id: 'orange',  label: 'Оранжевый',  bg: 'linear-gradient(135deg,#1a100a,#3d200a)',   accent: '#f59e0b' },
  { id: 'pink',    label: 'Розовый',    bg: 'linear-gradient(135deg,#1a0a14,#3d0f28)',   accent: '#ec4899' },
  { id: 'dark',    label: 'Тёмный',     bg: 'linear-gradient(135deg,#080810,#111120)',   accent: '#718096' },
];

const AVATARS = [
  { id: 'astronaut', icon: '🧑‍🚀', label: 'Астронавт',  free: true },
  { id: 'alien',     icon: '👾',    label: 'Пришелец',   free: true },
  { id: 'robot',     icon: '🤖',    label: 'Робот',      free: true },
  { id: 'pilot',     icon: '✈️',    label: 'Пилот',      free: true },
  { id: 'wizard',    icon: '🧙',    label: 'Маг',        free: true },
  { id: 'ninja',     icon: '🥷',    label: 'Ниндзя',     free: true },
  { id: 'skull',     icon: '💀',    label: 'Пират',      free: true },
  { id: 'ghost',     icon: '👻',    label: 'Призрак',    free: true },
];

class CustomizationService {
  get catalog() {
    return { nameDecors: NAME_DECORS, headerColors: HEADER_COLORS, avatars: AVATARS };
  }

  async getUserCustomization(userId) {
    const [userRes, ownedRes] = await Promise.all([
      query('SELECT header_color, avatar_id, active_decor_id, is_supporter, zone_glow FROM users WHERE id = $1', [userId]),
      query('SELECT decor_id FROM user_name_decorations WHERE user_id = $1', [userId]),
    ]);

    const user = userRes.rows[0] || {};
    return {
      headerColor:   user.header_color   || 'blue',
      avatarId:      user.avatar_id      || 'astronaut',
      activeDecorId: user.active_decor_id || null,
      ownedDecors:   ownedRes.rows.map((r) => r.decor_id),
      isSupporter:   !!user.is_supporter,
      zoneGlow:      user.zone_glow || null,
    };
  }

  async setHeaderColor(userId, color) {
    if (!HEADER_COLORS.find((c) => c.id === color)) {
      { const _e = new Error('Unknown color'); _e.status = 400; throw _e; };
    }
    await query('UPDATE users SET header_color = $1 WHERE id = $2', [color, userId]);
    return { ok: true, headerColor: color };
  }

  async setAvatar(userId, avatarId) {
    if (!AVATARS.find((a) => a.id === avatarId)) {
      { const _e = new Error('Unknown avatar'); _e.status = 400; throw _e; };
    }
    await query('UPDATE users SET avatar_id = $1 WHERE id = $2', [avatarId, userId]);
    return { ok: true, avatarId };
  }

  async purchaseDecor(userId, decorId) {
    const decor = NAME_DECORS.find((d) => d.id === decorId);
    if (!decor) { const _e = new Error('Unknown decoration'); _e.status = 400; throw _e; };

    // Captain decoration is ship-exclusive
    if (decorId === 'fx_captain') {
      const shipCheck = await query(
        `SELECT 1 FROM inventory_items WHERE user_id = $1 AND find_type = 'nft_container'
         AND status IN ('in_inventory','saved_coords') AND object_data->>'outcomeType' = 'unique_ship' LIMIT 1`,
        [userId]
      );
      if (!shipCheck.rows.length) {
        const _e = new Error('Эксклюзивное украшение для владельцев корабля');
        _e.status = 403; throw _e;
      }
    }

    return await withTransaction(async (client) => {
      // Check already owned
      const owned = await client.query(
        'SELECT id FROM user_name_decorations WHERE user_id = $1 AND decor_id = $2',
        [userId, decorId]
      );
      if (owned.rows.length) { const _e = new Error('Уже куплено'); _e.status = 409; throw _e; };

      // Deduct stars
      const userRes = await client.query(
        'SELECT stars_balance, crystals, current_universe FROM users WHERE id = $1 FOR UPDATE', [userId]
      );
      const balance = Number(userRes.rows[0]?.stars_balance || 0);
      const crystals = Number(userRes.rows[0]?.crystals || 0);
      const currentUniverse = Number(userRes.rows[0]?.current_universe || 1);

      if (Number(decor.costCrystals || 0) > 0) {
        const visitedU2Res = await client.query(
          `SELECT 1 FROM user_story_items WHERE user_id = $1 AND item_key = 'visited_universe2' LIMIT 1`,
          [userId]
        );
        const hasVisitedUniverse2 = currentUniverse === 2 || visitedU2Res.rows.length > 0;
        if (!hasVisitedUniverse2) {
          const _e = new Error('Декор доступен после первого посещения Вселенной II');
          _e.status = 403;
          throw _e;
        }
        if (crystals < decor.costCrystals) {
          const _e = new Error(`Недостаточно кристаллов. Нужно: ${decor.costCrystals}`);
          _e.status = 402;
          _e.required = decor.costCrystals;
          _e.current = crystals;
          throw _e;
        }
      } else if (balance < decor.costStars) {
        { const _e = new Error(`Недостаточно звёзд. Нужно: ${decor.costStars}`); _e.status = 402; _e.required = decor.costStars; _e.current = balance; throw _e; }
      }

      if (Number(decor.costCrystals || 0) > 0) {
        await client.query(
          'UPDATE users SET crystals = crystals - $1 WHERE id = $2',
          [decor.costCrystals, userId]
        );
        await client.query(
          `INSERT INTO crystal_transactions(user_id, type, amount, balance_before, balance_after, description)
           VALUES($1,$2,$3,$4,$5,$6)`,
          [userId, 'spend_other', -decor.costCrystals, crystals, crystals - decor.costCrystals, `Декор ника: ${decor.label}`]
        );
      } else if (decor.costStars > 0) {
        await client.query(
          'UPDATE users SET stars_balance = stars_balance - $1, total_stars_spent = total_stars_spent + $1 WHERE id = $2',
          [decor.costStars, userId]
        );
        await client.query(
          'INSERT INTO stars_transactions(user_id, amount, balance_before, balance_after, type, description) VALUES($1,$2,$3,$4,$5,$6)',
          [userId, -decor.costStars, balance, balance - decor.costStars, 'spend_other', `Декор ника: ${decor.label}`]
        );
      }
      await client.query(
        'INSERT INTO user_name_decorations(user_id, decor_id) VALUES($1,$2)',
        [userId, decorId]
      );

      return {
        ok: true,
        decorId,
        currency: Number(decor.costCrystals || 0) > 0 ? 'crystals' : 'stars',
        newBalance: balance - Number(decor.costStars || 0),
        newCrystalsBalance: crystals - Number(decor.costCrystals || 0),
      };
    });
  }

  async setDecor(userId, decorId) {
    // null = clear
    if (decorId !== null) {
      const owned = await query(
        'SELECT id FROM user_name_decorations WHERE user_id = $1 AND decor_id = $2',
        [userId, decorId]
      );
      if (!owned.rows.length) { const _e = new Error('Сначала купи это украшение'); _e.status = 403; throw _e; };
    }
    await query('UPDATE users SET active_decor_id = $1 WHERE id = $2', [decorId, userId]);
    return { ok: true, activeDecorId: decorId };
  }

  async setZoneGlow(userId, glow) {
    const VALID = [null, 'supporter', 'captain'];
    if (!VALID.includes(glow)) {
      const _e = new Error('Invalid zone glow'); _e.status = 400; throw _e;
    }
    await query('UPDATE users SET zone_glow = $1 WHERE id = $2', [glow, userId]);
    return { ok: true, zoneGlow: glow };
  }

  async purchaseSupport(userId) {
    const SUPPORT_COST = 500;
    return await withTransaction(async (client) => {
      // Check already purchased
      const owned = await client.query(
        "SELECT id FROM user_name_decorations WHERE user_id = $1 AND decor_id = 'supporter'",
        [userId]
      );
      if (owned.rows.length) { const _e = new Error('Уже приобретено'); _e.status = 409; throw _e; };

      const userRes = await client.query(
        'SELECT stars_balance FROM users WHERE id = $1 FOR UPDATE', [userId]
      );
      const balance = Number(userRes.rows[0]?.stars_balance || 0);
      if (balance < SUPPORT_COST) {
        { const _e = new Error(`Недостаточно звёзд. Нужно: ${SUPPORT_COST}`); _e.status = 402; _e.required = SUPPORT_COST; _e.current = balance; throw _e; }
      }

      await client.query(
        `UPDATE users SET stars_balance = stars_balance - $1, total_stars_spent = total_stars_spent + $1,
         is_supporter = true, zone_glow = COALESCE(zone_glow, 'supporter') WHERE id = $2`,
        [SUPPORT_COST, userId]
      );
      await client.query(
        "INSERT INTO user_name_decorations(user_id, decor_id) VALUES($1, 'supporter')",
        [userId]
      );
      await client.query(
        'INSERT INTO stars_transactions(user_id, amount, balance_before, balance_after, type, description) VALUES($1,$2,$3,$4,$5,$6)',
        [userId, -SUPPORT_COST, balance, balance - SUPPORT_COST, 'spend_other', 'Поддержка проекта']
      );

      return { ok: true, newBalance: balance - SUPPORT_COST };
    });
  }

  // Helper: apply decor to a display name (used in leaderboard + profile)
  static applyDecor(name, decorId) {
    if (!decorId) return name;
    const decor = NAME_DECORS.find((d) => d.id === decorId);
    if (!decor) return name;
    return decor.preview(name);
  }
}

module.exports = { CustomizationService, NAME_DECORS, HEADER_COLORS, AVATARS };
