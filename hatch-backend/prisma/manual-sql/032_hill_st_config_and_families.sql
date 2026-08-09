-- Manual migration — apply against production yourself (do NOT use prisma db push).
--
-- 1) Hill St min/max volumes copied from Berkeley Street. Covers all three
--    capacity tables: per-SKU (location_config), per-meal-type
--    (location_meal_config) and per-family (location_parent_config).
--    Only min/max capacity rows are touched — assignments, planograms and
--    stock stay exactly as they are. Hill St rows for SKUs/groups that
--    Berkeley doesn't configure are left alone (the machines stock different
--    lists); the report query at the bottom lists any such leftovers.
--
-- 2) Family membership backfill: products whose name starts with an existing
--    product_parents name but aren't linked yet get parent_id set. Fresh
--    meals are excluded (a product is never in both grouping systems). Run
--    the PREVIEW select first and eyeball the matches before the UPDATE.
--
-- Idempotent — safe to re-run.
-- Apply with e.g.:  psql "<DIRECT_DATABASE_URL>" -f prisma/manual-sql/032_hill_st_config_and_families.sql
-- (or paste into the Supabase SQL editor, on project Stock_Tracker).

-- ============================================================================
-- Part 1 — Hill St min/max ← Berkeley Street
-- ============================================================================
-- Location lookup is tolerant of spelling (substring match on "hill" /
-- "berkel") but still errors if either pattern matches zero or multiple
-- active locations, so a wrong guess can't silently write to the wrong
-- machine. The error message lists all active location names — if it fires,
-- adjust the two ILIKE patterns below to match the real names exactly.

DO $$
DECLARE
  hill_id     text;
  berkeley_id text;
  n           integer;
  all_names   text;
BEGIN
  SELECT string_agg(name, ' | ' ORDER BY name) INTO all_names
    FROM locations WHERE archived_at IS NULL;

  SELECT min(id), count(*) INTO hill_id, n
    FROM locations
   WHERE archived_at IS NULL AND name ILIKE '%hill%';
  IF n <> 1 THEN
    RAISE EXCEPTION 'Hill St lookup matched % active locations (need exactly 1). Active names: %', n, all_names;
  END IF;

  SELECT min(id), count(*) INTO berkeley_id, n
    FROM locations
   WHERE archived_at IS NULL AND (name ILIKE '%berkel%' OR name ILIKE '%berkeley%');
  IF n <> 1 THEN
    RAISE EXCEPTION 'Berkeley St lookup matched % active locations (need exactly 1). Active names: %', n, all_names;
  END IF;

  RAISE NOTICE 'Copying config: % -> %',
    (SELECT name FROM locations WHERE id = berkeley_id),
    (SELECT name FROM locations WHERE id = hill_id);

  -- Per-SKU min/max
  INSERT INTO location_config (location_id, sku, min_stock, max_stock)
  SELECT hill_id, sku, min_stock, max_stock
    FROM location_config
   WHERE location_id = berkeley_id
  ON CONFLICT (location_id, sku)
  DO UPDATE SET min_stock = EXCLUDED.min_stock,
                max_stock = EXCLUDED.max_stock;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'location_config: % per-SKU rows copied to Hill St', n;

  -- Per-meal-type min/max (Frive group rows)
  INSERT INTO location_meal_config (location_id, meal_type, min_stock, max_stock)
  SELECT hill_id, meal_type, min_stock, max_stock
    FROM location_meal_config
   WHERE location_id = berkeley_id
  ON CONFLICT (location_id, meal_type)
  DO UPDATE SET min_stock = EXCLUDED.min_stock,
                max_stock = EXCLUDED.max_stock;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'location_meal_config: % meal-type rows copied to Hill St', n;

  -- Per-family min/max (product-family group rows)
  INSERT INTO location_parent_config (location_id, parent_id, min_stock, max_stock)
  SELECT hill_id, parent_id, min_stock, max_stock
    FROM location_parent_config
   WHERE location_id = berkeley_id
  ON CONFLICT (location_id, parent_id)
  DO UPDATE SET min_stock = EXCLUDED.min_stock,
                max_stock = EXCLUDED.max_stock;
  GET DIAGNOSTICS n = ROW_COUNT;
  RAISE NOTICE 'location_parent_config: % family rows copied to Hill St', n;
END $$;

-- ============================================================================
-- Part 2 — link unparented flavours to their product family
-- ============================================================================
-- PREVIEW — run this first and check every row looks right. Matches products
-- whose name starts with a family name (case-insensitive); where two family
-- names both prefix-match, the longer (more specific) one wins.

SELECT m.sku, m.product_name, m.family_name
  FROM (
    SELECT DISTINCT ON (p.sku)
           p.sku, p.name AS product_name, pp.name AS family_name
      FROM products p
      JOIN product_parents pp ON p.name ILIKE pp.name || '%'
     WHERE p.parent_id IS NULL
       AND p.is_fresh_meal = false
     ORDER BY p.sku, length(pp.name) DESC
  ) m
 ORDER BY m.family_name, m.product_name;

-- APPLY — same matching as the preview.
UPDATE products p
   SET parent_id = m.parent_id,
       updated_at = now()
  FROM (
    SELECT DISTINCT ON (p2.sku) p2.sku, pp.id AS parent_id
      FROM products p2
      JOIN product_parents pp ON p2.name ILIKE pp.name || '%'
     WHERE p2.parent_id IS NULL
       AND p2.is_fresh_meal = false
     ORDER BY p2.sku, length(pp.name) DESC
  ) m
 WHERE p.sku = m.sku;

-- ============================================================================
-- Reports (read-only, optional)
-- ============================================================================
-- Hill St config rows with no Berkeley counterpart (kept as-is by Part 1) —
-- prune by hand if you actually want an exact mirror.
SELECT lc.sku, pr.name, lc.min_stock, lc.max_stock
  FROM location_config lc
  JOIN locations l  ON l.id = lc.location_id AND l.name ILIKE '%hill%' AND l.archived_at IS NULL
  JOIN products pr  ON pr.sku = lc.sku
 WHERE NOT EXISTS (
   SELECT 1
     FROM location_config b
     JOIN locations bl ON bl.id = b.location_id AND bl.name ILIKE '%berkel%' AND bl.archived_at IS NULL
    WHERE b.sku = lc.sku
 )
 ORDER BY pr.name;

-- Current family membership after the backfill.
SELECT pp.name AS family, p.sku, p.name
  FROM product_parents pp
  JOIN products p ON p.parent_id = pp.id
 ORDER BY pp.name, p.name;
