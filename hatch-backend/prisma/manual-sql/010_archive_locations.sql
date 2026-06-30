-- Manual migration — apply against production yourself (do NOT use prisma db push,
-- which would diff the whole schema). Adds a soft-retire flag to locations:
--   archived_at — when set, the location is hidden from the active locations list
--                 (GET /api/locations) but kept for historical reporting. Sales are
--                 tagged by name (not a FK), so their history is unaffected either way.
-- Safe/additive: adds one nullable column, touches no existing data. Idempotent.
--
-- Apply with e.g.:  psql "<DIRECT_DATABASE_URL>" -f prisma/manual-sql/010_archive_locations.sql
-- (or paste into the Supabase SQL editor) after taking a backup.

ALTER TABLE "locations" ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMPTZ;
