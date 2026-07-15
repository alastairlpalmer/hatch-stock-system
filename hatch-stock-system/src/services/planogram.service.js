import api from './api';

// Visual planogram — per-location fridge layout + slot assignments.
// GET/PUT both return the same payload shape:
// { layout: null | { id, locationId, revision, shelves: [{ shelf, slots, unitsPerSlot? }], updatedAt },
//   assignments: [{ id, shelf, position, slotCode, targetType, sku, mealType,
//                   capacity, effectiveCapacity, validFrom, stale, product }],
//   unplaced: { skus: [...], mealTypes: [...] } }
// revision: 'current' (default, the live layout) | 'next' (the draft for the
// coming restock Monday). Ordering/picking prefer 'next' when it exists.
export const planogramService = {
  getLocationPlanogram: async (locationId, revision = 'current') => {
    const response = await api.get(`/planogram/location/${locationId}`, { params: { revision } });
    return response.data;
  },

  // Full-document save: { shelves, assignments }. The server diffs against
  // the open rows and writes position history automatically.
  saveLocationPlanogram: async (locationId, body, revision = 'current') => {
    const response = await api.put(`/planogram/location/${locationId}`, body, { params: { revision } });
    return response.data;
  },

  // Create the next-week draft as a copy of the current layout. 409 if one exists.
  createDraft: async (locationId) => {
    const response = await api.post(`/planogram/location/${locationId}/draft`);
    return response.data;
  },

  // Discard the next-week draft.
  discardDraft: async (locationId) => {
    const response = await api.delete(`/planogram/location/${locationId}/draft`);
    return response.data;
  },

  // Go live: promote the draft onto the current layout.
  // Returns { promoted, closed, created, capacityUpdated, payload }.
  promoteDraft: async (locationId) => {
    const response = await api.post(`/planogram/location/${locationId}/promote`);
    return response.data;
  },

  // Share-link info for the location's public 3PL restock sheet.
  // Returns { shareToken, sharePath }. Always the CURRENT layout's token.
  getShareInfo: async (locationId) => {
    const response = await api.get(`/planogram/location/${locationId}/share`);
    return response.data;
  },

  // Public restock sheet by token (no auth — the token is the credential).
  getRestockSheet: async (token) => {
    const response = await api.get(`/public/restock-sheet/${token}`);
    return response.data;
  },
};

export default planogramService;
