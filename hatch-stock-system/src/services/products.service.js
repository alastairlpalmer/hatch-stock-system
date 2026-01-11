import api from './api';

/**
 * Products API Service
 * Handles all product-related API calls
 */
export const productsService = {
  /**
   * Get all products
   * @param {Object} params - Query parameters (search, category, etc.)
   */
  getAll: async (params = {}) => {
    const response = await api.get('/products', { params });
    return response.data;
  },

  /**
   * Get single product by SKU
   * @param {string} sku - Product SKU
   */
  getBySku: async (sku) => {
    const response = await api.get(`/products/${sku}`);
    return response.data;
  },

  /**
   * Create new product
   * @param {Object} product - Product data
   */
  create: async (product) => {
    const response = await api.post('/products', product);
    return response.data;
  },

  /**
   * Update product
   * @param {string} sku - Product SKU
   * @param {Object} updates - Fields to update
   */
  update: async (sku, updates) => {
    const response = await api.put(`/products/${sku}`, updates);
    return response.data;
  },

  /**
   * Delete product
   * @param {string} sku - Product SKU
   */
  delete: async (sku) => {
    const response = await api.delete(`/products/${sku}`);
    return response.data;
  },

  /**
   * Bulk import products
   * @param {Array} products - Array of product objects
   */
  bulkImport: async (products) => {
    const response = await api.post('/products/import', { products });
    return response.data;
  },

  /**
   * Check for SKU conflicts
   * @param {string} sku - SKU to check
   * @param {string} name - Product name to compare
   */
  checkConflict: async (sku, name) => {
    const response = await api.get('/products/check-conflict', {
      params: { sku, name },
    });
    return response.data;
  },
};

export default productsService;
