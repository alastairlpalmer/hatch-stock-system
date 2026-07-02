# Expiry intelligence: machine-level expiry, expiry-aware pick lists, waste report

Phase C — closes the expiry blind spot: stock in machines now carries its expiry date (VendLive already sends it; we were dropping it), pick lists warn when you're packing tomorrow's waste, receiving nags on missing dates, and waste finally has a report.

## ⚠️ Deploy steps (order matters)

1. **Run `hatch-backend/manual-sql/014_expiry_intel.sql` in the Supabase SQL editor first** (idempotent; one column + index on `location_stock`).
2. Deploy backend (Railway), then frontend (Vercel).

## Machine-level expiry (from VendLive)

- Every stock sync now captures the earliest channel expiry per SKU into `LocationStock.earliestExpiry` — the data VendLive was already sending.
- New `GET /api/inventory/machine-expiry?days=N` and a dashboard **"Expiring in machines"** panel (7-day window): "Chicken Wrap × 4 — Kitchen — expires Mon 6 Jul (3d)", red when ≤2 days. Hidden entirely when there's nothing expiring.
- Location Stock rows show a small expiry chip per product (`exp 5d` / `expired`).

## Expiry-aware pick lists

- FEFO batch allocations that expire **before the next restock** (target date + 7 days) are flagged; the pick list shows an amber banner ("N units will expire before the next restock — sell first or pull") and flagged pull instructions are marked on screen and `(EXPIRES SOON)` on the printout.

## Receiving nag

- Submitting a receipt with lines missing expiry dates now requires ticking "Receive without expiry dates" after an explicit warning — soft block, no hard stop.

## Waste report

- New `GET /api/reports/waste?months=N` + a **Waste** tab on the Shrinkage page: per-month write-off units/cost and shrinkage attributed to expired/damaged, plus an "Expired on shelf now" card with the current dead batches.

## Verification

- Backend: 214/214 vitest tests green (17 files; 23 new: expiry-flag boundaries, waste month-bucketing, loss orientation)
- Frontend: production build clean; all surfaces degrade gracefully when the API is unreachable (verified in preview)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
