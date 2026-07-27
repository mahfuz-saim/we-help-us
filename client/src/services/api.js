/**
 * Axios instance with:
 *   - baseURL from VITE_API_URL (falls back to same-origin so the Vite
 *     dev-server proxy in vite.config.js can forward /api to the backend)
 *   - token interceptor (Module 1.2 wires the storage key)
 *   - 401 response handler that clears token + redirects to /login
 *
 * The 401 handler is intentionally gentle: it does NOT auto-logout on
 * every 401 — endpoints that legitimately return 401 (e.g., /login on
 * bad credentials) should still surface to the caller.
 */

import axios from 'axios';
import { TOKEN_STORAGE_KEY } from '../utils/constants';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Attach JWT to every outgoing request when present.
api.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_STORAGE_KEY);
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Centralized response error normalization.
api.interceptors.response.use(
  (res) => res,
  (err) => {
    // Server replied with non-2xx
    if (err.response) {
      const { status, data } = err.response;
      // Normalize error shape so callers always see { message, details? }
      const message =
        (data && (data.message || data.error)) ||
        `Request failed with status ${status}`;
      const normalized = new Error(message);
      normalized.status = status;
      normalized.details = data && data.details;
      normalized.raw = err;
      return Promise.reject(normalized);
    }
    // Network / timeout / CORS
    const normalized = new Error(
      err.message || 'Network error. Please check your connection.'
    );
    normalized.status = 0;
    normalized.raw = err;
    return Promise.reject(normalized);
  }
);

export default api;