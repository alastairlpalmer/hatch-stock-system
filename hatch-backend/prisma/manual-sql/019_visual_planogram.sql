-- Manual migration — apply against production yourself (do NOT use prisma db push).
-- Visual planogram: per-location fridge layout + temporal slot assignments.
--
-- machine_layouts: one row per location; shelves jsonb = [{ "shelf": 1, "slots": 6 }]
--   (shelf 1 = top, slots = equal-width facings 1..26 lettered A..Z left->right).
--
-- slot_assignments: append-only temporal table — the source of truth for what
--   is IN the fridge this week. Current planogram = rows WHERE valid_to IS NULL
--   (partial unique index guarantees one open assignment per physical slot).
--   Saves close changed rows (set valid_to) and insert replacements, so sales
--   can later be joined by (location_id, sku, timestamp) to slot position for
--   the shelf heatmap. sku deliberately has NO FK so history survives product
--   churn. A slot targets either a SKU or a fresh-meal bucket (target_type
--   'mealType') — Frive flavours rotate weekly inside a stable group slot.
--
-- Idempotent and safe to re-run.
--
-- Apply with e.g.:  psql "<DIRECT_DATABASE_URL>" -f prisma/manual-sql/019_visual_planogram.sql
-- (or paste into the Supabase SQL editor, on project Stock_Tracker).

CREATE TABLE IF NOT EXISTS machine_layouts (
  id          text PRIMARY KEY,
  location_id text NOT NULL UNIQUE REFERENCES locations(id) ON DELETE CASCADE,
  shelves     jsonb NOT NULL,
  created_at  timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  timestamp(3) NOT NULL
);

CREATE TABLE IF NOT EXISTS slot_assignments (
  id          text PRIMARY KEY,
  layout_id   text NOT NULL REFERENCES machine_layouts(id) ON DELETE CASCADE,
  location_id text NOT NULL,
  shelf       integer NOT NULL,
  position    integer NOT NULL,
  slot_code   text NOT NULL,
  target_type text NOT NULL,
  sku         text,
  meal_type   text,
  valid_from  timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  valid_to    timestamp(3),
  CONSTRAINT slot_assignments_target CHECK (
    (target_type = 'sku' AND sku IS NOT NULL) OR
    (target_type = 'mealType' AND meal_type IS NOT NULL)
  )
);

-- Exactly one OPEN assignment per physical slot; closed history rows unlimited.
CREATE UNIQUE INDEX IF NOT EXISTS slot_assignments_current_unique
  ON slot_assignments (layout_id, shelf, position) WHERE valid_to IS NULL;

CREATE INDEX IF NOT EXISTS slot_assignments_location_id_valid_to_idx
  ON slot_assignments (location_id, valid_to);
CREATE INDEX IF NOT EXISTS slot_assignments_layout_id_valid_to_idx
  ON slot_assignments (layout_id, valid_to);
