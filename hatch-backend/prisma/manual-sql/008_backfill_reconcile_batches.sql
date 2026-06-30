-- Manual migration — apply against production yourself (do NOT use prisma db push).
--
-- PREREQUISITE for the "batches are authoritative" change: before the app starts
-- deriving warehouse_stock.quantity from the SUM of stock_batches.remaining_qty,
-- every existing warehouse_stock row must be backed by batches that sum to it.
-- Stock that predates batch tracking (CSV bulk imports, old absolute edits) has
-- a quantity with no — or insufficient — batches behind it. Without this backfill
-- the first batch operation on such a SKU would recompute its total down to the
-- (smaller) batch sum and LOSE stock.
--
-- This inserts ONE reconciling batch (expiry_date NULL) per (warehouse, sku)
-- whose aggregate exceeds its batch sum, covering exactly the gap. These appear
-- in the "Missing Expiry" list so the real expiry can be set later.
--
-- Safe/additive: only INSERTs batches, never deletes or lowers anything.
-- Idempotent in effect: re-running finds no remaining gap and inserts nothing.
--
-- ORDER OF OPERATIONS: run this BEFORE deploying the batches-authoritative code.
--
-- Apply with e.g.:  psql "<DIRECT_DATABASE_URL>" -f prisma/manual-sql/008_backfill_reconcile_batches.sql
-- (or paste into the Supabase SQL editor) after taking a backup.

INSERT INTO "stock_batches"
  (id, warehouse_id, sku, quantity, remaining_qty, expiry_date, has_damage, damage_notes, received_at)
SELECT
  gen_random_uuid(),
  ws.warehouse_id,
  ws.sku,
  (ws.quantity - COALESCE(b.sum_remaining, 0)) AS gap,
  (ws.quantity - COALESCE(b.sum_remaining, 0)) AS gap,
  NULL,
  false,
  'Backfill: pre-batch stock reconciliation',
  now()
FROM "warehouse_stock" ws
LEFT JOIN (
  SELECT warehouse_id, sku, SUM(remaining_qty) AS sum_remaining
  FROM "stock_batches"
  GROUP BY warehouse_id, sku
) b ON b.warehouse_id = ws.warehouse_id AND b.sku = ws.sku
WHERE ws.quantity > COALESCE(b.sum_remaining, 0);
