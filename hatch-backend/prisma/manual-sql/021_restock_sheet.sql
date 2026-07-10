-- Manual migration — apply against production yourself (do NOT use prisma db push).
-- Restock sheet share links: add a share_token to machine_layouts, mirroring
-- BuyingList.shareToken — the unguessable uuid is the credential for the
-- public read-only 3PL restock sheet (/share/restock-sheet/:token).
--
-- Idempotent and safe to re-run. Apply AFTER 019_visual_planogram.sql.
--
-- Apply with e.g.:  psql "<DIRECT_DATABASE_URL>" -f prisma/manual-sql/021_restock_sheet.sql
-- (or paste into the Supabase SQL editor, on project Stock_Tracker).

ALTER TABLE machine_layouts ADD COLUMN IF NOT EXISTS share_token text;

UPDATE machine_layouts SET share_token = gen_random_uuid()::text WHERE share_token IS NULL;

ALTER TABLE machine_layouts ALTER COLUMN share_token SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS machine_layouts_share_token_key
  ON machine_layouts (share_token);
