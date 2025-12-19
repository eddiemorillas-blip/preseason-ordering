import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import api, { orderAPI, budgetAPI } from '../services/api';
import Layout from '../components/Layout';

const OrderAdjustment = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  // Filter state
  const [seasons, setSeasons] = useState([]);
  const [brands, setBrands] = useState([]);
  const [locations, setLocations] = useState([]);
  const [shipDates, setShipDates] = useState([]);

  // Selected filters from URL
  const selectedSeasonId = searchParams.get('season') || '';
  const selectedBrandId = searchParams.get('brand') || '';
  const selectedLocationId = searchParams.get('location') || '';
  const selectedShipDate = searchParams.get('shipDate') || '';

  // Data state
  const [inventory, setInventory] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Editing state
  const [editingItemId, setEditingItemId] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);

  // Suggestion state
  const [suggestions, setSuggestions] = useState({}); // { itemId: suggestedQty }
  const [selectedItems, setSelectedItems] = useState(new Set());
  const [activePanel, setActivePanel] = useState(null); // 'stock'|'velocity'|'budget'|'batch'|'minmax'

  // Toolbar settings
  const [stockRules, setStockRules] = useState({
    highMonths: 6,           // If stock covers >= X months, consider overstocked
    maxOrderReduction: 20,   // Max total order reduction % allowed
    lowMonths: 2,            // If stock covers <= X months, consider understocked
    targetCoverage: 3,       // Target months of coverage for understocked
    loading: false
  });
  const [velocitySettings, setVelocitySettings] = useState({
    coverageMonths: 6, velocityData: null, loading: false
  });
  const [budgetSettings, setBudgetSettings] = useState({
    brandAllocation: null, targetBudget: '', loading: false
  });
  const [batchOperation, setBatchOperation] = useState({
    type: 'increase_pct', value: 10
  });
  const [minMaxRules, setMinMaxRules] = useState({
    min: 0, max: ''
  });

  // Fetch filter options on mount
  useEffect(() => {
    const fetchFilters = async () => {
      try {
        const [seasonsRes, brandsRes, locationsRes] = await Promise.all([
          api.get('/seasons'),
          api.get('/brands'),
          api.get('/locations')
        ]);
        setSeasons(seasonsRes.data.seasons || []);
        setBrands(brandsRes.data.brands || []);
        setLocations(locationsRes.data.locations || []);

        // Auto-select first season if none selected
        if (!selectedSeasonId && seasonsRes.data.seasons?.length > 0) {
          setSearchParams({ season: seasonsRes.data.seasons[0].id.toString() });
        }
      } catch (err) {
        console.error('Error fetching filters:', err);
        setError('Failed to load filter options');
      }
    };
    fetchFilters();
  }, []);

  // Fetch ship dates when season/brand/location change
  useEffect(() => {
    if (selectedSeasonId) {
      fetchShipDates();
    } else {
      setShipDates([]);
    }
  }, [selectedSeasonId, selectedBrandId, selectedLocationId]);

  // Fetch brand allocation when season/brand change
  useEffect(() => {
    if (selectedSeasonId && selectedBrandId) {
      fetchBrandAllocation();
    } else {
      setBudgetSettings(prev => ({ ...prev, brandAllocation: null, targetBudget: '' }));
    }
  }, [selectedSeasonId, selectedBrandId]);

  const fetchBrandAllocation = async () => {
    try {
      const response = await budgetAPI.getSeasonBudget(selectedSeasonId);
      const allocations = response.data.allocations || [];
      const brandAlloc = allocations.find(a => a.brand_id === parseInt(selectedBrandId));
      if (brandAlloc) {
        setBudgetSettings(prev => ({
          ...prev,
          brandAllocation: brandAlloc.allocated_amount,
          targetBudget: brandAlloc.allocated_amount?.toString() || ''
        }));
      }
    } catch (err) {
      console.error('Error fetching brand allocation:', err);
    }
  };

  const fetchShipDates = async () => {
    try {
      const params = { seasonId: selectedSeasonId };
      if (selectedBrandId) params.brandId = selectedBrandId;
      if (selectedLocationId) params.locationId = selectedLocationId;

      const response = await orderAPI.getShipDates(params);
      setShipDates(response.data.shipDates || []);
    } catch (err) {
      console.error('Error fetching ship dates:', err);
    }
  };

  // Fetch inventory when filters change
  useEffect(() => {
    if (selectedSeasonId && selectedLocationId) {
      fetchInventory();
    } else {
      setInventory([]);
      setSummary(null);
    }
    // Clear suggestions and cached velocity data when filters change
    setSuggestions({});
    setSelectedItems(new Set());
    setVelocitySettings(prev => ({ ...prev, velocityData: null }));
  }, [selectedSeasonId, selectedBrandId, selectedLocationId, selectedShipDate]);

  const fetchInventory = async () => {
    setLoading(true);
    setError('');
    try {
      const params = { seasonId: selectedSeasonId };
      if (selectedBrandId) params.brandId = selectedBrandId;
      if (selectedLocationId) params.locationId = selectedLocationId;
      if (selectedShipDate) params.shipDate = selectedShipDate;

      const response = await orderAPI.getInventory(params);
      setInventory(response.data.inventory || []);
      setSummary(response.data.summary || null);
    } catch (err) {
      console.error('Error fetching inventory:', err);
      setError(err.response?.data?.error || 'Failed to load inventory');
      setInventory([]);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  };

  const updateFilter = (key, value) => {
    const newParams = new URLSearchParams(searchParams);
    if (value) {
      newParams.set(key, value);
    } else {
      newParams.delete(key);
    }
    setSearchParams(newParams);
  };

  const handleEditClick = (item) => {
    setEditingItemId(item.item_id);
    setEditValue(item.adjusted_quantity !== null ? item.adjusted_quantity.toString() : item.original_quantity.toString());
  };

  const handleEditCancel = () => {
    setEditingItemId(null);
    setEditValue('');
  };

  const handleEditSave = async (item) => {
    const newValue = editValue.trim() === '' ? null : parseInt(editValue, 10);
    const adjustedQty = newValue === item.original_quantity ? null : newValue;

    setSaving(true);
    try {
      await orderAPI.adjustItem(item.order_id, item.item_id, adjustedQty);
      updateLocalInventory(item.item_id, adjustedQty);
      setEditingItemId(null);
      setEditValue('');
    } catch (err) {
      console.error('Error saving adjustment:', err);
      setError('Failed to save adjustment');
    } finally {
      setSaving(false);
    }
  };

  const updateLocalInventory = (itemId, adjustedQty) => {
    setInventory(prev => prev.map(i =>
      i.item_id === itemId ? { ...i, adjusted_quantity: adjustedQty } : i
    ));
    recalculateSummary();
  };

  const recalculateSummary = () => {
    setInventory(currentInventory => {
      const newSummary = {
        totalItems: currentInventory.length,
        totalOriginalUnits: currentInventory.reduce((sum, i) => sum + parseInt(i.original_quantity || 0), 0),
        totalAdjustedUnits: currentInventory.reduce((sum, i) => {
          const qty = i.adjusted_quantity !== null ? i.adjusted_quantity : i.original_quantity;
          return sum + parseInt(qty || 0);
        }, 0),
        totalWholesale: currentInventory.reduce((sum, i) => {
          const qty = i.adjusted_quantity !== null ? i.adjusted_quantity : i.original_quantity;
          return sum + (parseFloat(i.unit_cost || 0) * parseInt(qty || 0));
        }, 0)
      };
      setSummary(newSummary);
      return currentInventory;
    });
  };

  const handleKeyDown = (e, item) => {
    if (e.key === 'Enter') {
      handleEditSave(item);
    } else if (e.key === 'Escape') {
      handleEditCancel();
    }
  };

  const formatPrice = (price) => {
    if (!price && price !== 0) return '-';
    return `$${parseFloat(price).toFixed(2)}`;
  };

  const getEffectiveQuantity = (item) => {
    return item.adjusted_quantity !== null ? item.adjusted_quantity : item.original_quantity;
  };

  const hasAdjustment = (item) => {
    return item.adjusted_quantity !== null && item.adjusted_quantity !== item.original_quantity;
  };

  const hasSuggestion = (item) => {
    return suggestions[item.item_id] !== undefined;
  };

  // Get suggestion display info comparing to ORIGINAL quantity
  const getSuggestionDisplay = (item) => {
    const suggested = suggestions[item.item_id];
    if (suggested === undefined) return null;

    const original = item.original_quantity;
    const diff = suggested - original;

    if (diff > 0) {
      return { value: suggested, diff: `+${diff}`, type: 'increase' };
    } else if (diff < 0) {
      return { value: suggested, diff: `${diff}`, type: 'decrease' };
    } else {
      return { value: suggested, diff: '=', type: 'same' };
    }
  };

  // Selection handlers
  const toggleSelectAll = () => {
    if (selectedItems.size === inventory.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(inventory.map(i => i.item_id)));
    }
  };

  const toggleSelectItem = (itemId) => {
    const newSelected = new Set(selectedItems);
    if (newSelected.has(itemId)) {
      newSelected.delete(itemId);
    } else {
      newSelected.add(itemId);
    }
    setSelectedItems(newSelected);
  };

  // Accept a suggestion for a single item
  const acceptSuggestion = async (item) => {
    const suggestedQty = suggestions[item.item_id];
    if (suggestedQty === undefined) return;

    const adjustedQty = suggestedQty === item.original_quantity ? null : suggestedQty;

    setSaving(true);
    try {
      await orderAPI.adjustItem(item.order_id, item.item_id, adjustedQty);
      updateLocalInventory(item.item_id, adjustedQty);
      // Remove from suggestions after accepting
      setSuggestions(prev => {
        const newSuggestions = { ...prev };
        delete newSuggestions[item.item_id];
        return newSuggestions;
      });
    } catch (err) {
      console.error('Error accepting suggestion:', err);
      setError('Failed to save adjustment');
    } finally {
      setSaving(false);
    }
  };

  // Save all suggestions
  const saveAllSuggestions = async () => {
    const itemsToSave = Object.entries(suggestions).filter(([itemId, qty]) => {
      const item = inventory.find(i => i.item_id === parseInt(itemId));
      return item && qty !== getEffectiveQuantity(item);
    });

    if (itemsToSave.length === 0) return;

    setSaving(true);
    try {
      const adjustments = itemsToSave.map(([itemId, qty]) => {
        const item = inventory.find(i => i.item_id === parseInt(itemId));
        return {
          orderId: item.order_id,
          itemId: parseInt(itemId),
          adjusted_quantity: qty === item.original_quantity ? null : qty
        };
      });

      // Use batch API if available, otherwise sequential
      if (orderAPI.batchAdjust) {
        await orderAPI.batchAdjust(adjustments);
      } else {
        for (const adj of adjustments) {
          await orderAPI.adjustItem(adj.orderId, adj.itemId, adj.adjusted_quantity);
        }
      }

      // Update local state
      setInventory(prev => prev.map(item => {
        const suggestion = suggestions[item.item_id];
        if (suggestion !== undefined) {
          return { ...item, adjusted_quantity: suggestion === item.original_quantity ? null : suggestion };
        }
        return item;
      }));

      setSuggestions({});
      recalculateSummary();
    } catch (err) {
      console.error('Error saving suggestions:', err);
      setError('Failed to save some adjustments');
    } finally {
      setSaving(false);
    }
  };

  // Reset suggestions
  const resetSuggestions = () => {
    setSuggestions({});
  };

  // Stock-based suggestions (using sales velocity)
  const applyStockRules = async () => {
    if (!selectedBrandId || !selectedSeasonId) {
      setError('Select a brand to apply stock rules');
      return;
    }

    setStockRules(prev => ({ ...prev, loading: true }));

    try {
      // Fetch velocity if not already loaded, or reuse existing
      let velocityData = velocitySettings.velocityData;
      if (!velocityData) {
        const response = await orderAPI.getVelocity({
          seasonId: selectedSeasonId,
          brandId: selectedBrandId,
          locationId: selectedLocationId || undefined,
          months: 12
        });
        velocityData = response.data.velocity || {};
        setVelocitySettings(prev => ({ ...prev, velocityData }));
      }

      // Calculate current order total
      const currentTotal = inventory.reduce((sum, item) => {
        const qty = suggestions[item.item_id] ?? getEffectiveQuantity(item);
        return sum + (parseFloat(item.unit_cost || 0) * qty);
      }, 0);

      const maxReductionValue = currentTotal * (stockRules.maxOrderReduction / 100);
      console.log('Stock Rules Debug:', {
        currentTotal,
        maxOrderReduction: stockRules.maxOrderReduction,
        maxReductionValue,
        highMonths: stockRules.highMonths
      });

      // Categorize items
      const overstocked = [];
      const understocked = [];

      inventory.forEach(item => {
        const stock = item.stock_on_hand;
        if (stock === null || stock === undefined || !item.upc) return;

        const velocity = velocityData[item.upc];
        const avgMonthlySales = velocity?.avg_monthly_sales || 0;
        if (avgMonthlySales <= 0) return;

        const monthsOfCoverage = stock / avgMonthlySales;
        const currentQty = suggestions[item.item_id] ?? getEffectiveQuantity(item);

        if (monthsOfCoverage >= stockRules.highMonths) {
          overstocked.push({ item, monthsOfCoverage, avgMonthlySales, currentQty });
        } else if (monthsOfCoverage <= stockRules.lowMonths) {
          understocked.push({ item, monthsOfCoverage, avgMonthlySales, currentQty });
        }
      });

      const newSuggestions = { ...suggestions };

      // OVERSTOCKED: Reduce as close to 0 as possible, but cap total reduction at maxOrderReduction%
      // Sort by most overstocked first (highest months of coverage)
      overstocked.sort((a, b) => b.monthsOfCoverage - a.monthsOfCoverage);

      let totalReduction = 0;
      console.log(`Found ${overstocked.length} overstocked items, ${understocked.length} understocked items`);

      for (const { item, currentQty, monthsOfCoverage } of overstocked) {
        const itemCost = parseFloat(item.unit_cost || 0);
        if (itemCost <= 0) continue;

        const remainingBudget = maxReductionValue - totalReduction;
        if (remainingBudget <= 0) {
          console.log(`Budget exhausted at $${totalReduction.toFixed(2)}, stopping reductions`);
          break;
        }

        // Calculate max units we can reduce within remaining budget
        const maxUnitsToReduce = Math.floor(remainingBudget / itemCost);
        const unitsToReduce = Math.min(currentQty, maxUnitsToReduce);

        const newQty = currentQty - unitsToReduce;
        newSuggestions[item.item_id] = newQty;
        totalReduction += unitsToReduce * itemCost;

        console.log(`Item ${item.product_name}: ${currentQty} -> ${newQty} (${monthsOfCoverage.toFixed(1)} mo coverage, reduced $${(unitsToReduce * itemCost).toFixed(2)})`);
      }

      console.log(`Total reduction: $${totalReduction.toFixed(2)} of max $${maxReductionValue.toFixed(2)} (${(totalReduction/currentTotal*100).toFixed(1)}% of order)`)

      // UNDERSTOCKED: Increase up to 100% of what's needed to reach target coverage
      for (const { item, avgMonthlySales, currentQty } of understocked) {
        const stock = item.stock_on_hand || 0;

        // Units needed to reach target months of coverage
        const targetStock = avgMonthlySales * stockRules.targetCoverage;
        const unitsNeeded = Math.max(0, Math.round(targetStock - stock));

        // Increase order by up to 100% of what's needed
        const newQty = currentQty + unitsNeeded;
        newSuggestions[item.item_id] = newQty;
      }

      setSuggestions(newSuggestions);
    } catch (err) {
      console.error('Error applying stock rules:', err);
      setError('Failed to fetch sales velocity for stock rules');
    } finally {
      setStockRules(prev => ({ ...prev, loading: false }));
    }
  };

  // Budget scaling
  const applyBudgetScaling = () => {
    const target = parseFloat(budgetSettings.targetBudget);
    if (!target || target <= 0) return;

    const currentTotal = inventory.reduce((sum, item) => {
      const qty = suggestions[item.item_id] ?? getEffectiveQuantity(item);
      return sum + (parseFloat(item.unit_cost || 0) * qty);
    }, 0);

    if (currentTotal === 0) return;

    const scaleFactor = target / currentTotal;
    const newSuggestions = { ...suggestions };

    inventory.forEach(item => {
      const baseQty = suggestions[item.item_id] ?? getEffectiveQuantity(item);
      newSuggestions[item.item_id] = Math.max(0, Math.round(baseQty * scaleFactor));
    });

    setSuggestions(newSuggestions);
  };

  // Batch operations
  const applyBatchOperation = () => {
    if (selectedItems.size === 0) return;

    const newSuggestions = { ...suggestions };
    const value = parseFloat(batchOperation.value) || 0;

    selectedItems.forEach(itemId => {
      const item = inventory.find(i => i.item_id === itemId);
      if (!item) return;

      const baseQty = suggestions[itemId] ?? getEffectiveQuantity(item);

      switch (batchOperation.type) {
        case 'increase_pct':
          newSuggestions[itemId] = Math.round(baseQty * (1 + value / 100));
          break;
        case 'decrease_pct':
          newSuggestions[itemId] = Math.max(0, Math.round(baseQty * (1 - value / 100)));
          break;
        case 'set_value':
          newSuggestions[itemId] = Math.max(0, Math.round(value));
          break;
      }
    });

    setSuggestions(newSuggestions);
  };

  // Sales velocity calculation
  const calculateVelocitySuggestions = async () => {
    if (!selectedBrandId || !selectedSeasonId) return;

    setVelocitySettings(prev => ({ ...prev, loading: true }));
    try {
      const response = await orderAPI.getVelocity({
        seasonId: selectedSeasonId,
        brandId: selectedBrandId,
        locationId: selectedLocationId || undefined,
        months: 12 // Always use 12 months of data for calculation
      });

      const velocityData = response.data.velocity || {};
      setVelocitySettings(prev => ({ ...prev, velocityData }));

      // Calculate suggestions based on velocity
      const newSuggestions = { ...suggestions };
      inventory.forEach(item => {
        if (!item.upc) return;

        const velocity = velocityData[item.upc];
        if (!velocity) return;

        const avgMonthlySales = velocity.avg_monthly_sales || 0;
        const stockOnHand = item.stock_on_hand || 0;
        const coverageNeeded = avgMonthlySales * velocitySettings.coverageMonths;

        // Suggest enough to cover the coverage period minus what's already in stock
        const suggested = Math.max(0, Math.round(coverageNeeded - stockOnHand));
        newSuggestions[item.item_id] = suggested;
      });

      setSuggestions(newSuggestions);
    } catch (err) {
      console.error('Error fetching velocity:', err);
      setError('Failed to calculate velocity suggestions');
    } finally {
      setVelocitySettings(prev => ({ ...prev, loading: false }));
    }
  };

  // Min/Max rules
  const applyMinMaxRules = () => {
    const minVal = parseInt(minMaxRules.min) || 0;
    const maxVal = minMaxRules.max ? parseInt(minMaxRules.max) : Infinity;

    const newSuggestions = { ...suggestions };

    inventory.forEach(item => {
      const baseQty = suggestions[item.item_id] ?? getEffectiveQuantity(item);
      const clipped = Math.max(minVal, Math.min(maxVal, baseQty));
      if (clipped !== baseQty) {
        newSuggestions[item.item_id] = clipped;
      }
    });

    setSuggestions(newSuggestions);
  };

  // Calculate suggested totals for display
  const suggestedTotal = inventory.reduce((sum, item) => {
    const qty = suggestions[item.item_id] ?? getEffectiveQuantity(item);
    return sum + (parseFloat(item.unit_cost || 0) * qty);
  }, 0);

  // Count suggestions that are different from original (actionable changes)
  const suggestionsCount = Object.keys(suggestions).filter(itemId => {
    const item = inventory.find(i => i.item_id === parseInt(itemId));
    return item && suggestions[itemId] !== item.original_quantity;
  }).length;

  return (
    <Layout>
      <div className="space-y-4">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Order Adjustment</h1>
          <p className="mt-1 text-sm text-gray-600">
            View and adjust order quantities by location.
          </p>
        </div>

        {/* Filters */}
        <div className="bg-white p-4 rounded-lg shadow">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label htmlFor="season" className="block text-sm font-medium text-gray-700 mb-1">Season</label>
              <select
                id="season"
                value={selectedSeasonId}
                onChange={(e) => updateFilter('season', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select Season</option>
                {seasons.map((season) => (
                  <option key={season.id} value={season.id}>{season.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="brand" className="block text-sm font-medium text-gray-700 mb-1">Brand</label>
              <select
                id="brand"
                value={selectedBrandId}
                onChange={(e) => updateFilter('brand', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All Brands</option>
                {brands.map((brand) => (
                  <option key={brand.id} value={brand.id}>{brand.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="location" className="block text-sm font-medium text-gray-700 mb-1">Location</label>
              <select
                id="location"
                value={selectedLocationId}
                onChange={(e) => updateFilter('location', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select Location</option>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>{location.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="shipDate" className="block text-sm font-medium text-gray-700 mb-1">Ship Date</label>
              <select
                id="shipDate"
                value={selectedShipDate}
                onChange={(e) => updateFilter('shipDate', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All Dates</option>
                {shipDates.map((date) => (
                  <option key={date} value={date}>
                    {new Date(date).toLocaleDateString('en-US', { year: 'numeric', month: 'short' })}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Summary Stats */}
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="bg-white p-3 rounded-lg shadow">
              <div className="text-xs text-gray-500">Items</div>
              <div className="text-xl font-bold text-gray-900">{summary.totalItems}</div>
            </div>
            <div className="bg-white p-3 rounded-lg shadow">
              <div className="text-xs text-gray-500">Original</div>
              <div className="text-xl font-bold text-gray-900">{summary.totalOriginalUnits}</div>
            </div>
            <div className="bg-white p-3 rounded-lg shadow">
              <div className="text-xs text-gray-500">Adjusted</div>
              <div className={`text-xl font-bold ${summary.totalAdjustedUnits !== summary.totalOriginalUnits ? 'text-blue-600' : 'text-gray-900'}`}>
                {summary.totalAdjustedUnits}
              </div>
            </div>
            <div className="bg-white p-3 rounded-lg shadow">
              <div className="text-xs text-gray-500">Current $</div>
              <div className="text-xl font-bold text-gray-900">{formatPrice(summary.totalWholesale)}</div>
            </div>
            {suggestionsCount > 0 && (
              <div className="bg-yellow-50 p-3 rounded-lg shadow border border-yellow-200">
                <div className="text-xs text-yellow-700">Suggested $</div>
                <div className="text-xl font-bold text-yellow-700">{formatPrice(suggestedTotal)}</div>
              </div>
            )}
          </div>
        )}

        {/* Adjustment Toolbar */}
        {inventory.length > 0 && (
          <div className="bg-white rounded-lg shadow">
            {/* Toolbar Tabs */}
            <div className="flex border-b overflow-x-auto">
              {[
                { id: 'stock', label: 'Stock Rules' },
                { id: 'velocity', label: 'Sales Velocity' },
                { id: 'budget', label: 'Budget' },
                { id: 'batch', label: 'Batch' },
                { id: 'minmax', label: 'Min/Max' }
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActivePanel(activePanel === tab.id ? null : tab.id)}
                  className={`px-4 py-2 text-sm font-medium whitespace-nowrap ${
                    activePanel === tab.id
                      ? 'border-b-2 border-blue-500 text-blue-600'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
              <div className="flex-1" />
              {suggestionsCount > 0 && (
                <>
                  <button
                    onClick={resetSuggestions}
                    className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700"
                  >
                    Reset
                  </button>
                  <button
                    onClick={saveAllSuggestions}
                    disabled={saving}
                    className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
                  >
                    Save All ({suggestionsCount})
                  </button>
                </>
              )}
            </div>

            {/* Panel Content */}
            {activePanel === 'stock' && (
              <div className="p-4 bg-gray-50 border-b">
                <div className="flex flex-wrap items-end gap-4">
                  <div className="border-r pr-4">
                    <div className="text-xs font-medium text-red-600 mb-2">Overstocked (reduce)</div>
                    <div className="flex items-end gap-2">
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">If coverage ≥</label>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            value={stockRules.highMonths}
                            onChange={(e) => setStockRules({ ...stockRules, highMonths: parseInt(e.target.value) || 0 })}
                            className="w-14 px-2 py-1 border rounded text-sm"
                          />
                          <span className="text-xs text-gray-500">mo</span>
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Max order cut</label>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            value={stockRules.maxOrderReduction}
                            onChange={(e) => setStockRules({ ...stockRules, maxOrderReduction: parseInt(e.target.value) || 0 })}
                            className="w-14 px-2 py-1 border rounded text-sm"
                          />
                          <span className="text-xs text-gray-500">%</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="pl-2">
                    <div className="text-xs font-medium text-green-600 mb-2">Understocked (increase)</div>
                    <div className="flex items-end gap-2">
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">If coverage ≤</label>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            value={stockRules.lowMonths}
                            onChange={(e) => setStockRules({ ...stockRules, lowMonths: parseInt(e.target.value) || 0 })}
                            className="w-14 px-2 py-1 border rounded text-sm"
                          />
                          <span className="text-xs text-gray-500">mo</span>
                        </div>
                      </div>
                      <div>
                        <label className="block text-xs text-gray-500 mb-1">Target coverage</label>
                        <div className="flex items-center gap-1">
                          <input
                            type="number"
                            value={stockRules.targetCoverage}
                            onChange={(e) => setStockRules({ ...stockRules, targetCoverage: parseInt(e.target.value) || 0 })}
                            className="w-14 px-2 py-1 border rounded text-sm"
                          />
                          <span className="text-xs text-gray-500">mo</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={applyStockRules}
                    disabled={stockRules.loading || !selectedBrandId}
                    className="px-4 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
                  >
                    {stockRules.loading ? 'Loading...' : 'Apply'}
                  </button>
                  {!selectedBrandId && (
                    <span className="text-xs text-orange-600">Select a brand first</span>
                  )}
                </div>
                <div className="mt-2 text-xs text-gray-500">
                  Overstocked items reduced to 0 (most overstocked first) until max order cut reached. Understocked items increased to reach target coverage.
                </div>
              </div>
            )}

            {activePanel === 'velocity' && (
              <div className="p-4 bg-gray-50 border-b">
                <div className="flex items-end gap-4">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Coverage Months</label>
                    <select
                      value={velocitySettings.coverageMonths}
                      onChange={(e) => setVelocitySettings({ ...velocitySettings, coverageMonths: parseInt(e.target.value) })}
                      className="px-2 py-1 border rounded text-sm"
                    >
                      <option value={3}>3 months</option>
                      <option value={6}>6 months</option>
                      <option value={9}>9 months</option>
                      <option value={12}>12 months</option>
                    </select>
                  </div>
                  <button
                    onClick={calculateVelocitySuggestions}
                    disabled={velocitySettings.loading || !selectedBrandId}
                    className="px-4 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
                  >
                    {velocitySettings.loading ? 'Loading...' : 'Calculate'}
                  </button>
                  <span className="text-xs text-gray-500">
                    Suggests: (avg monthly sales × months) - stock on hand
                  </span>
                  {!selectedBrandId && (
                    <span className="text-xs text-orange-600">Select a brand first</span>
                  )}
                </div>
              </div>
            )}

            {activePanel === 'budget' && (
              <div className="p-4 bg-gray-50 border-b">
                <div className="flex flex-wrap items-end gap-4">
                  {budgetSettings.brandAllocation && (
                    <div className="text-sm text-gray-600">
                      Brand Allocation: <span className="font-medium">{formatPrice(budgetSettings.brandAllocation)}</span>
                    </div>
                  )}
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Target Budget $</label>
                    <input
                      type="number"
                      value={budgetSettings.targetBudget}
                      onChange={(e) => setBudgetSettings({ ...budgetSettings, targetBudget: e.target.value })}
                      placeholder={budgetSettings.brandAllocation?.toString() || 'Enter amount'}
                      className="w-32 px-2 py-1 border rounded text-sm"
                    />
                  </div>
                  <div className="text-sm text-gray-600">
                    Current: <span className="font-medium">{formatPrice(suggestedTotal || summary?.totalWholesale)}</span>
                  </div>
                  <button
                    onClick={applyBudgetScaling}
                    className="px-4 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
                  >
                    Scale to Budget
                  </button>
                </div>
              </div>
            )}

            {activePanel === 'batch' && (
              <div className="p-4 bg-gray-50 border-b">
                <div className="flex flex-wrap items-end gap-4">
                  <div className="text-sm text-gray-600">
                    {selectedItems.size} items selected
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Operation</label>
                    <select
                      value={batchOperation.type}
                      onChange={(e) => setBatchOperation({ ...batchOperation, type: e.target.value })}
                      className="px-2 py-1 border rounded text-sm"
                    >
                      <option value="increase_pct">Increase %</option>
                      <option value="decrease_pct">Decrease %</option>
                      <option value="set_value">Set to value</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">
                      {batchOperation.type === 'set_value' ? 'Quantity' : 'Percent'}
                    </label>
                    <input
                      type="number"
                      value={batchOperation.value}
                      onChange={(e) => setBatchOperation({ ...batchOperation, value: e.target.value })}
                      className="w-20 px-2 py-1 border rounded text-sm"
                    />
                  </div>
                  <button
                    onClick={applyBatchOperation}
                    disabled={selectedItems.size === 0}
                    className="px-4 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
                  >
                    Apply to Selected
                  </button>
                </div>
              </div>
            )}

            {activePanel === 'minmax' && (
              <div className="p-4 bg-gray-50 border-b">
                <div className="flex items-end gap-4">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Minimum Qty</label>
                    <input
                      type="number"
                      value={minMaxRules.min}
                      onChange={(e) => setMinMaxRules({ ...minMaxRules, min: e.target.value })}
                      className="w-20 px-2 py-1 border rounded text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Maximum Qty</label>
                    <input
                      type="number"
                      value={minMaxRules.max}
                      onChange={(e) => setMinMaxRules({ ...minMaxRules, max: e.target.value })}
                      placeholder="No limit"
                      className="w-20 px-2 py-1 border rounded text-sm"
                    />
                  </div>
                  <button
                    onClick={applyMinMaxRules}
                    className="px-4 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
                  >
                    Apply Min/Max
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-md p-4">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="flex justify-center items-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
        )}

        {/* No Location Selected */}
        {!loading && !selectedLocationId && selectedSeasonId && (
          <div className="bg-yellow-50 rounded-lg p-8 text-center">
            <h3 className="text-sm font-medium text-gray-900">Select a Location</h3>
            <p className="mt-1 text-sm text-gray-500">Choose a location to view and adjust order quantities.</p>
          </div>
        )}

        {/* No Results */}
        {!loading && selectedLocationId && inventory.length === 0 && (
          <div className="bg-gray-50 rounded-lg p-12 text-center">
            <h3 className="text-sm font-medium text-gray-900">No order items found</h3>
            <p className="mt-1 text-sm text-gray-500">No orders exist for this selection.</p>
          </div>
        )}

        {/* Inventory Table */}
        {!loading && inventory.length > 0 && (
          <div className="bg-white shadow rounded-lg overflow-hidden">
            {/* Legend */}
            <div className="px-4 py-2 bg-gray-50 border-b flex items-center gap-6 text-xs">
              <span className="text-gray-500 font-medium">Suggestion Legend:</span>
              <span className="flex items-center gap-1">
                <span className="inline-block w-6 text-center bg-green-500 text-white rounded px-1 font-bold">5</span>
                <span className="text-gray-600">= Order more than original</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block w-6 text-center bg-red-500 text-white rounded px-1 font-bold">2</span>
                <span className="text-gray-600">= Order less than original</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block w-4 text-center text-gray-400">=</span>
                <span className="text-gray-600">= No change needed</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block w-4 text-center text-gray-300">-</span>
                <span className="text-gray-600">= No sales data</span>
              </span>
            </div>
            <table className="w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-2 py-2 text-center">
                    <input
                      type="checkbox"
                      checked={selectedItems.size === inventory.length && inventory.length > 0}
                      onChange={toggleSelectAll}
                      className="rounded border-gray-300"
                    />
                  </th>
                  <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase">Product</th>
                  <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase">Size</th>
                  <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase">Color</th>
                  <th className="px-2 py-2 text-center text-xs font-medium text-gray-500 uppercase">Orig</th>
                  <th className="px-2 py-2 text-center text-xs font-medium text-gray-500 uppercase">Stock</th>
                  <th className="px-2 py-2 text-center text-xs font-medium text-gray-500 uppercase">Sugg</th>
                  <th className="px-2 py-2 text-center text-xs font-medium text-gray-500 uppercase">Adj</th>
                  <th className="px-2 py-2 text-right text-xs font-medium text-gray-500 uppercase">Cost</th>
                  <th className="px-2 py-2 text-right text-xs font-medium text-gray-500 uppercase">Total</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {inventory.map((item) => (
                  <tr key={item.item_id} className={`hover:bg-gray-50 ${hasAdjustment(item) ? 'bg-blue-50' : ''} ${selectedItems.has(item.item_id) ? 'bg-yellow-50' : ''}`}>
                    <td className="px-2 py-1.5 text-center">
                      <input
                        type="checkbox"
                        checked={selectedItems.has(item.item_id)}
                        onChange={() => toggleSelectItem(item.item_id)}
                        className="rounded border-gray-300"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="font-medium text-gray-900 truncate max-w-[180px]" title={item.product_name}>
                        {item.product_name}
                      </div>
                    </td>
                    <td className="px-2 py-1.5 text-gray-900">
                      {item.size || '-'}{item.inseam && `/${item.inseam}`}
                    </td>
                    <td className="px-2 py-1.5 text-gray-700 truncate max-w-[80px]" title={item.color}>
                      {item.color || '-'}
                    </td>
                    <td className="px-2 py-1.5 text-center text-gray-500">
                      {item.original_quantity}
                    </td>
                    <td className="px-2 py-1.5 text-center text-gray-500">
                      {item.stock_on_hand !== null ? item.stock_on_hand : '-'}
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      {(() => {
                        const display = getSuggestionDisplay(item);
                        if (!display) {
                          return <span className="text-gray-300">-</span>;
                        }
                        if (display.type === 'same') {
                          return <span className="text-gray-400" title="No change from original">=</span>;
                        }
                        return (
                          <button
                            onClick={() => acceptSuggestion(item)}
                            className={`px-2 py-0.5 rounded text-xs font-bold ${
                              display.type === 'increase'
                                ? 'bg-green-500 text-white hover:bg-green-600'
                                : 'bg-red-500 text-white hover:bg-red-600'
                            }`}
                            title={`${display.diff} from original (${item.original_quantity}). Click to accept.`}
                          >
                            {display.value}
                          </button>
                        );
                      })()}
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      {editingItemId === item.item_id ? (
                        <input
                          type="number"
                          min="0"
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onBlur={() => handleEditSave(item)}
                          onKeyDown={(e) => handleKeyDown(e, item)}
                          className="w-14 px-1 py-0.5 text-center border border-blue-500 rounded text-sm"
                          autoFocus
                          disabled={saving}
                        />
                      ) : (
                        <button
                          onClick={() => handleEditClick(item)}
                          className={`px-2 py-0.5 rounded font-medium ${
                            hasAdjustment(item)
                              ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                          }`}
                        >
                          {getEffectiveQuantity(item)}
                        </button>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right text-gray-900">
                      {formatPrice(item.unit_cost)}
                    </td>
                    <td className="px-2 py-1.5 text-right font-medium text-gray-900">
                      {formatPrice(parseFloat(item.unit_cost || 0) * getEffectiveQuantity(item))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Layout>
  );
};

export default OrderAdjustment;
