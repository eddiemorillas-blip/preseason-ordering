-- Brand Form Templates Feature Migration
-- Adds tables for importing brand Excel forms into OrderAdjustment

-- Table 1: Brand Form Templates
-- Stores template configurations for parsing Excel files per brand
CREATE TABLE brand_form_templates (
  id SERIAL PRIMARY KEY,
  brand_id INTEGER REFERENCES brands(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,              -- e.g., "La Sportiva Pending Report", "Petzl Preseason Form"
  sheet_name VARCHAR(255),                 -- Which Excel sheet to use (null = first sheet)
  header_row INTEGER DEFAULT 0,            -- Row containing column headers (0-indexed)
  data_start_row INTEGER DEFAULT 1,        -- First row of data (0-indexed)
  product_id_column VARCHAR(50) NOT NULL,  -- Column letter/index for UPC/EAN/SKU (e.g., 'A', 'B', 'C')
  product_id_type VARCHAR(20) NOT NULL,    -- 'upc', 'ean', 'sku'
  location_column VARCHAR(50),             -- Optional: column for location (if form includes it)
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_brand_form_templates_brand_id ON brand_form_templates(brand_id);

-- Table 2: Form Template Quantity Columns
-- Defines which columns in the Excel contain editable quantities
CREATE TABLE form_template_quantity_columns (
  id SERIAL PRIMARY KEY,
  template_id INTEGER REFERENCES brand_form_templates(id) ON DELETE CASCADE,
  column_letter VARCHAR(10) NOT NULL,      -- Excel column (e.g., 'L', 'M', 'N')
  column_name VARCHAR(255),                -- Display name from header
  ship_date DATE,                          -- Associated ship date (nullable if dynamic per row)
  ship_date_column VARCHAR(10),            -- Or column containing ship date per row
  is_editable BOOLEAN DEFAULT true,        -- Whether this column can be edited
  column_order INTEGER,                    -- Display order in UI
  UNIQUE(template_id, column_letter)
);

CREATE INDEX idx_form_template_quantity_columns_template_id ON form_template_quantity_columns(template_id);

-- Table 3: Imported Forms
-- Tracks each Excel file imported into the system
CREATE TABLE imported_forms (
  id SERIAL PRIMARY KEY,
  template_id INTEGER REFERENCES brand_form_templates(id) ON DELETE SET NULL,
  season_id INTEGER REFERENCES seasons(id) ON DELETE CASCADE,
  brand_id INTEGER REFERENCES brands(id) ON DELETE CASCADE,  -- Denormalized for quick filtering
  original_filename VARCHAR(255) NOT NULL,
  file_data BYTEA,                         -- Store original Excel for export (can be large)
  imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  imported_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_imported_forms_season_brand ON imported_forms(season_id, brand_id);
CREATE INDEX idx_imported_forms_imported_at ON imported_forms(imported_at DESC);

-- Table 4: Form Row Mappings
-- Maps each row in the imported Excel to products in the database
CREATE TABLE form_row_mappings (
  id SERIAL PRIMARY KEY,
  form_id INTEGER REFERENCES imported_forms(id) ON DELETE CASCADE,
  excel_row INTEGER NOT NULL,              -- Row number in Excel (0-indexed)
  product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
  location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,  -- If form has location per row
  matched_by VARCHAR(50),                  -- 'upc', 'ean', 'sku' - how product was matched
  match_confidence INTEGER DEFAULT 100,    -- 100 = exact, lower = fuzzy match
  UNIQUE(form_id, excel_row)
);

CREATE INDEX idx_form_row_mappings_form_id ON form_row_mappings(form_id);
CREATE INDEX idx_form_row_mappings_product_id ON form_row_mappings(product_id);
