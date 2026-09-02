-- 035: Supplier minimums beyond a pound value.
--
-- suppliers.min_order_value already existed and was WARNED about in three
-- places (the Plan Buy panel, the buying-list detail view, the PDF) and acted
-- on in none — the operator was left to pad the order by scrolling the
-- catalogue and guessing. Two gaps made that worse:
--
--   * a supplier's floor is not always money. Some quote a case or unit count,
--     which min_order_value cannot express at all.
--   * free delivery is a SEPARATE, softer threshold above the minimum. Missing
--     it costs a delivery fee; missing the minimum means the order is refused
--     outright. Storing one number for both would force the app to treat them
--     as the same urgency, which trains operators to ignore both.
--
-- Adds:
--   suppliers.min_order_units      unit/case floor, alongside the £ floor
--   suppliers.free_delivery_value  threshold for free delivery (advisory)
--
-- Run in the Supabase SQL editor BEFORE deploying the backend that ships with
-- this file (Railway deploys main immediately — see README.md).
-- Safe/additive: two nullable columns, no defaults, no data touched.
-- Idempotent.

-- NULL means "this supplier sets no such minimum", which is the honest default
-- and what every existing supplier row means today. Deliberately NOT defaulted
-- to 0: a 0 minimum and an unknown minimum read identically in the UI, and the
-- top-up planner must not propose padding towards a threshold nobody set.
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS min_order_units     integer;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS free_delivery_value double precision;
