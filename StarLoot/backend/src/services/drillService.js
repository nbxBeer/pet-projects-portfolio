'use strict';

const { query, withTransaction } = require('../db/pool');
const logger = require('../utils/logger');

// ── Drill level progression ────────────────────────────────────────────────
const MINING_CYCLE_SECONDS = 900;
const MAX_DRILL_SLOTS = 3;
const SLOT_UNLOCK_STARS = 50;
const MAX_UPGRADES_PER_DRILL = 5;
const COLLECTION_SUBMIT_COOLDOWN_HOURS = 24;
const STORAGE_UPGRADE_CREDITS = 200;
const FOSSIL_UPGRADE_STEP = 0.01;
const UPGRADE_COSTS = [1500, 3000, 5500, 9000, 14000, 20000, 27000, 35000, 44000, 54000, 65000, 77000];
const UPGRADE_TYPES = {
  yield: 'upgrade_yield_level',
  fossil: 'upgrade_fossil_level',
  value: 'upgrade_value_level',
  storage: 'upgrade_storage_level',
};
const MAX_UPGRADE_LEVEL_PER_TYPE = {
  yield: 3,
  fossil: 5,
  value: 3,
  storage: 5,
};
const PG_INT_MAX = 2147483647;

class DrillService {
  constructor(configManager) {
    this.cfg = configManager;
  }

  _getMiningCycleSeconds() {
    return MINING_CYCLE_SECONDS;
  }

  _getAsteroidResource(resourceType) {
    const resources = this.cfg.config.asteroidResources || {};
    for (const group of Object.values(resources)) {
      if (!Array.isArray(group)) continue;
      const found = group.find((resource) => resource.id === resourceType);
      if (found) return found;
    }
    return null;
  }

  _conditionFactor(condition) {
    const raw = Number(condition);
    const safeCondition = Number.isFinite(raw) ? raw : 100;
    const normalized = Math.max(0, Math.min(100, safeCondition));
    return (normalized / 100) * 0.8 + 0.2;
  }

  _getUpgradeLevels(drillRow) {
    const yieldLevel = Number(drillRow.upgrade_yield_level || 0);
    const fossilLevel = Number(drillRow.upgrade_fossil_level || 0);
    const valueLevel = Number(drillRow.upgrade_value_level || 0);
    const storageLevel = Number(drillRow.upgrade_storage_level || 0);
    const totalUsed = yieldLevel + fossilLevel + valueLevel + storageLevel;
    const nextCost = totalUsed < MAX_UPGRADES_PER_DRILL ? UPGRADE_COSTS[totalUsed] : null;
    return {
      yieldLevel,
      fossilLevel,
      valueLevel,
      storageLevel,
      totalUsed,
      maxTotal: MAX_UPGRADES_PER_DRILL,
      nextCost,
      canUpgrade: totalUsed < MAX_UPGRADES_PER_DRILL,
    };
  }

  _valuePerTonWithUpgrades(baseValuePerTon, valueLevel) {
    let value = Math.max(1, Math.round(Number(baseValuePerTon || 1)));
    for (let i = 0; i < Number(valueLevel || 0); i++) {
      const boosted = Math.round(value * 1.1);
      value = boosted > value ? boosted : value + 1;
    }
    return value;
  }

  _snapshotAsteroid(itemRow) {
    const objectData = itemRow.object_data || {};
    // Keep fractional tonnes for small asteroids (e.g., 0.16 т, 2.5 т, etc.)
    const totalVolume = Math.max(0, Number(objectData.estimatedVolume ?? 0));
    const remainingVolume = Math.max(0, Number(itemRow.asteroid_remaining_volume ?? totalVolume));
    const baseCredits = Math.max(0, Math.round(Number(itemRow.base_credits ?? objectData.realBaseCredits ?? 0)));
    const resourceType = objectData.resourceType || objectData.resource_type;
    const resource = this._getAsteroidResource(resourceType);
    const condition = Number(objectData.condition ?? 100);
    const fallbackValuePerTon = Math.max(1, Math.round(Number(itemRow.asteroid_value_per_ton ?? 1)));
    const resourceValuePerTon = resource
      ? Math.max(1, Math.round(resource.pricePerTon * this._conditionFactor(condition)))
      : fallbackValuePerTon;

    // Keep drilling value consistent with sell value: sell = base_credits * 0.2.
    const valuePerTon = (baseCredits > 0 && totalVolume > 0)
      ? Math.max(1, Math.round(baseCredits / totalVolume))
      : resourceValuePerTon;

    const resourceName = resource?.name || objectData.resourceName || resourceType || 'Unknown resource';

    return {
      itemId: itemRow.id,
      templateId: itemRow.template_id,
      rarity: itemRow.rarity,
      name: objectData.name || itemRow.name || 'Asteroid',
      nameEn: objectData.nameEn || itemRow.name_en || 'Asteroid',
      icon: objectData.icon || itemRow.icon || '☄️',
      resourceType,
      resourceName,
      totalVolume,
      remainingVolume,
      condition,
      valuePerTon,
      baseCredits,
      sellPrice: baseCredits > 0
        ? Math.round(baseCredits * 0.2)
        : Math.round(totalVolume * valuePerTon * 0.2),
    };
  }

  // ── Get drill stats with point-based upgrades ────────────────────────────
  _drillStats(drillType, drill) {
    const upgrades = this._getUpgradeLevels(drill);
    const baseYield = Math.max(0, Number(drillType.base_yield_per_cycle) || 0);
    const baseFossilChance = Math.max(0, Number(drillType.base_fossil_chance) || 0);
    const baseStorageCredits = Math.max(0, Math.round(Number(drillType.base_storage_limit) || 0));
    return {
      yieldPerCycle: Math.max(0, Math.round(baseYield + upgrades.yieldLevel)),
      cycleDurationSec: Math.max(1, Number(drillType.cycle_duration_seconds) || MINING_CYCLE_SECONDS),
      storageLimitCredits: Math.max(0, Math.round(baseStorageCredits + upgrades.storageLevel * STORAGE_UPGRADE_CREDITS)),
      fossilChance: Math.max(0, Math.min(1, baseFossilChance + upgrades.fossilLevel * FOSSIL_UPGRADE_STEP)),
      valueLevel: upgrades.valueLevel,
      upgrades,
    };
  }

  // ── Compute accumulated balance (virtual, not persisted until collect) ───
  _computeAccumulated(drill, drillType) {
    const stats = this._drillStats(drillType, drill);
    const baseValuePerTon = Math.max(1, Math.round(Number(drill.asteroid_value_per_ton || 0)));
    const effectiveValuePerTon = this._valuePerTonWithUpgrades(baseValuePerTon, stats.valueLevel);
    const now = Date.now();
    const lastCycle = new Date(drill.last_cycle_at).getTime();
    const elapsed = Math.max(0, now - lastCycle);
    const cycleMs = stats.cycleDurationSec * 1000;
    const cyclesElapsed = Math.floor(elapsed / cycleMs);
    const balanceCreditsBefore = Math.max(0, Math.round(Number(drill.balance || 0)));
    const remainingCapacityCredits = Math.max(0, stats.storageLimitCredits - balanceCreditsBefore);
    // IMPORTANT: Keep fractional tonnes for small asteroids (e.g., 0.16 т)
    const remainingAsteroidTons = Math.max(0, Number(drill.asteroid_remaining_volume ?? 0));
    const potentialTons = Math.max(0, cyclesElapsed * stats.yieldPerCycle);
    const isAtStorageLimit = balanceCreditsBefore >= stats.storageLimitCredits;
    const maxTonsByCapacity = remainingCapacityCredits <= 0
      ? 0
      : Math.max(0, remainingCapacityCredits / Math.max(1, effectiveValuePerTon));
    const accumulated = isAtStorageLimit
      ? 0
      : Math.min(potentialTons, remainingAsteroidTons, maxTonsByCapacity);
    const accumulatedCreditsRaw = accumulated * effectiveValuePerTon;
    const accumulatedCredits = Math.min(remainingCapacityCredits, accumulatedCreditsRaw);
    const currentBalance = Math.min(stats.storageLimitCredits, balanceCreditsBefore + accumulatedCredits);
    const isFull = currentBalance >= stats.storageLimitCredits;
    const cyclesUsed = accumulated > 0
      ? Math.min(cyclesElapsed, Math.max(1, Math.ceil(accumulated / Math.max(stats.yieldPerCycle, 1))))
      : 0;
    const haltedByLimit = cyclesElapsed > 0 && (isAtStorageLimit || currentBalance >= stats.storageLimitCredits || accumulated < potentialTons);
    return {
      accumulatedTons: accumulated,
      accumulatedCredits,
      currentBalanceCredits: currentBalance,
      cyclesElapsed,
      cyclesUsed,
      isFull,
      haltedByLimit,
      stats,
      effectiveValuePerTon,
    };
  }

  // ── Get all drills for a user ────────────────────────────────────────────
  async getDrills(userId) {
    const userRes = await query(
      'SELECT stars_balance, COALESCE(drill_slots_unlocked, 1) AS drill_slots_unlocked FROM users WHERE id = $1',
      [userId]
    );
    const userRow = userRes.rows[0] || { stars_balance: 0, drill_slots_unlocked: 1 };

    const drillRows = await query(
      `SELECT d.*, dt.name, dt.name_en, dt.base_yield_per_cycle, dt.cycle_duration_seconds,
              dt.base_storage_limit, dt.base_fossil_chance, dt.icon, dt.cost_credits, dt.cost_stars,
              ai.template_id AS asteroid_template_id,
              ai.rarity AS asteroid_rarity,
              ai.status AS asteroid_status,
          ai.object_data AS asteroid_object_data,
          er.base_credits AS asteroid_base_credits
       FROM user_drills d
       JOIN drill_types dt ON dt.id = d.drill_type_id
       LEFT JOIN inventory_items ai ON ai.id = d.assigned_asteroid_item_id
        LEFT JOIN expedition_results er ON er.id = ai.result_id
       WHERE d.user_id = $1
       ORDER BY d.slot_index ASC, d.created_at ASC`,
      [userId]
    );

    const drills = drillRows.rows.map((row) => {
      const drillType = {
        base_yield_per_cycle: row.base_yield_per_cycle,
        cycle_duration_seconds: row.cycle_duration_seconds,
        base_storage_limit: row.base_storage_limit,
        base_fossil_chance: row.base_fossil_chance,
      };
      const { currentBalanceCredits, isFull, stats } = this._computeAccumulated(row, drillType);
      const assignedAsteroid = row.assigned_asteroid_item_id
        ? (() => {
            const snapshot = this._snapshotAsteroid({
              id: row.assigned_asteroid_item_id,
              template_id: row.asteroid_template_id,
              rarity: row.asteroid_rarity,
              status: row.asteroid_status,
              object_data: row.asteroid_object_data,
              base_credits: row.asteroid_base_credits,
              asteroid_remaining_volume: row.asteroid_remaining_volume,
              asteroid_value_per_ton: row.asteroid_value_per_ton,
            });
            const effectiveValuePerTon = this._valuePerTonWithUpgrades(snapshot.valuePerTon, stats.valueLevel);
            return {
              id: snapshot.itemId,
              name: snapshot.name,
              nameEn: snapshot.nameEn,
              icon: snapshot.icon,
              resourceType: snapshot.resourceType,
              resourceName: snapshot.resourceName,
              totalVolume: snapshot.totalVolume,
              remainingVolume: Number(row.asteroid_remaining_volume ?? snapshot.remainingVolume),
              condition: snapshot.condition,
              baseValuePerTon: Number(row.asteroid_value_per_ton ?? snapshot.valuePerTon),
              valuePerTon: effectiveValuePerTon,
              canReassign: Number(row.asteroid_remaining_volume ?? snapshot.remainingVolume) <= 0,
            };
          })()
        : null;
      const balanceCredits = assignedAsteroid
        ? Math.round(currentBalanceCredits)
        : Math.round(currentBalanceCredits);
      const storageLimitCredits = Math.round(stats.storageLimitCredits);
      return {
        id: row.id,
        slotIndex: Number(row.slot_index || 1),
        drillTypeId: row.drill_type_id,
        name: row.name,
        nameEn: row.name_en,
        icon: row.icon,
        level: row.level,
        balance: currentBalanceCredits,
        balanceCredits,
        storageLimit: stats.storageLimitCredits,
        storageLimitCredits,
        isFull,
        yieldPerCycle: stats.yieldPerCycle,
        cycleDurationSec: stats.cycleDurationSec,
        fossilChance: stats.fossilChance,
        upgrades: stats.upgrades,
        assignedAsteroid,
        lastCycleAt: row.last_cycle_at,
        createdAt: row.created_at,
      };
    });

    const asteroidRows = await query(
      `SELECT i.id, i.template_id, i.rarity, i.object_data, i.status, i.acquired_at,
              i.object_data->>'name' AS asteroid_name,
              i.object_data->>'nameEn' AS asteroid_name_en,
              i.object_data->>'icon' AS asteroid_icon,
              i.object_data->>'resourceType' AS resource_type,
              CASE
                WHEN COALESCE(i.object_data->>'estimatedVolume', '') ~ '^[-+]?[0-9]*\.?[0-9]+$'
                THEN (i.object_data->>'estimatedVolume')::NUMERIC
                ELSE 0
              END AS estimated_volume,
              (i.object_data->>'condition')::NUMERIC AS condition,
              er.base_credits AS base_credits
       FROM inventory_items i
       LEFT JOIN expedition_results er ON er.id = i.result_id
       WHERE i.user_id = $1
         AND i.find_type = 'asteroid'
         AND i.status IN ('in_inventory', 'saved_coords')
         AND NOT EXISTS (
           SELECT 1
           FROM user_drills d
           WHERE d.assigned_asteroid_item_id = i.id
             AND COALESCE(d.asteroid_remaining_volume, 0) > 0
         )
       ORDER BY i.acquired_at DESC`,
      [userId]
    );

    const asteroids = asteroidRows.rows.map((row) => {
      const snapshot = this._snapshotAsteroid({
        id: row.id,
        template_id: row.template_id,
        rarity: row.rarity,
        object_data: row.object_data,
        base_credits: row.base_credits,
        asteroid_remaining_volume: row.estimated_volume,
      });
      return {
        id: row.id,
        name: snapshot.name,
        nameEn: snapshot.nameEn,
        icon: snapshot.icon,
        scanned: row.object_data?.scanned !== false,
        resourceType: snapshot.resourceType,
        resourceName: snapshot.resourceName,
        totalVolume: snapshot.totalVolume,
        remainingVolume: snapshot.remainingVolume,
        condition: snapshot.condition,
        valuePerTon: snapshot.valuePerTon,
        sellPrice: snapshot.sellPrice,
        status: row.status,
        rarity: row.rarity,
        acquiredAt: row.acquired_at,
        baseCredits: snapshot.baseCredits,
      };
    });

    // Available drill types for purchase
    const typeRows = await query('SELECT * FROM drill_types');
    const availableTypes = typeRows.rows
      .map((t) => ({
        id: t.id,
        name: t.name,
        nameEn: t.name_en,
        icon: t.icon,
        costCredits: t.cost_credits,
        costStars: t.cost_stars,
        yieldPerCycle: t.base_yield_per_cycle,
        cycleDurationSec: t.cycle_duration_seconds,
        storageLimit: t.base_storage_limit,
        fossilChance: Number(t.base_fossil_chance),
      }));

    return {
      drills,
      availableTypes,
      asteroids,
      maxDrills: MAX_DRILL_SLOTS,
      unlockedSlots: Math.max(1, Math.min(MAX_DRILL_SLOTS, Number(userRow.drill_slots_unlocked || 1))),
      slotUnlockCostStars: SLOT_UNLOCK_STARS,
      starsBalance: Number(userRow.stars_balance || 0),
    };
  }

  async assignAsteroid(userId, drillId, asteroidId) {
    return await withTransaction(async (client) => {
      let step = 'load_drill';
      try {
        const drillRes = await client.query(
          `SELECT * FROM user_drills WHERE id = $1 AND user_id = $2 FOR UPDATE`,
          [drillId, userId]
        );
        if (!drillRes.rows.length) throw { status: 404, message: 'Drill not found' };
        const drill = drillRes.rows[0];

        if (Number(drill.asteroid_remaining_volume || 0) > 0 && drill.assigned_asteroid_item_id) {
          throw { status: 400, message: 'Нельзя сменить цель до истощения текущего астероида' };
        }

        step = 'load_asteroid';
        const asteroidRes = await client.query(
          `SELECT i.*, er.base_credits
           FROM inventory_items i
           LEFT JOIN expedition_results er ON er.id = i.result_id
           WHERE i.id = $1 AND i.user_id = $2 AND i.find_type = 'asteroid' AND i.status IN ('in_inventory', 'saved_coords')
           FOR UPDATE OF i`,
          [asteroidId, userId]
        );
        if (!asteroidRes.rows.length) throw { status: 404, message: 'Asteroid not found' };

        const target = asteroidRes.rows[0];
        const snapshot = this._snapshotAsteroid({
          id: target.id,
          template_id: target.template_id,
          rarity: target.rarity,
          object_data: target.object_data,
          base_credits: target.base_credits,
          asteroid_remaining_volume: target.object_data?.estimatedVolume,
        });

        step = 'check_ownership';
        const assignedRes = await client.query(
          `SELECT 1 FROM user_drills
           WHERE assigned_asteroid_item_id = $1 AND COALESCE(asteroid_remaining_volume, 0) > 0
           LIMIT 1`,
          [asteroidId]
        );
        if (assignedRes.rows.length) {
          throw { status: 400, message: 'Asteroid is already assigned to a drill' };
        }

        step = 'update_drill';
        await client.query(
          `UPDATE user_drills
           SET assigned_asteroid_item_id = $1,
               asteroid_total_volume = $2,
               asteroid_remaining_volume = $3,
               asteroid_value_per_ton = $4,
               asteroid_resource_type = $5,
               asteroid_condition = $6,
               balance = 0,
               last_cycle_at = NOW()
           WHERE id = $7 AND user_id = $8`,
          [snapshot.itemId, snapshot.totalVolume, snapshot.remainingVolume, snapshot.valuePerTon, snapshot.resourceType, snapshot.condition, drillId, userId]
        );

        step = 'reveal_asteroid';
        // Assigning an unknown asteroid to a drill reveals its parameters.
        await client.query(
          `UPDATE inventory_items
           SET status = 'mined_out',
               object_data = jsonb_set(COALESCE(object_data, '{}'::jsonb), '{scanned}', 'true'::jsonb, true)
           WHERE id = $1 AND user_id = $2`,
          [asteroidId, userId]
        );

        logger.info({ userId, drillId, asteroidId }, 'Asteroid assigned to drill');
        return { assigned: true, asteroidId, drillId };
      } catch (err) {
        logger.error({ err, userId, drillId, asteroidId, step }, 'assignAsteroid failed');
        if (err && err.status && err.message) throw err;
        throw {
          status: 500,
          message: `Assign failed at step: ${step}`,
        };
      }
    });
  }

  // ── Collect accumulated credits from a drill ─────────────────────────────
  async collectDrill(userId, drillId) {
    return await withTransaction(async (client) => {
      let step = 'load_drill';
      try {
      const drillRes = await client.query(
        `SELECT d.*, dt.base_yield_per_cycle, dt.cycle_duration_seconds,
                dt.base_storage_limit, dt.base_fossil_chance,
                ai.template_id AS asteroid_template_id,
                ai.rarity AS asteroid_rarity,
                ai.object_data AS asteroid_object_data,
                er.base_credits AS asteroid_base_credits
         FROM user_drills d
         JOIN drill_types dt ON dt.id = d.drill_type_id
         LEFT JOIN inventory_items ai ON ai.id = d.assigned_asteroid_item_id
         LEFT JOIN expedition_results er ON er.id = ai.result_id
         WHERE d.id = $1 AND d.user_id = $2 FOR UPDATE OF d`,
        [drillId, userId]
      );
      if (!drillRes.rows.length) throw { status: 404, message: 'Drill not found' };
      const drill = drillRes.rows[0];
      step = 'compute_accumulated';
      const drillType = {
        base_yield_per_cycle: drill.base_yield_per_cycle,
        cycle_duration_seconds: drill.cycle_duration_seconds,
        base_storage_limit: drill.base_storage_limit,
        base_fossil_chance: drill.base_fossil_chance,
      };
      const {
        accumulatedTons,
        accumulatedCredits,
        currentBalanceCredits,
        cyclesElapsed,
        cyclesUsed,
        haltedByLimit,
        stats,
        effectiveValuePerTon,
      } = this._computeAccumulated(drill, drillType);

      const asteroidSnapshot = drill.assigned_asteroid_item_id
        ? this._snapshotAsteroid({
            id: drill.assigned_asteroid_item_id,
            template_id: drill.asteroid_template_id,
            rarity: drill.asteroid_rarity,
            object_data: drill.asteroid_object_data,
            base_credits: drill.asteroid_base_credits,
            asteroid_value_per_ton: drill.asteroid_value_per_ton,
            asteroid_remaining_volume: drill.asteroid_remaining_volume,
          })
        : null;

      if (!asteroidSnapshot) {
        return { creditsCollected: 0, tonsCollected: 0, fossilsFound: [], newBalance: 0, exhausted: false };
      }

      if (accumulatedTons <= 0 && Number(drill.balance || 0) <= 0) {
        return { creditsCollected: 0, tonsCollected: 0, fossilsFound: [], newBalance: 0, exhausted: false };
      }

      const creditsToCollect = Math.max(0, Math.round(currentBalanceCredits));
      // Use fractional tons to support small asteroids (e.g., 0.16 т)
      const tonsToCollect = Math.max(0, accumulatedTons);
      const displayTonsCollected = tonsToCollect > 0 ? parseFloat(tonsToCollect.toFixed(3)) : 0;
      if (!Number.isFinite(creditsToCollect) || creditsToCollect < 0) {
        throw { status: 400, message: 'Invalid drill payout amount' };
      }

      // Roll fossil chance only for cycles that actually produced mined tons.
      step = 'roll_fossils';
      const fossilsFound = [];
      for (let i = 0; i < cyclesUsed; i++) {
        if (Math.random() < stats.fossilChance) {
          const fossil = await this._rollFossil(client, userId);
          if (fossil) fossilsFound.push(fossil);
        }
      }

      const minedCycles = cyclesUsed;
      const currentRemaining = Number(drill.asteroid_remaining_volume || 0);
      const remainingVolumeAfterCollect = Math.max(0, currentRemaining - tonsToCollect);
      // Exhausted if remaining <= 0.001 (accounting for floating point errors)
      const exhausted = remainingVolumeAfterCollect <= 0.001;

      // Update drill: reset balance, advance last_cycle_at by full cycles
      step = 'update_drill';
      const hadBufferedBalance = Math.max(0, Math.round(Number(drill.balance || 0))) > 0;
      const shouldResetCycleAnchor = hadBufferedBalance || haltedByLimit;
      const newLastCycle = shouldResetCycleAnchor
        ? new Date()
        : new Date(new Date(drill.last_cycle_at).getTime() + minedCycles * stats.cycleDurationSec * 1000);
      await client.query(
        `UPDATE user_drills
         SET balance = 0,
             last_cycle_at = $1,
             asteroid_remaining_volume = $2,
             assigned_asteroid_item_id = CASE WHEN $3 THEN NULL ELSE assigned_asteroid_item_id END,
             asteroid_total_volume = CASE WHEN $3 THEN NULL ELSE asteroid_total_volume END,
             asteroid_value_per_ton = CASE WHEN $3 THEN NULL ELSE asteroid_value_per_ton END,
             asteroid_resource_type = CASE WHEN $3 THEN NULL ELSE asteroid_resource_type END,
             asteroid_condition = CASE WHEN $3 THEN NULL ELSE asteroid_condition END
         WHERE id = $4`,
        [newLastCycle, remainingVolumeAfterCollect, exhausted, drillId]
      );

      if (exhausted && drill.assigned_asteroid_item_id) {
        step = 'mark_asteroid_mined_out';
        await client.query(
          `UPDATE inventory_items SET status = 'mined_out' WHERE id = $1`,
          [drill.assigned_asteroid_item_id]
        );
      }

      // Award credits to user
      if (creditsToCollect > 0) {
        step = 'credit_user';
        const userRes = await client.query('SELECT credits FROM users WHERE id = $1 FOR UPDATE', [userId]);
        if (!userRes.rows.length) throw { status: 404, message: 'User not found' };
        const balanceBefore = Number(userRes.rows[0].credits);
        await client.query('UPDATE users SET credits = credits + $1 WHERE id = $2', [creditsToCollect, userId]);
        const txAmount = Math.min(PG_INT_MAX, creditsToCollect);
        step = 'write_credit_tx';
        await client.query(
          `INSERT INTO credit_transactions (user_id, type, amount, balance_before, balance_after, metadata)
           VALUES ($1, 'drill_collect', $2, $3, $4, $5)`,
          [userId, txAmount, balanceBefore, balanceBefore + creditsToCollect,
           JSON.stringify({
             drillId,
             cycles: cyclesUsed,
             tonsCollected: displayTonsCollected,
             valuePerTon: effectiveValuePerTon,
             fullAmount: creditsToCollect,
             amountCapped: txAmount !== creditsToCollect,
             accumulatedCredits,
           })]
        );
      }

      logger.info({ userId, drillId, creditsToCollect, tonsCollected: displayTonsCollected, fossilsFound: fossilsFound.length, cyclesUsed }, 'Drill collected');

      return {
        creditsCollected: creditsToCollect,
        tonsCollected: displayTonsCollected,
        fossilsFound,
        newBalance: 0,
        exhausted,
      };
      } catch (err) {
        logger.error({
          err,
          userId,
          drillId,
          step,
        }, 'collectDrill failed');

        if (err && err.status && err.message) {
          throw err;
        }

        throw {
          status: 500,
          message: `Collect failed at step: ${step}`,
        };
      }
    });
  }

  // ── Roll a random fossil (collectible) ───────────────────────────────────
  async _rollFossil(client, userId) {
    try {
      const commonRes = await client.query(
        `SELECT COUNT(*)::int AS count
         FROM inventory_items
         WHERE user_id = $1 AND find_type = 'collectible' AND rarity = 'common'`,
        [userId]
      );
      const commonOwned = Number(commonRes.rows[0]?.count || 0);

      // Weighted by rarity: common most likely, mythical very rare.
      // Early common pity prevents accounts from opening with several top-rarity fossils
      // while still missing the baseline common fossils needed by collections.
      const weights = commonOwned < 5
        ? { common: 86, rare: 14, epic: 0, legendary: 0, mythical: 0 }
        : { common: 78, rare: 16, epic: 4, legendary: 1.5, mythical: 0.5 };
      const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
      let roll = Math.random() * totalWeight;
      let selectedRarity = 'common';
      for (const [rarity, weight] of Object.entries(weights)) {
        roll -= weight;
        if (roll <= 0) { selectedRarity = rarity; break; }
      }

      const templates = await client.query(
        'SELECT * FROM collectible_templates WHERE rarity = $1',
        [selectedRarity]
      );
      if (!templates.rows.length) return null;
      const template = templates.rows[Math.floor(Math.random() * templates.rows.length)];

      // Insert into inventory_items as collectible
      const result = await client.query(
        `INSERT INTO inventory_items (user_id, find_type, template_id, rarity, object_data, status, acquired_at)
         VALUES ($1, 'collectible', $2, $3, $4, 'in_inventory', NOW())
         RETURNING id`,
        [userId, template.id, template.rarity,
         JSON.stringify({
           name: template.name,
           nameEn: template.name_en,
           icon: template.icon,
           sellPrice: template.sell_price,
           description: template.description,
           descriptionEn: template.description_en,
         })]
      );

      return {
        id: result.rows[0].id,
        templateId: template.id,
        name: template.name,
        nameEn: template.name_en,
        rarity: template.rarity,
        icon: template.icon,
        sellPrice: template.sell_price || 10,
      };
    } catch (err) {
      logger.warn({ err, userId }, 'Fossil roll failed, skipping collectible grant');
      return null;
    }
  }

  // ── Purchase a new drill ─────────────────────────────────────────────────
  async purchaseDrill(userId, drillTypeId, payWith = 'credits', slotIndex) {
    return await withTransaction(async (client) => {
      const slot = Number(slotIndex || 0);
      if (!Number.isInteger(slot) || slot < 1 || slot > MAX_DRILL_SLOTS) {
        throw { status: 400, message: 'Invalid slot index' };
      }

      const userRes = await client.query(
        'SELECT stars_balance, COALESCE(drill_slots_unlocked, 1) AS drill_slots_unlocked FROM users WHERE id = $1 FOR UPDATE',
        [userId]
      );
      if (!userRes.rows.length) throw { status: 404, message: 'User not found' };
      const unlockedSlots = Number(userRes.rows[0].drill_slots_unlocked || 1);
      if (slot > unlockedSlots) {
        throw { status: 400, message: 'Slot is locked' };
      }

      const prevSlot = slot - 1;
      if (prevSlot >= 1) {
        const prevSlotRes = await client.query(
          'SELECT 1 FROM user_drills WHERE user_id = $1 AND slot_index = $2 LIMIT 1',
          [userId, prevSlot]
        );
        if (!prevSlotRes.rows.length) {
          throw { status: 400, message: 'Previous slot must be occupied first' };
        }
      }

      const slotOccupiedRes = await client.query(
        'SELECT 1 FROM user_drills WHERE user_id = $1 AND slot_index = $2 LIMIT 1',
        [userId, slot]
      );
      if (slotOccupiedRes.rows.length) throw { status: 400, message: 'Slot already has a drill' };

      // Get drill type
      const typeRes = await client.query('SELECT * FROM drill_types WHERE id = $1', [drillTypeId]);
      if (!typeRes.rows.length) throw { status: 404, message: 'Drill type not found' };
      const drillType = typeRes.rows[0];

      // Deduct cost
      const creditsRes = await client.query('SELECT credits FROM users WHERE id = $1 FOR UPDATE', [userId]);
      const creditsBalance = Number(creditsRes.rows[0]?.credits || 0);
      const starsBalance = Number(userRes.rows[0].stars_balance || 0);

      if (payWith === 'stars' && drillType.cost_stars) {
        if (starsBalance < drillType.cost_stars) {
          throw { status: 400, message: 'Not enough stars' };
        }
        await client.query('UPDATE users SET stars_balance = stars_balance - $1 WHERE id = $2',
          [drillType.cost_stars, userId]);
      } else if (drillType.cost_credits) {
        if (creditsBalance < drillType.cost_credits) {
          throw { status: 400, message: 'Not enough credits' };
        }
        await client.query('UPDATE users SET credits = credits - $1 WHERE id = $2',
          [drillType.cost_credits, userId]);
      }
      // Free drill (standard) has null costs

      // Create drill
      const drillRes = await client.query(
        `INSERT INTO user_drills (user_id, drill_type_id, slot_index) VALUES ($1, $2, $3) RETURNING id`,
        [userId, drillTypeId, slot]
      );

      logger.info({ userId, drillTypeId, drillId: drillRes.rows[0].id, slot }, 'Drill purchased');
      return { drillId: drillRes.rows[0].id, slotIndex: slot };
    });
  }

  async unlockNextSlot(userId) {
    return await withTransaction(async (client) => {
      const userRes = await client.query(
        'SELECT stars_balance, COALESCE(drill_slots_unlocked, 1) AS drill_slots_unlocked FROM users WHERE id = $1 FOR UPDATE',
        [userId]
      );
      if (!userRes.rows.length) throw { status: 404, message: 'User not found' };

      const unlockedSlots = Number(userRes.rows[0].drill_slots_unlocked || 1);
      const starsBalance = Number(userRes.rows[0].stars_balance || 0);

      if (unlockedSlots >= MAX_DRILL_SLOTS) {
        throw { status: 400, message: 'All drill slots are already unlocked' };
      }

      const requiredPrevSlot = unlockedSlots;
      const prevSlotRes = await client.query(
        'SELECT 1 FROM user_drills WHERE user_id = $1 AND slot_index = $2 LIMIT 1',
        [userId, requiredPrevSlot]
      );
      if (!prevSlotRes.rows.length) {
        throw { status: 400, message: 'Previous slot must have a drill first' };
      }

      if (starsBalance < SLOT_UNLOCK_STARS) {
        throw { status: 400, message: 'Not enough stars to unlock slot' };
      }

      await client.query('UPDATE users SET stars_balance = stars_balance - $1, drill_slots_unlocked = drill_slots_unlocked + 1 WHERE id = $2', [
        SLOT_UNLOCK_STARS,
        userId,
      ]);

      return {
        unlockedSlots: unlockedSlots + 1,
        starsRemaining: starsBalance - SLOT_UNLOCK_STARS,
      };
    });
  }

  async deleteDrill(userId, drillId) {
    return await withTransaction(async (client) => {
      const drillRes = await client.query(
        'SELECT id, slot_index FROM user_drills WHERE id = $1 AND user_id = $2 FOR UPDATE',
        [drillId, userId]
      );
      if (!drillRes.rows.length) throw { status: 404, message: 'Drill not found' };

      const slotIndex = Number(drillRes.rows[0].slot_index || 1);

      await client.query('DELETE FROM user_drills WHERE id = $1 AND user_id = $2', [drillId, userId]);

      // Keep slots contiguous so slot #2/#3 do not float after deleting lower slots.
      await client.query(
        `UPDATE user_drills
         SET slot_index = slot_index - 1
         WHERE user_id = $1 AND slot_index > $2`,
        [userId, slotIndex]
      );

      logger.info({ userId, drillId, slotIndex }, 'Drill deleted');

      return { deleted: true, slotIndex };
    });
  }

  // ── Upgrade a drill ──────────────────────────────────────────────────────
  async upgradeDrill(userId, drillId, upgradeType) {
    return await withTransaction(async (client) => {
      const upgradeColumn = UPGRADE_TYPES[upgradeType];
      const maxTypeLevel = MAX_UPGRADE_LEVEL_PER_TYPE[upgradeType];
      if (!upgradeColumn) {
        throw { status: 400, message: 'Unknown upgrade type' };
      }

      const drillRes = await client.query(
        'SELECT * FROM user_drills WHERE id = $1 AND user_id = $2 FOR UPDATE',
        [drillId, userId]
      );
      if (!drillRes.rows.length) throw { status: 404, message: 'Drill not found' };
      const drill = drillRes.rows[0];
      const upgrades = this._getUpgradeLevels(drill);

      if (upgrades.totalUsed >= MAX_UPGRADES_PER_DRILL) {
        throw { status: 400, message: 'Upgrade limit reached for this drill' };
      }

      const currentTypeLevel = Number(drill[upgradeColumn] || 0);
      if (currentTypeLevel >= maxTypeLevel) {
        throw { status: 400, message: 'This upgrade is already at max level' };
      }

      const cost = UPGRADE_COSTS[upgrades.totalUsed];

      const user = await client.query('SELECT credits FROM users WHERE id = $1 FOR UPDATE', [userId]);
      if (Number(user.rows[0].credits) < cost) {
        throw { status: 400, message: 'Not enough credits' };
      }

      await client.query('UPDATE users SET credits = credits - $1 WHERE id = $2', [cost, userId]);
      await client.query(
        `UPDATE user_drills
         SET ${upgradeColumn} = ${upgradeColumn} + 1
         WHERE id = $1`,
        [drillId]
      );

      logger.info({ userId, drillId, upgradeType, cost, newTypeLevel: currentTypeLevel + 1 }, 'Drill upgraded');
      return {
        upgraded: true,
        upgradeType,
        newTypeLevel: currentTypeLevel + 1,
        totalUsed: upgrades.totalUsed + 1,
        maxTotal: MAX_UPGRADES_PER_DRILL,
      };
    });
  }

  // ── Grant free drill on reaching level 10 ────────────────────────────────
  async grantFreeDrill(userId) {
    const existing = await query('SELECT 1 FROM user_drills WHERE user_id = $1 AND slot_index = 1 LIMIT 1', [userId]);
    if (existing.rows.length) return null; // already has a drill

    const res = await query(
      `INSERT INTO user_drills (user_id, drill_type_id, slot_index) VALUES ($1, 'standard_drill', 1)
       ON CONFLICT DO NOTHING RETURNING id`,
      [userId]
    );
    if (res.rows.length) {
      logger.info({ userId }, 'Free drill granted at level 10');
      return res.rows[0].id;
    }
    return null;
  }

  // ── Get collectible inventory ────────────────────────────────────────────
  async getCollectibles(userId) {
    const res = await query(
      `SELECT i.id,
              i.template_id,
              i.rarity,
              i.object_data,
              i.acquired_at,
              COALESCE(i.object_data->>'name', ct.name) AS display_name,
              COALESCE(i.object_data->>'nameEn', ct.name_en) AS display_name_en,
              COALESCE(i.object_data->>'icon', ct.icon) AS display_icon,
              COALESCE((i.object_data->>'sellPrice')::INT, ct.sell_price, 10) AS display_sell_price
       FROM inventory_items i
       LEFT JOIN collectible_templates ct ON ct.id = i.template_id
       WHERE i.user_id = $1 AND i.find_type = 'collectible' AND i.status = 'in_inventory'
       ORDER BY acquired_at DESC`,
      [userId]
    );
    return res.rows.map((r) => ({
      id: r.id,
      templateId: r.template_id,
      rarity: r.rarity,
      name: r.display_name,
      nameEn: r.display_name_en,
      icon: r.display_icon,
      sellPrice: r.display_sell_price,
      acquiredAt: r.acquired_at,
    }));
  }

  // ── Get collections with progress ────────────────────────────────────────
  async getCollections(userId) {
    const [collectionsRes, requirementsRes, userCollectionsRes, inventoryRes] = await Promise.all([
      query('SELECT * FROM collections ORDER BY id'),
      query(
        `SELECT cr.collection_id,
                cr.collectible_id,
                cr.quantity,
                ct.name AS collectible_name,
                ct.name_en AS collectible_name_en
         FROM collection_requirements cr
         LEFT JOIN collectible_templates ct ON ct.id = cr.collectible_id
         ORDER BY cr.collection_id`
      ),
      query('SELECT collection_id, completed_at FROM user_collections WHERE user_id = $1', [userId]),
      query(
        `SELECT template_id, COUNT(*) AS count
         FROM inventory_items
         WHERE user_id = $1 AND find_type = 'collectible' AND status = 'in_inventory'
         GROUP BY template_id`,
        [userId]
      ),
    ]);

    const cooldownMs = COLLECTION_SUBMIT_COOLDOWN_HOURS * 60 * 60 * 1000;
    const nowMs = Date.now();
    const userCollectionById = new Map(
      userCollectionsRes.rows.map((r) => [r.collection_id, r])
    );
    const owned = {};
    for (const r of inventoryRes.rows) owned[r.template_id] = parseInt(r.count);

    const reqsByCollection = {};
    for (const r of requirementsRes.rows) {
      if (!reqsByCollection[r.collection_id]) reqsByCollection[r.collection_id] = [];
      reqsByCollection[r.collection_id].push(r);
    }

    return collectionsRes.rows.map((col) => {
      const reqs = reqsByCollection[col.id] || [];
      const items = reqs.map((r) => ({
        collectibleId: r.collectible_id,
        collectibleName: r.collectible_name,
        collectibleNameEn: r.collectible_name_en,
        required: r.quantity,
        owned: owned[r.collectible_id] || 0,
      }));
      const lastSubmit = userCollectionById.get(col.id);
      const lastSubmitAt = lastSubmit?.completed_at ? new Date(lastSubmit.completed_at) : null;
      const nextAvailableAt = lastSubmitAt
        ? new Date(lastSubmitAt.getTime() + cooldownMs)
        : null;
      const onCooldown = Boolean(nextAvailableAt && nextAvailableAt.getTime() > nowMs);
      const canSubmit = !onCooldown && items.every((i) => i.owned >= i.required);

      return {
        id: col.id,
        name: col.name,
        nameEn: col.name_en,
        description: col.description,
        descriptionEn: col.description_en,
        icon: col.icon,
        rewardCredits: col.reward_credits,
        rewardXp: col.reward_xp,
        completed: false,
        lastSubmitAt,
        nextAvailableAt,
        onCooldown,
        canSubmit,
        items,
      };
    });
  }

  // ── Submit a completed collection ────────────────────────────────────────
  async submitCollection(userId, collectionId) {
    return await withTransaction(async (client) => {
      // Enforce per-collection cooldown.
      const cooldownRes = await client.query(
        'SELECT completed_at FROM user_collections WHERE user_id = $1 AND collection_id = $2 FOR UPDATE',
        [userId, collectionId]
      );
      const now = new Date();
      const cooldownMs = COLLECTION_SUBMIT_COOLDOWN_HOURS * 60 * 60 * 1000;
      if (cooldownRes.rows.length) {
        const lastSubmitAt = new Date(cooldownRes.rows[0].completed_at);
        const nextAvailableAt = new Date(lastSubmitAt.getTime() + cooldownMs);
        if (nextAvailableAt > now) {
          throw {
            status: 400,
            message: 'Collection is on cooldown',
            nextAvailableAt,
          };
        }
      }

      // Get requirements
      const reqRes = await client.query(
        'SELECT * FROM collection_requirements WHERE collection_id = $1', [collectionId]
      );
      if (!reqRes.rows.length) throw { status: 404, message: 'Collection not found' };

      // Check and consume items
      for (const req of reqRes.rows) {
        const itemsRes = await client.query(
          `SELECT id FROM inventory_items
           WHERE user_id = $1 AND find_type = 'collectible' AND template_id = $2 AND status = 'in_inventory'
           ORDER BY acquired_at ASC LIMIT $3`,
          [userId, req.collectible_id, req.quantity]
        );
        if (itemsRes.rows.length < req.quantity) {
          throw { status: 400, message: `Not enough ${req.collectible_id}` };
        }
        // Mark items as consumed
        const ids = itemsRes.rows.map((r) => r.id);
        await client.query(
          `UPDATE inventory_items SET status = 'sold', sold_at = NOW() WHERE id = ANY($1)`,
          [ids]
        );
      }

      // Award rewards
      const colRes = await client.query('SELECT * FROM collections WHERE id = $1', [collectionId]);
      const col = colRes.rows[0];

      if (col.reward_credits > 0) {
        const userRes = await client.query('SELECT credits FROM users WHERE id = $1 FOR UPDATE', [userId]);
        const before = Number(userRes.rows[0].credits);
        await client.query('UPDATE users SET credits = credits + $1 WHERE id = $2', [col.reward_credits, userId]);
        await client.query(
          `INSERT INTO credit_transactions (user_id, type, amount, balance_before, balance_after, metadata)
           VALUES ($1, 'collection_reward', $2, $3, $4, $5)`,
          [userId, col.reward_credits, before, before + col.reward_credits,
           JSON.stringify({ collectionId })]
        );
      }

      if (col.reward_xp > 0) {
        await client.query(
          'UPDATE users SET xp = xp + $1, level = calculate_level(xp + $1) WHERE id = $2',
          [col.reward_xp, userId]
        );
      }

      // Upsert cooldown timestamp for this collection slot.
      await client.query(
        `INSERT INTO user_collections (user_id, collection_id, completed_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (user_id, collection_id)
         DO UPDATE SET completed_at = EXCLUDED.completed_at`,
        [userId, collectionId]
      );

      // Fetch updated XP / level so frontend can update state without a full profile reload.
      const updatedUserRow = await client.query('SELECT xp, level FROM users WHERE id = $1', [userId]);
      const updatedXP    = updatedUserRow.rows[0]?.xp    ?? null;
      const updatedLevel = updatedUserRow.rows[0]?.level ?? null;

      logger.info({ userId, collectionId, credits: col.reward_credits, xp: col.reward_xp }, 'Collection submitted');

      return {
        rewardCredits: col.reward_credits,
        rewardXp:      col.reward_xp,
        newXP:   updatedXP   !== null ? Number(updatedXP)   : undefined,
        newLevel: updatedLevel !== null ? Number(updatedLevel) : undefined,
      };
    });
  }

  // ── Sell a collectible item ──────────────────────────────────────────────
  async sellCollectible(userId, itemId) {
    return await withTransaction(async (client) => {
      const itemRes = await client.query(
        `SELECT * FROM inventory_items
         WHERE id = $1 AND user_id = $2 AND find_type = 'collectible' AND status = 'in_inventory'
         FOR UPDATE`,
        [itemId, userId]
      );
      if (!itemRes.rows.length) throw { status: 404, message: 'Item not found' };
      const item = itemRes.rows[0];
      const sellPrice = item.object_data?.sellPrice || 10;

      await client.query(
        `UPDATE inventory_items SET status = 'sold', sold_for = $1, sold_at = NOW() WHERE id = $2`,
        [sellPrice, itemId]
      );

      const userRes = await client.query('SELECT credits FROM users WHERE id = $1 FOR UPDATE', [userId]);
      const before = Number(userRes.rows[0].credits);
      await client.query('UPDATE users SET credits = credits + $1 WHERE id = $2', [sellPrice, userId]);
      await client.query(
        `INSERT INTO credit_transactions (user_id, type, amount, balance_before, balance_after, metadata)
         VALUES ($1, 'collectible_sell', $2, $3, $4, $5)`,
        [userId, sellPrice, before, before + sellPrice,
         JSON.stringify({ itemId, templateId: item.template_id })]
      );

      return { creditsGained: sellPrice };
    });
  }
}

module.exports = DrillService;
