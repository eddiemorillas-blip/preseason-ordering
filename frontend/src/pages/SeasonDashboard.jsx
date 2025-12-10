import { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import api, { brandTemplateAPI } from '../services/api';
import Layout from '../components/Layout';
import { useAuth } from '../context/AuthContext';

// Simple SVG Pie Chart Component
const PieChart = ({ data, colors, formatCurrency }) => {
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
      value: parseFloat(item.value),
      percent: (percent * 100).toFixed(1)
    };
  });

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="-1.1 -1.1 2.2 2.2" className="w-32 h-32 transform -rotate-90">
        {slices.map((slice, index) => (
          <path
            key={index}
            d={slice.path}
            fill={slice.color}
            className="hover:opacity-80 transition-opacity"
          />
        ))}
      </svg>
      <div className="mt-3 space-y-1 w-full">
        {slices.map((slice, index) => (
          <div key={index} className="flex items-center justify-between text-xs">
            <div className="flex items-center">
              <div
                className="w-3 h-3 rounded-sm mr-2 flex-shrink-0"
                style={{ backgroundColor: slice.color }}
              />
              <span className="text-gray-600 truncate max-w-[100px]">{slice.name}</span>
            </div>
            <span className="text-gray-900 font-medium ml-2">{slice.percent}%</span>
          </div>
        ))}
      </div>
    </div>
  );
};

const SeasonDashboard = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const brandIdFilter = searchParams.get('brand');
  const { isAdmin, isBuyer } = useAuth();

  const [season, setSeason] = useState(null);
  const [budgets, setBudgets] = useState([]);
  const [orders, setOrders] = useState([]);
  const [productBreakdown, setProductBreakdown] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showBudgetModal, setShowBudgetModal] = useState(false);
  const [showAddOrderModal, setShowAddOrderModal] = useState(false);
  const [orderToDelete, setOrderToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [selectedBrand, setSelectedBrand] = useState(null);
  const [orderGroupBy, setOrderGroupBy] = useState('brand'); // 'brand', 'shipDate', 'location'
  const [showExportDropdown, setShowExportDropdown] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [brandTemplates, setBrandTemplates] = useState([]);

  useEffect(() => {
    fetchDashboardData();
  }, [id, brandIdFilter]);

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

  const fetchDashboardData = async () => {
    try {
      setLoading(true);

      // Build orders query with optional brand filter
      let ordersQuery = `/orders?seasonId=${id}`;
      let breakdownQuery = `/seasons/${id}/product-breakdown`;
      if (brandIdFilter) {
        ordersQuery += `&brandId=${brandIdFilter}`;
        breakdownQuery += `?brandId=${brandIdFilter}`;
      }

      // Fetch season details, budget summary, orders, and product breakdown in parallel
      const requests = [
        api.get(`/seasons/${id}`),
        api.get(`/seasons/${id}/summary`),
        api.get(ordersQuery),
        api.get(breakdownQuery)
      ];

      // If filtering by brand, also fetch brand details and templates
      if (brandIdFilter) {
        requests.push(api.get('/brands'));
        requests.push(brandTemplateAPI.getAll(brandIdFilter));
      }

      const results = await Promise.all(requests);
      const [seasonRes, budgetRes, ordersRes, breakdownRes] = results;

      setSeason(seasonRes.data.season);
      setBudgets(budgetRes.data.budgets);
      setOrders(ordersRes.data.orders);
      setProductBreakdown(breakdownRes.data);

      // Set selected brand info and templates if filtering
      if (brandIdFilter && results[4]) {
        const brand = results[4].data.brands.find(b => b.id === parseInt(brandIdFilter));
        setSelectedBrand(brand || null);
        setBrandTemplates(results[5]?.data?.templates || []);
      } else {
        setSelectedBrand(null);
        setBrandTemplates([]);
      }
    } catch (err) {
      console.error('Error fetching dashboard data:', err);
      setError('Failed to load dashboard data');
    } finally {
      setLoading(false);
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'planning':
        return 'bg-blue-100 text-blue-800';
      case 'ordering':
        return 'bg-green-100 text-green-800';
      case 'closed':
        return 'bg-gray-100 text-gray-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount || 0);
  };

  const getOrderStatusColor = (status) => {
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

  const handleDeleteOrder = async () => {
    if (!orderToDelete) return;

    setDeleting(true);
    try {
      await api.delete(`/orders/${orderToDelete.id}`);
      setOrderToDelete(null);
      fetchDashboardData();
    } catch (err) {
      console.error('Error deleting order:', err);
      setError(err.response?.data?.error || 'Failed to delete order');
    } finally {
      setDeleting(false);
    }
  };

  // Handle season export
  const handleSeasonExport = async (template, format, includeItems = true) => {
    setExporting(true);
    setShowExportDropdown(false);
    try {
      let url = `/exports/seasons/${id}`;
      if (template === 'summary') {
        url += `?format=${format}&includeItems=false`;
      } else {
        url = `/exports/seasons/${id}/by-template?template=${template}&format=${format}`;
        // Add brand filter if viewing a specific brand
        if (brandIdFilter) {
          url += `&brandId=${brandIdFilter}`;
        }
      }

      const response = await api.get(url, {
        responseType: 'blob'
      });

      // Create download link
      const blob = new Blob([response.data], {
        type: format === 'csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
      const urlObj = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = urlObj;
      const safeName = season?.name?.replace(/[^a-zA-Z0-9]/g, '_') || 'season';
      const brandPart = selectedBrand ? `_${selectedBrand.name.replace(/[^a-zA-Z0-9]/g, '_')}` : '';
      link.download = `${safeName}${brandPart}_${template}.${format}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(urlObj);
    } catch (err) {
      console.error('Error exporting season:', err);
      setError('Failed to export season data');
    } finally {
      setExporting(false);
    }
  };

  // Handle export with brand template
  const handleBrandTemplateExport = async (template) => {
    setExporting(true);
    setShowExportDropdown(false);
    try {
      // Get all order IDs for this brand in this season
      const orderIds = orders.map(o => o.id);

      if (orderIds.length === 0) {
        setError('No orders to export');
        return;
      }

      const response = await brandTemplateAPI.exportWithTemplate(orderIds, template.id);

      // Create download link
      const blob = new Blob([response.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
      const urlObj = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = urlObj;
      const safeName = season?.name?.replace(/[^a-zA-Z0-9]/g, '_') || 'season';
      const brandPart = selectedBrand ? `_${selectedBrand.name.replace(/[^a-zA-Z0-9]/g, '_')}` : '';
      const templatePart = template.name.replace(/[^a-zA-Z0-9]/g, '_');
      link.download = `${safeName}${brandPart}_${templatePart}.xlsx`;
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

  // Group orders based on selected grouping
  const groupedOrders = orders.reduce((acc, order) => {
    let key, groupName;
    if (orderGroupBy === 'shipDate') {
      key = order.ship_date || 'no-date';
      groupName = order.ship_date ? new Date(order.ship_date).toLocaleDateString() : 'No Ship Date';
    } else if (orderGroupBy === 'location') {
      key = order.location_id || 'no-location';
      groupName = order.location_name ? `${order.location_name}${order.location_code ? ` (${order.location_code})` : ''}` : 'No Location';
    } else {
      // default: brand
      key = `${order.brand_name}_${order.ship_date || 'No date'}`;
      groupName = `${order.brand_name} - ${order.ship_date ? new Date(order.ship_date).toLocaleDateString() : 'No ship date'}`;
    }

    if (!acc[key]) {
      acc[key] = {
        groupName,
        brand: order.brand_name,
        shipDate: order.ship_date,
        locationName: order.location_name,
        locationCode: order.location_code,
        orders: []
      };
    }
    acc[key].orders.push(order);
    return acc;
  }, {});

  // Sort groups
  const sortedGroupedOrders = Object.entries(groupedOrders).sort((a, b) => {
    if (orderGroupBy === 'shipDate') {
      if (a[0] === 'no-date') return 1;
      if (b[0] === 'no-date') return -1;
      return new Date(a[0]) - new Date(b[0]);
    }
    return a[1].groupName.localeCompare(b[1].groupName);
  });

  if (loading) {
    return (
      <Layout>
        <div className="flex justify-center items-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      </Layout>
    );
  }

  if (!season) {
    return (
      <Layout>
        <div className="text-center py-12">
          <p className="text-red-600">Season not found</p>
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
              onClick={() => navigate('/seasons')}
              className="text-sm text-blue-600 hover:text-blue-800 mb-2"
            >
              ← Back to Order Builder
            </button>
            <h1 className="text-3xl font-bold text-gray-900">
              {season.name}
              {selectedBrand && (
                <span className="text-blue-600"> - {selectedBrand.name}</span>
              )}
            </h1>
            <div className="mt-2 flex items-center space-x-4">
              <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(season.status)}`}>
                {season.status}
              </span>
              {season.start_date && (
                <span className="text-sm text-gray-600">
                  {new Date(season.start_date).toLocaleDateString()} - {season.end_date ? new Date(season.end_date).toLocaleDateString() : 'Ongoing'}
                </span>
              )}
              {selectedBrand && (
                <button
                  onClick={() => navigate(`/seasons/${id}`)}
                  className="text-sm text-gray-500 hover:text-gray-700"
                >
                  Show all brands
                </button>
              )}
            </div>
          </div>
          <div className="flex space-x-2">
            {/* Export Dropdown */}
            <div className="relative export-dropdown">
              <button
                onClick={() => setShowExportDropdown(!showExportDropdown)}
                disabled={exporting || orders.length === 0}
                className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-400 flex items-center"
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
                    Export
                    <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </>
                )}
              </button>
              {showExportDropdown && (
                <div className="absolute right-0 mt-2 w-56 bg-white rounded-md shadow-lg ring-1 ring-black ring-opacity-5 z-50 max-h-96 overflow-y-auto">
                  <div className="py-1">
                    {/* Brand Custom Templates - shown first when available */}
                    {brandTemplates.length > 0 && (
                      <>
                        <div className="px-4 py-2 text-xs font-semibold text-blue-600 uppercase tracking-wider bg-blue-50">
                          {selectedBrand?.name} Templates
                        </div>
                        {brandTemplates.map(template => (
                          <button
                            key={template.id}
                            onClick={() => handleBrandTemplateExport(template)}
                            className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-blue-50"
                          >
                            {template.name}
                          </button>
                        ))}
                        <div className="border-t border-gray-200 my-1"></div>
                      </>
                    )}
                    <div className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50">
                      NuOrder Format
                    </div>
                    <button
                      onClick={() => handleSeasonExport('nuorder', 'xlsx')}
                      className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      Excel (.xlsx)
                    </button>
                    <button
                      onClick={() => handleSeasonExport('nuorder', 'csv')}
                      className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      CSV (.csv)
                    </button>
                    <div className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50">
                      Elastic Format
                    </div>
                    <button
                      onClick={() => handleSeasonExport('elastic', 'xlsx')}
                      className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      Excel (.xlsx)
                    </button>
                    <button
                      onClick={() => handleSeasonExport('elastic', 'csv')}
                      className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      CSV (.csv)
                    </button>
                    <div className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50">
                      Standard Format
                    </div>
                    <button
                      onClick={() => handleSeasonExport('standard', 'xlsx')}
                      className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      Excel (.xlsx)
                    </button>
                    <button
                      onClick={() => handleSeasonExport('standard', 'csv')}
                      className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      CSV (.csv)
                    </button>
                  </div>
                </div>
              )}
            </div>
            {(isAdmin() || isBuyer()) && (
              <>
                <button
                  onClick={() => setShowBudgetModal(true)}
                  className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
                >
                  Manage Budgets
                </button>
                <button
                  onClick={() => setShowAddOrderModal(true)}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                  + Add Brand Order
                </button>
              </>
            )}
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-md p-4">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        {/* Order Stats by Location */}
        <div className="bg-white shadow rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Order Stats by Location</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Location
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                    Orders
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                    Items
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                    Total Value
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {orders.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-4 text-center text-sm text-gray-500">
                      No orders for this season yet.
                    </td>
                  </tr>
                ) : (
                  (() => {
                    // Group orders by location
                    const locationStats = orders.reduce((acc, order) => {
                      const key = order.location_id;
                      if (!acc[key]) {
                        acc[key] = {
                          location_name: order.location_name,
                          location_code: order.location_code,
                          orderCount: 0,
                          itemCount: 0,
                          totalValue: 0
                        };
                      }
                      acc[key].orderCount += 1;
                      acc[key].itemCount += parseInt(order.item_count) || 0;
                      acc[key].totalValue += parseFloat(order.current_total) || 0;
                      return acc;
                    }, {});

                    const sortedStats = Object.values(locationStats).sort((a, b) =>
                      a.location_name.localeCompare(b.location_name)
                    );

                    const totals = sortedStats.reduce((acc, stat) => ({
                      orderCount: acc.orderCount + stat.orderCount,
                      itemCount: acc.itemCount + stat.itemCount,
                      totalValue: acc.totalValue + stat.totalValue
                    }), { orderCount: 0, itemCount: 0, totalValue: 0 });

                    return (
                      <>
                        {sortedStats.map((stat) => (
                          <tr key={stat.location_name}>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                              {stat.location_name} ({stat.location_code})
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                              {stat.orderCount}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                              {stat.itemCount}
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                              {formatCurrency(stat.totalValue)}
                            </td>
                          </tr>
                        ))}
                        <tr className="bg-gray-50 font-semibold">
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            Total
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                            {totals.orderCount}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                            {totals.itemCount}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-bold text-blue-600">
                            {formatCurrency(totals.totalValue)}
                          </td>
                        </tr>
                      </>
                    );
                  })()
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Product Breakdown */}
        {productBreakdown && (productBreakdown.gender?.length > 0 || productBreakdown.category?.length > 0) && (
          <div className="bg-white shadow rounded-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">Product Breakdown</h2>
            </div>
            {/* Totals Summary */}
            {productBreakdown?.totals && (
              <div className="px-6 py-4 bg-gray-50 border-b border-gray-200">
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <p className="text-sm text-gray-500">Total Items</p>
                    <p className="text-xl font-semibold text-gray-900">{productBreakdown.totals.quantity.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Wholesale Value</p>
                    <p className="text-xl font-semibold text-blue-600">{formatCurrency(productBreakdown.totals.wholesale)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Retail Value</p>
                    <p className="text-xl font-semibold text-green-600">{formatCurrency(productBreakdown.totals.retail)}</p>
                  </div>
                </div>
              </div>
            )}
            <div className="p-6 grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Gender Breakdown - using distinct warm/cool colors */}
              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-3 text-center">By Gender</h3>
                {productBreakdown.gender?.length > 0 ? (
                  <PieChart data={productBreakdown.gender} colors={['#2563EB', '#F97316', '#10B981', '#EF4444', '#FBBF24', '#EC4899']} formatCurrency={formatCurrency} />
                ) : (
                  <p className="text-sm text-gray-500 text-center">No data</p>
                )}
              </div>

              {/* Category Breakdown - alternating warm/cool for max contrast */}
              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-3 text-center">By Category</h3>
                {productBreakdown.category?.length > 0 ? (
                  <PieChart data={productBreakdown.category} colors={['#10B981', '#F97316', '#2563EB', '#EF4444', '#FBBF24', '#14B8A6', '#F43F5E', '#0EA5E9']} formatCurrency={formatCurrency} />
                ) : (
                  <p className="text-sm text-gray-500 text-center">No data</p>
                )}
              </div>

              {/* Color Breakdown - high contrast palette */}
              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-3 text-center">By Color (Top 10)</h3>
                {productBreakdown.color?.length > 0 ? (
                  <PieChart data={productBreakdown.color} colors={['#2563EB', '#F97316', '#10B981', '#EF4444', '#FBBF24', '#14B8A6', '#F43F5E', '#0EA5E9', '#84CC16', '#FB923C']} formatCurrency={formatCurrency} />
                ) : (
                  <p className="text-sm text-gray-500 text-center">No data</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Orders List */}
        <div className="bg-white shadow rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
            <h2 className="text-lg font-semibold text-gray-900">Orders</h2>
            {orders.length > 0 && (
              <div className="flex items-center space-x-2">
                <span className="text-sm text-gray-500">Group by:</span>
                <div className="inline-flex rounded-md shadow-sm">
                  <button
                    onClick={() => setOrderGroupBy('brand')}
                    className={`px-3 py-1 text-sm font-medium rounded-l-md border ${
                      orderGroupBy === 'brand'
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    Brand
                  </button>
                  <button
                    onClick={() => setOrderGroupBy('shipDate')}
                    className={`px-3 py-1 text-sm font-medium border-t border-b ${
                      orderGroupBy === 'shipDate'
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    Ship Date
                  </button>
                  <button
                    onClick={() => setOrderGroupBy('location')}
                    className={`px-3 py-1 text-sm font-medium rounded-r-md border ${
                      orderGroupBy === 'location'
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    Location
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className="divide-y divide-gray-200">
            {orders.length === 0 ? (
              <div className="px-6 py-8 text-center text-sm text-gray-500">
                No orders for this season yet.{' '}
                {(isAdmin() || isBuyer()) && (
                  <button
                    onClick={() => setShowAddOrderModal(true)}
                    className="text-blue-600 hover:text-blue-800"
                  >
                    Create your first order
                  </button>
                )}
              </div>
            ) : (
              sortedGroupedOrders.map(([key, group]) => (
                <div key={key} className="px-6 py-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-gray-900">
                      {group.groupName}
                    </h3>
                  </div>
                  <div className="space-y-2">
                    {group.orders.map((order) => (
                      <div
                        key={order.id}
                        className="flex items-center justify-between p-3 bg-gray-50 rounded-md hover:bg-gray-100"
                      >
                        <div
                          className="flex-1 cursor-pointer"
                          onClick={() => navigate(`/orders/${order.id}`)}
                        >
                          <div className="flex items-center space-x-3">
                            <span className="text-sm font-medium text-gray-900">
                              {order.order_number}
                            </span>
                            <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getOrderStatusColor(order.status)}`}>
                              {order.status}
                            </span>
                          </div>
                          <div className="mt-1 text-xs text-gray-600">
                            {/* Show different info based on grouping */}
                            {orderGroupBy === 'brand' && (
                              <>{order.location_name} ({order.location_code}) • {order.item_count} items</>
                            )}
                            {orderGroupBy === 'shipDate' && (
                              <>{order.brand_name} • {order.location_name} ({order.location_code}) • {order.item_count} items</>
                            )}
                            {orderGroupBy === 'location' && (
                              <>{order.brand_name} • {order.ship_date ? new Date(order.ship_date).toLocaleDateString() : 'No ship date'} • {order.item_count} items</>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center space-x-4">
                          <div
                            className="text-right cursor-pointer"
                            onClick={() => navigate(`/orders/${order.id}`)}
                          >
                            <div className="text-sm font-semibold text-gray-900">
                              {formatCurrency(order.current_total)}
                            </div>
                            <div className="text-xs text-gray-500">
                              {order.created_by_email}
                            </div>
                          </div>
                          {isAdmin() && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setOrderToDelete(order);
                              }}
                              className="p-2 text-red-600 hover:text-red-800 hover:bg-red-50 rounded"
                              title="Delete order"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Budget Management Modal */}
        {showBudgetModal && (
          <BudgetModal
            seasonId={id}
            onClose={() => {
              setShowBudgetModal(false);
              fetchDashboardData();
            }}
          />
        )}

        {/* Add Order Modal */}
        {showAddOrderModal && (
          <AddOrderModal
            seasonId={id}
            seasonName={season.name}
            preselectedBrandId={brandIdFilter}
            onClose={() => {
              setShowAddOrderModal(false);
              fetchDashboardData();
            }}
            onOrderCreated={(orderId) => {
              setShowAddOrderModal(false);
              navigate(`/orders/${orderId}`);
            }}
          />
        )}

        {/* Delete Order Confirmation Modal */}
        {orderToDelete && (
          <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-md w-full">
              <h2 className="text-xl font-bold text-gray-900 mb-4">Delete Order</h2>
              <p className="text-gray-600 mb-2">
                Are you sure you want to delete this order?
              </p>
              <div className="bg-gray-50 rounded-md p-3 mb-6">
                <p className="font-medium text-gray-900">{orderToDelete.order_number}</p>
                <p className="text-sm text-gray-600">
                  {orderToDelete.brand_name} • {orderToDelete.location_name}
                </p>
                <p className="text-sm text-gray-600">
                  {orderToDelete.item_count} items • {formatCurrency(orderToDelete.current_total)}
                </p>
              </div>
              <p className="text-sm text-red-600 mb-4">
                This will permanently remove the order and all its items. This action cannot be undone.
              </p>
              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => setOrderToDelete(null)}
                  className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                  disabled={deleting}
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteOrder}
                  className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:bg-gray-400"
                  disabled={deleting}
                >
                  {deleting ? 'Deleting...' : 'Delete Order'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
};

// Budget Management Modal Component
const BudgetModal = ({ seasonId, onClose }) => {
  const [brands, setBrands] = useState([]);
  const [locations, setLocations] = useState([]);
  const [budgetEntries, setBudgetEntries] = useState([{ brand_id: '', location_id: '', budget_amount: '' }]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchOptions();
  }, []);

  const fetchOptions = async () => {
    try {
      const [brandsRes, locationsRes] = await Promise.all([
        api.get('/brands'),
        api.get('/locations')
      ]);
      setBrands(brandsRes.data.brands || []);
      setLocations(locationsRes.data.locations || []);
    } catch (err) {
      console.error('Error fetching options:', err);
      setError('Failed to load brands and locations');
    }
  };

  const addBudgetEntry = () => {
    setBudgetEntries([...budgetEntries, { brand_id: '', location_id: '', budget_amount: '' }]);
  };

  const removeBudgetEntry = (index) => {
    setBudgetEntries(budgetEntries.filter((_, i) => i !== index));
  };

  const updateBudgetEntry = (index, field, value) => {
    const updated = [...budgetEntries];
    updated[index][field] = value;
    setBudgetEntries(updated);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const validBudgets = budgetEntries.filter(
        entry => entry.brand_id && entry.location_id && entry.budget_amount
      );

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
        <h2 className="text-xl font-bold mb-4">Manage Season Budgets</h2>

        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-md p-3">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {budgetEntries.map((entry, index) => (
            <div key={index} className="flex space-x-2 items-start">
              <div className="flex-1">
                <select
                  value={entry.brand_id}
                  onChange={(e) => updateBudgetEntry(index, 'brand_id', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  required
                >
                  <option value="">Select Brand</option>
                  {brands.map((brand) => (
                    <option key={brand.id} value={brand.id}>
                      {brand.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex-1">
                <select
                  value={entry.location_id}
                  onChange={(e) => updateBudgetEntry(index, 'location_id', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  required
                >
                  <option value="">Select Location</option>
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name} ({location.code})
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex-1">
                <input
                  type="number"
                  step="0.01"
                  value={entry.budget_amount}
                  onChange={(e) => updateBudgetEntry(index, 'budget_amount', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  placeholder="Budget amount"
                  required
                />
              </div>
              {budgetEntries.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeBudgetEntry(index)}
                  className="px-3 py-2 text-red-600 hover:text-red-800"
                >
                  Remove
                </button>
              )}
            </div>
          ))}

          <button
            type="button"
            onClick={addBudgetEntry}
            className="text-blue-600 hover:text-blue-800 text-sm"
          >
            + Add Another Budget
          </button>

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
              type="submit"
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400"
              disabled={loading}
            >
              {loading ? 'Saving...' : 'Save Budgets'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// Add Order Modal Component
const AddOrderModal = ({ seasonId, seasonName, preselectedBrandId, onClose, onOrderCreated }) => {
  const [brands, setBrands] = useState([]);
  const [locations, setLocations] = useState([]);
  const [formData, setFormData] = useState({
    brand_id: preselectedBrandId || '',
    location_id: '',
    order_type: 'preseason',
    notes: ''
  });
  const [numberOfShips, setNumberOfShips] = useState(1);
  const [shipDates, setShipDates] = useState(['']);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchOptions();
  }, []);

  const fetchOptions = async () => {
    try {
      const [brandsRes, locationsRes] = await Promise.all([
        api.get('/brands'),
        api.get('/locations')
      ]);
      setBrands(brandsRes.data.brands || []);
      setLocations(locationsRes.data.locations || []);
    } catch (err) {
      console.error('Error fetching options:', err);
      setError('Failed to load brands and locations');
    }
  };

  const handleNumberOfShipsChange = (num) => {
    const newNum = Math.max(1, Math.min(12, parseInt(num) || 1));
    setNumberOfShips(newNum);

    // Adjust ship dates array
    const newShipDates = [...shipDates];
    while (newShipDates.length < newNum) {
      newShipDates.push('');
    }
    while (newShipDates.length > newNum) {
      newShipDates.pop();
    }
    setShipDates(newShipDates);
  };

  const updateShipDate = (index, date) => {
    const newShipDates = [...shipDates];
    newShipDates[index] = date;
    setShipDates(newShipDates);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const createdOrderIds = [];

      // Create an order for each ship date
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

      // If only one order, navigate to it; otherwise close and refresh
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
        <h2 className="text-xl font-bold mb-4">Create New Order</h2>
        <p className="text-sm text-gray-600 mb-4">Season: {seasonName}</p>

        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-md p-3">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Brand *
            </label>
            <select
              value={formData.brand_id}
              onChange={(e) => setFormData({ ...formData, brand_id: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
              required
            >
              <option value="">Select Brand</option>
              {brands.map((brand) => (
                <option key={brand.id} value={brand.id}>
                  {brand.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Location *
            </label>
            <select
              value={formData.location_id}
              onChange={(e) => setFormData({ ...formData, location_id: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
              required
            >
              <option value="">Select Location</option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name} ({location.code})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Order Type
            </label>
            <select
              value={formData.order_type}
              onChange={(e) => setFormData({ ...formData, order_type: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
            >
              <option value="preseason">Preseason</option>
              <option value="in-season">In-Season</option>
              <option value="reorder">Reorder</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Number of Ship Dates
            </label>
            <select
              value={numberOfShips}
              onChange={(e) => handleNumberOfShipsChange(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
            >
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
            {numberOfShips > 1 && (
              <p className="mt-1 text-xs text-gray-500">
                This will create {numberOfShips} separate orders, one for each ship date
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Ship Date{numberOfShips > 1 ? 's' : ''}
            </label>
            <div className="space-y-2">
              {shipDates.map((date, index) => (
                <div key={index} className="flex items-center space-x-2">
                  {numberOfShips > 1 && (
                    <span className="text-sm text-gray-500 w-16">Ship {index + 1}:</span>
                  )}
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => updateShipDate(index, e.target.value)}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-md"
                  />
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Notes
            </label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
              rows={2}
              placeholder="Optional notes (applied to all orders)"
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
              type="submit"
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400"
              disabled={loading}
            >
              {loading ? 'Creating...' : numberOfShips > 1 ? `Create ${numberOfShips} Orders` : 'Create Order'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default SeasonDashboard;
