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
  // Scans every machine's planogram, so it can take longer than the default 30s
  // request timeout — allow up to 2 minutes.
  syncProducts: async () => {
    const response = await api.post('/vendlive/sync/products', {}, { timeout: 120000 });
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

  // Aggregated sync health for the dashboard: sales/stock sync freshness,
  // quarantine size, unmapped machines and recent error count.
  getHealth: async () => {
    const response = await api.get('/vendlive/health');
    return response.data;
  },

  // Quarantined sales (unknown products at ingest time).
  // Returns { count, items: [...] }.
  getQuarantine: async (limit = 100) => {
    const response = await api.get('/vendlive/quarantine', { params: { limit } });
    return response.data;
  },

  // Re-attempt ingestion of every unresolved quarantined sale.
  // Returns { replayed, stillUnknown, alreadyExisted }.
  replayQuarantine: async () => {
    const response = await api.post('/vendlive/quarantine/replay');
    return response.data;
  },

  deleteQuarantineItem: async (id) => {
    const response = await api.delete(`/vendlive/quarantine/${id}`);
    return response.data;
  },

  // Recent stock sync rows. Returns { syncs: [...], total, limit, offset }.
  getStockSyncs: async (limit = 20) => {
    const response = await api.get('/vendlive/stock/syncs', { params: { limit } });
    return response.data;
  },
};

export default vendliveService;
