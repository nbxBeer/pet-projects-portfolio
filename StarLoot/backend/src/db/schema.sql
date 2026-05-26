-- ============================================================
-- SPACE EXPEDITION GAME — PostgreSQL Schema
-- Version: 1.0.0
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- for text search

-- ============================================================
-- ENUMS
-- ============================================================

CREATE TYPE rarity_enum AS ENUM (
    'common', 'exotic', 'rare', 'ancient', 'epic',
    'relic', 'legendary', 'hybrid', 'mythical', 'singularity'
);
CREATE TYPE find_type_enum AS ENUM (
    'asteroid', 'debris', 'artifact', 'creature', 'anomaly',
    'nft_container', 'collectible', 'scrap', 'story_item', 'echo', 'relic', 'entity', 'rift'
);
CREATE TYPE expedition_status_enum AS ENUM ('in_progress', 'completed', 'collected');
CREATE TYPE inventory_status_enum AS ENUM ('in_inventory', 'sold', 'saved_coords', 'mined_out');
CREATE TYPE module_type_enum AS ENUM ('scanner', 'engine', 'cargo', 'capsule');
CREATE TYPE transaction_type_enum AS ENUM ('sell_item', 'upgrade_module', 'speedup_expedition', 'nft_reward', 'admin_grant', 'drill_collect', 'collectible_sell', 'collection_reward');
CREATE TYPE stars_transaction_type_enum AS ENUM ('topup', 'spend_speedup', 'spend_other', 'refund');

-- ============================================================
-- USERS
-- ============================================================

CREATE TABLE users (
    id              BIGINT PRIMARY KEY,          -- Telegram user_id
    username        VARCHAR(255),
    first_name      VARCHAR(255),
    last_name       VARCHAR(255),
    language_code   VARCHAR(10) DEFAULT 'ru',
    credits         BIGINT NOT NULL DEFAULT 0,
    stars_balance   INT    NOT NULL DEFAULT 0,   -- Telegram Stars (in-game wallet)
    total_stars_spent INT  NOT NULL DEFAULT 0,   -- lifetime stars spent
    xp              BIGINT NOT NULL DEFAULT 0,
    level           INT NOT NULL DEFAULT 1,
    total_expeditions INT NOT NULL DEFAULT 0,
    total_finds     INT NOT NULL DEFAULT 0,
    total_sold      INT NOT NULL DEFAULT 0,
    is_banned       BOOLEAN NOT NULL DEFAULT false,
    ban_reason      TEXT,
    referred_by     BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_active_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    tos_accepted    BOOLEAN NOT NULL DEFAULT false,
    tos_accepted_at TIMESTAMPTZ,
    tos_version     INT,
    drill_slots_unlocked INT NOT NULL DEFAULT 1,
    registration_chat_id BIGINT,                     -- Telegram group chat ID user registered from
    registration_chat_title VARCHAR(255),            -- Chat name at registration
    registration_source_type VARCHAR(50)             -- 'organic', 'group_chat', 'chat_link', 'ads_link'
);

CREATE INDEX idx_users_level ON users(level);
CREATE INDEX idx_users_credits ON users(credits DESC);
CREATE INDEX idx_users_xp ON users(xp DESC);

-- ============================================================
-- EXPEDITIONS
-- ============================================================

CREATE TABLE expeditions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    zone_id         VARCHAR(100) NOT NULL,
    sector          CHAR(1) NOT NULL,
    status          expedition_status_enum NOT NULL DEFAULT 'in_progress',
    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ends_at         TIMESTAMPTZ NOT NULL,
    collected_at    TIMESTAMPTZ,
    was_sped_up     BOOLEAN NOT NULL DEFAULT false,
    speedup_cost_stars INT,
    -- Anti-cheat: store request fingerprint
    client_seed     VARCHAR(64) NOT NULL,  -- client-provided random seed
    server_seed     VARCHAR(64) NOT NULL,  -- server random seed (revealed after collection)
    combined_hash   VARCHAR(64),          -- SHA256(client_seed + server_seed) for provably fair
    event_snapshot  JSONB NOT NULL DEFAULT '[]', -- active event effects snapshot at expedition start
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_expeditions_user_status ON expeditions(user_id, status);
CREATE INDEX idx_expeditions_ends_at ON expeditions(ends_at) WHERE status = 'in_progress';

-- ============================================================
-- EXPEDITION RESULTS (generated when expedition completes)
-- ============================================================

CREATE TABLE expedition_results (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    expedition_id   UUID NOT NULL REFERENCES expeditions(id) ON DELETE CASCADE,
    user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    find_type       find_type_enum NOT NULL,
    template_id     VARCHAR(100),          -- references findTemplates
    rarity          rarity_enum NOT NULL,
    object_data     JSONB NOT NULL,        -- full serialized find object
    base_credits    INT NOT NULL DEFAULT 0,
    base_xp         INT NOT NULL DEFAULT 0,
    final_credits   INT,                   -- calculated on sell
    final_xp        INT,                   -- calculated on sell
    action_taken    VARCHAR(50),           -- 'collected', 'sold', 'saved_coords'
    action_taken_at TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_results_user ON expedition_results(user_id, created_at DESC);
CREATE INDEX idx_results_expedition ON expedition_results(expedition_id);

-- ============================================================
-- INVENTORY ITEMS
-- ============================================================

CREATE TABLE inventory_items (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    result_id       UUID REFERENCES expedition_results(id) ON DELETE SET NULL,
    find_type       find_type_enum NOT NULL,
    template_id     VARCHAR(100),
    rarity          rarity_enum NOT NULL,
    object_data     JSONB NOT NULL,
    status          inventory_status_enum NOT NULL DEFAULT 'in_inventory',
    acquired_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sold_at         TIMESTAMPTZ,
    sold_for        INT,
    xp_gained       INT
);

CREATE INDEX idx_inventory_user_status ON inventory_items(user_id, status);
CREATE INDEX idx_inventory_user_type ON inventory_items(user_id, find_type);
CREATE INDEX idx_inventory_rarity ON inventory_items(user_id, rarity);

-- ============================================================
-- SHIP MODULES
-- ============================================================

CREATE TABLE ship_modules (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    module_type     module_type_enum NOT NULL,
    level           INT NOT NULL DEFAULT 0,
    upgraded_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, module_type)
);

CREATE INDEX idx_modules_user ON ship_modules(user_id);

-- ============================================================
-- TRANSACTIONS (credits audit log)
-- ============================================================

CREATE TABLE credit_transactions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type            transaction_type_enum NOT NULL,
    amount          INT NOT NULL,          -- positive = gain, negative = spend
    balance_before  BIGINT NOT NULL,
    balance_after   BIGINT NOT NULL,
    reference_id    UUID,                  -- item_id, expedition_id, etc.
    metadata        JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_transactions_user ON credit_transactions(user_id, created_at DESC);

-- ============================================================
-- DRILLS
-- ============================================================

CREATE TABLE user_drills (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id                 BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    drill_type_id           VARCHAR(50) NOT NULL REFERENCES drill_types(id),
    level                   INT NOT NULL DEFAULT 1,
    balance                 INT NOT NULL DEFAULT 0,
    last_cycle_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    assigned_asteroid_item_id UUID REFERENCES inventory_items(id) ON DELETE SET NULL,
    asteroid_total_volume    NUMERIC(10,3),
    asteroid_remaining_volume NUMERIC(10,3),
    asteroid_value_per_ton   INT,
    asteroid_resource_type   VARCHAR(50),
    asteroid_condition      NUMERIC(5,2),
    slot_index              INT NOT NULL DEFAULT 1,
    upgrade_yield_level      INT NOT NULL DEFAULT 0,
    upgrade_fossil_level     INT NOT NULL DEFAULT 0,
    upgrade_value_level      INT NOT NULL DEFAULT 0,
    upgrade_storage_level    INT NOT NULL DEFAULT 0,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_drills_user ON user_drills(user_id);
CREATE UNIQUE INDEX idx_user_drills_user_slot_unique ON user_drills(user_id, slot_index);

-- ============================================================
-- STARS TRANSACTIONS (Telegram Stars wallet)
-- ============================================================

CREATE TABLE stars_transactions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type            stars_transaction_type_enum NOT NULL,
    amount          INT NOT NULL,             -- positive = topup, negative = spend
    balance_before  INT NOT NULL,
    balance_after   INT NOT NULL,
    -- For topup: Telegram payment data
    telegram_payment_charge_id  VARCHAR(255) UNIQUE, -- Telegram's charge ID (idempotency)
    telegram_invoice_payload    VARCHAR(255),
    -- For spend: what was purchased
    reference_id    UUID,
    description     VARCHAR(255),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_stars_tx_user ON stars_transactions(user_id, created_at DESC);
CREATE INDEX idx_stars_tx_charge ON stars_transactions(telegram_payment_charge_id)
    WHERE telegram_payment_charge_id IS NOT NULL;

-- ============================================================
-- NFT NOTIFICATIONS (admin manual processing queue)
-- ============================================================

CREATE TABLE nft_notifications (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    username        VARCHAR(255),
    first_name      VARCHAR(255),
    expedition_id   UUID REFERENCES expeditions(id),
    result_id       UUID REFERENCES expedition_results(id),
    outcome_type    VARCHAR(50) NOT NULL,  -- 'telegram_gift' | 'unique_ship'
    outcome_label   VARCHAR(100),
    admin_notified  BOOLEAN NOT NULL DEFAULT false,
    admin_processed BOOLEAN NOT NULL DEFAULT false,
    processed_at    TIMESTAMPTZ,
    admin_note      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_nft_notif_unprocessed ON nft_notifications(admin_processed, created_at)
    WHERE admin_processed = false;

-- ============================================================
-- ACHIEVEMENTS
-- ============================================================

CREATE TABLE achievement_definitions (
    id              VARCHAR(100) PRIMARY KEY,
    name            VARCHAR(255) NOT NULL,
    description     TEXT NOT NULL,
    reward_credits  INT NOT NULL DEFAULT 0,
    reward_xp       INT NOT NULL DEFAULT 0,
    icon            VARCHAR(100),
    conditions      JSONB NOT NULL,        -- { type: 'find_count', find_type: 'artifact', count: 10 }
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE user_achievements (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    achievement_id  VARCHAR(100) NOT NULL REFERENCES achievement_definitions(id),
    progress        INT NOT NULL DEFAULT 0,
    completed       BOOLEAN NOT NULL DEFAULT false,
    completed_at    TIMESTAMPTZ,
    UNIQUE(user_id, achievement_id)
);


CREATE INDEX idx_achievements_user ON user_achievements(user_id, completed);

-- ============================================================
-- CHAT SOURCES (group chats and shareable links)
-- ============================================================

CREATE TABLE chat_sources (
    chat_id             BIGINT PRIMARY KEY,           -- Telegram group chat ID
    chat_title          VARCHAR(255),                 -- Chat name
    link_code           VARCHAR(50),                  -- Unique shareable link code
    owner_user_id       BIGINT REFERENCES users(id) ON DELETE SET NULL,
    owner_username      VARCHAR(255),                 -- Username of claimed owner
    chat_auto_delete_low_rarity BOOLEAN NOT NULL DEFAULT false,
    stars_total_received BIGINT DEFAULT 0,
    expeditions_count   INT DEFAULT 0,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_chat_sources_link_code ON chat_sources(link_code) WHERE link_code IS NOT NULL;
CREATE INDEX idx_chat_sources_owner ON chat_sources(owner_user_id);

CREATE INDEX idx_chat_sources_updated ON chat_sources(updated_at);

-- ============================================================
-- LINK ANALYTICS (tracking starts via referral and chat links)
-- ============================================================

CREATE TABLE start_link_analytics (
    source           VARCHAR(100) PRIMARY KEY,     -- src code, chat_<code>, or 'ad'
    starts_count     INT NOT NULL DEFAULT 1,
    unique_users     INT NOT NULL DEFAULT 1,
    last_start_at    TIMESTAMPTZ,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE link_start_events (
    id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source           VARCHAR(100) NOT NULL,
    user_id          BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    is_new_user      BOOLEAN NOT NULL DEFAULT false,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_link_start_events_source ON link_start_events(source);
CREATE INDEX idx_link_start_events_user ON link_start_events(user_id);
CREATE INDEX idx_link_start_events_created ON link_start_events(created_at);

-- ============================================================
-- GAME CONFIG (DB overrides for gameConfig.js)
-- ============================================================

CREATE TABLE game_config (
    key             VARCHAR(200) PRIMARY KEY,  -- dot-notation: 'rarity.common.weight'
    value           TEXT NOT NULL,             -- JSON-encoded value
    description     TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    updated_by      VARCHAR(100),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- NONCE STORE (replay attack prevention)
-- ============================================================

CREATE TABLE used_nonces (
    nonce           VARCHAR(128) PRIMARY KEY,
    user_id         BIGINT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_nonces_expires ON used_nonces(expires_at);
-- Cleanup old nonces via pg cron or periodic job

-- ============================================================
-- FUNCTIONS & TRIGGERS
-- ============================================================

-- Auto-update updated_at on users
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Calculate user level from XP
CREATE OR REPLACE FUNCTION calculate_level(p_xp BIGINT)
RETURNS INT AS $$
DECLARE
    xp_table INT[][] := ARRAY[
        [1, 0], [2, 100], [3, 250], [4, 450], [5, 700],
        [6, 1000], [7, 1350], [8, 1750], [9, 2200], [10, 2700],
        [11, 3300], [12, 4000], [13, 4800], [14, 5700], [15, 6700],
        [16, 7800], [17, 9000], [18, 10300], [19, 11700], [20, 13200]
    ];
    result_level INT := 1;
    i INT;
BEGIN
    FOR i IN 1..array_length(xp_table, 1) LOOP
        IF p_xp >= xp_table[i][2] THEN
            result_level := xp_table[i][1];
        END IF;
    END LOOP;
    RETURN result_level;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================
-- SEED DATA — Achievement definitions
-- ============================================================

INSERT INTO achievement_definitions (id, name, description, reward_credits, reward_xp, conditions) VALUES
('first_expedition',    'Первый шаг',        'Завершите первую экспедицию',          100, 20,  '{"type":"expedition_count","count":1}'),
('explorer_10',        'Исследователь',      'Завершите 10 экспедиций',              500, 100, '{"type":"expedition_count","count":10}'),
('debris_collector_5', 'Сборщик мусора',     'Найдите 5 объектов космического мусора', 200, 40, '{"type":"find_count","find_type":"debris","count":5}'),
('artifact_hunter',    'Охотник за артефактами', 'Найдите 3 артефакта',              400, 80,  '{"type":"find_count","find_type":"artifact","count":3}'),
('creature_tamer',     'Укротитель',         'Найдите 3 существа',                   400, 80,  '{"type":"find_count","find_type":"creature","count":3}'),
('anomaly_specialist', 'Специалист по аномалиям', 'Найдите 2 аномалии',             600, 120, '{"type":"find_count","find_type":"anomaly","count":2}'),
('first_legendary',    'Легенда',            'Найдите легендарный объект',           1000, 200, '{"type":"rarity_find","rarity":"legendary","count":1}'),
('first_mythical',     'Мифический искатель', 'Найдите мифический объект',          5000, 1000,'{"type":"rarity_find","rarity":"mythical","count":1}'),
('rich_100k',          'Состоятельный',      'Накопите 100 000 кредитов',            2000, 500, '{"type":"credits_total","amount":100000}'),
('level_5',            'Опытный пилот',      'Достигните 5 уровня',                  500, 0,   '{"type":"level","level":5}'),
('level_10',           'Ветеран',            'Достигните 10 уровня',                2000, 0,   '{"type":"level","level":10}'),
('level_20',           'Легенда галактики',  'Достигните 20 уровня',               10000, 0,   '{"type":"level","level":20}');

-- ============================================================
-- GLOBAL EVENTS
-- ============================================================

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
