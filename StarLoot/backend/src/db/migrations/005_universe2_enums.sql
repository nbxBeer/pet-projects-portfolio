-- Add Universe 2 and story item enum values for expedition/inventory rows.
-- Safe to run multiple times.

DO $$
BEGIN
  ALTER TYPE rarity_enum ADD VALUE IF NOT EXISTS 'exotic';
  ALTER TYPE rarity_enum ADD VALUE IF NOT EXISTS 'ancient';
  ALTER TYPE rarity_enum ADD VALUE IF NOT EXISTS 'relic';
  ALTER TYPE rarity_enum ADD VALUE IF NOT EXISTS 'hybrid';
  ALTER TYPE rarity_enum ADD VALUE IF NOT EXISTS 'singularity';

  ALTER TYPE find_type_enum ADD VALUE IF NOT EXISTS 'story_item';
  ALTER TYPE find_type_enum ADD VALUE IF NOT EXISTS 'echo';
  ALTER TYPE find_type_enum ADD VALUE IF NOT EXISTS 'relic';
  ALTER TYPE find_type_enum ADD VALUE IF NOT EXISTS 'entity';
  ALTER TYPE find_type_enum ADD VALUE IF NOT EXISTS 'rift';
END $$;
