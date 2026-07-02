# VendLive trust: mapping fix, sale quarantine, refund restore, sync-health dashboard

Phase A of the robustness plan — makes the VendLive data every other number depends on trustworthy, and surfaces sync problems on the dashboard instead of failing silently.

## ⚠️ Deploy steps (order matters)

1. **Run `hatch-backend/manual-sql/012_vendlive_trust.sql` in the Supabase SQL editor first** (idempotent). It merges the duplicate machine-mapping rows created by VendLive's two id namespaces and adds the quarantine table.
2. Deploy backend (Railway), then frontend (Vercel).

## Machine-ID namespace fix

VendLive uses two machine-id namespaces (/machines/ API vs order-sales feed). One mapping row per physical machine now holds **both ids** (`vendliveMachineId` + new `salesMachineId`); the friendly name is the cross-namespace key. Sales location resolution joins on the sales-namespace id first (name fallback now deterministic); ingest backfills `salesMachineId` on first sight and never creates duplicate rows; machine auto-detect adopts sales-created rows instead of duplicating them. Fixes wrong/nondeterministic sales attribution, missed stock decrements, and indistinguishable mapping rows.

## Unknown-SKU sale quarantine

Sales for products not yet in the system were silently dropped forever (poll checkpoint advanced past them). They now land in a `vendlive_quarantined_sales` table with the full normalized payload, and Admin → VendLive gains a **Quarantined Sales** panel with one-click **Replay** (books them once the product exists; deliberately no retro stock decrement — the next full machine sync reflects reality) and per-row discard.

## Refunds restore machine stock

A refund flip now increments the mapped location's stock back, so DB fill levels stop drifting low between full syncs. Poll stock movements are also buffered per chunk and applied only after the transaction commits (failed chunks no longer leak decrements into a re-poll double-apply).

## Sync health on the dashboard

New `GET /api/vendlive/health` + a dashboard panel (replaces the old thin "VendLive Connected" line):

- Healthy → one emerald line: "VendLive healthy · sales synced 12m ago · stock synced Fri 20:00"
- Problems → amber/red card with plain sentences: stale sales sync (> 3× poll interval), stale stock sync (> 4 days), quarantined sales count, unmapped machines, sync errors in last 24 h — each linking to Settings. Counts `partial` syncs with created sales as successes (they are).
- Auto-refreshes every 5 minutes; failure to reach the API shows its own warning without breaking the dashboard.

## Admin → VendLive completions

Settings the backend always supported but the UI never exposed: **stock sync** (enable, interval, movement types, auto-shrinkage), **product catalog sync** (enable, interval in hours, last run), **webhook secret** (write-only — the webhook fails closed without one, so it was previously unconfigurable). Plus a stock-sync history panel and both ids shown in the mapping table. Silent save-error swallowing replaced with inline errors.

## Verification

- Backend: 180/180 vitest tests green (9 new DB-mocked suites: mapping preference/backfill, quarantine, refund restore)
- Frontend: production build clean; dashboard card states verified in preview

🤖 Generated with [Claude Code](https://claude.com/claude-code)
