-- Add inseam column to products table for pant sizes
ALTER TABLE products ADD COLUMN IF NOT EXISTS inseam VARCHAR(50);

-- Add comment for documentation
COMMENT ON COLUMN products.inseam IS 'Inseam length for pants and other leg-length products';
