-- Manual migration — apply against production yourself (do NOT use prisma db push).
-- Product parents: stable flavour families ("Barebells", "Estate Dairy").
-- The parent is a pure grouping row — never stocked, sold, or ordered. Flavours
-- stay ordinary products (own SKU, barcode, batches, sales) linked by
-- products.parent_id. Deliberately an FK by id, not a denormalised name string
-- like the fresh-meal grouping, so renames need no cascade.
-- location_parent_config mirrors location_meal_config: per-(location, parent)
-- min/max capacity, consumed by ordering/picking in later phases.
--
-- NOTE: verify 025_order_delivery_destination.sql has been applied first.
-- Apply BEFORE deploying the matching backend. Idempotent.
--
-- Apply with e.g.:  psql "<DIRECT_DATABASE_URL>" -f prisma/manual-sql/026_product_parents.sql
-- (or paste into the Supabase SQL editor, on project Stock_Tracker).

CREATE TABLE IF NOT EXISTS product_parents (
  id         text PRIMARY KEY,
  name       text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE products ADD COLUMN IF NOT EXISTS parent_id text
  REFERENCES product_parents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS products_parent_id_idx
  ON products (parent_id) WHERE parent_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS location_parent_config (
  location_id text NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  parent_id   text NOT NULL REFERENCES product_parents(id) ON DELETE CASCADE,
  min_stock   integer,
  max_stock   integer,
  PRIMARY KEY (location_id, parent_id)
);
