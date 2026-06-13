import prisma from '../utils/db.js';

/**
 * Resolve an analytics location scope into the two keys the data is stored under:
 *
 *   - names:       free-text sales.location_name values (sales are tagged by name)
 *   - locationIds: canonical locations.id values        (stock is keyed by id)
 *
 * The app has no FK between sales.location_name and locations.id — VendLive can
 * report one physical site under several names, which is why the merge-locations
 * tool exists. We bridge by matching locations.name === sales.location_name; any
 * mismatch surfaces as namesWithNoSales (computed later in the dashboard) rather
 * than silently undercounting.
 *
 * Input — at most one of:
 *   routeId        aggregate every location on a saved route
 *   locationNames  one or more explicit location names (string or array)
 *   (neither)      all locations
 *
 * Returns { names, locationIds, routeId, routeName, isAll }.
 *   locationIds === null means stock could not be resolved for this scope (the
 *   selected names don't match any locations row); callers treat stock as
 *   unknown rather than zero.
 */
export async function resolveLocationScope({ locationNames, routeId } = {}) {
  if (routeId) {
    const route = await prisma.restockRoute.findUnique({ where: { id: routeId } });
    if (!route) {
      const err = new Error('Route not found');
      err.status = 404;
      throw err;
    }
    const ids = Array.isArray(route.locationIds) ? route.locationIds : [];
    const locs = ids.length
      ? await prisma.location.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
      : [];
    return {
      names: locs.map((l) => l.name),
      locationIds: locs.map((l) => l.id),
      routeId,
      routeName: route.name,
      isAll: false,
    };
  }

  const names = [].concat(locationNames || []).filter((n) => n && n !== 'all');
  if (names.length === 0) {
    return { names: [], locationIds: null, routeId: null, routeName: null, isAll: true };
  }

  const locs = await prisma.location.findMany({ where: { name: { in: names } }, select: { id: true } });
  return {
    names,
    locationIds: locs.length ? locs.map((l) => l.id) : null,
    routeId: null,
    routeName: null,
    isAll: false,
  };
}
