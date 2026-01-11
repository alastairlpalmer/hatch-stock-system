import api from './api';

/**
 * Inventory API Service
 * Handles warehouse stock, location stock, and batch operations
 */
export const inventoryService = {
  // ========== WAREHOUSE STOCK ==========
  
  /**
   * Get all warehouse stock levels
   * @param {string} warehouseId - Optional filter by warehouse
   */
  getWarehouseStock: async (warehouseId = null) => {
    const params = warehouseId ? { warehouseId } : {};
    const response = await api.get('/inventory/warehouse', { params });
    return response.data;
  },

  /**
   * Update warehouse stock level
   * @param {string} warehouseId 
   * @param {string} sku 
   * @param {number} quantity - Absolute quantity or delta
   * @param {boolean} isDelta - If true, add to existing; if false, set absolute
   */
  updateWarehouseStock: async (warehouseId, sku, quantity, isDelta = true) => {
    const response = await api.post('/inventory/warehouse/update', {
      warehouseId,
      sku,
      quantity,
      isDelta,
    });
    return response.data;
  },

  /**
   * Bulk update warehouse stock
   * @param {string} warehouseId
   * @param {Array} items - Array of { sku, quantity }
   */
  bulkUpdateWarehouse: async (warehouseId, items) => {
    const response = await api.post('/inventory/warehouse/bulk', { warehouseId, items });
    return response.data;
  },

  // ========== LOCATION STOCK ==========

  /**
   * Get stock levels for a location
   * @param {string} locationId 
   */
  getLocationStock: async (locationId) => {
    const response = await api.get(`/inventory/locations/${locationId}`);
    return response.data;
  },

  /**
   * Update location stock level
   * @param {string} locationId 
   * @param {string} sku 
   * @param {number} quantity 
   */
  updateLocationStock: async (locationId, sku, quantity) => {
    const response = await api.post(`/inventory/locations/${locationId}/update`, {
      sku,
      quantity,
    });
    return response.data;
  },

  /**
   * Get location configuration (min/max thresholds)
   * @param {string} locationId 
   */
  getLocationConfig: async (locationId) => {
    const response = await api.get(`/inventory/locations/${locationId}/config`);
    return response.data;
  },

  /**
   * Update location product configuration
   * @param {string} locationId 
   * @param {string} sku 
   * @param {Object} config - { minStock, maxStock }
   */
  updateLocationConfig: async (locationId, sku, config) => {
    const response = await api.put(`/inventory/locations/${locationId}/config/${sku}`, config);
    return response.data;
  },

  /**
   * Bulk set location stock (from stock check or screenshot import)
   * @param {string} locationId 
   * @param {Array} items - [{ sku, quantity }]
   */
  setLocationStock: async (locationId, items) => {
    const response = await api.post(`/inventory/locations/${locationId}/set`, { items });
    return response.data;
  },

  // ========== BATCHES (EXPIRY TRACKING) ==========

  /**
   * Get all batches with optional filters
   * @param {Object} filters - { warehouseId, sku, expiryStatus }
   */
  getBatches: async (filters = {}) => {
    const response = await api.get('/inventory/batches', { params: filters });
    return response.data;
  },

  /**
   * Create new batch (from receiving stock)
   * @param {Object} batch - { warehouseId, sku, quantity, expiryDate, hasDamage, damageNotes }
   */
  createBatch: async (batch) => {
    const response = await api.post('/inventory/batches', batch);
    return response.data;
  },

  /**
   * Update batch (reduce quantity, mark damage, etc.)
   * @param {string} batchId 
   * @param {Object} updates 
   */
  updateBatch: async (batchId, updates) => {
    const response = await api.put(`/inventory/batches/${batchId}`, updates);
    return response.data;
  },

  /**
   * Get expiry alerts
   * @param {number} daysThreshold - Days until expiry to include
   */
  getExpiryAlerts: async (daysThreshold = 30) => {
    const response = await api.get('/inventory/batches/expiring', {
      params: { days: daysThreshold },
    });
    return response.data;
  },

  // ========== STOCK MOVEMENTS ==========

  /**
   * Record stock removal (warehouse → location or write-off)
   * @param {Object} removal - { fromWarehouseId, routeId, items, takenBy, notes }
   */
  recordRemoval: async (removal) => {
    const response = await api.post('/inventory/removals', removal);
    return response.data;
  },

  /**
   * Get removal history
   * @param {Object} filters - { startDate, endDate, warehouseId }
   */
  getRemovalHistory: async (filters = {}) => {
    const response = await api.get('/inventory/removals', { params: filters });
    return response.data;
  },

  // ========== STOCK CHECK / RESTOCK ==========

  /**
   * Submit stock check results
   * @param {Object} stockCheck - { locationId, items: [{ sku, expected, counted }], performedBy }
   */
  submitStockCheck: async (stockCheck) => {
    const response = await api.post('/inventory/stock-checks', stockCheck);
    return response.data;
  },

  /**
   * Record restock operation
   * @param {Object} restock - { locationId, items, performedBy, photoUrl, notes }
   */
  recordRestock: async (restock) => {
    const response = await api.post('/inventory/restocks', restock);
    return response.data;
  },

  /**
   * Get restock history for a location
   * @param {string} locationId 
   */
  getRestockHistory: async (locationId) => {
    const response = await api.get(`/inventory/locations/${locationId}/restock-history`);
    return response.data;
  },

  /**
   * Get stock check history for a location
   * @param {string} locationId 
   */
  getStockCheckHistory: async (locationId) => {
    const response = await api.get(`/inventory/locations/${locationId}/stock-check-history`);
    return response.data;
  },
};

export default inventoryService;
