import prisma from '../utils/db.js';
import { buildPlanogramScope } from './planogram-layout.js';

/**
 * Resolve the layout that ordering/picking should generate against.
 *
 * Phase 1: only the location's single (current) layout exists. The `prefer`
 * option is accepted now so call sites don't change when the next-week draft
 * revision lands (Phase 3: prefer 'next' -> fall back to 'current').
 *
 * Returns { layout, openAssignments, scope, source } or null when the location
 * has no layout at all — callers MUST fall back to legacy behaviour
 * (assignedItems + config maxStock) so undiagrammed locations keep working.
 */
export async function getEffectiveLayout(locationId, { prefer = 'current' } = {}) {
  void prefer; // Phase 3 will branch on this
  const layout = await prisma.machineLayout.findUnique({ where: { locationId } });
  if (!layout) return null;

  const openAssignments = await prisma.slotAssignment.findMany({
    where: { layoutId: layout.id, validTo: null },
    select: {
      shelf: true, position: true, targetType: true, sku: true, mealType: true, capacity: true,
    },
  });

  return {
    layout,
    openAssignments,
    scope: buildPlanogramScope(openAssignments, layout.shelves),
    source: 'current',
  };
}
