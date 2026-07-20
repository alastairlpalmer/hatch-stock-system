-- 012: VendLive trust fixes — machine-id namespace merge + sale quarantine.
-- Run in the Supabase SQL editor BEFORE deploying the backend that ships with
-- this file. Idempotent: safe to re-run.
--
-- POOLER-SAFE: the Supabase SQL editor runs through the transaction pooler,
-- where each statement can land on a different session — so no TEMP TABLEs;
-- the dedupe is a single statement using data-modifying CTEs.

-- 1. One mapping row per physical machine, holding BOTH VendLive id
--    namespaces. vendlive_machine_id = /machines/ API id (stock sync);
--    sales_machine_id = order-sales/webhook feed id (sales attribution).
ALTER TABLE vendlive_machine_mappings
  ADD COLUMN IF NOT EXISTS sales_machine_id integer;
CREATE UNIQUE INDEX IF NOT EXISTS vendlive_machine_mappings_sales_machine_id_key
  ON vendlive_machine_mappings(sales_machine_id);

-- 2. Merge duplicate rows created by the namespace split: for each
--    machine_name that has BOTH a location-mapped row (machines namespace)
--    and an unmapped auto-created row (sales namespace), delete the duplicate
--    and carry its id (which WAS the sales-feed id) onto the keeper's
--    sales_machine_id. One statement so both halves share a snapshot.
WITH dups AS (
  SELECT dup.id AS dup_id,
         dup.vendlive_machine_id AS dup_machine_id,
         keeper.id AS keeper_id
  FROM vendlive_machine_mappings dup
  JOIN vendlive_machine_mappings keeper
    ON keeper.machine_name = dup.machine_name
   AND keeper.id <> dup.id
   AND keeper.location_id IS NOT NULL
  WHERE dup.location_id IS NULL
    AND dup.auto_created = true
),
deleted AS (
  DELETE FROM vendlive_machine_mappings
  WHERE id IN (SELECT dup_id FROM dups)
  RETURNING id
)
UPDATE vendlive_machine_mappings m
SET sales_machine_id = d.dup_machine_id
FROM dups d
WHERE m.id = d.keeper_id
  AND m.sales_machine_id IS NULL;

-- 3. Backfill sales_machine_id for surviving single rows whose stored id
--    demonstrably comes from the sales feed (it appears on sale rows). This
--    covers webhook-auto-created rows that never had a machines-namespace
--    counterpart.
UPDATE vendlive_machine_mappings m
SET sales_machine_id = m.vendlive_machine_id
WHERE m.sales_machine_id IS NULL
  AND EXISTS (
    SELECT 1 FROM sales s WHERE s.vendlive_machine_id = m.vendlive_machine_id
  );

-- 4. Quarantine for sales the ingest could not book (unknown SKU with
--    auto-create off). Replayed once the product exists.
CREATE TABLE IF NOT EXISTS vendlive_quarantined_sales (
  id                        text PRIMARY KEY,
  vendlive_order_sale_id    integer,
  vendlive_product_sale_id  integer,
  payload                   jsonb NOT NULL,
  reason                    text NOT NULL,
  sku                       text,
  product_name              text,
  machine_name              text,
  "timestamp"               timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now(),
  resolved_at               timestamptz
);
CREATE INDEX IF NOT EXISTS vendlive_quarantined_sales_resolved_at_idx
  ON vendlive_quarantined_sales(resolved_at);
