import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import api, { orderAPI, brandAPI } from '../services/api';
import Layout from '../components/Layout';

const OrderAdjustment = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  // Filter state
  const [seasons, setSeasons] = useState([]);
  const [brands, setBrands] = useState([]);
  const [locations, setLocations] = useState([]);

  // Selected filters from URL
  const selectedSeasonId = searchParams.get('season') || '';
  const selectedBrandId = searchParams.get('brand') || '';
  const selectedLocationId = searchParams.get('location') || '';

  // Data state
  const [inventory, setInventory] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Editing state
  const [editingItemId, setEditingItemId] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);

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

  // Fetch inventory when filters change
  useEffect(() => {
    if (selectedSeasonId && selectedLocationId) {
      fetchInventory();
    } else {
      setInventory([]);
      setSummary(null);
    }
  }, [selectedSeasonId, selectedBrandId, selectedLocationId]);

  const fetchInventory = async () => {
    setLoading(true);
    setError('');
    try {
      const params = { seasonId: selectedSeasonId };
      if (selectedBrandId) params.brandId = selectedBrandId;
      if (selectedLocationId) params.locationId = selectedLocationId;

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

    // If clearing to original, set to null
    const adjustedQty = newValue === item.original_quantity ? null : newValue;

    setSaving(true);
    try {
      await orderAPI.adjustItem(item.order_id, item.item_id, adjustedQty);

      // Update local state
      setInventory(prev => prev.map(i =>
        i.item_id === item.item_id
          ? { ...i, adjusted_quantity: adjustedQty }
          : i
      ));

      // Recalculate summary
      const updatedInventory = inventory.map(i =>
        i.item_id === item.item_id
          ? { ...i, adjusted_quantity: adjustedQty }
          : i
      );
      const newSummary = {
        totalItems: updatedInventory.length,
        totalOriginalUnits: updatedInventory.reduce((sum, i) => sum + parseInt(i.original_quantity || 0), 0),
        totalAdjustedUnits: updatedInventory.reduce((sum, i) => {
          const qty = i.adjusted_quantity !== null ? i.adjusted_quantity : i.original_quantity;
          return sum + parseInt(qty || 0);
        }, 0),
        totalWholesale: updatedInventory.reduce((sum, i) => {
          const qty = i.adjusted_quantity !== null ? i.adjusted_quantity : i.original_quantity;
          return sum + (parseFloat(i.unit_cost || 0) * parseInt(qty || 0));
        }, 0)
      };
      setSummary(newSummary);

      setEditingItemId(null);
      setEditValue('');
    } catch (err) {
      console.error('Error saving adjustment:', err);
      setError('Failed to save adjustment');
    } finally {
      setSaving(false);
    }
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

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Order Adjustment</h1>
          <p className="mt-2 text-sm text-gray-600">
            View and adjust order quantities by location. Select a season and location to get started.
          </p>
        </div>

        {/* Filters */}
        <div className="bg-white p-6 rounded-lg shadow">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Season Filter */}
            <div>
              <label htmlFor="season" className="block text-sm font-medium text-gray-700 mb-2">
                Season
              </label>
              <select
                id="season"
                value={selectedSeasonId}
                onChange={(e) => updateFilter('season', e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">Select Season</option>
                {seasons.map((season) => (
                  <option key={season.id} value={season.id}>
                    {season.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Brand Filter */}
            <div>
              <label htmlFor="brand" className="block text-sm font-medium text-gray-700 mb-2">
                Brand (Optional)
              </label>
              <select
                id="brand"
                value={selectedBrandId}
                onChange={(e) => updateFilter('brand', e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">All Brands</option>
                {brands.map((brand) => (
                  <option key={brand.id} value={brand.id}>
                    {brand.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Location Filter */}
            <div>
              <label htmlFor="location" className="block text-sm font-medium text-gray-700 mb-2">
                Location
              </label>
              <select
                id="location"
                value={selectedLocationId}
                onChange={(e) => updateFilter('location', e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">Select Location</option>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Summary Stats */}
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white p-4 rounded-lg shadow">
              <div className="text-sm text-gray-500">Total Items</div>
              <div className="text-2xl font-bold text-gray-900">{summary.totalItems}</div>
            </div>
            <div className="bg-white p-4 rounded-lg shadow">
              <div className="text-sm text-gray-500">Original Units</div>
              <div className="text-2xl font-bold text-gray-900">{summary.totalOriginalUnits}</div>
            </div>
            <div className="bg-white p-4 rounded-lg shadow">
              <div className="text-sm text-gray-500">Adjusted Units</div>
              <div className={`text-2xl font-bold ${summary.totalAdjustedUnits !== summary.totalOriginalUnits ? 'text-blue-600' : 'text-gray-900'}`}>
                {summary.totalAdjustedUnits}
                {summary.totalAdjustedUnits !== summary.totalOriginalUnits && (
                  <span className="text-sm ml-2">
                    ({summary.totalAdjustedUnits > summary.totalOriginalUnits ? '+' : ''}
                    {summary.totalAdjustedUnits - summary.totalOriginalUnits})
                  </span>
                )}
              </div>
            </div>
            <div className="bg-white p-4 rounded-lg shadow">
              <div className="text-sm text-gray-500">Total Wholesale</div>
              <div className="text-2xl font-bold text-gray-900">{formatPrice(summary.totalWholesale)}</div>
            </div>
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
            <svg className="mx-auto h-12 w-12 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <h3 className="mt-2 text-sm font-medium text-gray-900">Select a Location</h3>
            <p className="mt-1 text-sm text-gray-500">
              Choose a location to view and adjust order quantities.
            </p>
          </div>
        )}

        {/* No Results */}
        {!loading && selectedLocationId && inventory.length === 0 && (
          <div className="bg-gray-50 rounded-lg p-12 text-center">
            <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
            </svg>
            <h3 className="mt-2 text-sm font-medium text-gray-900">No order items found</h3>
            <p className="mt-1 text-sm text-gray-500">
              No orders exist for this season, brand, and location combination.
            </p>
          </div>
        )}

        {/* Inventory Table */}
        {!loading && inventory.length > 0 && (
          <div className="bg-white shadow rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Product
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      SKU / UPC
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Size
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Color
                    </th>
                    <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Original Qty
                    </th>
                    <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Adjusted Qty
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Unit Cost
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Line Total
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Order
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {inventory.map((item) => (
                    <tr key={item.item_id} className={`hover:bg-gray-50 ${hasAdjustment(item) ? 'bg-blue-50' : ''}`}>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">{item.base_name || item.product_name}</div>
                        {item.base_name && item.product_name !== item.base_name && (
                          <div className="text-xs text-gray-500">{item.product_name}</div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">{item.sku || '-'}</div>
                        <div className="text-xs text-gray-500">{item.upc || '-'}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {item.size || '-'}
                        {item.inseam && <span className="text-gray-500"> / {item.inseam}</span>}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {item.color || '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-center">
                        <span className="text-sm text-gray-500">{item.original_quantity}</span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-center">
                        {editingItemId === item.item_id ? (
                          <input
                            type="number"
                            min="0"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={() => handleEditSave(item)}
                            onKeyDown={(e) => handleKeyDown(e, item)}
                            className="w-20 px-2 py-1 text-center border border-blue-500 rounded focus:ring-2 focus:ring-blue-500"
                            autoFocus
                            disabled={saving}
                          />
                        ) : (
                          <button
                            onClick={() => handleEditClick(item)}
                            className={`px-3 py-1 rounded text-sm font-medium ${
                              hasAdjustment(item)
                                ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                            }`}
                          >
                            {getEffectiveQuantity(item)}
                          </button>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm text-gray-900">
                        {formatPrice(item.unit_cost)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium text-gray-900">
                        {formatPrice(parseFloat(item.unit_cost || 0) * getEffectiveQuantity(item))}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm text-gray-900">{item.order_number}</div>
                        <div className="text-xs text-gray-500">{item.order_status}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
};

export default OrderAdjustment;
