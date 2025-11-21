-- Fix season column issue
-- The old 'season' column is VARCHAR and NOT NULL
-- We need to make it nullable since we're now using season_id

ALTER TABLE orders
ALTER COLUMN season DROP NOT NULL;

-- Optionally, we could set a default value for existing rows
UPDATE orders
SET season = 'legacy'
WHERE season IS NULL;
