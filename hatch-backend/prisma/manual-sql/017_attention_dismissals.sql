-- 017: Admin dismissals for Dashboard "Needs attention" items.
-- Run in the Supabase SQL editor BEFORE deploying the backend that ships with
-- this file. Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS attention_dismissals (
  item_id      text PRIMARY KEY,
  signature    text NOT NULL,
  dismissed_by text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
