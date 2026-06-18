import api from './api';

/**
 * Auth API Service
 * Login/register plus admin-only user management. The token returned by
 * login/register is a 7-day JWT; AuthContext persists it to localStorage.
 */
export const authService = {
  /** Sign in. Returns { user, token }. */
  login: async (email, password) => {
    const response = await api.post('/auth/login', { email, password });
    return response.data;
  },

  /** Register (first-ever user becomes admin; afterwards admin-gated). Returns { user, token }. */
  register: async ({ name, email, password }) => {
    const response = await api.post('/auth/register', { name, email, password });
    return response.data;
  },

  /** Current authenticated user. */
  getMe: async () => {
    const response = await api.get('/auth/me');
    return response.data;
  },

  // --- Admin user management (require an admin token) ---

  /** List all user logins. */
  listUsers: async () => {
    const response = await api.get('/auth/users');
    return response.data;
  },

  /** Create a user login. Returns the created user. */
  createUser: async ({ name, email, password }) => {
    const response = await api.post('/auth/users', { name, email, password });
    return response.data;
  },

  /** Delete a user login by id. */
  deleteUser: async (id) => {
    const response = await api.delete(`/auth/users/${id}`);
    return response.data;
  },

  /** Set a new password for a user login. */
  resetPassword: async (id, password) => {
    const response = await api.post(`/auth/users/${id}/reset-password`, { password });
    return response.data;
  },
};

export default authService;
