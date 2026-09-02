# Manual SQL — apply during a maintenance window

These scripts go with schema changes that must NOT be applied via
`prisma migrate deploy`: the migration history in `prisma/migrations/` has
diverged from production (the VendLive tables were created with `prisma db push`
and have no migrations), so `migrate deploy` would fail or attempt to recreate
existing tables.

**How to apply:** paste each script into the Supabase SQL editor (or `psql`
against the DIRECT_DATABASE_URL) after taking a backup. Scripts are written to
be idempotent (`IF NOT EXISTS`) and safe to re-run.

**Ordering:** apply the numbered scripts in ascending numeric order
(`001` → `035`). Each ships with the backend deploy that depends on it — apply
the script BEFORE deploying that backend. This directory is the single source
of truth; the old top-level `hatch-backend/manual-sql/` directory (which held
`011`–`018` and a colliding second `019`) was merged in here. The collision —
`019_restock_planner.sql` vs `019_visual_planogram.sql` — was resolved by
renumbering the restock planner script to `029_restock_planner.sql`. It was
applied to production in its original position (between 018 and 020); on a
fresh database, applying it last works fine as it has no dependencies on
020–028.

## Applied sequence

`001`–`010`: client reports, fresh meals + backfill, stock transfers, users,
ordering config, product catalog sync, batch reconciliation ×2, archive
locations.

`011`–`018` (merged from the old top-level directory): weekly cycle, VendLive
trust/dedupe, route run, expiry intel, supplier config, lowercase emails,
attention dismissals, planogram mirror.

`019`–`028`: visual planogram, fresh-meal category backfill, restock sheet,
slot capacity, pick-list planogram, layout revisions, order delivery
destination, product parents, planogram parent slots, pick-list location
confirmations.

`029`: restock planner (renumbered — see above; applied in production between
018 and 020).

`030`–`032`: buying-list shared_at, pick-list location_ids, Hill St config copy
+ family backfill. Applied 2026-08-31 — late: the backends that needed 030/031
were already deployed, which broke all pick-list queries (missing
`pick_lists.location_ids`) until the scripts were run. Apply BEFORE merging a
schema-touching PR to main; Railway deploys main immediately.

`033`: supplier invoices — `supplier_invoices`, `supplier_invoice_lines`,
`price_history`, plus `order_items.invoiced_qty`/`invoiced_unit_price` and
`products.supplier_code`/`cost_locked`. Seeds one baseline `price_history` row
per costed product so the first reconcile has something to compare against.
**Not yet applied.**

`034`: product trials — `products.lifecycle` (active | trial | discontinued)
and the `product_trials` table. A `trial` product bypasses the assignment,
planogram and velocity gates in the ordering and picking engines and fills to
its trial quantity instead. **Not yet applied.**

`035`: supplier minimums — `suppliers.min_order_units` and
`free_delivery_value`, so a supplier's floor can be a case count as well as a
pound value, and free delivery is tracked as the separate (softer) threshold it
is. Feeds the minimum-order top-up planner. **Not yet applied.**

## `pending/` — NOT part of the applied sequence

| Script | What | When |
|--------|------|------|
| `pending/01-performance-indexes.sql` | Secondary indexes matching the `@@index` entries added to schema.prisma. Names match Prisma's defaults so a later `db push` treats them as already present. | Any quiet period. `CREATE INDEX CONCURRENTLY` does not lock writes. Run statements ONE AT A TIME (CONCURRENTLY cannot run inside a transaction block). |
| `pending/02-money-to-decimal.sql` | Converts money columns from `double precision` to `numeric(12,2)`. | Maintenance window + backup. **Only apply together with the matching schema.prisma change (Float → Decimal) and a redeploy**, otherwise Prisma's generated client and the DB disagree. Not yet reflected in schema.prisma — see comments in the script. |

These two previously sat loose in this directory with `01-`/`02-` prefixes
that sorted BEFORE `010_…` in a plain file listing, inviting out-of-order
application (02 applied on its own breaks every money field at runtime). They
live in `pending/` precisely so no one applies them as part of the numbered
sequence.

## Reconciling migration history (one-off, after the above)

```bash
# 1. Take a backup.
# 2. Generate a baseline migration that matches the CURRENT schema:
npx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script > baseline.sql
# 3. Replace the stale migrations with a single baseline folder, then mark it applied:
npx prisma migrate resolve --applied <baseline_migration_name>
```

Until that is done, keep using `prisma db push` (review the diff it prints
before confirming) and never run `prisma migrate deploy` against production.
