import api from './api';

/**
 * Client report API service (Feature 2). Generates client-safe PDF reports and
 * lists/downloads previously generated ones (the filing system).
 */
export const reportsService = {
  /**
   * Generate + store a client report.
   * @param {Object} input - { clientName, siteName, startDate?, endDate?, locationName?, routeId? }
   * Returns the stored report metadata (a new version each time).
   */
  generate: async (input) => {
    const response = await api.post('/reports/client', input);
    return response.data;
  },

  /** List generated reports (metadata only), newest first. */
  list: async () => {
    const response = await api.get('/reports/client');
    return response.data;
  },

  /**
   * Download a stored report PDF via the authenticated client, then save it.
   * Goes through axios (not a bare link) so the auth token is sent when enabled.
   */
  download: async (id, fileName) => {
    const response = await api.get(`/reports/client/${id}/download`, { responseType: 'blob' });
    const url = window.URL.createObjectURL(new Blob([response.data], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName || `report-${id}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  },
};

export default reportsService;
