import api from './api';

/**
 * Warehouses API Service
 */
export const warehousesService = {
  getAll: async () => {
    const response = await api.get('/warehouses');
    return response.data;
  },

  getById: async (warehouseId) => {
    const response = await api.get(`/warehouses/${warehouseId}`);
    return response.data;
  },

  create: async (warehouse) => {
    const response = await api.post('/warehouses', warehouse);
    return response.data;
  },

  update: async (warehouseId, updates) => {
    const response = await api.put(`/warehouses/${warehouseId}`, updates);
    return response.data;
  },

  delete: async (warehouseId) => {
    const response = await api.delete(`/warehouses/${warehouseId}`);
    return response.data;
  },

  /**
   * Get warehouse with full stock details
   * @param {string} warehouseId 
   */
  getWithStock: async (warehouseId) => {
    const response = await api.get(`/warehouses/${warehouseId}/with-stock`);
    return response.data;
  },
};

/**
 * Suppliers API Service
 */
export const suppliersService = {
  getAll: async () => {
    const response = await api.get('/suppliers');
    return response.data;
  },

  getById: async (supplierId) => {
    const response = await api.get(`/suppliers/${supplierId}`);
    return response.data;
  },

  create: async (supplier) => {
    const response = await api.post('/suppliers', supplier);
    return response.data;
  },

  update: async (supplierId, updates) => {
    const response = await api.put(`/suppliers/${supplierId}`, updates);
    return response.data;
  },

  delete: async (supplierId) => {
    const response = await api.delete(`/suppliers/${supplierId}`);
    return response.data;
  },

  /**
   * Get products supplied by this supplier
   * @param {string} supplierId 
   */
  getProducts: async (supplierId) => {
    const response = await api.get(`/suppliers/${supplierId}/products`);
    return response.data;
  },

  /**
   * Get order history for supplier
   * @param {string} supplierId 
   */
  getOrderHistory: async (supplierId) => {
    const response = await api.get(`/suppliers/${supplierId}/orders`);
    return response.data;
  },
};

/**
 * Restock Routes API Service
 */
export const routesService = {
  getAll: async () => {
    const response = await api.get('/routes');
    return response.data;
  },

  getById: async (routeId) => {
    const response = await api.get(`/routes/${routeId}`);
    return response.data;
  },

  create: async (route) => {
    const response = await api.post('/routes', route);
    return response.data;
  },

  update: async (routeId, updates) => {
    const response = await api.put(`/routes/${routeId}`, updates);
    return response.data;
  },

  delete: async (routeId) => {
    const response = await api.delete(`/routes/${routeId}`);
    return response.data;
  },
};

export default { warehousesService, suppliersService, routesService };
