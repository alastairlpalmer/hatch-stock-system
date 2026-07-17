import prisma from '../utils/db.js';
import { consumePlannedBatches, recomputeWarehouseStock } from '../utils/inventory-stock.js';
import { getEffectiveLayout } from './planogram-scope.js';

/**
 * Pick lists: "what to pack into bags tonight for tomorrow's restock run."
 *
 * Generation computes each location's fill-to-max need (per SKU from
 * LocationConfig; fresh-meal groups from LocationMealConfig, split across
 * member SKUs by warehouse availability), aggregates per SKU across the route,
 * and PLANS a FEFO batch allocation so the packer knows exactly which date-lot
 * to pull. Nothing is decremented at generation time — completion re-allocates
 * FEFO against live stock and journals the StockRemoval.
 */

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

const DAY_MS = 86_400_000;

// UTC date-part as an epoch (expiry dates are stored as UTC-midnight dates, so
// calendar comparisons must be done on UTC date parts — same convention as
// utils/expiry.js).
function utcDatePart(d) {
  const x = new Date(d);
  return Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
}

/**
 * True when a batch expiry falls STRICTLY BEFORE the next restock after the
 * pick list's target date. Machines are restocked weekly (Mondays), so the
 * next restock is targetDate + 7 calendar days: stock expiring on the next
 * restock day itself can still be swapped out and is NOT flagged. Batches
 * without an expiry date are never flagged. Pure; exported for tests.
 *
 * @param {Date|string|null} expiryDate
 * @param {Date|string} targetDate
 * @returns {boolean}
 */
export function expiresBeforeNextRestock(expiryDate, targetDate) {
  if (!expiryDate) return false;
  return utcDatePart(expiryDate) < utcDatePart(targetDate) + 7 * DAY_MS;
}

/**
 * Summarise a pick list's flagged batch allocations into one warning per SKU:
 * qty = total units allocated from batches flagged `expiresBeforeNextRestock`,
 * expiryDate = the earliest flagged expiry. Computed on the fly from the
 * stored items JSON (the PickList model has no expiryWarnings column — the
 * flags on the batch entries are the persisted source of truth). Pure;
 * exported for tests.
 *
 * @param {Array<{ sku, name, batches?: Array<{ qty, expiryDate, expiresBeforeNextRestock? }> }>} items
 * @returns {Array<{ sku: string, name: string, qty: number, expiryDate: Date|string }>}
 */
export function buildExpiryWarnings(items) {
  const warnings = [];
  for (const item of Array.isArray(items) ? items : []) {
    const flagged = (Array.isArray(item.batches) ? item.batches : [])
      .filter((b) => b.expiresBeforeNextRestock === true);
    if (flagged.length === 0) continue;

    let earliest = flagged[0].expiryDate;
    for (const b of flagged) {
      if (utcDatePart(b.expiryDate) < utcDatePart(earliest)) earliest = b.expiryDate;
    }
    warnings.push({
      sku: item.sku,
      name: item.name,
      qty: flagged.reduce((sum, b) => sum + (b.qty || 0), 0),
      expiryDate: earliest,
    });
  }
  return warnings;
}

/**
 * Split a fresh-meal group's need across its member SKUs proportionally to
 * warehouse availability, preferring soonest-expiring members: shares are
 * floored and the rounding remainder is handed out soonest-expiry-first (nulls
 * last, then sku, so the split is deterministic). With nothing available the
 * whole need lands on the first member so the demand still registers (and is
 * reported as a shortfall). Pure; exported for tests.
 *
 * @param {number} need
 * @param {Array<{ sku: string, available: number, earliestExpiry: Date|null }>} members
 * @returns {{ [sku: string]: number }}
 */
export function splitGroupNeed(need, members) {
  const result = Object.fromEntries(members.map((m) => [m.sku, 0]));
  if (need <= 0 || members.length === 0) return result;

  const order = [...members].sort((a, b) => {
    const ax = a.earliestExpiry ? new Date(a.earliestExpiry).getTime() : Infinity;
    const bx = b.earliestExpiry ? new Date(b.earliestExpiry).getTime() : Infinity;
    if (ax !== bx) return ax - bx;
    return a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0;
  });

  const totalAvailable = members.reduce((sum, m) => sum + (m.available || 0), 0);
  if (totalAvailable <= 0) {
    result[order[0].sku] = need;
    return result;
  }

  let assigned = 0;
  for (const m of order) {
    const share = Math.floor((need * (m.available || 0)) / totalAvailable);
    result[m.sku] = share;
    assigned += share;
  }
  let remainder = need - assigned;
  for (const m of order) {
    if (remainder <= 0) break;
    result[m.sku] += 1;
    remainder -= 1;
  }
  return result;
}

/**
 * Per-location fill needs for one location, planogram-aware. Pure; exported
 * for tests.
 *
 * With a planogram scope, needs are computed for the SLOTTED targets only:
 * plain-SKU fill target = diagram capacity ?? config maxStock (target skipped
 * when both are unknown); meal-group target likewise, then split across member
 * flavours by warehouse availability. Configured targets with a maxStock that
 * have NO slot are reported in notOnPlanogram instead of generating a need.
 * Without a scope (no diagram) the legacy fill-to-config-max behaviour is
 * unchanged and notOnPlanogram is null.
 *
 * Product families ("Barebells" + flavours): a slot targeting the family fills
 * it with whatever flavours the warehouse has (same availability/FEFO split as
 * meal groups). A flavour with its OWN sku slot at this location fills that
 * slot per-SKU and is left out of the family split — slot-level truth wins
 * over aggregation for physical machine fill (deliberately different from the
 * ordering engine, which always aggregates for purchasing).
 *
 * @param {Object} p
 * @param {Object|null} p.scope - buildPlanogramScope output or null
 * @param {Array}  p.configs - LocationConfig rows [{ sku, maxStock }] (maxStock set)
 * @param {Array}  p.mealConfigs - LocationMealConfig rows [{ mealType, maxStock }]
 * @param {Array}  p.parentConfigs - LocationParentConfig rows [{ parentId, maxStock }]
 * @param {Set}    p.freshSkus - all fresh-meal SKUs
 * @param {Object} p.membersByMealType - { mealType: [{ sku, name }] }
 * @param {Object} p.membersByParent - { parentId: [{ sku, name }] }
 * @param {Function} p.stockOf - (sku) => current qty at this location
 * @param {Object} p.availableOf - { sku: warehouse units available }
 * @param {Function} p.earliestExpiryOf - (sku) => earliest batch expiry | null
 * @returns {{ needs: Array<{ sku: string, qty: number }>,
 *             notOnPlanogram: { skus: string[], mealTypes: string[], parents: string[] } | null }}
 */
export function computeLocationNeeds({
  scope,
  configs,
  mealConfigs,
  parentConfigs = [],
  freshSkus,
  membersByMealType,
  membersByParent = {},
  stockOf,
  availableOf,
  earliestExpiryOf,
}) {
  const needs = [];
  const addNeed = (sku, qty) => { if (qty > 0) needs.push({ sku, qty }); };

  const configMax = new Map(
    (configs || []).filter((c) => !freshSkus.has(c.sku)).map((c) => [c.sku, c.maxStock]),
  );
  const mealMax = new Map((mealConfigs || []).map((m) => [m.mealType, m.maxStock]));
  const parentMaxCfg = new Map((parentConfigs || []).map((p) => [p.parentId, p.maxStock]));

  const splitAcross = (members, groupMax) => {
    if (members.length === 0) return;
    const groupStock = members.reduce((sum, m) => sum + (stockOf(m.sku) || 0), 0);
    const groupNeed = Math.max(0, groupMax - groupStock);
    if (groupNeed <= 0) return;
    const split = splitGroupNeed(groupNeed, members.map((m) => ({
      sku: m.sku,
      available: availableOf[m.sku] || 0,
      earliestExpiry: earliestExpiryOf(m.sku),
    })));
    for (const [sku, qty] of Object.entries(split)) addNeed(sku, qty);
  };

  const splitGroup = (mealType, groupMax) => splitAcross(membersByMealType[mealType] || [], groupMax);
  // Members already filled per-SKU elsewhere (own slot / own config) stay out
  // of the family split — their stock and need are accounted at their own
  // target, never twice.
  const splitFamily = (parentId, groupMax, memberExcluded) =>
    splitAcross((membersByParent[parentId] || []).filter((m) => !memberExcluded(m.sku)), groupMax);

  if (!scope) {
    // Legacy path — fill every configured target to its config max.
    for (const [sku, max] of configMax) addNeed(sku, Math.max(0, max - (stockOf(sku) || 0)));
    for (const [mealType, max] of mealMax) splitGroup(mealType, max);
    for (const [parentId, max] of parentMaxCfg) {
      splitFamily(parentId, max, (sku) => configMax.has(sku));
    }
    return { needs, notOnPlanogram: null };
  }

  // Planogram path — slotted targets only, diagram capacity first.
  // skuHandled tracks flavours whose own slot actually produced a fill target:
  // an own slot with NO resolvable capacity used to both skip the per-SKU fill
  // AND exclude the flavour from its family split — a silent starvation of
  // that facing. Such flavours now fall back into the family split.
  const skuHandled = new Set();
  for (const sku of scope.skuSet) {
    if (freshSkus.has(sku)) continue; // flavour SKUs fill via their group slot
    const target = scope.capacityByTarget.get(`sku:${sku}`) ?? configMax.get(sku) ?? null;
    if (target == null) continue; // no capacity anywhere — nothing to fill to
    skuHandled.add(sku);
    addNeed(sku, Math.max(0, target - (stockOf(sku) || 0)));
  }
  for (const mealType of scope.mealTypeSet) {
    const target = scope.capacityByTarget.get(`mealType:${mealType}`) ?? mealMax.get(mealType) ?? null;
    if (target == null) continue;
    splitGroup(mealType, target);
  }
  const parentSet = scope.parentSet || new Set();
  for (const parentId of parentSet) {
    const target = scope.capacityByTarget.get(`parent:${parentId}`) ?? parentMaxCfg.get(parentId) ?? null;
    if (target == null) continue;
    splitFamily(parentId, target, (sku) => skuHandled.has(sku));
  }

  const notOnPlanogram = {
    skus: [...configMax.keys()].filter((sku) => !scope.skuSet.has(sku)),
    mealTypes: [...mealMax.keys()].filter((mt) => !scope.mealTypeSet.has(mt)),
    // A configured family is covered by a parent slot, or by EVERY member
    // having its own effective sku slot (de-facto per-flavour placement).
    // A partially slotted family without a parent slot leaves the unslotted
    // flavours unpicked — that must warn, not pass silently.
    parents: [...parentMaxCfg.keys()].filter((id) =>
      !parentSet.has(id)
      && !(membersByParent[id] || []).every((m) => skuHandled.has(m.sku))),
  };
  return { needs, notOnPlanogram };
}

/**
 * Generate (and persist) a draft pick list for a route or an explicit set of
 * locations against one warehouse.
 *
 * Where warehouse availability can't cover the aggregated need, the item is
 * capped at what's available — trimmed from the LAST location in route order
 * (the first stops on the run get filled first) — and the gap is recorded in
 * shortfalls.
 */
export async function generatePickList({
  warehouseId,
  targetDate,
  routeId = null,
  locationIds = null,
  createdBy = null,
}) {
  const warehouse = await prisma.warehouse.findUnique({ where: { id: warehouseId } });
  if (!warehouse) throw httpError(404, 'Warehouse not found');

  // Resolve the location set (route order preserved; archived/missing dropped).
  let routeName = null;
  let orderedIds = [];
  if (routeId) {
    const route = await prisma.restockRoute.findUnique({ where: { id: routeId } });
    if (!route) throw httpError(404, 'Route not found');
    routeName = route.name;
    orderedIds = Array.isArray(route.locationIds) ? route.locationIds : [];
  } else {
    orderedIds = Array.isArray(locationIds) ? locationIds : [];
  }

  const found = await prisma.location.findMany({
    where: { id: { in: orderedIds }, archivedAt: null },
    select: { id: true, name: true },
  });
  const locationById = new Map(found.map((l) => [l.id, l]));
  const locations = orderedIds.map((id) => locationById.get(id)).filter(Boolean);
  if (locations.length === 0) throw httpError(400, 'No active locations to pick for');

  const locIds = locations.map((l) => l.id);
  const [configRows, mealConfigRows, parentConfigRows, stockRows, freshProducts, parentedProducts, productParents, planograms] = await Promise.all([
    prisma.locationConfig.findMany({ where: { locationId: { in: locIds }, maxStock: { not: null } } }),
    prisma.locationMealConfig.findMany({ where: { locationId: { in: locIds }, maxStock: { not: null } } }),
    prisma.locationParentConfig.findMany({ where: { locationId: { in: locIds }, maxStock: { not: null } } }),
    prisma.locationStock.findMany({ where: { locationId: { in: locIds } } }),
    prisma.product.findMany({
      where: { isFreshMeal: true },
      select: { sku: true, name: true, mealType: true },
    }),
    prisma.product.findMany({
      where: { isFreshMeal: false, parentId: { not: null } },
      select: { sku: true, name: true, parentId: true },
    }),
    prisma.productParent.findMany({ select: { id: true, name: true } }),
    Promise.all(locIds.map((id) => getEffectiveLayout(id, { prefer: 'next' }))),
  ]);
  const planogramByLocation = new Map(locIds.map((id, i) => [id, planograms[i]]));
  const parentNameOf = new Map(productParents.map((p) => [p.id, p.name]));

  const stockOf = new Map(stockRows.map((s) => [`${s.locationId}|${s.sku}`, s.quantity]));
  const freshSkus = new Set(freshProducts.map((p) => p.sku));
  const membersByMealType = {};
  for (const p of freshProducts) {
    (membersByMealType[p.mealType || 'Unclassified'] ||= []).push(p);
  }
  const membersByParent = {};
  for (const p of parentedProducts) {
    (membersByParent[p.parentId] ||= []).push(p);
  }

  // Candidate SKUs = everything a config, a fresh group, a product family or a
  // planogram slot could ask for (capacity-only slots have no config row but
  // still pick).
  const candidateSkus = new Set(freshSkus);
  for (const c of configRows) candidateSkus.add(c.sku);
  for (const p of parentedProducts) candidateSkus.add(p.sku);
  for (const p of planograms) {
    if (p) for (const sku of p.scope.skuSet) candidateSkus.add(sku);
  }

  // Warehouse batches in FEFO order (earliest expiry first, nulls last, then
  // oldest received) — used both for availability and the allocation plan.
  const batches = candidateSkus.size
    ? await prisma.stockBatch.findMany({
        where: { warehouseId, sku: { in: [...candidateSkus] }, remainingQty: { gt: 0 } },
        orderBy: [{ expiryDate: { sort: 'asc', nulls: 'last' } }, { receivedAt: 'asc' }],
      })
    : [];
  const batchesBySku = {};
  const availableOf = {};
  for (const b of batches) {
    (batchesBySku[b.sku] ||= []).push(b);
    availableOf[b.sku] = (availableOf[b.sku] || 0) + b.remainingQty;
  }
  const earliestExpiryOf = (sku) => batchesBySku[sku]?.[0]?.expiryDate ?? null;

  const configsByLocation = {};
  for (const c of configRows) (configsByLocation[c.locationId] ||= []).push(c);
  const mealConfigsByLocation = {};
  for (const m of mealConfigRows) (mealConfigsByLocation[m.locationId] ||= []).push(m);
  const parentConfigsByLocation = {};
  for (const p of parentConfigRows) (parentConfigsByLocation[p.locationId] ||= []).push(p);

  // ---- Per-location needs, aggregated per SKU (route order preserved) ----
  const needBySku = new Map(); // sku -> { totalQty, perLocation: [{ locationId, locationName, qty }] }
  const addNeed = (sku, location, qty) => {
    if (qty <= 0) return;
    let entry = needBySku.get(sku);
    if (!entry) {
      entry = { totalQty: 0, perLocation: [] };
      needBySku.set(sku, entry);
    }
    entry.totalQty += qty;
    entry.perLocation.push({ locationId: location.id, locationName: location.name, qty });
  };

  const notOnPlanogramPerLocation = [];
  for (const location of locations) {
    const planogram = planogramByLocation.get(location.id);
    const { needs, notOnPlanogram } = computeLocationNeeds({
      scope: planogram?.scope ?? null,
      configs: configsByLocation[location.id] || [],
      mealConfigs: mealConfigsByLocation[location.id] || [],
      parentConfigs: parentConfigsByLocation[location.id] || [],
      freshSkus,
      membersByMealType,
      membersByParent,
      stockOf: (sku) => stockOf.get(`${location.id}|${sku}`) || 0,
      availableOf,
      earliestExpiryOf,
    });
    for (const { sku, qty } of needs) addNeed(sku, location, qty);
    if (notOnPlanogram && (notOnPlanogram.skus.length || notOnPlanogram.mealTypes.length || notOnPlanogram.parents.length)) {
      notOnPlanogramPerLocation.push({
        locationId: location.id,
        locationName: location.name,
        ...notOnPlanogram,
      });
    }
  }

  // ---- Cap at availability + plan the FEFO batch allocation ----
  const productNames = new Map(freshProducts.map((p) => [p.sku, p.name]));
  const excludedSkus = notOnPlanogramPerLocation.flatMap((l) => l.skus);
  const plainSkus = [...new Set([...needBySku.keys(), ...excludedSkus])]
    .filter((sku) => !productNames.has(sku));
  if (plainSkus.length) {
    const rows = await prisma.product.findMany({
      where: { sku: { in: plainSkus } },
      select: { sku: true, name: true },
    });
    for (const r of rows) productNames.set(r.sku, r.name);
  }

  // Excluded SKUs/families carry their names so the UI needn't resolve them.
  const notOnPlanogram = notOnPlanogramPerLocation.length
    ? notOnPlanogramPerLocation.map((l) => ({
        ...l,
        skus: l.skus.map((sku) => ({ sku, name: productNames.get(sku) || sku })),
        parents: (l.parents || []).map((id) => ({ parentId: id, name: parentNameOf.get(id) || id })),
      }))
    : null;

  const items = [];
  const shortfalls = [];
  for (const [sku, entry] of needBySku) {
    const name = productNames.get(sku) || sku;
    const available = availableOf[sku] || 0;
    let totalQty = entry.totalQty;
    const perLocation = entry.perLocation.map((p) => ({ ...p }));

    if (available < totalQty) {
      shortfalls.push({ sku, name, requested: totalQty, available });
      // Trim the deficit from the LAST location in route order so the first
      // stops on the run stay fully served — deterministic and explainable.
      // Each cut is recorded on the perLocation entry (trimmed) so the run
      // view can flag WHICH stop is short instead of it shrinking silently.
      let deficit = totalQty - available;
      for (let i = perLocation.length - 1; i >= 0 && deficit > 0; i--) {
        const cut = Math.min(perLocation[i].qty, deficit);
        perLocation[i].qty -= cut;
        if (cut > 0) perLocation[i].trimmed = (perLocation[i].trimmed || 0) + cut;
        deficit -= cut;
      }
      totalQty = available;
    }
    if (totalQty <= 0) continue;

    // FEFO allocation plan — which date-lots to pull from the shelf. Batches
    // that won't survive to the NEXT restock (targetDate + 7 days) are flagged
    // so the packer knows that lot will expire in the machine.
    const allocation = [];
    let remaining = totalQty;
    for (const b of batchesBySku[sku] || []) {
      if (remaining <= 0) break;
      const take = Math.min(b.remainingQty, remaining);
      const entry = { batchId: b.id, qty: take, expiryDate: b.expiryDate, receivedAt: b.receivedAt };
      if (expiresBeforeNextRestock(b.expiryDate, targetDate)) entry.expiresBeforeNextRestock = true;
      allocation.push(entry);
      remaining -= take;
    }

    items.push({
      sku,
      name,
      totalQty,
      packed: false,
      // Keep zero-qty entries that were trimmed away — the run view flags
      // those stops as short rather than silently omitting them.
      perLocation: perLocation.filter((p) => p.qty > 0 || (p.trimmed || 0) > 0),
      batches: allocation,
    });
  }

  items.sort((a, b) => a.name.localeCompare(b.name));

  const pickList = await prisma.pickList.create({
    data: {
      warehouseId,
      routeId,
      routeName,
      targetDate: new Date(targetDate),
      status: 'draft',
      items,
      shortfalls: shortfalls.length ? shortfalls : null,
      notOnPlanogram,
      createdBy,
    },
  });

  // Summary of the flagged allocations — derived from the items JSON, never
  // stored (getPickListRun recomputes it the same way).
  return { ...pickList, expiryWarnings: buildExpiryWarnings(items) };
}

/**
 * Van reconciliation math for a pick list: per SKU, what was packed into the
 * van, what has been loaded into machines (across ALL linked restocks), what
 * has been returned to the warehouse, and what should still be on the van.
 * Pure; exported for tests.
 *
 * @param {Array<{ sku, name, totalQty, packedQty? }>} pickListItems
 * @param {Array<{ items: Array<{ sku, quantity }> }>} restockRecords all RestockRecords linked to the list
 * @param {Array<{ sku, quantity }>} returnedItems the list's returnedItems journal
 * @returns {{ perSku: Array<{ sku, name, packed, loaded, returned, remaining }>,
 *             packedUnits: number, loadedUnits: number, returnedUnits: number, remainingUnits: number }}
 */
export function buildReconciliation(pickListItems, restockRecords, returnedItems) {
  const loadedBySku = new Map();
  for (const record of restockRecords || []) {
    for (const item of Array.isArray(record.items) ? record.items : []) {
      loadedBySku.set(item.sku, (loadedBySku.get(item.sku) || 0) + (item.quantity || 0));
    }
  }
  const returnedBySku = new Map();
  for (const item of Array.isArray(returnedItems) ? returnedItems : []) {
    returnedBySku.set(item.sku, (returnedBySku.get(item.sku) || 0) + (item.quantity || 0));
  }

  const perSku = (Array.isArray(pickListItems) ? pickListItems : []).map((item) => {
    const packed = item.packedQty ?? item.totalQty ?? 0;
    const loaded = loadedBySku.get(item.sku) || 0;
    const returned = returnedBySku.get(item.sku) || 0;
    return {
      sku: item.sku,
      name: item.name,
      packed,
      loaded,
      returned,
      remaining: Math.max(0, packed - loaded - returned),
    };
  });

  const sumOf = (key) => perSku.reduce((sum, row) => sum + row[key], 0);
  return {
    perSku,
    packedUnits: sumOf('packed'),
    loadedUnits: sumOf('loaded'),
    returnedUnits: sumOf('returned'),
    remainingUnits: sumOf('remaining'),
  };
}

/**
 * Validate a leftovers-return request against the reconciliation: every SKU
 * must be on the pick list and no return may exceed what should still be on
 * the van. Duplicate request lines for a SKU are summed before checking.
 * Returns the offending rows ([] when the request is valid). Pure; exported
 * for tests.
 *
 * @param {Array<{ sku, remaining }>} perSku from buildReconciliation
 * @param {Array<{ sku, quantity }>} requestItems
 * @returns {Array<{ sku, requested: number, remaining: number }>}
 */
export function findReturnViolations(perSku, requestItems) {
  const remainingBySku = new Map(perSku.map((row) => [row.sku, row.remaining]));
  const requestedBySku = new Map();
  for (const { sku, quantity } of requestItems) {
    requestedBySku.set(sku, (requestedBySku.get(sku) || 0) + quantity);
  }

  const violations = [];
  for (const [sku, requested] of requestedBySku) {
    const remaining = remainingBySku.get(sku);
    if (remaining === undefined || requested > remaining) {
      violations.push({ sku, requested, remaining: remaining ?? 0 });
    }
  }
  return violations;
}

/**
 * Everything the route-run screen needs for one pick list in a single call:
 * the list itself, the per-location plan with the latest stock check and
 * linked restock for each stop, the van reconciliation, and whether every
 * stop has been restocked.
 *
 * Location order follows the route (RestockRoute.locationIds) when the list
 * was generated from one, falling back to first appearance in the items'
 * perLocation entries (which is route order at generation time anyway).
 */
export async function getPickListRun(id) {
  const pickList = await prisma.pickList.findUnique({ where: { id } });
  if (!pickList) throw httpError(404, 'Pick list not found');

  const items = Array.isArray(pickList.items) ? pickList.items : [];

  // Collect the locations on the list (name + first-appearance order).
  const locationNameById = new Map();
  const appearanceOrder = [];
  for (const item of items) {
    for (const p of Array.isArray(item.perLocation) ? item.perLocation : []) {
      if (!locationNameById.has(p.locationId)) {
        locationNameById.set(p.locationId, p.locationName);
        appearanceOrder.push(p.locationId);
      }
    }
  }

  // Prefer the route's stop order; locations no longer on the route (or when
  // the route is gone) keep their appearance order at the end.
  let orderedIds = appearanceOrder;
  if (pickList.routeId) {
    const route = await prisma.restockRoute.findUnique({ where: { id: pickList.routeId } });
    const routeOrder = Array.isArray(route?.locationIds) ? route.locationIds : [];
    const onList = routeOrder.filter((locId) => locationNameById.has(locId));
    const rest = appearanceOrder.filter((locId) => !onList.includes(locId));
    orderedIds = [...onList, ...rest];
  }

  const [stockChecks, restocks] = await Promise.all([
    // Only checks performed since the list was created count as "this run".
    prisma.stockCheck.findMany({
      where: { locationId: { in: orderedIds }, createdAt: { gte: pickList.createdAt } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.restockRecord.findMany({
      where: { pickListId: id },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  // Newest-first, so the first row seen per location is the latest.
  const latestCheckByLocation = new Map();
  for (const check of stockChecks) {
    if (!latestCheckByLocation.has(check.locationId)) latestCheckByLocation.set(check.locationId, check);
  }
  const latestRestockByLocation = new Map();
  for (const restock of restocks) {
    if (!latestRestockByLocation.has(restock.locationId)) latestRestockByLocation.set(restock.locationId, restock);
  }

  const locations = orderedIds.map((locationId) => {
    const planned = [];
    for (const item of items) {
      for (const p of Array.isArray(item.perLocation) ? item.perLocation : []) {
        if (p.locationId === locationId) {
          planned.push({ sku: item.sku, name: item.name, qty: p.qty, trimmed: p.trimmed || 0 });
        }
      }
    }

    const check = latestCheckByLocation.get(locationId);
    const restock = latestRestockByLocation.get(locationId);
    return {
      locationId,
      locationName: locationNameById.get(locationId),
      planned,
      plannedUnits: planned.reduce((sum, p) => sum + p.qty, 0),
      // Units this stop lost to warehouse shortfall trimming at generation —
      // >0 means the stop is knowingly under-served, not fully stocked.
      trimmedUnits: planned.reduce((sum, p) => sum + (p.trimmed || 0), 0),
      stockCheck: check
        ? {
            id: check.id,
            createdAt: check.createdAt,
            performedBy: check.performedBy,
            discrepancies: (Array.isArray(check.items) ? check.items : [])
              .filter((i) => (i.variance || 0) !== 0).length,
          }
        : null,
      restock: restock
        ? {
            id: restock.id,
            createdAt: restock.createdAt,
            performedBy: restock.performedBy,
            units: (Array.isArray(restock.items) ? restock.items : [])
              .reduce((sum, i) => sum + (i.quantity || 0), 0),
          }
        : null,
    };
  });

  return {
    pickList,
    locations,
    reconciliation: buildReconciliation(items, restocks, pickList.returnedItems),
    expiryWarnings: buildExpiryWarnings(items),
    allDone: locations.length > 0 && locations.every((l) => l.restock !== null),
  };
}

/**
 * Book leftovers from the van back into the warehouse after a run: each
 * returned SKU becomes a new StockBatch at the list's warehouse, dated with
 * the earliest expiry of that SKU's original allocation (conservative for
 * FEFO — we can't know which date-lot actually came back), and the return is
 * journalled on the list's returnedItems so reconciliation stays honest.
 *
 * Rejects returns exceeding what should still be on the van
 * (packed − loaded − already returned) with a 400 carrying `violations`.
 */
export async function returnPickListLeftovers(id, { items, performedBy = null }) {
  const list = await prisma.pickList.findUnique({ where: { id } });
  if (!list) throw httpError(404, 'Pick list not found');
  if (list.status !== 'packed') {
    throw httpError(409, `Only a packed pick list can take returns (status is ${list.status})`);
  }

  const listItems = Array.isArray(list.items) ? list.items : [];
  const restocks = await prisma.restockRecord.findMany({ where: { pickListId: id } });

  const { perSku } = buildReconciliation(listItems, restocks, list.returnedItems);
  const violations = findReturnViolations(perSku, items);
  if (violations.length > 0) {
    const err = httpError(
      400,
      `Return exceeds what is left on the van for: ${violations.map((v) => v.sku).join(', ')}`,
    );
    err.violations = violations;
    throw err;
  }

  const itemBySku = new Map(listItems.map((item) => [item.sku, item]));
  const earliestExpiryOf = (item) => {
    const dates = (Array.isArray(item?.batches) ? item.batches : [])
      .map((b) => b.expiryDate)
      .filter(Boolean)
      .map((d) => new Date(d));
    if (dates.length === 0) return null;
    return new Date(Math.min(...dates.map((d) => d.getTime())));
  };

  const returnedAt = new Date().toISOString();
  const pickList = await prisma.$transaction(async (tx) => {
    for (const { sku, quantity } of items) {
      await tx.stockBatch.create({
        data: {
          warehouseId: list.warehouseId,
          sku,
          quantity,
          remainingQty: quantity,
          expiryDate: earliestExpiryOf(itemBySku.get(sku)),
          damageNotes: `Returned from pick list ${list.id}${performedBy ? ` by ${performedBy}` : ''}`,
        },
      });
      await recomputeWarehouseStock(tx, list.warehouseId, sku);
    }

    const existing = Array.isArray(list.returnedItems) ? list.returnedItems : [];
    return tx.pickList.update({
      where: { id: list.id },
      data: {
        returnedItems: [
          ...existing,
          ...items.map(({ sku, quantity }) => ({ sku, quantity, returnedAt })),
        ],
      },
    });
  });

  return {
    pickList,
    reconciliation: buildReconciliation(listItems, restocks, pickList.returnedItems),
  };
}

/**
 * Complete a draft pick list: consume the packed quantities from the warehouse
 * following the STORED batch plan the packer was shown (falling back to FEFO
 * for units the planned lots can no longer cover), journal a StockRemoval, and
 * flip the list to `packed`. Lines that had to deviate from the plan are
 * reported in `deviations` so the UI can tell the packer which pull lines no
 * longer match reality.
 *
 * If live stock can no longer cover any line the whole transaction rolls back
 * and a 409 error carrying `shortfalls` is thrown — the caller should advise
 * regenerating the pick list.
 */
export async function completePickList(id, { takenBy = null } = {}) {
  const list = await prisma.pickList.findUnique({ where: { id } });
  if (!list) throw httpError(404, 'Pick list not found');
  if (list.status !== 'draft') throw httpError(409, `Pick list is already ${list.status}`);

  return prisma.$transaction(async (tx) => {
    // Guarded status flip — two concurrent completions must not double-take.
    const flipped = await tx.pickList.updateMany({
      where: { id, status: 'draft' },
      data: { status: 'packed' },
    });
    if (flipped.count === 0) throw httpError(409, 'Pick list already completed');

    const removalItems = [];
    const shortfalls = [];
    const deviations = [];
    for (const item of Array.isArray(list.items) ? list.items : []) {
      const qty = item.packedQty ?? item.totalQty ?? 0;
      if (qty <= 0) continue;
      const { shortfall, offPlanQty } = await consumePlannedBatches(
        tx, list.warehouseId, item.sku, qty, item.batches,
      );
      if (shortfall > 0) {
        shortfalls.push({ sku: item.sku, name: item.name, requested: qty, available: qty - shortfall });
      }
      if (offPlanQty > 0) {
        deviations.push({ sku: item.sku, name: item.name, offPlanQty });
      }
      removalItems.push({ sku: item.sku, quantity: qty });
    }

    if (shortfalls.length > 0) {
      const err = httpError(
        409,
        'Warehouse stock has changed since this pick list was generated — regenerate it and try again',
      );
      err.shortfalls = shortfalls;
      throw err; // rolls back every consume above
    }
    if (removalItems.length === 0) throw httpError(400, 'Pick list has no quantities to take');

    const removal = await tx.stockRemoval.create({
      data: {
        warehouseId: list.warehouseId,
        routeId: list.routeId,
        routeName: list.routeName,
        takenBy,
        notes: `Pick list ${list.id}`,
        items: removalItems,
      },
    });

    // consumeBatchesFEFO does NOT recompute the aggregate (mirrors the
    // /inventory/removals path) — reconcile each touched sku here.
    for (const item of removalItems) {
      await recomputeWarehouseStock(tx, list.warehouseId, item.sku);
    }

    const pickList = await tx.pickList.update({
      where: { id },
      data: { removalId: removal.id },
    });

    return { pickList, removal, deviations: deviations.length ? deviations : null };
  });
}
