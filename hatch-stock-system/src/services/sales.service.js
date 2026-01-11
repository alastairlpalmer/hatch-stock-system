import api from './api';

/**
 * Sales API Service
 * Handles sales data import, analytics, and reporting
 */
export const salesService = {
  /**
   * Get sales with filters
   * @param {Object} filters - { startDate, endDate, locationId, productSku }
   */
  getAll: async (filters = {}) => {
    const response = await api.get('/sales', { params: filters });
    return response.data;
  },

  /**
   * Import sales data
   * @param {Array} sales - Array of sale objects
   * @param {string} filename - Original filename
   */
  importCsv: async (sales, filename) => {
    const response = await api.post('/sales/import', { sales, filename });
    return response.data;
  },

  /**
   * Get sales analytics/summary
   * @param {Object} params - { startDate, endDate, groupBy }
   */
  getAnalytics: async (params = {}) => {
    const response = await api.get('/sales/analytics', { params });
    return response.data;
  },

  /**
   * Get daily sales breakdown
   * @param {Object} params - { startDate, endDate }
   */
  getDailySales: async (params = {}) => {
    const response = await api.get('/sales/daily', { params });
    return response.data;
  },

  /**
   * Get product sales breakdown
   * @param {Object} params - { startDate, endDate, limit }
   */
  getByProduct: async (params = {}) => {
    const response = await api.get('/sales/by-product', { params });
    return response.data;
  },

  /**
   * Get category sales breakdown
   * @param {Object} params - { startDate, endDate }
   */
  getByCategory: async (params = {}) => {
    const response = await api.get('/sales/by-category', { params });
    return response.data;
  },

  /**
   * Get import history
   */
  getImportHistory: async () => {
    const response = await api.get('/sales/imports');
    return response.data;
  },
};

export default salesService;
