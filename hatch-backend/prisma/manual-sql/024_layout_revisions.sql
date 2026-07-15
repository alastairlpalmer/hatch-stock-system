-- Manual migration — apply against production yourself (do NOT use prisma db push).
-- Next-week draft planograms: a location can now hold TWO machine_layouts rows,
-- distinguished by revision ('current' = live, 'next' = the draft being planned
-- for the coming restock Monday). Ordering/picking prefer the next-week layout
-- when one exists; the public restock sheet always pins revision='current'.
-- Promotion diffs the draft onto the current layout (clean slot history) and
-- deletes the draft row.
--
-- The UNIQUE on location_id is replaced by UNIQUE (location_id, revision).
-- Existing rows keep working: they default to revision='current'.
--
-- Apply BEFORE deploying the matching backend (the Prisma client switches its
-- lookups to the compound key). Idempotent.
--
-- Apply with e.g.:  psql "<DIRECT_DATABASE_URL>" -f prisma/manual-sql/024_layout_revisions.sql
-- (or paste into the Supabase SQL editor, on project Stock_Tracker).

ALTER TABLE machine_layouts ADD COLUMN IF NOT EXISTS revision text NOT NULL DEFAULT 'current';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'machine_layouts_revision_check'
  ) THEN
    ALTER TABLE machine_layouts ADD CONSTRAINT machine_layouts_revision_check
      CHECK (revision IN ('current', 'next'));
  END IF;
END $$;

-- Replace the single-column unique with the compound one. The old constraint
-- was created by Prisma as machine_layouts_location_id_key.
CREATE UNIQUE INDEX IF NOT EXISTS machine_layouts_location_id_revision_key
  ON machine_layouts (location_id, revision);

ALTER TABLE machine_layouts DROP CONSTRAINT IF EXISTS machine_layouts_location_id_key;
DROP INDEX IF EXISTS machine_layouts_location_id_key;
