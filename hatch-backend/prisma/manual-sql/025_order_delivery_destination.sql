-- Manual migration — apply against production yourself (do NOT use prisma db push).
-- Order delivery destination: the manual PO form has always collected a
-- warehouse (or a free-text custom address), but the create endpoint's zod
-- schema stripped both fields, so they never reached the DB and receiving
-- could not pre-select the destination warehouse. These columns make the
-- form's selection stick. Both nullable; existing rows are unaffected.
--
-- Apply BEFORE deploying the matching backend. Idempotent.
--
-- Apply with e.g.:  psql "<DIRECT_DATABASE_URL>" -f prisma/manual-sql/025_order_delivery_destination.sql
-- (or paste into the Supabase SQL editor, on project Stock_Tracker).

ALTER TABLE orders ADD COLUMN IF NOT EXISTS warehouse_id text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS custom_address text;
