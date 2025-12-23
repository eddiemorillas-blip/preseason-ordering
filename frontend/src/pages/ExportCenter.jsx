import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import api, { orderAPI, exportAPI } from '../services/api';
import Layout from '../components/Layout';

const ExportCenter = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  // Filter state
  const [seasons, setSeasons] = useState([]);
  const [brands, setBrands] = useState([]);

  // Selected filters from URL
  const selectedSeasonId = searchParams.get('season') || '';
  const selectedBrandId = searchParams.get('brand') || '';

  // Data state
  const [orders, setOrders] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  // Fetch filter options on mount
  useEffect(() => {
    const fetchFilters = async () => {
      try {
        const [seasonsRes, brandsRes] = await Promise.all([
          api.get('/seasons'),
          api.get('/brands')
        ]);
        setSeasons(seasonsRes.data.seasons || []);
        setBrands(brandsRes.data.brands || []);
      } catch (err) {
        console.error('Error fetching filters:', err);
        setError('Failed to load filter options');
      }
    };
    fetchFilters();
  }, []);

  // Fetch finalized status when filters change
  useEffect(() => {
    if (selectedSeasonId && selectedBrandId) {
      fetchFinalizedStatus();
    } else {
      setOrders([]);
      setSummary(null);
    }
  }, [selectedSeasonId, selectedBrandId]);

  const fetchFinalizedStatus = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await orderAPI.getFinalizedStatus({
        seasonId: selectedSeasonId,
        brandId: selectedBrandId
      });
      setOrders(response.data.orders || []);
      setSummary(response.data.summary || null);
    } catch (err) {
      console.error('Error fetching finalized status:', err);
      setError(err.response?.data?.error || 'Failed to load finalization status');
      setOrders([]);
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

  const formatPrice = (price) => {
    if (!price && price !== 0) return '-';
    return `$${parseFloat(price).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const formatDate = (date) => {
    if (!date) return '-';
    const d = new Date(date);
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${monthNames[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  };

  const formatDateTime = (date) => {
    if (!date) return '-';
    return new Date(date).toLocaleString();
  };

  // Export finalized orders
  const handleExport = async (template = 'standard') => {
    if (!selectedSeasonId || !selectedBrandId) return;

    setExporting(true);
    setError('');
    try {
      const response = await exportAPI.finalized({
        seasonId: selectedSeasonId,
        brandId: selectedBrandId,
        format: 'xlsx',
        template
      });

      // Create download link
      const blob = new Blob([response.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;

      // Get filename from Content-Disposition header or use default
      const contentDisposition = response.headers['content-disposition'];
      let filename = `finalized_export_${template}.xlsx`;
      if (contentDisposition) {
        const matches = contentDisposition.match(/filename="?([^";\n]+)"?/);
        if (matches && matches[1]) {
          filename = matches[1];
        }
      }

      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error('Error exporting:', err);
      if (err.response?.status === 404) {
        setError('No finalized adjustments found to export. Finalize orders first.');
      } else {
        setError('Failed to export');
      }
    } finally {
      setExporting(false);
    }
  };

  // Get selected brand/season names for display
  const selectedBrand = brands.find(b => b.id.toString() === selectedBrandId);
  const selectedSeason = seasons.find(s => s.id.toString() === selectedSeasonId);

  return (
    <Layout>
      <div className="space-y-4">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Export Center</h1>
          <p className="mt-1 text-sm text-gray-600">
            View finalization status and export adjusted orders for all locations.
          </p>
        </div>

        {/* Filters */}
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

        {/* No Selection */}
        {!loading && (!selectedSeasonId || !selectedBrandId) && (
          <div className="bg-yellow-50 rounded-lg p-8 text-center">
            <h3 className="text-sm font-medium text-gray-900">Select Season and Brand</h3>
            <p className="mt-1 text-sm text-gray-500">Choose a season and brand to view finalization status.</p>
          </div>
        )}

        {/* Main Content */}
        {!loading && selectedSeasonId && selectedBrandId && (
          <>
            {/* Summary Header */}
            {summary && (
              <div className="bg-white p-4 rounded-lg shadow">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900">
                      {selectedBrand?.name} - {selectedSeason?.name}
                    </h2>
                    <div className="mt-1 flex items-center gap-4 text-sm text-gray-600">
                      <span>
                        <strong>{summary.finalizedOrders}</strong> of <strong>{summary.totalOrders}</strong> orders finalized
                      </span>
                      <span>|</span>
                      <span>
                        <strong>{summary.totalUnits.toLocaleString()}</strong> units
                      </span>
                      <span>|</span>
                      <span>
                        <strong>{formatPrice(summary.totalCost)}</strong> total
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {summary.finalizedOrders > 0 ? (
                      <>
                        <button
                          onClick={() => handleExport('standard')}
                          disabled={exporting}
                          className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                        >
                          {exporting ? 'Exporting...' : 'Export Standard'}
                        </button>
                        <button
                          onClick={() => handleExport('nuorder')}
                          disabled={exporting}
                          className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md text-sm font-medium hover:bg-gray-200 disabled:opacity-50"
                        >
                          Export NuOrder
                        </button>
                        <button
                          onClick={() => handleExport('elastic')}
                          disabled={exporting}
                          className="px-4 py-2 bg-gray-100 text-gray-700 rounded-md text-sm font-medium hover:bg-gray-200 disabled:opacity-50"
                        >
                          Export Elastic
                        </button>
                      </>
                    ) : (
                      <span className="text-sm text-gray-500">Finalize orders to enable export</span>
                    )}
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="mt-4">
                  <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-green-500 transition-all duration-300"
                      style={{ width: `${summary.totalOrders > 0 ? (summary.finalizedOrders / summary.totalOrders) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Orders Table */}
            {orders.length > 0 ? (
              <div className="bg-white shadow rounded-lg overflow-hidden">
                <table className="w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Location</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Order #</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Ship Date</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Items</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Units</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Cost</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Status</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Finalized</th>
                      <th className="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {orders.map((order) => (
                      <tr key={order.order_id} className={`hover:bg-gray-50 ${order.finalized_at ? 'bg-green-50' : ''}`}>
                        <td className="px-4 py-3 font-medium text-gray-900">
                          {order.location_name || '-'}
                        </td>
                        <td className="px-4 py-3 text-gray-700">
                          {order.order_number}
                        </td>
                        <td className="px-4 py-3 text-gray-700">
                          {formatDate(order.ship_date)}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-700">
                          {parseInt(order.total_items).toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-700">
                          {parseInt(order.total_units).toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-900 font-medium">
                          {formatPrice(order.total_cost)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {order.finalized_at ? (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                              Ready
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                              Draft
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs">
                          {order.finalized_at ? formatDateTime(order.finalized_at) : '-'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <a
                            href={`/order-adjustment?season=${selectedSeasonId}&brand=${selectedBrandId}&location=${order.location_id}&shipDate=${order.ship_date}`}
                            className="text-blue-600 hover:text-blue-800 text-sm"
                          >
                            {order.finalized_at ? 'View' : 'Finalize'} →
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="bg-gray-50 rounded-lg p-12 text-center">
                <h3 className="text-sm font-medium text-gray-900">No orders found</h3>
                <p className="mt-1 text-sm text-gray-500">No orders exist for this brand and season.</p>
              </div>
            )}
          </>
        )}
      </div>
    </Layout>
  );
};

export default ExportCenter;
