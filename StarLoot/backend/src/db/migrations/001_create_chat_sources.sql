-- Create chat_sources table for tracking group chats and generating shareable links
CREATE TABLE IF NOT EXISTS chat_sources (
    chat_id             BIGINT PRIMARY KEY,           -- Telegram group chat ID
    chat_title          VARCHAR(255),                 -- Chat name
    link_code           VARCHAR(50),                  -- Unique shareable link code (e.g., "a1b2c3d4e5f6")
    owner_user_id       BIGINT REFERENCES users(id) ON DELETE SET NULL, -- Chat owner
    owner_username      VARCHAR(255),                 -- Username of claimed owner (if not owner_user_id)
    stars_total_received BIGINT DEFAULT 0,            -- Total stars received from this chat
    expeditions_count   INT DEFAULT 0,                -- Total expeditions started from this chat
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensure link_code is unique for shareable links
CREATE UNIQUE INDEX idx_chat_sources_link_code ON chat_sources(link_code) WHERE link_code IS NOT NULL;
CREATE INDEX idx_chat_sources_owner ON chat_sources(owner_user_id);
CREATE INDEX idx_chat_sources_updated ON chat_sources(updated_at);
