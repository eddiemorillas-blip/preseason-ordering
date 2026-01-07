import { useState } from 'react';
import Layout from '../components/Layout';
import { salesAPI } from '../services/api';

const SalesDebug = () => {
  // Default to last 12 months
  const today = new Date();
  const oneYearAgo = new Date(today);
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

  const [vendor, setVendor] = useState('');
  const [startDate, setStartDate] = useState(oneYearAgo.toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(today.toISOString().split('T')[0]);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSearch = async () => {
    if (!vendor.trim()) return;
    if (!startDate || !endDate) {
      setError('Please select both start and end dates');
      return;
    }
    try {
      setLoading(true);
      setData(null);
      setError(null);
      const res = await salesAPI.debugVendor(vendor, startDate, endDate);
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

  const formatDateRange = () => {
    if (!data?.start_date || !data?.end_date) return '';
    const start = new Date(data.start_date).toLocaleDateString();
    const end = new Date(data.end_date).toLocaleDateString();
    return `${start} - ${end}`;
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
          <div className="flex flex-wrap gap-4 mb-6 items-end">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-sm font-medium text-gray-700 mb-1">Vendor</label>
              <input
                type="text"
                placeholder="e.g., Scarpa"
                value={vendor}
                onChange={(e) => setVendor(e.target.value)}
                className="w-full px-4 py-2 border rounded-md"
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="px-4 py-2 border rounded-md"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="px-4 py-2 border rounded-md"
              />
            </div>
            <button
              onClick={handleSearch}
              disabled={loading || !vendor.trim()}
              className="px-6 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-300 font-medium h-[42px]"
            >
              {loading ? 'Searching...' : 'Search'}
            </button>
          </div>

          {data && (
            <div className="space-y-4">
              {/* Summary */}
              <div className="bg-blue-50 p-4 rounded-lg">
                <div className="text-sm text-blue-600 mb-1">
                  {data.families?.length || 0} products found ({formatDateRange()})
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
              Enter a vendor name and date range, then click Search
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
};

export default SalesDebug;
