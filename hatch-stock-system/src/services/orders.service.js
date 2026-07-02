import api from './api';

/**
 * Orders API Service
 * Handles purchase orders, receiving, and order generation
 */
export const ordersService = {
  /**
   * Get all orders with optional filters
   * @param {Object} filters - { status, supplierId, startDate, endDate }
   */
  getAll: async (filters = {}) => {
    const response = await api.get('/orders', { params: filters });
    return response.data;
  },

  /**
   * Get single order by ID
   * @param {string} orderId 
   */
  getById: async (orderId) => {
    const response = await api.get(`/orders/${orderId}`);
    return response.data;
  },

  /**
   * Create new order
   * @param {Object} order - Order data
   */
  create: async (order) => {
    const response = await api.post('/orders', order);
    return response.data;
  },

  /**
   * Update order
   * @param {string} orderId 
   * @param {Object} updates 
   */
  update: async (orderId, updates) => {
    const response = await api.put(`/orders/${orderId}`, updates);
    return response.data;
  },

  /**
   * Delete/cancel order
   * @param {string} orderId 
   */
  delete: async (orderId) => {
    const response = await api.delete(`/orders/${orderId}`);
    return response.data;
  },

  /**
   * Receive stock against an order (supports PARTIAL receiving). items may
   * contain multiple lines for the same SKU — one per expiry lot. The order
   * only flips to `received` when every line is fully received, or when
   * closeShort is true (operator writes off the undelivered remainder).
   * @param {string} orderId
   * @param {Array} receivedItems - [{ sku, quantity, expiryDate?, hasDamage?, damageNotes? }]
   * @param {string} warehouseId - Destination warehouse
   * @param {Object} [opts] - { closeShort?: boolean, receivedBy?: string }
   */
  receive: async (orderId, receivedItems, warehouseId, opts = {}) => {
    const response = await api.post(`/orders/${orderId}/receive`, {
      items: receivedItems,
      warehouseId,
      closeShort: !!opts.closeShort,
      receivedBy: opts.receivedBy || undefined,
    });
    return response.data;
  },

  /**
   * Recent receiving events across all orders (Receipt History).
   * Returns [{ id, orderId, warehouseId, items, closedShort, receivedBy,
   *            createdAt, order: { id, supplier, status } }]
   */
  getReceipts: async (limit = 50) => {
    const response = await api.get('/orders/receipts', { params: { limit } });
    return response.data;
  },

  /**
   * Generate order suggestions based on low stock
   * @param {string} locationId
   * @param {string} supplierId - Optional filter suggestions by supplier
   */
  generateSuggestions: async (locationId, supplierId = null) => {
    const response = await api.get('/orders/suggestions', {
      params: { locationId, supplierId },
    });
    return response.data;
  },

  /**
   * Generate ONE consolidated suggestion list across many locations. Lines are
   * merged per product / fresh-meal group and tagged with their preferred
   * supplier so the caller can split them into one PO per supplier.
   *
   * mode 'weekly' (default): anchored to the Mon–Fri trading cycle — projects
   * machine stock forward to the next restock Monday, targets Monday-to-Monday
   * cover, and nets off warehouse on-hand and pending POs.
   * mode 'topup': short-horizon midweek top-up (next trading day → next Monday).
   *
   * Each line carries: { sku|mealType, name, supplierId, supplierName,
   *   machineStock, projectedStock, warehouseStock, pendingPOQty, grossNeed,
   *   netNeed, orderQty, boxes, unitsPerBox, unitCost, priority, perLocation }
   * plus response-level meta { restockDate, mode, tradingDaysToRestock }.
   * @param {string[]} [locationIds] - omit/empty = all locations
   * @param {'weekly'|'topup'} [mode]
   */
  generateConsolidatedSuggestions: async (locationIds = [], mode = 'weekly') => {
    const response = await api.get('/orders/suggestions/consolidated', {
      params: {
        ...(locationIds.length ? { locationIds: locationIds.join(',') } : {}),
        mode,
      },
    });
    return response.data;
  },
};

export default ordersService;
