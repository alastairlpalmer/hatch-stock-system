-- 015: Supplier ordering config — order days, lead time, minimum order value.
-- Run in the Supabase SQL editor BEFORE deploying the backend that ships with
-- this file. Idempotent: safe to re-run.

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS order_days jsonb;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS lead_time_days integer;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS min_order_value double precision;
