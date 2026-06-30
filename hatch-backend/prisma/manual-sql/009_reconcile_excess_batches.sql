-- Manual migration — apply against production yourself (do NOT use prisma db push).
--
-- Companion to 008. Reconciles the direction where the batches' remaining_qty
-- sums to MORE than warehouse_stock.quantity.
--
-- Confirmed in prod 2026-06-30: this is the fingerprint of the OLD TRANSFER BUG.
-- Stock moved between warehouses (e.g. 115 Claxton Grove -> Scriven St) or sold
-- down; the old code left the SOURCE warehouse's batches inflated while its
-- aggregate correctly went to 0. The warehouse_stock.quantity (0) is the truth
-- here — the warehouse is genuinely EMPTY of this stock — and the batches are
-- stale leftovers. (The DESTINATION side, where aggregate > batches, was fixed
-- by 008 adding reconciling batches.)
--
-- We trust the aggregate and drain the stale excess batch remaining_qty down to
-- match, oldest-expiry first.
--
-- ⚠️ PRE-CHECK (mandatory — draining lowers remaining_qty irreversibly): run the
-- warehouse-name diagnostic first and confirm EVERY row where quantity < batch_sum
-- is a warehouse you know is physically empty of that stock (e.g. 115 Claxton
-- Grove). If any such row is a warehouse that genuinely HOLDS the stock, its
-- aggregate is the bug, not the batches — do NOT run this; reconcile that row the
-- other way (raise the aggregate) instead.
--
-- Safe within that constraint: only LOWERS remaining_qty on drifted rows; never
-- raises stock, never deletes rows. Idempotent. Run AFTER 008 and BEFORE deploy.
--
-- Apply with e.g.:  psql "<DIRECT_DATABASE_URL>" -f prisma/manual-sql/009_reconcile_excess_batches.sql

WITH ordered AS (
  SELECT b.id,
         ws.quantity AS target,
         b.remaining_qty,
         -- cumulative counting NEWEST-expiry first, so the kept units (if any)
         -- are the freshest and the drained excess is the oldest.
         SUM(b.remaining_qty) OVER (
           PARTITION BY b.warehouse_id, b.sku
           ORDER BY b.expiry_date DESC NULLS LAST, b.received_at DESC, b.id
           ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
         ) AS cum
  FROM stock_batches b
  JOIN warehouse_stock ws
    ON ws.warehouse_id = b.warehouse_id AND ws.sku = b.sku
  WHERE b.remaining_qty > 0
),
recalc AS (
  SELECT id,
         GREATEST(0, LEAST(remaining_qty, target - (cum - remaining_qty))) AS new_remaining
  FROM ordered
)
UPDATE stock_batches sb
SET remaining_qty = r.new_remaining
FROM recalc r
WHERE sb.id = r.id
  AND sb.remaining_qty <> r.new_remaining;
