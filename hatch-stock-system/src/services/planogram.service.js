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
};

export default planogramService;
