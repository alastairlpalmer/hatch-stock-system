import prisma from '../utils/db.js';
import { consumeBatchesFEFO, recomputeWarehouseStock } from '../utils/inventory-stock.js';

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
  const [configRows, mealConfigRows, stockRows, freshProducts] = await Promise.all([
    prisma.locationConfig.findMany({ where: { locationId: { in: locIds }, maxStock: { not: null } } }),
    prisma.locationMealConfig.findMany({ where: { locationId: { in: locIds }, maxStock: { not: null } } }),
    prisma.locationStock.findMany({ where: { locationId: { in: locIds } } }),
    prisma.product.findMany({
      where: { isFreshMeal: true },
      select: { sku: true, name: true, mealType: true },
    }),
  ]);

  const stockOf = new Map(stockRows.map((s) => [`${s.locationId}|${s.sku}`, s.quantity]));
  const freshSkus = new Set(freshProducts.map((p) => p.sku));
  const membersByMealType = {};
  for (const p of freshProducts) {
    (membersByMealType[p.mealType || 'Unclassified'] ||= []).push(p);
  }

  // Candidate SKUs = everything a config or a fresh group could ask for.
  const candidateSkus = new Set(freshSkus);
  for (const c of configRows) candidateSkus.add(c.sku);

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

  for (const location of locations) {
    // Plain products: fill to max. Fresh SKUs are excluded here — their
    // capacity lives on the meal-type group, not per flavour.
    for (const cfg of configsByLocation[location.id] || []) {
      if (freshSkus.has(cfg.sku)) continue;
      const current = stockOf.get(`${location.id}|${cfg.sku}`) || 0;
      addNeed(cfg.sku, location, Math.max(0, cfg.maxStock - current));
    }

    // Fresh-meal groups: group need split across member SKUs by warehouse
    // availability, soonest-expiring flavours preferred.
    for (const mealCfg of mealConfigsByLocation[location.id] || []) {
      const members = membersByMealType[mealCfg.mealType] || [];
      if (members.length === 0) continue;
      const groupStock = members.reduce(
        (sum, m) => sum + (stockOf.get(`${location.id}|${m.sku}`) || 0), 0,
      );
      const groupNeed = Math.max(0, mealCfg.maxStock - groupStock);
      if (groupNeed <= 0) continue;

      const split = splitGroupNeed(groupNeed, members.map((m) => ({
        sku: m.sku,
        available: availableOf[m.sku] || 0,
        earliestExpiry: earliestExpiryOf(m.sku),
      })));
      for (const [sku, qty] of Object.entries(split)) addNeed(sku, location, qty);
    }
  }

  // ---- Cap at availability + plan the FEFO batch allocation ----
  const productNames = new Map(freshProducts.map((p) => [p.sku, p.name]));
  const plainSkus = [...needBySku.keys()].filter((sku) => !productNames.has(sku));
  if (plainSkus.length) {
    const rows = await prisma.product.findMany({
      where: { sku: { in: plainSkus } },
      select: { sku: true, name: true },
    });
    for (const r of rows) productNames.set(r.sku, r.name);
  }

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
      let deficit = totalQty - available;
      for (let i = perLocation.length - 1; i >= 0 && deficit > 0; i--) {
        const cut = Math.min(perLocation[i].qty, deficit);
        perLocation[i].qty -= cut;
        deficit -= cut;
      }
      totalQty = available;
    }
    if (totalQty <= 0) continue;

    // FEFO allocation plan — which date-lots to pull from the shelf.
    const allocation = [];
    let remaining = totalQty;
    for (const b of batchesBySku[sku] || []) {
      if (remaining <= 0) break;
      const take = Math.min(b.remainingQty, remaining);
      allocation.push({ batchId: b.id, qty: take, expiryDate: b.expiryDate, receivedAt: b.receivedAt });
      remaining -= take;
    }

    items.push({
      sku,
      name,
      totalQty,
      packed: false,
      perLocation: perLocation.filter((p) => p.qty > 0),
      batches: allocation,
    });
  }

  items.sort((a, b) => a.name.localeCompare(b.name));

  return prisma.pickList.create({
    data: {
      warehouseId,
      routeId,
      routeName,
      targetDate: new Date(targetDate),
      status: 'draft',
      items,
      shortfalls: shortfalls.length ? shortfalls : null,
      createdBy,
    },
  });
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
        if (p.locationId === locationId) planned.push({ sku: item.sku, name: item.name, qty: p.qty });
      }
    }

    const check = latestCheckByLocation.get(locationId);
    const restock = latestRestockByLocation.get(locationId);
    return {
      locationId,
      locationName: locationNameById.get(locationId),
      planned,
      plannedUnits: planned.reduce((sum, p) => sum + p.qty, 0),
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
 * (FEFO, allocated FRESH at completion time — stock may have moved since
 * generation), journal a StockRemoval, and flip the list to `packed`.
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
    for (const item of Array.isArray(list.items) ? list.items : []) {
      const qty = item.packedQty ?? item.totalQty ?? 0;
      if (qty <= 0) continue;
      const { shortfall } = await consumeBatchesFEFO(tx, list.warehouseId, item.sku, qty);
      if (shortfall > 0) {
        shortfalls.push({ sku: item.sku, name: item.name, requested: qty, available: qty - shortfall });
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

    return { pickList, removal };
  });
}
