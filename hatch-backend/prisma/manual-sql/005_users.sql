-- Manual migration — apply against production yourself (do NOT use prisma db push,
-- which would diff the whole schema). Creates the users table that backs the
-- auth/login system (matches the Prisma `User` model in schema.prisma).
-- Safe/additive: creates one new table, touches no existing data. Idempotent.
--
-- Apply with e.g.:  psql "<DIRECT_DATABASE_URL>" -f prisma/manual-sql/005_users.sql
-- (or paste into the Supabase SQL editor) after taking a backup.
--
-- After applying: set AUTH_ENABLED=true + a strong JWT_SECRET on the backend,
-- then register the first admin via the login page (first user becomes admin).

CREATE TABLE IF NOT EXISTS "users" (
  "id"         TEXT NOT NULL,
  "email"      TEXT NOT NULL,
  "password"   TEXT NOT NULL,
  "name"       TEXT,
  "role"       TEXT NOT NULL DEFAULT 'user',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "users_email_key" ON "users" ("email");
