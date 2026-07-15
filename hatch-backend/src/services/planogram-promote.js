import prisma from '../utils/db.js';
import { validateLayout, diffSlotAssignments } from './planogram-layout.js';

/**
 * Next-week draft promotion ("Go live").
 *
 * Promotion is a normal save of the draft document onto the CURRENT layout:
 * the draft's open slot rows become the incoming full document, diffed against
 * the current layout's open rows — unchanged slots keep their validFrom, moved
 * slots cycle history rows exactly as a manual re-key would. The draft layout
 * row is then deleted (cascade removes its slot rows; draft edit history is
 * not meaningful). All in one transaction.
 */

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/**
 * Build the promotion plan: validate the draft document and diff it against
 * the current layout's open rows. Pure; exported for tests.
 *
 * @param {Array} currentOpenRows - open SlotAssignment rows of the CURRENT layout
 * @param {{ shelves: Array, assignments: Array }} draftDoc - the draft's shelves
 *   JSON and its open rows (shelf/position/targetType/sku/mealType/capacity)
 * @returns {{ errors: string[] } | { errors: [], toCloseIds, toCreate, toUpdateCapacity }}
 */
export function buildPromotionPlan(currentOpenRows, draftDoc) {
  const errors = validateLayout(draftDoc.shelves, draftDoc.assignments);
  if (errors.length > 0) return { errors };
  return { errors: [], ...diffSlotAssignments(currentOpenRows, draftDoc.assignments) };
}

/**
 * Promote a location's next-week draft onto its current layout. Throws 404
 * when there is no draft; creates the current layout row when the location
 * never had one (a site planned entirely on the draft).
 * Returns { promoted: true, closed, created, capacityUpdated }.
 */
export async function promoteDraftLayout(locationId) {
  const draft = await prisma.machineLayout.findUnique({
    where: { locationId_revision: { locationId, revision: 'next' } },
  });
  if (!draft) throw httpError(404, 'No next-week draft layout for this location');

  const draftRows = await prisma.slotAssignment.findMany({
    where: { layoutId: draft.id, validTo: null },
    select: { shelf: true, position: true, targetType: true, sku: true, mealType: true, capacity: true },
  });

  return prisma.$transaction(async (tx) => {
    // Upsert the current layout row (shelves come from the draft).
    const current = await tx.machineLayout.upsert({
      where: { locationId_revision: { locationId, revision: 'current' } },
      create: { locationId, revision: 'current', shelves: draft.shelves },
      update: { shelves: draft.shelves },
    });

    const currentOpenRows = await tx.slotAssignment.findMany({
      where: { layoutId: current.id, validTo: null },
      select: { id: true, shelf: true, position: true, targetType: true, sku: true, mealType: true, capacity: true },
    });

    const plan = buildPromotionPlan(currentOpenRows, {
      shelves: draft.shelves,
      assignments: draftRows,
    });
    if (plan.errors.length > 0) {
      throw httpError(400, `Draft layout is invalid: ${plan.errors.join('; ')}`);
    }

    const now = new Date();
    if (plan.toCloseIds.length > 0) {
      await tx.slotAssignment.updateMany({
        where: { id: { in: plan.toCloseIds } },
        data: { validTo: now },
      });
    }
    if (plan.toCreate.length > 0) {
      await tx.slotAssignment.createMany({
        data: plan.toCreate.map((a) => ({
          ...a,
          layoutId: current.id,
          locationId,
          validFrom: now,
        })),
      });
    }
    for (const { id, capacity } of plan.toUpdateCapacity) {
      await tx.slotAssignment.update({ where: { id }, data: { capacity } });
    }

    // Draft row goes away; cascade removes its slot rows.
    await tx.machineLayout.delete({ where: { id: draft.id } });

    return {
      promoted: true,
      closed: plan.toCloseIds.length,
      created: plan.toCreate.length,
      capacityUpdated: plan.toUpdateCapacity.length,
    };
  });
}

/**
 * Promote every location that has a next-week draft — the optional Monday
 * cron. Failures are per-location (one bad draft must not block the rest).
 * Returns [{ locationId, ok, result?, error? }].
 */
export async function promoteAllDrafts() {
  const drafts = await prisma.machineLayout.findMany({
    where: { revision: 'next' },
    select: { locationId: true },
  });

  const results = [];
  for (const { locationId } of drafts) {
    try {
      results.push({ locationId, ok: true, result: await promoteDraftLayout(locationId) });
    } catch (err) {
      results.push({ locationId, ok: false, error: err.message });
    }
  }
  return results;
}
