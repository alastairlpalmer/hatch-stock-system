-- Performance indexes for Hatch Stock Tracker.
-- Names match Prisma's default index naming (<table>_<columns>_idx) so that a
-- later `prisma db push` recognises them and does not recreate them.
--
-- Run each statement INDIVIDUALLY (CREATE INDEX CONCURRENTLY cannot run inside
-- a transaction block, and the Supabase SQL editor wraps multi-statement
-- scripts in one). CONCURRENTLY avoids locking writes on live tables.

CREATE INDEX CONCURRENTLY IF NOT EXISTS "sales_timestamp_idx" ON "sales" ("timestamp");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "sales_sku_idx" ON "sales" ("sku");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "order_items_order_id_idx" ON "order_items" ("order_id");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "stock_batches_warehouse_id_sku_idx" ON "stock_batches" ("warehouse_id", "sku");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "stock_batches_expiry_date_idx" ON "stock_batches" ("expiry_date");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "stock_removals_warehouse_id_created_at_idx" ON "stock_removals" ("warehouse_id", "created_at");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "restock_records_location_id_created_at_idx" ON "restock_records" ("location_id", "created_at");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "stock_checks_location_id_created_at_idx" ON "stock_checks" ("location_id", "created_at");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "vendlive_sync_logs_created_at_idx" ON "vendlive_sync_logs" ("created_at");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "vendlive_stock_syncs_vendlive_machine_id_created_at_idx" ON "vendlive_stock_syncs" ("vendlive_machine_id", "created_at");
