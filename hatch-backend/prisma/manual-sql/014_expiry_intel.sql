-- 014: Expiry intelligence — machine-level expiry from VendLive channel data.
-- Run in the Supabase SQL editor BEFORE deploying the backend that ships with
-- this file. Idempotent: safe to re-run.

ALTER TABLE location_stock ADD COLUMN IF NOT EXISTS earliest_expiry timestamptz;
CREATE INDEX IF NOT EXISTS location_stock_earliest_expiry_idx
  ON location_stock(earliest_expiry);
