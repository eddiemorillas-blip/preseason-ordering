-- Fix catalog_uploads table columns to match backend code

-- Rename filename to file_name
ALTER TABLE catalog_uploads RENAME COLUMN filename TO file_name;

-- Rename records_processed to products_processed (if it exists)
-- Actually, we'll drop and recreate to match the backend exactly

-- Add missing columns
ALTER TABLE catalog_uploads ADD COLUMN IF NOT EXISTS products_added INTEGER DEFAULT 0;
ALTER TABLE catalog_uploads ADD COLUMN IF NOT EXISTS products_updated INTEGER DEFAULT 0;
ALTER TABLE catalog_uploads ADD COLUMN IF NOT EXISTS products_deactivated INTEGER DEFAULT 0;
ALTER TABLE catalog_uploads ADD COLUMN IF NOT EXISTS upload_status VARCHAR(50) DEFAULT 'processing';
ALTER TABLE catalog_uploads ADD COLUMN IF NOT EXISTS error_count INTEGER DEFAULT 0;

-- Drop old columns if they exist (PostgreSQL doesn't have IF EXISTS for DROP COLUMN easily)
-- We'll leave them for now to avoid errors
