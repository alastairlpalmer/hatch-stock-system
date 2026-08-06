-- 031: store the requested location set on pick lists.
--
-- Custom-location pick lists previously kept their location set only inside
-- the items' perLocation entries. A location with zero need at generation
-- time appears in no item, so "Regenerate pick list" (after a 409 stock
-- conflict) silently dropped it — even if its stock had since fallen.
-- Persisting the resolved location ids at generation makes regeneration
-- faithful. Route lists keep NULL (the route itself is the source of truth).
--
-- Apply BEFORE deploying the backend that ships with it. Idempotent.

ALTER TABLE pick_lists
  ADD COLUMN IF NOT EXISTS location_ids JSONB;
