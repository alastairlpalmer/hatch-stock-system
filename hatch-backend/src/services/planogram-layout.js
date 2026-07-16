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

// Sanity ceiling for capacity values (units per facing) — generous enough for
// any real fridge slot, tight enough to catch fat-fingered entries.
export const MAX_SLOT_CAPACITY = 999;

/** True when v is a valid capacity value: null/undefined (unset) or int 1..MAX. */
function isValidCapacity(v) {
  return v == null || (Number.isInteger(v) && v >= 1 && v <= MAX_SLOT_CAPACITY);
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
    if (!isValidCapacity(s.unitsPerSlot)) {
      errors.push(`Shelf ${s.shelf}: unitsPerSlot must be 1-${MAX_SLOT_CAPACITY} (got ${s.unitsPerSlot})`);
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
    } else if (a.targetType === 'parent') {
      if (!a.parentId) errors.push(`Assignment ${code}: targetType 'parent' requires a parentId`);
    } else {
      errors.push(`Assignment ${code}: unknown targetType '${a.targetType}'`);
    }
    if (!isValidCapacity(a.capacity)) {
      errors.push(`Assignment ${code}: capacity must be 1-${MAX_SLOT_CAPACITY} (got ${a.capacity})`);
    }
  }

  return errors;
}

/**
 * Identity of a slot's target — used to decide whether a save changed it.
 * Deliberately capacity-blind: a capacity edit is a current-attribute update,
 * not a product move, so it must never cycle the history row.
 */
export function targetKey(a) {
  if (a.targetType === 'mealType') return `mealType:${a.mealType}`;
  if (a.targetType === 'parent') return `parent:${a.parentId}`;
  return `sku:${a.sku}`;
}

/**
 * Diff the currently OPEN assignment rows against the incoming full document.
 * Unchanged slots are untouched (their validFrom is preserved) — a weekly save
 * that moves 5 of 48 slots cycles exactly 5 history rows, not 48.
 *
 * Capacity is a current attribute, not part of slot history: a slot whose
 * target is unchanged but whose capacity differs lands in toUpdateCapacity
 * (in-place update), never in toCloseIds/toCreate.
 *
 * openRows: [{ id, shelf, position, targetType, sku, mealType, capacity? }]
 * next:     [{ shelf, position, targetType, sku, mealType, capacity? }]
 * Returns { toCloseIds, toCreate, toUpdateCapacity } where toCreate rows still
 * need layoutId / locationId / validFrom added by the caller.
 */
export function diffSlotAssignments(openRows, next) {
  const openBySlot = new Map(openRows.map((r) => [`${r.shelf}-${r.position}`, r]));
  const nextBySlot = new Map(next.map((a) => [`${a.shelf}-${a.position}`, a]));

  const toCloseIds = [];
  const toCreate = [];
  const toUpdateCapacity = [];

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
        parentId: a.targetType === 'parent' ? a.parentId : null,
        capacity: a.capacity ?? null,
      });
    } else if ((existing.capacity ?? null) !== (a.capacity ?? null)) {
      toUpdateCapacity.push({ id: existing.id, capacity: a.capacity ?? null });
    }
  }

  return { toCloseIds, toCreate, toUpdateCapacity };
}

/**
 * Effective capacity of one slot: the per-slot override, else its shelf's
 * unitsPerSlot default, else null (unknown).
 *
 * assignment: { shelf, capacity? }
 * shelvesByNumber: Map(shelf -> { shelf, slots, unitsPerSlot? })
 */
export function resolveSlotCapacity(assignment, shelvesByNumber) {
  if (assignment.capacity != null) return assignment.capacity;
  const shelf = shelvesByNumber.get(assignment.shelf);
  return shelf?.unitsPerSlot ?? null;
}

/**
 * Build the ordering/picking scope from a layout's open slot assignments:
 * which SKUs and meal-type groups are actually in the fridge, and how many
 * units each target's slots hold.
 *
 * capacityByTarget sums effective slot capacities per target and is NULL for
 * a target when ANY of its slots has no resolvable capacity — a partial sum
 * would silently understate the fill target, so unknown means unknown and the
 * caller falls back to the config maxStock.
 *
 * openAssignments: [{ shelf, position, targetType, sku, mealType, parentId, capacity? }]
 * shelves: MachineLayout.shelves JSON — [{ shelf, slots, unitsPerSlot? }]
 * Returns {
 *   skuSet: Set<sku>, mealTypeSet: Set<mealType>, parentSet: Set<parentId>,
 *   capacityByTarget: Map(targetKey -> int|null),
 *   slotCountByTarget: Map(targetKey -> int),
 * }
 */
export function buildPlanogramScope(openAssignments, shelves) {
  const shelvesByNumber = new Map(
    (Array.isArray(shelves) ? shelves : []).map((s) => [s.shelf, s]),
  );

  const skuSet = new Set();
  const mealTypeSet = new Set();
  const parentSet = new Set();
  const capacityByTarget = new Map();
  const slotCountByTarget = new Map();

  for (const a of openAssignments || []) {
    const key = targetKey(a);
    if (a.targetType === 'sku') skuSet.add(a.sku);
    else if (a.targetType === 'parent') parentSet.add(a.parentId);
    else mealTypeSet.add(a.mealType);

    slotCountByTarget.set(key, (slotCountByTarget.get(key) || 0) + 1);

    const slotCap = resolveSlotCapacity(a, shelvesByNumber);
    if (slotCap == null) {
      capacityByTarget.set(key, null); // poison: any unknown slot -> unknown target
    } else if (capacityByTarget.get(key) !== null || !capacityByTarget.has(key)) {
      capacityByTarget.set(key, (capacityByTarget.get(key) || 0) + slotCap);
    }
  }

  return { skuSet, mealTypeSet, parentSet, capacityByTarget, slotCountByTarget };
}

/**
 * Annotate assignments with staleness. A slot is stale when its target no
 * longer exists at the location:
 * - sku slot: the SKU has dropped out of the location's mirrored assignment
 *   list (weekly VendLive planogram churn);
 * - mealType slot: the bucket has zero member flavours assigned this week
 *   (soft warning — a legitimate transient between menus);
 * - parent slot: the family has zero member flavours assigned here.
 */
export function detectStale(
  assignments,
  assignedSkuSet,
  mealTypeMemberCounts = new Map(),
  parentMemberCounts = new Map(),
) {
  return assignments.map((a) => ({
    ...a,
    stale:
      a.targetType === 'sku' ? !assignedSkuSet.has(a.sku)
        : a.targetType === 'parent' ? (parentMemberCounts.get(a.parentId) || 0) === 0
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
 * assignments: open rows [{ shelf, position, slotCode, targetType, sku, mealType, parentId }]
 * ctx: {
 *   qtyBySku:  Map(sku -> current qty),
 *   groupQty:  Map(mealType -> summed group qty),
 *   skuMax:    Map(sku -> maxStock | undefined),
 *   groupMax:  Map(mealType -> maxStock | undefined),
 *   nameBySku: Map(sku -> product name),
 *   parentQty:  Map(parentId -> summed family qty)      (optional),
 *   parentMax:  Map(parentId -> maxStock | undefined)   (optional),
 *   parentName: Map(parentId -> family name)            (optional),
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
    const isParent = a.targetType === 'parent';
    const isGroup = a.targetType === 'mealType' || isParent;
    const label = isParent
      ? (ctx.parentName?.get(a.parentId) || 'Product family')
      : isGroup ? a.mealType : (ctx.nameBySku.get(a.sku) || a.sku);
    const primarySlotCode = primaryByTarget.get(key);
    const primary = primarySlotCode === a.slotCode;

    let current = null;
    let target = null;
    let add = null;
    if (primary) {
      current = isParent ? (ctx.parentQty?.get(a.parentId) || 0)
        : isGroup ? (ctx.groupQty.get(a.mealType) || 0)
        : (ctx.qtyBySku.get(a.sku) || 0);
      const max = isParent ? ctx.parentMax?.get(a.parentId)
        : isGroup ? ctx.groupMax.get(a.mealType)
        : ctx.skuMax.get(a.sku);
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
      parentId: a.parentId || null,
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
 * Product-family members count as placed when EITHER their own SKU has a slot
 * or their family has a parent slot; a family with no coverage at all is
 * reported once in `parents` (never as individual member SKUs).
 *
 * locationProducts: [{ sku, isFreshMeal, mealType, parentId? }]
 * Returns { skus: [...], mealTypes: [...], parents: [parentId, ...] }
 */
export function computeUnplaced(assignments, locationProducts) {
  const placedSkus = new Set();
  const placedGroups = new Set();
  const placedParents = new Set();
  for (const a of assignments) {
    if (a.targetType === 'sku') placedSkus.add(a.sku);
    else if (a.targetType === 'parent') placedParents.add(a.parentId);
    else placedGroups.add(a.mealType);
  }

  const skus = [];
  const groups = new Set();
  const parents = new Set();
  for (const p of locationProducts) {
    if (p.isFreshMeal) {
      const group = p.mealType || 'Unclassified';
      if (!placedGroups.has(group)) groups.add(group);
    } else if (p.parentId) {
      if (!placedSkus.has(p.sku) && !placedParents.has(p.parentId)) parents.add(p.parentId);
    } else if (!placedSkus.has(p.sku)) {
      skus.push(p.sku);
    }
  }

  return { skus, mealTypes: [...groups], parents: [...parents] };
}
