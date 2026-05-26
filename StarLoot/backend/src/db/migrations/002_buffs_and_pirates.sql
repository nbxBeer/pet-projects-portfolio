-- ============================================================
-- Migration 002: Active buffs table + pirate event columns
-- Run once on the production DB before deploying this release
-- ============================================================

-- 1. Active buffs table (time-based and use-based)
CREATE TABLE IF NOT EXISTS user_active_buffs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    buff_type       VARCHAR(50) NOT NULL,
    expires_at      TIMESTAMPTZ,        -- NULL for use-based buffs
    uses_remaining  INT,                -- NULL for time-based buffs
    metadata        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, buff_type)          -- one row per buff type per user
);

CREATE INDEX IF NOT EXISTS idx_active_buffs_user ON user_active_buffs(user_id);
CREATE INDEX IF NOT EXISTS idx_active_buffs_expires ON user_active_buffs(expires_at)
    WHERE expires_at IS NOT NULL;

-- 2. Expedition cooldown on users (pirate defeat penalty)
ALTER TABLE users ADD COLUMN IF NOT EXISTS expedition_cooldown_until TIMESTAMPTZ;

-- 3. Pirate pending state on expeditions
ALTER TABLE expeditions ADD COLUMN IF NOT EXISTS pirate_pending_data JSONB;

-- 4. New transaction type for credit buff purchases
--    NOTE: ALTER TYPE ... ADD VALUE cannot run inside a transaction block.
--    Run these two lines separately if needed (Postgres 9.1+):
ALTER TYPE transaction_type_enum ADD VALUE IF NOT EXISTS 'spend_buff_credits';

-- 5. Pirate encounter statistics on users
ALTER TABLE users ADD COLUMN IF NOT EXISTS pirate_encounters    INT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pirate_fight_wins    INT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pirate_fight_losses  INT NOT NULL DEFAULT 0;
