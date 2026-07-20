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
(`001` → `029`). Each ships with the backend deploy that depends on it — apply
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
