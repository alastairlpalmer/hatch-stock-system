import api from './api';

/**
 * Pick Lists API Service
 *
 * "What to pack into bags tonight for tomorrow's restock run." Generated for a
 * route (or explicit locations) + target date: per-location fill-to-max
 * quantities aggregated per SKU, with warehouse batches allocated FEFO so the
 * packer knows exactly which date-lot to pull. Confirming each machine
 * (confirmLocation) is the single stock-moving action: it consumes that stop's
 * quantities from warehouse batches AND increments the machine's stock.
 *
 * Shape: { id, routeId, routeName, warehouseId, targetDate,
 *   status: 'draft'|'in_progress'|'completed'|'cancelled' (+ legacy 'packed'),
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

  /**
   * Confirm one machine on the run — the single "stock went into the machine"
   * action (decrements warehouse batches + increments the machine's stock;
   * legacy packed lists: record-only). 409 with shortfalls when warehouse
   * stock no longer covers the stop; 409 when already confirmed.
   * @param {Object} payload - { locationId, performedBy?, photoUrl?,
   *   adjustedItems?: [{ sku, quantity }] (0 ≤ quantity ≤ planned) }
   * Returns { pickList, confirmation, restock, removal, deviations }.
   */
  confirmLocation: async (id, payload) => {
    const response = await api.post(`/pick-lists/${id}/confirm-location`, payload);
    return response.data;
  },

  /**
   * Route-run view of a pick list: per-location plan + stock-check /
   * confirmation / restock status and the run reconciliation.
   * Returns { pickList, locations: [{ locationId, locationName, planned,
   *   plannedUnits, stockCheck|null, restock|null, confirmation|null }],
   *   reconciliation: { perSku, packedUnits, loadedUnits, returnedUnits,
   *   remainingUnits }, expiryWarnings, allDone }
   */
  getRun: async (id) => {
    const response = await api.get(`/pick-lists/${id}/run`);
    return response.data;
  },

  /**
   * Return unloaded leftovers from the van back to the warehouse.
   * @param {Array} items - [{ sku, quantity }]
   * @param {string} [performedBy]
   * Returns { pickList, reconciliation }. 400 on over-return; 409 unless packed.
   */
  returnLeftovers: async (id, items, performedBy) => {
    const body = { items };
    if (performedBy) body.performedBy = performedBy;
    const response = await api.post(`/pick-lists/${id}/return-leftovers`, body);
    return response.data;
  },
};

export default pickListsService;
