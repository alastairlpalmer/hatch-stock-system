-- Manual migration — apply against production yourself (do NOT use prisma db push).
-- Per-location pick list confirmations: one row per (pick list, machine) when
-- the driver taps "Confirm loaded". The UNIQUE constraint is the concurrency
-- guard against double-confirming a stop — the confirm transaction creates the
-- row FIRST, so a second confirm fails before any stock moves.
--
-- items journals what actually moved: [{ sku, name, quantity,
--   consumed: [{ batchId, take }] }] — consumed lets later stops on the same
-- list reduce their stored FEFO plan by what earlier stops already took.
-- removal_id / restock_record_id link the StockRemoval (warehouse decrement)
-- and RestockRecord (machine increment) created by the confirm.
--
-- Idempotent and safe to re-run.
--
-- Apply with e.g.:  psql "<DIRECT_DATABASE_URL>" -f prisma/manual-sql/028_pick_list_location_confirm.sql
-- (or paste into the Supabase SQL editor, on project Stock_Tracker).

CREATE TABLE IF NOT EXISTS pick_list_location_confirmations (
  id                text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  pick_list_id      text NOT NULL,
  location_id       text NOT NULL,
  performed_by      text,
  items             jsonb,
  removal_id        text,
  restock_record_id text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pick_list_location_confirmations_pick_list_id_location_id_key
    UNIQUE (pick_list_id, location_id)
);

CREATE INDEX IF NOT EXISTS pick_list_location_confirmations_pick_list_id_idx
  ON pick_list_location_confirmations (pick_list_id);
