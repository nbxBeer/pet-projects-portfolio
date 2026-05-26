-- Migration: Support fractional asteroid volumes
-- Change asteroid_total_volume and asteroid_remaining_volume from INT to NUMERIC(10,3)
-- to support small asteroids with fractional tonnage (e.g., 0.16 tons, 115.712 tons)

ALTER TABLE user_drills
  ALTER COLUMN asteroid_total_volume TYPE NUMERIC(10,3),
  ALTER COLUMN asteroid_remaining_volume TYPE NUMERIC(10,3);
