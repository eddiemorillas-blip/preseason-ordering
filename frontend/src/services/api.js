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
  delete: (id) => api.delete(`/brands/${id}`),
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
  deleteUpload: (id, deactivateProducts = false) =>
    api.delete(`/catalogs/uploads/${id}`, { params: { deactivateProducts } }),
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
  getInventory: (params) => api.get('/orders/inventory', { params }),
  getShipDates: (params) => api.get('/orders/ship-dates', { params }),
  adjustItem: (orderId, itemId, adjustedQuantity) =>
    api.patch(`/orders/${orderId}/items/${itemId}/adjust`, { adjusted_quantity: adjustedQuantity }),
  batchAdjust: (adjustments) => api.post('/orders/batch-adjust', { adjustments }),
  getVelocity: (params) => api.get('/orders/inventory/velocity', { params }),
  getAvailableProducts: (params) => api.get('/orders/available-products', { params }),
  getAvailableProductFilters: (params) => api.get('/orders/available-products/filters', { params }),
  ignoreProduct: (data) => api.post('/orders/ignore-product', data),
  getIgnoredProducts: (params) => api.get('/orders/ignored-products', { params }),
  unignoreProduct: (data) => api.post('/orders/unignore-product', data),
  finalize: (orderId) => api.post(`/orders/${orderId}/finalize`),
  getFinalizedStatus: (params) => api.get('/orders/finalized-status', { params }),
};

// Export API calls
export const exportAPI = {
  finalized: (data) => api.post('/exports/finalized', data, { responseType: 'blob' }),
  updateOrderForm: (formData) => api.post('/exports/update-order-form', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
};

// Price API calls (seasonal pricing)
export const priceAPI = {
  compare: (season1, season2, brandId) => api.get('/prices/compare', {
    params: { season1, season2, ...(brandId && { brandId }) }
  }),
  getProductHistory: (productId) => api.get(`/prices/product/${productId}/history`),
  getSeasonPrices: (seasonId, params) => api.get(`/prices/season/${seasonId}`, { params }),
  getCarryover: (seasonId, brandId) => api.get(`/prices/carryover/${seasonId}`, {
    params: brandId ? { brandId } : {}
  }),
  getSeasonsWithPrices: (brandId) => api.get('/prices/seasons-with-prices', {
    params: brandId ? { brandId } : {}
  }),
  update: (priceData) => api.post('/prices', priceData),
};

// Sales API calls (BigQuery sync)
export const salesAPI = {
  testConnection: () => api.get('/sales/test-connection'),
  sync: (months = 12) => api.post('/sales/sync', { months }),
  getSyncStatus: (id) => api.get(`/sales/sync-status/${id}`),
  getByUpc: (upc) => api.get(`/sales/by-upc/${upc}`),
  getByBrand: (periodMonths = 12) => api.get('/sales/by-brand', { params: { period_months: periodMonths } }),
  getTrends: (vendorName) => api.get(`/sales/trends/${encodeURIComponent(vendorName)}`),
  getBrandMapping: () => api.get('/sales/brand-mapping'),
  updateBrandMapping: (id, data) => api.put(`/sales/brand-mapping/${id}`, data),
  autoMapBrands: () => api.post('/sales/brand-mapping/auto-map'),
  getSummary: () => api.get('/sales/summary'),
  debugVendor: (vendorName, periodMonths = 12) => api.get(`/sales/debug/vendor/${encodeURIComponent(vendorName)}`, {
    params: { period_months: periodMonths }
  }),
};

// Budget API calls
export const budgetAPI = {
  getSeasonBudget: (seasonId) => api.get(`/budgets/season/${seasonId}`),
  setSeasonBudget: (seasonId, data) => api.post(`/budgets/season/${seasonId}`, data),
  setAllocations: (seasonId, allocations) => api.post(`/budgets/season/${seasonId}/allocations`, { allocations }),
  getSuggestions: (seasonId, totalBudget) => api.get(`/budgets/suggest/${seasonId}`, { params: { total_budget: totalBudget } }),
  getStatus: () => api.get('/budgets/status'),
  deleteBudget: (seasonId) => api.delete(`/budgets/season/${seasonId}`),
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
