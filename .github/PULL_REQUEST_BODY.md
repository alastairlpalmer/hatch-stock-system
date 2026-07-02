# Weekly ordering cycle rebuild + critical bug fixes

Rebuilds the platform around the actual weekly rhythm (Mon–Fri sales, Wed/Thu ordering for weekend delivery, Monday restock) and fixes the critical data-integrity bugs found in the full-system review.

## ⚠️ Deploy steps (order matters)

1. **Run `hatch-backend/manual-sql/011_weekly_cycle.sql` in the Supabase SQL editor first** (idempotent; adds receiving/buying-list/pick-list tables + columns and backfills history).
2. Deploy backend (Railway), then frontend (Vercel).

## The weekly cycle

- **Trading-day ordering engine** — velocity per Mon–Fri trading day; machine stock projected to the next restock Monday; targets Monday-to-Monday cover; nets off warehouse stock **and** pending POs; `weekly` and `topup` modes; box-rounding capped at machine capacity; archived locations excluded.
- **Buying Lists** (new) — supplier-grouped list saved from the planner: editable draft, copy-as-text (WhatsApp), public share link (token URL, no login), server-rendered PDF, one-click "create one PO per supplier" with expected delivery date.
- **Partial receiving** — POs stay open with per-line received progress; multiple expiry lots per SKU; "apply expiry to all"; explicit close-short; OrderReceipt audit rows power the Receipt History tab; over-receive blocked at the DB level.
- **Pick Lists** (new) — per route + date: fill-to-max quantities per machine, aggregated per SKU, with FEFO batch instructions ("Pull: 12 × exp 05 Jul"); phone tick-off + print stylesheet; "Mark packed" creates the linked warehouse removal.
- **Friday 20:00 Europe/London full VendLive stock sync** — accurate weekend-frozen baseline for Monday planning.

## Critical fixes

- Shrinkage sign inversion (VendLive losses were discarded; overages shown as theft)
- Silent offline fallback → visible banner; warehouse-stock state nesting bug after receive/removal
- Guarded FEFO batch decrements (no negative stock under concurrency); removals/transfers reject shortfalls instead of swallowing them
- Received orders immutable (no reopen → double-receive; no delete); order create/update zod-validated; `expectedDate` persisted
- Expired-today batches no longer classified as sellable; CSV stock imports materialise batches
- Removed the two broken browser-side Anthropic API features (invoice upload, screenshot analysis)
- Inventory add-product flow, Admin refresh button, real health-check panel, delete confirmations, refund-aware Dashboard profit, amber (not green) expiry warnings, restock-run state survives refresh

## Verification

- Backend: 170/170 vitest tests green (incl. new trading-days, ordering-engine, receiving, FEFO suites)
- Frontend: production build clean; all routes/pages manually verified in browser preview

🤖 Generated with [Claude Code](https://claude.com/claude-code)
