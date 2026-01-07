import { useState } from 'react';
import Layout from '../components/Layout';
import { salesAPI } from '../services/api';

const SalesDebug = () => {
  const [debugVendor, setDebugVendor] = useState('');
  const [debugFacility, setDebugFacility] = useState('');
  const [debugData, setDebugData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSearch = async () => {
    if (!debugVendor.trim()) return;
    try {
      setLoading(true);
      setDebugData(null);
      setError(null);
      const res = await salesAPI.debugVendor(debugVendor, debugFacility);
      setDebugData(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load data');
    } finally {
      setLoading(false);
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

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Sales Data Debug</h1>
          <p className="text-gray-500">Look up raw BigQuery sales data by vendor name</p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        )}

        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex gap-4 mb-6">
            <input
              type="text"
              placeholder="Vendor name (e.g., Scarpa)"
              value={debugVendor}
              onChange={(e) => setDebugVendor(e.target.value)}
              className="flex-1 px-4 py-2 border rounded-md text-lg"
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
            <select
              value={debugFacility}
              onChange={(e) => setDebugFacility(e.target.value)}
              className="px-4 py-2 border rounded-md"
            >
              <option value="">All Facilities</option>
              <option value="41185">SLC (41185)</option>
              <option value="1003">South Main (1003)</option>
              <option value="1000">Ogden (1000)</option>
            </select>
            <button
              onClick={handleSearch}
              disabled={loading || !debugVendor.trim()}
              className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-300 font-medium"
            >
              {loading ? 'Searching...' : 'Search'}
            </button>
          </div>

          {debugData && (
            <div className="space-y-6">
              {/* Totals by Facility */}
              <div className="bg-gray-50 p-6 rounded-lg">
                <h2 className="text-lg font-semibold mb-4">Totals by Facility</h2>
                <table className="min-w-full">
                  <thead>
                    <tr className="text-left text-gray-500 border-b">
                      <th className="pb-2 pr-6">Facility ID</th>
                      <th className="pb-2 pr-6">Location</th>
                      <th className="pb-2 pr-6 text-right">Products</th>
                      <th className="pb-2 pr-6 text-right">Units Sold</th>
                      <th className="pb-2 text-right">Revenue</th>
                    </tr>
                  </thead>
                  <tbody>
                    {debugData.totals_by_facility?.map((t, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="py-3 pr-6 font-mono">{t.facility_id || 'NULL'}</td>
                        <td className="py-3 pr-6">{debugData.facility_mapping?.[t.facility_id] || 'Unknown'}</td>
                        <td className="py-3 pr-6 text-right">{formatNumber(t.product_count)}</td>
                        <td className="py-3 pr-6 text-right font-semibold text-lg">{formatNumber(t.total_units)}</td>
                        <td className="py-3 text-right font-semibold">{formatCurrency(t.total_revenue)}</td>
                      </tr>
                    ))}
                    {debugData.totals_by_facility?.length > 1 && (
                      <tr className="bg-blue-50 font-bold">
                        <td className="py-3 pr-6" colSpan={2}>TOTAL</td>
                        <td className="py-3 pr-6 text-right">
                          {formatNumber(debugData.totals_by_facility.reduce((sum, t) => sum + parseInt(t.product_count || 0), 0))}
                        </td>
                        <td className="py-3 pr-6 text-right text-lg">
                          {formatNumber(debugData.totals_by_facility.reduce((sum, t) => sum + parseInt(t.total_units || 0), 0))}
                        </td>
                        <td className="py-3 text-right">
                          {formatCurrency(debugData.totals_by_facility.reduce((sum, t) => sum + parseFloat(t.total_revenue || 0), 0))}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              {/* Product List */}
              <div>
                <h2 className="text-lg font-semibold mb-4">Products ({debugData.products?.length || 0})</h2>
                <div className="max-h-96 overflow-y-auto border rounded-lg">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr className="text-left text-gray-500">
                        <th className="px-4 py-3">UPC</th>
                        <th className="px-4 py-3">Product Name</th>
                        <th className="px-4 py-3">Vendor</th>
                        <th className="px-4 py-3">Facility</th>
                        <th className="px-4 py-3 text-right">Qty Sold</th>
                        <th className="px-4 py-3 text-right">Revenue</th>
                        <th className="px-4 py-3">First Sale</th>
                        <th className="px-4 py-3">Last Sale</th>
                      </tr>
                    </thead>
                    <tbody>
                      {debugData.products?.map((p, i) => (
                        <tr key={i} className="border-t hover:bg-gray-50">
                          <td className="px-4 py-2 font-mono text-xs">{p.upc}</td>
                          <td className="px-4 py-2 max-w-xs truncate" title={p.product_name}>{p.product_name}</td>
                          <td className="px-4 py-2 text-gray-500">{p.rgp_vendor_name}</td>
                          <td className="px-4 py-2">{debugData.facility_mapping?.[p.facility_id] || p.facility_id}</td>
                          <td className="px-4 py-2 text-right font-medium">{formatNumber(p.total_qty_sold)}</td>
                          <td className="px-4 py-2 text-right">{formatCurrency(p.total_revenue)}</td>
                          <td className="px-4 py-2 text-gray-500">{p.first_sale_date?.split('T')[0]}</td>
                          <td className="px-4 py-2 text-gray-500">{p.last_sale_date?.split('T')[0]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {!debugData && !loading && (
            <div className="text-center text-gray-500 py-12">
              Enter a vendor name and click Search to view sales data
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
};

export default SalesDebug;
