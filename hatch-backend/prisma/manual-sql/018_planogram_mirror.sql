-- 018: Planogram mirror — per-machine planogram snapshot on the mapping.
-- Run in the Supabase SQL editor BEFORE deploying the backend that ships with
-- this file. Idempotent: safe to re-run.

ALTER TABLE vendlive_machine_mappings
  ADD COLUMN IF NOT EXISTS planogram_skus jsonb;
ALTER TABLE vendlive_machine_mappings
  ADD COLUMN IF NOT EXISTS planogram_synced_at timestamptz;
