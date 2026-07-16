-- Manual migration — apply against production yourself (do NOT use prisma db push).
-- Planogram parent slots: a fridge slot can target a product family
-- ("Barebells" — any flavour in this facing), the third target type beside a
-- concrete SKU and a fresh-meal bucket. parent_id references product_parents
-- by id but carries NO FK (matches sku/meal_type on this table: history rows
-- must survive product churn).
--
-- Apply BEFORE deploying the matching backend. Idempotent.
--
-- Apply with e.g.:  psql "<DIRECT_DATABASE_URL>" -f prisma/manual-sql/027_planogram_parent_slots.sql
-- (or paste into the Supabase SQL editor, on project Stock_Tracker).

ALTER TABLE slot_assignments ADD COLUMN IF NOT EXISTS parent_id text;

ALTER TABLE slot_assignments DROP CONSTRAINT IF EXISTS slot_assignments_target;
ALTER TABLE slot_assignments ADD CONSTRAINT slot_assignments_target CHECK (
  (target_type = 'sku' AND sku IS NOT NULL) OR
  (target_type = 'mealType' AND meal_type IS NOT NULL) OR
  (target_type = 'parent' AND parent_id IS NOT NULL)
);
