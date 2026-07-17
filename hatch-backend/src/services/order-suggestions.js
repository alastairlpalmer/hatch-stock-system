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
 * Effective min/max for a product family at one location. Pure; exported for
 * tests (the ×member-count capacity bug and the partial-config understatement
 * both lived in the previous inline version of this logic).
 *
 * Max precedence: planogram capacity → location_parent_config → summed per-SKU
 * config. Planogram capacity counts the family's parent-slot capacity ONCE
 * plus each individually-slotted member's own slot capacity; any unresolvable
 * slot poisons the total to unknown (matches buildPlanogramScope semantics).
 * Config sums are only trusted when EVERY member has a value — a partial sum
 * would silently understate the family target (one configured flavour capping
 * a four-flavour family).
 *
 * @param {Object} p
 * @param {Object|null} p.scope buildPlanogramScope output or null
 * @param {string} p.parentId
 * @param {Array}  p.members in-scope member products [{ sku }]
 * @param {Object} p.parentCfg LocationParentConfig row ({} when none)
 * @param {Object} p.configMap { sku: LocationConfig row }
 * @returns {{ groupMax: number|null, groupMin: number|null }}
 */
export function computeFamilyCaps({ scope, parentId, members, parentCfg = {}, configMap = {} }) {
  let scopeCapacity = null;
  if (scope) {
    let total = 0;
    let known = true;
    let any = false;
    if (scope.parentSet?.has(parentId)) {
      any = true;
      const parentCap = scope.capacityByTarget.get(`parent:${parentId}`);
      if (parentCap == null) known = false;
      else total += parentCap;
    }
    for (const p of members) {
      if (!scope.skuSet.has(p.sku)) continue;
      any = true;
      const c = scope.capacityByTarget.get(`sku:${p.sku}`);
      if (c == null) { known = false; break; }
      total += c;
    }
    if (any && known) scopeCapacity = total;
  }
  const summedCfg = (field) => {
    const vals = members.map((p) => configMap[p.sku]?.[field]).filter((v) => v != null);
    return vals.length > 0 && vals.length === members.length
      ? vals.reduce((a, v) => a + v, 0)
      : null;
  };
  return {
    groupMax: scopeCapacity ?? parentCfg.maxStock ?? summedCfg('maxStock'),
    groupMin: parentCfg.minStock ?? summedCfg('minStock'),
  };
}

/**
 * Split a parent-family net need into per-flavour boxes ("6 boxes of
 * Barebells" → "3 choc, 2 caramel, 1 cookies"). Pure; exported for tests.
 *
 * Shares come from each flavour's long-window velocity (the 28-day window is
 * the smoothing — short-window noise on tiny vending volumes would churn the
 * split every week). Cold start (no member has any sales) falls back to equal
 * shares. Box rounding is largest-remainder so the flavour box counts always
 * cover the need with at most one surplus box: floor each flavour's ideal box
 * count, then hand out one box at a time to the largest fractional remainder
 * (ties: higher velocity, then sku) until the need is covered.
 *
 * minShareForBox: a flavour with REAL sales (velocity > 0) at or above this
 * share of the family is guaranteed one box (when the need is at least that
 * box and it fits the cap), even if rounding gave it zero — the per-flavour
 * floor from the design review, so a popular flavour can't be starved by two
 * dominant siblings. The velocity requirement matters: cold-start families
 * have equal shares, and flooring every flavour of a no-history family used
 * to multiply the order by the member count.
 *
 * maxUnits: hard allocation ceiling (machine-capacity headroom). The
 * largest-remainder loop rounds UP to cover the need, but never places a box
 * that would exceed maxUnits — the family analogue of computeOrderQty's
 * round-down-at-capacity rule. Default Infinity (no cap).
 *
 * members: [{ sku, name, unitsPerBox, velocityLong, ... }] (extra fields kept)
 * Returns members decorated with { sharePct, units, boxes }, velocity-desc.
 */
export function splitParentNeed({ netNeed, members = [], minShareForBox = 0.2, maxUnits = Infinity }) {
  const boxOf = (m) => (m.unitsPerBox > 0 ? m.unitsPerBox : 1);
  const totalVel = members.reduce((a, m) => a + (m.velocityLong || 0), 0);
  const shareOf = (m) =>
    totalVel > 0 ? (m.velocityLong || 0) / totalVel : members.length ? 1 / members.length : 0;

  const out = members.map((m) => ({
    ...m,
    sharePct: round(shareOf(m) * 100),
    units: 0,
    boxes: 0,
    _share: shareOf(m),
    _rem: 0,
  }));

  if (netNeed > 0 && out.length > 0) {
    const allocated = () => out.reduce((a, m) => a + m.boxes * boxOf(m), 0);
    for (const m of out) {
      const idealBoxes = (netNeed * m._share) / boxOf(m);
      m.boxes = Math.floor(idealBoxes);
      m._rem = idealBoxes - m.boxes;
    }
    // Initial floored shares sum to ≤ netNeed, so with netNeed ≤ maxUnits
    // (finalizeLines caps it) the starting allocation is always within the cap.
    const byRemainder = (a, b) =>
      b._rem - a._rem
      || (b.velocityLong || 0) - (a.velocityLong || 0)
      || String(a.sku).localeCompare(String(b.sku));
    while (allocated() < netNeed) {
      // Hand the next box to the largest remainder that still FITS the cap;
      // when nothing fits, the need is as covered as capacity allows.
      const next = [...out].sort(byRemainder).find((m) => allocated() + boxOf(m) <= maxUnits);
      if (!next) break;
      next.boxes += 1;
      next._rem -= 1; // deprioritise but keep eligible if still short
    }
    // Per-flavour floor: a proven seller never rounds to nothing.
    for (const m of out) {
      if (
        m.boxes === 0
        && (m.velocityLong || 0) > 0
        && m._share >= minShareForBox
        && netNeed >= boxOf(m)
        && allocated() + boxOf(m) <= maxUnits
      ) {
        m.boxes = 1;
      }
    }
    for (const m of out) m.units = m.boxes * boxOf(m);
  }

  out.sort((a, b) => (b.velocityLong || 0) - (a.velocityLong || 0) || String(a.sku).localeCompare(String(b.sku)));
  return out.map(({ _share, _rem, ...m }) => m);
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

  const [stockRows, configRows, mealConfigRows, parentConfigRows, parents, velocity] = await Promise.all([
    prisma.locationStock.findMany({ where: { locationId: location.id } }),
    prisma.locationConfig.findMany({ where: { locationId: location.id } }),
    prisma.locationMealConfig.findMany({ where: { locationId: location.id } }),
    prisma.locationParentConfig.findMany({ where: { locationId: location.id } }),
    prisma.productParent.findMany({ select: { id: true, name: true } }),
    getLocationVelocity(location.id, now),
  ]);

  // Mirror the client behaviour: scope to assigned products, or all if none set.
  const products = await prisma.product.findMany({
    where: assignedSkus.length > 0 ? { sku: { in: assignedSkus } } : undefined,
  });

  const stockMap = Object.fromEntries(stockRows.map((s) => [s.sku, s.quantity]));
  const configMap = Object.fromEntries(configRows.map((c) => [c.sku, c]));
  const mealConfigMap = Object.fromEntries(mealConfigRows.map((m) => [m.mealType, m]));
  const parentConfigMap = Object.fromEntries(parentConfigRows.map((c) => [c.parentId, c]));
  const parentNameOf = Object.fromEntries(parents.map((p) => [p.id, p.name]));
  const velOf = (sku) => velocity[sku] || { vShort: 0, vLong: 0, unitsShort: 0, unitsLong: 0 };

  const lines = [];
  const excluded = { skus: [], mealTypes: [], parents: [] };

  // --- Non-fresh, no family: per SKU ---
  // Partition rule: a flavour with a parent NEVER appears as its own SKU line —
  // it is counted exactly once, inside its family group below. The rule is
  // evaluated per line type globally but scope (which flavours are actually in
  // THIS machine) is applied per location inside each branch, so the same
  // flavour can be slotted at machine A and absent at machine B without ever
  // being double-counted.
  for (const p of products.filter((p) => !p.isFreshMeal && !p.parentId)) {
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

  // --- Product families: one line per parent, flavours summed ---
  // Members at THIS location are the flavours actually in the machine: with a
  // planogram, only slotted flavours count (a slot targeting the sku today; a
  // 'parent' slot type arrives with the planogram phase — scope.parentSet is
  // checked defensively so it lights up when that lands). Config precedence:
  // planogram capacity → location_parent_config → summed per-SKU config.
  const familyGroups = {};
  for (const p of products.filter((p) => !p.isFreshMeal && p.parentId)) {
    (familyGroups[p.parentId] ||= []).push(p);
  }

  for (const [parentId, allMembers] of Object.entries(familyGroups)) {
    const parentName = parentNameOf[parentId] || allMembers[0].name;
    const members = scope
      ? allMembers.filter((p) => scope.skuSet.has(p.sku) || scope.parentSet?.has(parentId))
      : allMembers;
    if (members.length === 0) {
      excluded.parents.push({ parentId, name: parentName });
      continue;
    }

    const machineStock = members.reduce((a, p) => a + (stockMap[p.sku] || 0), 0);
    const vShort = members.reduce((a, p) => a + velOf(p.sku).vShort, 0);
    const vLong = members.reduce((a, p) => a + velOf(p.sku).vLong, 0);
    const unitsLong = members.reduce((a, p) => a + velOf(p.sku).unitsLong, 0);
    const blended = blendVelocity(vShort, vLong);
    const cfg = parentConfigMap[parentId] || {};

    const { groupMax, groupMin } = computeFamilyCaps({
      scope,
      parentId,
      members,
      parentCfg: cfg,
      configMap,
    });

    const sug = computeSuggestion({
      machineStock,
      velocityTd: blended,
      sellingDaysBeforeRestock: meta.sellingDaysBeforeRestock,
      coverTradingDays: meta.coverTradingDays,
      minStock: groupMin,
      maxStock: groupMax,
    });
    if (!sug || sug.grossNeed <= 0) continue;

    const groupSupplierId =
      members.find((p) => p.preferredSupplierId)?.preferredSupplierId ?? null;
    const avgCost = members.length
      ? members.reduce((a, p) => a + (p.unitCost || 0), 0) / members.length
      : 0;

    lines.push({
      type: 'parentGroup',
      parentId,
      name: parentName,
      category: members[0].category ?? 'Other',
      preferredSupplierId: groupSupplierId,
      machineStock,
      minStock: groupMin,
      maxStock: groupMax,
      unitsPerBox: 1, // per-flavour boxes come from the split in finalizeLines
      unitCost: round(avgCost),
      vShort,
      vLong,
      blendedVelocity: blended,
      salesSample: unitsLong,
      ...sug,
      members: members.map((p) => ({
        sku: p.sku,
        name: p.name,
        unitsPerBox: p.unitsPerBox || 1,
        unitCost: p.unitCost || 0,
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
      const key = s.type === 'freshMealGroup' ? `frive:${s.mealType}`
        : s.type === 'parentGroup' ? `parent:${s.parentId}`
        : `sku:${s.sku}`;
      let line = merged.get(key);

      if (!line) {
        const supplierId = s.preferredSupplierId ?? null;
        line = {
          id: key,
          type: s.type,
          sku: s.sku,           // undefined for any group line
          mealType: s.mealType, // undefined except Frive groups
          parentId: s.parentId, // undefined except family groups
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

      if (s.type === 'freshMealGroup' || s.type === 'parentGroup') {
        for (const m of s.members || []) {
          line._memberSkus.add(m.sku);
          const mv = (line._memberVel[m.sku] ||= {
            sku: m.sku,
            name: m.name,
            preferredSupplierId: m.preferredSupplierId ?? null,
            // Family members carry their own box size + cost for the split.
            unitsPerBox: m.unitsPerBox || 1,
            unitCost: m.unitCost || 0,
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
    if (line.type === 'freshMealGroup' || line.type === 'parentGroup') {
      line._memberSkus.forEach((s) => skus.add(s));
    } else skus.add(line.sku);
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

    const isGroup = line.type === 'freshMealGroup' || line.type === 'parentGroup';
    const memberSkus = isGroup ? [..._memberSkus] : [line.sku];
    const warehouseStock = memberSkus.reduce((a, s) => a + (whMap[s] || 0), 0);
    const pendingPOQty = memberSkus.reduce((a, s) => a + (pendMap[s] || 0), 0);
    const netNeed = computeNetNeed(line.grossNeed, warehouseStock, pendingPOQty);

    let orderQty;
    let boxes;
    let members;
    if (line.type === 'parentGroup') {
      // Family lines: the machine-capacity headroom bounds BOTH the need and
      // the box allocation (the split rounds up to cover the need, but never
      // past the cap — the family analogue of computeOrderQty's behaviour).
      // The parent line's orderQty/boxes are the SUMS of the flavour lines
      // the PO will carry.
      const headroom = maxStockKnown ? Math.max(0, maxStock - line.projectedStock) : Infinity;
      members = splitParentNeed({
        netNeed: Math.min(netNeed, headroom),
        maxUnits: headroom,
        members: Object.values(_memberVel).map((m) => ({
          ...m,
          velocityLong: round(m.velocityLong),
          warehouseStock: whMap[m.sku] || 0,
        })),
      });
      orderQty = members.reduce((a, m) => a + m.units, 0);
      boxes = members.reduce((a, m) => a + m.boxes, 0);
    } else {
      orderQty = computeOrderQty({
        netNeed,
        unitsPerBox: line.unitsPerBox,
        projectedStock: line.projectedStock,
        maxStock: maxStockKnown ? maxStock : null,
      });
      const box = line.unitsPerBox > 0 ? line.unitsPerBox : 1;
      boxes = Math.ceil(orderQty / box);
      members = line.type === 'freshMealGroup'
        ? Object.values(_memberVel).map((m) => ({ ...m, velocityLong: round(m.velocityLong) }))
        : undefined;
    }
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
      members,
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
  const parentMap = new Map();
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
    for (const { parentId, name } of loc.excluded.parents || []) {
      const entry = parentMap.get(parentId) || { parentId, name, locations: [] };
      entry.locations.push(loc.locationName);
      parentMap.set(parentId, entry);
    }
  }
  return {
    skus: [...skuMap.values()],
    mealTypes: [...mealMap.values()],
    parents: [...parentMap.values()],
  };
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
