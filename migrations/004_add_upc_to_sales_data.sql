-- Add UPC column to sales_data table for better product matching
ALTER TABLE sales_data
ADD COLUMN IF NOT EXISTS original_upc VARCHAR(50);

-- Create index for UPC lookups
CREATE INDEX IF NOT EXISTS idx_sales_data_upc ON sales_data(original_upc);
