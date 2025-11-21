-- Drop existing table if it exists (clean slate)
DROP TABLE IF EXISTS sales_data CASCADE;

-- Create sales_data table
CREATE TABLE sales_data (
  id SERIAL PRIMARY KEY,
  product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
  location_id INTEGER REFERENCES locations(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  quantity_sold INTEGER NOT NULL DEFAULT 0,

  -- Metadata
  uploaded_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  -- Optional: Store original data for reference
  original_product_name TEXT,
  notes TEXT,

  -- Prevent duplicate entries
  UNIQUE(product_id, location_id, start_date, end_date)
);

-- Create index for common queries
CREATE INDEX idx_sales_data_product ON sales_data(product_id);
CREATE INDEX idx_sales_data_location ON sales_data(location_id);
CREATE INDEX idx_sales_data_dates ON sales_data(start_date, end_date);

-- Create sales_uploads tracking table (similar to catalog_uploads)
CREATE TABLE IF NOT EXISTS sales_uploads (
  id SERIAL PRIMARY KEY,
  filename VARCHAR(255) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  location_id INTEGER REFERENCES locations(id),
  records_processed INTEGER DEFAULT 0,
  records_added INTEGER DEFAULT 0,
  records_updated INTEGER DEFAULT 0,
  records_failed INTEGER DEFAULT 0,
  status VARCHAR(50) DEFAULT 'processing',
  uploaded_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
