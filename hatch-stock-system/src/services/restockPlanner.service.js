import api from './api';

/**
 * Restock planner calendar (Restock > Planner). The calendar renders the
 * weekly defaults itself (Monday = restock, Friday = de-stock); the API only
 * stores overrides and ad-hoc entries keyed by (date, kind). The range GET
 * also returns stock-check summaries so a day's plan shows what was actually
 * checked in hindsight. Writes are admin-only once auth is enabled.
 */
export const restockPlannerService = {
  /** Range fetch: { entries, stockChecks } for from..to inclusive (YYYY-MM-DD). */
  getRange: async (from, to) => {
    const response = await api.get('/restock-planner', { params: { from, to } });
    return response.data;
  },

  /** Upsert the entry for a (date, kind): assignees, notes, status. */
  saveEntry: async ({ date, kind, status, assignees, notes }) => {
    const response = await api.put('/restock-planner', { date, kind, status, assignees, notes });
    return response.data;
  },

  /** Delete an entry — the day reverts to its default. */
  deleteEntry: async (id) => {
    const response = await api.delete(`/restock-planner/${encodeURIComponent(id)}`);
    return response.data;
  },
};

export default restockPlannerService;
