-- Manual migration — apply against production yourself (do NOT use prisma db push).
-- Planogram-scoped pick lists: records the products/meal groups that were
-- configured for a location but skipped at generation time because they have
-- no slot on the visual diagram ("not on diagram" warning on the draft view).
--
-- Safe/additive: one nullable jsonb column, touches no existing data. Idempotent.
--
-- Apply with e.g.:  psql "<DIRECT_DATABASE_URL>" -f prisma/manual-sql/023_pick_list_planogram.sql
-- (or paste into the Supabase SQL editor, on project Stock_Tracker).

ALTER TABLE pick_lists ADD COLUMN IF NOT EXISTS not_on_planogram jsonb;
