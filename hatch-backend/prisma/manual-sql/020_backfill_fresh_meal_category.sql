-- Manual migration — apply against production yourself (do NOT use prisma db push).
-- One-time backfill: flag Frive fresh meals that slipped past classification.
--
-- Root cause: the VendLive STOCK sync's auto-create path (vendlive-stock.js,
-- syncMachineStock) created products without running the fresh-meal classifier.
-- New weekly flavours usually appear on a machine's planogram BEFORE their
-- first sale, so the stock sync created them first with is_fresh_meal = false,
-- and the sales-ingest path (which does classify) then saw the product already
-- existed and skipped it. Those flavours never reached the review queue and
-- rendered as a plain "FRESH MEALS" category section on Location Stock instead
-- of rolling up into the Frive meal-type groups (seen at Hermes Hill St,
-- 2026-07-10).
--
-- The code fix (guessFreshMeal now runs on every create path and treats the
-- VendLive "Fresh Meals" category as a definitive signal) stops new strays;
-- this backfill repairs the ones already in the catalogue.
--
-- The ordering placeholders (category 'Fresh Meal Order', SKUs FRIVE-*) are
-- explicitly excluded: they must stay is_fresh_meal = false so they never join
-- the fresh-meal group aggregation (see utils/fresh-meal-placeholders.js).
--
-- Idempotent (guarded WHERE clauses) and safe to re-run.
-- Already applied to production on 2026-07-10 (as 004; renumbered to 020 after
-- a numbering collision with the pre-existing 004_stock_transfers.sql).
--
-- Apply with e.g.:  psql "<DIRECT_DATABASE_URL>" -f prisma/manual-sql/020_backfill_fresh_meal_category.sql
-- (or paste into the Supabase SQL editor, on project Stock_Tracker).

-- (1) Flag products in a "Fresh Meals" category (any variant VendLive reports,
--     e.g. 'Fresh Meals', 'Fresh Meal', 'Fresh Meals (Frive)') or with a
--     Frive-prefixed name, excluding the ordering placeholders.
UPDATE products
SET is_fresh_meal = true
WHERE is_fresh_meal = false
  AND COALESCE(category, '') <> 'Fresh Meal Order'
  AND (
    btrim(COALESCE(category, '')) ~* '^fresh\s*meals?(\s*\(.*\))?$'
    OR name ILIKE 'frive %'
  );

-- (2) Best-effort meal-type guess — mirrors services/meal-classifier.js
--     (Veg/Vegan checked first so it wins ties like "Bulgogi Vegan Beef Bowl").
--     Ambiguous names are left NULL and surface in Admin > Fresh Meals >
--     Needs Review. Left unconfirmed (meal_type_confirmed stays false) so a
--     human verifies each one in the review queue.
UPDATE products
SET meal_type = CASE
  WHEN name ~* '(vegan|veggie|vegetarian|plant|tofu|chickpea|lentil|dahl|dhal|daal|falafel|halloumi|paneer|jackfruit|quorn|aubergine|mushroom|spinach|butterbean|bean)'
    THEN 'Veg/Vegan'
  WHEN name ~* '(chicken|beef|pork|lamb|meatball|bolognese|bolognaise|chorizo|bacon|ham|turkey|duck|sausage|steak|mince|fish|salmon|tuna|cod|haddock|prawn|shrimp|seafood|jerk)'
    THEN 'Meat'
  ELSE NULL END
WHERE is_fresh_meal = true AND meal_type IS NULL AND meal_type_confirmed = false;
