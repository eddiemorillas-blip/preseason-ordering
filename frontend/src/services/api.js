import axios from 'axios';

// Use environment variable for API URL, fallback to localhost for development
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000/api'
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

export default api;
