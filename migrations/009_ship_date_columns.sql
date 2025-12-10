-- Add ship date column mappings to brand order templates
-- Allows mapping specific Excel columns to specific ship dates
-- Example: {"D": "2025-01-15", "E": "2025-02-15", "F": "2025-03-15"}

ALTER TABLE brand_order_templates
ADD COLUMN IF NOT EXISTS ship_date_columns JSONB DEFAULT '{}';

COMMENT ON COLUMN brand_order_templates.ship_date_columns IS 'JSON: Excel column letter -> ship date (e.g., {"D": "2025-01-15", "E": "2025-02-15"})';
