import api from './api';

/**
 * Pick Lists API Service
 *
 * "What to pack into bags tonight for tomorrow's restock run." Generated for a
 * route (or explicit locations) + target date: per-location fill-to-max
 * quantities aggregated per SKU, with warehouse batches allocated FEFO so the
 * packer knows exactly which date-lot to pull. Completing a pick list creates
 * the StockRemoval so warehouse stock reconciles with the run.
 *
 * Shape: { id, routeId, routeName, warehouseId, targetDate,
 *   status: 'draft'|'packed'|'cancelled',
 *   items: [{ sku, name, totalQty, packedQty, packed,
 *             perLocation: [{ locationId, locationName, qty }],
 *             batches: [{ batchId, qty, expiryDate, receivedAt }] }],
 *   shortfalls: [{ sku, name, requested, available }],
 *   removalId, createdAt, updatedAt }
 */
export const pickListsService = {
  /** @param {Object} filters - { status?, limit? } */
  getAll: async (filters = {}) => {
    const response = await api.get('/pick-lists', { params: filters });
    return response.data;
  },

  getById: async (id) => {
    const response = await api.get(`/pick-lists/${id}`);
    return response.data;
  },

  /**
   * Generate AND persist a draft pick list.
   * @param {Object} params - { warehouseId, targetDate,
   *   routeId?, locationIds? (used when no routeId), createdBy? }
   */
  generate: async (params) => {
    const response = await api.post('/pick-lists/generate', params);
    return response.data;
  },

  /**
   * Update tick-off state / quantities / status.
   * @param {Object} updates - { items?, status? }
   */
  update: async (id, updates) => {
    const response = await api.put(`/pick-lists/${id}`, updates);
    return response.data;
  },

  delete: async (id) => {
    const response = await api.delete(`/pick-lists/${id}`);
    return response.data;
  },

  /**
   * Mark packed: consumes warehouse batches FEFO per the list's allocations
   * (respecting per-item packedQty), creates the linked StockRemoval, sets
   * status 'packed'. 409 if warehouse stock has changed and can no longer
   * cover the list — regenerate in that case.
   * @param {Object} opts - { takenBy?: string }
   */
  complete: async (id, opts = {}) => {
    const response = await api.post(`/pick-lists/${id}/complete`, opts);
    return response.data;
  },
};

export default pickListsService;
