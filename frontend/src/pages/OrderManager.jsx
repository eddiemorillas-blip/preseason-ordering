import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api, { brandTemplateAPI } from '../services/api';
import Layout from '../components/Layout';
import { useAuth } from '../context/AuthContext';

// Simple SVG Pie Chart Component
const PieChart = ({ data, colors }) => {
  const total = data.reduce((sum, item) => sum + parseInt(item.quantity), 0);
  let cumulativePercent = 0;

  const getCoordinatesForPercent = (percent) => {
    const x = Math.cos(2 * Math.PI * percent);
    const y = Math.sin(2 * Math.PI * percent);
    return [x, y];
  };

  const slices = data.map((item, index) => {
    const percent = parseInt(item.quantity) / total;
    const [startX, startY] = getCoordinatesForPercent(cumulativePercent);
    cumulativePercent += percent;
    const [endX, endY] = getCoordinatesForPercent(cumulativePercent);
    const largeArcFlag = percent > 0.5 ? 1 : 0;

    const pathData = [
      `M ${startX} ${startY}`,
      `A 1 1 0 ${largeArcFlag} 1 ${endX} ${endY}`,
      `L 0 0`,
    ].join(' ');

    return {
      path: pathData,
      color: colors[index % colors.length],
      name: item.name,
      quantity: parseInt(item.quantity),
      percent: (percent * 100).toFixed(1)
    };
  });

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="-1.1 -1.1 2.2 2.2" className="w-28 h-28 transform -rotate-90">
        {slices.map((slice, index) => (
          <path
            key={index}
            d={slice.path}
            fill={slice.color}
            className="hover:opacity-80 transition-opacity"
          />
        ))}
      </svg>
      <div className="mt-2 space-y-1 w-full">
        {slices.slice(0, 5).map((slice, index) => (
          <div key={index} className="flex items-center justify-between text-xs">
            <div className="flex items-center">
              <div
                className="w-2.5 h-2.5 rounded-sm mr-1.5 flex-shrink-0"
                style={{ backgroundColor: slice.color }}
              />
              <span className="text-gray-600 truncate max-w-[80px]">{slice.name}</span>
            </div>
            <span className="text-gray-900 font-medium ml-2">{slice.percent}%</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const OrderManager = () => {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isAdmin, isBuyer } = useAuth();

  // State
  const [seasons, setSeasons] = useState([]);
  const [brands, setBrands] = useState([]);
  const [locations, setLocations] = useState([]);
  const [orders, setOrders] = useState([]);
  const [productBreakdown, setProductBreakdown] = useState(null);
  const [brandTemplates, setBrandTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Filters from URL
  const selectedSeasonId = searchParams.get('season') || '';
  const selectedBrandId = searchParams.get('brand') || '';
  const selectedLocationId = searchParams.get('location') || '';
  const selectedStatus = searchParams.get('status') || '';

  // UI State
  const [orderGroupBy, setOrderGroupBy] = useState('brand');
  const [showExportDropdown, setShowExportDropdown] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [showCreateSeasonModal, setShowCreateSeasonModal] = useState(false);
  const [showAddOrderModal, setShowAddOrderModal] = useState(false);
  const [showBudgetModal, setShowBudgetModal] = useState(false);
  const [orderToDelete, setOrderToDelete] = useState(null);
  const [seasonToDelete, setSeasonToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [selectedOrders, setSelectedOrders] = useState(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState(new Set());
  const [showBulkStatusDropdown, setShowBulkStatusDropdown] = useState(false);
  const [updatingBulkStatus, setUpdatingBulkStatus] = useState(false);

  const [newSeason, setNewSeason] = useState({
    name: '',
    start_date: '',
    end_date: '',
    status: 'planning'
  });

  // Fetch initial data
  useEffect(() => {
    fetchInitialData();
  }, []);

  // Fetch orders when filters change
  useEffect(() => {
    if (selectedSeasonId) {
      fetchOrdersAndBreakdown();
    } else {
      setOrders([]);
      setProductBreakdown(null);
    }
  }, [selectedSeasonId, selectedBrandId, selectedLocationId, selectedStatus]);

  // Fetch brand templates when brand filter changes
  useEffect(() => {
    if (selectedBrandId) {
      fetchBrandTemplates();
    } else {
      setBrandTemplates([]);
    }
  }, [selectedBrandId]);

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (showExportDropdown && !event.target.closest('.export-dropdown')) {
        setShowExportDropdown(false);
      }
      if (showBulkStatusDropdown && !event.target.closest('.bulk-status-dropdown')) {
        setShowBulkStatusDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showExportDropdown, showBulkStatusDropdown]);

  const fetchInitialData = async () => {
    try {
      setLoading(true);
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
      console.error('Error fetching data:', err);
      setError('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const fetchOrdersAndBreakdown = async () => {
    try {
      let ordersQuery = `/orders?seasonId=${selectedSeasonId}`;
      let breakdownQuery = `/seasons/${selectedSeasonId}/product-breakdown`;

      if (selectedBrandId) {
        ordersQuery += `&brandId=${selectedBrandId}`;
        breakdownQuery += `?brandId=${selectedBrandId}`;
      }
      if (selectedLocationId) {
        ordersQuery += `&locationId=${selectedLocationId}`;
      }
      if (selectedStatus) {
        ordersQuery += `&status=${selectedStatus}`;
      }

      const [ordersRes, breakdownRes] = await Promise.all([
        api.get(ordersQuery),
        api.get(breakdownQuery)
      ]);

      setOrders(ordersRes.data.orders || []);
      setProductBreakdown(breakdownRes.data);
    } catch (err) {
      console.error('Error fetching orders:', err);
    }
  };

  const fetchBrandTemplates = async () => {
    try {
      const res = await brandTemplateAPI.getAll(selectedBrandId);
      setBrandTemplates(res.data?.templates || []);
    } catch (err) {
      console.error('Error fetching brand templates:', err);
    }
  };

  // Filter setters
  const updateFilter = (key, value) => {
    const params = new URLSearchParams(searchParams);
    if (value) {
      params.set(key, value);
    } else {
      params.delete(key);
    }
    // Clear selection when filters change
    setSelectedOrders(new Set());
    setSearchParams(params);
  };

  const clearFilters = () => {
    setSearchParams(selectedSeasonId ? { season: selectedSeasonId } : {});
    setSelectedOrders(new Set());
  };

  // Helpers
  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount || 0);
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'planning': return 'bg-blue-100 text-blue-800';
      case 'ordering': return 'bg-green-100 text-green-800';
      case 'closed': return 'bg-gray-100 text-gray-800';
      case 'draft': return 'bg-gray-100 text-gray-800';
      case 'submitted': return 'bg-blue-100 text-blue-800';
      case 'approved':
      case 'confirmed': return 'bg-green-100 text-green-800';
      case 'ordered': return 'bg-purple-100 text-purple-800';
      case 'received': return 'bg-teal-100 text-teal-800';
      case 'cancelled': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const selectedSeason = seasons.find(s => s.id === parseInt(selectedSeasonId));
  const selectedBrand = brands.find(b => b.id === parseInt(selectedBrandId));

  // Calculate totals
  const totalValue = orders.reduce((sum, o) => sum + (parseFloat(o.current_total) || 0), 0);
  const totalItems = orders.reduce((sum, o) => sum + (parseInt(o.item_count) || 0), 0);

  // Group orders
  const groupedOrders = orders.reduce((acc, order) => {
    let key, groupName;
    if (orderGroupBy === 'shipDate') {
      key = order.ship_date || 'no-date';
      groupName = order.ship_date ? new Date(order.ship_date).toLocaleDateString() : 'No Ship Date';
    } else if (orderGroupBy === 'location') {
      key = order.location_id || 'no-location';
      groupName = order.location_name ? `${order.location_name}${order.location_code ? ` (${order.location_code})` : ''}` : 'No Location';
    } else {
      // Group by brand AND location so each group is brand-specific at a location
      key = `${order.brand_id || 'no-brand'}-${order.location_id || 'no-location'}`;
      const locationPart = order.location_code ? ` (${order.location_code})` : '';
      groupName = `${order.brand_name || 'No Brand'} - ${order.location_name || 'No Location'}${locationPart}`;
    }

    if (!acc[key]) {
      acc[key] = { groupName, orders: [] };
    }
    acc[key].orders.push(order);
    return acc;
  }, {});

  // Sort groups
  const sortedGroups = Object.entries(groupedOrders).sort((a, b) => {
    if (orderGroupBy === 'shipDate') {
      if (a[0] === 'no-date') return 1;
      if (b[0] === 'no-date') return -1;
      return new Date(a[0]) - new Date(b[0]);
    }
    return a[1].groupName.localeCompare(b[1].groupName);
  });


  // Selection handlers
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

  const selectAllOrders = () => {
    if (selectedOrders.size === orders.length) {
      setSelectedOrders(new Set());
    } else {
      setSelectedOrders(new Set(orders.map(o => o.id)));
    }
  };

  const toggleGroupSelection = (groupOrders) => {
    const groupIds = groupOrders.map(o => o.id);
    const allSelected = groupIds.every(id => selectedOrders.has(id));
    const newSelected = new Set(selectedOrders);

    if (allSelected) {
      // Deselect all in group
      groupIds.forEach(id => newSelected.delete(id));
    } else {
      // Select all in group
      groupIds.forEach(id => newSelected.add(id));
    }
    setSelectedOrders(newSelected);
  };

  const isGroupFullySelected = (groupOrders) => {
    return groupOrders.length > 0 && groupOrders.every(o => selectedOrders.has(o.id));
  };

  const isGroupPartiallySelected = (groupOrders) => {
    const selectedCount = groupOrders.filter(o => selectedOrders.has(o.id)).length;
    return selectedCount > 0 && selectedCount < groupOrders.length;
  };

  // Bulk status update
  const handleBulkStatusUpdate = async (newStatus) => {
    if (selectedOrders.size === 0) return;

    setUpdatingBulkStatus(true);
    try {
      const orderIds = Array.from(selectedOrders);
      await Promise.all(orderIds.map(id =>
        api.patch(`/orders/${id}`, { status: newStatus })
      ));

      // Update local state
      setOrders(orders.map(order =>
        selectedOrders.has(order.id)
          ? { ...order, status: newStatus }
          : order
      ));

      setSelectedOrders(new Set());
      setShowBulkStatusDropdown(false);
    } catch (error) {
      console.error('Error updating order statuses:', error);
      alert('Failed to update some orders. Please try again.');
    } finally {
      setUpdatingBulkStatus(false);
    }
  };

  const toggleGroupCollapse = (groupKey) => {
    const newCollapsed = new Set(collapsedGroups);
    if (newCollapsed.has(groupKey)) {
      newCollapsed.delete(groupKey);
    } else {
      newCollapsed.add(groupKey);
    }
    setCollapsedGroups(newCollapsed);
  };

  const toggleAllGroups = () => {
    const groupKeys = sortedGroups.map(([key]) => key);
    if (collapsedGroups.size === groupKeys.length) {
      // All collapsed, expand all
      setCollapsedGroups(new Set());
    } else {
      // Some or none collapsed, collapse all
      setCollapsedGroups(new Set(groupKeys));
    }
  };

  const allGroupsCollapsed = sortedGroups.length > 0 && collapsedGroups.size === sortedGroups.length;

  // Get unique brands from selected orders
  const getSelectedOrdersBrands = () => {
    const selectedOrdersList = orders.filter(o => selectedOrders.has(o.id));
    const uniqueBrands = [...new Set(selectedOrdersList.map(o => o.brand_id))];
    return uniqueBrands;
  };

  const selectedBrandIds = getSelectedOrdersBrands();
  const hasMultipleBrands = selectedBrandIds.length > 1;
  const selectedOrderBrand = selectedBrandIds.length === 1
    ? brands.find(b => b.id === selectedBrandIds[0])
    : null;

  // Season CRUD
  const handleCreateSeason = async (e) => {
    e.preventDefault();
    try {
      const res = await api.post('/seasons', newSeason);
      setShowCreateSeasonModal(false);
      setNewSeason({ name: '', start_date: '', end_date: '', status: 'planning' });
      await fetchInitialData();
      setSearchParams({ season: res.data.season.id.toString() });
    } catch (err) {
      console.error('Error creating season:', err);
      setError(err.response?.data?.error || 'Failed to create season');
    }
  };

  const handleDeleteSeason = async () => {
    if (!seasonToDelete) return;
    setDeleting(true);
    try {
      await api.delete(`/seasons/${seasonToDelete.id}`);
      setSeasonToDelete(null);
      if (selectedSeasonId === seasonToDelete.id.toString()) {
        setSearchParams({});
      }
      await fetchInitialData();
    } catch (err) {
      console.error('Error deleting season:', err);
      setError(err.response?.data?.error || 'Failed to delete season');
    } finally {
      setDeleting(false);
    }
  };

  const handleStatusChange = async (seasonId, newStatus) => {
    try {
      await api.patch(`/seasons/${seasonId}`, { status: newStatus });
      fetchInitialData();
    } catch (err) {
      console.error('Error updating season status:', err);
      setError('Failed to update season status');
    }
  };

  // Order delete
  const handleDeleteOrder = async () => {
    if (!orderToDelete) return;
    setDeleting(true);
    try {
      await api.delete(`/orders/${orderToDelete.id}`);
      setOrderToDelete(null);
      fetchOrdersAndBreakdown();
    } catch (err) {
      console.error('Error deleting order:', err);
      setError(err.response?.data?.error || 'Failed to delete order');
    } finally {
      setDeleting(false);
    }
  };

  // Export handlers - exports only selected orders (must be single brand)
  const handleExport = async (template, format) => {
    if (selectedOrders.size === 0 || hasMultipleBrands) return;

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

      const blob = new Blob([response.data], {
        type: format === 'csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
      const urlObj = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = urlObj;
      const safeName = selectedSeason?.name?.replace(/[^a-zA-Z0-9]/g, '_') || 'orders';
      const brandName = selectedOrderBrand?.name?.replace(/[^a-zA-Z0-9]/g, '_') || 'brand';
      link.download = `${safeName}_${brandName}_${template}.${format}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(urlObj);
    } catch (err) {
      console.error('Error exporting:', err);
      setError('Failed to export data');
    } finally {
      setExporting(false);
    }
  };

  const handleBrandTemplateExport = async (template) => {
    if (selectedOrders.size === 0 || hasMultipleBrands) return;

    setExporting(true);
    setShowExportDropdown(false);
    try {
      const orderIds = Array.from(selectedOrders);

      const response = await brandTemplateAPI.exportWithTemplate(orderIds, template.id);

      const blob = new Blob([response.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
      const urlObj = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = urlObj;
      const safeName = selectedSeason?.name?.replace(/[^a-zA-Z0-9]/g, '_') || 'orders';
      const brandName = selectedOrderBrand?.name?.replace(/[^a-zA-Z0-9]/g, '_') || 'brand';
      link.download = `${safeName}_${brandName}_${template.name.replace(/[^a-zA-Z0-9]/g, '_')}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(urlObj);
    } catch (err) {
      console.error('Error exporting with brand template:', err);
      setError('Failed to export with brand template');
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
      <div className="space-y-4">
        {/* Header */}
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Order Builder</h1>
            <p className="text-sm text-gray-600">
              Manage orders across seasons and brands
            </p>
          </div>
          <div className="flex gap-2">
            {isAdmin() && (
              <button
                onClick={() => setShowCreateSeasonModal(true)}
                className="px-3 py-2 text-sm bg-gray-600 text-white rounded-md hover:bg-gray-700"
              >
                + New Season
              </button>
            )}
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-md p-3">
            <p className="text-sm text-red-800">{error}</p>
            <button onClick={() => setError('')} className="text-xs text-red-600 underline mt-1">Dismiss</button>
          </div>
        )}

        {/* Season Tabs */}
        <div className="bg-white rounded-lg shadow">
          <div className="border-b border-gray-200">
            <div className="flex items-center justify-between px-4">
              <div className="flex overflow-x-auto">
                {seasons.map((season) => (
                  <button
                    key={season.id}
                    onClick={() => updateFilter('season', season.id.toString())}
                    className={`px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap ${
                      selectedSeasonId === season.id.toString()
                        ? 'border-blue-600 text-blue-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }`}
                  >
                    {season.name}
                    <span className={`ml-2 px-1.5 py-0.5 text-xs rounded-full ${getStatusColor(season.status)}`}>
                      {season.status}
                    </span>
                  </button>
                ))}
              </div>
              {selectedSeason && isAdmin() && (
                <div className="flex items-center gap-2 py-2">
                  <select
                    value={selectedSeason.status}
                    onChange={(e) => handleStatusChange(selectedSeason.id, e.target.value)}
                    className="text-xs border rounded px-2 py-1"
                  >
                    <option value="planning">Planning</option>
                    <option value="ordering">Ordering</option>
                    <option value="closed">Closed</option>
                  </select>
                  <button
                    onClick={() => setSeasonToDelete(selectedSeason)}
                    className="p-1 text-red-600 hover:bg-red-50 rounded"
                    title="Delete season"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* No season selected */}
          {!selectedSeasonId && seasons.length === 0 && (
            <div className="p-12 text-center">
              <h3 className="text-sm font-medium text-gray-900">No seasons found</h3>
              <p className="mt-1 text-sm text-gray-500">
                {isAdmin() ? (
                  <button onClick={() => setShowCreateSeasonModal(true)} className="text-blue-600 hover:text-blue-800">
                    Create a season to get started
                  </button>
                ) : (
                  'Contact an admin to create a season.'
                )}
              </p>
            </div>
          )}

          {/* Season Content */}
          {selectedSeasonId && (
            <div className="p-4 space-y-4">
              {/* Filters Row */}
              <div className="flex flex-wrap gap-3 items-end">
                <div className="min-w-[150px]">
                  <label className="block text-xs font-medium text-gray-700 mb-1">Brand</label>
                  <select
                    value={selectedBrandId}
                    onChange={(e) => updateFilter('brand', e.target.value)}
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-md"
                  >
                    <option value="">All Brands</option>
                    {brands.filter(b => b.active !== false).map((brand) => (
                      <option key={brand.id} value={brand.id}>{brand.name}</option>
                    ))}
                  </select>
                </div>
                <div className="min-w-[150px]">
                  <label className="block text-xs font-medium text-gray-700 mb-1">Location</label>
                  <select
                    value={selectedLocationId}
                    onChange={(e) => updateFilter('location', e.target.value)}
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-md"
                  >
                    <option value="">All Locations</option>
                    {locations.map((loc) => (
                      <option key={loc.id} value={loc.id}>{loc.name} ({loc.code})</option>
                    ))}
                  </select>
                </div>
                <div className="min-w-[120px]">
                  <label className="block text-xs font-medium text-gray-700 mb-1">Status</label>
                  <select
                    value={selectedStatus}
                    onChange={(e) => updateFilter('status', e.target.value)}
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-md"
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
                {(selectedBrandId || selectedLocationId || selectedStatus) && (
                  <button
                    onClick={clearFilters}
                    className="px-2 py-1.5 text-sm text-gray-600 hover:text-gray-800"
                  >
                    Clear
                  </button>
                )}
                <div className="flex-1"></div>
                <div className="flex gap-2">
                  {(isAdmin() || isBuyer()) && (
                    <>
                      <button
                        onClick={() => setShowBudgetModal(true)}
                        className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-md hover:bg-gray-200"
                      >
                        Budgets
                      </button>
                      <button
                        onClick={() => setShowAddOrderModal(true)}
                        className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700"
                      >
                        + Add Order
                      </button>
                    </>
                  )}
                  {/* Export Dropdown */}
                  <div className="relative export-dropdown">
                    <button
                      onClick={() => setShowExportDropdown(!showExportDropdown)}
                      disabled={exporting || selectedOrders.size === 0 || hasMultipleBrands}
                      className="px-3 py-1.5 text-sm bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-400 flex items-center"
                      title={hasMultipleBrands ? 'Select orders from a single brand to export' : ''}
                    >
                      {exporting ? 'Exporting...' : hasMultipleBrands ? 'Select Single Brand' : `Export${selectedOrders.size > 0 ? ` (${selectedOrders.size})` : ''}`}
                      <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    {showExportDropdown && (
                      <div className="absolute right-0 mt-1 w-48 bg-white rounded-md shadow-lg ring-1 ring-black ring-opacity-5 z-50 max-h-80 overflow-y-auto">
                        <div className="py-1">
                          {brandTemplates.length > 0 && (
                            <>
                              <div className="px-3 py-1.5 text-xs font-semibold text-blue-600 uppercase bg-blue-50">
                                {selectedBrand?.name || selectedOrderBrand?.name} Templates
                              </div>
                              {brandTemplates.map(template => (
                                <button
                                  key={template.id}
                                  onClick={() => handleBrandTemplateExport(template)}
                                  className="block w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-blue-50"
                                >
                                  {template.name}
                                </button>
                              ))}
                              <div className="border-t border-gray-200 my-1"></div>
                            </>
                          )}
                          <div className="px-3 py-1.5 text-xs font-semibold text-gray-500 uppercase bg-gray-50">NuOrder</div>
                          <button onClick={() => handleExport('nuorder', 'xlsx')} className="block w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-100">Excel</button>
                          <button onClick={() => handleExport('nuorder', 'csv')} className="block w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-100">CSV</button>
                          <div className="px-3 py-1.5 text-xs font-semibold text-gray-500 uppercase bg-gray-50">Elastic</div>
                          <button onClick={() => handleExport('elastic', 'xlsx')} className="block w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-100">Excel</button>
                          <button onClick={() => handleExport('elastic', 'csv')} className="block w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-100">CSV</button>
                          <div className="px-3 py-1.5 text-xs font-semibold text-gray-500 uppercase bg-gray-50">Standard</div>
                          <button onClick={() => handleExport('standard', 'xlsx')} className="block w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-100">Excel</button>
                          <button onClick={() => handleExport('standard', 'csv')} className="block w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-100">CSV</button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Stats Summary */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-xs text-gray-500">Orders</p>
                  <p className="text-xl font-semibold text-gray-900">{orders.length}</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-xs text-gray-500">Items</p>
                  <p className="text-xl font-semibold text-gray-900">{totalItems.toLocaleString()}</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-xs text-gray-500">Wholesale</p>
                  <p className="text-xl font-semibold text-blue-600">{formatCurrency(totalValue)}</p>
                </div>
                {productBreakdown?.totals && (
                  <div className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs text-gray-500">Retail Value</p>
                    <p className="text-xl font-semibold text-green-600">{formatCurrency(productBreakdown.totals.retail)}</p>
                  </div>
                )}
              </div>

              {/* Product Breakdown Charts */}
              {productBreakdown && (productBreakdown.gender?.length > 0 || productBreakdown.category?.length > 0) && (
                <div className="grid grid-cols-3 gap-4 py-2">
                  {productBreakdown.gender?.length > 0 && (
                    <div className="text-center">
                      <h4 className="text-xs font-medium text-gray-700 mb-2">By Gender</h4>
                      <PieChart data={productBreakdown.gender} colors={['#2563EB', '#F97316', '#10B981', '#EF4444', '#FBBF24']} />
                    </div>
                  )}
                  {productBreakdown.category?.length > 0 && (
                    <div className="text-center">
                      <h4 className="text-xs font-medium text-gray-700 mb-2">By Category</h4>
                      <PieChart data={productBreakdown.category} colors={['#10B981', '#F97316', '#2563EB', '#EF4444', '#FBBF24']} />
                    </div>
                  )}
                  {productBreakdown.color?.length > 0 && (
                    <div className="text-center">
                      <h4 className="text-xs font-medium text-gray-700 mb-2">By Color</h4>
                      <PieChart data={productBreakdown.color} colors={['#2563EB', '#F97316', '#10B981', '#EF4444', '#FBBF24', '#14B8A6']} />
                    </div>
                  )}
                </div>
              )}

              {/* Orders List Header */}
              <div className="flex items-center justify-between border-t pt-3">
                <div className="flex items-center gap-3">
                  <button
                    onClick={selectAllOrders}
                    className="text-xs text-blue-600 hover:text-blue-800"
                  >
                    {selectedOrders.size === orders.length && orders.length > 0 ? 'Deselect All' : 'Select All'}
                  </button>
                  {selectedOrders.size > 0 && (
                    <>
                      <span className="text-xs text-gray-500">{selectedOrders.size} selected</span>
                      <div className="relative bulk-status-dropdown">
                        <button
                          onClick={() => setShowBulkStatusDropdown(!showBulkStatusDropdown)}
                          disabled={updatingBulkStatus}
                          className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400"
                        >
                          {updatingBulkStatus ? 'Updating...' : 'Set Status ▾'}
                        </button>
                        {showBulkStatusDropdown && (
                          <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-20 min-w-32 overflow-hidden">
                            {['draft', 'submitted', 'confirmed', 'shipped', 'cancelled'].map((status) => (
                              <button
                                key={status}
                                onClick={() => handleBulkStatusUpdate(status)}
                                className="block w-full text-left px-3 py-2 text-sm hover:bg-gray-100"
                              >
                                {status}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                  {orders.length > 0 && (
                    <button
                      onClick={toggleAllGroups}
                      className="text-xs text-blue-600 hover:text-blue-800"
                    >
                      {allGroupsCollapsed ? 'Expand All' : 'Collapse All'}
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">Group by:</span>
                  <div className="inline-flex rounded-md shadow-sm">
                    {['brand', 'shipDate', 'location'].map((mode) => (
                      <button
                        key={mode}
                        onClick={() => setOrderGroupBy(mode)}
                        className={`px-2 py-1 text-xs font-medium border ${
                          mode === 'brand' ? 'rounded-l-md' : mode === 'location' ? 'rounded-r-md' : ''
                        } ${
                          orderGroupBy === mode
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                        }`}
                      >
                        {mode === 'shipDate' ? 'Ship Date' : mode.charAt(0).toUpperCase() + mode.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Orders List */}
              {orders.length === 0 ? (
                <div className="text-center py-8 text-sm text-gray-500">
                  No orders found.{' '}
                  {(isAdmin() || isBuyer()) && (
                    <button onClick={() => setShowAddOrderModal(true)} className="text-blue-600 hover:text-blue-800">
                      Create your first order
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  {sortedGroups.map(([key, group]) => (
                    <div key={key} className="border rounded-lg overflow-hidden">
                      <div
                        className="bg-gray-50 px-3 py-2 flex items-center justify-between cursor-pointer hover:bg-gray-100"
                        onClick={() => toggleGroupCollapse(key)}
                      >
                        <div className="flex items-center gap-2">
                          <svg
                            className={`w-4 h-4 text-gray-500 transition-transform ${collapsedGroups.has(key) ? '' : 'rotate-90'}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                          <input
                            type="checkbox"
                            checked={isGroupFullySelected(group.orders)}
                            ref={(el) => {
                              if (el) el.indeterminate = isGroupPartiallySelected(group.orders);
                            }}
                            onChange={() => toggleGroupSelection(group.orders)}
                            onClick={(e) => e.stopPropagation()}
                            className="h-3.5 w-3.5 text-blue-600 border-gray-300 rounded"
                          />
                          <span className="font-medium text-sm text-gray-900">{group.groupName}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-xs text-gray-500">
                            {group.orders.length} orders &bull; {formatCurrency(group.orders.reduce((s, o) => s + (parseFloat(o.current_total) || 0), 0))}
                          </span>
                          {(isAdmin() || isBuyer()) && group.orders.length > 0 && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                const orderIds = group.orders.map(o => o.id).join(',');
                                const brandId = group.orders[0]?.brand_id;
                                navigate(`/add-products?orderIds=${orderIds}&brandId=${brandId}`);
                              }}
                              className="px-2 py-1 bg-teal-600 text-white text-xs rounded hover:bg-teal-700"
                              title="Add products to all orders in this group"
                            >
                              + Add Products
                            </button>
                          )}
                        </div>
                      </div>
                      {!collapsedGroups.has(key) && (
                      <table className="min-w-full">
                        <tbody className="divide-y divide-gray-100">
                          {group.orders.map((order) => (
                            <tr
                              key={order.id}
                              onClick={() => navigate(`/orders/${order.id}`)}
                              className={`cursor-pointer hover:bg-gray-50 ${selectedOrders.has(order.id) ? 'bg-blue-50' : ''}`}
                            >
                              <td className="py-2 pl-3 w-8">
                                <input
                                  type="checkbox"
                                  checked={selectedOrders.has(order.id)}
                                  onChange={(e) => toggleOrderSelection(order.id, e)}
                                  onClick={(e) => e.stopPropagation()}
                                  className="h-3.5 w-3.5 text-blue-600 border-gray-300 rounded"
                                />
                              </td>
                              <td className="py-2 text-sm font-medium text-blue-600">{order.order_number}</td>
                              {orderGroupBy !== 'brand' && <td className="py-2 text-sm text-gray-900">{order.brand_name}</td>}
                              {orderGroupBy !== 'location' && (
                                <td className="py-2 text-sm text-gray-700">
                                  {order.location_name}
                                  {order.location_code && <span className="text-gray-400"> ({order.location_code})</span>}
                                </td>
                              )}
                              {orderGroupBy !== 'shipDate' && (
                                <td className="py-2 text-sm text-gray-600">
                                  {order.ship_date ? new Date(order.ship_date).toLocaleDateString() : 'No date'}
                                </td>
                              )}
                              <td className="py-2 text-sm text-gray-600">{order.item_count || 0} items</td>
                              <td className="py-2">
                                <span className={`px-1.5 py-0.5 text-xs font-medium rounded-full ${getStatusColor(order.status)}`}>
                                  {order.status}
                                </span>
                              </td>
                              <td className="py-2 pr-3 text-sm font-medium text-gray-900 text-right">
                                {formatCurrency(order.current_total)}
                              </td>
                              {isAdmin() && (
                                <td className="py-2 pr-2 w-8">
                                  <button
                                    onClick={(e) => { e.stopPropagation(); setOrderToDelete(order); }}
                                    className="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded"
                                  >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                    </svg>
                                  </button>
                                </td>
                              )}
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

        {/* Create Season Modal */}
        {showCreateSeasonModal && (
          <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-md w-full">
              <h2 className="text-lg font-bold mb-4">Create New Season</h2>
              <form onSubmit={handleCreateSeason} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Season Name *</label>
                  <input
                    type="text"
                    required
                    value={newSeason.name}
                    onChange={(e) => setNewSeason({ ...newSeason, name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    placeholder="e.g., Fall 2025"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                    <input
                      type="date"
                      value={newSeason.start_date}
                      onChange={(e) => setNewSeason({ ...newSeason, start_date: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
                    <input
                      type="date"
                      value={newSeason.end_date}
                      onChange={(e) => setNewSeason({ ...newSeason, end_date: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    />
                  </div>
                </div>
                <div className="flex justify-end space-x-2 pt-4">
                  <button
                    type="button"
                    onClick={() => { setShowCreateSeasonModal(false); setNewSeason({ name: '', start_date: '', end_date: '', status: 'planning' }); }}
                    className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700">
                    Create
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Add Order Modal */}
        {showAddOrderModal && (
          <AddOrderModal
            seasonId={selectedSeasonId}
            seasonName={selectedSeason?.name}
            preselectedBrandId={selectedBrandId}
            brands={brands}
            locations={locations}
            onClose={() => { setShowAddOrderModal(false); fetchOrdersAndBreakdown(); }}
            onOrderCreated={(orderId) => { setShowAddOrderModal(false); navigate(`/orders/${orderId}`); }}
          />
        )}

        {/* Budget Modal */}
        {showBudgetModal && (
          <BudgetModal
            seasonId={selectedSeasonId}
            brands={brands}
            locations={locations}
            onClose={() => { setShowBudgetModal(false); }}
          />
        )}

        {/* Delete Season Modal */}
        {seasonToDelete && (
          <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-md w-full">
              <h2 className="text-lg font-bold text-gray-900 mb-4">Delete Season</h2>
              <p className="text-gray-600 mb-2">Are you sure you want to delete <strong>{seasonToDelete.name}</strong>?</p>
              <p className="text-sm text-red-600 mb-4">This will permanently remove the season and all associated orders and budgets.</p>
              <div className="flex justify-end space-x-3">
                <button onClick={() => setSeasonToDelete(null)} className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50" disabled={deleting}>Cancel</button>
                <button onClick={handleDeleteSeason} className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:bg-gray-400" disabled={deleting}>
                  {deleting ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Delete Order Modal */}
        {orderToDelete && (
          <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-md w-full">
              <h2 className="text-lg font-bold text-gray-900 mb-4">Delete Order</h2>
              <p className="text-gray-600 mb-2">Are you sure you want to delete order <strong>{orderToDelete.order_number}</strong>?</p>
              <p className="text-sm text-gray-500 mb-1">{orderToDelete.brand_name} &bull; {orderToDelete.location_name}</p>
              <p className="text-sm text-gray-500 mb-4">{orderToDelete.item_count} items &bull; {formatCurrency(orderToDelete.current_total)}</p>
              <p className="text-sm text-red-600 mb-4">This action cannot be undone.</p>
              <div className="flex justify-end space-x-3">
                <button onClick={() => setOrderToDelete(null)} className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50" disabled={deleting}>Cancel</button>
                <button onClick={handleDeleteOrder} className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:bg-gray-400" disabled={deleting}>
                  {deleting ? 'Deleting...' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
};

// Add Order Modal Component
const AddOrderModal = ({ seasonId, seasonName, preselectedBrandId, brands, locations, onClose, onOrderCreated }) => {
  const [formData, setFormData] = useState({
    brand_id: preselectedBrandId || '',
    location_id: '',
    order_type: 'preseason',
    notes: ''
  });
  const [numberOfShips, setNumberOfShips] = useState(1);
  const [shipDates, setShipDates] = useState(['']);
  const [shipDay, setShipDay] = useState(15); // Day of month for auto-generation
  const [startMonth, setStartMonth] = useState(''); // Starting month (YYYY-MM format)
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Generate ship dates based on ship day, start month, and number of ships
  const generateShipDates = (numShips, day, startMonthStr) => {
    if (!startMonthStr || numShips < 1) return Array(numShips).fill('');

    const [startYear, startMonthNum] = startMonthStr.split('-').map(Number);
    const dates = [];

    for (let i = 0; i < numShips; i++) {
      let targetMonth = startMonthNum - 1 + i; // 0-indexed
      let targetYear = startYear;

      // Handle year overflow
      while (targetMonth > 11) {
        targetMonth -= 12;
        targetYear++;
      }

      // Get the last day of the target month
      const lastDayOfMonth = new Date(targetYear, targetMonth + 1, 0).getDate();
      const actualDay = Math.min(day, lastDayOfMonth);

      const date = new Date(targetYear, targetMonth, actualDay);
      dates.push(date.toISOString().split('T')[0]);
    }

    return dates;
  };

  const handleNumberOfShipsChange = (num) => {
    const newNum = Math.max(1, Math.min(12, parseInt(num) || 1));
    setNumberOfShips(newNum);
    if (startMonth) {
      setShipDates(generateShipDates(newNum, shipDay, startMonth));
    } else {
      const newShipDates = [...shipDates];
      while (newShipDates.length < newNum) newShipDates.push('');
      while (newShipDates.length > newNum) newShipDates.pop();
      setShipDates(newShipDates);
    }
  };

  const handleShipDayChange = (day) => {
    const newDay = Math.max(1, Math.min(31, parseInt(day) || 1));
    setShipDay(newDay);
    if (startMonth && numberOfShips > 0) {
      setShipDates(generateShipDates(numberOfShips, newDay, startMonth));
    }
  };

  const handleStartMonthChange = (monthStr) => {
    setStartMonth(monthStr);
    if (monthStr && numberOfShips > 0) {
      setShipDates(generateShipDates(numberOfShips, shipDay, monthStr));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const createdOrderIds = [];
      for (let i = 0; i < numberOfShips; i++) {
        const response = await api.post('/orders', {
          season_id: seasonId,
          brand_id: formData.brand_id,
          location_id: formData.location_id,
          ship_date: shipDates[i] || null,
          order_type: formData.order_type,
          notes: formData.notes
        });
        createdOrderIds.push(response.data.order.id);
      }

      if (createdOrderIds.length === 1) {
        onOrderCreated(createdOrderIds[0]);
      } else {
        onClose();
      }
    } catch (err) {
      console.error('Error creating order:', err);
      setError(err.response?.data?.error || 'Failed to create order');
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-bold mb-2">Create New Order</h2>
        <p className="text-sm text-gray-600 mb-4">Season: {seasonName}</p>

        {error && <div className="mb-4 bg-red-50 border border-red-200 rounded-md p-3"><p className="text-sm text-red-800">{error}</p></div>}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Brand *</label>
            <select
              value={formData.brand_id}
              onChange={(e) => setFormData({ ...formData, brand_id: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
              required
            >
              <option value="">Select Brand</option>
              {brands.filter(b => b.active !== false).map((brand) => (
                <option key={brand.id} value={brand.id}>{brand.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Location *</label>
            <select
              value={formData.location_id}
              onChange={(e) => setFormData({ ...formData, location_id: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
              required
            >
              <option value="">Select Location</option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>{location.name} ({location.code})</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Number of Ship Dates</label>
            <select
              value={numberOfShips}
              onChange={(e) => handleNumberOfShipsChange(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
            >
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
            {numberOfShips > 1 && <p className="mt-1 text-xs text-gray-500">Creates {numberOfShips} separate orders</p>}
          </div>

          {/* Auto-generate ship dates */}
          {numberOfShips > 1 && (
            <div className="bg-gray-50 p-3 rounded-md space-y-3">
              <p className="text-sm font-medium text-gray-700">Auto-generate ship dates</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Ship Day (of month)</label>
                  <input
                    type="number"
                    min="1"
                    max="31"
                    value={shipDay}
                    onChange={(e) => handleShipDayChange(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Start Month</label>
                  <input
                    type="month"
                    value={startMonth}
                    onChange={(e) => handleStartMonthChange(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  />
                </div>
              </div>
              {startMonth && (
                <p className="text-xs text-gray-500">
                  Ships on the {shipDay}{shipDay === 1 ? 'st' : shipDay === 2 ? 'nd' : shipDay === 3 ? 'rd' : 'th'} of each month starting {startMonth}
                </p>
              )}
            </div>
          )}

          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">Ship Dates</label>
            {shipDates.map((date, index) => (
              <div key={index} className="flex items-center gap-2">
                {numberOfShips > 1 && <span className="text-sm text-gray-500 w-14">Ship {index + 1}:</span>}
                <input
                  type="date"
                  value={date}
                  onChange={(e) => {
                    const newDates = [...shipDates];
                    newDates[index] = e.target.value;
                    setShipDates(newDates);
                  }}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md"
                />
              </div>
            ))}
          </div>

          <div className="flex justify-end space-x-2 pt-4 border-t">
            <button type="button" onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50" disabled={loading}>Cancel</button>
            <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400" disabled={loading}>
              {loading ? 'Creating...' : numberOfShips > 1 ? `Create ${numberOfShips} Orders` : 'Create Order'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// Budget Modal Component
const BudgetModal = ({ seasonId, brands, locations, onClose }) => {
  const [budgetEntries, setBudgetEntries] = useState([{ brand_id: '', location_id: '', budget_amount: '' }]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const addEntry = () => setBudgetEntries([...budgetEntries, { brand_id: '', location_id: '', budget_amount: '' }]);
  const removeEntry = (index) => setBudgetEntries(budgetEntries.filter((_, i) => i !== index));
  const updateEntry = (index, field, value) => {
    const updated = [...budgetEntries];
    updated[index][field] = value;
    setBudgetEntries(updated);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const validBudgets = budgetEntries.filter(entry => entry.brand_id && entry.location_id && entry.budget_amount);
      if (validBudgets.length === 0) {
        setError('Please add at least one budget entry');
        setLoading(false);
        return;
      }

      await api.post(`/seasons/${seasonId}/budgets`, { budgets: validBudgets });
      onClose();
    } catch (err) {
      console.error('Error saving budgets:', err);
      setError(err.response?.data?.error || 'Failed to save budgets');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-bold mb-4">Manage Budgets</h2>

        {error && <div className="mb-4 bg-red-50 border border-red-200 rounded-md p-3"><p className="text-sm text-red-800">{error}</p></div>}

        <form onSubmit={handleSubmit} className="space-y-3">
          {budgetEntries.map((entry, index) => (
            <div key={index} className="flex gap-2 items-start">
              <select
                value={entry.brand_id}
                onChange={(e) => updateEntry(index, 'brand_id', e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm"
                required
              >
                <option value="">Select Brand</option>
                {brands.filter(b => b.active !== false).map((brand) => (
                  <option key={brand.id} value={brand.id}>{brand.name}</option>
                ))}
              </select>
              <select
                value={entry.location_id}
                onChange={(e) => updateEntry(index, 'location_id', e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm"
                required
              >
                <option value="">Select Location</option>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>{location.name} ({location.code})</option>
                ))}
              </select>
              <input
                type="number"
                step="0.01"
                value={entry.budget_amount}
                onChange={(e) => updateEntry(index, 'budget_amount', e.target.value)}
                className="w-32 px-3 py-2 border border-gray-300 rounded-md text-sm"
                placeholder="Amount"
                required
              />
              {budgetEntries.length > 1 && (
                <button type="button" onClick={() => removeEntry(index)} className="px-2 py-2 text-red-600 hover:text-red-800">Remove</button>
              )}
            </div>
          ))}

          <button type="button" onClick={addEntry} className="text-blue-600 hover:text-blue-800 text-sm">+ Add Budget</button>

          <div className="flex justify-end space-x-2 pt-4 border-t">
            <button type="button" onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50" disabled={loading}>Cancel</button>
            <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400" disabled={loading}>
              {loading ? 'Saving...' : 'Save Budgets'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default OrderManager;
