# Mobile-first stock checks

Rebuilds the machine stock check for one-handed phone use, and hardens how shrinkage numbers are recorded.

**No database migration needed** — deploy backend then frontend as usual.

## The flow at the machine

- One row per product the machine should contain (stock > 0 ∪ assigned items — no more whole-catalogue lists): product name, expected count, a big **✓** for "count is correct", or tap **Found** to type the real number (numeric keypad). Delta chips (−2 red / +1 blue) on discrepancies.
- Progress bar, search (also adds unexpected items found in the machine), **"Confirm remaining as correct"** one-tap, and submit is blocked until every line is addressed — every check is a complete audit.
- Review screen before submit: discrepancies only, with unit + £ impact, then a timestamped check is stored and machine stock is set to the found numbers.
- Lives in two places: **step 2 of the Restock Machine wizard** (replaces the desktop-grid count) and a new standalone **Restock → Stock Check** tab for spot-checks (remembers the checker's name).

## Integrity hardening

- `POST /inventory/stock-checks` now computes `expected` and `variance` **server-side from live location stock inside the transaction** — client-sent values are ignored, so theft/shrinkage figures can't be forged or go stale between loading and submitting. Ticked items are stored explicitly as `confirmed`.
- Manual checks are tagged `source: 'manual'` (VendLive auto-checks already tag `vendlive`), keeping the Shrinkage page's per-source variance normalisation sound.
- New `PATCH /inventory/stock-checks/:id/items/:sku` lets the operator categorise a discrepancy after the fact.

## Shrinkage page

- New **Discrepancies** tab: each loss line with one-tap reason chips (Theft / Expired / Damaged / Miscount / Unknown) — reasons are deliberately not asked at the machine; attribution happens here.
- Fixed the Restock Machine "Skip (use recent check)" sort bug (undefined `timestamp` on API records).

## Verification

- Backend: 170/170 vitest tests green
- Frontend: production build clean; full flow verified in mobile-width preview (tick → deltas → confirm-remaining → review → submit → wizard variance summary → Shrinkage reason chips incl. optimistic revert on error)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
