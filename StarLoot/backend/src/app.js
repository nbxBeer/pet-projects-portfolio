'use strict';

require('dotenv').config();

const Fastify = require('fastify');
const cors = require('@fastify/cors');
const helmet = require('@fastify/helmet');
const rateLimit = require('@fastify/rate-limit');
const path = require('path');

const logger = require('./utils/logger');
const { routes, adminRoutes, registerErrorHandler } = require('./routes/index');
const ConfigManager = require('./config/configManager');
const db = require('./db/pool');
const { seedAchievements, seedDrillsAndCollectibles } = require('./db/seeds');
const ExpeditionService = require('./services/expeditionService');
const { UserService, UpgradeService } = require('./services/userService');
const StarsWalletService = require('./services/starsWalletService');
const NftNotificationService = require('./services/nftNotificationService');
const BuffService = require('./services/buffService');
const AchievementService = require('./services/achievementService');
const EventService = require('./services/eventService');
const TournamentService = require('./services/tournamentService');
const { CustomizationService } = require('./services/customizationService');
const tournamentRoutes = require('./routes/tournamentRoutes');
const ReferralService = require('./services/referralService');
const referralRoutes = require('./routes/referralRoutes');
const QuestService = require('./services/questService');
const questRoutes = require('./routes/questRoutes');
const NewsService = require('./services/newsService');
const MiniTournamentService = require('./services/miniTournamentService');
const DrillService = require('./services/drillService');
const drillRoutes = require('./routes/drillRoutes');
const StoryService = require('./services/storyService');
const StoryDialogService = require('./services/storyDialogService');
const storyRoutes = require('./routes/storyRoutes');
const ExhibitionService = require('./services/exhibitionService');
const exhibitionRoutes = require('./routes/exhibitionRoutes');
const UniverseService = require('./services/universeService');
const universeRoutes = require('./routes/universeRoutes');
const PrestigeService = require('./services/prestigeService');
const prestigeRoutes = require('./routes/prestigeRoutes');
const ChatExpeditionService = require('./services/chatExpeditionService');
const BlitzExpeditionService = require('./services/blitzExpeditionService');
const bot = require('./bot/telegramBot');
const { cleanupNonces } = require('./middleware/telegramAuth');

/**
 * Run idempotent DB migrations on startup.
 * All statements must be safe to re-run (IF NOT EXISTS / ON CONFLICT).
 */
async function runMigrations() {
  // Add new enum values — ALTER TYPE … ADD VALUE is idempotent with IF NOT EXISTS (Postgres 9.3+)
  const migrations = [
    "ALTER TYPE module_type_enum ADD VALUE IF NOT EXISTS 'capsule'",
    "ALTER TYPE find_type_enum   ADD VALUE IF NOT EXISTS 'scrap'",
    "ALTER TYPE find_type_enum   ADD VALUE IF NOT EXISTS 'collectible'",
    "ALTER TYPE inventory_status_enum ADD VALUE IF NOT EXISTS 'mined_out'",
    "ALTER TYPE transaction_type_enum ADD VALUE IF NOT EXISTS 'spend_buff_credits'",
    "ALTER TYPE transaction_type_enum ADD VALUE IF NOT EXISTS 'drill_collect'",
    "ALTER TYPE transaction_type_enum ADD VALUE IF NOT EXISTS 'collectible_sell'",
    "ALTER TYPE transaction_type_enum ADD VALUE IF NOT EXISTS 'collection_reward'",
    `CREATE TABLE IF NOT EXISTS user_active_buffs (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      buff_type VARCHAR(50) NOT NULL,
      expires_at TIMESTAMPTZ,
      uses_remaining INT,
      metadata JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, buff_type)
    )`,
    "CREATE INDEX IF NOT EXISTS idx_active_buffs_user ON user_active_buffs(user_id)",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS expedition_cooldown_until TIMESTAMPTZ",
    "ALTER TABLE expeditions ADD COLUMN IF NOT EXISTS pirate_pending_data JSONB",
    // Pirate stats counters
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS pirate_encounters    INT NOT NULL DEFAULT 0",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS pirate_fight_wins    INT NOT NULL DEFAULT 0",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS pirate_fight_losses  INT NOT NULL DEFAULT 0",
    // Achievement selection
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS selected_achievement_id VARCHAR(100) REFERENCES achievement_definitions(id) ON DELETE SET NULL",
    // Icon column on achievement_definitions (may be missing on old DBs)
    "ALTER TABLE achievement_definitions ADD COLUMN IF NOT EXISTS icon VARCHAR(100)",
    // Global events table
    `CREATE TABLE IF NOT EXISTS global_events (
      id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      title       VARCHAR(255) NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      icon        VARCHAR(20) NOT NULL DEFAULT '🎉',
      type        VARCHAR(50) NOT NULL DEFAULT 'custom',
      multiplier  DECIMAL(6,3) NOT NULL DEFAULT 1.0,
      is_active   BOOLEAN NOT NULL DEFAULT true,
      starts_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ends_at     TIMESTAMPTZ NOT NULL,
      created_by  VARCHAR(100),
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    "CREATE INDEX IF NOT EXISTS idx_global_events_active ON global_events(is_active, ends_at) WHERE is_active = true",
    // Effects array column (replaces single type/multiplier)
    "ALTER TABLE global_events ADD COLUMN IF NOT EXISTS effects JSONB NOT NULL DEFAULT '[]'",
    // Snapshot of event effects at expedition start time
    "ALTER TABLE expeditions ADD COLUMN IF NOT EXISTS event_snapshot JSONB NOT NULL DEFAULT '[]'",
    // DB-level uniqueness on Telegram charge ID — prevents duplicate credits if the
    // application-level idempotency check races on two simultaneous webhooks (L1 fix).
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_stars_tx_charge_id ON stars_transactions(telegram_payment_charge_id) WHERE telegram_payment_charge_id IS NOT NULL",
    // Tournaments system
    `CREATE TABLE IF NOT EXISTS tournaments (
      id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      title            VARCHAR(255) NOT NULL,
      description      TEXT NOT NULL DEFAULT '',
      icon             VARCHAR(20) NOT NULL DEFAULT '🏆',
      scoring_type     VARCHAR(50) NOT NULL DEFAULT 'xp_earned',
      prize_description TEXT NOT NULL DEFAULT '',
      is_active        BOOLEAN NOT NULL DEFAULT true,
      starts_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ends_at          TIMESTAMPTZ NOT NULL,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    "CREATE INDEX IF NOT EXISTS idx_tournaments_active ON tournaments(is_active, ends_at) WHERE is_active = true",
    `CREATE TABLE IF NOT EXISTS tournament_scores (
      id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      tournament_id  UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
      user_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      baseline_value BIGINT NOT NULL DEFAULT 0,
      current_value  BIGINT NOT NULL DEFAULT 0,
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (tournament_id, user_id)
    )`,
    // Ensure scoring_type exists (table may have been created before this column was added)
    "ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS scoring_type VARCHAR(50) NOT NULL DEFAULT 'xp_earned'",
    "ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS xp_baseline_initialized BOOLEAN NOT NULL DEFAULT false",
    // Columns required by admin-panel (metric-based + baseline/current scoring)
    "ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS metric VARCHAR(50)",
    "ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS top_rewards JSONB NOT NULL DEFAULT '[]'",
    // Ensure tournament_scores has all needed columns (production may differ)
    "ALTER TABLE tournament_scores ADD COLUMN IF NOT EXISTS baseline_value BIGINT NOT NULL DEFAULT 0",
    "ALTER TABLE tournament_scores ADD COLUMN IF NOT EXISTS current_value BIGINT NOT NULL DEFAULT 0",
    // user_name_decorations table for customization
    `CREATE TABLE IF NOT EXISTS user_name_decorations (
      id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      decor_id  VARCHAR(100) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, decor_id)
    )`,
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS header_color VARCHAR(50) DEFAULT 'blue'",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_id VARCHAR(50) DEFAULT 'astronaut'",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS active_decor_id VARCHAR(100)",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_supporter BOOLEAN NOT NULL DEFAULT false",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS total_stars_spent BIGINT NOT NULL DEFAULT 0",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS zone_glow VARCHAR(50) DEFAULT NULL",

    // ─── Referral system ─────────────────────────────────────────────────────
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by BIGINT REFERENCES users(id) ON DELETE SET NULL",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_activated BOOLEAN NOT NULL DEFAULT false",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_activated_at TIMESTAMPTZ",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_reward_pending_until TIMESTAMPTZ",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_reward_claimed BOOLEAN NOT NULL DEFAULT false",

    `CREATE TABLE IF NOT EXISTS referral_earnings (
      id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      referrer_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      referral_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      currency       VARCHAR(20) NOT NULL DEFAULT 'credits',
      amount         BIGINT NOT NULL,
      source_amount  BIGINT NOT NULL DEFAULT 0,
      source_type    VARCHAR(50) NOT NULL,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    "CREATE INDEX IF NOT EXISTS idx_ref_earnings_referrer ON referral_earnings(referrer_id, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_ref_earnings_day ON referral_earnings(referrer_id, currency, created_at)",

    `CREATE TABLE IF NOT EXISTS referral_daily_totals (
      id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      day            DATE NOT NULL DEFAULT CURRENT_DATE,
      credits_earned BIGINT NOT NULL DEFAULT 0,
      stars_earned   BIGINT NOT NULL DEFAULT 0,
      UNIQUE(user_id, day)
    )`,
    "CREATE INDEX IF NOT EXISTS idx_ref_daily_user ON referral_daily_totals(user_id, day)",

    `CREATE TABLE IF NOT EXISTS referral_milestones (
      id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      milestone_count INT NOT NULL,
      reward_stars   INT NOT NULL,
      claimed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, milestone_count)
    )`,

    // Add transaction type for referral
    "ALTER TYPE transaction_type_enum ADD VALUE IF NOT EXISTS 'referral_bonus'",
    "ALTER TYPE transaction_type_enum ADD VALUE IF NOT EXISTS 'referral_activation'",
    "ALTER TYPE stars_transaction_type_enum ADD VALUE IF NOT EXISTS 'referral_milestone'",
    "ALTER TYPE stars_transaction_type_enum ADD VALUE IF NOT EXISTS 'referral_passive'",

    // ─── Quest & Faction system ────────────────────────────────────────────
    "ALTER TYPE transaction_type_enum ADD VALUE IF NOT EXISTS 'quest_reward'",
    "ALTER TYPE transaction_type_enum ADD VALUE IF NOT EXISTS 'quest_buyout'",
    "ALTER TYPE transaction_type_enum ADD VALUE IF NOT EXISTS 'smuggler_exchange'",
    "ALTER TYPE stars_transaction_type_enum ADD VALUE IF NOT EXISTS 'quest_reward'",

    `CREATE TABLE IF NOT EXISTS user_faction_reputation (
      id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      faction_id  VARCHAR(50) NOT NULL,
      reputation  INT NOT NULL DEFAULT 0,
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, faction_id)
    )`,
    "CREATE INDEX IF NOT EXISTS idx_faction_rep_user ON user_faction_reputation(user_id)",

    `CREATE TABLE IF NOT EXISTS user_quests (
      id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      quest_type     VARCHAR(20) NOT NULL,
      template_id    VARCHAR(100) NOT NULL,
      faction_id     VARCHAR(50) NOT NULL,
      quest_data     JSONB NOT NULL DEFAULT '{}',
      target_amount  INT NOT NULL DEFAULT 1,
      progress       INT NOT NULL DEFAULT 0,
      status         VARCHAR(20) NOT NULL DEFAULT 'active',
      free_rerolls   INT NOT NULL DEFAULT 0,
      bought_out     BOOLEAN NOT NULL DEFAULT false,
      bought_out_at  TIMESTAMPTZ,
      claimed_at     TIMESTAMPTZ,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    "CREATE INDEX IF NOT EXISTS idx_user_quests_user ON user_quests(user_id, status)",

    `CREATE TABLE IF NOT EXISTS user_quest_refresh (
      id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      quest_type   VARCHAR(20) NOT NULL,
      last_refresh TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, quest_type)
    )`,

    `CREATE TABLE IF NOT EXISTS user_quest_items (
      id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      item_id   VARCHAR(100) NOT NULL,
      item_data JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, item_id)
    )`,

    `CREATE TABLE IF NOT EXISTS smuggler_exchanges (
      id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      credits_spent BIGINT NOT NULL,
      stars         INT NOT NULL DEFAULT 1,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    "CREATE INDEX IF NOT EXISTS idx_smuggler_user ON smuggler_exchanges(user_id, created_at)",

    // ─── Story dialog progress ─────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS user_story_dialog_progress (
      user_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      dialog_id VARCHAR(100) NOT NULL,
      seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, dialog_id)
    )`,

    // Start link analytics for tracking /start deep-link sources
    `CREATE TABLE IF NOT EXISTS start_link_analytics (
      source VARCHAR(100) PRIMARY KEY,
      starts_count INT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    // Extra columns for tracking link management
    "ALTER TABLE start_link_analytics ADD COLUMN IF NOT EXISTS label VARCHAR(255) NOT NULL DEFAULT ''",
    "ALTER TABLE start_link_analytics ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()",
    "ALTER TABLE start_link_analytics ADD COLUMN IF NOT EXISTS last_start_at TIMESTAMPTZ",
    "ALTER TABLE start_link_analytics ADD COLUMN IF NOT EXISTS unique_users INT NOT NULL DEFAULT 0",
    // Per-user start events for detailed analytics
    `CREATE TABLE IF NOT EXISTS link_start_events (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      source VARCHAR(100) NOT NULL,
      user_id BIGINT NOT NULL,
      is_new_user BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    "CREATE INDEX IF NOT EXISTS idx_link_events_source ON link_start_events(source, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_link_events_user ON link_start_events(user_id)",

    // ─── NFT notifications queue ────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS nft_notifications (
      id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      username        VARCHAR(255),
      first_name      VARCHAR(255),
      expedition_id   UUID REFERENCES expeditions(id),
      result_id       UUID REFERENCES expedition_results(id),
      outcome_type    VARCHAR(50) NOT NULL,
      outcome_label   VARCHAR(100),
      admin_notified  BOOLEAN NOT NULL DEFAULT false,
      admin_processed BOOLEAN NOT NULL DEFAULT false,
      processed_at    TIMESTAMPTZ,
      admin_note      TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    "CREATE INDEX IF NOT EXISTS idx_nft_notif_unprocessed ON nft_notifications(admin_processed, created_at) WHERE admin_processed = false",

    // ─── Leaderboard visibility ─────────────────────────────────────────────
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS hidden_from_leaderboards BOOLEAN NOT NULL DEFAULT false",

    // ─── Pending referrer (backup delivery from bot /start deep link) ──────
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_referrer_id BIGINT",

    // ─── Game News (dynamic news banner) ────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS game_news (
      id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      title_ru        VARCHAR(255) NOT NULL DEFAULT '',
      title_en        VARCHAR(255) NOT NULL DEFAULT '',
      description_ru  TEXT NOT NULL DEFAULT '',
      description_en  TEXT NOT NULL DEFAULT '',
      icon            VARCHAR(20) NOT NULL DEFAULT '📰',
      is_visible      BOOLEAN NOT NULL DEFAULT false,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,

    // ─── Telegram channel membership cache ──────────────────────────────────
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_channel_member BOOLEAN NOT NULL DEFAULT false",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS channel_member_checked_at TIMESTAMPTZ",

    // ─── Long expeditions & story quests ────────────────────────────────────
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS total_speedups INT NOT NULL DEFAULT 0",
    "ALTER TABLE expeditions ADD COLUMN IF NOT EXISTS is_long_expedition BOOLEAN NOT NULL DEFAULT false",
    `CREATE TABLE IF NOT EXISTS user_story_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      item_key VARCHAR(100) NOT NULL,
      item_data JSONB DEFAULT '{}',
      obtained_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, item_key)
    )`,
    "CREATE INDEX IF NOT EXISTS idx_user_story_items_user ON user_story_items(user_id)",

    // ─── Second Universe (U2) system ──────────────────────────────────────
    // U2/story enum values for expedition_results/inventory_items
    "ALTER TYPE rarity_enum ADD VALUE IF NOT EXISTS 'exotic'",
    "ALTER TYPE rarity_enum ADD VALUE IF NOT EXISTS 'ancient'",
    "ALTER TYPE rarity_enum ADD VALUE IF NOT EXISTS 'relic'",
    "ALTER TYPE rarity_enum ADD VALUE IF NOT EXISTS 'hybrid'",
    "ALTER TYPE rarity_enum ADD VALUE IF NOT EXISTS 'singularity'",
    "ALTER TYPE find_type_enum ADD VALUE IF NOT EXISTS 'story_item'",
    "ALTER TYPE find_type_enum ADD VALUE IF NOT EXISTS 'echo'",
    "ALTER TYPE find_type_enum ADD VALUE IF NOT EXISTS 'relic'",
    "ALTER TYPE find_type_enum ADD VALUE IF NOT EXISTS 'entity'",
    "ALTER TYPE find_type_enum ADD VALUE IF NOT EXISTS 'rift'",

    "ALTER TABLE users ADD COLUMN IF NOT EXISTS current_universe INT NOT NULL DEFAULT 1",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS crystals BIGINT NOT NULL DEFAULT 0",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS universe_travel_until TIMESTAMPTZ",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS drill_slots_unlocked INT NOT NULL DEFAULT 1",
    "ALTER TABLE expeditions ADD COLUMN IF NOT EXISTS universe INT NOT NULL DEFAULT 1",
    `CREATE TABLE IF NOT EXISTS crystal_transactions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type VARCHAR(50) NOT NULL,
      amount INT NOT NULL,
      balance_before BIGINT NOT NULL DEFAULT 0,
      balance_after BIGINT NOT NULL DEFAULT 0,
      reference_id UUID,
      description TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    "CREATE INDEX IF NOT EXISTS idx_crystal_tx_user ON crystal_transactions(user_id, created_at DESC)",

    // ─── Drills system ─────────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS drill_types (
      id VARCHAR(50) PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      name_en VARCHAR(100) NOT NULL,
      base_yield_per_cycle INT NOT NULL DEFAULT 8,
      cycle_duration_seconds INT NOT NULL DEFAULT 1800,
      base_storage_limit INT NOT NULL DEFAULT 200,
      base_fossil_chance NUMERIC(5,4) NOT NULL DEFAULT 0.0150,
      cost_credits INT,
      cost_stars INT,
      icon VARCHAR(10) DEFAULT '⛏️'
    )`,
    `CREATE TABLE IF NOT EXISTS user_drills (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id BIGINT NOT NULL REFERENCES users(id),
      drill_type_id VARCHAR(50) NOT NULL REFERENCES drill_types(id),
      level INT NOT NULL DEFAULT 1,
      balance INT NOT NULL DEFAULT 0,
      last_cycle_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      assigned_asteroid_item_id UUID,
      asteroid_total_volume INT,
      asteroid_remaining_volume INT,
      asteroid_value_per_ton INT,
      asteroid_resource_type VARCHAR(50),
      asteroid_condition NUMERIC(5,2),
      slot_index INT NOT NULL DEFAULT 1,
      upgrade_yield_level INT NOT NULL DEFAULT 0,
      upgrade_fossil_level INT NOT NULL DEFAULT 0,
      upgrade_value_level INT NOT NULL DEFAULT 0,
      upgrade_storage_level INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    "ALTER TABLE user_drills ADD COLUMN IF NOT EXISTS assigned_asteroid_item_id UUID",
    "ALTER TABLE user_drills ADD COLUMN IF NOT EXISTS asteroid_total_volume INT",
    "ALTER TABLE user_drills ADD COLUMN IF NOT EXISTS asteroid_remaining_volume INT",
    "ALTER TABLE user_drills ADD COLUMN IF NOT EXISTS asteroid_value_per_ton INT",
    "ALTER TABLE user_drills ADD COLUMN IF NOT EXISTS asteroid_resource_type VARCHAR(50)",
    "ALTER TABLE user_drills ADD COLUMN IF NOT EXISTS asteroid_condition NUMERIC(5,2)",
    "ALTER TABLE user_drills ADD COLUMN IF NOT EXISTS slot_index INT NOT NULL DEFAULT 1",
    "ALTER TABLE user_drills ADD COLUMN IF NOT EXISTS upgrade_yield_level INT NOT NULL DEFAULT 0",
    "ALTER TABLE user_drills ADD COLUMN IF NOT EXISTS upgrade_fossil_level INT NOT NULL DEFAULT 0",
    "ALTER TABLE user_drills ADD COLUMN IF NOT EXISTS upgrade_value_level INT NOT NULL DEFAULT 0",
    "ALTER TABLE user_drills ADD COLUMN IF NOT EXISTS upgrade_storage_level INT NOT NULL DEFAULT 0",
    // Support fractional asteroid volumes for small asteroids (e.g., 0.16 tons, 115.712 tons)
    "ALTER TABLE user_drills ALTER COLUMN asteroid_total_volume TYPE NUMERIC(10,3)",
    "ALTER TABLE user_drills ALTER COLUMN asteroid_remaining_volume TYPE NUMERIC(10,3)",
    `WITH ranked_slots AS (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at, id) AS rn
      FROM user_drills
    )
    UPDATE user_drills d
    SET slot_index = r.rn
    FROM ranked_slots r
    WHERE d.id = r.id
      AND COALESCE(d.slot_index, 0) <> r.rn`,
    "CREATE INDEX IF NOT EXISTS idx_user_drills_user ON user_drills(user_id)",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_user_drills_user_slot_unique ON user_drills(user_id, slot_index)",

    // ─── Collectibles & Collections ────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS collectible_templates (
      id VARCHAR(50) PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      name_en VARCHAR(100) NOT NULL,
      rarity VARCHAR(20) NOT NULL DEFAULT 'common',
      sell_price INT NOT NULL DEFAULT 15,
      icon VARCHAR(10) DEFAULT '🪨',
      description TEXT,
      description_en TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS collections (
      id VARCHAR(50) PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      name_en VARCHAR(100) NOT NULL,
      description TEXT,
      description_en TEXT,
      reward_credits INT DEFAULT 0,
      reward_xp INT DEFAULT 0,
      reward_item_id VARCHAR(50),
      icon VARCHAR(10) DEFAULT '📋'
    )`,
    `CREATE TABLE IF NOT EXISTS collection_requirements (
      collection_id VARCHAR(50) NOT NULL REFERENCES collections(id),
      collectible_id VARCHAR(50) NOT NULL REFERENCES collectible_templates(id),
      quantity INT NOT NULL DEFAULT 1,
      PRIMARY KEY (collection_id, collectible_id)
    )`,
    `CREATE TABLE IF NOT EXISTS user_collections (
      user_id BIGINT NOT NULL REFERENCES users(id),
      collection_id VARCHAR(50) NOT NULL REFERENCES collections(id),
      completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, collection_id)
    )`,

    // ─── Mini Tournament progress ────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS mini_tournament_progress (
      user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      expeditions_count INT NOT NULL DEFAULT 0,
      gifts_issued INT NOT NULL DEFAULT 0,
      gifts_pending INT NOT NULL DEFAULT 0,
      last_notified_milestone INT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,

    // ─── Exhibition system ────────────────────────────────────────────────
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'on_exhibition'
                      AND enumtypid = 'inventory_status_enum'::regtype) THEN
         ALTER TYPE inventory_status_enum ADD VALUE 'on_exhibition';
       END IF;
     END $$`,
    "ALTER TABLE inventory_items ADD COLUMN IF NOT EXISTS viewer_sympathy INT DEFAULT NULL",
    `CREATE TABLE IF NOT EXISTS user_exhibitions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      inventory_item_id UUID NOT NULL,
      item_snapshot JSONB NOT NULL DEFAULT '{}',
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ends_at TIMESTAMPTZ NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      sympathy_percent INT NOT NULL DEFAULT 0,
      credits_earned INT NOT NULL DEFAULT 0,
      sympathy_multiplier NUMERIC(6,3) NOT NULL DEFAULT 1.0,
      price_multiplier NUMERIC(6,3) NOT NULL DEFAULT 1.0
    )`,
    "CREATE INDEX IF NOT EXISTS idx_user_exhibitions_user ON user_exhibitions(user_id, status)",

    // ── Hidden achievements ────────────────────────────────────────────────
    "ALTER TABLE achievement_definitions ADD COLUMN IF NOT EXISTS is_hidden BOOLEAN NOT NULL DEFAULT false",

    // ── Prestige system ────────────────────────────────────────────────────
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS prestige_level INTEGER NOT NULL DEFAULT 0",
    `CREATE TABLE IF NOT EXISTS user_prestiges (
      id           SERIAL PRIMARY KEY,
      user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      prestige_level INTEGER NOT NULL,
      achieved_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      snapshot     JSONB
    )`,
    "CREATE INDEX IF NOT EXISTS idx_user_prestiges_user ON user_prestiges(user_id)",

    // ─── Blitz Raid system ────────────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS blitz_sessions (
      id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id                BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      zone_id                VARCHAR(100) NOT NULL,
      status                 VARCHAR(20) NOT NULL DEFAULT 'active',
      accumulated_items      JSONB NOT NULL DEFAULT '[]',
      swipe_count            INT NOT NULL DEFAULT 0,
      next_card_data         JSONB,
      has_stabilizer         BOOLEAN NOT NULL DEFAULT false,
      stabilizer_swipes_used INT NOT NULL DEFAULT 0,
      created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ended_at               TIMESTAMPTZ,
      cooldown_until         TIMESTAMPTZ
    )`,
    "ALTER TABLE blitz_sessions ADD COLUMN IF NOT EXISTS payout_claimed BOOLEAN NOT NULL DEFAULT false",
    `CREATE INDEX IF NOT EXISTS idx_blitz_sessions_user ON blitz_sessions(user_id, status)`,

    // ─── IDS: Security event log ──────────────────────────────────────────────
    `CREATE TABLE IF NOT EXISTS security_events (
      id         BIGSERIAL PRIMARY KEY,
      user_id    BIGINT REFERENCES users(id) ON DELETE SET NULL,
      event_type VARCHAR(100) NOT NULL,
      metadata   JSONB NOT NULL DEFAULT '{}',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_security_events_user ON security_events(user_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_security_events_type ON security_events(event_type, created_at DESC)`,

    // ── Chat expedition / registration source tracking ─────────────────────
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS registration_chat_id BIGINT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS registration_chat_title VARCHAR(255)",
    // source type: 'organic', 'group_chat', 'ads_link', 'referral'
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS registration_source_type VARCHAR(50)",

    // Groups for chat owners to bundle multiple chats together
    `CREATE TABLE IF NOT EXISTS chat_source_groups (
      id             UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
      owner_user_id  BIGINT      REFERENCES users(id) ON DELETE CASCADE,
      name           VARCHAR(255) NOT NULL,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    "CREATE INDEX IF NOT EXISTS idx_chat_source_groups_owner ON chat_source_groups(owner_user_id)",

    // Known group chats that have produced registrations
    `CREATE TABLE IF NOT EXISTS chat_sources (
      id            UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
      chat_id       BIGINT      NOT NULL UNIQUE,
      chat_title    VARCHAR(255),
      owner_user_id BIGINT      REFERENCES users(id) ON DELETE SET NULL,
      group_id      UUID        REFERENCES chat_source_groups(id) ON DELETE SET NULL,
      link_code     VARCHAR(64) UNIQUE,
      owner_share_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
      stars_total_received BIGINT NOT NULL DEFAULT 0,
      stars_since_clear BIGINT NOT NULL DEFAULT 0,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    "CREATE INDEX IF NOT EXISTS idx_chat_sources_owner ON chat_sources(owner_user_id)",
    "CREATE INDEX IF NOT EXISTS idx_chat_sources_group ON chat_sources(group_id)",
    "CREATE INDEX IF NOT EXISTS idx_users_reg_chat ON users(registration_chat_id) WHERE registration_chat_id IS NOT NULL",

    // ─── Chat link analytics ─────────────────────────────────────────────
    "ALTER TABLE chat_sources ADD COLUMN IF NOT EXISTS link_code VARCHAR(64)",
    "ALTER TABLE chat_sources ADD COLUMN IF NOT EXISTS owner_user_id BIGINT",
    "ALTER TABLE chat_sources ADD COLUMN IF NOT EXISTS owner_username VARCHAR(255)",
    "ALTER TABLE chat_sources ADD COLUMN IF NOT EXISTS chat_title VARCHAR(255)",
    "ALTER TABLE chat_sources ADD COLUMN IF NOT EXISTS chat_auto_delete_low_rarity BOOLEAN NOT NULL DEFAULT false",
    "ALTER TABLE chat_sources ADD COLUMN IF NOT EXISTS stars_total_received BIGINT NOT NULL DEFAULT 0",
    "ALTER TABLE chat_sources ADD COLUMN IF NOT EXISTS stars_since_clear BIGINT NOT NULL DEFAULT 0",
    "CREATE INDEX IF NOT EXISTS idx_chat_sources_link_code ON chat_sources(link_code)",
    `CREATE TABLE IF NOT EXISTS start_link_analytics (
      source           VARCHAR(100) PRIMARY KEY,
      starts_count     INT NOT NULL DEFAULT 1,
      unique_users     INT NOT NULL DEFAULT 1,
      last_start_at    TIMESTAMPTZ,
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS link_start_events (
      id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      source           VARCHAR(100) NOT NULL,
      user_id          BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      is_new_user      BOOLEAN NOT NULL DEFAULT false,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
    "CREATE INDEX IF NOT EXISTS idx_link_start_events_source ON link_start_events(source)",
    "CREATE INDEX IF NOT EXISTS idx_link_start_events_user ON link_start_events(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_link_start_events_created ON link_start_events(created_at)",
  ];
  for (const sql of migrations) {
    try {
      await db.query(sql);
      logger.info(`Migration OK: ${sql}`);
    } catch (err) {
      logger.warn({ err, sql }, 'Migration skipped or failed');
    }
  }
}

async function buildApp() {
  const app = Fastify({ logger: false, trustProxy: true, bodyLimit: 10 * 1024 * 1024 });

  // Run DB migrations before accepting traffic
  await runMigrations();
  await seedAchievements();
  await seedDrillsAndCollectibles();
  // Disable helmet's contentSecurityPolicy (we control CSP) and frameguard
  // because embedding policy is handled explicitly below when enabled.
  await app.register(helmet, { contentSecurityPolicy: false, frameguard: false });

  // CORS: restricted to explicit origins (M3 fix).
  // In production the frontend is served from the same origin so CORS is not needed.
  // Set CORS_ORIGIN=http://localhost:5173 in .env for local development.
  let corsOrigin = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',').map((s) => s.trim())
    : false;
  // If TELEGRAM_WEB_SUPPORT enabled, allow Telegram Web origin for CORS
  if (process.env.TELEGRAM_WEB_SUPPORT === '1') {
    if (!corsOrigin) {
      // allow explicit origins list when CORS_ORIGIN not set
      corsOrigin = [];
    }
    // ensure web.telegram.org and related subdomains are allowed
    const telegramOrigins = ['https://web.telegram.org', 'https://telegram.org', 'https://t.me'];
    for (const o of telegramOrigins) {
      if (!corsOrigin.includes(o)) corsOrigin.push(o);
    }
  }
  await app.register(cors, {
    origin: corsOrigin,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'X-Telegram-Init-Data'],
  });

  // If enabled, explicitly set Content-Security-Policy frame-ancestors
  // to permit embedding in Telegram Web (runs inside iframe). We use a
  // hook so responses from static files and API endpoints include it.
  if (process.env.TELEGRAM_WEB_SUPPORT === '1') {
    const frameAncestors = "'self' https://web.telegram.org https://*.telegram.org";
    app.addHook('onSend', async (req, reply, payload) => {
      // Set CSP frame-ancestors — safe to overwrite for embed support.
      reply.header('Content-Security-Policy', `frame-ancestors ${frameAncestors}`);
      // Also remove X-Frame-Options if present (some proxies add it).
      if (typeof reply.removeHeader === 'function') reply.removeHeader('X-Frame-Options');
      return payload;
    });
  }

  await app.register(rateLimit, {
    global: true,
    max: 200,
    timeWindow: '1 minute',
    keyGenerator: (req) => req.user?.id?.toString() || req.ip,
    errorResponseBuilder: () => ({ error: 'Too many requests', retryAfter: 30 }),
  });

  // Статика фронтенда
  const frontendPath = path.join(__dirname, '../../frontend/dist');
  await app.register(require('@fastify/static'), {
    root: frontendPath,
    prefix: '/',
    decorateReply: true,
    setHeaders: (res, filePath) => {
      const normalizedPath = filePath.replace(/\\/g, '/');
      if (normalizedPath.endsWith('/index.html') || normalizedPath.endsWith('/version.json')) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        return;
      }

      if (/\/assets\/.+\.(?:js|css)$/.test(normalizedPath)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  });

  // Health check
  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  // Public bot info (no auth — used by frontend to build support links)
  app.get('/api/bot-info', async () => ({
    botUsername: bot.getBotUsername() || null,
  }));

  // Config & Services
  const configManager = new ConfigManager(db);
  await configManager.load();
  configManager.startAutoReload(60000);
  app.decorate('gameConfig', configManager);

  const starsWalletService = new StarsWalletService(configManager, bot);
  const nftNotificationService = new NftNotificationService(bot);
  const buffService = new BuffService(configManager);
  const achievementService = new AchievementService(configManager);
  const eventService = new EventService();
  const tournamentService = new TournamentService();
  const referralService = new ReferralService(configManager);
  const questService = new QuestService(configManager);
  const customizationService = new CustomizationService();
  const newsService = new NewsService();
  const miniTournamentService = new MiniTournamentService({ bot });
  const expeditionService = new ExpeditionService(configManager, nftNotificationService, buffService, eventService, tournamentService, miniTournamentService);
  // Inject referralService for passive income hooks
  expeditionService.referralService = referralService;
  // Inject bot for channel membership check
  expeditionService.bot = bot;
  const userService = new UserService(configManager);
  const upgradeService = new UpgradeService(configManager);
  const drillService = new DrillService(configManager);
  const storyService = new StoryService(configManager);
  const storyDialogService = new StoryDialogService();
  const exhibitionService = new ExhibitionService(configManager);
  const universeService = new UniverseService(configManager);
  const prestigeService = new PrestigeService(nftNotificationService, achievementService);

  // Inject referralService into starsWalletService for passive income on topups
  starsWalletService.referralService = referralService;
  // Inject questService for progress tracking
  expeditionService.questService = questService;

  const blitzExpeditionService = new BlitzExpeditionService(configManager, buffService);

  const chatExpeditionService = new ChatExpeditionService(expeditionService, configManager);
  bot.injectServices({ starsWalletService, nftNotificationService, miniTournamentService, chatExpeditionService, expeditionService });

  // API Routes (Telegram auth required)
  await app.register(async (instance) => {
    await routes(instance, { expeditionService, userService, upgradeService, starsWalletService, nftNotificationService, buffService, achievementService, eventService, customizationService, referralService, questService, newsService, miniTournamentService, bot, blitzExpeditionService });
    await tournamentRoutes(instance, { tournamentService });
    await referralRoutes(instance, { referralService });
    await questRoutes(instance, { questService, storyDialogService });
    await drillRoutes(instance, { drillService });
    await storyRoutes(instance, { storyService, storyDialogService });
    await exhibitionRoutes(instance, { exhibitionService });
    await universeRoutes(instance, { universeService });
    await prestigeRoutes(instance, { prestigeService });
  });

  // Admin API routes (no Telegram auth, X-Admin-Secret header required)
  await adminRoutes(app, { nftNotificationService, userService, eventService, tournamentService, bot, starsWalletService, configManager, questService, newsService, prestigeService });

  // Bot webhook
  app.post('/bot-webhook', {
    preHandler: async (req, reply) => {
      // Timing-safe comparison to prevent webhook secret enumeration (H2 fix)
      const token    = req.headers['x-telegram-bot-api-secret-token'] || '';
      const expected = process.env.BOT_WEBHOOK_SECRET || '';
      if (!token || !expected) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      const tokenBuf    = Buffer.from(token);
      const expectedBuf = Buffer.from(expected);
      const valid = tokenBuf.length === expectedBuf.length &&
        require('crypto').timingSafeEqual(tokenBuf, expectedBuf);
      if (!valid) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
    },
  }, async (req, reply) => {
    bot.processUpdate(req.body);
    return reply.send({ ok: true });
  });

  // SPA fallback
  app.setNotFoundHandler(async (req, reply) => {
    return reply.sendFile('index.html');
  });

  registerErrorHandler(app);
  setInterval(cleanupNonces, 5 * 60 * 1000);
  // Daily reputation decay — run every 6 hours (idempotent)
  setInterval(() => questService.processReputationDecay().catch(() => {}), 6 * 3600 * 1000);

  return app;
}

module.exports = buildApp;
