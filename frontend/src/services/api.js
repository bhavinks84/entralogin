import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  withCredentials: true, // Send HttpOnly cookies automatically
});

// Response interceptor: if a 401 is returned due to an expired access token,
// automatically attempt a silent token refresh and retry the original request once.
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;

    if (
      error.response?.status === 401 &&
      error.response?.data?.code === 'TOKEN_EXPIRED' &&
      !original._retried
    ) {
      original._retried = true;
      try {
        await api.post('/auth/refresh');
        return api(original);
      } catch {
        // Refresh failed – redirect to login
        window.location.href = '/login';
      }
    }

    return Promise.reject(error);
  }
);

export default api;
