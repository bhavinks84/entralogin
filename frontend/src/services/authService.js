import api from './api';

export const authService = {
  getSession: () =>
    api.get('/auth/session'),

  requestOtp: (email) =>
    api.post('/auth/otp/request', { email }),

  verifyOtp: (email, otp, displayName) =>
    api.post('/auth/otp/verify', { email, otp, displayName }),

  loginWithEntra: () => {
    window.location.href = '/api/auth/entra';
  },

  logout: () =>
    api.post('/auth/logout'),

  getMe: () =>
    api.get('/auth/me'),

  updateProfile: (data) =>
    api.put('/auth/profile', data),

  requestPasswordReset: (email) =>
    api.post('/auth/password/reset-request', { email }),

  resetPassword: (token, password) =>
    api.post('/auth/password/reset', { token, password }),
};
