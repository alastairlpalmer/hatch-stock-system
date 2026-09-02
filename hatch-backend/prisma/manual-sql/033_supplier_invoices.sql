-- 033: Supplier invoices, invoice lines, and the product cost trail.
--
-- Closes the buying loop at the money end. Until now a PO carried CATALOGUE
-- costs, receiving recorded quantities only, and the supplier's invoice was
-- reconciled by hand in a spreadsheet — so discounts, price rises and
-- over-billing never reached the system and every margin figure was computed
-- from a guess.
--
-- Adds:
--   supplier_invoices        one row per invoice (header figures as printed)
--   supplier_invoice_lines   its lines, matched to a SKU where possible
--   price_history            append-only trail of observed unit costs
--   order_items.invoiced_qty / invoiced_unit_price
--   products.supplier_code   learned supplier product code (faster matching)
--   products.cost_locked     stops the VendLive catalog sync overwriting a
--                            cost we learned from a real invoice
--
-- Run in the Supabase SQL editor BEFORE deploying the backend that ships with
-- this file (Railway deploys main immediately — see the note in README.md).
-- Safe/additive: creates new tables and adds nullable/defaulted columns only.
-- Touches no existing data. Idempotent: safe to re-run.

-- ---------- products: learned supplier code + cost lock ----------

ALTER TABLE products ADD COLUMN IF NOT EXISTS supplier_code text;
ALTER TABLE products ADD COLUMN IF NOT EXISTS cost_locked  boolean NOT NULL DEFAULT false;

-- Deliberately NOT unique: two suppliers may reuse the same code, and matching
-- is scoped to the invoice's supplier.
CREATE INDEX IF NOT EXISTS "products_supplier_code_idx" ON products (supplier_code);

-- ---------- order_items: what was actually billed ----------

-- Nullable, not defaulted to 0: NULL means "no invoice has covered this line
-- yet", which is a different fact from "invoiced for zero". double precision
-- matches the Float mapping used by the rest of the money columns in this
-- schema (see pending/02-money-to-decimal.sql for the eventual numeric move).
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS invoiced_qty        double precision;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS invoiced_unit_price double precision;

-- ---------- supplier_invoices ----------

CREATE TABLE IF NOT EXISTS supplier_invoices (
  id              text PRIMARY KEY,
  order_id        text,
  supplier_id     text,
  invoice_ref     text NOT NULL,
  invoice_date    timestamp(3),
  goods_total     double precision,
  order_discount  double precision,
  delivery_charge double precision,
  vat             double precision,
  invoice_total   double precision,
  spread_delivery boolean NOT NULL DEFAULT false,
  status          text NOT NULL DEFAULT 'draft',
  notes           text,
  reconciled_at   timestamp(3),
  reconciled_by   text,
  created_at      timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- SET NULL, not CASCADE: deleting a PO must not silently destroy the record
  -- of an invoice we were sent (and may have paid).
  CONSTRAINT supplier_invoices_order_id_fkey
    FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT supplier_invoices_supplier_id_fkey
    FOREIGN KEY (supplier_id) REFERENCES suppliers (id) ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "supplier_invoices_order_id_idx"    ON supplier_invoices (order_id);
CREATE INDEX IF NOT EXISTS "supplier_invoices_supplier_id_invoice_date_idx"
  ON supplier_invoices (supplier_id, invoice_date);
CREATE INDEX IF NOT EXISTS "supplier_invoices_status_idx"      ON supplier_invoices (status);

-- One invoice reference per supplier — catches the same invoice being pasted
-- twice, which would otherwise double-count the spend. Partial: rows with no
-- supplier (an invoice logged before the supplier record exists) are exempt.
CREATE UNIQUE INDEX IF NOT EXISTS "supplier_invoices_supplier_ref_key"
  ON supplier_invoices (supplier_id, invoice_ref)
  WHERE supplier_id IS NOT NULL;

-- ---------- supplier_invoice_lines ----------

CREATE TABLE IF NOT EXISTS supplier_invoice_lines (
  id                  text PRIMARY KEY,
  invoice_id          text NOT NULL,
  -- Nullable: an unmatched line is kept verbatim so a stored invoice always
  -- reconciles to its own printed total.
  sku                 text,
  raw_code            text,
  raw_name            text,
  quantity            double precision NOT NULL,
  unit_price          double precision NOT NULL,
  line_discount       double precision NOT NULL DEFAULT 0,
  line_total          double precision NOT NULL,
  effective_unit_cost double precision,
  matched_by          text,
  CONSTRAINT supplier_invoice_lines_invoice_id_fkey
    FOREIGN KEY (invoice_id) REFERENCES supplier_invoices (id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "supplier_invoice_lines_invoice_id_idx" ON supplier_invoice_lines (invoice_id);
CREATE INDEX IF NOT EXISTS "supplier_invoice_lines_sku_idx"        ON supplier_invoice_lines (sku);

-- No FK on sku: lines are matched to the catalogue best-effort and a product
-- may later be deleted; the invoice as sent to us must survive that.

-- ---------- price_history ----------

CREATE TABLE IF NOT EXISTS price_history (
  id             text PRIMARY KEY,
  sku            text NOT NULL,
  supplier_id    text,
  unit_cost      double precision NOT NULL,
  source         text NOT NULL,
  invoice_id     text,
  effective_from timestamp(3) NOT NULL,
  created_at     timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT price_history_sku_fkey
    FOREIGN KEY (sku) REFERENCES products (sku) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT price_history_supplier_id_fkey
    FOREIGN KEY (supplier_id) REFERENCES suppliers (id) ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "price_history_sku_effective_from_idx" ON price_history (sku, effective_from);
CREATE INDEX IF NOT EXISTS "price_history_invoice_id_idx"         ON price_history (invoice_id);

-- ---------- seed the trail with today's catalogue costs ----------

-- One 'manual' baseline row per product that has a cost, so the first invoice
-- reconcile has something to show a change AGAINST. Guarded by NOT EXISTS so
-- re-running the script does not stack duplicate baselines.
INSERT INTO price_history (id, sku, supplier_id, unit_cost, source, effective_from, created_at)
SELECT
  gen_random_uuid()::text,
  p.sku,
  p.preferred_supplier_id,
  p.unit_cost,
  'manual',
  COALESCE(p.updated_at, CURRENT_TIMESTAMP),
  CURRENT_TIMESTAMP
FROM products p
WHERE p.unit_cost IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM price_history h WHERE h.sku = p.sku);
