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
   * Receive order - mark as received and update stock
   * @param {string} orderId 
   * @param {Array} receivedItems - [{ sku, quantity, expiryDate, hasDamage, damageNotes }]
   * @param {string} warehouseId - Destination warehouse
   */
  receive: async (orderId, receivedItems, warehouseId) => {
    const response = await api.post(`/orders/${orderId}/receive`, {
      items: receivedItems,
      warehouseId,
    });
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
   * Generate PDF order sheet
   * @param {string} orderId 
   * @returns {Blob} PDF file
   */
  generatePdf: async (orderId) => {
    const response = await api.get(`/orders/${orderId}/pdf`, {
      responseType: 'blob',
    });
    return response.data;
  },

  /**
   * Analyze invoice image with AI
   * @param {FormData} formData - Form data with invoice image
   */
  analyzeInvoice: async (formData) => {
    const response = await api.post('/orders/analyze-invoice', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 60000, // Longer timeout for AI processing
    });
    return response.data;
  },
};

export default ordersService;
