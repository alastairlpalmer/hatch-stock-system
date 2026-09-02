-- 034: Product trials — the lane for products we do not yet sell.
--
-- The suggestion engine is a REORDER engine and gates every line three times:
-- the product must be assigned to the location, it must be slotted on that
-- location's planogram, and it must have enough sales history to produce a
-- velocity. A product we have never stocked fails all three, so nothing new
-- could ever reach a buying list — correct for restocking, fatal for growth.
--
-- Adds:
--   products.lifecycle   active | trial | discontinued
--   product_trials       one run of "let's see if this sells": which machines,
--                        how many units each, how long, and the verdict
--
-- A `trial` product bypasses all three gates and is ordered and picked to its
-- trial quantity instead. A `discontinued` product stops appearing on buying
-- lists but is STILL picked, so leftover warehouse stock sells through rather
-- than being written off.
--
-- Run in the Supabase SQL editor BEFORE deploying the backend that ships with
-- this file (Railway deploys main immediately — see README.md).
-- Safe/additive: one defaulted column plus a new table. Idempotent.

-- ---------- products.lifecycle ----------

-- NOT NULL DEFAULT 'active' — every existing product keeps behaving exactly as
-- it does today, because 'active' IS today's behaviour.
ALTER TABLE products ADD COLUMN IF NOT EXISTS lifecycle text NOT NULL DEFAULT 'active';

CREATE INDEX IF NOT EXISTS "products_lifecycle_idx" ON products (lifecycle);

-- ---------- product_trials ----------

CREATE TABLE IF NOT EXISTS product_trials (
  id            text PRIMARY KEY,
  sku           text NOT NULL,
  status        text NOT NULL DEFAULT 'planned',
  -- Units to hold in EACH trial machine. With no sales history there is no
  -- velocity to compute from, so this stands in for planogram capacity until
  -- the product earns a real slot.
  trial_qty     integer NOT NULL,
  -- Json array of location ids, matching restock_routes.location_ids — the
  -- same "an ordered set of machines, read as a unit" shape.
  location_ids  jsonb NOT NULL,
  weeks         integer NOT NULL DEFAULT 4,
  -- Set when trial stock first REACHES a machine. Everything about the verdict
  -- is measured from here: ordering in March and shelving it until June must
  -- not count as three months of failed trial.
  started_at    timestamp(3),
  decided_at    timestamp(3),
  decision      text,
  decision_note text,
  notes         text,
  created_by    text,
  created_at    timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT product_trials_sku_fkey
    FOREIGN KEY (sku) REFERENCES products (sku) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "product_trials_status_idx" ON product_trials (status);
CREATE INDEX IF NOT EXISTS "product_trials_sku_idx"    ON product_trials (sku);

-- One OPEN trial per product. Two overlapping trials would order the SKU twice
-- and neither verdict would be measuring a clean window. Partial, so a product
-- can be trialled again after a decision (rejected in the spring, retried when
-- the price drops) without tripping this.
CREATE UNIQUE INDEX IF NOT EXISTS "product_trials_one_open_per_sku"
  ON product_trials (sku)
  WHERE status IN ('planned', 'ordered', 'live');
