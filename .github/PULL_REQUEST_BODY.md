# Desktop action flows: "Needs attention" rail, Orders landing, live workflow status

Brings the mobile action-hub + prioritisation patterns to desktop (per feedback on #37/#38) — not the navigation, the *flows*. Four commits, reviewable independently. Frontend-only.

## 1. Shared ActionCard (pure refactor)

The hub card is extracted to `ui/ActionCard.jsx`; the mobile OrdersHub/RestockHub consume it — pixel-identical — so mobile and desktop surfaces can't drift.

## 2. Dashboard → mission control

A **"Needs attention"** rail now leads the Dashboard (everything else unchanged below): a priority-ordered list — red first — of exactly what needs doing, each row linking to the fix:

- red: VendLive sync stale (ranked first — stale sync taints every number below) · machines with sold-out items · expired warehouse batches (units to write off) · machine items expiring ≤2 days · warehouse batches expiring ≤7 days
- amber: orders to receive (with partial-receipt detail) · draft pick lists due · packed list with shortfalls · machines running low · machine items expiring ≤7 days · VendLive housekeeping (quarantine/unmapped/errors)

Top 6 with a "+N more" expander; emerald "All clear" when empty. Free items render instantly from in-memory data; three independent fail-silent fetches (health, machine expiry, pick lists) merge in — any failure just omits that group, never breaks the page.

## 3. Orders desktop landing

`/orders` no longer dumps you into Purchase Orders. Desktop gets the action landing: card grid (Plan Buy → planner auto-open, Receive with pending badge, Warehouse Stock, Buying Lists) + a **pending-orders snapshot** — top 5 by soonest expected delivery with supplier, line count, receive-progress chip and £ total, each row jumping straight to receiving. Tab strip unchanged; mobile hub untouched.

## 4. Restock workflow — live status

The 3-step cards now show state at a glance: step 1 carries the **route name**, step 2 shows the run's pick list as **Draft / Packed / Packed · N short** (scoped to the active list or selected route via the shared `usePickLists` hook), step 3 shows **Run complete**. A quick-actions row (Stock Check, Log a Restock) sits between the steps and Reporting.

## Verification

- 1280px: rail leads Dashboard with stats identical below; `/orders` renders the landing (no redirect), tabs fine; `/restock` shows workflow + quick actions.
- 375px regression: both mobile hubs render exactly as before; no page overflow.
- API-down grace: rail renders (free items / all-clear), workflow badge simply absent, no unhandled rejections.
- `npm run build` clean.

Known cosmetic quirk (commented in code): the rail fetches health once while the sync-health panel below polls every 5 minutes — they can disagree briefly after a panel refresh.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
