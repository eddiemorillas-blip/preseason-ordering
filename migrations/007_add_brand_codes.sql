-- Add code column to brands table for short codes in order numbers

ALTER TABLE brands ADD COLUMN IF NOT EXISTS code VARCHAR(10);

-- Set codes for existing brands
UPDATE brands SET code = 'FF' WHERE name = 'Free Fly';
UPDATE brands SET code = 'LS' WHERE name = 'La Sportiva';
UPDATE brands SET code = 'PRA' WHERE name = 'Prana';
UPDATE brands SET code = 'DUER' WHERE name = 'DUER';
