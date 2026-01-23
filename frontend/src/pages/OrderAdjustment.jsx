import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import api, { orderAPI, formAPI, agentAPI } from '../services/api';
import Layout from '../components/Layout';
import FormImportModal from '../components/FormImportModal';
import AgentChat from '../components/AgentChat';

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
  const selectedShipDate = searchParams.get('shipDate') || '';

  // Location tabs state
  const [activeLocationId, setActiveLocationId] = useState(null);
  const [inventoryByLocation, setInventoryByLocation] = useState({}); // { locationId: { items, summary, order } }
  const [loadingLocations, setLoadingLocations] = useState(new Set());

  // Data state (for active location)
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Editing state
  const [editingItemId, setEditingItemId] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);

  // Add Items panel state
  const [showAddItems, setShowAddItems] = useState(false);
  const [suggestedItems, setSuggestedItems] = useState([]);
  const [suggestedFamilies, setSuggestedFamilies] = useState([]);
  const [suggestedSummary, setSuggestedSummary] = useState(null);
  const [suggestedLoading, setSuggestedLoading] = useState(false);
  const [expandedFamilies, setExpandedFamilies] = useState(new Set());
  const [addQuantities, setAddQuantities] = useState({});
  const [selectedProducts, setSelectedProducts] = useState(new Set());
  const [bulkAddQty, setBulkAddQty] = useState(1);

  // Order finalization state
  const [finalizing, setFinalizing] = useState(false);
  const [finalizingAll, setFinalizingAll] = useState(false);
  const [orderStatusByLocation, setOrderStatusByLocation] = useState({}); // { locationId: { orderId, finalized_at } }

  // Brand form import/export state
  const [showImportModal, setShowImportModal] = useState(false);
  const [importedForm, setImportedForm] = useState(null);
  const [formQuantityColumns, setFormQuantityColumns] = useState([]);
  const [formRowData, setFormRowData] = useState(null);

  // AI Assistant state
  const [showAIAssistant, setShowAIAssistant] = useState(false);
  const [aiConversationId, setAIConversationId] = useState(null);
  const [aiChatCollapsed, setAIChatCollapsed] = useState(false);

  // Get current location's data (ship date is required)
  const cacheKey = (activeLocationId && selectedShipDate) ? `${activeLocationId}-${selectedShipDate}` : null;
  const currentData = cacheKey ? inventoryByLocation[cacheKey] : null;
  const inventory = currentData?.items || [];
  const summary = currentData?.summary || null;
  const currentOrder = currentData?.order || null;

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

  // Auto-select first location when brand is selected
  useEffect(() => {
    if (selectedBrandId && locations.length > 0) {
      // Clear cached data when brand changes
      setInventoryByLocation({});
      setOrderStatusByLocation({});
      // Auto-select first location
      if (!activeLocationId || !locations.find(l => l.id === parseInt(activeLocationId))) {
        setActiveLocationId(locations[0].id);
      }
    } else {
      setActiveLocationId(null);
      setInventoryByLocation({});
      setOrderStatusByLocation({});
    }
  }, [selectedBrandId, locations]);

  // Fetch ship dates when season/brand/location change
  useEffect(() => {
    const fetchShipDates = async () => {
      if (!selectedSeasonId || !selectedBrandId || !activeLocationId) {
        setShipDates([]);
        return;
      }
      try {
        const response = await orderAPI.getShipDates({
          seasonId: selectedSeasonId,
          brandId: selectedBrandId,
          locationId: activeLocationId
        });
        setShipDates(response.data.shipDates || []);
      } catch (err) {
        console.error('Error fetching ship dates:', err);
        setShipDates([]);
      }
    };
    fetchShipDates();
  }, [selectedSeasonId, selectedBrandId, activeLocationId]);

  // Track previous location to detect location changes
  const prevLocationRef = useRef(activeLocationId);

  // Handle location changes and fetch inventory
  useEffect(() => {
    if (!selectedSeasonId || !selectedBrandId || !activeLocationId) return;

    const locationChanged = prevLocationRef.current !== activeLocationId;
    prevLocationRef.current = activeLocationId;

    // If location changed and there's a ship date filter, clear it first
    // The URL change will trigger another effect run with empty ship date
    if (locationChanged && selectedShipDate) {
      updateFilter('shipDate', '');
      return; // Exit early - the URL update will trigger this effect again with cleared ship date
    }

    // Fetch inventory if not cached - ship date is required
    if (!selectedShipDate) return; // Don't fetch without ship date

    const cacheKey = `${activeLocationId}-${selectedShipDate}`;
    if (!inventoryByLocation[cacheKey]) {
      fetchInventoryForLocation(activeLocationId, selectedShipDate);
    }
  }, [selectedSeasonId, selectedBrandId, activeLocationId, selectedShipDate]);

  // Fetch imported forms when brand/season changes
  useEffect(() => {
    if (selectedSeasonId && selectedBrandId) {
      fetchImportedForms();
    } else {
      setImportedForm(null);
    }
  }, [selectedSeasonId, selectedBrandId]);

  const fetchImportedForms = async () => {
    try {
      const response = await formAPI.getAll({
        seasonId: selectedSeasonId,
        brandId: selectedBrandId
      });
      const forms = response.data.forms || [];
      if (forms.length > 0) {
        const form = forms[0];
        setImportedForm(form);
        const rowsResponse = await formAPI.getRows(form.id);
        setFormQuantityColumns(rowsResponse.data.quantityColumns || []);
        const rowMap = {};
        (rowsResponse.data.rows || []).forEach(row => {
          rowMap[row.product_id] = row;
        });
        setFormRowData(rowMap);
      } else {
        setImportedForm(null);
        setFormQuantityColumns([]);
        setFormRowData(null);
      }
    } catch (err) {
      console.error('Error fetching imported forms:', err);
      setImportedForm(null);
      setFormQuantityColumns([]);
      setFormRowData(null);
    }
  };

  const fetchInventoryForLocation = async (locationId, shipDate = null) => {
    setLoadingLocations(prev => new Set(prev).add(locationId));
    setError('');
    try {
      const params = {
        seasonId: selectedSeasonId,
        brandId: selectedBrandId,
        locationId: locationId
      };
      if (shipDate) {
        params.shipDate = shipDate;
      }

      const response = await orderAPI.getInventory(params);
      const inv = response.data.inventory || [];
      const sum = response.data.summary || null;

      // Deduplicate items by order_id + product_id (safety measure)
      const seenKeys = new Set();
      const dedupedInv = inv.filter(item => {
        const key = `${item.order_id}-${item.product_id}`;
        if (seenKeys.has(key)) {
          console.warn('Duplicate product found and removed:', item.product_name, 'order:', item.order_id, 'product:', item.product_id);
          return false;
        }
        seenKeys.add(key);
        return true;
      });

      // Get order details
      const orderIds = [...new Set(dedupedInv.map(i => i.order_id))];
      let order = null;
      if (orderIds.length === 1 && orderIds[0]) {
        const orderRes = await orderAPI.getById(orderIds[0]);
        order = orderRes.data.order;
      }

      // Add location info to each item
      const locationName = locations.find(l => l.id === locationId)?.name || '';
      const itemsWithLocation = dedupedInv.map(item => ({
        ...item,
        location_id: locationId,
        location_name: locationName
      }));

      // Cache the data with ship date in key
      const cacheKey = `${locationId}-${shipDate || 'all'}`;
      setInventoryByLocation(prev => ({
        ...prev,
        [cacheKey]: { items: itemsWithLocation, summary: sum, order }
      }));

      // Update order status
      if (order) {
        setOrderStatusByLocation(prev => ({
          ...prev,
          [locationId]: { orderId: order.id, finalized_at: order.finalized_at, order_number: order.order_number }
        }));
      }
    } catch (err) {
      console.error('Error fetching inventory for location:', err);
      setError(err.response?.data?.error || 'Failed to load inventory');
    } finally {
      setLoadingLocations(prev => {
        const newSet = new Set(prev);
        newSet.delete(locationId);
        return newSet;
      });
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

  // Force refresh - clears cache and refetches
  const handleForceRefresh = () => {
    if (!activeLocationId) return;
    const currentCacheKey = `${activeLocationId}-${selectedShipDate}`;
    // Clear this cache entry
    setInventoryByLocation(prev => {
      const newCache = { ...prev };
      delete newCache[currentCacheKey];
      return newCache;
    });
    // Fetch fresh data
    fetchInventoryForLocation(activeLocationId, selectedShipDate);
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
    if (!activeLocationId) return;

    const currentCacheKey = `${activeLocationId}-${selectedShipDate}`;
    setInventoryByLocation(prev => {
      const locationData = prev[currentCacheKey];
      if (!locationData) return prev;

      const updatedItems = locationData.items.map(i =>
        i.item_id === itemId ? { ...i, adjusted_quantity: adjustedQty } : i
      );

      // Recalculate summary
      const newSummary = {
        totalItems: updatedItems.length,
        totalOriginalUnits: updatedItems.reduce((sum, i) => sum + parseInt(i.original_quantity || 0), 0),
        totalAdjustedUnits: updatedItems.reduce((sum, i) => {
          const qty = i.adjusted_quantity !== null ? i.adjusted_quantity : i.original_quantity;
          return sum + parseInt(qty || 0);
        }, 0),
        totalOriginalWholesale: updatedItems.reduce((sum, i) => {
          return sum + (parseFloat(i.unit_cost || 0) * parseInt(i.original_quantity || 0));
        }, 0),
        totalWholesale: updatedItems.reduce((sum, i) => {
          const qty = i.adjusted_quantity !== null ? i.adjusted_quantity : i.original_quantity;
          return sum + (parseFloat(i.unit_cost || 0) * parseInt(qty || 0));
        }, 0)
      };

      return {
        ...prev,
        [currentCacheKey]: { ...locationData, items: updatedItems, summary: newSummary }
      };
    });
  };

  const handleKeyDown = async (e, item) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      await handleEditSave(item);
      const currentIndex = inventory.findIndex(i => i.item_id === item.item_id);
      if (currentIndex >= 0 && currentIndex < inventory.length - 1) {
        const nextItem = inventory[currentIndex + 1];
        setEditingItemId(nextItem.item_id);
        setEditValue(nextItem.adjusted_quantity !== null ? nextItem.adjusted_quantity.toString() : nextItem.original_quantity.toString());
      } else {
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

  // Fetch suggested items (low stock products)
  const fetchSuggestedItems = async () => {
    if (!selectedSeasonId || !selectedBrandId || !activeLocationId) return;

    setSuggestedLoading(true);
    try {
      const response = await orderAPI.getSuggestedItems({
        seasonId: selectedSeasonId,
        brandId: selectedBrandId,
        locationId: activeLocationId,
        targetMonths: 3
      });
      setSuggestedItems(response.data.suggestedItems || []);
      setSuggestedFamilies(response.data.families || []);
      setSuggestedSummary(response.data.summary || null);
    } catch (err) {
      console.error('Error fetching suggested items:', err);
      setError('Failed to load suggested items');
    } finally {
      setSuggestedLoading(false);
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
    const qty = addQuantities[product.id] || product.suggested_qty || 1;
    const orderId = currentOrder?.id;

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
        is_addition: true
      });

      setAddQuantities(prev => {
        const newQtys = { ...prev };
        delete newQtys[product.id];
        return newQtys;
      });

      // Remove from suggested items
      setSuggestedItems(prev => prev.filter(p => p.id !== product.id));
      setSuggestedFamilies(prev => {
        return prev.map(family => ({
          ...family,
          products: family.products.filter(p => p.id !== product.id)
        })).filter(family => family.products.length > 0);
      });

      // Add to inventory
      const newItem = response.data.item;
      if (newItem) {
        const currentCacheKey = `${activeLocationId}-${selectedShipDate}`;
        setInventoryByLocation(prev => {
          const locationData = prev[currentCacheKey];
          if (!locationData) return prev;
          return {
            ...prev,
            [currentCacheKey]: {
              ...locationData,
              items: [...locationData.items, {
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
                stock_on_hand: product.stock_on_hand || 0,
                location_id: activeLocationId,
                location_name: locations.find(l => l.id === activeLocationId)?.name || ''
              }]
            }
          };
        });
      }
    } catch (err) {
      console.error('Error adding item:', err);
      setError('Failed to add item to order');
    } finally {
      setSaving(false);
    }
  };

  // Add selected suggested products
  const addSelectedProducts = async () => {
    if (selectedProducts.size === 0) return;

    const orderId = currentOrder?.id;
    if (!orderId) {
      setError('No order found for this location');
      return;
    }

    setSaving(true);
    const addedProductIds = [];
    const newItems = [];

    try {
      const productsToAdd = suggestedItems.filter(p => selectedProducts.has(p.id));

      for (const product of productsToAdd) {
        const qty = addQuantities[product.id] || product.suggested_qty || bulkAddQty;
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
              stock_on_hand: product.stock_on_hand || 0
            });
          }
        } catch (err) {
          console.error(`Error adding product ${product.id}:`, err);
        }
      }

      if (addedProductIds.length > 0) {
        setSuggestedItems(prev => prev.filter(p => !addedProductIds.includes(p.id)));
        setSuggestedFamilies(prev =>
          prev.map(family => ({
            ...family,
            products: family.products.filter(p => !addedProductIds.includes(p.id))
          })).filter(family => family.products.length > 0)
        );

        setAddQuantities(prev => {
          const newQtys = { ...prev };
          addedProductIds.forEach(id => delete newQtys[id]);
          return newQtys;
        });

        setSelectedProducts(new Set());

        if (newItems.length > 0) {
          const currentCacheKey = `${activeLocationId}-${selectedShipDate}`;
          setInventoryByLocation(prev => {
            const locationData = prev[currentCacheKey];
            if (!locationData) return prev;
            return {
              ...prev,
              [currentCacheKey]: {
                ...locationData,
                items: [...locationData.items, ...newItems]
              }
            };
          });
        }
      }
    } catch (err) {
      console.error('Error in bulk add:', err);
      setError('Failed to add some items');
    } finally {
      setSaving(false);
    }
  };

  // Toggle product selection
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

  // Finalize single order
  const finalizeOrder = async (orderId) => {
    if (!orderId) return;

    setFinalizing(true);
    try {
      const response = await orderAPI.finalize(orderId);
      // Update order status
      const locationId = Object.keys(orderStatusByLocation).find(
        lid => orderStatusByLocation[lid]?.orderId === orderId
      ) || activeLocationId;

      if (locationId) {
        setOrderStatusByLocation(prev => ({
          ...prev,
          [locationId]: {
            ...prev[locationId],
            finalized_at: response.data.order.finalized_at
          }
        }));

        // Update cached data - use the current ship date filter
        const currentCacheKey = `${locationId}-${selectedShipDate}`;
        setInventoryByLocation(prev => {
          const locationData = prev[currentCacheKey];
          if (!locationData) return prev;
          return {
            ...prev,
            [currentCacheKey]: {
              ...locationData,
              order: { ...locationData.order, finalized_at: response.data.order.finalized_at }
            }
          };
        });
      }
    } catch (err) {
      console.error('Error finalizing order:', err);
      setError('Failed to finalize order');
    } finally {
      setFinalizing(false);
    }
  };

  // Finalize all orders for brand
  const finalizeBrandWide = async () => {
    if (!selectedSeasonId || !selectedBrandId) return;

    setFinalizingAll(true);
    try {
      const response = await orderAPI.finalizeBrandWide(
        parseInt(selectedSeasonId),
        parseInt(selectedBrandId)
      );

      // Update all order statuses
      const now = new Date().toISOString();
      const updatedStatuses = {};
      (response.data.orders || []).forEach(order => {
        updatedStatuses[order.locationId] = {
          orderId: order.orderId,
          order_number: order.orderNumber,
          finalized_at: now
        };
      });
      setOrderStatusByLocation(prev => ({ ...prev, ...updatedStatuses }));

      // Update cached inventory data - use the current ship date filter
      setInventoryByLocation(prev => {
        const updated = { ...prev };
        Object.keys(updatedStatuses).forEach(locId => {
          const cacheKey = `${locId}-${selectedShipDate}`;
          if (updated[cacheKey]) {
            updated[cacheKey] = {
              ...updated[cacheKey],
              order: { ...updated[cacheKey].order, finalized_at: now }
            };
          }
        });
        return updated;
      });
    } catch (err) {
      console.error('Error finalizing all orders:', err);
      setError('Failed to finalize all orders');
    } finally {
      setFinalizingAll(false);
    }
  };

  // Handle form import success
  const handleImportSuccess = async () => {
    if (activeLocationId) {
      fetchInventoryForLocation(activeLocationId, selectedShipDate);
    }
    setShowImportModal(false);
  };

  // Handle form export
  const handleExportForm = async () => {
    if (!importedForm) {
      alert('No imported form available to export');
      return;
    }

    try {
      const response = await formAPI.export(importedForm.id);
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', importedForm.original_filename || 'export.xlsx');
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error exporting form:', err);
      setError('Failed to export form');
    }
  };

  // Initialize AI Assistant conversation
  const initAIConversation = async () => {
    if (aiConversationId) {
      setShowAIAssistant(true);
      return;
    }

    try {
      const response = await agentAPI.createConversation({
        seasonId: selectedSeasonId ? parseInt(selectedSeasonId) : null,
        brandId: selectedBrandId ? parseInt(selectedBrandId) : null,
        locationId: activeLocationId ? parseInt(activeLocationId) : null,
        title: `Order Adjustment - ${brands.find(b => b.id === parseInt(selectedBrandId))?.name || 'Brand'}`
      });

      setAIConversationId(response.data.conversation.id);
      setShowAIAssistant(true);
    } catch (err) {
      console.error('Error creating AI conversation:', err);
      setError('Failed to initialize AI Assistant');
    }
  };

  // Handle AI suggestion created - refresh inventory
  const handleAISuggestionCreated = () => {
    if (activeLocationId) {
      // Refresh inventory to pick up any changes made by AI
      fetchInventoryForLocation(activeLocationId, selectedShipDate);
    }
  };

  // Sort function: by location name, then by product name
  const sortByLocationThenName = (a, b) => {
    const locCompare = (a.location_name || '').localeCompare(b.location_name || '');
    if (locCompare !== 0) return locCompare;
    return (a.product_name || '').localeCompare(b.product_name || '');
  };

  // Split inventory into original and added items, sorted by location then name
  const originalItems = inventory
    .filter(item => item.original_quantity > 0)
    .sort(sortByLocationThenName);
  const addedItems = inventory
    .filter(item => item.original_quantity === 0)
    .sort(sortByLocationThenName);

  // Count finalized locations
  const finalizedCount = Object.values(orderStatusByLocation).filter(s => s?.finalized_at).length;
  const totalLocations = locations.length;

  return (
    <Layout>
      <div className="space-y-4">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Order Adjustment</h1>
          <p className="mt-1 text-sm text-gray-600">
            View and adjust order quantities across all locations for a brand.
          </p>
        </div>

        {/* Season/Brand Selection */}
        <div className="bg-white p-4 rounded-lg shadow">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                <option value="">Select Brand</option>
                {brands.map((brand) => (
                  <option key={brand.id} value={brand.id}>{brand.name}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Location Tabs */}
        {selectedBrandId && locations.length > 0 && (
          <div className="bg-white rounded-lg shadow">
            <div className="flex border-b overflow-x-auto">
              {locations.map(loc => {
                const status = orderStatusByLocation[loc.id];
                const isActive = activeLocationId === loc.id;
                const isLoading = loadingLocations.has(loc.id);
                const isFinalized = status?.finalized_at;

                return (
                  <button
                    key={loc.id}
                    onClick={() => setActiveLocationId(loc.id)}
                    className={`px-4 py-3 text-sm font-medium whitespace-nowrap flex items-center gap-2 border-b-2 transition-colors ${
                      isActive
                        ? 'border-blue-500 text-blue-600 bg-blue-50'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {isLoading && (
                      <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-blue-600"></div>
                    )}
                    {loc.name}
                    {isFinalized && (
                      <span className="text-green-600 text-xs">✓</span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Ship Date Filter */}
            {activeLocationId && shipDates.length > 0 && (
              <div className="px-4 py-2 bg-gray-50 border-t flex items-center gap-4">
                <label htmlFor="shipDate" className="text-sm font-medium text-gray-700">Ship Date:</label>
                <select
                  id="shipDate"
                  value={selectedShipDate}
                  onChange={(e) => updateFilter('shipDate', e.target.value)}
                  className="px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">All Ship Dates</option>
                  {shipDates.map((date) => (
                    <option key={date} value={date}>
                      {new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </option>
                  ))}
                </select>
                {selectedShipDate && (
                  <button
                    onClick={() => updateFilter('shipDate', '')}
                    className="text-sm text-gray-500 hover:text-gray-700"
                  >
                    Clear
                  </button>
                )}
              </div>
            )}
          </div>
        )}

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
          </div>
        )}

        {/* Finalization Status Panel */}
        {selectedBrandId && locations.length > 0 && (
          <div className="bg-gray-50 p-4 rounded-lg shadow">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-medium text-gray-900">Finalization Status</h3>
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-600">
                  {finalizedCount}/{totalLocations} locations finalized
                </span>
                <button
                  onClick={finalizeBrandWide}
                  disabled={finalizingAll}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {finalizingAll ? 'Finalizing...' : 'Finalize All Locations'}
                </button>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {locations.map(loc => {
                const status = orderStatusByLocation[loc.id];
                const isFinalized = status?.finalized_at;
                return (
                  <div
                    key={loc.id}
                    className={`flex items-center justify-between px-3 py-2 rounded ${
                      isFinalized ? 'bg-green-100 text-green-800' : 'bg-white border'
                    }`}
                  >
                    <span className="text-sm font-medium">{loc.name}</span>
                    {isFinalized ? (
                      <span className="text-green-600">✓</span>
                    ) : (
                      <span className="text-gray-400 text-xs">Pending</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Import/Export Brand Forms */}
        {selectedSeasonId && selectedBrandId && (
          <div className="bg-white p-4 rounded-lg shadow flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-600">Brand Order Forms:</span>
              {importedForm && (
                <span className="text-sm text-gray-900 font-medium">
                  {importedForm.original_filename}
                </span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowImportModal(true)}
                className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 text-sm font-medium"
              >
                Import Brand Form
              </button>
              {inventory.length > 0 && (
                <button
                  onClick={handleExportForm}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm font-medium"
                >
                  Export to Excel
                </button>
              )}
            </div>
          </div>
        )}

        {/* Add Items Toolbar */}
        {inventory.length > 0 && (
          <div className="bg-white rounded-lg shadow">
            <div className="flex border-b">
              <button
                onClick={() => {
                  const newState = !showAddItems;
                  setShowAddItems(newState);
                  if (newState) {
                    fetchSuggestedItems();
                  }
                }}
                className={`px-4 py-2 text-sm font-medium ${
                  showAddItems
                    ? 'border-b-2 border-blue-500 text-blue-600'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                + Add Items {suggestedSummary?.totalProducts > 0 && `(${suggestedSummary.totalProducts} suggested)`}
              </button>
              <button
                onClick={initAIConversation}
                className={`px-4 py-2 text-sm font-medium flex items-center gap-2 ${
                  showAIAssistant
                    ? 'border-b-2 border-purple-500 text-purple-600'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                AI Assistant
              </button>
              <button
                onClick={handleForceRefresh}
                disabled={loadingLocations.has(activeLocationId)}
                className="px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 flex items-center gap-1"
                title="Force refresh data from server"
              >
                <svg className={`w-4 h-4 ${loadingLocations.has(activeLocationId) ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Refresh
              </button>
              <div className="flex-1" />
              {currentOrder && (
                <button
                  onClick={() => finalizeOrder(currentOrder.id)}
                  disabled={finalizing}
                  className={`px-4 py-2 text-sm font-medium transition-colors ${
                    currentOrder.finalized_at
                      ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      : 'bg-blue-600 text-white hover:bg-blue-700'
                  } disabled:opacity-50`}
                >
                  {finalizing ? 'Finalizing...' : currentOrder.finalized_at ? 'Re-finalize' : 'Finalize Order'}
                </button>
              )}
            </div>

            {/* Add Items Panel */}
            {showAddItems && (
              <div className="bg-gray-50 border-b max-h-96 overflow-y-auto">
                {suggestedLoading ? (
                  <div className="text-center py-4">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mx-auto"></div>
                    <p className="mt-2 text-sm text-gray-500">Loading suggestions...</p>
                  </div>
                ) : suggestedFamilies.length === 0 ? (
                  <div className="text-center py-4 text-gray-500">
                    No low-stock items to suggest. All products have adequate coverage.
                  </div>
                ) : (
                  <div className="space-y-2 p-4">
                    {/* Summary header */}
                    <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3 mb-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="text-sm font-medium text-yellow-800">
                            Low Stock Alert:
                          </span>
                          <span className="text-sm text-yellow-700 ml-2">
                            {suggestedSummary?.totalProducts || 0} products have less than 1 month of supply
                          </span>
                        </div>
                        {selectedProducts.size > 0 && (
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-gray-600">{selectedProducts.size} selected</span>
                            <button
                              onClick={addSelectedProducts}
                              disabled={saving}
                              className="px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700 disabled:opacity-50"
                            >
                              {saving ? 'Adding...' : 'Add Selected'}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Family list */}
                    {suggestedFamilies.map(family => (
                      <div key={family.base_name} className="border rounded bg-white">
                        <button
                          onClick={() => toggleFamily(family.base_name)}
                          className="w-full px-3 py-2 flex justify-between items-center text-left hover:bg-gray-50"
                        >
                          <span className="font-medium">{family.base_name}</span>
                          <span className="text-sm text-gray-500">
                            {expandedFamilies.has(family.base_name) ? '▼' : '▶'} {family.products.length} items
                          </span>
                        </button>

                        {expandedFamilies.has(family.base_name) && (
                          <table className="w-full text-sm border-t">
                            <thead className="bg-gray-50">
                              <tr>
                                <th className="px-2 py-1 text-center w-8">
                                  <input
                                    type="checkbox"
                                    checked={family.products.every(p => selectedProducts.has(p.id))}
                                    onChange={(e) => {
                                      setSelectedProducts(prev => {
                                        const newSet = new Set(prev);
                                        if (e.target.checked) {
                                          family.products.forEach(p => newSet.add(p.id));
                                        } else {
                                          family.products.forEach(p => newSet.delete(p.id));
                                        }
                                        return newSet;
                                      });
                                    }}
                                    className="rounded"
                                  />
                                </th>
                                <th className="px-2 py-1 text-left text-xs font-medium text-gray-500">Size</th>
                                <th className="px-2 py-1 text-left text-xs font-medium text-gray-500">Color</th>
                                <th className="px-2 py-1 text-center text-xs font-medium text-gray-500">Stock</th>
                                <th className="px-2 py-1 text-center text-xs font-medium text-gray-500">Mo/Sales</th>
                                <th className="px-2 py-1 text-center text-xs font-medium text-gray-500">Coverage</th>
                                <th className="px-2 py-1 text-right text-xs font-medium text-gray-500">Cost</th>
                                <th className="px-2 py-1 text-center text-xs font-medium text-gray-500">Sugg Qty</th>
                                <th className="px-2 py-1"></th>
                              </tr>
                            </thead>
                            <tbody>
                              {family.products.map(product => (
                                <tr key={product.id} className={`border-t hover:bg-gray-50 ${selectedProducts.has(product.id) ? 'bg-blue-50' : ''}`}>
                                  <td className="px-2 py-1.5 text-center">
                                    <input
                                      type="checkbox"
                                      checked={selectedProducts.has(product.id)}
                                      onChange={() => toggleProductSelection(product.id)}
                                      className="rounded"
                                    />
                                  </td>
                                  <td className="px-2 py-1.5">{product.size || '-'}{product.inseam && `/${product.inseam}`}</td>
                                  <td className="px-2 py-1.5">{product.color || '-'}</td>
                                  <td className="px-2 py-1.5 text-center text-gray-500">
                                    {product.stock_on_hand ?? '-'}
                                  </td>
                                  <td className="px-2 py-1.5 text-center text-gray-500">
                                    {product.avg_monthly_sales ?? '-'}
                                  </td>
                                  <td className="px-2 py-1.5 text-center">
                                    <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                                      product.months_supply < 0.5 ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
                                    }`}>
                                      {product.months_supply}mo
                                    </span>
                                  </td>
                                  <td className="px-2 py-1.5 text-right">
                                    ${parseFloat(product.wholesale_cost || 0).toFixed(2)}
                                  </td>
                                  <td className="px-2 py-1.5 text-center">
                                    <input
                                      type="number"
                                      min="1"
                                      value={addQuantities[product.id] ?? product.suggested_qty ?? ''}
                                      onChange={(e) => setAddQuantities(prev => ({
                                        ...prev,
                                        [product.id]: parseInt(e.target.value) || product.suggested_qty
                                      }))}
                                      placeholder={product.suggested_qty?.toString()}
                                      className="w-14 px-1 py-0.5 border rounded text-center text-sm"
                                    />
                                  </td>
                                  <td className="px-2 py-1.5 text-center">
                                    <button
                                      onClick={() => addItemToOrder(product)}
                                      disabled={saving}
                                      className="px-2 py-0.5 bg-green-600 text-white rounded text-xs hover:bg-green-700 disabled:opacity-50"
                                    >
                                      Add
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    ))}
                  </div>
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
        {loadingLocations.has(activeLocationId) && (
          <div className="flex justify-center items-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
        )}

        {/* No Brand Selected */}
        {!selectedBrandId && selectedSeasonId && (
          <div className="bg-yellow-50 rounded-lg p-8 text-center">
            <h3 className="text-sm font-medium text-gray-900">Select a Brand</h3>
            <p className="mt-1 text-sm text-gray-500">Choose a brand to view and adjust orders across all locations.</p>
          </div>
        )}

        {/* Ship Date Required */}
        {activeLocationId && !selectedShipDate && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-12 text-center">
            <svg className="mx-auto h-12 w-12 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <h3 className="mt-4 text-sm font-medium text-blue-900">Select a Ship Date</h3>
            <p className="mt-1 text-sm text-blue-700">Choose a ship date from the dropdown above to view and adjust order items.</p>
          </div>
        )}

        {/* No Results */}
        {!loadingLocations.has(activeLocationId) && activeLocationId && selectedShipDate && inventory.length === 0 && (
          <div className="bg-gray-50 rounded-lg p-12 text-center">
            <h3 className="text-sm font-medium text-gray-900">No order items found</h3>
            <p className="mt-1 text-sm text-gray-500">No orders exist for this location and ship date.</p>
          </div>
        )}

        {/* Original Order Table */}
        {!loadingLocations.has(activeLocationId) && originalItems.length > 0 && (
          <div className="bg-white shadow rounded-lg overflow-hidden">
            <table className="w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase">Location</th>
                  <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase">Product</th>
                  <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase">Size</th>
                  <th className="px-2 py-2 text-left text-xs font-medium text-gray-500 uppercase">Color</th>
                  <th className="px-2 py-2 text-center text-xs font-medium text-gray-500 uppercase">Orig</th>
                  <th className="px-2 py-2 text-center text-xs font-medium text-gray-500 uppercase">Stock</th>
                  <th className="px-2 py-2 text-center text-xs font-medium text-orange-600 uppercase" title="Quantity from other finalized orders not yet received">On Order</th>
                  <th className="px-2 py-2 text-center text-xs font-medium text-gray-500 uppercase">Adj</th>
                  {formQuantityColumns.map(col => (
                    <th key={col.id} className="px-2 py-2 text-center text-xs font-medium text-gray-500 uppercase" title={`Ship Date: ${col.ship_date}`}>
                      {col.column_name || col.column_letter}
                    </th>
                  ))}
                  <th className="px-2 py-2 text-center text-xs font-medium text-gray-500 uppercase">Δ</th>
                  <th className="px-2 py-2 text-right text-xs font-medium text-gray-500 uppercase">Cost</th>
                  <th className="px-2 py-2 text-right text-xs font-medium text-gray-500 uppercase">Total</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {originalItems.map((item) => (
                  <tr key={item.item_id} className={`hover:bg-gray-50 ${hasAdjustment(item) ? 'bg-blue-50' : ''}`}>
                    <td className="px-2 py-1.5 text-gray-600 text-xs">
                      {item.location_name || '-'}
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
                      {item.on_order > 0 ? (
                        <span className="text-orange-600 font-medium">{item.on_order}</span>
                      ) : (
                        <span className="text-gray-300">-</span>
                      )}
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
                    {formQuantityColumns.map(col => {
                      const rowData = formRowData?.[item.product_id];
                      const quantity = rowData?.quantities?.[col.id]?.quantity || 0;
                      return (
                        <td key={col.id} className="px-2 py-1.5 text-center">
                          <span className="px-2 py-0.5 text-gray-700">
                            {quantity}
                          </span>
                        </td>
                      );
                    })}
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
        {!loadingLocations.has(activeLocationId) && addedItems.length > 0 && (
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
                  <th className="px-2 py-2 text-left text-xs font-medium text-green-700 uppercase">Location</th>
                  <th className="px-2 py-2 text-left text-xs font-medium text-green-700 uppercase">Product</th>
                  <th className="px-2 py-2 text-left text-xs font-medium text-green-700 uppercase">Size</th>
                  <th className="px-2 py-2 text-left text-xs font-medium text-green-700 uppercase">Color</th>
                  <th className="px-2 py-2 text-center text-xs font-medium text-green-700 uppercase">Stock</th>
                  <th className="px-2 py-2 text-center text-xs font-medium text-orange-600 uppercase" title="Quantity from other finalized orders not yet received">On Order</th>
                  <th className="px-2 py-2 text-center text-xs font-medium text-green-700 uppercase">Qty</th>
                  {formQuantityColumns.map(col => (
                    <th key={col.id} className="px-2 py-2 text-center text-xs font-medium text-green-700 uppercase" title={`Ship Date: ${col.ship_date}`}>
                      {col.column_name || col.column_letter}
                    </th>
                  ))}
                  <th className="px-2 py-2 text-right text-xs font-medium text-green-700 uppercase">Cost</th>
                  <th className="px-2 py-2 text-right text-xs font-medium text-green-700 uppercase">Total</th>
                  <th className="px-2 py-2 text-center text-xs font-medium text-green-700 uppercase"></th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {addedItems.map((item) => (
                  <tr key={item.item_id} className="hover:bg-green-50">
                    <td className="px-2 py-1.5 text-gray-600 text-xs">
                      {item.location_name || '-'}
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
                      {item.stock_on_hand !== null ? item.stock_on_hand : '-'}
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      {item.on_order > 0 ? (
                        <span className="text-orange-600 font-medium">{item.on_order}</span>
                      ) : (
                        <span className="text-gray-300">-</span>
                      )}
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
                    {formQuantityColumns.map(col => {
                      const rowData = formRowData?.[item.product_id];
                      const quantity = rowData?.quantities?.[col.id]?.quantity || 0;
                      return (
                        <td key={col.id} className="px-2 py-1.5 text-center">
                          <span className="px-2 py-0.5 text-gray-700">
                            {quantity}
                          </span>
                        </td>
                      );
                    })}
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
                              const currentCacheKey = `${activeLocationId}-${selectedShipDate}`;
                              setInventoryByLocation(prev => {
                                const locationData = prev[currentCacheKey];
                                if (!locationData) return prev;

                                const updatedItems = locationData.items.filter(i => i.item_id !== item.item_id);

                                // Recalculate summary after deletion
                                const newSummary = {
                                  totalItems: updatedItems.length,
                                  totalOriginalUnits: updatedItems.reduce((sum, i) => sum + parseInt(i.original_quantity || 0), 0),
                                  totalAdjustedUnits: updatedItems.reduce((sum, i) => {
                                    const qty = i.adjusted_quantity !== null ? i.adjusted_quantity : i.original_quantity;
                                    return sum + parseInt(qty || 0);
                                  }, 0),
                                  totalOriginalWholesale: updatedItems.reduce((sum, i) => {
                                    return sum + (parseFloat(i.unit_cost || 0) * parseInt(i.original_quantity || 0));
                                  }, 0),
                                  totalWholesale: updatedItems.reduce((sum, i) => {
                                    const qty = i.adjusted_quantity !== null ? i.adjusted_quantity : i.original_quantity;
                                    return sum + (parseFloat(i.unit_cost || 0) * parseInt(qty || 0));
                                  }, 0)
                                };

                                return {
                                  ...prev,
                                  [currentCacheKey]: {
                                    ...locationData,
                                    items: updatedItems,
                                    summary: newSummary
                                  }
                                };
                              });
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

        {/* AI Assistant Panel */}
        {showAIAssistant && aiConversationId && (
          <div className="mt-4">
            <AgentChat
              conversationId={aiConversationId}
              context={{
                seasonId: selectedSeasonId ? parseInt(selectedSeasonId) : null,
                brandId: selectedBrandId ? parseInt(selectedBrandId) : null,
                locationId: activeLocationId ? parseInt(activeLocationId) : null,
                shipDate: selectedShipDate || null,
                seasonName: seasons.find(s => s.id === parseInt(selectedSeasonId))?.name,
                brandName: brands.find(b => b.id === parseInt(selectedBrandId))?.name,
                locationName: locations.find(l => l.id === activeLocationId)?.name
              }}
              onSuggestionCreated={handleAISuggestionCreated}
              collapsed={aiChatCollapsed}
              onToggleCollapse={() => {
                if (aiChatCollapsed) {
                  setAIChatCollapsed(false);
                } else {
                  setShowAIAssistant(false);
                  setAIChatCollapsed(false);
                }
              }}
            />
          </div>
        )}

        {/* Form Import Modal */}
        {showImportModal && selectedSeasonId && selectedBrandId && (
          <FormImportModal
            brandId={parseInt(selectedBrandId)}
            seasonId={parseInt(selectedSeasonId)}
            onClose={() => setShowImportModal(false)}
            onSuccess={handleImportSuccess}
          />
        )}
      </div>
    </Layout>
  );
};

export default OrderAdjustment;
