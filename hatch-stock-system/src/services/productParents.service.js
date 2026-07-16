import api from './api';

/**
 * Product Parents API Service
 * Stable flavour families ("Barebells", "Estate Dairy") — the parent is a pure
 * grouping row; flavours stay ordinary products linked by parentId.
 */
export const productParentsService = {
  /** List groups with their member flavours. */
  getAll: async () => {
    const response = await api.get('/product-parents');
    return response.data;
  },

  /** Create a group. @param {{ name: string }} body */
  create: async (body) => {
    const response = await api.post('/product-parents', body);
    return response.data;
  },

  /** Rename a group (members link by id — nothing cascades). */
  update: async (id, body) => {
    const response = await api.put(`/product-parents/${id}`, body);
    return response.data;
  },

  /** Delete a group (server returns 409 while flavours are still assigned). */
  remove: async (id) => {
    const response = await api.delete(`/product-parents/${id}`);
    return response.data;
  },

  /** Assign flavours to a group. Fresh meals are rejected server-side (409). */
  addMembers: async (id, skus) => {
    const response = await api.post(`/product-parents/${id}/members`, { skus });
    return response.data;
  },

  /** Remove one flavour from a group. */
  removeMember: async (id, sku) => {
    const response = await api.delete(`/product-parents/${id}/members/${encodeURIComponent(sku)}`);
    return response.data;
  },

  /**
   * Machines where a family's total stock is healthy but its best-selling
   * flavour is at zero. @returns {Promise<{items: Array}>}
   */
  getStarvation: async () => {
    const response = await api.get('/product-parents/starvation');
    return response.data;
  },

  /**
   * Get per-location group capacity.
   * @returns {Promise<Object>} { parentId: { minStock, maxStock } }
   */
  getLocationParentConfig: async (locationId) => {
    const response = await api.get(`/product-parents/location/${locationId}/config`);
    return response.data;
  },

  /** Upsert capacity for one group at a location. @param {{minStock, maxStock}} config */
  updateLocationParentConfig: async (locationId, parentId, config) => {
    const response = await api.put(
      `/product-parents/location/${locationId}/config/${parentId}`,
      config,
    );
    return response.data;
  },
};

export default productParentsService;
