import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import Layout from '../components/Layout';

const Orders = () => {
  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  const [seasons, setSeasons] = useState([]);
  const [brands, setBrands] = useState([]);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters
  const [selectedSeason, setSelectedSeason] = useState('');
  const [selectedBrand, setSelectedBrand] = useState('');
  const [selectedLocation, setSelectedLocation] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');

  // Collapsed sections - brands collapsed by default
  const [collapsedSeasons, setCollapsedSeasons] = useState({});
  const [collapsedBrands, setCollapsedBrands] = useState({});

  // Sort mode: 'brand' (default) or 'shipDate' or 'location'
  const [sortMode, setSortMode] = useState('brand');

  // Selection for bulk export
  const [selectedOrders, setSelectedOrders] = useState(new Set());
  const [showExportDropdown, setShowExportDropdown] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  // Close export dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (showExportDropdown && !event.target.closest('.export-dropdown')) {
        setShowExportDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showExportDropdown]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [ordersRes, seasonsRes, brandsRes, locationsRes] = await Promise.all([
        api.get('/orders'),
        api.get('/seasons'),
        api.get('/brands'),
        api.get('/locations')
      ]);
      setOrders(ordersRes.data.orders || []);
      setSeasons(seasonsRes.data.seasons || []);
      setBrands(brandsRes.data.brands || []);
      setLocations(locationsRes.data.locations || []);
    } catch (err) {
      console.error('Error fetching data:', err);
      setError('Failed to load orders');
    } finally {
      setLoading(false);
    }
  };

  // Filter orders
  const filteredOrders = orders.filter(order => {
    if (selectedSeason && order.season_id !== parseInt(selectedSeason)) return false;
    if (selectedBrand && order.brand_id !== parseInt(selectedBrand)) return false;
    if (selectedLocation && order.location_id !== parseInt(selectedLocation)) return false;
    if (selectedStatus && order.status !== selectedStatus) return false;
    return true;
  });

  // Group orders by season, then by secondary grouping based on sortMode
  const groupedBySeason = filteredOrders.reduce((acc, order) => {
    const seasonKey = order.season_id || 'no-season';
    if (!acc[seasonKey]) {
      acc[seasonKey] = {
        seasonId: order.season_id,
        seasonName: order.season_name || 'No Season',
        groups: {}
      };
    }

    let groupKey, groupName;
    if (sortMode === 'shipDate') {
      groupKey = order.ship_date || 'no-date';
      groupName = order.ship_date ? new Date(order.ship_date).toLocaleDateString() : 'No Ship Date';
    } else if (sortMode === 'location') {
      groupKey = order.location_id || 'no-location';
      groupName = order.location_name ? `${order.location_name}${order.location_code ? ` (${order.location_code})` : ''}` : 'No Location';
    } else {
      // default: brand
      groupKey = order.brand_id || 'no-brand';
      groupName = order.brand_name || 'No Brand';
    }

    if (!acc[seasonKey].groups[groupKey]) {
      acc[seasonKey].groups[groupKey] = {
        groupKey,
        groupName,
        orders: []
      };
    }

    acc[seasonKey].groups[groupKey].orders.push(order);
    return acc;
  }, {});

  // Sort groups within each season
  Object.values(groupedBySeason).forEach(season => {
    const sortedGroups = {};
    const groupKeys = Object.keys(season.groups).sort((a, b) => {
      if (sortMode === 'shipDate') {
        // Sort by date, no-date at the end
        if (a === 'no-date') return 1;
        if (b === 'no-date') return -1;
        return new Date(a) - new Date(b);
      }
      // Sort alphabetically for brand and location
      return season.groups[a].groupName.localeCompare(season.groups[b].groupName);
    });
    groupKeys.forEach(key => {
      sortedGroups[key] = season.groups[key];
    });
    season.groups = sortedGroups;
  });

  const toggleSeasonCollapse = (seasonId) => {
    setCollapsedSeasons(prev => ({
      ...prev,
      [seasonId]: !prev[seasonId]
    }));
  };

  const toggleBrandCollapse = (seasonId, brandId) => {
    const key = `${seasonId}_${brandId}`;
    setCollapsedBrands(prev => ({
      ...prev,
      [key]: prev[key] === undefined ? false : !prev[key] // default is true (collapsed), so first click sets to false (expanded)
    }));
  };

  const isBrandCollapsed = (seasonId, brandId) => {
    const key = `${seasonId}_${brandId}`;
    return collapsedBrands[key] === undefined ? true : collapsedBrands[key]; // default collapsed
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
      case 'approved':
        return 'bg-green-100 text-green-800';
      case 'ordered':
        return 'bg-purple-100 text-purple-800';
      case 'received':
        return 'bg-teal-100 text-teal-800';
      case 'cancelled':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const clearFilters = () => {
    setSelectedSeason('');
    setSelectedBrand('');
    setSelectedLocation('');
    setSelectedStatus('');
  };

  // Calculate totals for a group of orders
  const calculateGroupTotals = (orderList) => {
    return orderList.reduce((sum, order) => sum + (parseFloat(order.current_total) || 0), 0);
  };

  // Toggle order selection
  const toggleOrderSelection = (orderId, e) => {
    e.stopPropagation();
    const newSelected = new Set(selectedOrders);
    if (newSelected.has(orderId)) {
      newSelected.delete(orderId);
    } else {
      newSelected.add(orderId);
    }
    setSelectedOrders(newSelected);
  };

  // Select all filtered orders
  const selectAllFiltered = () => {
    const allIds = new Set(filteredOrders.map(o => o.id));
    setSelectedOrders(allIds);
  };

  // Clear selection
  const clearSelection = () => {
    setSelectedOrders(new Set());
  };

  // Handle bulk export
  const handleBulkExport = async (template, format) => {
    if (selectedOrders.size === 0) return;

    setExporting(true);
    setShowExportDropdown(false);
    try {
      const response = await api.post('/exports/orders/bulk', {
        orderIds: Array.from(selectedOrders),
        template,
        format
      }, {
        responseType: 'blob'
      });

      // Create download link
      const blob = new Blob([response.data], {
        type: format === 'csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `orders_bulk_${template}.${format}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error exporting orders:', err);
      setError('Failed to export orders');
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex justify-center items-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Orders</h1>
          <p className="mt-2 text-sm text-gray-600">
            View and manage all orders across seasons and brands
          </p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-md p-4">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        {/* Filters */}
        <div className="bg-white p-4 rounded-lg shadow">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Season
              </label>
              <select
                value={selectedSeason}
                onChange={(e) => setSelectedSeason(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All Seasons</option>
                {seasons.map((season) => (
                  <option key={season.id} value={season.id}>
                    {season.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Brand
              </label>
              <select
                value={selectedBrand}
                onChange={(e) => setSelectedBrand(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All Brands</option>
                {brands.map((brand) => (
                  <option key={brand.id} value={brand.id}>
                    {brand.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Location
              </label>
              <select
                value={selectedLocation}
                onChange={(e) => setSelectedLocation(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All Locations</option>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name} {location.code && `(${location.code})`}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Status
              </label>
              <select
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500"
              >
                <option value="">All Statuses</option>
                <option value="draft">Draft</option>
                <option value="submitted">Submitted</option>
                <option value="approved">Approved</option>
                <option value="ordered">Ordered</option>
                <option value="received">Received</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>

            <div className="flex items-end">
              <button
                onClick={clearFilters}
                className="w-full px-3 py-2 text-sm text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Clear Filters
              </button>
            </div>
          </div>

          {/* Results summary and sort toggle */}
          <div className="mt-4 pt-4 border-t border-gray-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <p className="text-sm text-gray-600">
              Showing <span className="font-medium">{filteredOrders.length}</span> orders
              {filteredOrders.length !== orders.length && (
                <span> (filtered from {orders.length} total)</span>
              )}
              {' '}&bull;{' '}
              Total Value: <span className="font-medium">{formatCurrency(calculateGroupTotals(filteredOrders))}</span>
            </p>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">Group by:</span>
              <div className="inline-flex rounded-md shadow-sm">
                <button
                  onClick={() => setSortMode('brand')}
                  className={`px-3 py-1.5 text-sm font-medium rounded-l-md border ${
                    sortMode === 'brand'
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  Brand
                </button>
                <button
                  onClick={() => setSortMode('shipDate')}
                  className={`px-3 py-1.5 text-sm font-medium border-t border-b ${
                    sortMode === 'shipDate'
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  Ship Date
                </button>
                <button
                  onClick={() => setSortMode('location')}
                  className={`px-3 py-1.5 text-sm font-medium rounded-r-md border ${
                    sortMode === 'location'
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  Location
                </button>
              </div>
            </div>
          </div>

          {/* Selection and Export */}
          <div className="mt-4 pt-4 border-t border-gray-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-3">
              <button
                onClick={selectedOrders.size === filteredOrders.length ? clearSelection : selectAllFiltered}
                className="text-sm text-blue-600 hover:text-blue-800"
              >
                {selectedOrders.size === filteredOrders.length && filteredOrders.length > 0
                  ? 'Deselect All'
                  : 'Select All'}
              </button>
              {selectedOrders.size > 0 && (
                <span className="text-sm text-gray-600">
                  {selectedOrders.size} order{selectedOrders.size !== 1 ? 's' : ''} selected
                </span>
              )}
            </div>

            {/* Export Dropdown */}
            <div className="relative export-dropdown">
              <button
                onClick={() => setShowExportDropdown(!showExportDropdown)}
                disabled={exporting || selectedOrders.size === 0}
                className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-400 flex items-center text-sm"
              >
                {exporting ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Exporting...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Export Selected
                    <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </>
                )}
              </button>
              {showExportDropdown && (
                <div className="absolute right-0 mt-2 w-56 bg-white rounded-md shadow-lg ring-1 ring-black ring-opacity-5 z-50">
                  <div className="py-1">
                    <div className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50">
                      NuOrder Format
                    </div>
                    <button
                      onClick={() => handleBulkExport('nuorder', 'xlsx')}
                      className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      Excel (.xlsx)
                    </button>
                    <button
                      onClick={() => handleBulkExport('nuorder', 'csv')}
                      className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      CSV (.csv)
                    </button>
                    <div className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50">
                      Elastic Format
                    </div>
                    <button
                      onClick={() => handleBulkExport('elastic', 'xlsx')}
                      className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      Excel (.xlsx)
                    </button>
                    <button
                      onClick={() => handleBulkExport('elastic', 'csv')}
                      className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      CSV (.csv)
                    </button>
                    <div className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50">
                      Standard Format
                    </div>
                    <button
                      onClick={() => handleBulkExport('standard', 'xlsx')}
                      className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      Excel (.xlsx)
                    </button>
                    <button
                      onClick={() => handleBulkExport('standard', 'csv')}
                      className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      CSV (.csv)
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* No Orders */}
        {filteredOrders.length === 0 && (
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <svg
              className="mx-auto h-12 w-12 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"
              />
            </svg>
            <h3 className="mt-2 text-sm font-medium text-gray-900">No orders found</h3>
            <p className="mt-1 text-sm text-gray-500">
              {orders.length === 0
                ? 'Get started by creating an order from the Seasons page.'
                : 'Try adjusting your filters to find orders.'}
            </p>
          </div>
        )}

        {/* Orders grouped by Season then by selected grouping */}
        {Object.entries(groupedBySeason).map(([seasonKey, seasonGroup]) => {
          const isCollapsed = collapsedSeasons[seasonKey];
          const seasonOrderCount = Object.values(seasonGroup.groups).reduce(
            (sum, group) => sum + group.orders.length,
            0
          );
          const seasonTotal = Object.values(seasonGroup.groups).reduce(
            (sum, group) => sum + calculateGroupTotals(group.orders),
            0
          );

          return (
            <div key={seasonKey} className="bg-white rounded-lg shadow overflow-hidden">
              {/* Season Header */}
              <button
                onClick={() => toggleSeasonCollapse(seasonKey)}
                className="w-full px-6 py-4 bg-gray-50 border-b border-gray-200 flex items-center justify-between hover:bg-gray-100 transition-colors"
              >
                <div className="flex items-center space-x-3">
                  <svg
                    className={`w-5 h-5 text-gray-500 transform transition-transform ${
                      isCollapsed ? '' : 'rotate-90'
                    }`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  <h2 className="text-lg font-semibold text-gray-900">
                    {seasonGroup.seasonName}
                  </h2>
                </div>
                <div className="flex items-center space-x-4 text-sm">
                  <span className="text-gray-600">
                    {seasonOrderCount} order{seasonOrderCount !== 1 ? 's' : ''}
                  </span>
                  <span className="font-medium text-gray-900">
                    {formatCurrency(seasonTotal)}
                  </span>
                </div>
              </button>

              {/* Season Content */}
              {!isCollapsed && (
                <div className="divide-y divide-gray-200">
                  {Object.entries(seasonGroup.groups).map(([groupKey, group]) => {
                    const groupTotal = calculateGroupTotals(group.orders);
                    const groupCollapsed = isBrandCollapsed(seasonKey, groupKey);

                    return (
                      <div key={groupKey} className="border-b border-gray-100 last:border-b-0">
                        {/* Group Header - Clickable */}
                        <button
                          onClick={() => toggleBrandCollapse(seasonKey, groupKey)}
                          className="w-full px-6 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
                        >
                          <div className="flex items-center space-x-2">
                            <svg
                              className={`w-4 h-4 text-gray-400 transform transition-transform ${
                                groupCollapsed ? '' : 'rotate-90'
                              }`}
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                            <h3 className="font-medium text-gray-900">
                              {group.groupName}
                            </h3>
                          </div>
                          <div className="text-sm text-gray-600">
                            {group.orders.length} order{group.orders.length !== 1 ? 's' : ''} &bull;{' '}
                            <span className="font-medium">{formatCurrency(groupTotal)}</span>
                          </div>
                        </button>

                        {/* Orders Table - Collapsible */}
                        {!groupCollapsed && (
                          <div className="px-6 pb-4 overflow-x-auto">
                            <table className="min-w-full">
                              <thead>
                                <tr className="text-left text-xs font-medium text-gray-500 uppercase">
                                  <th className="pb-2 pl-2 w-8"></th>
                                  <th className="pb-2">Order #</th>
                                  {sortMode !== 'brand' && <th className="pb-2">Brand</th>}
                                  {sortMode !== 'location' && <th className="pb-2">Location</th>}
                                  {sortMode !== 'shipDate' && <th className="pb-2">Ship Date</th>}
                                  <th className="pb-2">Items</th>
                                  <th className="pb-2">Status</th>
                                  <th className="pb-2 text-right">Total</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100">
                                {group.orders.map((order) => (
                                  <tr
                                    key={order.id}
                                    onClick={() => navigate(`/orders/${order.id}`)}
                                    className={`cursor-pointer hover:bg-gray-50 transition-colors ${
                                      selectedOrders.has(order.id) ? 'bg-blue-50' : ''
                                    }`}
                                  >
                                    <td className="py-3 pl-2">
                                      <input
                                        type="checkbox"
                                        checked={selectedOrders.has(order.id)}
                                        onChange={(e) => toggleOrderSelection(order.id, e)}
                                        onClick={(e) => e.stopPropagation()}
                                        className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                                      />
                                    </td>
                                    <td className="py-3 text-sm font-medium text-blue-600">
                                      {order.order_number}
                                    </td>
                                    {sortMode !== 'brand' && (
                                      <td className="py-3 text-sm text-gray-900">
                                        {order.brand_name}
                                      </td>
                                    )}
                                    {sortMode !== 'location' && (
                                      <td className="py-3 text-sm text-gray-900">
                                        {order.location_name}
                                        {order.location_code && (
                                          <span className="text-gray-500"> ({order.location_code})</span>
                                        )}
                                      </td>
                                    )}
                                    {sortMode !== 'shipDate' && (
                                      <td className="py-3 text-sm text-gray-600">
                                        {order.ship_date
                                          ? new Date(order.ship_date).toLocaleDateString()
                                          : 'Not set'}
                                      </td>
                                    )}
                                    <td className="py-3 text-sm text-gray-600">
                                      {order.item_count || 0}
                                    </td>
                                    <td className="py-3">
                                      <span
                                        className={`px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(
                                          order.status
                                        )}`}
                                      >
                                        {order.status}
                                      </span>
                                    </td>
                                    <td className="py-3 text-sm font-medium text-gray-900 text-right">
                                      {formatCurrency(order.current_total)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Layout>
  );
};

export default Orders;
