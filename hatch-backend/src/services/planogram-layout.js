/**
 * Visual planogram — pure layout helpers.
 *
 * Slot assignments are the source of truth for what is physically in a fridge
 * this week; the location's mirrored product list is only the picker
 * vocabulary. Everything here is pure and synchronous (no DB) so the routes
 * stay thin and the logic is unit-testable, following planogram-mirror.js.
 *
 * Slot coding: shelf 1 = top of the fridge; positions are 0-based within a
 * shelf and lettered A..Z left to right, so slot "1A" is top-left.
 */

export const MAX_SHELVES = 20;
export const MAX_SLOTS_PER_SHELF = 26; // A..Z — keeps slot codes one letter

/** 0 -> "A", 25 -> "Z". Out-of-range positions return "?" (validation catches them). */
export function positionLetter(position) {
  if (!Number.isInteger(position) || position < 0 || position >= MAX_SLOTS_PER_SHELF) return '?';
  return String.fromCharCode(65 + position);
}

/** Human slot code, e.g. slotCode(1, 4) -> "1E". */
export function slotCode(shelf, position) {
  return `${shelf}${positionLetter(position)}`;
}

/**
 * Validate a layout document (shelves + assignments) before saving.
 * Returns an array of human-readable error strings; empty = valid.
 */
export function validateLayout(shelves, assignments = []) {
  const errors = [];

  if (!Array.isArray(shelves) || shelves.length === 0) {
    return ['Layout must have at least one shelf'];
  }
  if (shelves.length > MAX_SHELVES) {
    errors.push(`Too many shelves (${shelves.length} > ${MAX_SHELVES})`);
  }

  const slotsByShelf = new Map();
  for (const s of shelves) {
    if (!Number.isInteger(s?.shelf) || s.shelf < 1) {
      errors.push(`Invalid shelf number: ${s?.shelf}`);
      continue;
    }
    if (slotsByShelf.has(s.shelf)) {
      errors.push(`Duplicate shelf number: ${s.shelf}`);
      continue;
    }
    if (!Number.isInteger(s.slots) || s.slots < 1 || s.slots > MAX_SLOTS_PER_SHELF) {
      errors.push(`Shelf ${s.shelf}: slots must be 1-${MAX_SLOTS_PER_SHELF} (got ${s.slots})`);
      continue;
    }
    slotsByShelf.set(s.shelf, s.slots);
  }

  const seenSlots = new Set();
  for (const a of assignments) {
    const code = slotCode(a?.shelf, a?.position);
    if (!slotsByShelf.has(a?.shelf)) {
      errors.push(`Assignment ${code}: shelf ${a?.shelf} does not exist`);
      continue;
    }
    if (!Number.isInteger(a.position) || a.position < 0 || a.position >= slotsByShelf.get(a.shelf)) {
      errors.push(`Assignment ${code}: position out of range for shelf ${a.shelf}`);
      continue;
    }
    const key = `${a.shelf}-${a.position}`;
    if (seenSlots.has(key)) {
      errors.push(`Duplicate assignment for slot ${code}`);
      continue;
    }
    seenSlots.add(key);

    if (a.targetType === 'sku') {
      if (!a.sku) errors.push(`Assignment ${code}: targetType 'sku' requires a sku`);
    } else if (a.targetType === 'mealType') {
      if (!a.mealType) errors.push(`Assignment ${code}: targetType 'mealType' requires a mealType`);
    } else {
      errors.push(`Assignment ${code}: unknown targetType '${a.targetType}'`);
    }
  }

  return errors;
}

/** Identity of a slot's target — used to decide whether a save changed it. */
function targetKey(a) {
  return a.targetType === 'mealType' ? `mealType:${a.mealType}` : `sku:${a.sku}`;
}

/**
 * Diff the currently OPEN assignment rows against the incoming full document.
 * Unchanged slots are untouched (their validFrom is preserved) — a weekly save
 * that moves 5 of 48 slots cycles exactly 5 history rows, not 48.
 *
 * openRows: [{ id, shelf, position, targetType, sku, mealType }]
 * next:     [{ shelf, position, targetType, sku, mealType }]
 * Returns { toCloseIds, toCreate } where toCreate rows still need layoutId /
 * locationId / validFrom added by the caller.
 */
export function diffSlotAssignments(openRows, next) {
  const openBySlot = new Map(openRows.map((r) => [`${r.shelf}-${r.position}`, r]));
  const nextBySlot = new Map(next.map((a) => [`${a.shelf}-${a.position}`, a]));

  const toCloseIds = [];
  const toCreate = [];

  for (const [key, row] of openBySlot) {
    const incoming = nextBySlot.get(key);
    if (!incoming || targetKey(incoming) !== targetKey(row)) {
      toCloseIds.push(row.id);
    }
  }

  for (const [key, a] of nextBySlot) {
    const existing = openBySlot.get(key);
    if (!existing || targetKey(existing) !== targetKey(a)) {
      toCreate.push({
        shelf: a.shelf,
        position: a.position,
        slotCode: slotCode(a.shelf, a.position),
        targetType: a.targetType,
        sku: a.targetType === 'sku' ? a.sku : null,
        mealType: a.targetType === 'mealType' ? a.mealType : null,
      });
    }
  }

  return { toCloseIds, toCreate };
}

/**
 * Annotate assignments with staleness. A slot is stale when its target no
 * longer exists at the location:
 * - sku slot: the SKU has dropped out of the location's mirrored assignment
 *   list (weekly VendLive planogram churn);
 * - mealType slot: the bucket has zero member flavours assigned this week
 *   (soft warning — a legitimate transient between menus).
 */
export function detectStale(assignments, assignedSkuSet, mealTypeMemberCounts = new Map()) {
  return assignments.map((a) => ({
    ...a,
    stale:
      a.targetType === 'sku'
        ? !assignedSkuSet.has(a.sku)
        : (mealTypeMemberCounts.get(a.mealType) || 0) === 0,
  }));
}

/**
 * Build the 3PL restock-sheet rows from a location's open slot assignments.
 *
 * One row per slot, walked top shelf first, left to right — the order a
 * restocker fills the fridge. "Add" quantities are computed at TARGET level
 * (a SKU or meal-type group), never split across slots (a per-slot split
 * would be a guess presented as fact): the first slot a target occupies is
 * the `primary` row carrying current/target/add, and any further slots of
 * the same target reference the primary's slot code instead.
 *
 * add = max(0, target - current) when a max is configured; null target ->
 * add null (sheet renders "fill" guidance instead of a number).
 *
 * assignments: open rows [{ shelf, position, slotCode, targetType, sku, mealType }]
 * ctx: {
 *   qtyBySku:  Map(sku -> current qty),
 *   groupQty:  Map(mealType -> summed group qty),
 *   skuMax:    Map(sku -> maxStock | undefined),
 *   groupMax:  Map(mealType -> maxStock | undefined),
 *   nameBySku: Map(sku -> product name),
 * }
 * Returns { rows, totalAdd }.
 */
export function buildRestockSheetRows(assignments, ctx) {
  const ordered = [...assignments].sort((a, b) => a.shelf - b.shelf || a.position - b.position);
  const primaryByTarget = new Map();
  const slotCountByTarget = new Map();
  for (const a of ordered) {
    const key = targetKey(a);
    slotCountByTarget.set(key, (slotCountByTarget.get(key) || 0) + 1);
    if (!primaryByTarget.has(key)) primaryByTarget.set(key, a.slotCode);
  }

  let totalAdd = 0;
  const rows = ordered.map((a) => {
    const key = targetKey(a);
    const isGroup = a.targetType === 'mealType';
    const label = isGroup ? a.mealType : (ctx.nameBySku.get(a.sku) || a.sku);
    const primarySlotCode = primaryByTarget.get(key);
    const primary = primarySlotCode === a.slotCode;

    let current = null;
    let target = null;
    let add = null;
    if (primary) {
      current = isGroup ? (ctx.groupQty.get(a.mealType) || 0) : (ctx.qtyBySku.get(a.sku) || 0);
      const max = isGroup ? ctx.groupMax.get(a.mealType) : ctx.skuMax.get(a.sku);
      if (max != null && max > 0) {
        target = max;
        add = Math.max(0, max - current);
        totalAdd += add;
      }
    }

    return {
      slotCode: a.slotCode,
      shelf: a.shelf,
      position: a.position,
      label,
      targetType: a.targetType,
      sku: a.sku || null,
      mealType: a.mealType || null,
      isGroup,
      primary,
      primarySlotCode: primary ? null : primarySlotCode,
      slotCount: slotCountByTarget.get(key),
      current,
      target,
      add,
    };
  });

  return { rows, totalAdd };
}

/**
 * Location products/groups with NO open slot — the "not placed" checklist for
 * the weekly pass. Fresh-meal products are represented by their meal-type
 * group (that is what gets slotted), everything else by SKU. The caller
 * intersects with quantities to decide what is worth flagging.
 *
 * locationProducts: [{ sku, isFreshMeal, mealType }]
 * Returns { skus: [...], mealTypes: [...] }
 */
export function computeUnplaced(assignments, locationProducts) {
  const placedSkus = new Set();
  const placedGroups = new Set();
  for (const a of assignments) {
    if (a.targetType === 'sku') placedSkus.add(a.sku);
    else placedGroups.add(a.mealType);
  }

  const skus = [];
  const groups = new Set();
  for (const p of locationProducts) {
    if (p.isFreshMeal) {
      const group = p.mealType || 'Unclassified';
      if (!placedGroups.has(group)) groups.add(group);
    } else if (!placedSkus.has(p.sku)) {
      skus.push(p.sku);
    }
  }

  return { skus, mealTypes: [...groups] };
}
