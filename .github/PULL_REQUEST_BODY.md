# Mobile table fixes — nothing cut off, cards where it counts

Follow-up to #37/#38: inside pages, wide tables were cut off on phones — several sat in `overflow-hidden` cards with no scroll wrapper, so side-scroll didn't work at all (the Location Stock bug reported). Every column's information and every interaction is preserved; desktop rendering is unchanged (all mobile layouts sit behind `md:` breakpoints).

## Two-tier fix

**Tier 1 — universal guarantee:** every `<table>` in the app now sits inside an `overflow-x-auto` wrapper *inside* its rounded card — nothing is clippable at any width. Swept: Location Stock, Inventory (7 tables), History, Users, Sales Overview (3), Shrinkage (4), Admin (2), Orders planner + predictions, Buying List detail.

**Tier 2 — real mobile card layouts** (`md:hidden` cards + `hidden md:block` desktop table) for the phone-critical surfaces:

- **Location Stock** (the reported page): per-product cards with the expiry chip, price/margin/status, qty — read-only "via VendLive" in live mode, editable input **plus −10/−1/+1/+10 buttons** otherwise — and min/max config inputs; fresh-meal groups keep their expand/collapse with member flavours as indented cards.
- **Inventory**: single-warehouse stock (category headers, qty/value, expiry chip, Edit, expandable batch detail), Missing Expiry (date input + Save inline), Items Requiring Attention, and All Batches with **full inline editing** (qty/expiry/damage/save/cancel/delete) in card form.
- **History**: removal/restock cards with full item lists always visible.
- **Users**: cards with the two-tap delete confirm and the masked inline password-reset form working in card layout.
- **Sales Overview → Transactions**: product/amount/time/badge cards.
- **Buying List detail**: per-line cards inside each supplier section with draft-mode qty/£ inputs, boxes, line totals and remove — the weekly buy is reviewable on a phone.

Admin tables and low-traffic drill-downs (all-warehouses matrix, missing-cost, By Product/Daily sales) stay as tables with working horizontal scroll — deliberate: they're desktop-first surfaces.

No handlers, state or data flow touched — wrapper divs and responsive visibility only.

## Verification

- Production build clean.
- Preview at 375×812: no horizontal page overflow on the swept pages; Transactions mobile cards + Shrinkage scroll wrappers live-verified in DOM; Location Stock renders with the (empty-state) card container active. Data-populated card layouts verified structurally — worth a 2-minute phone pass after deploy on Location Stock and Inventory with real data.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
