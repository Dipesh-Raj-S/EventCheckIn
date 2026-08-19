import axios from 'axios';

/**
 * Axios instance pre-configured for the API.
 *
 * JWT STORAGE NOTE:
 * We store the JWT in localStorage for simplicity. This is vulnerable to XSS attacks —
 * an httpOnly cookie set by the server would be more secure because JavaScript cannot
 * access it. However, httpOnly cookies require CSRF protection and careful CORS/cookie
 * domain configuration with Flask, which adds significant complexity.
 * For this timeline, localStorage is an acceptable tradeoff.
 */
const api = axios.create({
  baseURL: '/api',
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor: attach JWT if present
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('access_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor: handle 401 → redirect to login
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Only redirect if we're not already on the login/register page
      const path = window.location.pathname;
      if (path !== '/login' && path !== '/register') {
        localStorage.removeItem('access_token');
        localStorage.removeItem('refresh_token');
        localStorage.removeItem('user');
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export default api;
