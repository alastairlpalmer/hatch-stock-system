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
   * List Frive fresh meals.
   * @param {Object} params - e.g. { unconfirmed: true } for the review queue
   */
  getFreshMeals: async (params = {}) => {
    const response = await api.get('/products/fresh-meals', { params });
    return response.data;
  },

  /**
   * Confirm / override a product's fresh-meal classification.
   * @param {string} sku
   * @param {{ isFreshMeal?: boolean, mealType?: string|null, mealTypeConfirmed?: boolean }} body
   */
  updateMeal: async (sku, body) => {
    const response = await api.put(`/products/${sku}/meal`, body);
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

  /**
   * Lookup a product by scanned barcode (with SKU fallback).
   * @param {string} code - The scanned barcode or SKU string.
   * @returns {Promise<{ product, matchedBy: 'barcode' | 'sku' } | null>}
   *          Resolves with the match envelope, or null if not found.
   *          Other (network / 4xx / 5xx) errors are rethrown.
   */
  lookupBarcode: async (code) => {
    try {
      const response = await api.get('/products/lookup', {
        params: { barcode: code },
      });
      return response.data;
    } catch (err) {
      if (err.response && err.response.status === 404) {
        return null;
      }
      throw err;
    }
  },

  /**
   * Ensure one ordering placeholder product exists per fresh-meal type
   * (rotating menu — POs order "40 Meat meals", not specific flavours).
   * @param {string[]} mealTypes
   * @returns {Promise<Object>} { [mealType]: placeholderSku }
   */
  ensureFreshMealPlaceholders: async (mealTypes) => {
    const response = await api.post('/products/fresh-meal-placeholders', { mealTypes });
    return response.data;
  },
};

export default productsService;
