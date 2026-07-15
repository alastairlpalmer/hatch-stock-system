import prisma from '../utils/db.js';
import { SALE_LOCATION_JOINS, SALE_LOCATION_ID } from '../utils/sales-location.js';
import {
  resolveOrderingConfig,
  blendVelocity,
  DEFAULT_COVER_DAYS,
  VELOCITY_WINDOW_DAYS,
} from '../config/ordering.js';
import {
  nextMonday,
  nextTradingDay,
  countTradingDaysBetween,
  countTradingDaysInWindow,
} from '../utils/trading-days.js';
import { getEffectiveLayout } from './planogram-scope.js';

const MS_PER_DAY = 86_400_000;
const round = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Trailing sales velocity per SKU at a location, over the short and long
 * windows. Windows are CALENDAR days (units sold in the trailing 14/28 days)
 * but velocity is per TRADING day: units ÷ Mon–Fri days in the window, because
 * the machines only sell on weekdays and a calendar-day rate would understate
 * weekday demand by ~28%. Sales are attributed to the location via the Phase 0
 * resolver (VendLive machine mapping, name fallback). Refunds excluded.
 * Returns { [sku]: { unitsShort, unitsLong, vShort, vLong } } (v* per trading day).
 */
export async function getLocationVelocity(locationId, now = new Date()) {
  const { short, long } = VELOCITY_WINDOW_DAYS;
  const sinceLong = new Date(now.getTime() - long * MS_PER_DAY);
  const sinceShort = new Date(now.getTime() - short * MS_PER_DAY);

  const rows = await prisma.$queryRaw`
    SELECT s.sku,
      COALESCE(SUM(s.quantity) FILTER (WHERE s."timestamp" >= ${sinceShort}), 0)::int AS units_short,
      COALESCE(SUM(s.quantity), 0)::int AS units_long
    FROM sales s
    ${SALE_LOCATION_JOINS}
    WHERE s.is_refunded = false
      AND ${SALE_LOCATION_ID} = ${locationId}
      AND s."timestamp" >= ${sinceLong}
    GROUP BY s.sku
  `;

  const tradingShort = Math.max(1, countTradingDaysInWindow(sinceShort, now));
  const tradingLong = Math.max(1, countTradingDaysInWindow(sinceLong, now));

  const map = {};
  for (const r of rows) {
    map[r.sku] = {
      unitsShort: r.units_short,
      unitsLong: r.units_long,
      vShort: r.units_short / tradingShort,
      vLong: r.units_long / tradingLong,
    };
  }
  return map;
}

/**
 * Resolve the restock cycle for a suggestion run.
 *
 * - weekly (default): the standing cycle — order midweek, weekend delivery,
 *   restock next Monday. sellingDaysBeforeRestock is the Mon–Fri days the
 *   machines still have to sell through BEFORE that Monday (machine stock is
 *   frozen Fri night → Mon, so it's simply the trading days strictly between
 *   now and the restock Monday). Cover is the location's coverDays
 *   (trading days), default 5 = one selling week.
 * - topup: an emergency mid-week run — restock the NEXT trading day and cover
 *   only the trading days remaining until the following Monday cycle takes
 *   over (minimum 1).
 *
 * Pure; exported for tests.
 */
export function resolveModeMeta(now, { mode = 'weekly', coverDays = null } = {}) {
  if (mode === 'topup') {
    const restockDate = nextTradingDay(now);
    // Trading days from restockDate (inclusive) up to — exclusive — the next
    // Monday after it, i.e. the remainder of that selling week.
    const weekEnd = new Date(nextMonday(restockDate).getTime() - MS_PER_DAY);
    const coverTradingDays = Math.max(1, countTradingDaysInWindow(restockDate, weekEnd));
    return { mode: 'topup', restockDate, sellingDaysBeforeRestock: 0, coverTradingDays };
  }

  const restockDate = nextMonday(now);
  return {
    mode: 'weekly',
    restockDate,
    sellingDaysBeforeRestock: countTradingDaysBetween(now, restockDate),
    coverTradingDays: coverDays ?? DEFAULT_COVER_DAYS,
  };
}

/**
 * Per-location line maths for a single product or fresh-meal group. Pure;
 * exported for tests.
 *
 * projectedStock = machine stock burned down by velocity over the trading days
 * left before the restock lands. targetFill = enough for coverTradingDays of
 * demand, capped at maxStock. With no recent demand, fall back to a par top-up
 * when the line is at/below its min (maxStock preferred, min-only configs top
 * up to the min itself — the old engine required BOTH min and max and silently
 * skipped min-only lines).
 *
 * Returns null when the line needs no attention (no demand and not below min);
 * otherwise { projectedStock, targetFill, grossNeed, daysOfCover, priority, basis }.
 */
export function computeSuggestion({
  machineStock = 0,
  velocityTd = 0,
  sellingDaysBeforeRestock = 0,
  coverTradingDays = DEFAULT_COVER_DAYS,
  minStock = null,
  maxStock = null,
}) {
  const hasDemand = velocityTd > 0;
  const projectedStock = Math.max(
    0,
    machineStock - Math.ceil(velocityTd * sellingDaysBeforeRestock),
  );

  let targetFill;
  let basis;
  if (hasDemand) {
    targetFill = Math.min(
      maxStock ?? Infinity,
      Math.ceil(velocityTd * coverTradingDays),
    );
    basis = 'velocity';
  } else if (minStock != null && projectedStock <= minStock) {
    targetFill = maxStock ?? minStock;
    basis = 'par_fallback';
  } else {
    return null; // no demand and not below min — leave it
  }

  const grossNeed = Math.max(0, targetFill - projectedStock);
  // Days of cover in TRADING days at the blended rate.
  const daysOfCover = hasDemand ? round(machineStock / velocityTd) : null;

  // Critical = projected to be empty by restock, or already at/below its min.
  let priority = 'warning';
  if (projectedStock <= 0 || (minStock != null && projectedStock <= minStock)) {
    priority = 'critical';
  }

  return { projectedStock, targetFill, grossNeed, daysOfCover, priority, basis };
}

/**
 * Net a (merged) line's gross need against the shared warehouse pool and
 * incoming pending POs. Pure; exported for tests.
 */
export function computeNetNeed(grossNeed, warehouseStock = 0, pendingPOQty = 0) {
  return Math.max(0, grossNeed - warehouseStock - pendingPOQty);
}

/**
 * Round a net need to whole boxes without ever exceeding physical machine
 * capacity: round UP by default, but when the summed maxStock across the
 * contributing locations is known and rounding up would overshoot it, round
 * DOWN to the largest whole-box quantity that still fits. Pure; exported for
 * tests. maxStock=null means capacity unknown (no cap applied).
 */
export function computeOrderQty({ netNeed, unitsPerBox = 1, projectedStock = 0, maxStock = null }) {
  if (netNeed <= 0) return 0;
  const box = unitsPerBox > 0 ? unitsPerBox : 1;
  let qty = Math.ceil(netNeed / box) * box;
  if (maxStock != null && projectedStock + qty > maxStock) {
    qty = Math.max(0, Math.floor((maxStock - projectedStock) / box) * box);
  }
  return qty;
}

/**
 * Fill target for a planogram-scoped line: the diagram's summed slot capacity
 * when resolvable, else the config maxStock. Pure; exported for tests.
 */
export function effectiveMaxStock(scope, key, configMax) {
  if (!scope) return configMax ?? null;
  return scope.capacityByTarget.get(key) ?? configMax ?? null;
}

/**
 * Compute the per-location gross lines for one location: non-fresh products
 * per SKU, Frive fresh meals collapsed into one line per meal-type group
 * (stock + velocity summed across flavours, par from LocationMealConfig).
 * Velocity fields are kept RAW (unrounded) — rounding happens once, after
 * merging, to avoid re-rounding accumulation.
 *
 * When the location has a visual planogram (`planogram` from
 * getEffectiveLayout), lines are SCOPED to the slotted targets: non-fresh
 * products must be in scope.skuSet, meal groups in scope.mealTypeSet, and the
 * fill cap comes from the diagram's slot capacity (config maxStock fallback).
 * Assigned-but-unplaced targets are returned in `excluded` so the UI can warn
 * instead of silently dropping selling products.
 */
async function buildLocationGrossLines(location, now, meta, planogram = null) {
  const assignedSkus = location.assignedItems.map((a) => a.sku);
  const scope = planogram?.scope ?? null;

  const [stockRows, configRows, mealConfigRows, velocity] = await Promise.all([
    prisma.locationStock.findMany({ where: { locationId: location.id } }),
    prisma.locationConfig.findMany({ where: { locationId: location.id } }),
    prisma.locationMealConfig.findMany({ where: { locationId: location.id } }),
    getLocationVelocity(location.id, now),
  ]);

  // Mirror the client behaviour: scope to assigned products, or all if none set.
  const products = await prisma.product.findMany({
    where: assignedSkus.length > 0 ? { sku: { in: assignedSkus } } : undefined,
  });

  const stockMap = Object.fromEntries(stockRows.map((s) => [s.sku, s.quantity]));
  const configMap = Object.fromEntries(configRows.map((c) => [c.sku, c]));
  const mealConfigMap = Object.fromEntries(mealConfigRows.map((m) => [m.mealType, m]));
  const velOf = (sku) => velocity[sku] || { vShort: 0, vLong: 0, unitsShort: 0, unitsLong: 0 };

  const lines = [];
  const excluded = { skus: [], mealTypes: [] };

  // --- Non-fresh: per SKU ---
  for (const p of products.filter((p) => !p.isFreshMeal)) {
    if (scope && !scope.skuSet.has(p.sku)) {
      excluded.skus.push({ sku: p.sku, name: p.name });
      continue;
    }
    const machineStock = stockMap[p.sku] || 0;
    const cfg = configMap[p.sku] || {};
    const v = velOf(p.sku);
    const blended = blendVelocity(v.vShort, v.vLong);

    const sug = computeSuggestion({
      machineStock,
      velocityTd: blended,
      sellingDaysBeforeRestock: meta.sellingDaysBeforeRestock,
      coverTradingDays: meta.coverTradingDays,
      minStock: cfg.minStock ?? null,
      maxStock: effectiveMaxStock(scope, `sku:${p.sku}`, cfg.maxStock),
    });
    if (!sug || sug.grossNeed <= 0) continue;

    lines.push({
      type: 'product',
      sku: p.sku,
      name: p.name,
      category: p.category,
      preferredSupplierId: p.preferredSupplierId ?? null,
      machineStock,
      minStock: cfg.minStock ?? null,
      maxStock: effectiveMaxStock(scope, `sku:${p.sku}`, cfg.maxStock),
      unitsPerBox: p.unitsPerBox || 1,
      unitCost: p.unitCost || 0,
      vShort: v.vShort,
      vLong: v.vLong,
      blendedVelocity: blended, // raw — rounded once after merging
      salesSample: v.unitsLong,
      ...sug,
    });
  }

  // --- Fresh meals: one line per meal-type group ---
  const groups = {};
  for (const p of products.filter((p) => p.isFreshMeal)) {
    const key = p.mealType || 'Unclassified';
    (groups[key] ||= []).push(p);
  }

  for (const [mealType, members] of Object.entries(groups)) {
    if (scope && !scope.mealTypeSet.has(mealType)) {
      excluded.mealTypes.push(mealType);
      continue;
    }
    const machineStock = members.reduce((a, p) => a + (stockMap[p.sku] || 0), 0);
    const vShort = members.reduce((a, p) => a + velOf(p.sku).vShort, 0);
    const vLong = members.reduce((a, p) => a + velOf(p.sku).vLong, 0);
    const unitsLong = members.reduce((a, p) => a + velOf(p.sku).unitsLong, 0);
    const blended = blendVelocity(vShort, vLong);
    const cfg = mealConfigMap[mealType] || {};
    const groupMax = effectiveMaxStock(scope, `mealType:${mealType}`, cfg.maxStock);
    const avgCost = members.length
      ? members.reduce((a, p) => a + (p.unitCost || 0), 0) / members.length
      : 0;

    const sug = computeSuggestion({
      machineStock,
      velocityTd: blended,
      sellingDaysBeforeRestock: meta.sellingDaysBeforeRestock,
      coverTradingDays: meta.coverTradingDays,
      minStock: cfg.minStock ?? null,
      maxStock: groupMax,
    });
    if (!sug || sug.grossNeed <= 0) continue;

    // Frive is normally a single supplier; take the first member that has one.
    const groupSupplierId =
      members.find((p) => p.preferredSupplierId)?.preferredSupplierId ?? null;

    lines.push({
      type: 'freshMealGroup',
      mealType,
      isFreshMeal: true,
      name: `Frive ${mealType}`,
      preferredSupplierId: groupSupplierId,
      machineStock,
      minStock: cfg.minStock ?? null,
      maxStock: groupMax,
      unitsPerBox: 1, // order in units; flavour split happens at pick/restock
      unitCost: round(avgCost),
      vShort,
      vLong,
      blendedVelocity: blended,
      salesSample: unitsLong,
      ...sug,
      members: members.map((p) => ({
        sku: p.sku,
        name: p.name,
        preferredSupplierId: p.preferredSupplierId ?? null,
        currentStock: stockMap[p.sku] || 0,
        velocityLong: velOf(p.sku).vLong, // raw
      })),
    });
  }

  return { lines, excluded };
}

/**
 * Merge per-location gross lines by product (SKU) or fresh-meal group
 * (mealType). Stock, projections and needs are SUMMED across locations, and
 * every contributing location keeps a breakdown row. Velocities accumulate RAW
 * and are rounded once at output.
 */
function mergeLines(perLocationResults) {
  const merged = new Map();

  for (const { location, lines } of perLocationResults) {
    for (const s of lines) {
      const key = s.type === 'freshMealGroup' ? `frive:${s.mealType}` : `sku:${s.sku}`;
      let line = merged.get(key);

      if (!line) {
        const supplierId = s.preferredSupplierId ?? null;
        line = {
          id: key,
          type: s.type,
          sku: s.sku,           // undefined for a Frive group
          mealType: s.mealType, // undefined for a plain product
          isFreshMeal: s.type === 'freshMealGroup',
          name: s.name,
          category: s.category ?? (s.type === 'freshMealGroup' ? 'Fresh Meal' : 'Other'),
          supplierId,
          unitsPerBox: s.unitsPerBox || 1,
          unitCost: s.unitCost || 0,
          priority: 'warning',
          machineStock: 0,
          projectedStock: 0,
          grossNeed: 0,
          targetFill: 0,
          maxStock: 0,
          maxStockKnown: true, // false as soon as any contributing location has no cap
          _velocity: 0,        // raw accumulator; rounded once at output
          _memberSkus: new Set(),
          _memberVel: {},
          perLocation: [],
        };
        merged.set(key, line);
      }

      line.machineStock += s.machineStock;
      line.projectedStock += s.projectedStock;
      line.grossNeed += s.grossNeed;
      line.targetFill += s.targetFill;
      line._velocity += s.blendedVelocity || 0;
      if (s.maxStock == null) line.maxStockKnown = false;
      else line.maxStock += s.maxStock;
      if (s.priority === 'critical') line.priority = 'critical';

      if (s.type === 'freshMealGroup') {
        for (const m of s.members || []) {
          line._memberSkus.add(m.sku);
          const mv = (line._memberVel[m.sku] ||= {
            sku: m.sku,
            name: m.name,
            preferredSupplierId: m.preferredSupplierId ?? null,
            velocityLong: 0, // raw accumulator
          });
          mv.velocityLong += m.velocityLong || 0;
        }
      }

      line.perLocation.push({
        locationId: location.id,
        locationName: location.name,
        machineStock: s.machineStock,
        currentStock: s.machineStock, // legacy alias
        minStock: s.minStock,
        maxStock: s.maxStock,
        projectedStock: s.projectedStock,
        grossNeed: s.grossNeed,
        daysOfCover: s.daysOfCover,
        priority: s.priority,
        blendedVelocity: round(s.blendedVelocity || 0),
        targetFill: s.targetFill,
        targetStock: s.targetFill, // legacy alias
        basis: s.basis,
      });
    }
  }

  return [...merged.values()];
}

/**
 * Net merged lines against the single shared warehouse pool + incoming pending
 * POs, then round to boxes. Exactly TWO grouped queries regardless of line
 * count: warehouse quantity grouped by sku (summed across all warehouses) and
 * the open remainder (quantity − receivedQty, clamped ≥ 0 per item) of every
 * pending order item. Fresh-meal groups net against the SUM over member SKUs.
 */
async function finalizeLines(mergedLines, supplierNameOf) {
  const skus = new Set();
  for (const line of mergedLines) {
    if (line.type === 'freshMealGroup') line._memberSkus.forEach((s) => skus.add(s));
    else skus.add(line.sku);
  }
  const skuList = [...skus];

  const [whRows, pendingItems] = skuList.length
    ? await Promise.all([
        prisma.warehouseStock.groupBy({
          by: ['sku'],
          where: { sku: { in: skuList } },
          _sum: { quantity: true },
        }),
        prisma.orderItem.findMany({
          where: { sku: { in: skuList }, order: { status: 'pending' } },
          select: { sku: true, quantity: true, receivedQty: true },
        }),
      ])
    : [[], []];

  const whMap = Object.fromEntries(whRows.map((r) => [r.sku, r._sum.quantity || 0]));
  const pendMap = {};
  for (const it of pendingItems) {
    // Clamp per item: an over-received line must not offset other lines' needs.
    pendMap[it.sku] = (pendMap[it.sku] || 0) + Math.max(0, it.quantity - (it.receivedQty || 0));
  }

  return mergedLines.map((line) => {
    const {
      _velocity, _memberSkus, _memberVel, maxStockKnown, maxStock, ...rest
    } = line;

    const memberSkus = line.type === 'freshMealGroup' ? [..._memberSkus] : [line.sku];
    const warehouseStock = memberSkus.reduce((a, s) => a + (whMap[s] || 0), 0);
    const pendingPOQty = memberSkus.reduce((a, s) => a + (pendMap[s] || 0), 0);
    const netNeed = computeNetNeed(line.grossNeed, warehouseStock, pendingPOQty);
    const orderQty = computeOrderQty({
      netNeed,
      unitsPerBox: line.unitsPerBox,
      projectedStock: line.projectedStock,
      maxStock: maxStockKnown ? maxStock : null,
    });
    const box = line.unitsPerBox > 0 ? line.unitsPerBox : 1;
    const boxes = Math.ceil(orderQty / box);
    const blended = round(_velocity);

    return {
      ...rest,
      preferredSupplierId: line.supplierId, // legacy alias
      supplierName: line.supplierId
        ? supplierNameOf[line.supplierId] || 'Unknown supplier'
        : null,
      currentStock: line.machineStock, // legacy alias for machineStock
      maxStock: maxStockKnown ? maxStock : null,
      warehouseStock,
      pendingPOQty,
      netNeed,
      orderQty,
      boxes,
      boxesNeeded: boxes, // legacy alias
      targetStock: line.targetFill, // legacy alias
      suggestedQty: netNeed, // legacy alias (pre-rounding quantity)
      blendedVelocity: blended, // units per TRADING day
      daysOfCover: _velocity > 0 ? round(line.machineStock / _velocity) : null,
      members: line.type === 'freshMealGroup'
        ? Object.values(_memberVel).map((m) => ({ ...m, velocityLong: round(m.velocityLong) }))
        : undefined,
    };
  });
}

/**
 * Merge per-location "not on diagram" exclusions into one deduped list, each
 * entry carrying the location names it applies to. Only locations where a
 * planogram was applied contribute. Pure; exported for tests.
 *
 * perLocation: [{ locationName, applied, excluded: { skus: [{sku,name}], mealTypes: [str] } }]
 */
export function mergeNotOnPlanogram(perLocation) {
  const skuMap = new Map();
  const mealMap = new Map();
  for (const loc of perLocation || []) {
    if (!loc.applied || !loc.excluded) continue;
    for (const { sku, name } of loc.excluded.skus || []) {
      const entry = skuMap.get(sku) || { sku, name, locations: [] };
      entry.locations.push(loc.locationName);
      skuMap.set(sku, entry);
    }
    for (const mealType of loc.excluded.mealTypes || []) {
      const entry = mealMap.get(mealType) || { mealType, locations: [] };
      entry.locations.push(loc.locationName);
      mealMap.set(mealType, entry);
    }
  }
  return { skus: [...skuMap.values()], mealTypes: [...mealMap.values()] };
}

/**
 * Build purchase-order suggestions for ONE location, netted against the shared
 * warehouse pool and pending POs.
 *
 * options.mode: 'weekly' (default — order for the next Monday restock) or
 * 'topup' (emergency next-trading-day run). Returns null for an unknown
 * location.
 */
export async function buildOrderSuggestions(locationId, now = new Date(), options = {}) {
  const mode = options.mode === 'topup' ? 'topup' : 'weekly';

  const location = await prisma.location.findUnique({
    where: { id: locationId },
    include: { assignedItems: true },
  });
  if (!location) return null;

  const { leadTimeDays, coverDays } = resolveOrderingConfig(location);
  const meta = resolveModeMeta(now, { mode, coverDays });

  const [planogram, suppliers] = await Promise.all([
    getEffectiveLayout(location.id, { prefer: 'next' }),
    prisma.supplier.findMany({ select: { id: true, name: true } }),
  ]);
  const { lines, excluded } = await buildLocationGrossLines(location, now, meta, planogram);
  const supplierNameOf = Object.fromEntries(suppliers.map((s) => [s.id, s.name]));

  const merged = mergeLines([{ location, lines }]);
  const suggestions = await finalizeLines(merged, supplierNameOf);

  // Critical first, then by least days of cover (most urgent), unknowns last.
  suggestions.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority === 'critical' ? -1 : 1;
    return (a.daysOfCover ?? Infinity) - (b.daysOfCover ?? Infinity);
  });

  const perLocation = [{
    locationId: location.id,
    locationName: location.name,
    applied: !!planogram,
    source: planogram?.source ?? null,
    excluded: planogram ? excluded : null,
  }];

  return {
    locationId,
    leadTimeDays,
    coverDays, // trading days
    mode: meta.mode,
    restockDate: meta.restockDate.toISOString(),
    sellingDaysBeforeRestock: meta.sellingDaysBeforeRestock,
    coverTradingDays: meta.coverTradingDays,
    generatedAt: now.toISOString(),
    velocityWindows: VELOCITY_WINDOW_DAYS,
    planogram: { perLocation, notOnPlanogram: mergeNotOnPlanogram(perLocation) },
    suggestions,
  };
}

/**
 * Build ONE consolidated purchase-order suggestion list across many locations.
 *
 * Runs the per-location engine for each location, merges lines by product
 * (SKU) or fresh-meal group (mealType), then nets the SUMMED gross need once
 * against the shared warehouse pool and pending POs (netting after merging —
 * the warehouse must not be double-counted per location). Each line keeps a
 * per-location breakdown and its preferred supplier so the frontend can group
 * lines into per-supplier POs. Returns null if none of the ids resolve.
 */
export async function buildConsolidatedSuggestions(locationIds, now = new Date(), options = {}) {
  const mode = options.mode === 'topup' ? 'topup' : 'weekly';

  const locations = await prisma.location.findMany({
    where: { id: { in: locationIds } },
    include: { assignedItems: true },
  });
  if (locations.length === 0) return null;

  const meta = resolveModeMeta(now, { mode });

  const [perLocationResults, suppliers] = await Promise.all([
    Promise.all(
      locations.map(async (location) => {
        // Weekly cover is per-location configurable (trading days); topup cover
        // is the remainder of the selling week, identical for every location.
        const locMeta = mode === 'weekly'
          ? { ...meta, coverTradingDays: resolveOrderingConfig(location).coverDays }
          : meta;
        const planogram = await getEffectiveLayout(location.id, { prefer: 'next' });
        const { lines, excluded } = await buildLocationGrossLines(location, now, locMeta, planogram);
        return { location, lines, excluded, planogram };
      }),
    ),
    prisma.supplier.findMany({ select: { id: true, name: true } }),
  ]);
  const supplierNameOf = Object.fromEntries(suppliers.map((s) => [s.id, s.name]));

  const merged = mergeLines(perLocationResults);
  const suggestions = await finalizeLines(merged, supplierNameOf);

  // Critical first, then heaviest order first (rough proxy for urgency).
  suggestions.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority === 'critical' ? -1 : 1;
    return b.orderQty - a.orderQty;
  });

  const perLocation = perLocationResults.map(({ location, excluded, planogram }) => ({
    locationId: location.id,
    locationName: location.name,
    applied: !!planogram,
    source: planogram?.source ?? null,
    excluded: planogram ? excluded : null,
  }));

  return {
    locationIds: locations.map((l) => l.id),
    locations: locations.map((l) => ({ id: l.id, name: l.name })),
    mode: meta.mode,
    restockDate: meta.restockDate.toISOString(),
    sellingDaysBeforeRestock: meta.sellingDaysBeforeRestock,
    coverTradingDays: meta.coverTradingDays,
    generatedAt: now.toISOString(),
    velocityWindows: VELOCITY_WINDOW_DAYS,
    planogram: { perLocation, notOnPlanogram: mergeNotOnPlanogram(perLocation) },
    suggestions,
  };
}
