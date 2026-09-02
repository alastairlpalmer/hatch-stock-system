import api from './api';

/**
 * Product Trials API Service
 *
 * The lane for products we do not yet sell. The suggestion engine is a REORDER
 * engine — it scopes to a location's assigned items, then to the planogram's
 * slotted targets, then needs sales history to compute a velocity — so a
 * product we have never stocked can never reach a buying list. A trial names
 * the machines and the per-machine quantity explicitly and bypasses all three,
 * then judges the product against what a typical facing in those same machines
 * earns.
 *
 * Trial shape: { id, sku, status: 'planned'|'ordered'|'live'|'adopted'|'rejected',
 *   trialQty, locationIds, weeks, startedAt, decidedAt, decision, decisionNote,
 *   notes, product, locations,
 *   window: { started, plannedTradingDays, tradingDaysElapsed, windowComplete, progressPct },
 *   unitsSold, benchmark, peerCount,
 *   verdict: { verdict: 'too_early'|'no_margin'|'adopt'|'marginal'|'reject',
 *              unitsPerDay, marginPerDay, ratio, reason } }
 */
export const productTrialsService = {
  /** @param {Object} filters - { status?, active?: '1', limit? } */
  getAll: async (filters = {}) => {
    const response = await api.get('/product-trials', { params: filters });
    return response.data;
  },

  getById: async (id) => {
    const response = await api.get(`/product-trials/${id}`);
    return response.data;
  },

  /**
   * Start a trial. Flips the product's lifecycle to `trial`, which is what the
   * ordering and picking engines read.
   * @param {Object} trial - { sku, locationIds, trialQty, weeks?, notes?, createdBy? }
   */
  create: async (trial) => {
    const response = await api.post('/product-trials', trial);
    return response.data;
  },

  /** Undecided trials only. @param {Object} updates - { locationIds?, trialQty?, weeks?, notes?, status? } */
  update: async (id, updates) => {
    const response = await api.put(`/product-trials/${id}`, updates);
    return response.data;
  },

  /**
   * The clock starts here — when trial stock first reaches a machine, not when
   * it was ordered. Idempotent: calling it twice will not reset the window.
   */
  start: async (id, startedAt = null) => {
    const response = await api.post(`/product-trials/${id}/start`, startedAt ? { startedAt } : {});
    return response.data;
  },

  /**
   * Adopt (product back to `active` — it then needs a planogram slot or a
   * min/max before the weekly buy will reorder it) or reject (product
   * `discontinued`; buying stops, existing stock still sells through).
   * @returns {Promise<{ trial, nextStep }>}
   */
  decide: async (id, decision, note = null) => {
    const response = await api.post(`/product-trials/${id}/decide`, { decision, note });
    return response.data;
  },

  delete: async (id) => {
    const response = await api.delete(`/product-trials/${id}`);
    return response.data;
  },
};

export default productTrialsService;
