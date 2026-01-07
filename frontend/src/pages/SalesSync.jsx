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
  const [autoMapping, setAutoMapping] = useState(false);
  const [autoMapResult, setAutoMapResult] = useState(null);
  const [debugVendor, setDebugVendor] = useState('');
  const [debugFacility, setDebugFacility] = useState('');
  const [debugData, setDebugData] = useState(null);
  const [debugLoading, setDebugLoading] = useState(false);

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
      setBrands(brandsRes.data.brands || []);
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

  const handleAutoMap = async () => {
    try {
      setAutoMapping(true);
      setError(null);
      setAutoMapResult(null);
      const res = await salesAPI.autoMapBrands();
      setAutoMapResult(res.data);
      loadData();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to auto-map brands');
    } finally {
      setAutoMapping(false);
    }
  };

  const handleDebugSearch = async () => {
    if (!debugVendor.trim()) return;
    try {
      setDebugLoading(true);
      setDebugData(null);
      const res = await salesAPI.debugVendor(debugVendor, debugFacility);
      setDebugData(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load debug data');
    } finally {
      setDebugLoading(false);
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
            <div className="flex justify-between items-start">
              <div>
                <h2 className="text-lg font-semibold">Brand Mapping</h2>
                <p className="text-sm text-gray-500">Map RGP vendor names to pricelist brands</p>
              </div>
              <button
                onClick={handleAutoMap}
                disabled={autoMapping}
                className={`px-4 py-2 rounded-md text-white font-medium ${
                  autoMapping ? 'bg-gray-400 cursor-not-allowed' : 'bg-green-600 hover:bg-green-700'
                }`}
              >
                {autoMapping ? 'Mapping...' : 'Auto-Map Similar Names'}
              </button>
            </div>
            {autoMapResult && (
              <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded text-sm">
                <div className="font-medium text-green-800">
                  Auto-mapped {autoMapResult.mapped_count} vendors ({autoMapResult.unmapped_remaining} still unmapped)
                </div>
                {autoMapResult.mappings?.length > 0 && (
                  <div className="mt-2 max-h-32 overflow-y-auto text-green-700">
                    {autoMapResult.mappings.map((m, i) => (
                      <div key={i} className="text-xs">
                        {m.rgp_vendor_name} → {m.mapped_to} ({m.match_type})
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
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

        {/* Debug Section */}
        <div className="bg-white rounded-lg shadow">
          <div className="p-4 border-b">
            <h2 className="text-lg font-semibold">Debug Sales Data</h2>
            <p className="text-sm text-gray-500">Look up raw sales data by vendor name</p>
          </div>
          <div className="p-4">
            <div className="flex gap-4 mb-4">
              <input
                type="text"
                placeholder="Vendor name (e.g., Scarpa)"
                value={debugVendor}
                onChange={(e) => setDebugVendor(e.target.value)}
                className="flex-1 px-3 py-2 border rounded-md"
                onKeyDown={(e) => e.key === 'Enter' && handleDebugSearch()}
              />
              <select
                value={debugFacility}
                onChange={(e) => setDebugFacility(e.target.value)}
                className="px-3 py-2 border rounded-md"
              >
                <option value="">All Facilities</option>
                <option value="41185">SLC (41185)</option>
                <option value="1003">South Main (1003)</option>
                <option value="1000">Ogden (1000)</option>
              </select>
              <button
                onClick={handleDebugSearch}
                disabled={debugLoading || !debugVendor.trim()}
                className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 disabled:bg-gray-300"
              >
                {debugLoading ? 'Loading...' : 'Search'}
              </button>
            </div>

            {debugData && (
              <div className="space-y-4">
                {/* Totals by Facility */}
                <div className="bg-gray-50 p-4 rounded">
                  <h3 className="font-medium mb-2">Totals by Facility</h3>
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="text-left text-gray-500">
                        <th className="pr-4">Facility</th>
                        <th className="pr-4">Location</th>
                        <th className="pr-4 text-right">Products</th>
                        <th className="pr-4 text-right">Units Sold</th>
                        <th className="text-right">Revenue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {debugData.totals_by_facility?.map((t, i) => (
                        <tr key={i} className="border-t">
                          <td className="pr-4 py-1">{t.facility_id || 'NULL'}</td>
                          <td className="pr-4 py-1">{debugData.facility_mapping?.[t.facility_id] || 'Unknown'}</td>
                          <td className="pr-4 py-1 text-right">{formatNumber(t.product_count)}</td>
                          <td className="pr-4 py-1 text-right font-medium">{formatNumber(t.total_units)}</td>
                          <td className="py-1 text-right">{formatCurrency(t.total_revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Product List */}
                <div>
                  <h3 className="font-medium mb-2">Products ({debugData.products?.length || 0})</h3>
                  <div className="max-h-64 overflow-y-auto border rounded">
                    <table className="min-w-full text-xs">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr className="text-left text-gray-500">
                          <th className="px-2 py-1">UPC</th>
                          <th className="px-2 py-1">Product</th>
                          <th className="px-2 py-1">Facility</th>
                          <th className="px-2 py-1 text-right">Qty</th>
                          <th className="px-2 py-1 text-right">Revenue</th>
                          <th className="px-2 py-1">Date Range</th>
                        </tr>
                      </thead>
                      <tbody>
                        {debugData.products?.map((p, i) => (
                          <tr key={i} className="border-t hover:bg-gray-50">
                            <td className="px-2 py-1 font-mono">{p.upc}</td>
                            <td className="px-2 py-1 max-w-xs truncate" title={p.product_name}>{p.product_name}</td>
                            <td className="px-2 py-1">{debugData.facility_mapping?.[p.facility_id] || p.facility_id}</td>
                            <td className="px-2 py-1 text-right font-medium">{formatNumber(p.total_qty_sold)}</td>
                            <td className="px-2 py-1 text-right">{formatCurrency(p.total_revenue)}</td>
                            <td className="px-2 py-1 text-gray-500">
                              {p.first_sale_date?.split('T')[0]} - {p.last_sale_date?.split('T')[0]}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default SalesSync;
