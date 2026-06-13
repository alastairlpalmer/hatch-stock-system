import api from './api';

/**
 * Analytics API service — the Sales dashboard's single data source.
 * One call returns headline stats, timing, product performance, margin analysis
 * and rule-based suggestions for a date range + location/route scope.
 */
export const analyticsService = {
  /**
   * @param {Object} params - { startDate, endDate, locationName (string|array), routeId }
   */
  getDashboard: async (params = {}) => {
    const response = await api.get('/analytics/dashboard', { params });
    return response.data;
  },
};

export default analyticsService;
