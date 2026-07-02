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
