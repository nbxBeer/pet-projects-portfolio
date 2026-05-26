-- ============================================================
-- Migration 003: Global events system
-- Run once on the production DB before deploying this release
-- ============================================================

-- 1. Global events table
CREATE TABLE IF NOT EXISTS global_events (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title       VARCHAR(200) NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    icon        VARCHAR(20) NOT NULL DEFAULT '🎉',
    effects     JSONB NOT NULL DEFAULT '[]',
    is_active   BOOLEAN NOT NULL DEFAULT true,
    starts_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ends_at     TIMESTAMPTZ NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_global_events_active
    ON global_events(is_active, ends_at) WHERE is_active = true;

-- 2. Snapshot of active event effects captured at expedition start
--    (so event bonuses apply fairly even if the event ends mid-flight)
ALTER TABLE expeditions
    ADD COLUMN IF NOT EXISTS event_snapshot JSONB NOT NULL DEFAULT '[]';
