import { useState, useEffect, useRef } from 'react';
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

  // Add Items panel state
  const [availableProducts, setAvailableProducts] = useState([]);
  const [availableLoading, setAvailableLoading] = useState(false);
  const [expandedFamilies, setExpandedFamilies] = useState(new Set());
  const [addQuantities, setAddQuantities] = useState({});
  const [activeAddProductId, setActiveAddProductId] = useState(null);

  // Add Items filter state
  const [addItemsFilters, setAddItemsFilters] = useState({
    categories: [], // Changed to array for multi-select
    sizes: [], // Array for multi-select sizes
    gender: '',
    hasSalesHistory: false,
    includeWithStock: false,
    hasInventoryData: false
  });
  const [availableFilters, setAvailableFilters] = useState({ categories: [], genders: [], sizes: [] });
  const [showCategoryDropdown, setShowCategoryDropdown] = useState(false);
  const [showSizeDropdown, setShowSizeDropdown] = useState(false);
  const [selectedFamilies, setSelectedFamilies] = useState(new Set());
  const [selectedProducts, setSelectedProducts] = useState(new Set()); // For bulk add within families
  const [bulkAddQty, setBulkAddQty] = useState(1); // Default qty for bulk add
  const categoryDropdownRef = useRef(null);
  const sizeDropdownRef = useRef(null);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (categoryDropdownRef.current && !categoryDropdownRef.current.contains(event.target)) {
        setShowCategoryDropdown(false);
      }
      if (sizeDropdownRef.current && !sizeDropdownRef.current.contains(event.target)) {
        setShowSizeDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Order finalization state
  const [currentOrder, setCurrentOrder] = useState(null);
  const [finalizing, setFinalizing] = useState(false);

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
      setCurrentOrder(null);
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
      const inv = response.data.inventory || [];
      setInventory(inv);
      setSummary(response.data.summary || null);

      // Check if all items belong to a single order
      const orderIds = [...new Set(inv.map(i => i.order_id))];
      if (orderIds.length === 1 && orderIds[0]) {
        // Fetch full order details including finalized_at
        const orderRes = await orderAPI.getById(orderIds[0]);
        setCurrentOrder(orderRes.data.order);
      } else {
        setCurrentOrder(null);
      }
    } catch (err) {
      console.error('Error fetching inventory:', err);
      setError(err.response?.data?.error || 'Failed to load inventory');
      setInventory([]);
      setSummary(null);
      setCurrentOrder(null);
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
        totalOriginalWholesale: currentInventory.reduce((sum, i) => {
          return sum + (parseFloat(i.unit_cost || 0) * parseInt(i.original_quantity || 0));
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

  const handleKeyDown = async (e, item) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      await handleEditSave(item);
      // Move to next item in the list
      const currentIndex = inventory.findIndex(i => i.item_id === item.item_id);
      if (currentIndex >= 0 && currentIndex < inventory.length - 1) {
        const nextItem = inventory[currentIndex + 1];
        setEditingItemId(nextItem.item_id);
        setEditValue(nextItem.adjusted_quantity !== null ? nextItem.adjusted_quantity.toString() : nextItem.original_quantity.toString());
      } else {
        // Last item, just close editing
        setEditingItemId(null);
      }
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

      // Calculate ORIGINAL order total (not suggestions) for consistent budget calculation
      const originalTotal = inventory.reduce((sum, item) => {
        const qty = item.original_quantity || 0;
        return sum + (parseFloat(item.unit_cost || 0) * qty);
      }, 0);

      const maxReductionValue = originalTotal * (stockRules.maxOrderReduction / 100);
      console.log('Stock Rules - Using ORIGINAL order total:', {
        originalTotal,
        maxOrderReduction: stockRules.maxOrderReduction,
        maxReductionValue,
        highMonths: stockRules.highMonths,
        lowMonths: stockRules.lowMonths
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

        if (monthsOfCoverage >= stockRules.highMonths) {
          overstocked.push({ item, monthsOfCoverage, avgMonthlySales });
        } else if (monthsOfCoverage <= stockRules.lowMonths) {
          understocked.push({ item, monthsOfCoverage, avgMonthlySales });
        }
      });

      // Start fresh - don't stack on previous suggestions
      const newSuggestions = {};

      // OVERSTOCKED: Reduce as close to 0 as possible, but cap total reduction at maxOrderReduction%
      // Sort by most overstocked first (highest months of coverage)
      overstocked.sort((a, b) => b.monthsOfCoverage - a.monthsOfCoverage);

      let totalReduction = 0;
      let skippedZeroQty = 0;
      console.log(`Found ${overstocked.length} overstocked items, ${understocked.length} understocked items`);

      for (const { item, monthsOfCoverage } of overstocked) {
        // Use ORIGINAL quantity, not suggestion - we want to reduce from original order
        const originalQty = item.original_quantity || 0;
        const itemCost = parseFloat(item.unit_cost || 0);

        if (originalQty <= 0) {
          skippedZeroQty++;
          continue; // Can't reduce items that weren't ordered
        }
        if (itemCost <= 0) continue;

        const remainingBudget = maxReductionValue - totalReduction;
        if (remainingBudget <= 0) {
          console.log(`Budget exhausted at $${totalReduction.toFixed(2)}, stopping reductions`);
          break;
        }

        // Calculate max units we can reduce within remaining budget
        const maxUnitsToReduce = Math.floor(remainingBudget / itemCost);
        const unitsToReduce = Math.min(originalQty, maxUnitsToReduce);

        const newQty = originalQty - unitsToReduce;
        newSuggestions[item.item_id] = newQty;
        totalReduction += unitsToReduce * itemCost;

        console.log(`Item ${item.product_name}: ${originalQty} -> ${newQty} (${monthsOfCoverage.toFixed(1)} mo coverage, reduced $${(unitsToReduce * itemCost).toFixed(2)})`);
      }

      if (skippedZeroQty > 0) {
        console.log(`Skipped ${skippedZeroQty} overstocked items with 0 order quantity`);
      }
      console.log(`Total reduction: $${totalReduction.toFixed(2)} of max $${maxReductionValue.toFixed(2)} (${(totalReduction/originalTotal*100).toFixed(1)}% of order)`)

      // UNDERSTOCKED: Increase to reach target coverage (based on original qty)
      for (const { item, avgMonthlySales } of understocked) {
        const originalQty = item.original_quantity || 0;
        const stock = item.stock_on_hand || 0;

        // Units needed to reach target months of coverage
        const targetStock = avgMonthlySales * stockRules.targetCoverage;
        const unitsNeeded = Math.max(0, Math.round(targetStock - stock));

        // New qty is original + what's needed (not stacking)
        const newQty = originalQty + unitsNeeded;
        newSuggestions[item.item_id] = newQty;
        console.log(`Item ${item.product_name}: ${originalQty} -> ${newQty} (need ${unitsNeeded} to reach ${stockRules.targetCoverage} mo coverage)`);
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

  // Fetch filter options for Add Items panel
  const fetchAvailableFilters = async () => {
    if (!selectedSeasonId || !selectedBrandId) return;

    try {
      const response = await orderAPI.getAvailableProductFilters({
        seasonId: selectedSeasonId,
        brandId: selectedBrandId
      });
      setAvailableFilters({
        categories: response.data.categories || [],
        genders: response.data.genders || [],
        sizes: response.data.sizes || []
      });
    } catch (err) {
      console.error('Error fetching available filters:', err);
    }
  };

  // Fetch available products (with optional filters)
  const fetchAvailableProducts = async () => {
    if (!selectedSeasonId || !selectedBrandId || !selectedLocationId) return;

    setAvailableLoading(true);
    try {
      const response = await orderAPI.getAvailableProducts({
        seasonId: selectedSeasonId,
        brandId: selectedBrandId,
        locationId: selectedLocationId,
        shipDate: selectedShipDate || undefined,
        categories: addItemsFilters.categories.length > 0 ? addItemsFilters.categories.join(',') : undefined,
        sizes: addItemsFilters.sizes.length > 0 ? addItemsFilters.sizes.join(',') : undefined,
        gender: addItemsFilters.gender || undefined,
        hasSalesHistory: addItemsFilters.hasSalesHistory || undefined,
        includeWithStock: addItemsFilters.includeWithStock || undefined,
        hasInventoryData: addItemsFilters.hasInventoryData || undefined
      });
      setAvailableProducts(response.data.families || []);
    } catch (err) {
      console.error('Error fetching available products:', err);
      setError('Failed to load available products');
    } finally {
      setAvailableLoading(false);
    }
  };

  // Toggle family expansion
  const toggleFamily = (baseName) => {
    setExpandedFamilies(prev => {
      const newSet = new Set(prev);
      if (newSet.has(baseName)) {
        newSet.delete(baseName);
      } else {
        newSet.add(baseName);
      }
      return newSet;
    });
  };

  // Add single item to order
  const addItemToOrder = async (product) => {
    const qty = addQuantities[product.id] || 1;
    const orderId = inventory[0]?.order_id;

    if (!orderId) {
      setError('No order found for this location');
      return;
    }

    setSaving(true);
    try {
      const response = await orderAPI.addItem(orderId, {
        product_id: product.id,
        quantity: qty,
        unit_price: product.wholesale_cost,
        is_addition: true  // Mark as addition so it doesn't count toward Original $
      });

      // Clear the quantity input for this product
      setAddQuantities(prev => {
        const newQtys = { ...prev };
        delete newQtys[product.id];
        return newQtys;
      });

      // Remove product from available list locally (no refetch needed)
      setAvailableProducts(prev => {
        return prev.map(family => ({
          ...family,
          products: family.products.filter(p => p.id !== product.id)
        })).filter(family => family.products.length > 0);
      });

      // Add new item to inventory locally
      // Added items have original_quantity=0 and adjusted_quantity=qty
      const newItem = response.data.item;
      if (newItem) {
        setInventory(prev => [...prev, {
          item_id: newItem.id,
          order_id: newItem.order_id,
          product_id: newItem.product_id,
          original_quantity: 0,  // Addition - doesn't count toward Original $
          adjusted_quantity: qty,  // The quantity user entered
          unit_cost: newItem.unit_cost,
          line_total: newItem.line_total,
          product_name: product.name,
          base_name: product.base_name,
          upc: product.upc,
          size: product.size,
          color: product.color,
          inseam: product.inseam,
          stock_on_hand: 0
        }]);
        recalculateSummary();
      }
    } catch (err) {
      console.error('Error adding item:', err);
      setError('Failed to add item to order');
    } finally {
      setSaving(false);
    }
  };

  // Bulk add selected products within families
  const addSelectedProducts = async () => {
    if (selectedProducts.size === 0) return;

    const orderId = inventory[0]?.order_id;
    if (!orderId) {
      setError('No order found for this location');
      return;
    }

    setSaving(true);
    const addedProductIds = [];
    const newItems = [];

    try {
      // Get all products to add
      const productsToAdd = availableProducts.flatMap(family =>
        family.products.filter(p => selectedProducts.has(p.id))
      );

      for (const product of productsToAdd) {
        const qty = addQuantities[product.id] || bulkAddQty;
        try {
          const response = await orderAPI.addItem(orderId, {
            product_id: product.id,
            quantity: qty,
            unit_price: product.wholesale_cost,
            is_addition: true
          });

          addedProductIds.push(product.id);

          const newItem = response.data.item;
          if (newItem) {
            newItems.push({
              item_id: newItem.id,
              order_id: newItem.order_id,
              product_id: newItem.product_id,
              original_quantity: 0,
              adjusted_quantity: qty,
              unit_cost: newItem.unit_cost,
              line_total: newItem.line_total,
              product_name: product.name,
              base_name: product.base_name,
              upc: product.upc,
              size: product.size,
              color: product.color,
              inseam: product.inseam,
              stock_on_hand: 0
            });
          }
        } catch (err) {
          console.error(`Error adding product ${product.id}:`, err);
        }
      }

      // Remove added products from available list
      if (addedProductIds.length > 0) {
        setAvailableProducts(prev =>
          prev.map(family => ({
            ...family,
            products: family.products.filter(p => !addedProductIds.includes(p.id))
          })).filter(family => family.products.length > 0)
        );

        // Clear quantities for added products
        setAddQuantities(prev => {
          const newQtys = { ...prev };
          addedProductIds.forEach(id => delete newQtys[id]);
          return newQtys;
        });

        // Clear selection
        setSelectedProducts(new Set());

        // Add new items to inventory
        if (newItems.length > 0) {
          setInventory(prev => [...prev, ...newItems]);
          recalculateSummary();
        }
      }
    } catch (err) {
      console.error('Error in bulk add:', err);
      setError('Failed to add some items');
    } finally {
      setSaving(false);
    }
  };

  // Bulk add all products from selected families
  const addAllSelectedFamilies = async () => {
    if (selectedFamilies.size === 0) return;

    const orderId = inventory[0]?.order_id;
    if (!orderId) {
      setError('No order found for this location');
      return;
    }

    setSaving(true);
    const addedProductIds = [];
    const newItems = [];

    try {
      // Get all products from selected families
      const productsToAdd = availableProducts
        .filter(family => selectedFamilies.has(family.base_name))
        .flatMap(family => family.products);

      for (const product of productsToAdd) {
        const qty = bulkAddQty;
        try {
          const response = await orderAPI.addItem(orderId, {
            product_id: product.id,
            quantity: qty,
            unit_price: product.wholesale_cost,
            is_addition: true
          });

          addedProductIds.push(product.id);

          const newItem = response.data.item;
          if (newItem) {
            newItems.push({
              item_id: newItem.id,
              order_id: newItem.order_id,
              product_id: newItem.product_id,
              original_quantity: 0,
              adjusted_quantity: qty,
              unit_cost: newItem.unit_cost,
              line_total: newItem.line_total,
              product_name: product.name,
              base_name: product.base_name,
              upc: product.upc,
              size: product.size,
              color: product.color,
              inseam: product.inseam,
              stock_on_hand: 0
            });
          }
        } catch (err) {
          console.error(`Error adding product ${product.id}:`, err);
        }
      }

      // Remove added products from available list
      if (addedProductIds.length > 0) {
        setAvailableProducts(prev =>
          prev.map(family => ({
            ...family,
            products: family.products.filter(p => !addedProductIds.includes(p.id))
          })).filter(family => family.products.length > 0)
        );

        // Clear selection
        setSelectedFamilies(new Set());
        setSelectedProducts(new Set());

        // Add new items to inventory
        if (newItems.length > 0) {
          setInventory(prev => [...prev, ...newItems]);
          recalculateSummary();
        }
      }
    } catch (err) {
      console.error('Error in bulk add families:', err);
      setError('Failed to add some items');
    } finally {
      setSaving(false);
    }
  };

  // Toggle product selection within family
  const toggleProductSelection = (productId) => {
    setSelectedProducts(prev => {
      const newSet = new Set(prev);
      if (newSet.has(productId)) {
        newSet.delete(productId);
      } else {
        newSet.add(productId);
      }
      return newSet;
    });
  };

  // Select/deselect all products in a family
  const toggleSelectAllInFamily = (family) => {
    const familyProductIds = family.products.map(p => p.id);
    const allSelected = familyProductIds.every(id => selectedProducts.has(id));

    setSelectedProducts(prev => {
      const newSet = new Set(prev);
      if (allSelected) {
        familyProductIds.forEach(id => newSet.delete(id));
      } else {
        familyProductIds.forEach(id => newSet.add(id));
      }
      return newSet;
    });
  };

  // Get flat list of all products for navigation
  const getAllAddProducts = () => {
    return availableProducts.flatMap(family =>
      expandedFamilies.has(family.base_name) ? family.products : []
    );
  };

  // Handle Enter key in Add Items quantity input
  const handleAddItemKeyDown = async (e, product) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const allProducts = getAllAddProducts();
      const currentIndex = allProducts.findIndex(p => p.id === product.id);

      // Add the current item
      await addItemToOrder(product);

      // After adding, find next product (list will have shifted)
      const updatedProducts = getAllAddProducts();
      if (updatedProducts.length > 0) {
        // Try to focus same index or last available
        const nextProduct = updatedProducts[Math.min(currentIndex, updatedProducts.length - 1)];
        if (nextProduct) {
          setActiveAddProductId(nextProduct.id);
          // Focus the input after state update
          setTimeout(() => {
            const input = document.getElementById(`add-qty-${nextProduct.id}`);
            if (input) input.focus();
          }, 50);
        }
      }
    } else if (e.key === 'Escape') {
      e.target.blur();
    }
  };

  // Ignore a product from future add suggestions (globally for this brand)
  const ignoreProduct = async (product) => {
    try {
      await orderAPI.ignoreProduct({
        productId: product.id,
        brandId: selectedBrandId
        // No locationId = global ignore for this brand
      });

      // Remove from available list locally
      setAvailableProducts(prev => {
        return prev.map(family => ({
          ...family,
          products: family.products.filter(p => p.id !== product.id)
        })).filter(family => family.products.length > 0);
      });
    } catch (err) {
      console.error('Error ignoring product:', err);
      setError('Failed to ignore product');
    }
  };

  // Finalize order for export
  const finalizeOrder = async () => {
    if (!currentOrder) return;

    setFinalizing(true);
    try {
      const response = await orderAPI.finalize(currentOrder.id);
      // Update current order with new finalized_at timestamp
      setCurrentOrder(prev => ({
        ...prev,
        finalized_at: response.data.order.finalized_at
      }));
    } catch (err) {
      console.error('Error finalizing order:', err);
      setError('Failed to finalize order');
    } finally {
      setFinalizing(false);
    }
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

  // Split inventory into original items and added items
  const originalItems = inventory.filter(item => item.original_quantity > 0);
  const addedItems = inventory.filter(item => item.original_quantity === 0);

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
                {shipDates.map((date) => {
                  // Parse date string and display in UTC to avoid timezone issues
                  const d = new Date(date);
                  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                  const label = `${monthNames[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
                  return (
                    <option key={date} value={date}>
                      {label}
                    </option>
                  );
                })}
              </select>
            </div>
          </div>
        </div>

        {/* Summary Stats */}
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
            <div className="bg-white p-3 rounded-lg shadow">
              <div className="text-xs text-gray-500">Items</div>
              <div className="text-xl font-bold text-gray-900">{summary.totalItems}</div>
            </div>
            <div className="bg-white p-3 rounded-lg shadow">
              <div className="text-xs text-gray-500">Orig Units</div>
              <div className="text-xl font-bold text-gray-900">{summary.totalOriginalUnits}</div>
            </div>
            <div className="bg-white p-3 rounded-lg shadow">
              <div className="text-xs text-gray-500">Adj Units</div>
              <div className={`text-xl font-bold ${summary.totalAdjustedUnits !== summary.totalOriginalUnits ? 'text-blue-600' : 'text-gray-900'}`}>
                {summary.totalAdjustedUnits}
              </div>
            </div>
            <div className="bg-white p-3 rounded-lg shadow">
              <div className="text-xs text-gray-500">Original $</div>
              <div className="text-xl font-bold text-gray-900">{formatPrice(summary.totalOriginalWholesale)}</div>
            </div>
            {(() => {
              // Calculate added items total (items with original_quantity = 0)
              const addedTotal = inventory
                .filter(i => i.original_quantity === 0 && i.adjusted_quantity > 0)
                .reduce((sum, i) => sum + (parseFloat(i.unit_cost || 0) * i.adjusted_quantity), 0);
              if (addedTotal > 0) {
                return (
                  <div className="bg-green-50 p-3 rounded-lg shadow border border-green-200">
                    <div className="text-xs text-green-700">Added $</div>
                    <div className="text-xl font-bold text-green-700">{formatPrice(addedTotal)}</div>
                  </div>
                );
              }
              return null;
            })()}
            <div className="bg-white p-3 rounded-lg shadow">
              <div className="text-xs text-gray-500">Current $</div>
              <div className={`text-xl font-bold ${summary.totalWholesale !== summary.totalOriginalWholesale ? 'text-blue-600' : 'text-gray-900'}`}>
                {formatPrice(summary.totalWholesale)}
              </div>
            </div>
            {summary.totalOriginalWholesale > 0 && summary.totalWholesale !== summary.totalOriginalWholesale && (
              <div className="bg-white p-3 rounded-lg shadow">
                <div className="text-xs text-gray-500">Change</div>
                {(() => {
                  const pctChange = ((summary.totalWholesale - summary.totalOriginalWholesale) / summary.totalOriginalWholesale) * 100;
                  const isPositive = pctChange > 0;
                  return (
                    <div className={`text-xl font-bold ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
                      {isPositive ? '+' : ''}{pctChange.toFixed(1)}%
                    </div>
                  );
                })()}
              </div>
            )}
            {suggestionsCount > 0 && (
              <div className="bg-yellow-50 p-3 rounded-lg shadow border border-yellow-200">
                <div className="text-xs text-yellow-700">Suggested $</div>
                <div className="text-xl font-bold text-yellow-700">{formatPrice(suggestedTotal)}</div>
              </div>
            )}
          </div>
        )}

        {/* Finalize Section */}
        {currentOrder && (
          <div className="bg-white p-4 rounded-lg shadow flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div>
                <span className="text-sm text-gray-500">Order:</span>
                <span className="ml-2 font-medium text-gray-900">{currentOrder.order_number}</span>
              </div>
              {currentOrder.finalized_at && (
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                    ✓ Finalized
                  </span>
                  <span className="text-xs text-gray-500">
                    {new Date(currentOrder.finalized_at).toLocaleString()}
                  </span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={finalizeOrder}
                disabled={finalizing}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  currentOrder.finalized_at
                    ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    : 'bg-blue-600 text-white hover:bg-blue-700'
                } disabled:opacity-50`}
              >
                {finalizing ? 'Finalizing...' : currentOrder.finalized_at ? 'Re-finalize' : 'Finalize for Export'}
              </button>
              <a
                href={`/export-center?season=${selectedSeasonId}&brand=${selectedBrandId}`}
                className="px-4 py-2 text-sm text-blue-600 hover:text-blue-800 hover:underline"
              >
                View Export Center →
              </a>
            </div>
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
                { id: 'minmax', label: 'Min/Max' },
                { id: 'add', label: '+ Add Items' }
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => {
                    const newPanel = activePanel === tab.id ? null : tab.id;
                    setActivePanel(newPanel);
                    // Fetch available products and filters when opening Add Items panel
                    if (newPanel === 'add' && selectedBrandId) {
                      fetchAvailableFilters();
                      fetchAvailableProducts();
                    }
                  }}
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

            {activePanel === 'add' && (
              <div className="bg-gray-50 border-b max-h-96 overflow-y-auto">
                {!selectedBrandId ? (
                  <div className="text-center py-4 text-orange-600">
                    Select a brand to view available items
                  </div>
                ) : (
                  <>
                    {/* Filter Controls - Sticky */}
                    <div className="sticky top-0 z-20 bg-gray-50 px-4 pt-4 pb-3 border-b flex flex-wrap items-center gap-3">
                      {/* Category multi-select dropdown */}
                      <div className="relative" ref={categoryDropdownRef}>
                        <button
                          type="button"
                          onClick={() => setShowCategoryDropdown(prev => !prev)}
                          className="px-2 py-1 text-sm border rounded bg-white flex items-center gap-2 min-w-[140px]"
                        >
                          <span>
                            {addItemsFilters.categories.length === 0
                              ? 'All Categories'
                              : `${addItemsFilters.categories.length} selected`}
                          </span>
                          <span className="ml-auto">▼</span>
                        </button>
                        {showCategoryDropdown && (
                          <div className="absolute z-10 mt-1 bg-white border rounded shadow-lg max-h-60 overflow-y-auto min-w-[180px]">
                            <div className="p-2 border-b flex gap-3">
                              <button
                                type="button"
                                onClick={() => setAddItemsFilters(prev => ({ ...prev, categories: [...availableFilters.categories] }))}
                                className="text-xs text-blue-600 hover:underline"
                              >
                                Select all
                              </button>
                              <button
                                type="button"
                                onClick={() => setAddItemsFilters(prev => ({ ...prev, categories: [] }))}
                                className="text-xs text-blue-600 hover:underline"
                              >
                                Clear all
                              </button>
                            </div>
                            {availableFilters.categories.map(cat => (
                              <label key={cat} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={addItemsFilters.categories.includes(cat)}
                                  onChange={(e) => {
                                    setAddItemsFilters(prev => ({
                                      ...prev,
                                      categories: e.target.checked
                                        ? [...prev.categories, cat]
                                        : prev.categories.filter(c => c !== cat)
                                    }));
                                  }}
                                  className="rounded"
                                />
                                <span className="text-sm">{cat}</span>
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                      {/* Size multi-select dropdown */}
                      <div className="relative" ref={sizeDropdownRef}>
                        <button
                          type="button"
                          onClick={() => setShowSizeDropdown(prev => !prev)}
                          className="px-2 py-1 text-sm border rounded bg-white flex items-center gap-2 min-w-[120px]"
                        >
                          <span>
                            {addItemsFilters.sizes.length === 0
                              ? 'All Sizes'
                              : `${addItemsFilters.sizes.length} selected`}
                          </span>
                          <span className="ml-auto">▼</span>
                        </button>
                        {showSizeDropdown && (
                          <div className="absolute z-10 mt-1 bg-white border rounded shadow-lg max-h-60 overflow-y-auto min-w-[140px]">
                            <div className="p-2 border-b flex gap-3">
                              <button
                                type="button"
                                onClick={() => setAddItemsFilters(prev => ({ ...prev, sizes: [...availableFilters.sizes] }))}
                                className="text-xs text-blue-600 hover:underline"
                              >
                                Select all
                              </button>
                              <button
                                type="button"
                                onClick={() => setAddItemsFilters(prev => ({ ...prev, sizes: [] }))}
                                className="text-xs text-blue-600 hover:underline"
                              >
                                Clear all
                              </button>
                            </div>
                            {availableFilters.sizes.map(size => (
                              <label key={size} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={addItemsFilters.sizes.includes(size)}
                                  onChange={(e) => {
                                    setAddItemsFilters(prev => ({
                                      ...prev,
                                      sizes: e.target.checked
                                        ? [...prev.sizes, size]
                                        : prev.sizes.filter(s => s !== size)
                                    }));
                                  }}
                                  className="rounded"
                                />
                                <span className="text-sm">{size}</span>
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="border-l pl-3 flex items-center gap-3">
                        <select
                          value={addItemsFilters.gender}
                          onChange={(e) => {
                            setAddItemsFilters(prev => ({ ...prev, gender: e.target.value }));
                          }}
                          className="px-2 py-1 text-sm border rounded"
                        >
                          <option value="">All Genders</option>
                          {availableFilters.genders.map(g => (
                            <option key={g} value={g}>{g}</option>
                          ))}
                        </select>
                        <label className="flex items-center gap-1.5 text-sm">
                          <input
                            type="checkbox"
                            checked={addItemsFilters.hasSalesHistory}
                            onChange={(e) => {
                              setAddItemsFilters(prev => ({ ...prev, hasSalesHistory: e.target.checked }));
                            }}
                            className="rounded"
                          />
                          Has sales
                        </label>
                        <label className="flex items-center gap-1.5 text-sm">
                          <input
                            type="checkbox"
                            checked={addItemsFilters.includeWithStock}
                            onChange={(e) => {
                              setAddItemsFilters(prev => ({ ...prev, includeWithStock: e.target.checked }));
                            }}
                            className="rounded"
                          />
                          Include in-stock
                        </label>
                        <label className="flex items-center gap-1.5 text-sm" title="Only show items with inventory data in system">
                          <input
                            type="checkbox"
                            checked={addItemsFilters.hasInventoryData}
                            onChange={(e) => {
                              setAddItemsFilters(prev => ({ ...prev, hasInventoryData: e.target.checked }));
                            }}
                            className="rounded"
                          />
                          Has inventory
                        </label>
                        <button
                          onClick={fetchAvailableProducts}
                          className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
                        >
                          Apply
                        </button>
                      </div>
                    </div>

                    {availableLoading ? (
                      <div className="text-center py-4">
                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mx-auto"></div>
                        <p className="mt-2 text-sm text-gray-500">Loading available products...</p>
                      </div>
                    ) : availableProducts.length === 0 ? (
                      <div className="text-center py-4 text-gray-500">
                        No items match your filters
                      </div>
                    ) : (
                      <div className="space-y-2 px-4 pb-4">
                        {/* Header with select all and bulk ignore - Sticky */}
                        <div className="sticky top-[57px] z-10 bg-gray-50 py-2 -mx-4 px-4 flex items-center justify-between border-b mb-2">
                          <div className="flex items-center gap-3">
                            <label className="flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                checked={selectedFamilies.size === availableProducts.length && availableProducts.length > 0}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedFamilies(new Set(availableProducts.map(f => f.base_name)));
                                  } else {
                                    setSelectedFamilies(new Set());
                                  }
                                }}
                                className="rounded"
                              />
                              Select All
                            </label>
                            <span className="text-sm text-gray-600">
                              {availableProducts.reduce((sum, f) => sum + f.products.length, 0)} items in {availableProducts.length} families
                            </span>
                          </div>
                          {selectedFamilies.size > 0 && (
                            <div className="flex items-center gap-2">
                              <label className="flex items-center gap-1 text-sm">
                                <span className="text-gray-600">Qty:</span>
                                <input
                                  type="number"
                                  min="1"
                                  value={bulkAddQty}
                                  onChange={(e) => setBulkAddQty(parseInt(e.target.value) || 1)}
                                  className="w-14 px-1 py-0.5 border rounded text-center text-sm"
                                />
                              </label>
                              <button
                                onClick={addAllSelectedFamilies}
                                disabled={saving}
                                className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
                              >
                                {saving ? 'Adding...' : `Add All (${availableProducts.filter(f => selectedFamilies.has(f.base_name)).reduce((sum, f) => sum + f.products.length, 0)})`}
                              </button>
                              <button
                                onClick={async () => {
                                  const familiesToIgnore = availableProducts.filter(f => selectedFamilies.has(f.base_name));
                                  for (const family of familiesToIgnore) {
                                    for (const product of family.products) {
                                      await orderAPI.ignoreProduct({
                                        productId: product.id,
                                        brandId: selectedBrandId
                                      });
                                    }
                                  }
                                  setAvailableProducts(prev => prev.filter(f => !selectedFamilies.has(f.base_name)));
                                  setSelectedFamilies(new Set());
                                }}
                                className="px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700"
                              >
                                Ignore ({selectedFamilies.size})
                              </button>
                            </div>
                          )}
                        </div>
                    {availableProducts.map(family => (
                      <div key={family.base_name} className="border rounded bg-white">
                        <div className="flex items-center hover:bg-gray-50">
                          <label className="pl-3 flex items-center" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={selectedFamilies.has(family.base_name)}
                              onChange={(e) => {
                                setSelectedFamilies(prev => {
                                  const newSet = new Set(prev);
                                  if (e.target.checked) {
                                    newSet.add(family.base_name);
                                  } else {
                                    newSet.delete(family.base_name);
                                  }
                                  return newSet;
                                });
                              }}
                              className="rounded"
                            />
                          </label>
                          <button
                            onClick={() => toggleFamily(family.base_name)}
                            className="flex-1 px-3 py-2 flex justify-between items-center text-left"
                          >
                            <span className="font-medium">{family.base_name}</span>
                            <span className="text-sm text-gray-500">
                              {expandedFamilies.has(family.base_name) ? '▼' : '▶'} {family.products.length} variant(s)
                            </span>
                          </button>
                          <button
                            onClick={async (e) => {
                              e.stopPropagation();
                              for (const product of family.products) {
                                await orderAPI.ignoreProduct({
                                  productId: product.id,
                                  brandId: selectedBrandId
                                });
                              }
                              setAvailableProducts(prev => prev.filter(f => f.base_name !== family.base_name));
                              setSelectedFamilies(prev => {
                                const newSet = new Set(prev);
                                newSet.delete(family.base_name);
                                return newSet;
                              });
                            }}
                            title="Ignore all variants of this product"
                            className="mr-2 px-2 py-1 text-xs bg-gray-200 text-gray-600 rounded hover:bg-gray-300"
                          >
                            Ignore
                          </button>
                        </div>

                        {expandedFamilies.has(family.base_name) && (
                          <div className="border-t">
                            {/* Bulk add controls for this family */}
                            {family.products.some(p => selectedProducts.has(p.id)) && (
                              <div className="bg-green-50 px-3 py-2 flex items-center gap-3 border-b">
                                <span className="text-sm text-green-800">
                                  {family.products.filter(p => selectedProducts.has(p.id)).length} selected
                                </span>
                                <label className="flex items-center gap-1 text-sm">
                                  <span className="text-gray-600">Qty:</span>
                                  <input
                                    type="number"
                                    min="1"
                                    value={bulkAddQty}
                                    onChange={(e) => setBulkAddQty(parseInt(e.target.value) || 1)}
                                    className="w-14 px-1 py-0.5 border rounded text-center text-sm"
                                  />
                                </label>
                                <button
                                  onClick={addSelectedProducts}
                                  disabled={saving}
                                  className="px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700 disabled:opacity-50"
                                >
                                  Add Selected
                                </button>
                              </div>
                            )}
                            <table className="w-full text-sm">
                              <thead className="bg-gray-50">
                                <tr>
                                  <th className="px-2 py-1 text-center">
                                    <input
                                      type="checkbox"
                                      checked={family.products.length > 0 && family.products.every(p => selectedProducts.has(p.id))}
                                      onChange={() => toggleSelectAllInFamily(family)}
                                      className="rounded"
                                      title="Select all sizes"
                                    />
                                  </th>
                                  <th className="px-2 py-1 text-left text-xs font-medium text-gray-500">Color</th>
                                  <th className="px-2 py-1 text-left text-xs font-medium text-gray-500">Size</th>
                                  <th className="px-2 py-1 text-center text-xs font-medium text-gray-500">Stock</th>
                                  <th className="px-2 py-1 text-right text-xs font-medium text-gray-500">Cost</th>
                                  <th className="px-2 py-1 text-left text-xs font-medium text-gray-500">Future Orders</th>
                                  <th className="px-2 py-1 text-center text-xs font-medium text-gray-500">Qty</th>
                                  <th className="px-2 py-1"></th>
                                </tr>
                              </thead>
                              <tbody>
                                {family.products.map(product => (
                                  <tr key={product.id} className={`border-t hover:bg-gray-50 ${product.future_orders?.length > 0 ? 'bg-yellow-50' : ''} ${selectedProducts.has(product.id) ? 'bg-green-50' : ''}`}>
                                    <td className="px-2 py-1.5 text-center">
                                      <input
                                        type="checkbox"
                                        checked={selectedProducts.has(product.id)}
                                        onChange={() => toggleProductSelection(product.id)}
                                        className="rounded"
                                      />
                                    </td>
                                    <td className="px-2 py-1.5">{product.color || '-'}</td>
                                    <td className="px-2 py-1.5">{product.size || '-'}{product.inseam && `/${product.inseam}`}</td>
                                    <td className="px-2 py-1.5 text-center text-gray-500">
                                      {product.stock_on_hand !== null ? product.stock_on_hand : '-'}
                                    </td>
                                    <td className="px-2 py-1.5 text-right">
                                      ${parseFloat(product.wholesale_cost || 0).toFixed(2)}
                                    </td>
                                    <td className="px-2 py-1.5 text-xs">
                                      {product.future_orders?.length > 0 ? (
                                        <span className="text-orange-600" title={product.future_orders.map(fo => `${fo.order_number}: ${fo.quantity} units`).join('\n')}>
                                          ⚠️ {product.future_orders.map(fo => {
                                            const d = new Date(fo.ship_date);
                                            const month = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()];
                                            return `${month}: ${fo.quantity}`;
                                          }).join(', ')}
                                        </span>
                                      ) : (
                                        <span className="text-gray-400">-</span>
                                      )}
                                    </td>
                                    <td className="px-2 py-1.5 text-center">
                                      <input
                                        id={`add-qty-${product.id}`}
                                        type="number"
                                        min="1"
                                        value={addQuantities[product.id] || ''}
                                        onChange={(e) => setAddQuantities({
                                          ...addQuantities,
                                          [product.id]: parseInt(e.target.value) || 1
                                        })}
                                        onKeyDown={(e) => handleAddItemKeyDown(e, product)}
                                        onFocus={() => setActiveAddProductId(product.id)}
                                        placeholder="1"
                                        className="w-14 px-1 py-0.5 border rounded text-center text-sm"
                                      />
                                    </td>
                                    <td className="px-2 py-1.5 text-center whitespace-nowrap">
                                      <button
                                        onClick={() => addItemToOrder(product)}
                                        disabled={saving}
                                        className="px-2 py-0.5 bg-green-600 text-white rounded text-xs hover:bg-green-700 disabled:opacity-50"
                                      >
                                        Add
                                      </button>
                                      <button
                                        onClick={() => ignoreProduct(product)}
                                        title="Ignore this product in future adjustments"
                                        className="ml-1 px-1.5 py-0.5 bg-gray-200 text-gray-600 rounded text-xs hover:bg-gray-300"
                                      >
                                        ✕
                                      </button>
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
                  </>
                )}
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

        {/* Original Order Table */}
        {!loading && originalItems.length > 0 && (
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
                      checked={selectedItems.size === originalItems.length && originalItems.length > 0}
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
                  <th className="px-2 py-2 text-center text-xs font-medium text-gray-500 uppercase">Δ</th>
                  <th className="px-2 py-2 text-right text-xs font-medium text-gray-500 uppercase">Cost</th>
                  <th className="px-2 py-2 text-right text-xs font-medium text-gray-500 uppercase">Total</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {originalItems.map((item) => (
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
                          onFocus={(e) => e.target.select()}
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
                    <td className="px-2 py-1.5 text-center">
                      {(() => {
                        const effective = getEffectiveQuantity(item);
                        const original = item.original_quantity;
                        const delta = effective - original;
                        if (delta === 0) return <span className="text-gray-300">-</span>;
                        return (
                          <span className={`font-medium ${delta > 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {delta > 0 ? '+' : ''}{delta}
                          </span>
                        );
                      })()}
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

        {/* Added Items Table */}
        {!loading && addedItems.length > 0 && (
          <div className="bg-white shadow rounded-lg overflow-hidden border-2 border-green-200">
            <div className="px-4 py-2 bg-green-50 border-b flex items-center justify-between">
              <span className="text-green-800 font-medium">
                Added Items ({addedItems.length} items, {addedItems.reduce((sum, item) => sum + getEffectiveQuantity(item), 0)} units, {formatPrice(addedItems.reduce((sum, item) => sum + (parseFloat(item.unit_cost || 0) * getEffectiveQuantity(item)), 0))})
              </span>
              <span className="text-xs text-green-600">Items added to order (not in original)</span>
            </div>
            <table className="w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-green-50">
                <tr>
                  <th className="px-2 py-2 text-left text-xs font-medium text-green-700 uppercase">Product</th>
                  <th className="px-2 py-2 text-left text-xs font-medium text-green-700 uppercase">Size</th>
                  <th className="px-2 py-2 text-left text-xs font-medium text-green-700 uppercase">Color</th>
                  <th className="px-2 py-2 text-center text-xs font-medium text-green-700 uppercase">Stock</th>
                  <th className="px-2 py-2 text-center text-xs font-medium text-green-700 uppercase">Qty</th>
                  <th className="px-2 py-2 text-right text-xs font-medium text-green-700 uppercase">Cost</th>
                  <th className="px-2 py-2 text-right text-xs font-medium text-green-700 uppercase">Total</th>
                  <th className="px-2 py-2 text-center text-xs font-medium text-green-700 uppercase"></th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {addedItems.map((item) => (
                  <tr key={item.item_id} className="hover:bg-green-50">
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
                      {item.stock_on_hand !== null ? item.stock_on_hand : '-'}
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
                          onFocus={(e) => e.target.select()}
                          className="w-14 px-1 py-0.5 text-center border border-green-500 rounded text-sm"
                          autoFocus
                          disabled={saving}
                        />
                      ) : (
                        <button
                          onClick={() => handleEditClick(item)}
                          className="px-2 py-0.5 rounded font-medium bg-green-100 text-green-700 hover:bg-green-200"
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
                    <td className="px-2 py-1.5 text-center">
                      <button
                        onClick={async () => {
                          if (confirm('Remove this item from the order?')) {
                            try {
                              await orderAPI.deleteItem(item.order_id, item.item_id);
                              setInventory(prev => prev.filter(i => i.item_id !== item.item_id));
                              recalculateSummary();
                            } catch (err) {
                              setError('Failed to remove item');
                            }
                          }
                        }}
                        className="text-red-500 hover:text-red-700 text-xs"
                        title="Remove from order"
                      >
                        ✕
                      </button>
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
