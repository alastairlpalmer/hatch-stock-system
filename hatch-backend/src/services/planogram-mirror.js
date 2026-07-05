import prisma from '../utils/db.js';

// ============ PLANOGRAM → ASSIGNMENT MIRROR ============
//
// The VendLive planogram (channel layout) is the source of truth for WHICH
// products a machine sells. On every successful stock sync the machine's
// planogram snapshot is stored on its mapping, and the location's
// LocationAssignment rows are recomputed as the UNION across all of the
// location's machines — so syncing one machine never wipes a sibling's
// products, and no sibling API calls are ever needed.
//
// Safety properties:
// - An empty planogram (API hiccup / 0 channels) NEVER wipes assignments —
//   the mirror is skipped entirely and the previous snapshot kept.
// - Channel idealCapacity fills LocationConfig.maxStock only where it is
//   currently NULL (write-time guard in the WHERE — a concurrent manual edit
//   always wins). Manual clears write 0, so they are never refilled either.
// - Fresh-meal flavour SKUs are assigned but excluded from maxStock fills:
//   flavours rotate weekly and group capacity lives in LocationMealConfig.
// - The whole mirror is one array-form transaction: failure leaves the old
//   state fully intact.

/**
 * Extract this machine's planogram entries from the aggregated channel stock
 * (aggregateChannelStock output), keeping only SKUs that exist as products
 * (LocationAssignment.sku has no FK — this is the dangling-sku guard).
 * idealCapacity is summed across the SKU's channels in this machine.
 * Pure. Returns { entries: [{ sku, idealCapacity }], unknownSkuCount }.
 */
export function buildPlanogramEntries(vendliveStock, existingSkuSet) {
  const entries = [];
  let unknownSkuCount = 0;
  for (const [sku, info] of Object.entries(vendliveStock || {})) {
    if (!existingSkuSet.has(sku)) {
      unknownSkuCount += 1;
      continue;
    }
    const idealCapacity = (info.channels || []).reduce((sum, ch) => {
      const cap = Number(ch?.idealCapacity);
      return sum + (Number.isFinite(cap) && cap > 0 ? cap : 0);
    }, 0);
    entries.push({ sku, idealCapacity });
  }
  return { entries, unknownSkuCount };
}

/**
 * Union of SKUs across a location's machines' stored planograms. Accepts the
 * raw Json values (array | null | garbage) defensively. Pure; sorted for
 * deterministic diffs/tests.
 */
export function computeAssignmentUnion(planograms) {
  const skus = new Set();
  for (const planogram of planograms || []) {
    if (!Array.isArray(planogram)) continue;
    for (const entry of planogram) {
      if (entry && typeof entry.sku === 'string' && entry.sku) skus.add(entry.sku);
    }
  }
  return [...skus].sort();
}

/** Pure diff for the sync-log metadata. */
export function diffAssignments(currentSkus, nextSkus) {
  const current = new Set(currentSkus || []);
  const next = new Set(nextSkus || []);
  return {
    added: [...next].filter((s) => !current.has(s)).sort(),
    removed: [...current].filter((s) => !next.has(s)).sort(),
  };
}

/**
 * maxStock fills from planogram capacity: per SKU, idealCapacity summed
 * across ALL the location's machines. Fill only where capacity > 0 and the
 * SKU is not a fresh meal; `creates` = no config row exists, `updates` = row
 * exists (caller applies the maxStock IS NULL guard at write time).
 * configRows: [{ sku, maxStock }]. Pure.
 */
export function computeMaxStockFills(planograms, configRows, freshMealSkuSet) {
  const capacityBySku = new Map();
  for (const planogram of planograms || []) {
    if (!Array.isArray(planogram)) continue;
    for (const entry of planogram) {
      if (!entry || typeof entry.sku !== 'string' || !entry.sku) continue;
      const cap = Number(entry.idealCapacity);
      if (!Number.isFinite(cap) || cap <= 0) continue;
      capacityBySku.set(entry.sku, (capacityBySku.get(entry.sku) || 0) + cap);
    }
  }

  const rowBySku = new Map((configRows || []).map((r) => [r.sku, r]));
  const creates = [];
  const updates = [];
  for (const [sku, maxStock] of capacityBySku) {
    if (freshMealSkuSet?.has(sku)) continue;
    const row = rowBySku.get(sku);
    if (!row) creates.push({ sku, maxStock });
    else if (row.maxStock === null || row.maxStock === undefined) updates.push({ sku, maxStock });
  }
  return { creates, updates };
}

/**
 * Run the mirror for one machine's completed sync. Fetches sibling
 * planograms, current assignments/config, then applies everything in one
 * transaction. Never throws for business-state reasons; the caller wraps it
 * in try/catch so an unexpected failure cannot fail the stock sync.
 *
 * @param {Object} p
 * @param {number} p.vendliveMachineId - machines-namespace id (the mapping key)
 * @param {string} p.locationId
 * @param {Array}  p.entries - buildPlanogramEntries output for THIS machine
 * @param {number} p.rawSkuCount - SKU count before the known-product filter
 * @param {number} p.unknownSkuCount
 * @returns metadata object for VendliveStockSync.metadata.planogram
 */
export async function mirrorPlanogramToLocation({ vendliveMachineId, locationId, entries, rawSkuCount, unknownSkuCount }) {
  // Empty-planogram guard: keep the previous snapshot and assignments.
  if (!rawSkuCount) {
    return { mirrored: false, skippedReason: 'empty_planogram' };
  }
  if (!entries.length) {
    return { mirrored: false, skippedReason: 'no_known_skus', unknownSkuCount };
  }

  const [siblings, currentAssignments] = await Promise.all([
    prisma.vendliveMachineMapping.findMany({
      where: { locationId, vendliveMachineId: { not: vendliveMachineId } },
      select: { planogramSkus: true },
    }),
    prisma.locationAssignment.findMany({
      where: { locationId },
      select: { sku: true },
    }),
  ]);

  const planograms = [entries, ...siblings.map((s) => s.planogramSkus)];
  const unionSkus = computeAssignmentUnion(planograms);
  const { added, removed } = diffAssignments(currentAssignments.map((a) => a.sku), unionSkus);

  const [configRows, freshMeals] = await Promise.all([
    prisma.locationConfig.findMany({
      where: { locationId, sku: { in: unionSkus } },
      select: { sku: true, maxStock: true },
    }),
    prisma.product.findMany({
      where: { sku: { in: unionSkus }, isFreshMeal: true },
      select: { sku: true },
    }),
  ]);
  const { creates, updates } = computeMaxStockFills(
    planograms,
    configRows,
    new Set(freshMeals.map((p) => p.sku)),
  );

  await prisma.$transaction([
    prisma.vendliveMachineMapping.update({
      where: { vendliveMachineId },
      data: { planogramSkus: entries, planogramSyncedAt: new Date() },
    }),
    prisma.locationAssignment.deleteMany({ where: { locationId } }),
    ...(unionSkus.length
      ? [prisma.locationAssignment.createMany({
        data: unionSkus.map((sku) => ({ locationId, sku })),
        skipDuplicates: true,
      })]
      : []),
    ...(creates.length
      ? [prisma.locationConfig.createMany({
        data: creates.map(({ sku, maxStock }) => ({ locationId, sku, maxStock })),
        skipDuplicates: true,
      })]
      : []),
    // Null-guard in the WHERE: a concurrent manual maxStock edit always wins.
    ...updates.map(({ sku, maxStock }) =>
      prisma.locationConfig.updateMany({
        where: { locationId, sku, maxStock: null },
        data: { maxStock },
      })
    ),
  ]);

  return {
    mirrored: true,
    assigned: unionSkus.length,
    added: added.length,
    removed: removed.length,
    unknownSkuCount,
    maxFilled: creates.length + updates.length,
    machinesInUnion: 1 + siblings.length,
  };
}
