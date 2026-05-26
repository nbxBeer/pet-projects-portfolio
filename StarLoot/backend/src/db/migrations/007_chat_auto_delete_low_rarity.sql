-- Persist per-chat cleanup mode for low-rarity chat expedition messages.
ALTER TABLE chat_sources
  ADD COLUMN IF NOT EXISTS chat_auto_delete_low_rarity BOOLEAN NOT NULL DEFAULT false;
