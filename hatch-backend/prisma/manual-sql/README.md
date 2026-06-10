# Manual SQL — apply during a maintenance window

These scripts go with schema changes that must NOT be applied via
`prisma migrate deploy`: the migration history in `prisma/migrations/` has
diverged from production (the VendLive tables were created with `prisma db push`
and have no migrations), so `migrate deploy` would fail or attempt to recreate
existing tables.

**How to apply:** paste each script into the Supabase SQL editor (or `psql`
against the DIRECT_DATABASE_URL) after taking a backup. Scripts are written to
be idempotent (`IF NOT EXISTS`) and safe to re-run.

| Script | What | When |
|--------|------|------|
| `01-performance-indexes.sql` | Secondary indexes matching the `@@index` entries added to schema.prisma. Names match Prisma's defaults so a later `db push` treats them as already present. | Any quiet period. `CREATE INDEX CONCURRENTLY` does not lock writes. Run statements ONE AT A TIME (CONCURRENTLY cannot run inside a transaction block). |
| `02-money-to-decimal.sql` | Converts money columns from `double precision` to `numeric(12,2)`. | Maintenance window + backup. **Only apply together with the matching schema.prisma change (Float → Decimal) and a redeploy**, otherwise Prisma's generated client and the DB disagree. Not yet reflected in schema.prisma — see comments in the script. |

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
