# Fresh meals ordered at meal-type level (rotating weekly menu)

The Frive menu changes every week, so expanding a "Meat" suggestion into this week's flavour SKUs produced orders for products that won't exist by delivery. Fresh meals are now ordered the way the Location Stock page treats them — as **Meat / Veg + Vegan buckets** — with actual flavours resolved only at receiving, when the box is in hand.

**No DB migration** — placeholders are ordinary product rows created on demand. Deploy backend then frontend as usual.

## Buying lists

- Fresh-meal groups stay as ONE meal-type line ("Meat — fresh meals × 40", tagged *rotating menu*) — no flavour expansion at save time.
- Same on the PDF, public share view and copy-as-WhatsApp text ("rotating menu" in the SKU column).

## Purchase orders

- POs order against one **auto-managed placeholder product per meal type** (`FRIVE-MEAT`, `FRIVE-VEG-VEGAN`…, category "Fresh Meal Order"). Placeholders are deliberately not `isFreshMeal`, so they never join fresh-meal group aggregation in suggestions or pick lists.
- Both the buying-list → create-orders path and the planner's direct create-POs path resolve placeholders (new `POST /api/products/fresh-meal-placeholders`).

## Receiving — flavour allocation

- A placeholder line on the receive screen becomes an **"allocate flavours"** block with an "N of M allocated" counter: per-flavour rows with a dropdown filtered to that meal type, or "+ New flavour" (SKU + name typed from the label — auto-created as a confirmed fresh meal inheriting the meal type), each with its own qty, expiry and damage fields.
- New `forSku` receive-line field: units count against the placeholder ORDER line while the batch is booked under the **real flavour SKU** — so expiry tracking, FEFO pick lists and machine stock all keep working on real products.
- Server-side rules: per-line sums validated against outstanding quantity, over-allocation rejected, and `forSku` allocation is only allowed against placeholder lines (no arbitrary substitution on normal lines). Works with partial receiving / close-short as usual.

## Verification

- Backend: 232/232 vitest tests green (7 new allocation cases: multi-flavour split, oversubscription, prior partial receipts, self-reference, mixed receipts)
- Frontend: production build clean

🤖 Generated with [Claude Code](https://claude.com/claude-code)
