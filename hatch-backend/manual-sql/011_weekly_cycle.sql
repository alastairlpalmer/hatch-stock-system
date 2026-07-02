-- 011: Weekly ordering cycle — partial receiving, buying lists, pick lists.
-- Run in the Supabase SQL editor BEFORE deploying the backend that ships with
-- this file. Idempotent: safe to re-run.

-- 1. Orders: expected delivery date + link back to the buying list.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS expected_date timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS buying_list_id text;

-- 2. Order items: track units received so far (partial receiving).
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS received_qty integer NOT NULL DEFAULT 0;

-- Backfill: historical received orders count as fully received.
UPDATE order_items oi
SET received_qty = oi.quantity
FROM orders o
WHERE oi.order_id = o.id
  AND o.status = 'received'
  AND oi.received_qty = 0;

-- 3. Receipts: one row per receiving event (supports multiple expiry lots per
--    SKU via multiple item lines).
CREATE TABLE IF NOT EXISTS order_receipts (
  id            text PRIMARY KEY,
  order_id      text NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  warehouse_id  text NOT NULL,
  items         jsonb NOT NULL,
  closed_short  boolean NOT NULL DEFAULT false,
  received_by   text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS order_receipts_order_id_idx ON order_receipts(order_id);
CREATE INDEX IF NOT EXISTS order_receipts_created_at_idx ON order_receipts(created_at);

-- 4. Buying lists: the weekly consolidated, shareable, supplier-grouped list.
CREATE TABLE IF NOT EXISTS buying_lists (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  status      text NOT NULL DEFAULT 'draft',
  target_date timestamptz,
  share_token text NOT NULL UNIQUE,
  items       jsonb NOT NULL,
  notes       text,
  order_ids   jsonb,
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS buying_lists_created_at_idx ON buying_lists(created_at);

-- 5. Pick lists: FEFO bag-packing lists per route + restock date.
CREATE TABLE IF NOT EXISTS pick_lists (
  id           text PRIMARY KEY,
  route_id     text,
  route_name   text,
  warehouse_id text NOT NULL,
  target_date  timestamptz NOT NULL,
  status       text NOT NULL DEFAULT 'draft',
  items        jsonb NOT NULL,
  shortfalls   jsonb,
  removal_id   text,
  created_by   text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pick_lists_target_date_idx ON pick_lists(target_date);
CREATE INDEX IF NOT EXISTS pick_lists_created_at_idx ON pick_lists(created_at);
