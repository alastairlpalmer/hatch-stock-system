-- Manual migration — apply against production yourself (do NOT use prisma db push,
-- which would diff the whole schema). Adds the client_reports table for Feature 2.
-- Safe/additive: creates one new table, touches no existing data.
--
-- Apply with e.g.:  psql "<DATABASE_URL>" -f prisma/manual-sql/001_client_reports.sql

CREATE TABLE IF NOT EXISTS "client_reports" (
  "id"             TEXT NOT NULL,
  "client_name"    TEXT NOT NULL,
  "site_name"      TEXT NOT NULL,
  "location_names" JSONB NOT NULL DEFAULT '[]',
  "route_id"       TEXT,
  "period_start"   TIMESTAMP(3) NOT NULL,
  "period_end"     TIMESTAMP(3) NOT NULL,
  "version"        INTEGER NOT NULL DEFAULT 1,
  "file_name"      TEXT NOT NULL,
  "pdf_data"       BYTEA NOT NULL,
  "pdf_size"       INTEGER NOT NULL,
  "generated_by"   TEXT,
  "generated_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "client_reports_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "client_reports_site_name_period_start_period_end_idx"
  ON "client_reports" ("site_name", "period_start", "period_end");
