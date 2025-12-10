-- Brand Order Form Templates
-- Stores Excel templates for each brand with column mappings for exports

CREATE TABLE IF NOT EXISTS brand_order_templates (
    id SERIAL PRIMARY KEY,
    brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    file_path VARCHAR(500) NOT NULL,
    original_filename VARCHAR(255) NOT NULL,

    -- Column mappings: JSON object mapping field names to column letters
    -- Example: {"sku": "A", "upc": "B", "quantity": "C", "product_name": "D"}
    column_mappings JSONB NOT NULL DEFAULT '{}',

    -- The row number where data should start (1-indexed)
    -- Headers and any rows before this are preserved
    data_start_row INTEGER NOT NULL DEFAULT 2,

    -- Optional: specific sheet name to use (for multi-sheet workbooks)
    sheet_name VARCHAR(100),

    active BOOLEAN DEFAULT true,
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    -- Each brand can have multiple templates, but names must be unique per brand
    UNIQUE(brand_id, name)
);

-- Index for fast lookups by brand
CREATE INDEX IF NOT EXISTS idx_brand_order_templates_brand ON brand_order_templates(brand_id);
CREATE INDEX IF NOT EXISTS idx_brand_order_templates_active ON brand_order_templates(brand_id, active);

COMMENT ON TABLE brand_order_templates IS 'Excel templates for brand-specific order exports';
COMMENT ON COLUMN brand_order_templates.column_mappings IS 'JSON: field name -> Excel column letter (e.g., {"sku": "A", "quantity": "C"})';
COMMENT ON COLUMN brand_order_templates.data_start_row IS 'Row number where data insertion begins (preserves headers above)';
