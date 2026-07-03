# Orders action hub (mobile) + pick lists live only under Restock

Replicates the Restock action-hub pattern in the Orders area, per feedback on #37.

## Orders hub

On phones, the Orders bottom tab now opens an action hub with three big tap targets (desktop `/orders` still redirects to Purchase Orders as before):

- **Warehouse Stock** → stock on hand, expiry batches, transfers
- **Plan Buy** → lands with the weekly-buy planner already open (`?generate=1`)
- **Receive Order** → pending + completed orders and check-in; shows an amber **"N pending"** badge when deliveries are waiting

Plus a quiet "Buying lists →" link underneath (part of the buy flow, not one of the three key jobs).

## Pick lists → Restock only

The Pick Lists cross-link tab added to the Orders strip in #37 is removed — pick-list generation now lives solely in the Restock area (Restock hub card + tab strip), where the job belongs.

Frontend-only; no migration, no backend change.

## Verification

- Preview 375×812: `/orders` renders the hub (3 cards + buying-lists link), Pick Lists tab absent from the strip, Plan Buy card lands on the planner already open.
- Desktop 1280×800: `/orders` redirects to Purchase Orders exactly as before; 4-tab strip unchanged.
- `npm run build` clean.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
