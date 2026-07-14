-- 019: Restock planner calendar (Restock > Planner).
-- The frontend renders the weekly defaults itself (Monday = restock,
-- Friday = de-stock); this table only stores overrides and ad-hoc entries
-- keyed by (date, kind): assignees/notes decorate a default, status
-- 'cancelled' hides it, a row on any other day is an ad-hoc run.
-- Run in the Supabase SQL editor BEFORE deploying the backend that ships
-- with this file. Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS restock_plan_entries (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date       date NOT NULL,
  kind       text NOT NULL CHECK (kind IN ('restock', 'destock')),
  status     text NOT NULL DEFAULT 'planned', -- 'planned' | 'cancelled'
  assignees  text[] NOT NULL DEFAULT '{}',
  notes      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (date, kind)
);
