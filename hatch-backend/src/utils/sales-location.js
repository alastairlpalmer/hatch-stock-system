import { Prisma } from '@prisma/client';

/**
 * Resolve each sale to a Hatch locationId, for per-location velocity / ordering.
 *
 * Two paths, in priority order:
 *  1. MACHINE — the sale's VendLive machine -> its mapped location
 *     (vendlive_machine_mappings.location_id). This is the ongoing source for
 *     VendLive-synced sales and stays correct over a trailing velocity window:
 *     the mapping reflects the machine's CURRENT site, which is exactly what we
 *     want when forecasting demand at a location now.
 *     NOTE the join column: sales.vendlive_machine_id carries the order-sales /
 *     webhook feed's machine id, which is a DIFFERENT namespace from the
 *     /machines/ API id in vmm.vendlive_machine_id — so the join is on
 *     vmm.sales_machine_id, which the ingest paths backfill from the sales feed
 *     (see resolveSalesMachineMapping in services/vendlive-sync.js).
 *  2. NAME — fall back to matching the (merge-canonicalised) location_name to a
 *     Location by name, for legacy CSV-imported rows with no machine id.
 *
 * The name match is wrapped in LATERAL ... ORDER BY ... LIMIT 1 so that
 * duplicate Location names (Location.name is not unique) can never fan out a
 * sale into multiple rows and double-count it in aggregates, and the pick is
 * deterministic: active locations beat archived ones, then the oldest wins.
 *
 * Callers must alias the sales table `s` and splice SALE_LOCATION_JOINS into the
 * FROM clause. Use SALE_LOCATION_ID as the resolved id and SALE_LOCATION_SOURCE
 * to report how a sale resolved.
 */
export const SALE_LOCATION_JOINS = Prisma.sql`
  LEFT JOIN vendlive_machine_mappings vmm ON vmm.sales_machine_id = s.vendlive_machine_id
  LEFT JOIN LATERAL (
    SELECT id FROM locations
    WHERE name = s.location_name
    ORDER BY (archived_at IS NOT NULL), created_at, id
    LIMIT 1
  ) lname ON true`;

export const SALE_LOCATION_ID = Prisma.sql`COALESCE(vmm.location_id, lname.id)`;

export const SALE_LOCATION_SOURCE = Prisma.sql`
  CASE
    WHEN vmm.location_id IS NOT NULL THEN 'machine'
    WHEN lname.id IS NOT NULL THEN 'name'
    ELSE 'unresolved'
  END`;
