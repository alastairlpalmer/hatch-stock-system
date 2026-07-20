-- 013: Route-run loop — link machine restocks to pick lists + leftover returns.
-- Run in the Supabase SQL editor BEFORE deploying the backend that ships with
-- this file. Idempotent: safe to re-run.

ALTER TABLE restock_records ADD COLUMN IF NOT EXISTS pick_list_id text;
CREATE INDEX IF NOT EXISTS restock_records_pick_list_id_idx
  ON restock_records(pick_list_id);

ALTER TABLE pick_lists ADD COLUMN IF NOT EXISTS returned_items jsonb;
