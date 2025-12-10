import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import api from '../services/api';
import Layout from '../components/Layout';

// Debounce hook
const useDebounce = (value, delay) => {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
};

const AddProducts = () => {
  const { orderId } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [order, setOrder] = useState(null);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [quantities, setQuantities] = useState({}); // { productId: quantity }

  // Search suggestions
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(-1);
  const searchInputRef = useRef(null);
  const suggestionsRef = useRef(null);

  // Column filters
  const [filters, setFilters] = useState({
    search: '',
    gender: '',
    category: '',
    subcategory: '',
    color: '',
    sizeMin: null,
    sizeMax: null,
    inseam: ''
  });

  // Debounce search for filtering (300ms delay)
  const debouncedSearch = useDebounce(filters.search, 300);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const rowsPerPage = 100;

  useEffect(() => {
    fetchData();
  }, [orderId]);

  const fetchData = async () => {
    try {
      setLoading(true);

      // Fetch order details
      const orderRes = await api.get(`/orders/${orderId}`);
      setOrder(orderRes.data.order);

      // Fetch all products for the brand
      const productsRes = await api.get(`/products/search?brandId=${orderRes.data.order.brand_id}&limit=10000`);
      setProducts(productsRes.data.products || []);

    } catch (err) {
      console.error('Error fetching data:', err);
      setError('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  // Helper to get family name (use base_name if available, fall back to name)
  const getFamily = useCallback((product) => product.base_name || product.name || 'Unknown', []);

  // Pre-compute all searchable terms for suggestions (computed once when products load)
  const searchableTerms = useMemo(() => {
    const terms = [];
    const seenFamilies = new Set();
    const seenSkus = new Set();
    const seenColors = new Set();

    products.forEach(p => {
      const family = p.base_name || p.name || 'Unknown';
      if (!seenFamilies.has(family)) {
        seenFamilies.add(family);
        terms.push({ type: 'family', value: family, display: family, searchLower: family.toLowerCase() });
      }
      if (p.sku && !seenSkus.has(p.sku)) {
        seenSkus.add(p.sku);
        terms.push({ type: 'sku', value: p.sku, display: `SKU: ${p.sku}`, searchLower: p.sku.toLowerCase() });
      }
      if (p.color && !seenColors.has(p.color)) {
        seenColors.add(p.color);
        terms.push({ type: 'color', value: p.color, display: `Color: ${p.color}`, searchLower: p.color.toLowerCase() });
      }
    });

    return terms.sort((a, b) => a.display.localeCompare(b.display));
  }, [products]);

  // Get unique values for filter dropdowns
  const filterOptions = useMemo(() => {
    const families = new Set();
    const genders = new Set();
    const categories = new Set();
    const subcategories = new Set();
    const colors = new Set();
    const sizes = new Set();
    const inseams = new Set();

    products.forEach(p => {
      families.add(p.base_name || p.name || 'Unknown');
      if (p.gender) genders.add(p.gender);
      if (p.category) categories.add(p.category);
      if (p.subcategory) subcategories.add(p.subcategory);
      if (p.color) colors.add(p.color);
      if (p.size) sizes.add(p.size);
      if (p.inseam) inseams.add(p.inseam);
    });

    // Size order map for letter sizes
    const sizeOrder = {
      'xxs': 1, '2xs': 1,
      'xs': 2,
      's': 3,
      'm': 4,
      'l': 5,
      'xl': 6,
      'xxl': 7, '2xl': 7,
      'xxxl': 8, '3xl': 8,
      'xxxxl': 9, '4xl': 9,
    };

    const sortSizes = (a, b) => {
      const aLower = a.toLowerCase();
      const bLower = b.toLowerCase();
      const aOrder = sizeOrder[aLower];
      const bOrder = sizeOrder[bLower];

      // Both are letter sizes
      if (aOrder && bOrder) return aOrder - bOrder;
      // Only a is letter size (letter sizes come after numbers typically, but let's keep them separate)
      if (aOrder && !bOrder) return 1;
      // Only b is letter size
      if (!aOrder && bOrder) return -1;
      // Try numeric comparison
      const aNum = parseFloat(a);
      const bNum = parseFloat(b);
      if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum;
      // Fallback to string comparison
      return a.localeCompare(b);
    };

    return {
      families: Array.from(families).sort(),
      genders: Array.from(genders).sort(),
      categories: Array.from(categories).sort(),
      subcategories: Array.from(subcategories).sort(),
      colors: Array.from(colors).sort(),
      sizes: Array.from(sizes).sort(sortSizes),
      inseams: Array.from(inseams).sort((a, b) => {
        const aNum = parseFloat(a);
        const bNum = parseFloat(b);
        if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum;
        return a.localeCompare(b);
      })
    };
  }, [products]);

  // Products filtered by all filters EXCEPT size (used to compute available sizes)
  const productsWithoutSizeFilter = useMemo(() => {
    const searchLower = debouncedSearch?.toLowerCase() || '';

    return products.filter(product => {
      if (searchLower && !product.name.toLowerCase().includes(searchLower) &&
          !product.base_name?.toLowerCase().includes(searchLower) &&
          !product.sku?.toLowerCase().includes(searchLower)) {
        return false;
      }
      if (filters.gender && product.gender !== filters.gender) return false;
      if (filters.category && product.category !== filters.category) return false;
      if (filters.subcategory && product.subcategory !== filters.subcategory) return false;
      if (filters.color && product.color !== filters.color) return false;
      if (filters.inseam && product.inseam !== filters.inseam) return false;
      return true;
    });
  }, [products, debouncedSearch, filters.gender, filters.category, filters.subcategory, filters.color, filters.inseam]);

  // Available sizes based on current filters (excluding size filter)
  const availableSizes = useMemo(() => {
    const sizes = [...new Set(productsWithoutSizeFilter.map(p => p.size).filter(Boolean))];
    // Sort maintaining original order from filterOptions.sizes
    return filterOptions.sizes.filter(s => sizes.includes(s));
  }, [productsWithoutSizeFilter, filterOptions.sizes]);

  // Filter products based on all active filters (uses debounced search for performance)
  const filteredProducts = useMemo(() => {
    // Apply size filter to already-filtered products
    if (filters.sizeMin === null && filters.sizeMax === null) {
      return productsWithoutSizeFilter;
    }

    return productsWithoutSizeFilter.filter(product => {
      const productSizeIndex = availableSizes.indexOf(product.size);
      if (productSizeIndex === -1) return false;
      if (filters.sizeMin !== null && productSizeIndex < filters.sizeMin) return false;
      if (filters.sizeMax !== null && productSizeIndex > filters.sizeMax) return false;
      return true;
    });
  }, [productsWithoutSizeFilter, filters.sizeMin, filters.sizeMax, availableSizes]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [debouncedSearch, filters.family, filters.gender, filters.category, filters.subcategory, filters.color, filters.sizeMin, filters.sizeMax, filters.inseam]);

  // Paginated products for display
  const totalPages = Math.ceil(filteredProducts.length / rowsPerPage);
  const paginatedProducts = useMemo(() => {
    const start = (currentPage - 1) * rowsPerPage;
    return filteredProducts.slice(start, start + rowsPerPage);
  }, [filteredProducts, currentPage, rowsPerPage]);

  // Get dynamic filter options based on current selections
  // Uses productsWithoutSizeFilter as base (already filtered by everything except size)
  const dynamicFilterOptions = useMemo(() => {
    const searchLower = debouncedSearch?.toLowerCase() || '';

    // Filter products based on current filters (except the filter we're computing options for)
    const getFilteredProducts = (excludeFilter) => {
      return products.filter(product => {
        if (excludeFilter !== 'search' && searchLower &&
            !product.name.toLowerCase().includes(searchLower) &&
            !product.base_name?.toLowerCase().includes(searchLower) &&
            !product.sku?.toLowerCase().includes(searchLower)) {
          return false;
        }
        if (excludeFilter !== 'gender' && filters.gender && product.gender !== filters.gender) return false;
        if (excludeFilter !== 'category' && filters.category && product.category !== filters.category) return false;
        if (excludeFilter !== 'subcategory' && filters.subcategory && product.subcategory !== filters.subcategory) return false;
        if (excludeFilter !== 'color' && filters.color && product.color !== filters.color) return false;
        // Size range filter - use availableSizes for proper indexing
        if (excludeFilter !== 'size' && (filters.sizeMin !== null || filters.sizeMax !== null)) {
          const productSizeIndex = availableSizes.indexOf(product.size);
          if (productSizeIndex === -1) return false;
          if (filters.sizeMin !== null && productSizeIndex < filters.sizeMin) return false;
          if (filters.sizeMax !== null && productSizeIndex > filters.sizeMax) return false;
        }
        if (excludeFilter !== 'inseam' && filters.inseam && product.inseam !== filters.inseam) return false;
        return true;
      });
    };

    return {
      genders: [...new Set(getFilteredProducts('gender').map(p => p.gender).filter(Boolean))].sort(),
      categories: [...new Set(getFilteredProducts('category').map(p => p.category).filter(Boolean))].sort(),
      subcategories: [...new Set(getFilteredProducts('subcategory').map(p => p.subcategory).filter(Boolean))].sort(),
      colors: [...new Set(getFilteredProducts('color').map(p => p.color).filter(Boolean))].sort(),
      inseams: [...new Set(getFilteredProducts('inseam').map(p => p.inseam).filter(Boolean))].sort((a, b) => {
        const aNum = parseFloat(a);
        const bNum = parseFloat(b);
        if (!isNaN(aNum) && !isNaN(bNum)) return aNum - bNum;
        return a.localeCompare(b);
      })
    };
  }, [products, debouncedSearch, filters.gender, filters.category, filters.subcategory, filters.color, filters.sizeMin, filters.sizeMax, filters.inseam, availableSizes]);

  // Generate search suggestions - fast lookup against pre-computed terms
  const searchSuggestions = useMemo(() => {
    if (!filters.search || filters.search.length < 2) return [];

    const searchLower = filters.search.toLowerCase();

    // Fast filter against pre-computed searchable terms
    return searchableTerms
      .filter(term => term.searchLower.includes(searchLower))
      .slice(0, 10);
  }, [searchableTerms, filters.search]);

  const handleFilterChange = (field, value) => {
    setFilters(prev => ({ ...prev, [field]: value }));
    if (field === 'search') {
      setShowSuggestions(value.length >= 2);
      setSelectedSuggestionIndex(-1);
    }
  };

  const handleSelectSuggestion = (suggestion) => {
    setFilters(prev => ({ ...prev, search: suggestion.value }));
    setShowSuggestions(false);
    setSelectedSuggestionIndex(-1);
  };

  const handleSearchKeyDown = (e) => {
    if (!showSuggestions || searchSuggestions.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedSuggestionIndex(prev =>
        prev < searchSuggestions.length - 1 ? prev + 1 : prev
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedSuggestionIndex(prev => prev > 0 ? prev - 1 : -1);
    } else if (e.key === 'Enter' && selectedSuggestionIndex >= 0) {
      e.preventDefault();
      handleSelectSuggestion(searchSuggestions[selectedSuggestionIndex]);
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
    }
  };

  const handleSearchBlur = () => {
    // Delay hiding suggestions to allow click events to fire
    setTimeout(() => setShowSuggestions(false), 200);
  };

  const clearFilters = () => {
    setFilters({
      search: '',
      gender: '',
      category: '',
      subcategory: '',
      color: '',
      sizeMin: null,
      sizeMax: null,
      inseam: ''
    });
    setShowSuggestions(false);
  };

  const handleQuantityChange = (productId, value) => {
    setQuantities(prev => ({
      ...prev,
      [productId]: value
    }));
  };

  const handleSetAllQuantities = (quantity) => {
    const newQuantities = {};
    filteredProducts.forEach(product => {
      newQuantities[product.id] = quantity;
    });
    setQuantities(prev => ({ ...prev, ...newQuantities }));
  };

  const handleAddProducts = async () => {
    try {
      setSaving(true);
      setError('');

      const productsToAdd = Object.entries(quantities)
        .filter(([_, qty]) => qty && parseInt(qty) > 0)
        .map(([productId, qty]) => ({
          product_id: parseInt(productId),
          quantity: parseInt(qty)
        }));

      if (productsToAdd.length === 0) {
        setError('Please enter quantities for at least one product');
        setSaving(false);
        return;
      }

      // Add each product to the order
      for (const product of productsToAdd) {
        await api.post(`/orders/${orderId}/items`, product);
      }

      // Clear quantities and stay on page
      setQuantities({});
    } catch (err) {
      console.error('Error adding products:', err);
      setError(err.response?.data?.error || 'Failed to add products');
    } finally {
      setSaving(false);
    }
  };

  const productsWithQuantity = Object.entries(quantities).filter(([_, qty]) => qty && parseInt(qty) > 0).length;
  const totalQuantity = Object.values(quantities).reduce((sum, qty) => sum + (parseInt(qty) || 0), 0);
  const activeFiltersCount = Object.entries(filters).filter(([k, v]) => {
    if (k === 'sizeMin' || k === 'sizeMax') return v !== null;
    return v;
  }).length;

  if (loading) {
    return (
      <Layout>
        <div className="flex justify-center items-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      </Layout>
    );
  }

  if (!order) {
    return (
      <Layout>
        <div className="text-center py-12">
          <p className="text-red-600">Order not found</p>
          <button
            onClick={() => navigate('/orders')}
            className="mt-4 text-blue-600 hover:text-blue-800"
          >
            Back to Orders
          </button>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex justify-between items-start">
          <div>
            <button
              onClick={() => navigate(`/orders/${orderId}`)}
              className="text-sm text-blue-600 hover:text-blue-800 mb-2"
            >
              &larr; Back to Order
            </button>
            <h1 className="text-2xl font-bold text-gray-900">Add Products</h1>
            <p className="text-sm text-gray-600 mt-1">
              Order: {order.order_number} &bull; {order.brand_name} &bull; {order.location_name}
            </p>
          </div>
          <div className="flex items-center space-x-4">
            <div className="text-right">
              <div className="text-sm text-gray-600">Products selected: <span className="font-semibold">{productsWithQuantity}</span></div>
              <div className="text-sm text-gray-600">Total units: <span className="font-semibold">{totalQuantity}</span></div>
            </div>
            <button
              onClick={handleAddProducts}
              disabled={saving || productsWithQuantity === 0}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400"
            >
              {saving ? 'Adding...' : `Add ${productsWithQuantity} Products`}
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-md p-4">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        {/* Filters */}
        <div className="bg-white shadow rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-gray-900">Filters</h2>
            {activeFiltersCount > 0 && (
              <button
                onClick={clearFilters}
                className="text-sm text-blue-600 hover:text-blue-800"
              >
                Clear all ({activeFiltersCount})
              </button>
            )}
          </div>
          {/* Row 1: Gender, Category, Subcategory */}
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Gender</label>
              <select
                value={filters.gender}
                onChange={(e) => handleFilterChange('gender', e.target.value)}
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
              >
                <option value="">All</option>
                {dynamicFilterOptions.genders.map(g => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Category</label>
              <select
                value={filters.category}
                onChange={(e) => handleFilterChange('category', e.target.value)}
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
              >
                <option value="">All</option>
                {dynamicFilterOptions.categories.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Subcategory</label>
              <select
                value={filters.subcategory}
                onChange={(e) => handleFilterChange('subcategory', e.target.value)}
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
              >
                <option value="">All</option>
                {dynamicFilterOptions.subcategories.map(s => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>
          {/* Row 2: Search, Size Range, Inseam, Color */}
          <div className="grid grid-cols-4 gap-3">
            <div className="relative">
              <label className="block text-xs text-gray-500 mb-1">Search</label>
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Name, SKU..."
                value={filters.search}
                onChange={(e) => handleFilterChange('search', e.target.value)}
                onKeyDown={handleSearchKeyDown}
                onFocus={() => filters.search.length >= 2 && setShowSuggestions(true)}
                onBlur={handleSearchBlur}
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                autoComplete="off"
              />
              {/* Search Suggestions Dropdown */}
              {showSuggestions && searchSuggestions.length > 0 && (
                <div
                  ref={suggestionsRef}
                  className="absolute z-50 left-0 right-0 mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-auto"
                >
                  {searchSuggestions.map((suggestion, index) => (
                    <div
                      key={`${suggestion.type}-${suggestion.value}`}
                      className={`px-3 py-2 cursor-pointer text-sm ${
                        index === selectedSuggestionIndex
                          ? 'bg-blue-100 text-blue-900'
                          : 'hover:bg-gray-100'
                      }`}
                      onMouseDown={() => handleSelectSuggestion(suggestion)}
                    >
                      <span className={`${suggestion.type !== 'family' ? 'text-gray-500' : ''}`}>
                        {suggestion.display}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">
                Size: {availableSizes.length > 0 ? (
                  <span className="text-blue-600 font-medium">
                    {availableSizes[filters.sizeMin ?? 0]} - {availableSizes[filters.sizeMax ?? availableSizes.length - 1]}
                  </span>
                ) : 'None'}
              </label>
              {availableSizes.length > 1 ? (
                <div className="relative h-[34px] flex items-center">
                  {/* Track background */}
                  <div className="absolute w-full h-1.5 bg-gray-200 rounded" />
                  {/* Highlighted range */}
                  <div
                    className="absolute h-1.5 bg-blue-500 rounded"
                    style={{
                      left: `${((filters.sizeMin ?? 0) / (availableSizes.length - 1)) * 100}%`,
                      right: `${100 - ((filters.sizeMax ?? availableSizes.length - 1) / (availableSizes.length - 1)) * 100}%`
                    }}
                  />
                  {/* Min slider */}
                  <input
                    type="range"
                    min="0"
                    max={availableSizes.length - 1}
                    value={filters.sizeMin ?? 0}
                    onChange={(e) => {
                      const val = parseInt(e.target.value);
                      const maxVal = filters.sizeMax ?? availableSizes.length - 1;
                      setFilters(prev => ({
                        ...prev,
                        sizeMin: val,
                        sizeMax: val > maxVal ? val : prev.sizeMax
                      }));
                    }}
                    className="absolute w-full appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-blue-600 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:bg-blue-600 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:shadow"
                  />
                  {/* Max slider */}
                  <input
                    type="range"
                    min="0"
                    max={availableSizes.length - 1}
                    value={filters.sizeMax ?? availableSizes.length - 1}
                    onChange={(e) => {
                      const val = parseInt(e.target.value);
                      const minVal = filters.sizeMin ?? 0;
                      setFilters(prev => ({
                        ...prev,
                        sizeMax: val,
                        sizeMin: val < minVal ? val : prev.sizeMin
                      }));
                    }}
                    className="absolute w-full appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-blue-600 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow [&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:bg-blue-600 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:shadow"
                  />
                </div>
              ) : availableSizes.length === 1 ? (
                <div className="text-sm text-gray-600 py-1.5">{availableSizes[0]}</div>
              ) : (
                <div className="text-sm text-gray-400 py-1.5">No sizes</div>
              )}
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Inseam</label>
              <select
                value={filters.inseam}
                onChange={(e) => handleFilterChange('inseam', e.target.value)}
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
              >
                <option value="">All ({dynamicFilterOptions.inseams.length})</option>
                {dynamicFilterOptions.inseams.map(i => (
                  <option key={i} value={i}>{i}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Color</label>
              <select
                value={filters.color}
                onChange={(e) => handleFilterChange('color', e.target.value)}
                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
              >
                <option value="">All ({dynamicFilterOptions.colors.length})</option>
                {dynamicFilterOptions.colors.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Bulk Actions & Pagination */}
        <div className="bg-gray-50 border rounded-lg px-4 py-3 flex items-center justify-between">
          <div className="text-sm text-gray-600">
            Showing <span className="font-semibold">{paginatedProducts.length}</span> of <span className="font-semibold">{filteredProducts.length}</span> products
            {filteredProducts.length !== products.length && (
              <span> (filtered from {products.length})</span>
            )}
          </div>
          <div className="flex items-center space-x-4">
            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center space-x-2">
                <button
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="px-2 py-1 border rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
                >
                  Prev
                </button>
                <span className="text-sm text-gray-600">
                  Page {currentPage} of {totalPages}
                </span>
                <button
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="px-2 py-1 border rounded text-sm disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-100"
                >
                  Next
                </button>
              </div>
            )}
            {/* Set all */}
            <div className="flex items-center space-x-2">
              <label className="text-sm text-gray-700">Set all to:</label>
              <input
                type="number"
                min="0"
                placeholder="0"
                className="w-16 px-2 py-1 border border-gray-300 rounded text-sm"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleSetAllQuantities(e.target.value);
                  }
                }}
                onBlur={(e) => {
                  if (e.target.value) {
                    handleSetAllQuantities(e.target.value);
                    e.target.value = '';
                  }
                }}
              />
            </div>
          </div>
        </div>

        {/* Products Table */}
        <div className="bg-white shadow rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Family
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Product
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Color
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Size
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Inseam
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    SKU
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Cost
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-28">
                    Quantity
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {paginatedProducts.map((product) => (
                  <tr key={product.id} className={`hover:bg-gray-50 ${quantities[product.id] > 0 ? 'bg-blue-50' : ''}`}>
                    <td className="px-4 py-2 text-sm text-gray-900 whitespace-nowrap">
                      {product.base_name || product.name || 'Unknown'}
                    </td>
                    <td className="px-4 py-2 text-sm text-gray-900">
                      {product.name}
                    </td>
                    <td className="px-4 py-2 text-sm text-gray-600 whitespace-nowrap">
                      {product.color || '-'}
                    </td>
                    <td className="px-4 py-2 text-sm text-gray-600 whitespace-nowrap">
                      {product.size || '-'}
                    </td>
                    <td className="px-4 py-2 text-sm text-gray-600 whitespace-nowrap">
                      {product.inseam || '-'}
                    </td>
                    <td className="px-4 py-2 text-sm text-gray-500 whitespace-nowrap">
                      {product.sku || '-'}
                    </td>
                    <td className="px-4 py-2 text-sm text-right text-gray-900 whitespace-nowrap">
                      ${parseFloat(product.wholesale_cost || 0).toFixed(2)}
                    </td>
                    <td className="px-4 py-2 text-sm text-right">
                      <input
                        type="number"
                        min="0"
                        value={quantities[product.id] || ''}
                        onChange={(e) => handleQuantityChange(product.id, e.target.value)}
                        className="w-20 px-2 py-1 border border-gray-300 rounded text-right text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        placeholder="0"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filteredProducts.length === 0 && (
            <div className="px-6 py-8 text-center text-sm text-gray-500">
              No products match your filters.{' '}
              <button onClick={clearFilters} className="text-blue-600 hover:text-blue-800">
                Clear filters
              </button>
            </div>
          )}
        </div>

        {/* Sticky Footer */}
        {productsWithQuantity > 0 && (
          <div className="sticky bottom-0 bg-white border-t shadow-lg px-6 py-4 -mx-6 mt-6">
            <div className="flex justify-between items-center max-w-7xl mx-auto">
              <div>
                <span className="text-gray-600">Ready to add </span>
                <span className="font-semibold text-gray-900">{productsWithQuantity} products</span>
                <span className="text-gray-600"> ({totalQuantity} total units)</span>
              </div>
              <button
                onClick={handleAddProducts}
                disabled={saving}
                className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 font-medium"
              >
                {saving ? 'Adding...' : 'Add to Order'}
              </button>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
};

export default AddProducts;
