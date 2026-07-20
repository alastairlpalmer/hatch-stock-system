import api from './api';

/**
 * Buying Lists API Service
 *
 * The weekly consolidated buying list: generated from order suggestions,
 * netted against warehouse stock + pending POs, grouped by supplier, and
 * shareable (public token link / PDF / copy-as-text). Creating orders from a
 * list produces one PO per supplier and marks the list `ordered`.
 *
 * List shape: { id, name, status: 'draft'|'ordered'|'archived', targetDate,
 *   shareToken, items: [line], notes, orderIds, createdAt, updatedAt }
 * Line shape matches consolidated suggestion lines (sku/mealType, name,
 *   supplierId, supplierName, quantity, boxes, unitsPerBox, unitCost,
 *   machineStock, projectedStock, warehouseStock, pendingPOQty, grossNeed,
 *   netNeed, priority, perLocation).
 */
export const buyingListsService = {
  /** All lists, newest first. @param {Object} filters - { status?, limit? } */
  getAll: async (filters = {}) => {
    const response = await api.get('/buying-lists', { params: filters });
    return response.data;
  },

  getById: async (id) => {
    const response = await api.get(`/buying-lists/${id}`);
    return response.data;
  },

  /** @param {Object} list - { name, targetDate?, items, notes? } */
  create: async (list) => {
    const response = await api.post('/buying-lists', list);
    return response.data;
  },

  /** @param {Object} updates - { name?, targetDate?, items?, notes?, status? } */
  update: async (id, updates) => {
    const response = await api.put(`/buying-lists/${id}`, updates);
    return response.data;
  },

  delete: async (id) => {
    const response = await api.delete(`/buying-lists/${id}`);
    return response.data;
  },

  /**
   * Create one pending PO per supplier from the list's current items.
   * Marks the list `ordered` and stores the created order ids.
   * Returns { orders: [...], buyingList }. A never-shared list answers 409
   * code NOT_SHARED unless force is true (the weekly rule is share-first).
   */
  createOrders: async (id, { force = false } = {}) => {
    const response = await api.post(`/buying-lists/${id}/create-orders`, force ? { force } : {});
    return response.data;
  },

  /** Stamp sharedAt — called when the share link or list text is copied. */
  markShared: async (id) => {
    const response = await api.post(`/buying-lists/${id}/shared`);
    return response.data;
  },

  /** Server-rendered PDF (supplier-grouped order sheet) as a Blob. */
  downloadPdf: async (id) => {
    const response = await api.get(`/buying-lists/${id}/pdf`, {
      responseType: 'blob',
    });
    return response.data;
  },

  /**
   * Public share URL for a list (no auth required to view). The backend serves
   * a read-only JSON view at /api/public/buying-lists/:token; the frontend
   * share page renders it.
   */
  shareUrl: (list) =>
    `${window.location.origin}/share/buying-list/${list.shareToken}`,

  /** Fetch a shared list by token (public, works logged-out). */
  getShared: async (token) => {
    const response = await api.get(`/public/buying-lists/${token}`);
    return response.data;
  },
};

export default buyingListsService;
