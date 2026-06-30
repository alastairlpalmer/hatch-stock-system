-- Manual migration — apply against production yourself (do NOT use prisma db push,
-- which would diff the whole schema). Adds product-catalog sync config to
-- vendlive_config, used by the proactive VendLive product pull
-- (src/services/vendlive-stock.js syncProductCatalog + the scheduler job):
--   product_sync_enabled      — toggle the daily catalog pull on/off
--   product_sync_interval_min — minutes between catalog pulls (default 1440 = daily)
--   last_product_sync_at      — checkpoint of the last successful catalog pull
-- Safe/additive: adds three columns with defaults, touches no existing data.
-- Idempotent.
--
-- Apply with e.g.:  psql "<DIRECT_DATABASE_URL>" -f prisma/manual-sql/007_product_catalog_sync.sql
-- (or paste into the Supabase SQL editor) after taking a backup.

ALTER TABLE "vendlive_config" ADD COLUMN IF NOT EXISTS "product_sync_enabled"      BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "vendlive_config" ADD COLUMN IF NOT EXISTS "product_sync_interval_min" INTEGER NOT NULL DEFAULT 1440;
ALTER TABLE "vendlive_config" ADD COLUMN IF NOT EXISTS "last_product_sync_at"      TIMESTAMP(3);
