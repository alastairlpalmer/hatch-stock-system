-- Manual migration — apply against production yourself (do NOT use prisma db push,
-- which would diff the whole schema). Adds the stock_transfers table for
-- warehouse-to-warehouse stock movement tracking.
-- Safe/additive: creates one new table, touches no existing data. Idempotent.
--
-- Apply with e.g.:  psql "<DIRECT_DATABASE_URL>" -f prisma/manual-sql/004_stock_transfers.sql
-- (or paste into the Supabase SQL editor) after taking a backup.

CREATE TABLE IF NOT EXISTS "stock_transfers" (
  "id"                TEXT NOT NULL,
  "from_warehouse_id" TEXT NOT NULL,
  "to_warehouse_id"   TEXT NOT NULL,
  "performed_by"      TEXT,
  "notes"             TEXT,
  "items"             JSONB NOT NULL,
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "stock_transfers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stock_transfers_from_warehouse_fk"
    FOREIGN KEY ("from_warehouse_id") REFERENCES "warehouses"("id"),
  CONSTRAINT "stock_transfers_to_warehouse_fk"
    FOREIGN KEY ("to_warehouse_id") REFERENCES "warehouses"("id")
);

CREATE INDEX IF NOT EXISTS "stock_transfers_from_warehouse_id_created_at_idx"
  ON "stock_transfers" ("from_warehouse_id", "created_at");
CREATE INDEX IF NOT EXISTS "stock_transfers_to_warehouse_id_created_at_idx"
  ON "stock_transfers" ("to_warehouse_id", "created_at");
