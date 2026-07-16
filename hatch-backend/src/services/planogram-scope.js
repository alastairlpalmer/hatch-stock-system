import prisma from '../utils/db.js';
import { buildPlanogramScope } from './planogram-layout.js';

/**
 * Resolve the layout that ordering/picking should generate against.
 *
 * prefer 'next': try the location's next-week draft first (the order placed
 * midweek arrives for Monday's restock, so it should reflect the layout that
 * will be live then), falling back to the current layout. prefer 'current'
 * reads only the live layout.
 *
 * Returns { layout, openAssignments, scope, source: 'next'|'current' } or null
 * when the location has no matching layout at all — callers MUST fall back to
 * legacy behaviour (assignedItems + config maxStock) so undiagrammed locations
 * keep working.
 */
export async function getEffectiveLayout(locationId, { prefer = 'current' } = {}) {
  const revisions = prefer === 'next' ? ['next', 'current'] : ['current'];

  let layout = null;
  for (const revision of revisions) {
    layout = await prisma.machineLayout.findUnique({
      where: { locationId_revision: { locationId, revision } },
    });
    if (layout) break;
  }
  if (!layout) return null;

  const openAssignments = await prisma.slotAssignment.findMany({
    where: { layoutId: layout.id, validTo: null },
    select: {
      shelf: true, position: true, targetType: true, sku: true, mealType: true, parentId: true, capacity: true,
    },
  });

  return {
    layout,
    openAssignments,
    scope: buildPlanogramScope(openAssignments, layout.shelves),
    source: layout.revision,
  };
}
