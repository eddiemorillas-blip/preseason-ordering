import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import Layout from '../components/Layout';

const OrderSuggestions = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Filter state
  const [brands, setBrands] = useState([]);
  const [locations, setLocations] = useState([]);
  const [seasons, setSeasons] = useState([]);
  const [selectedBrand, setSelectedBrand] = useState('');
  const [selectedLocation, setSelectedLocation] = useState('');
  const [selectedSeason, setSelectedSeason] = useState('');
  const [salesMonths, setSalesMonths] = useState('6'); // Default last 6 months
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');

  // Suggestions state
  const [suggestions, setSuggestions] = useState([]);
  const [summary, setSummary] = useState(null);
  const [expandedFamilies, setExpandedFamilies] = useState({});

  // Selected items for adding to order
  const [selectedItems, setSelectedItems] = useState({});
  const [quantities, setQuantities] = useState({});

  // Shipment configuration
  const [numberOfShips, setNumberOfShips] = useState(1);
  const [shipDay, setShipDay] = useState(15); // Day of month
  const [startMonth, setStartMonth] = useState(''); // Starting month (YYYY-MM format)
  const [shipDates, setShipDates] = useState(['']);

  // Add new products modal state
  const [showAddProductModal, setShowAddProductModal] = useState(false);
  const [productSearchQuery, setProductSearchQuery] = useState('');
  const [productSearchResults, setProductSearchResults] = useState([]);
  const [searchingProducts, setSearchingProducts] = useState(false);
  const [selectedNewProduct, setSelectedNewProduct] = useState(null);
  const [newProductVariants, setNewProductVariants] = useState([]);
  const [newProductQuantities, setNewProductQuantities] = useState({});
  const [newProductSelectedShips, setNewProductSelectedShips] = useState(new Set());
  const [addingProducts, setAddingProducts] = useState(false);

  useEffect(() => {
    fetchFilters();
  }, []);

  const fetchFilters = async () => {
    try {
      const [brandsRes, locationsRes, seasonsRes] = await Promise.all([
        api.get('/brands'),
        api.get('/locations'),
        api.get('/seasons')
      ]);
      setBrands(brandsRes.data.brands || []);
      setLocations(locationsRes.data.locations || []);
      setSeasons(seasonsRes.data.seasons || []);
    } catch (err) {
      console.error('Error fetching filters:', err);
      setError('Failed to load filter options');
    }
  };

  const fetchSuggestions = async () => {
    if (!selectedBrand || !selectedLocation) {
      setError('Please select a brand and location');
      return;
    }

    setLoading(true);
    setError('');
    setSuggestions([]);
    setSummary(null);

    try {
      const params = new URLSearchParams({
        brandId: selectedBrand,
        locationId: selectedLocation
      });

      // Use custom dates if selected, otherwise use months preset
      if (salesMonths === 'custom' && customStartDate && customEndDate) {
        params.append('startDate', customStartDate);
        params.append('endDate', customEndDate);
      } else if (salesMonths !== 'custom') {
        params.append('salesMonths', salesMonths);
      }

      const response = await api.get(`/sales-data/suggestions?${params}`);
      setSuggestions(response.data.suggestions || []);
      setSummary(response.data.summary || null);

      // Initialize quantities with suggested values
      const initialQuantities = {};
      const initialSelected = {};
      for (const family of response.data.suggestions || []) {
        for (const variant of family.variants) {
          initialQuantities[variant.product_id] = variant.suggested_qty;
          initialSelected[variant.product_id] = true;
        }
      }
      setQuantities(initialQuantities);
      setSelectedItems(initialSelected);

      // Expand all families by default
      const expanded = {};
      for (const family of response.data.suggestions || []) {
        expanded[family.base_name] = true;
      }
      setExpandedFamilies(expanded);

    } catch (err) {
      console.error('Error fetching suggestions:', err);
      setError(err.response?.data?.error || 'Failed to fetch suggestions');
    } finally {
      setLoading(false);
    }
  };

  const toggleFamily = (familyName) => {
    setExpandedFamilies(prev => ({
      ...prev,
      [familyName]: !prev[familyName]
    }));
  };

  const toggleSelectAll = (familyName, variants) => {
    const allSelected = variants.every(v => selectedItems[v.product_id]);
    const newSelected = { ...selectedItems };
    for (const variant of variants) {
      newSelected[variant.product_id] = !allSelected;
    }
    setSelectedItems(newSelected);
  };

  const toggleSelectItem = (productId) => {
    setSelectedItems(prev => ({
      ...prev,
      [productId]: !prev[productId]
    }));
  };

  const updateQuantity = (productId, value) => {
    const qty = parseInt(value) || 0;
    setQuantities(prev => ({
      ...prev,
      [productId]: qty
    }));
  };

  // Generate ship dates based on start month, ship day, and number of ships
  const generateShipDates = (numShips, day, startMonthStr) => {
    if (!startMonthStr) return Array(numShips).fill('');

    const dates = [];
    const [year, month] = startMonthStr.split('-').map(Number);

    for (let i = 0; i < numShips; i++) {
      const shipMonth = month + i - 1; // month is 1-based from input
      const shipYear = year + Math.floor(shipMonth / 12);
      const actualMonth = ((shipMonth % 12) + 12) % 12; // Handle wrap-around

      // Get the last day of the target month
      const lastDayOfMonth = new Date(shipYear, actualMonth + 1, 0).getDate();

      // Use the ship day or last day of month if ship day exceeds month length
      const actualDay = Math.min(day, lastDayOfMonth);

      const date = new Date(shipYear, actualMonth, actualDay);
      dates.push(date.toISOString().split('T')[0]);
    }

    return dates;
  };

  // Handle number of ships change
  const handleNumberOfShipsChange = (num) => {
    const newNum = Math.max(1, Math.min(6, parseInt(num) || 1));
    setNumberOfShips(newNum);

    // Regenerate ship dates
    if (startMonth) {
      setShipDates(generateShipDates(newNum, shipDay, startMonth));
    } else {
      // Adjust ship dates array manually
      const newShipDates = [...shipDates];
      while (newShipDates.length < newNum) {
        newShipDates.push('');
      }
      while (newShipDates.length > newNum) {
        newShipDates.pop();
      }
      setShipDates(newShipDates);
    }
  };

  // Handle ship day change
  const handleShipDayChange = (day) => {
    const newDay = Math.max(1, Math.min(31, parseInt(day) || 1));
    setShipDay(newDay);

    // Regenerate ship dates if start month is set
    if (startMonth) {
      setShipDates(generateShipDates(numberOfShips, newDay, startMonth));
    }
  };

  // Handle start month change
  const handleStartMonthChange = (monthStr) => {
    setStartMonth(monthStr);

    // Generate ship dates
    if (monthStr) {
      setShipDates(generateShipDates(numberOfShips, shipDay, monthStr));
    }
  };

  // Update a specific ship date (manual override)
  const updateShipDate = (index, date) => {
    const newShipDates = [...shipDates];
    newShipDates[index] = date;
    setShipDates(newShipDates);
  };

  const getSelectedCount = () => {
    return Object.values(selectedItems).filter(Boolean).length;
  };

  const getSelectedTotal = () => {
    let total = 0;
    for (const family of suggestions) {
      for (const variant of family.variants) {
        if (selectedItems[variant.product_id]) {
          const qty = quantities[variant.product_id] || 0;
          total += qty * parseFloat(variant.wholesale_cost || 0);
        }
      }
    }
    return total;
  };

  const getSelectedQty = () => {
    let total = 0;
    for (const family of suggestions) {
      for (const variant of family.variants) {
        if (selectedItems[variant.product_id]) {
          total += quantities[variant.product_id] || 0;
        }
      }
    }
    return total;
  };

  const handleCreateOrder = async () => {
    if (!selectedSeason) {
      setError('Please select a season for the order');
      return;
    }

    // Validate ship dates if multiple ships
    const validShipDates = shipDates.filter(d => d);
    if (numberOfShips > 1 && validShipDates.length < numberOfShips) {
      setError(`Please enter all ${numberOfShips} ship dates`);
      return;
    }

    const itemsToAdd = [];
    for (const family of suggestions) {
      for (const variant of family.variants) {
        if (selectedItems[variant.product_id] && quantities[variant.product_id] > 0) {
          itemsToAdd.push({
            product_id: variant.product_id,
            quantity: quantities[variant.product_id],
            unit_price: parseFloat(variant.wholesale_cost || 0),
            // Include target ships for new products (defaults to all ships if not specified)
            targetShips: variant._targetShips || null
          });
        }
      }
    }

    if (itemsToAdd.length === 0) {
      setError('No items selected to add to order');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const createdOrderIds = [];
      const numShips = parseInt(numberOfShips) || 1;

      console.log(`Creating ${numShips} orders with ${itemsToAdd.length} items`);

      // Pre-calculate splits for each item across ships
      // Items with targetShips only go to those specific ships
      // Items without targetShips go to all ships (round-robin balanced)
      const itemSplits = itemsToAdd.map((item, itemIndex) => {
        const totalQty = parseInt(item.quantity) || 0;
        const splits = Array(numShips).fill(0);

        // Determine which ships this item should go to
        const targetShips = item.targetShips || Array.from({ length: numShips }, (_, i) => i);
        const numTargetShips = targetShips.length;

        if (numTargetShips === 0) {
          return { product_id: item.product_id, unit_price: item.unit_price, totalQty, splits };
        }

        // Start distribution at a different ship for balance (within target ships)
        const startOffset = itemIndex % numTargetShips;

        // Distribute each unit across target ships only
        for (let unit = 0; unit < totalQty; unit++) {
          const targetIndex = (startOffset + unit) % numTargetShips;
          const actualShipIndex = targetShips[targetIndex];
          splits[actualShipIndex]++;
        }

        return {
          product_id: item.product_id,
          unit_price: item.unit_price,
          totalQty,
          splits
        };
      });

      console.log('Split plan:', itemSplits.map(i => ({
        id: i.product_id,
        total: i.totalQty,
        splits: i.splits,
        sum: i.splits.reduce((a, b) => a + b, 0)
      })));

      // Create all orders first
      for (let shipIndex = 0; shipIndex < numShips; shipIndex++) {
        const shipDate = shipDates[shipIndex] || null;
        const shipLabel = numShips > 1 ? ` (Ship ${shipIndex + 1} of ${numShips})` : '';

        console.log(`Creating order ${shipIndex + 1} of ${numShips} with ship date: ${shipDate}`);

        const orderResponse = await api.post('/orders', {
          season_id: selectedSeason,
          brand_id: selectedBrand,
          location_id: selectedLocation,
          ship_date: shipDate,
          notes: `Created from sales suggestions${shipLabel}`
        });

        const orderId = orderResponse.data.order.id;
        createdOrderIds.push(orderId);
        console.log(`Order ${shipIndex + 1} created with ID: ${orderId}`);

        // Add items for this ship based on pre-calculated splits
        let itemsAddedToThisOrder = 0;
        for (const item of itemSplits) {
          const qtyForThisShip = item.splits[shipIndex];

          if (qtyForThisShip > 0) {
            console.log(`  Adding item ${item.product_id}: ${qtyForThisShip} of ${item.totalQty}`);
            await api.post(`/orders/${orderId}/items`, {
              product_id: item.product_id,
              quantity: qtyForThisShip,
              unit_price: item.unit_price
            });
            itemsAddedToThisOrder++;
          }
        }
        console.log(`Order ${shipIndex + 1} complete: ${itemsAddedToThisOrder} items added`);
      }

      if (numShips === 1) {
        setSuccess(`Order created successfully with ${itemsToAdd.length} items!`);
        setTimeout(() => {
          navigate(`/orders/${createdOrderIds[0]}`);
        }, 1500);
      } else {
        setSuccess(`${numShips} orders created successfully! Quantities split evenly across ship dates.`);
        setTimeout(() => {
          navigate(`/seasons/${selectedSeason}`);
        }, 2000);
      }

    } catch (err) {
      console.error('Error creating order:', err);
      setError(err.response?.data?.error || 'Failed to create order');
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (value) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(value || 0);
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return 'N/A';
    return new Date(dateStr).toLocaleDateString();
  };

  // Search for products to add
  const searchProducts = async () => {
    if (!productSearchQuery.trim() || !selectedBrand) return;

    setSearchingProducts(true);
    try {
      const response = await api.get(`/products/search?q=${encodeURIComponent(productSearchQuery)}&brandId=${selectedBrand}&limit=20`);

      // Group products by base name (product_name without size/color variations)
      const grouped = {};
      for (const product of response.data.products || []) {
        // Extract base name (name without size suffix)
        const baseName = product.name.replace(/\s*-\s*(XS|S|M|L|XL|XXL|2XL|3XL|\d+|\d+\/\d+)$/i, '').trim();
        if (!grouped[baseName]) {
          grouped[baseName] = {
            baseName,
            category: product.category,
            brand_name: product.brand_name,
            variants: []
          };
        }
        grouped[baseName].variants.push(product);
      }

      setProductSearchResults(Object.values(grouped));
    } catch (err) {
      console.error('Error searching products:', err);
      setError('Failed to search products');
    } finally {
      setSearchingProducts(false);
    }
  };

  // Select a product family to add
  const selectProductFamily = (family) => {
    setSelectedNewProduct(family);
    setNewProductVariants(family.variants);

    // Initialize quantities to 0 for all variants
    const initialQtys = {};
    for (const variant of family.variants) {
      initialQtys[variant.id] = 0;
    }
    setNewProductQuantities(initialQtys);

    // Default to all ships selected
    const allShips = new Set();
    for (let i = 0; i < numberOfShips; i++) {
      allShips.add(i);
    }
    setNewProductSelectedShips(allShips);
  };

  // Toggle ship selection for new product
  const toggleNewProductShip = (shipIndex) => {
    setNewProductSelectedShips(prev => {
      const newSet = new Set(prev);
      if (newSet.has(shipIndex)) {
        newSet.delete(shipIndex);
      } else {
        newSet.add(shipIndex);
      }
      return newSet;
    });
  };

  // Update quantity for new product variant
  const updateNewProductQuantity = (productId, value) => {
    const qty = parseInt(value) || 0;
    setNewProductQuantities(prev => ({
      ...prev,
      [productId]: qty
    }));
  };

  // Add selected new products to suggestions
  const addNewProductsToSuggestions = () => {
    if (!selectedNewProduct || newProductSelectedShips.size === 0) return;

    // Get variants with quantity > 0
    const variantsToAdd = newProductVariants.filter(v => (newProductQuantities[v.id] || 0) > 0);
    if (variantsToAdd.length === 0) {
      setError('Please enter quantities for at least one size');
      return;
    }

    // Create a new suggestion family
    const newFamily = {
      base_name: selectedNewProduct.baseName + ' (New)',
      category: selectedNewProduct.category,
      gender: variantsToAdd[0]?.gender || null,
      total_prior_sales: 0,
      total_suggested_qty: variantsToAdd.reduce((sum, v) => sum + (newProductQuantities[v.id] || 0), 0),
      total_suggested_cost: variantsToAdd.reduce((sum, v) => sum + (newProductQuantities[v.id] || 0) * parseFloat(v.wholesale_cost || 0), 0),
      variants: variantsToAdd.map(v => ({
        product_id: v.id,
        sku: v.sku,
        upc: v.upc,
        color: v.color,
        size: v.size,
        wholesale_cost: v.wholesale_cost,
        msrp: v.msrp,
        prior_sales: 0,
        suggested_qty: newProductQuantities[v.id] || 0,
        // Store which ships this should go to
        _targetShips: Array.from(newProductSelectedShips)
      })),
      // Mark as new product
      _isNewProduct: true,
      _targetShips: Array.from(newProductSelectedShips)
    };

    // Add to suggestions
    setSuggestions(prev => [...prev, newFamily]);

    // Initialize selected items and quantities for new variants
    const newSelectedItems = { ...selectedItems };
    const newQuantities = { ...quantities };
    for (const variant of newFamily.variants) {
      newSelectedItems[variant.product_id] = true;
      newQuantities[variant.product_id] = variant.suggested_qty;
    }
    setSelectedItems(newSelectedItems);
    setQuantities(newQuantities);

    // Expand the new family
    setExpandedFamilies(prev => ({
      ...prev,
      [newFamily.base_name]: true
    }));

    // Reset modal state
    setShowAddProductModal(false);
    setSelectedNewProduct(null);
    setProductSearchQuery('');
    setProductSearchResults([]);
    setNewProductQuantities({});

    setSuccess(`Added ${selectedNewProduct.baseName} to suggestions`);
    setTimeout(() => setSuccess(''), 3000);
  };

  // Close add product modal
  const closeAddProductModal = () => {
    setShowAddProductModal(false);
    setSelectedNewProduct(null);
    setProductSearchQuery('');
    setProductSearchResults([]);
    setNewProductQuantities({});
  };

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Order Suggestions</h1>
          <p className="text-gray-600 mt-1">
            Generate order suggestions based on prior sales data
          </p>
        </div>

        {/* Alerts */}
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        )}

        {success && (
          <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded">
            {success}
          </div>
        )}

        {/* Filters */}
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">Select Criteria</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Brand *
              </label>
              <select
                value={selectedBrand}
                onChange={(e) => setSelectedBrand(e.target.value)}
                className="w-full px-3 py-2 border rounded-md focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">Select Brand</option>
                {brands.map(brand => (
                  <option key={brand.id} value={brand.id}>{brand.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Location *
              </label>
              <select
                value={selectedLocation}
                onChange={(e) => setSelectedLocation(e.target.value)}
                className="w-full px-3 py-2 border rounded-md focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">Select Location</option>
                {locations.map(loc => (
                  <option key={loc.id} value={loc.id}>{loc.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Season (for new order)
              </label>
              <select
                value={selectedSeason}
                onChange={(e) => setSelectedSeason(e.target.value)}
                className="w-full px-3 py-2 border rounded-md focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">Select Season</option>
                {seasons.map(season => (
                  <option key={season.id} value={season.id}>{season.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Sales Period
              </label>
              <select
                value={salesMonths}
                onChange={(e) => setSalesMonths(e.target.value)}
                className="w-full px-3 py-2 border rounded-md focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="3">Last 3 months</option>
                <option value="6">Last 6 months</option>
                <option value="9">Last 9 months</option>
                <option value="12">Last 12 months</option>
                <option value="18">Last 18 months</option>
                <option value="24">Last 24 months</option>
                <option value="custom">Custom Date Range</option>
              </select>
            </div>

            {salesMonths === 'custom' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Start Date
                  </label>
                  <input
                    type="date"
                    value={customStartDate}
                    onChange={(e) => setCustomStartDate(e.target.value)}
                    className="w-full px-3 py-2 border rounded-md focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    End Date
                  </label>
                  <input
                    type="date"
                    value={customEndDate}
                    onChange={(e) => setCustomEndDate(e.target.value)}
                    className="w-full px-3 py-2 border rounded-md focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </>
            )}

            <div className="flex items-end">
              <button
                onClick={fetchSuggestions}
                disabled={loading || !selectedBrand || !selectedLocation}
                className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                {loading ? 'Loading...' : 'Get Suggestions'}
              </button>
            </div>
          </div>
        </div>

        {/* Shipment Configuration */}
        {suggestions.length > 0 && (
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-4">Shipment Configuration</h2>
            <div className="space-y-4">
              {/* Ship day, start month, and number of ships */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Number of Shipments
                  </label>
                  <select
                    value={numberOfShips}
                    onChange={(e) => handleNumberOfShipsChange(e.target.value)}
                    className="w-full px-3 py-2 border rounded-md focus:ring-blue-500 focus:border-blue-500"
                  >
                    {[1, 2, 3, 4, 5, 6].map(n => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Ship Day (of month)
                  </label>
                  <select
                    value={shipDay}
                    onChange={(e) => handleShipDayChange(e.target.value)}
                    className="w-full px-3 py-2 border rounded-md focus:ring-blue-500 focus:border-blue-500"
                  >
                    {Array.from({ length: 31 }, (_, i) => i + 1).map(day => (
                      <option key={day} value={day}>{day}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    First Ship Month
                  </label>
                  <input
                    type="month"
                    value={startMonth}
                    onChange={(e) => handleStartMonthChange(e.target.value)}
                    className="w-full px-3 py-2 border rounded-md focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                <div className="flex items-end">
                  {startMonth && (
                    <div className="w-full p-2 bg-green-50 border border-green-200 rounded-md text-sm text-green-700">
                      Ships on the {shipDay}{shipDay === 1 ? 'st' : shipDay === 2 ? 'nd' : shipDay === 3 ? 'rd' : 'th'} of each month
                    </div>
                  )}
                </div>
              </div>

              {numberOfShips > 1 && (
                <div className="text-sm text-gray-500">
                  Quantities will be split evenly across {numberOfShips} shipments
                </div>
              )}

              {/* Generated/Manual Ship Dates */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-gray-700">
                    Ship Dates {numberOfShips > 1 && '(can be manually adjusted)'}
                  </label>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {shipDates.map((date, index) => (
                    <div key={index}>
                      <label className="block text-xs text-gray-500 mb-1">
                        Ship {index + 1} {numberOfShips > 1 && '*'}
                      </label>
                      <input
                        type="date"
                        value={date}
                        onChange={(e) => updateShipDate(index, e.target.value)}
                        className="w-full px-3 py-2 border rounded-md focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {numberOfShips > 1 && (
                <div className="bg-blue-50 p-3 rounded-md text-sm text-blue-800">
                  <strong>Example split:</strong> If you order 10 units with {numberOfShips} ships,
                  each ship will receive {Math.floor(10 / numberOfShips)} units
                  {10 % numberOfShips > 0 && ` (with ${10 % numberOfShips} extra unit(s) in earlier ships)`}.
                </div>
              )}
            </div>
          </div>
        )}

        {/* Summary */}
        {summary && (
          <div className="bg-white rounded-lg shadow p-6">
            <h2 className="text-lg font-semibold mb-4">Summary</h2>

            {/* Sales Period Info */}
            <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-md text-sm text-blue-800">
              <strong>Based on:</strong> Last {summary.sales_months} months of sales
              ({summary.sales_period_start} to {summary.sales_period_end})
              <br />
              <span className="text-blue-600">
                Suggested quantities = units sold during this period
              </span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-blue-50 p-4 rounded-lg">
                <div className="text-sm text-blue-600">Product Families</div>
                <div className="text-2xl font-bold text-blue-900">{summary.total_families}</div>
              </div>
              <div className="bg-green-50 p-4 rounded-lg">
                <div className="text-sm text-green-600">Total Variants</div>
                <div className="text-2xl font-bold text-green-900">{summary.total_variants}</div>
              </div>
              <div className="bg-purple-50 p-4 rounded-lg">
                <div className="text-sm text-purple-600">Suggested Qty</div>
                <div className="text-2xl font-bold text-purple-900">{summary.total_suggested_qty?.toLocaleString()}</div>
              </div>
              <div className="bg-orange-50 p-4 rounded-lg">
                <div className="text-sm text-orange-600">Suggested Cost</div>
                <div className="text-2xl font-bold text-orange-900">{formatCurrency(summary.total_suggested_cost)}</div>
              </div>
            </div>
          </div>
        )}

        {/* Selection Summary & Actions */}
        {suggestions.length > 0 && (
          <div className="bg-white rounded-lg shadow p-4 sticky top-0 z-10">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-6">
                <div>
                  <span className="text-sm text-gray-600">Selected:</span>
                  <span className="ml-2 font-bold">{getSelectedCount()} items</span>
                </div>
                <div>
                  <span className="text-sm text-gray-600">Qty:</span>
                  <span className="ml-2 font-bold">{getSelectedQty()}</span>
                </div>
                <div>
                  <span className="text-sm text-gray-600">Total:</span>
                  <span className="ml-2 font-bold text-green-600">{formatCurrency(getSelectedTotal())}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowAddProductModal(true)}
                  disabled={!selectedBrand}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed font-medium"
                >
                  + Add New Product
                </button>
                <button
                  onClick={handleCreateOrder}
                  disabled={loading || getSelectedCount() === 0 || !selectedSeason}
                  className="px-6 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed font-medium"
                >
                  {loading ? 'Creating Order...' : 'Create Order with Selected Items'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Suggestions List */}
        {suggestions.length > 0 && (
          <div className="space-y-4">
            {suggestions.map((family) => (
              <div key={family.base_name} className="bg-white rounded-lg shadow overflow-hidden">
                {/* Family Header */}
                <div
                  className="px-4 py-3 bg-gray-50 border-b cursor-pointer hover:bg-gray-100 flex items-center justify-between"
                  onClick={() => toggleFamily(family.base_name)}
                >
                  <div className="flex items-center gap-4">
                    <span className="text-lg font-medium">{family.base_name}</span>
                    <span className="text-sm text-gray-500">
                      {family.category} {family.gender && `• ${family.gender}`}
                    </span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-sm text-gray-600">
                      {family.variants.length} variant{family.variants.length !== 1 ? 's' : ''}
                    </span>
                    <span className="font-medium text-blue-600">
                      {family.total_prior_sales} sold
                    </span>
                    <span className="font-medium text-green-600">
                      {formatCurrency(family.total_suggested_cost)}
                    </span>
                    <svg
                      className={`w-5 h-5 transform transition-transform ${expandedFamilies[family.base_name] ? 'rotate-180' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>

                {/* Variants Table */}
                {expandedFamilies[family.base_name] && (
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                            <input
                              type="checkbox"
                              checked={family.variants.every(v => selectedItems[v.product_id])}
                              onChange={() => toggleSelectAll(family.base_name, family.variants)}
                              className="rounded border-gray-300"
                            />
                          </th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Color</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Size</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">SKU</th>
                          <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Sold</th>
                          <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Cost</th>
                          <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">Order Qty</th>
                          <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Line Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {family.variants.map((variant) => (
                          <tr
                            key={variant.product_id}
                            className={selectedItems[variant.product_id] ? 'bg-blue-50' : 'hover:bg-gray-50'}
                          >
                            <td className="px-4 py-2">
                              <input
                                type="checkbox"
                                checked={selectedItems[variant.product_id] || false}
                                onChange={() => toggleSelectItem(variant.product_id)}
                                className="rounded border-gray-300"
                              />
                            </td>
                            <td className="px-4 py-2 text-sm">{variant.color || '-'}</td>
                            <td className="px-4 py-2 text-sm">{variant.size || '-'}</td>
                            <td className="px-4 py-2 text-sm text-gray-500">{variant.sku || '-'}</td>
                            <td className="px-4 py-2 text-sm text-right font-medium">{variant.prior_sales}</td>
                            <td className="px-4 py-2 text-sm text-right">{formatCurrency(variant.wholesale_cost)}</td>
                            <td className="px-4 py-2 text-center">
                              <input
                                type="number"
                                min="0"
                                value={quantities[variant.product_id] || 0}
                                onChange={(e) => updateQuantity(variant.product_id, e.target.value)}
                                className="w-20 px-2 py-1 border rounded text-center"
                              />
                            </td>
                            <td className="px-4 py-2 text-sm text-right font-medium text-green-600">
                              {formatCurrency((quantities[variant.product_id] || 0) * parseFloat(variant.wholesale_cost || 0))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Empty State */}
        {!loading && suggestions.length === 0 && selectedBrand && selectedLocation && (
          <div className="bg-white rounded-lg shadow p-8 text-center">
            <div className="text-gray-500">
              <svg className="w-16 h-16 mx-auto mb-4 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="text-lg font-medium">No suggestions found</p>
              <p className="mt-1">
                There is no sales data for this brand and location combination.
                <br />
                Upload sales data first to generate suggestions.
              </p>
              <button
                onClick={() => setShowAddProductModal(true)}
                disabled={!selectedBrand}
                className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400"
              >
                + Add Products Without Sales Data
              </button>
            </div>
          </div>
        )}

        {/* Add New Product Modal */}
        {showAddProductModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden">
              {/* Modal Header */}
              <div className="px-6 py-4 border-b flex items-center justify-between">
                <h2 className="text-xl font-semibold">Add New Product</h2>
                <button
                  onClick={closeAddProductModal}
                  className="text-gray-500 hover:text-gray-700"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Modal Body */}
              <div className="p-6 overflow-y-auto max-h-[70vh]">
                {!selectedNewProduct ? (
                  <>
                    {/* Search Form */}
                    <div className="mb-4">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Search Products by Name
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={productSearchQuery}
                          onChange={(e) => setProductSearchQuery(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && searchProducts()}
                          placeholder="Enter product name..."
                          className="flex-1 px-3 py-2 border rounded-md focus:ring-blue-500 focus:border-blue-500"
                        />
                        <button
                          onClick={searchProducts}
                          disabled={searchingProducts || !productSearchQuery.trim()}
                          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400"
                        >
                          {searchingProducts ? 'Searching...' : 'Search'}
                        </button>
                      </div>
                    </div>

                    {/* Search Results */}
                    {productSearchResults.length > 0 && (
                      <div className="space-y-2">
                        <h3 className="text-sm font-medium text-gray-700">Select a Product Family:</h3>
                        {productSearchResults.map((family, idx) => (
                          <div
                            key={idx}
                            onClick={() => selectProductFamily(family)}
                            className="p-3 border rounded-md hover:bg-blue-50 cursor-pointer"
                          >
                            <div className="font-medium">{family.baseName}</div>
                            <div className="text-sm text-gray-500">
                              {family.category} • {family.variants.length} size{family.variants.length !== 1 ? 's' : ''} available
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {productSearchResults.length === 0 && productSearchQuery && !searchingProducts && (
                      <div className="text-center text-gray-500 py-8">
                        No products found matching "{productSearchQuery}"
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    {/* Selected Product Configuration */}
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="text-lg font-medium">{selectedNewProduct.baseName}</h3>
                          <p className="text-sm text-gray-500">{selectedNewProduct.category}</p>
                        </div>
                        <button
                          onClick={() => {
                            setSelectedNewProduct(null);
                            setNewProductVariants([]);
                            setNewProductQuantities({});
                          }}
                          className="text-blue-600 hover:text-blue-800"
                        >
                          ← Back to Search
                        </button>
                      </div>

                      {/* Ship Selection */}
                      {numberOfShips > 1 && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Add to which shipments?
                          </label>
                          <div className="flex flex-wrap gap-2">
                            {shipDates.map((date, index) => (
                              <button
                                key={index}
                                onClick={() => toggleNewProductShip(index)}
                                className={`px-3 py-2 rounded-md border ${
                                  newProductSelectedShips.has(index)
                                    ? 'bg-blue-600 text-white border-blue-600'
                                    : 'bg-white text-gray-700 border-gray-300 hover:border-blue-500'
                                }`}
                              >
                                Ship {index + 1}
                                {date && (
                                  <span className="ml-1 text-xs opacity-75">
                                    ({new Date(date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })})
                                  </span>
                                )}
                              </button>
                            ))}
                          </div>
                          <p className="text-xs text-gray-500 mt-1">
                            Quantities will be split evenly across selected shipments
                          </p>
                        </div>
                      )}

                      {/* Size/Variant Selection */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Enter quantities per size:
                        </label>
                        <div className="border rounded-md overflow-hidden">
                          <table className="min-w-full divide-y divide-gray-200">
                            <thead className="bg-gray-50">
                              <tr>
                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Color</th>
                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Size</th>
                                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">SKU</th>
                                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">Cost</th>
                                <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">Total Qty</th>
                                {numberOfShips > 1 && newProductSelectedShips.size > 0 && (
                                  <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase">Per Ship</th>
                                )}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200">
                              {newProductVariants.map((variant) => (
                                <tr key={variant.id} className="hover:bg-gray-50">
                                  <td className="px-4 py-2 text-sm">{variant.color || '-'}</td>
                                  <td className="px-4 py-2 text-sm font-medium">{variant.size || '-'}</td>
                                  <td className="px-4 py-2 text-sm text-gray-500">{variant.sku || '-'}</td>
                                  <td className="px-4 py-2 text-sm text-right">{formatCurrency(variant.wholesale_cost)}</td>
                                  <td className="px-4 py-2 text-center">
                                    <input
                                      type="number"
                                      min="0"
                                      value={newProductQuantities[variant.id] || 0}
                                      onChange={(e) => updateNewProductQuantity(variant.id, e.target.value)}
                                      className="w-20 px-2 py-1 border rounded text-center"
                                    />
                                  </td>
                                  {numberOfShips > 1 && newProductSelectedShips.size > 0 && (
                                    <td className="px-4 py-2 text-sm text-center text-gray-500">
                                      {Math.floor((newProductQuantities[variant.id] || 0) / newProductSelectedShips.size)}
                                      {(newProductQuantities[variant.id] || 0) % newProductSelectedShips.size > 0 && '+'}
                                    </td>
                                  )}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>

                      {/* Summary */}
                      <div className="bg-gray-50 p-3 rounded-md">
                        <div className="flex justify-between text-sm">
                          <span>Total Quantity:</span>
                          <span className="font-bold">
                            {Object.values(newProductQuantities).reduce((sum, q) => sum + (q || 0), 0)}
                          </span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span>Total Cost:</span>
                          <span className="font-bold text-green-600">
                            {formatCurrency(
                              newProductVariants.reduce((sum, v) =>
                                sum + (newProductQuantities[v.id] || 0) * parseFloat(v.wholesale_cost || 0), 0)
                            )}
                          </span>
                        </div>
                        {numberOfShips > 1 && (
                          <div className="flex justify-between text-sm text-gray-500">
                            <span>Adding to:</span>
                            <span>{newProductSelectedShips.size} shipment{newProductSelectedShips.size !== 1 ? 's' : ''}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Modal Footer */}
              {selectedNewProduct && (
                <div className="px-6 py-4 border-t flex justify-end gap-2">
                  <button
                    onClick={closeAddProductModal}
                    className="px-4 py-2 text-gray-700 border rounded-md hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={addNewProductsToSuggestions}
                    disabled={Object.values(newProductQuantities).every(q => !q || q === 0) || newProductSelectedShips.size === 0}
                    className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-400"
                  >
                    Add to Suggestions
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
};

export default OrderSuggestions;
