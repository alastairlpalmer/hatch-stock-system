import api from './api';

// Visual planogram — per-location fridge layout + slot assignments.
// GET/PUT both return the same payload shape:
// { layout: null | { id, locationId, shelves: [{ shelf, slots }], updatedAt },
//   assignments: [{ id, shelf, position, slotCode, targetType, sku, mealType,
//                   validFrom, stale, product }],
//   unplaced: { skus: [...], mealTypes: [...] } }
export const planogramService = {
  getLocationPlanogram: async (locationId) => {
    const response = await api.get(`/planogram/location/${locationId}`);
    return response.data;
  },

  // Full-document save: { shelves, assignments }. The server diffs against
  // the open rows and writes position history automatically.
  saveLocationPlanogram: async (locationId, body) => {
    const response = await api.put(`/planogram/location/${locationId}`, body);
    return response.data;
  },

  // Share-link info for the location's public 3PL restock sheet.
  // Returns { shareToken, sharePath }.
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
