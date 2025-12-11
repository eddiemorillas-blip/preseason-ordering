import axios from 'axios';

// In production, use relative URL (frontend served from same server as API)
// In development, use localhost
const getBaseURL = () => {
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }
  // Check if we're on the production domain
  if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    return '/api'; // Relative URL for production
  }
  return 'http://localhost:5000/api'; // Development
};

const api = axios.create({
  baseURL: getBaseURL()
});

// Add token to all requests
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Handle 401 errors (redirect to login)
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// Auth API calls
export const authAPI = {
  login: (email, password) => api.post('/auth/login', { email, password }),
  register: (userData) => api.post('/auth/register', userData),
  getCurrentUser: () => api.get('/auth/me'),
  getUsers: () => api.get('/auth/users'),
};

// Brand API calls
export const brandAPI = {
  getAll: () => api.get('/brands'),
  getById: (id) => api.get(`/brands/${id}`),
  create: (brandData) => api.post('/brands', brandData),
  update: (id, brandData) => api.patch(`/brands/${id}`, brandData),
  getStats: (id) => api.get(`/brands/${id}/stats`),
};

// Product API calls
export const productAPI = {
  search: (params) => api.get('/products/search', { params }),
  getByUPC: (upc) => api.get(`/products/by-upc/${upc}`),
  getById: (id) => api.get(`/products/${id}`),
  getCategories: (brandId) => api.get(`/products/brand/${brandId}/categories`),
};

// Catalog API calls
export const catalogAPI = {
  preview: (formData) => api.post('/catalogs/preview', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
  upload: (formData, onUploadProgress) => api.post('/catalogs/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress,
    timeout: 600000 // 10 minutes for large file uploads
  }),
  getUploads: () => api.get('/catalogs/uploads'),
};

// Migration API calls
export const migrationAPI = {
  addGenderColumn: () => api.post('/migrations/add-gender-column'),
};

// Order API calls
export const orderAPI = {
  getAll: (params) => api.get('/orders', { params }),
  getById: (id) => api.get(`/orders/${id}`),
  create: (orderData) => api.post('/orders', orderData),
  update: (id, orderData) => api.patch(`/orders/${id}`, orderData),
  delete: (id) => api.delete(`/orders/${id}`),
  addItem: (orderId, itemData) => api.post(`/orders/${orderId}/items`, itemData),
  updateItem: (orderId, itemId, itemData) => api.patch(`/orders/${orderId}/items/${itemId}`, itemData),
  deleteItem: (orderId, itemId) => api.delete(`/orders/${orderId}/items/${itemId}`),
  copy: (orderId, copyData) => api.post(`/orders/${orderId}/copy`, copyData),
  getFamilyGroups: (orderId) => api.get(`/orders/${orderId}/family-groups`),
};

// Brand Template API calls
export const brandTemplateAPI = {
  getAll: (brandId) => api.get('/brand-templates', { params: brandId ? { brandId } : {} }),
  getById: (id) => api.get(`/brand-templates/${id}`),
  preview: (formData) => api.post('/brand-templates/preview', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
  create: (formData) => api.post('/brand-templates', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
  update: (id, formData) => api.put(`/brand-templates/${id}`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
  delete: (id) => api.delete(`/brand-templates/${id}`),
  download: (id) => api.get(`/brand-templates/${id}/download`, {
    responseType: 'blob'
  }),
  exportWithTemplate: (orderIds, templateId) => api.post('/exports/orders/brand-template',
    { orderIds, templateId },
    { responseType: 'blob' }
  ),
};

export default api;
