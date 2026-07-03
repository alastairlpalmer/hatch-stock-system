# Supplier ordering config + VendLive prediction cross-check

Phase D (minus auth, deferred) — suppliers gain ordering config that the buying flow actually uses, and the planner gets VendLive's own predictions as a sanity check.

## ⚠️ Deploy steps (order matters)

1. **Run `hatch-backend/manual-sql/015_supplier_config.sql` in the Supabase SQL editor first** (idempotent; three nullable supplier columns).
2. Deploy backend (Railway), then frontend (Vercel).

## Supplier ordering config

- Suppliers now carry **order days** (e.g. Wed/Thu), **lead time** (days to delivery) and **minimum order value** — edited in Admin → Suppliers (weekday toggle chips, two number fields, config summary in the table).
- **Buying list detail**: each supplier section shows order-day and lead-time chips plus a live minimum-order indicator — amber "£38 short of £150 minimum" with a progress bar while under, "minimum met ✓" once over; recomputes as quantities are edited.
- **Weekly-buy planner**: same order-day chips and shortfall warning on each supplier group header.
- **PO creation from a buying list**: expectedDate now uses the supplier's lead time (order date + lead days) when configured, falling back to the Saturday before the target restock Monday.
- **PDF**: supplier sections print their order days/lead time and a shortfall warning line when under minimum.
- Suppliers route gains zod validation (previously none).

## VendLive prediction cross-check

- New `GET /api/vendlive/predictions?locationId=` wrapping VendLive's `/stock-report/?predictions` (previously dead code) — per mapped machine, best-effort normalised `{name, sku, currentStock, predicted}` rows; upstream failures return 502, not configured 409, no mapped machines 404.
- Planner gains a collapsible **"VendLive predictions (cross-check)"** panel: per selected location, a Compare button renders VendLive's current/predicted numbers side-by-side — informational only, never merged into the suggestion lines.

## Verification

- Backend: 225/225 vitest tests green (19 files; new: supplier schema validation, stock-report normaliser incl. hostile payload shapes)
- Frontend: production build clean; supplier form, planner chips and predictions panel verified in preview

🤖 Generated with [Claude Code](https://claude.com/claude-code)
