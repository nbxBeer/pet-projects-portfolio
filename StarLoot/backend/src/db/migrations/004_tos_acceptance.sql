-- Add Terms of Service acceptance tracking fields to users
ALTER TABLE users ADD COLUMN IF NOT EXISTS tos_accepted BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS tos_accepted_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS tos_version INT;
