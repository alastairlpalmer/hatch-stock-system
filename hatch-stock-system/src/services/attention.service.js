import api from './api';

/**
 * Dismissals for the Dashboard "Needs attention" rail. Reads work for any
 * signed-in user; dismiss/restore are admin-only (enforced server-side by the
 * role policy). A dismissal is keyed to the item's rendered title, so a
 * changed count/signal resurfaces the item automatically; the hook also
 * expires dismissals after 7 days.
 */
export const attentionService = {
  /** Active dismissals: [{ itemId, signature, dismissedBy, createdAt }] */
  getDismissals: async () => {
    const response = await api.get('/attention-dismissals');
    return response.data;
  },

  /** Dismiss an item (admin). */
  dismiss: async (itemId, signature) => {
    const response = await api.post('/attention-dismissals', { itemId, signature });
    return response.data;
  },

  /** Restore a dismissed item (admin). */
  restore: async (itemId) => {
    const response = await api.delete(`/attention-dismissals/${encodeURIComponent(itemId)}`);
    return response.data;
  },
};

export default attentionService;
