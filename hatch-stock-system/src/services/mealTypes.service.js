import api from './api';

/**
 * Meal Types API Service
 * Manages the configurable fresh-meal bucket list and per-location group capacity.
 */
export const mealTypesService = {
  /** List buckets in display order. */
  getAll: async () => {
    const response = await api.get('/meal-types');
    return response.data;
  },

  /** Create a bucket. @param {{ name: string, sortOrder?: number }} body */
  create: async (body) => {
    const response = await api.post('/meal-types', body);
    return response.data;
  },

  /** Update a bucket (renaming cascades to products + location config server-side). */
  update: async (id, body) => {
    const response = await api.put(`/meal-types/${id}`, body);
    return response.data;
  },

  /** Delete a bucket (server returns 409 if still referenced by a product). */
  remove: async (id) => {
    const response = await api.delete(`/meal-types/${id}`);
    return response.data;
  },

  /**
   * Get per-location group capacity.
   * @returns {Promise<Object>} { mealType: { minStock, maxStock } }
   */
  getLocationMealConfig: async (locationId) => {
    const response = await api.get(`/meal-types/location/${locationId}/config`);
    return response.data;
  },

  /** Upsert capacity for one bucket at a location. @param {{minStock, maxStock}} config */
  updateLocationMealConfig: async (locationId, mealType, config) => {
    const response = await api.put(
      `/meal-types/location/${locationId}/config/${encodeURIComponent(mealType)}`,
      config,
    );
    return response.data;
  },
};

export default mealTypesService;
