-- Manual migration — apply against production yourself (do NOT use prisma db push,
-- which would diff the whole schema). Adds Frive fresh-meal grouping by a
-- configurable meal type. Safe/additive + idempotent (IF NOT EXISTS / ON CONFLICT).
--
-- Apply with e.g.:  psql "<DIRECT_DATABASE_URL>" -f prisma/manual-sql/002_fresh_meals.sql
-- (or paste into the Supabase SQL editor) after taking a backup.
--
-- NOTE: location_meal_config and products.meal_type are keyed by the bucket NAME
-- (denormalised, no FK). A future bucket rename must update BOTH products.meal_type
-- AND location_meal_config.meal_type in one transaction — handled by the
-- PUT /api/meal-types/:id route.

-- (1) Product flags. A boolean identifies Frive fresh meals (narrow scope);
--     meal_type holds the bucket name; meal_type_confirmed gates auto-guesses
--     until a human confirms them.
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "is_fresh_meal" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "meal_type" TEXT;
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "meal_type_confirmed" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "products_is_fresh_meal_idx"
  ON "products" ("is_fresh_meal") WHERE "is_fresh_meal" = true;

-- (2) Admin-managed bucket list (configurable, not an enum).
CREATE TABLE IF NOT EXISTS "meal_types" (
  "id"         TEXT NOT NULL,
  "name"       TEXT NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "meal_types_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "meal_types_name_key" ON "meal_types" ("name");

-- (3) Per-(location, meal_type) group capacity. Separate table rather than a
--     synthetic sku in location_config (which FKs to products.sku).
CREATE TABLE IF NOT EXISTS "location_meal_config" (
  "location_id" TEXT NOT NULL,
  "meal_type"   TEXT NOT NULL,
  "min_stock"   INTEGER,
  "max_stock"   INTEGER,
  CONSTRAINT "location_meal_config_pkey" PRIMARY KEY ("location_id", "meal_type"),
  CONSTRAINT "location_meal_config_location_fk"
    FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE CASCADE
);

-- (4) Seed the two starting buckets (gen_random_uuid is available in Supabase).
INSERT INTO "meal_types" ("id", "name", "sort_order") VALUES
  (gen_random_uuid()::text, 'Meat', 0),
  (gen_random_uuid()::text, 'Veg/Vegan', 1)
ON CONFLICT ("name") DO NOTHING;
