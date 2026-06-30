import api from './api';

export const vendliveService = {
  getConfig: async () => {
    const response = await api.get('/vendlive/config');
    return response.data;
  },

  updateConfig: async (data) => {
    const response = await api.put('/vendlive/config', data);
    return response.data;
  },

  testConnection: async () => {
    const response = await api.post('/vendlive/test-connection');
    return response.data;
  },

  getMachines: async () => {
    const response = await api.get('/vendlive/machines');
    return response.data;
  },

  getMachineMappings: async () => {
    const response = await api.get('/vendlive/machine-mappings');
    return response.data;
  },

  // Live channel stock for a machine — VendLive's own current stock levels,
  // read-only proxy (no DB writes). Returns { machineId, totalChannels, products: [...] }.
  getLiveStock: async (machineId) => {
    const response = await api.get(`/vendlive/stock/live/${machineId}`);
    return response.data;
  },

  // Sync LocationStock <- VendLive truth for every machine at a location.
  // Used to freshen a location's stock right before generating a purchase order.
  syncLocationStock: async (locationId) => {
    const response = await api.post(`/vendlive/stock/sync-location/${locationId}`);
    return response.data;
  },

  // Per-location stock freshness: machine-mapping status + last successful sync.
  // Returns [{ locationId, locationName, machines, mapped, lastSyncedAt }].
  getStockFreshness: async () => {
    const response = await api.get('/vendlive/stock/freshness');
    return response.data;
  },

  updateMachineMapping: async (vendliveMachineId, data) => {
    const response = await api.put(`/vendlive/machine-mappings/${vendliveMachineId}`, data);
    return response.data;
  },

  autoDetectMachines: async () => {
    const response = await api.post('/vendlive/machine-mappings/auto-detect');
    return response.data;
  },

  triggerSync: async () => {
    const response = await api.post('/vendlive/sync/sales');
    return response.data;
  },

  // Proactively pull the full VendLive product catalog into our DB so products
  // exist before they are ever sold. Returns { created, updated, total, channelCount }.
  syncProducts: async () => {
    const response = await api.post('/vendlive/sync/products');
    return response.data;
  },

  getSyncLogs: async () => {
    const response = await api.get('/vendlive/sync/logs');
    return response.data;
  },

  getSyncStatus: async () => {
    const response = await api.get('/vendlive/sync/status');
    return response.data;
  },
};

export default vendliveService;
