-- Manual migration — apply against production yourself (do NOT use prisma db push).
-- Per-slot fill capacity for the visual planogram.
--
-- slot_assignments.capacity: optional per-slot override of how many units fit
--   in that facing. The shelf-level default lives INSIDE machine_layouts.shelves
--   jsonb entries as "unitsPerSlot" ({ "shelf": 1, "slots": 6, "unitsPerSlot": 8 })
--   so no DDL is needed for it. Effective slot capacity =
--   COALESCE(slot.capacity, shelf.unitsPerSlot); a target's fill capacity is the
--   sum across the slots it occupies, and falls back to LocationConfig /
--   LocationMealConfig maxStock when any occupied slot has no capacity.
--
-- Safe/additive: one nullable column, touches no existing data. Idempotent.
--
-- Apply with e.g.:  psql "<DIRECT_DATABASE_URL>" -f prisma/manual-sql/022_slot_capacity.sql
-- (or paste into the Supabase SQL editor, on project Stock_Tracker).

ALTER TABLE slot_assignments ADD COLUMN IF NOT EXISTS capacity integer;
