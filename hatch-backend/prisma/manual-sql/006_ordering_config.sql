-- Manual migration — apply against production yourself (do NOT use prisma db push,
-- which would diff the whole schema). Adds per-location ordering parameters used
-- by purchase-order generation:
--   lead_time_days — days from placing an order to stock in hand (reorder horizon)
--   cover_days     — days of demand a suggested order should top the location up to
-- Both are NULLABLE overrides; when NULL the app falls back to the code defaults
-- in src/config/ordering.js (lead time 3, cover 7).
-- Safe/additive: adds two nullable columns, touches no existing data. Idempotent.
--
-- Apply with e.g.:  psql "<DIRECT_DATABASE_URL>" -f prisma/manual-sql/006_ordering_config.sql
-- (or paste into the Supabase SQL editor) after taking a backup.

ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "lead_time_days" INTEGER;
ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "cover_days"     INTEGER;
