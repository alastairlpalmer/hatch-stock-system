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
