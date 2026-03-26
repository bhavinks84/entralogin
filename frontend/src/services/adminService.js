import api from './api';

export const adminService = {
  getUsers: (params) =>
    api.get('/admin/users', { params }),

  updateUserRole: (id, role) =>
    api.patch(`/admin/users/${id}/role`, { role }),

  deleteUser: (id) =>
    api.delete(`/admin/users/${id}`),

  getAnalytics: () =>
    api.get('/admin/analytics'),
};
