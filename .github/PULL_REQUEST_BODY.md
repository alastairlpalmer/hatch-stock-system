# Route-run: prefilled restocks, run progress, van reconciliation

Phase B — closes the loop between pick list → van → machines. The restocker packs from the pick list, runs the route from one screen, restocks each machine with quantities already filled in, and reconciles what's left in the van at the end.

## ⚠️ Deploy steps (order matters)

1. **Run `hatch-backend/manual-sql/013_route_run.sql` in the Supabase SQL editor first** (idempotent; two small columns).
2. Deploy backend (Railway), then frontend (Vercel).

## Today's Run (new page, Restock → Today's Run)

- Starts from the most recent packed pick list (or "Start the run" straight from a just-packed list). Machines listed in route order with planned units and two status chips — Check ✓ and Restock ✓ with times — plus progress ("2 of 5 machines done") and a done banner when the route is complete (which also completes the workflow hub's step 3).
- **Check** deep-links into the mobile stock check with the machine preselected and returns to the run afterwards.
- **Restock** deep-links into the wizard: machine preselected, restocker name remembered, and step 3's quantities **prefilled from that machine's share of the pick list** (editable). The restock record is linked to the pick list.

## Van reconciliation

- Bottom panel: "Packed 120 · Loaded 108 · Returned 0 · In van 12" with a per-SKU breakdown (packed / loaded / returned / remaining).
- **Return leftovers to warehouse**: prefilled with the remaining quantities, editable, then booked back as warehouse batches carrying the earliest expiry of the SKU's original allocation (conservative for FEFO) — over-returns rejected server-side.

## Backend

- `RestockRecord.pickListId` links machine loads to the pick list they came from.
- `GET /api/pick-lists/:id/run` — one response with per-location plan, latest stock check + restock status, reconciliation, and `allDone`.
- `POST /api/pick-lists/:id/return-leftovers` — validated returns (409 unless packed; 400 with per-SKU violations on over-return), batch-materialised with expiry provenance.
- Reconciliation math extracted as pure helpers with 13 new tests.

## Verification

- Backend: 193/193 vitest tests green (16 files)
- Frontend: production build clean; run page, deep links, empty/error states verified in preview

🤖 Generated with [Claude Code](https://claude.com/claude-code)
