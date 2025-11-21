import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../services/api';
import Layout from '../components/Layout';
import { useAuth } from '../context/AuthContext';

const OrderBuilder = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isAdmin, isBuyer } = useAuth();

  const [order, setOrder] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAddProductModal, setShowAddProductModal] = useState(false);
  const [showCopyOrderModal, setShowCopyOrderModal] = useState(false);

  useEffect(() => {
    fetchOrder();
  }, [id]);

  const fetchOrder = async () => {
    try {
      setLoading(true);
      const response = await api.get(`/orders/${id}`);
      setOrder(response.data.order);
      setItems(response.data.items || []);
    } catch (err) {
      console.error('Error fetching order:', err);
      setError('Failed to load order');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateStatus = async (newStatus) => {
    try {
      await api.patch(`/orders/${id}`, { status: newStatus });
      setOrder({ ...order, status: newStatus });
    } catch (err) {
      console.error('Error updating status:', err);
      setError('Failed to update order status');
    }
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount || 0);
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'draft':
        return 'bg-gray-100 text-gray-800';
      case 'submitted':
        return 'bg-blue-100 text-blue-800';
      case 'confirmed':
        return 'bg-green-100 text-green-800';
      case 'cancelled':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  // Group items by product family (base_name)
  const groupedItems = items.reduce((acc, item) => {
    const key = item.base_name || 'Ungrouped';
    if (!acc[key]) {
      acc[key] = [];
    }
    acc[key].push(item);
    return acc;
  }, {});

  const canEdit = (isAdmin() || isBuyer()) && order?.status === 'draft';

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
            onClick={() => navigate('/seasons')}
            className="mt-4 text-blue-600 hover:text-blue-800"
          >
            Back to Seasons
          </button>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex justify-between items-start">
          <div>
            <button
              onClick={() => navigate(`/seasons/${order.season_id}`)}
              className="text-sm text-blue-600 hover:text-blue-800 mb-2"
            >
              ← Back to Season Dashboard
            </button>
            <div className="flex items-center space-x-3">
              <h1 className="text-3xl font-bold text-gray-900">{order.order_number}</h1>
              <span className={`px-3 py-1 inline-flex text-sm font-semibold rounded-full ${getStatusColor(order.status)}`}>
                {order.status}
              </span>
            </div>
            <div className="mt-2 text-sm text-gray-600 space-y-1">
              <div><strong>Season:</strong> {order.season_name}</div>
              <div><strong>Brand:</strong> {order.brand_name}</div>
              <div><strong>Location:</strong> {order.location_name} ({order.location_code})</div>
              {order.ship_date && (
                <div><strong>Ship Date:</strong> {new Date(order.ship_date).toLocaleDateString()}</div>
              )}
              {order.notes && (
                <div><strong>Notes:</strong> {order.notes}</div>
              )}
            </div>
          </div>
          <div className="flex space-x-2">
            {canEdit && (
              <>
                <button
                  onClick={() => setShowAddProductModal(true)}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                  + Add Products
                </button>
                <button
                  onClick={() => setShowCopyOrderModal(true)}
                  className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
                >
                  Copy Order
                </button>
                <button
                  onClick={() => handleUpdateStatus('submitted')}
                  className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
                >
                  Submit Order
                </button>
              </>
            )}
            {isAdmin() && order.status === 'submitted' && (
              <button
                onClick={() => handleUpdateStatus('confirmed')}
                className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
              >
                Confirm Order
              </button>
            )}
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-md p-4">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        {/* Order Summary */}
        <div className="bg-white shadow rounded-lg p-6">
          <div className="grid grid-cols-3 gap-6">
            <div>
              <p className="text-sm text-gray-600">Total Items</p>
              <p className="text-2xl font-bold text-gray-900">{items.reduce((sum, item) => sum + parseInt(item.quantity), 0)}</p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Product Variants</p>
              <p className="text-2xl font-bold text-gray-900">{items.length}</p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Order Total</p>
              <p className="text-2xl font-bold text-blue-600">{formatCurrency(order.current_total)}</p>
            </div>
          </div>
        </div>

        {/* Items by Family */}
        <div className="bg-white shadow rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Order Items</h2>
          </div>
          {items.length === 0 ? (
            <div className="px-6 py-8 text-center text-sm text-gray-500">
              No items in this order yet.{' '}
              {canEdit && (
                <button
                  onClick={() => setShowAddProductModal(true)}
                  className="text-blue-600 hover:text-blue-800"
                >
                  Add products
                </button>
              )}
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {Object.entries(groupedItems).map(([familyName, familyItems]) => (
                <div key={familyName} className="p-6">
                  <h3 className="font-semibold text-gray-900 mb-4">{familyName}</h3>
                  <div className="overflow-x-auto">
                    <table className="min-w-full">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                            Product
                          </th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                            Size
                          </th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                            Color
                          </th>
                          <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">
                            Unit Price
                          </th>
                          <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">
                            Quantity
                          </th>
                          <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">
                            Line Total
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-100">
                        {familyItems.map((item) => (
                          <tr key={item.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-sm text-gray-900">
                              {item.product_name}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-600">
                              {item.size || '-'}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-600">
                              {item.color || '-'}
                            </td>
                            <td className="px-4 py-3 text-sm text-right text-gray-900">
                              {formatCurrency(item.unit_price)}
                            </td>
                            <td className="px-4 py-3 text-sm text-right font-medium text-gray-900">
                              {item.quantity}
                            </td>
                            <td className="px-4 py-3 text-sm text-right font-semibold text-gray-900">
                              {formatCurrency(item.line_total)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-3 pt-3 border-t border-gray-200 flex justify-end">
                    <div className="text-right">
                      <span className="text-sm text-gray-600">Family Total: </span>
                      <span className="text-lg font-semibold text-gray-900">
                        {formatCurrency(familyItems.reduce((sum, item) => sum + parseFloat(item.line_total), 0))}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Add Product Modal */}
        {showAddProductModal && (
          <AddProductModal
            orderId={id}
            brandId={order.brand_id}
            onClose={() => {
              setShowAddProductModal(false);
              fetchOrder();
            }}
          />
        )}

        {/* Copy Order Modal */}
        {showCopyOrderModal && (
          <CopyOrderModal
            orderId={id}
            order={order}
            onClose={() => {
              setShowCopyOrderModal(false);
            }}
          />
        )}
      </div>
    </Layout>
  );
};

// Add Product Modal Component - Bulk Selection
const AddProductModal = ({ orderId, brandId, onClose }) => {
  const [products, setProducts] = useState([]);
  const [families, setFamilies] = useState([]);
  const [selectedFamilies, setSelectedFamilies] = useState(new Set());
  const [selectedColors, setSelectedColors] = useState({}); // { familyName: ['Black', 'White'] }
  const [quantities, setQuantities] = useState({}); // { productId: quantity }
  const [selectedSizes, setSelectedSizes] = useState(new Set()); // Sizes to include in quantity entry
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState(1); // 1: Select families, 2: Select colors, 3: Enter quantities

  // Filters
  const [genderFilter, setGenderFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [subcategoryFilter, setSubcategoryFilter] = useState('');
  const [searchFilter, setSearchFilter] = useState('');

  useEffect(() => {
    fetchProducts();
  }, []);

  const fetchProducts = async () => {
    try {
      setLoading(true);
      const response = await api.get(`/products/search?brandId=${brandId}&limit=10000`);
      const allProducts = response.data.products || [];
      setProducts(allProducts);

      // Group by family
      const familyMap = {};
      allProducts.forEach(product => {
        const familyName = product.base_name || 'Unknown';
        if (!familyMap[familyName]) {
          familyMap[familyName] = {
            name: familyName,
            gender: product.gender || '',
            category: product.category || '',
            subcategory: product.subcategory || '',
            products: [],
            colors: new Set(),
            sizes: new Set()
          };
        }
        familyMap[familyName].products.push(product);
        if (product.color) familyMap[familyName].colors.add(product.color);
        if (product.size) familyMap[familyName].sizes.add(product.size);
      });

      setFamilies(Object.values(familyMap).map(f => ({
        ...f,
        colors: Array.from(f.colors),
        sizes: Array.from(f.sizes)
      })));
    } catch (err) {
      console.error('Error fetching products:', err);
      setError('Failed to load products');
    } finally {
      setLoading(false);
    }
  };

  // Get hierarchical filter options
  // Step 1: Get all genders
  const genders = [...new Set(families.map(f => f.gender).filter(Boolean))];

  // Step 2: Get categories that match selected gender (or all if no gender selected)
  const availableCategories = [...new Set(
    families
      .filter(f => !genderFilter || f.gender === genderFilter)
      .map(f => f.category)
      .filter(Boolean)
  )];

  // Step 3: Get subcategories that match selected gender+category (or all if no filters)
  const availableSubcategories = [...new Set(
    families
      .filter(f => {
        if (genderFilter && f.gender !== genderFilter) return false;
        if (categoryFilter && f.category !== categoryFilter) return false;
        return true;
      })
      .map(f => f.subcategory)
      .filter(Boolean)
  )];

  // Filter families
  const filteredFamilies = families.filter(family => {
    if (genderFilter && family.gender !== genderFilter) return false;
    if (categoryFilter && family.category !== categoryFilter) return false;
    if (subcategoryFilter && family.subcategory !== subcategoryFilter) return false;
    if (searchFilter && !family.name.toLowerCase().includes(searchFilter.toLowerCase())) return false;
    return true;
  });

  // Reset child filters when parent filter changes
  const handleGenderChange = (value) => {
    setGenderFilter(value);
    // Reset category and subcategory when gender changes
    if (categoryFilter) {
      const isCategoryStillValid = families.some(
        f => f.gender === value && f.category === categoryFilter
      );
      if (!isCategoryStillValid) {
        setCategoryFilter('');
        setSubcategoryFilter('');
      }
    }
  };

  const handleCategoryChange = (value) => {
    setCategoryFilter(value);
    // Reset subcategory when category changes
    if (subcategoryFilter) {
      const isSubcategoryStillValid = families.some(
        f => (!genderFilter || f.gender === genderFilter) &&
             f.category === value &&
             f.subcategory === subcategoryFilter
      );
      if (!isSubcategoryStillValid) {
        setSubcategoryFilter('');
      }
    }
  };

  const handleToggleFamily = (familyName) => {
    const newSelected = new Set(selectedFamilies);
    if (newSelected.has(familyName)) {
      newSelected.delete(familyName);
    } else {
      newSelected.add(familyName);
    }
    setSelectedFamilies(newSelected);
  };

  const handleNextToColors = () => {
    if (selectedFamilies.size === 0) {
      setError('Please select at least one product family');
      return;
    }
    setError('');
    setStep(2);
  };

  const handleToggleColor = (familyName, color) => {
    const familyColors = selectedColors[familyName] || [];
    const newColors = familyColors.includes(color)
      ? familyColors.filter(c => c !== color)
      : [...familyColors, color];

    setSelectedColors({
      ...selectedColors,
      [familyName]: newColors
    });
  };

  const handleNextToQuantities = () => {
    // Validate that at least one color is selected for each family
    const hasColorSelections = Array.from(selectedFamilies).every(
      familyName => selectedColors[familyName]?.length > 0
    );

    if (!hasColorSelections) {
      setError('Please select at least one color for each family');
      return;
    }

    // Initialize selectedSizes with all available sizes
    const allSizes = new Set();
    getProductsForQuantityStep().forEach(product => {
      if (product.size) allSizes.add(product.size);
    });
    setSelectedSizes(allSizes);

    setError('');
    setStep(3);
  };

  const handleToggleSize = (size) => {
    const newSizes = new Set(selectedSizes);
    if (newSizes.has(size)) {
      newSizes.delete(size);
    } else {
      newSizes.add(size);
    }
    setSelectedSizes(newSizes);
  };

  const handleSelectAllSizes = () => {
    const allSizes = new Set();
    getProductsForQuantityStep().forEach(product => {
      if (product.size) allSizes.add(product.size);
    });
    setSelectedSizes(allSizes);
  };

  const handleClearAllSizes = () => {
    setSelectedSizes(new Set());
  };

  const handleSetAllQuantities = (quantity) => {
    const newQuantities = {};
    getFilteredProductsForQuantityStep().forEach(product => {
      newQuantities[product.id] = quantity;
    });
    setQuantities(newQuantities);
  };

  const getProductsForQuantityStep = () => {
    const productsToShow = [];

    Array.from(selectedFamilies).forEach(familyName => {
      const family = families.find(f => f.name === familyName);
      const colors = selectedColors[familyName] || [];

      if (family) {
        family.products.forEach(product => {
          if (colors.includes(product.color)) {
            productsToShow.push(product);
          }
        });
      }
    });

    // Sort by family, then color, then size
    return productsToShow.sort((a, b) => {
      if (a.base_name !== b.base_name) return a.base_name.localeCompare(b.base_name);
      if (a.color !== b.color) return a.color.localeCompare(b.color);
      return (a.size || '').localeCompare(b.size || '');
    });
  };

  const getFilteredProductsForQuantityStep = () => {
    return getProductsForQuantityStep().filter(product =>
      !product.size || selectedSizes.has(product.size)
    );
  };

  // Get all unique sizes from selected products
  const getAllAvailableSizes = () => {
    const allSizes = new Set();
    getProductsForQuantityStep().forEach(product => {
      if (product.size) allSizes.add(product.size);
    });
    return Array.from(allSizes).sort((a, b) => {
      // Try to sort numerically if both are numbers, otherwise alphabetically
      const aNum = parseFloat(a);
      const bNum = parseFloat(b);
      if (!isNaN(aNum) && !isNaN(bNum)) {
        return aNum - bNum;
      }
      return a.localeCompare(b);
    });
  };

  const handleAddProducts = async () => {
    try {
      setLoading(true);
      setError('');

      const productsToAdd = Object.entries(quantities)
        .filter(([_, qty]) => qty && parseInt(qty) > 0)
        .map(([productId, qty]) => ({
          product_id: parseInt(productId),
          quantity: parseInt(qty)
        }));

      if (productsToAdd.length === 0) {
        setError('Please enter quantities for at least one product');
        setLoading(false);
        return;
      }

      // Add each product to the order
      for (const product of productsToAdd) {
        await api.post(`/orders/${orderId}/items`, product);
      }

      onClose();
    } catch (err) {
      console.error('Error adding products:', err);
      setError(err.response?.data?.error || 'Failed to add products');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50 overflow-y-auto">
      <div className="bg-white rounded-lg p-6 max-w-6xl w-full my-8 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold">Add Products to Order</h2>
          <div className="text-sm text-gray-600">
            Step {step} of 3: {step === 1 ? 'Select Families' : step === 2 ? 'Select Colors' : 'Enter Quantities'}
          </div>
        </div>

        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-md p-3">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        {/* Step 1: Select Families */}
        {step === 1 && (
          <div className="space-y-4">
            {/* Filters */}
            <div className="grid grid-cols-4 gap-3 pb-4 border-b">
              <div>
                <input
                  type="text"
                  placeholder="Search families..."
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
              </div>
              <div>
                <select
                  value={genderFilter}
                  onChange={(e) => handleGenderChange(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                >
                  <option value="">All Genders</option>
                  {genders.map(gender => (
                    <option key={gender} value={gender}>{gender}</option>
                  ))}
                </select>
              </div>
              <div>
                <select
                  value={categoryFilter}
                  onChange={(e) => handleCategoryChange(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  disabled={availableCategories.length === 0}
                >
                  <option value="">All Categories</option>
                  {availableCategories.map(cat => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>
              <div>
                <select
                  value={subcategoryFilter}
                  onChange={(e) => setSubcategoryFilter(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  disabled={availableSubcategories.length === 0}
                >
                  <option value="">All Subcategories</option>
                  {availableSubcategories.map(sub => (
                    <option key={sub} value={sub}>{sub}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Family List */}
            <div className="text-sm text-gray-600 mb-2">
              {selectedFamilies.size} of {filteredFamilies.length} families selected
            </div>

            <div className="max-h-96 overflow-y-auto border rounded-md">
              <div className="divide-y">
                {filteredFamilies.map(family => (
                  <div
                    key={family.name}
                    className="p-3 hover:bg-gray-50 cursor-pointer flex items-start space-x-3"
                    onClick={() => handleToggleFamily(family.name)}
                  >
                    <input
                      type="checkbox"
                      checked={selectedFamilies.has(family.name)}
                      onChange={() => {}}
                      className="mt-1"
                    />
                    <div className="flex-1">
                      <div className="font-medium text-gray-900">{family.name}</div>
                      <div className="text-sm text-gray-600">
                        {family.gender && <span>{family.gender} • </span>}
                        {family.category && <span>{family.category} • </span>}
                        {family.subcategory && <span>{family.subcategory} • </span>}
                        <span>{family.colors.length} colors • {family.sizes.length} sizes</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end space-x-2 pt-4 border-t">
              <button
                onClick={onClose}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleNextToColors}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                disabled={selectedFamilies.size === 0}
              >
                Next: Select Colors ({selectedFamilies.size} families)
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Select Colors */}
        {step === 2 && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              Select which colors to include for each product family
            </p>

            <div className="max-h-96 overflow-y-auto border rounded-md divide-y">
              {Array.from(selectedFamilies).map(familyName => {
                const family = families.find(f => f.name === familyName);
                if (!family) return null;

                return (
                  <div key={familyName} className="p-4">
                    <h3 className="font-semibold text-gray-900 mb-3">{familyName}</h3>
                    <div className="flex flex-wrap gap-2">
                      {family.colors.map(color => (
                        <button
                          key={color}
                          onClick={() => handleToggleColor(familyName, color)}
                          className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                            selectedColors[familyName]?.includes(color)
                              ? 'bg-blue-600 text-white'
                              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                          }`}
                        >
                          {color}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex justify-between space-x-2 pt-4 border-t">
              <button
                onClick={() => setStep(1)}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
              >
                ← Back
              </button>
              <div className="flex space-x-2">
                <button
                  onClick={onClose}
                  className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleNextToQuantities}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                  Next: Enter Quantities
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Step 3: Enter Quantities */}
        {step === 3 && (
          <div className="space-y-4">
            {/* Size Filter */}
            <div className="border rounded-md p-4 bg-gray-50">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold text-gray-900">Size Filter</h3>
                <div className="flex space-x-2">
                  <button
                    onClick={handleSelectAllSizes}
                    className="text-xs text-blue-600 hover:text-blue-800"
                  >
                    Select All
                  </button>
                  <span className="text-xs text-gray-400">|</span>
                  <button
                    onClick={handleClearAllSizes}
                    className="text-xs text-blue-600 hover:text-blue-800"
                  >
                    Clear All
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {getAllAvailableSizes().map(size => (
                  <button
                    key={size}
                    onClick={() => handleToggleSize(size)}
                    className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
                      selectedSizes.has(size)
                        ? 'bg-blue-600 text-white'
                        : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-100'
                    }`}
                  >
                    {size}
                  </button>
                ))}
              </div>
              <div className="mt-2 text-xs text-gray-600">
                {selectedSizes.size} of {getAllAvailableSizes().length} sizes selected •
                Showing {getFilteredProductsForQuantityStep().length} products
              </div>
            </div>

            {/* Quantity Controls */}
            <div className="flex items-center justify-between pb-4 border-b">
              <p className="text-sm text-gray-600">
                Enter quantities for each product variant
              </p>
              <div className="flex items-center space-x-2">
                <label className="text-sm text-gray-700">Set all to:</label>
                <input
                  type="number"
                  min="0"
                  placeholder="0"
                  className="w-20 px-2 py-1 border border-gray-300 rounded-md text-sm"
                  onChange={(e) => handleSetAllQuantities(e.target.value)}
                />
              </div>
            </div>

            <div className="max-h-96 overflow-y-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                      Family
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                      Color
                    </th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                      Size
                    </th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">
                      Cost
                    </th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">
                      Quantity
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {getFilteredProductsForQuantityStep().map(product => (
                    <tr key={product.id} className="hover:bg-gray-50">
                      <td className="px-4 py-2 text-sm text-gray-900">
                        {product.base_name}
                      </td>
                      <td className="px-4 py-2 text-sm text-gray-600">
                        {product.color}
                      </td>
                      <td className="px-4 py-2 text-sm text-gray-600">
                        {product.size || '-'}
                      </td>
                      <td className="px-4 py-2 text-sm text-right text-gray-900">
                        ${parseFloat(product.wholesale_cost || 0).toFixed(2)}
                      </td>
                      <td className="px-4 py-2 text-sm text-right">
                        <input
                          type="number"
                          min="0"
                          value={quantities[product.id] || ''}
                          onChange={(e) => setQuantities({ ...quantities, [product.id]: e.target.value })}
                          className="w-20 px-2 py-1 border border-gray-300 rounded-md text-right"
                          placeholder="0"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-between space-x-2 pt-4 border-t">
              <button
                onClick={() => setStep(2)}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
              >
                ← Back
              </button>
              <div className="flex space-x-2">
                <button
                  onClick={onClose}
                  className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                  disabled={loading}
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddProducts}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400"
                  disabled={loading}
                >
                  {loading ? 'Adding...' : 'Add to Order'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// Copy Order Modal Component with Variant Mapping
const CopyOrderModal = ({ orderId, order, onClose }) => {
  const navigate = useNavigate();
  const [locations, setLocations] = useState([]);
  const [targetLocationId, setTargetLocationId] = useState('');
  const [shipDate, setShipDate] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState(1); // 1: Select location, 2: Configure variant mapping
  const [familyGroups, setFamilyGroups] = useState([]);
  const [variantMapping, setVariantMapping] = useState({});
  const [availableVariants, setAvailableVariants] = useState({});

  useEffect(() => {
    fetchLocations();
    fetchFamilyGroups();
  }, []);

  const fetchLocations = async () => {
    try {
      const response = await api.get('/locations');
      setLocations(response.data.locations || []);
    } catch (err) {
      console.error('Error fetching locations:', err);
      setError('Failed to load locations');
    }
  };

  const fetchFamilyGroups = async () => {
    try {
      const response = await api.get(`/orders/${orderId}/family-groups`);
      setFamilyGroups(response.data.families || []);
    } catch (err) {
      console.error('Error fetching family groups:', err);
      setError('Failed to load product families');
    }
  };

  const handleNextStep = async () => {
    if (!targetLocationId) {
      setError('Please select a target location');
      return;
    }

    // Fetch available variants for each family
    setLoading(true);
    try {
      const variantsData = {};
      for (const family of familyGroups) {
        const response = await api.get(`/product-families/variants?brandId=${order.brand_id}&baseName=${encodeURIComponent(family.base_name)}`);
        variantsData[family.base_name] = response.data.colorGroups || {};
      }
      setAvailableVariants(variantsData);
      setStep(2);
    } catch (err) {
      console.error('Error fetching variants:', err);
      setError('Failed to load variant options');
    } finally {
      setLoading(false);
    }
  };

  const handleColorMapping = (baseName, sourceColor, targetColor) => {
    setVariantMapping({
      ...variantMapping,
      [baseName]: {
        ...variantMapping[baseName],
        color: { from: sourceColor, to: targetColor }
      }
    });
  };

  const buildVariantMappingPayload = () => {
    // Transform the mapping into the format expected by the backend
    const mapping = {};

    Object.entries(variantMapping).forEach(([baseName, config]) => {
      if (config.color) {
        mapping[baseName] = {};

        // Find the family to get all sizes
        const family = familyGroups.find(f => f.base_name === baseName);
        if (family && family.items) {
          family.items.forEach(item => {
            if (item.color === config.color.from) {
              mapping[baseName][item.size] = {
                from: config.color.from,
                to: config.color.to
              };
            }
          });
        }
      }
    });

    return mapping;
  };

  const handleCopyOrder = async () => {
    try {
      setLoading(true);
      setError('');

      const payload = {
        targetLocationId,
        shipDate: shipDate || undefined,
        notes: notes || undefined
      };

      // Add variant mapping if any exists
      const mappingPayload = buildVariantMappingPayload();
      if (Object.keys(mappingPayload).length > 0) {
        payload.variantMapping = mappingPayload;
      }

      const response = await api.post(`/orders/${orderId}/copy`, payload);
      navigate(`/orders/${response.data.order.id}`);
    } catch (err) {
      console.error('Error copying order:', err);
      setError(err.response?.data?.error || 'Failed to copy order');
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50 overflow-y-auto">
      <div className="bg-white rounded-lg p-6 max-w-4xl w-full my-8 max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl font-bold mb-4">Copy Order to Another Location</h2>

        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-md p-3">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        {step === 1 ? (
          <div className="space-y-4">
            <div>
              <p className="text-sm text-gray-600 mb-4">
                This will create a new order in the selected location. You'll be able to map product variants (e.g., change White to Black) in the next step.
              </p>
              <p className="text-sm text-gray-600 mb-4">
                Source: <strong>{order.location_name}</strong>
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Target Location *
              </label>
              <select
                value={targetLocationId}
                onChange={(e) => setTargetLocationId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
                required
              >
                <option value="">Select Location</option>
                {locations
                  .filter(loc => loc.id !== order.location_id)
                  .map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name} ({location.code})
                    </option>
                  ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Ship Date (optional)
              </label>
              <input
                type="date"
                value={shipDate}
                onChange={(e) => setShipDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Notes (optional)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
                rows={3}
                placeholder="Add any notes about this copy..."
              />
            </div>

            <div className="flex justify-end space-x-2 mt-6 pt-4 border-t">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                disabled={loading}
              >
                Cancel
              </button>
              <button
                onClick={handleNextStep}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400"
                disabled={loading || !targetLocationId}
              >
                {loading ? 'Loading...' : 'Next: Configure Variants'}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <p className="text-sm text-gray-600 mb-4">
                Optionally map product variants. For example, if the source order has White products, you can map them to Black for the target location.
              </p>
            </div>

            <div className="space-y-6">
              {familyGroups.map((family) => {
                const colors = Object.keys(availableVariants[family.base_name] || {});
                const sourceColor = family.color || 'default';

                return (
                  <div key={family.base_name} className="border border-gray-200 rounded-md p-4">
                    <h3 className="font-semibold text-gray-900 mb-2">{family.base_name}</h3>
                    <div className="text-sm text-gray-600 mb-3">
                      {family.items.length} items in source order (Color: {sourceColor})
                    </div>

                    {colors.length > 1 ? (
                      <div className="flex items-center space-x-3">
                        <span className="text-sm text-gray-700">Map color:</span>
                        <span className="px-3 py-1 bg-gray-100 rounded text-sm font-medium">
                          {sourceColor}
                        </span>
                        <span className="text-gray-500">→</span>
                        <select
                          value={variantMapping[family.base_name]?.color?.to || ''}
                          onChange={(e) => handleColorMapping(family.base_name, sourceColor, e.target.value)}
                          className="px-3 py-1 border border-gray-300 rounded-md text-sm"
                        >
                          <option value="">Keep same ({sourceColor})</option>
                          {colors.filter(c => c !== sourceColor).map((color) => (
                            <option key={color} value={color}>
                              {color}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : (
                      <div className="text-sm text-gray-500">
                        Only one color available - no mapping needed
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="flex justify-between space-x-2 mt-6 pt-4 border-t">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                disabled={loading}
              >
                ← Back
              </button>
              <div className="flex space-x-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                  disabled={loading}
                >
                  Cancel
                </button>
                <button
                  onClick={handleCopyOrder}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400"
                  disabled={loading}
                >
                  {loading ? 'Copying...' : 'Copy Order'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default OrderBuilder;
