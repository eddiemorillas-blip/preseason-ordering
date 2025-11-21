-- Add gender column to products table
ALTER TABLE products ADD COLUMN IF NOT EXISTS gender VARCHAR(50);

-- Add index for better query performance
CREATE INDEX IF NOT EXISTS idx_products_gender ON products(gender);

-- Optional: Update existing products with a default value if needed
-- UPDATE products SET gender = 'Unisex' WHERE gender IS NULL;
