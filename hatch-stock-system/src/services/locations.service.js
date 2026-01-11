import api from './api';

/**
 * Locations API Service
 * Handles vending machines, retail points, and storage locations
 */
export const locationsService = {
  /**
   * Get all locations
   * @param {Object} params - { type, search }
   */
  getAll: async (params = {}) => {
    const response = await api.get('/locations', { params });
    return response.data;
  },

  /**
   * Get single location
   * @param {string} locationId 
   */
  getById: async (locationId) => {
    const response = await api.get(`/locations/${locationId}`);
    return response.data;
  },

  /**
   * Create new location
   * @param {Object} location - { name, type, assignedItems }
   */
  create: async (location) => {
    const response = await api.post('/locations', location);
    return response.data;
  },

  /**
   * Update location
   * @param {string} locationId 
   * @param {Object} updates 
   */
  update: async (locationId, updates) => {
    const response = await api.put(`/locations/${locationId}`, updates);
    return response.data;
  },

  /**
   * Delete location
   * @param {string} locationId 
   */
  delete: async (locationId) => {
    const response = await api.delete(`/locations/${locationId}`);
    return response.data;
  },

  /**
   * Update assigned products for a location
   * @param {string} locationId 
   * @param {Array} skus - List of product SKUs
   */
  updateAssignedItems: async (locationId, skus) => {
    const response = await api.put(`/locations/${locationId}/assigned-items`, { skus });
    return response.data;
  },

  /**
   * Get location with full stock details
   * @param {string} locationId 
   */
  getWithStock: async (locationId) => {
    const response = await api.get(`/locations/${locationId}/with-stock`);
    return response.data;
  },
};

export default locationsService;
