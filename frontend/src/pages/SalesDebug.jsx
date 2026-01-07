import { useState } from 'react';
import Layout from '../components/Layout';
import { salesAPI } from '../services/api';

const SalesDebug = () => {
  const [vendor, setVendor] = useState('');
  const [periodMonths, setPeriodMonths] = useState(12);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSearch = async () => {
    if (!vendor.trim()) return;
    try {
      setLoading(true);
      setData(null);
      setError(null);
      const res = await salesAPI.debugVendor(vendor, periodMonths);
      setData(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const formatNumber = (value) => {
    return new Intl.NumberFormat('en-US').format(value || 0);
  };

  return (
    <Layout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Sales Data Debug</h1>
          <p className="text-gray-500">Look up BigQuery sales data by vendor - quantity sold by location</p>
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
              value={vendor}
              onChange={(e) => setVendor(e.target.value)}
              className="flex-1 px-4 py-2 border rounded-md text-lg"
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
            <select
              value={periodMonths}
              onChange={(e) => setPeriodMonths(parseInt(e.target.value))}
              className="px-4 py-2 border rounded-md"
            >
              <option value={3}>Last 3 months</option>
              <option value={6}>Last 6 months</option>
              <option value={12}>Last 12 months</option>
              <option value={24}>Last 24 months</option>
            </select>
            <button
              onClick={handleSearch}
              disabled={loading || !vendor.trim()}
              className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-300 font-medium"
            >
              {loading ? 'Searching...' : 'Search'}
            </button>
          </div>

          {data && (
            <div className="space-y-4">
              {/* Summary */}
              <div className="bg-blue-50 p-4 rounded-lg">
                <div className="text-sm text-blue-600 mb-1">
                  {data.families?.length || 0} products found ({data.period_months} month period)
                </div>
                <div className="grid grid-cols-4 gap-4 text-center">
                  <div>
                    <div className="text-2xl font-bold text-gray-900">{formatNumber(data.totals?.slc)}</div>
                    <div className="text-sm text-gray-500">SLC</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-gray-900">{formatNumber(data.totals?.south_main)}</div>
                    <div className="text-sm text-gray-500">South Main</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-gray-900">{formatNumber(data.totals?.ogden)}</div>
                    <div className="text-sm text-gray-500">Ogden</div>
                  </div>
                  <div>
                    <div className="text-2xl font-bold text-blue-600">{formatNumber(data.totals?.total)}</div>
                    <div className="text-sm text-gray-500">Total</div>
                  </div>
                </div>
              </div>

              {/* Product Table */}
              <div className="max-h-[500px] overflow-y-auto border rounded-lg">
                <table className="min-w-full">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="px-4 py-3 text-left text-sm font-semibold text-gray-900">Product</th>
                      <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900 w-24">SLC</th>
                      <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900 w-24">South Main</th>
                      <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900 w-24">Ogden</th>
                      <th className="px-4 py-3 text-right text-sm font-semibold text-gray-900 w-24">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {data.families?.map((family, i) => (
                      <tr key={i} className="hover:bg-gray-50">
                        <td className="px-4 py-2 text-sm text-gray-900">{family.product_name}</td>
                        <td className="px-4 py-2 text-sm text-right font-mono">
                          {family.slc > 0 ? formatNumber(family.slc) : <span className="text-gray-300">-</span>}
                        </td>
                        <td className="px-4 py-2 text-sm text-right font-mono">
                          {family.south_main > 0 ? formatNumber(family.south_main) : <span className="text-gray-300">-</span>}
                        </td>
                        <td className="px-4 py-2 text-sm text-right font-mono">
                          {family.ogden > 0 ? formatNumber(family.ogden) : <span className="text-gray-300">-</span>}
                        </td>
                        <td className="px-4 py-2 text-sm text-right font-mono font-semibold">
                          {formatNumber(family.total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-100 sticky bottom-0">
                    <tr className="font-bold">
                      <td className="px-4 py-3 text-sm">TOTAL</td>
                      <td className="px-4 py-3 text-sm text-right font-mono">{formatNumber(data.totals?.slc)}</td>
                      <td className="px-4 py-3 text-sm text-right font-mono">{formatNumber(data.totals?.south_main)}</td>
                      <td className="px-4 py-3 text-sm text-right font-mono">{formatNumber(data.totals?.ogden)}</td>
                      <td className="px-4 py-3 text-sm text-right font-mono text-blue-600">{formatNumber(data.totals?.total)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {!data && !loading && (
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
