import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { salesAPI, brandAPI } from '../services/api';

const SalesSync = () => {
  const [summary, setSummary] = useState(null);
  const [mappings, setMappings] = useState([]);
  const [brands, setBrands] = useState([]);
  const [salesByBrand, setSalesByBrand] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState(null);
  const [error, setError] = useState(null);
  const [editingMapping, setEditingMapping] = useState(null);
  const [filterUnmapped, setFilterUnmapped] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    let interval;
    if (syncStatus && syncStatus.status === 'running') {
      interval = setInterval(checkSyncStatus, 5000);
    }
    return () => clearInterval(interval);
  }, [syncStatus]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [summaryRes, mappingsRes, brandsRes, salesRes] = await Promise.all([
        salesAPI.getSummary(),
        salesAPI.getBrandMapping(),
        brandAPI.getAll(),
        salesAPI.getByBrand(12)
      ]);
      setSummary(summaryRes.data);
      setMappings(mappingsRes.data.mappings || []);
      setBrands(brandsRes.data || []);
      setSalesByBrand(salesRes.data.sales || []);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async () => {
    try {
      setSyncing(true);
      setError(null);
      const res = await salesAPI.sync(12);
      setSyncStatus({ id: res.data.syncId, status: 'running' });
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to start sync');
      setSyncing(false);
    }
  };

  const checkSyncStatus = async () => {
    if (!syncStatus?.id) return;
    try {
      const res = await salesAPI.getSyncStatus(syncStatus.id);
      setSyncStatus(res.data);
      if (res.data.status !== 'running') {
        setSyncing(false);
        if (res.data.status === 'completed') {
          loadData();
        }
      }
    } catch (err) {
      console.error('Error checking sync status:', err);
    }
  };

  const handleUpdateMapping = async (mappingId, brandId) => {
    try {
      await salesAPI.updateBrandMapping(mappingId, { brand_id: brandId, is_verified: true });
      setEditingMapping(null);
      loadData();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update mapping');
    }
  };

  const formatCurrency = (value) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value || 0);
  };

  const formatNumber = (value) => {
    return new Intl.NumberFormat('en-US').format(value || 0);
  };

  const filteredMappings = mappings.filter(m => {
    if (filterUnmapped && m.brand_id) return false;
    if (searchTerm && !m.rgp_vendor_name?.toLowerCase().includes(searchTerm.toLowerCase())) return false;
    return true;
  });

  if (loading) {
    return (
      <Layout>
        <div className="flex justify-center items-center h-64">
          <div className="text-gray-500">Loading sales data...</div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-bold text-gray-900">Sales Data Sync</h1>
          <button
            onClick={handleSync}
            disabled={syncing}
            className={`px-4 py-2 rounded-md text-white font-medium ${
              syncing ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {syncing ? 'Syncing...' : 'Sync from BigQuery'}
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        )}

        {syncStatus && (
          <div className={`px-4 py-3 rounded ${
            syncStatus.status === 'running' ? 'bg-blue-50 border border-blue-200 text-blue-700' :
            syncStatus.status === 'completed' ? 'bg-green-50 border border-green-200 text-green-700' :
            'bg-red-50 border border-red-200 text-red-700'
          }`}>
            <div className="font-medium">Sync Status: {syncStatus.status}</div>
            {syncStatus.records_synced > 0 && (
              <div className="text-sm">Records synced: {formatNumber(syncStatus.records_synced)}</div>
            )}
            {syncStatus.error_message && (
              <div className="text-sm">Error: {syncStatus.error_message}</div>
            )}
          </div>
        )}

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-sm text-gray-500">Last Sync</div>
            <div className="text-lg font-semibold">
              {summary?.lastSync?.completed_at
                ? new Date(summary.lastSync.completed_at).toLocaleDateString()
                : 'Never'}
            </div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-sm text-gray-500">Total Brands</div>
            <div className="text-lg font-semibold">{formatNumber(summary?.totals?.brand_count)}</div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-sm text-gray-500">12-Month Revenue</div>
            <div className="text-lg font-semibold">{formatCurrency(summary?.totals?.total_revenue)}</div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-sm text-gray-500">Units Sold</div>
            <div className="text-lg font-semibold">{formatNumber(summary?.totals?.total_qty_sold)}</div>
          </div>
        </div>

        {/* Top Brands */}
        {summary?.topBrands?.length > 0 && (
          <div className="bg-white rounded-lg shadow p-4">
            <h2 className="text-lg font-semibold mb-4">Top 10 Brands by Revenue</h2>
            <div className="space-y-2">
              {summary.topBrands.map((brand, idx) => (
                <div key={idx} className="flex justify-between items-center py-2 border-b last:border-0">
                  <span className="text-gray-700">{brand.rgp_vendor_name || 'Unknown'}</span>
                  <span className="font-medium">{formatCurrency(brand.revenue)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Brand Mapping */}
        <div className="bg-white rounded-lg shadow">
          <div className="p-4 border-b">
            <h2 className="text-lg font-semibold">Brand Mapping</h2>
            <p className="text-sm text-gray-500">Map RGP vendor names to pricelist brands</p>
            <div className="mt-3 flex gap-4">
              <input
                type="text"
                placeholder="Search vendors..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="flex-1 px-3 py-2 border rounded-md"
              />
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={filterUnmapped}
                  onChange={(e) => setFilterUnmapped(e.target.checked)}
                  className="rounded"
                />
                <span className="text-sm">Show unmapped only</span>
              </label>
            </div>
          </div>
          <div className="max-h-96 overflow-y-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">RGP Vendor</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">12-Month Revenue</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Mapped Brand</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredMappings.map((mapping) => (
                  <tr key={mapping.id} className={!mapping.brand_id ? 'bg-yellow-50' : ''}>
                    <td className="px-4 py-3 text-sm">{mapping.rgp_vendor_name}</td>
                    <td className="px-4 py-3 text-sm">{formatCurrency(mapping.total_revenue)}</td>
                    <td className="px-4 py-3 text-sm">
                      {editingMapping === mapping.id ? (
                        <select
                          className="w-full px-2 py-1 border rounded"
                          defaultValue={mapping.brand_id || ''}
                          onChange={(e) => handleUpdateMapping(mapping.id, e.target.value || null)}
                        >
                          <option value="">-- Not Mapped --</option>
                          {brands.map(b => (
                            <option key={b.id} value={b.id}>{b.name}</option>
                          ))}
                        </select>
                      ) : (
                        <span className={mapping.brand_name ? 'text-green-600' : 'text-gray-400'}>
                          {mapping.brand_name || 'Not mapped'}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {editingMapping === mapping.id ? (
                        <button
                          onClick={() => setEditingMapping(null)}
                          className="text-gray-600 hover:text-gray-900"
                        >
                          Cancel
                        </button>
                      ) : (
                        <button
                          onClick={() => setEditingMapping(mapping.id)}
                          className="text-blue-600 hover:text-blue-900"
                        >
                          Edit
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default SalesSync;
