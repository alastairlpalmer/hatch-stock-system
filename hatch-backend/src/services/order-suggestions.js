import prisma from '../utils/db.js';
import { SALE_LOCATION_JOINS, SALE_LOCATION_ID } from '../utils/sales-location.js';
import {
  resolveOrderingConfig,
  blendVelocity,
  VELOCITY_WINDOW_DAYS,
} from '../config/ordering.js';

const MS_PER_DAY = 86_400_000;
const round = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const boxUp = (qty, box) => {
  const b = box > 0 ? box : 1;
  return Math.ceil(qty / b) * b;
};

/**
 * Trailing sales velocity (units/day) per SKU at a location, over the short and
 * long windows. Sales are attributed to the location via the Phase 0 resolver
 * (VendLive machine mapping, name fallback). Refunds excluded.
 * Returns { [sku]: { units14, units28, vShort, vLong } }.
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

  const map = {};
  for (const r of rows) {
    map[r.sku] = {
      unitsShort: r.units_short,
      unitsLong: r.units_long,
      vShort: r.units_short / short,
      vLong: r.units_long / long,
    };
  }
  return map;
}

/**
 * Decide whether to reorder a single line (a product or a fresh-meal group) and
 * how much, using a days-of-cover model with par levels as guardrails.
 *
 * targetStock = velocity * (leadTime + cover), capped at maxStock.
 * Order the gap up to that target, rounded up to whole boxes.
 * When there's no recent demand, fall back to a par top-up only if below min.
 * Returns the suggestion fields, or null if no order is needed.
 */
export function computeSuggestion({
  currentStock = 0,
  velocity = 0,
  leadTimeDays,
  coverDays,
  minStock = null,
  maxStock = null,
  unitsPerBox = 1,
}) {
  const horizonDays = leadTimeDays + coverDays;
  const hasDemand = velocity > 0;

  let targetStock;
  let basis;
  if (hasDemand) {
    targetStock = Math.ceil(velocity * horizonDays);
    basis = 'velocity';
  } else if (maxStock != null && minStock != null && currentStock <= minStock) {
    // Doesn't sell lately but is below its floor — top up to par.
    targetStock = maxStock;
    basis = 'par_fallback';
  } else {
    return null; // no demand and not below min — leave it
  }

  // Par ceiling guardrail.
  if (maxStock != null) targetStock = Math.min(targetStock, maxStock);

  const rawQty = targetStock - currentStock;
  if (rawQty <= 0) return null; // already covered

  const orderQty = boxUp(rawQty, unitsPerBox);
  const daysOfCover = hasDemand ? round(currentStock / velocity) : null;

  // Critical = will run dry before a reorder could arrive, or already below min.
  let priority = 'warning';
  if (hasDemand && currentStock < velocity * leadTimeDays) priority = 'critical';
  else if (minStock != null && currentStock <= minStock) priority = 'critical';

  return {
    targetStock,
    suggestedQty: rawQty,
    orderQty,
    boxesNeeded: Math.ceil(rawQty / (unitsPerBox > 0 ? unitsPerBox : 1)),
    daysOfCover,
    priority,
    basis,
  };
}

/**
 * Build purchase-order suggestions for a location. Non-fresh products are
 * evaluated per SKU; Frive fresh meals collapse into one line per meal-type
 * group (stock + velocity summed across flavours, par from LocationMealConfig),
 * matching how the Locations tab groups them.
 */
export async function buildOrderSuggestions(locationId, now = new Date()) {
  const location = await prisma.location.findUnique({
    where: { id: locationId },
    include: { assignedItems: true },
  });
  if (!location) return null;

  const { leadTimeDays, coverDays } = resolveOrderingConfig(location);
  const assignedSkus = location.assignedItems.map((a) => a.sku);

  const [stockRows, configRows, mealConfigRows, velocity] = await Promise.all([
    prisma.locationStock.findMany({ where: { locationId } }),
    prisma.locationConfig.findMany({ where: { locationId } }),
    prisma.locationMealConfig.findMany({ where: { locationId } }),
    getLocationVelocity(locationId, now),
  ]);

  // Mirror the client behaviour: scope to assigned products, or all if none set.
  const products = await prisma.product.findMany({
    where: assignedSkus.length > 0 ? { sku: { in: assignedSkus } } : undefined,
  });

  const stockMap = Object.fromEntries(stockRows.map((s) => [s.sku, s.quantity]));
  const configMap = Object.fromEntries(configRows.map((c) => [c.sku, c]));
  const mealConfigMap = Object.fromEntries(mealConfigRows.map((m) => [m.mealType, m]));
  const velOf = (sku) => velocity[sku] || { vShort: 0, vLong: 0, unitsShort: 0, unitsLong: 0 };

  const suggestions = [];

  // --- Non-fresh: per SKU ---
  for (const p of products.filter((p) => !p.isFreshMeal)) {
    const currentStock = stockMap[p.sku] || 0;
    const cfg = configMap[p.sku] || {};
    const v = velOf(p.sku);
    const blended = blendVelocity(v.vShort, v.vLong);

    const sug = computeSuggestion({
      currentStock,
      velocity: blended,
      leadTimeDays,
      coverDays,
      minStock: cfg.minStock ?? null,
      maxStock: cfg.maxStock ?? null,
      unitsPerBox: p.unitsPerBox || 1,
    });
    if (!sug) continue;

    suggestions.push({
      type: 'product',
      sku: p.sku,
      name: p.name,
      category: p.category,
      preferredSupplierId: p.preferredSupplierId ?? null,
      currentStock,
      minStock: cfg.minStock ?? null,
      maxStock: cfg.maxStock ?? null,
      unitsPerBox: p.unitsPerBox || 1,
      unitCost: p.unitCost || 0,
      velocityShort: round(v.vShort),
      velocityLong: round(v.vLong),
      blendedVelocity: round(blended),
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
    const currentStock = members.reduce((a, p) => a + (stockMap[p.sku] || 0), 0);
    const vShort = members.reduce((a, p) => a + velOf(p.sku).vShort, 0);
    const vLong = members.reduce((a, p) => a + velOf(p.sku).vLong, 0);
    const unitsLong = members.reduce((a, p) => a + velOf(p.sku).unitsLong, 0);
    const blended = blendVelocity(vShort, vLong);
    const cfg = mealConfigMap[mealType] || {};
    const avgCost = members.length
      ? members.reduce((a, p) => a + (p.unitCost || 0), 0) / members.length
      : 0;

    const sug = computeSuggestion({
      currentStock,
      velocity: blended,
      leadTimeDays,
      coverDays,
      minStock: cfg.minStock ?? null,
      maxStock: cfg.maxStock ?? null,
      unitsPerBox: 1, // order in units; flavour split happens at pick/restock
    });
    if (!sug) continue;

    // Frive is normally a single supplier; take the first member that has one.
    const groupSupplierId =
      members.find((p) => p.preferredSupplierId)?.preferredSupplierId ?? null;

    suggestions.push({
      type: 'freshMealGroup',
      mealType,
      name: `Frive ${mealType}`,
      preferredSupplierId: groupSupplierId,
      currentStock,
      minStock: cfg.minStock ?? null,
      maxStock: cfg.maxStock ?? null,
      unitsPerBox: 1,
      unitCost: round(avgCost),
      velocityShort: round(vShort),
      velocityLong: round(vLong),
      blendedVelocity: round(blended),
      salesSample: unitsLong,
      ...sug,
      members: members.map((p) => ({
        sku: p.sku,
        name: p.name,
        preferredSupplierId: p.preferredSupplierId ?? null,
        currentStock: stockMap[p.sku] || 0,
        velocityLong: round(velOf(p.sku).vLong),
      })),
    });
  }

  // Critical first, then by least days of cover (most urgent), unknowns last.
  suggestions.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority === 'critical' ? -1 : 1;
    return (a.daysOfCover ?? Infinity) - (b.daysOfCover ?? Infinity);
  });

  return {
    locationId,
    leadTimeDays,
    coverDays,
    velocityWindows: VELOCITY_WINDOW_DAYS,
    suggestions,
  };
}

/**
 * Build ONE consolidated purchase-order suggestion list across many locations.
 *
 * Runs the per-location engine for each location, then merges lines by product
 * (SKU) or fresh-meal group (mealType): order quantities are SUMMED across
 * locations, and every location that contributed keeps a breakdown row so the UI
 * can expand a line into "which locations drove this". Each line is tagged with
 * its preferred supplier so the frontend can group lines into per-supplier POs.
 *
 * Consolidation is additive: each location computes its own days-of-cover target
 * independently, and we sum the resulting gaps — a location fully stocked simply
 * contributes nothing. Returns null if none of the ids resolve to a location.
 */
export async function buildConsolidatedSuggestions(locationIds, now = new Date()) {
  const locations = await prisma.location.findMany({
    where: { id: { in: locationIds } },
    select: { id: true, name: true },
  });
  if (locations.length === 0) return null;

  const nameOf = Object.fromEntries(locations.map((l) => [l.id, l.name]));

  const [perLocation, suppliers] = await Promise.all([
    Promise.all(locations.map((l) => buildOrderSuggestions(l.id, now))),
    prisma.supplier.findMany({ select: { id: true, name: true } }),
  ]);
  const supplierNameOf = Object.fromEntries(suppliers.map((s) => [s.id, s.name]));

  // key -> merged line (with a private _memberVel accumulator for Frive splits)
  const merged = new Map();

  for (const result of perLocation) {
    if (!result) continue;
    const locId = result.locationId;

    for (const s of result.suggestions) {
      const key = s.type === 'freshMealGroup' ? `frive:${s.mealType}` : `sku:${s.sku}`;
      let line = merged.get(key);

      if (!line) {
        const supplierId = s.preferredSupplierId ?? null;
        line = {
          id: key,
          type: s.type,
          sku: s.sku,           // undefined for a Frive group
          mealType: s.mealType, // undefined for a plain product
          name: s.name,
          category: s.category ?? (s.type === 'freshMealGroup' ? 'Fresh Meal' : 'Other'),
          supplierId,
          supplierName: supplierId ? supplierNameOf[supplierId] || 'Unknown supplier' : null,
          unitsPerBox: s.unitsPerBox || 1,
          unitCost: s.unitCost || 0,
          priority: 'warning',
          currentStock: 0,
          maxStock: 0,
          maxStockKnown: true, // false as soon as any contributing location has no cap
          orderQty: 0,
          boxesNeeded: 0,
          blendedVelocity: 0,
          targetStock: 0,
          perLocation: [],
          _memberVel: {},
        };
        merged.set(key, line);
      }

      line.orderQty += s.orderQty;
      line.boxesNeeded += s.boxesNeeded;
      line.currentStock += s.currentStock;
      line.blendedVelocity = round(line.blendedVelocity + (s.blendedVelocity || 0));
      line.targetStock += s.targetStock;
      if (s.maxStock == null) line.maxStockKnown = false;
      else line.maxStock += s.maxStock;
      if (s.priority === 'critical') line.priority = 'critical';

      if (s.type === 'freshMealGroup') {
        for (const m of s.members || []) {
          const mv = (line._memberVel[m.sku] ||= {
            sku: m.sku,
            name: m.name,
            preferredSupplierId: m.preferredSupplierId ?? null,
            velocityLong: 0,
          });
          mv.velocityLong = round(mv.velocityLong + (m.velocityLong || 0));
        }
      }

      line.perLocation.push({
        locationId: locId,
        locationName: nameOf[locId],
        currentStock: s.currentStock,
        orderQty: s.orderQty,
        boxesNeeded: s.boxesNeeded,
        daysOfCover: s.daysOfCover,
        priority: s.priority,
        blendedVelocity: s.blendedVelocity,
        targetStock: s.targetStock,
      });
    }
  }

  const suggestions = [...merged.values()].map((line) => {
    const { _memberVel, maxStockKnown, ...rest } = line;
    return {
      ...rest,
      maxStock: maxStockKnown ? rest.maxStock : null,
      members: line.type === 'freshMealGroup' ? Object.values(_memberVel) : undefined,
    };
  });

  // Critical first, then heaviest order first (rough proxy for urgency).
  suggestions.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority === 'critical' ? -1 : 1;
    return b.orderQty - a.orderQty;
  });

  return {
    locationIds: locations.map((l) => l.id),
    locations,
    velocityWindows: VELOCITY_WINDOW_DAYS,
    suggestions,
  };
}
