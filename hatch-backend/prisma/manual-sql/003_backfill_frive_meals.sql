-- Manual migration — apply against production yourself (do NOT use prisma db push).
-- One-time backfill: flag Frive meals that already existed BEFORE 002_fresh_meals.sql.
--
-- 002 only added the columns (is_fresh_meal defaults false) and the auto-guesser
-- only runs when a product is CREATED, so meals already in the catalogue stay
-- unflagged. This classifies them so they collapse on Location Stock and roll up
-- in reporting. Idempotent (guarded WHERE clauses) and safe to re-run.
--
-- Apply with e.g.:  psql "<DIRECT_DATABASE_URL>" -f prisma/manual-sql/003_backfill_frive_meals.sql
-- (or paste into the Supabase SQL editor, on project Stock_Tracker).
--
-- Already applied to production on 2026-06-13.

-- (1) Flag existing Frive meals as fresh meals.
UPDATE products
SET is_fresh_meal = true
WHERE name ILIKE 'Frive %' AND is_fresh_meal = false;

-- (2) Best-effort meal-type guess — mirrors services/meal-classifier.js
--     (Veg/Vegan checked first so it wins ties like "Vegan Steak"). Ambiguous
--     names are left NULL and surface in Admin > Fresh Meals > Needs Review.
--     Left unconfirmed (meal_type_confirmed stays false) so a human verifies.
UPDATE products
SET meal_type = CASE
  WHEN name ~* '(vegan|veggie|vegetarian|plant|tofu|chickpea|lentil|dahl|dhal|daal|falafel|halloumi|paneer|jackfruit|quorn|aubergine|mushroom|spinach|butterbean|bean)'
    THEN 'Veg/Vegan'
  WHEN name ~* '(chicken|beef|pork|lamb|meatball|bolognese|bolognaise|chorizo|bacon|ham|turkey|duck|sausage|steak|mince|fish|salmon|tuna|cod|haddock|prawn|shrimp|seafood|jerk)'
    THEN 'Meat'
  ELSE NULL END
WHERE is_fresh_meal = true AND meal_type IS NULL AND meal_type_confirmed = false;
