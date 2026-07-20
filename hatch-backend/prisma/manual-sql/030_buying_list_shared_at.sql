-- 030: Track when a buying list was first shared.
-- The weekly rule is "share the list before ordering", but nothing recorded
-- whether a list HAD been shared — POs could be raised on a list the
-- warehouse/supplier never saw. shared_at is stamped the first time the
-- public share view is opened or a share/copy action is taken; create-orders
-- warns (and requires an explicit force) while it is null.
-- Run in the Supabase SQL editor BEFORE deploying the backend that ships
-- with this file. Idempotent: safe to re-run.

ALTER TABLE buying_lists
  ADD COLUMN IF NOT EXISTS shared_at timestamptz;
