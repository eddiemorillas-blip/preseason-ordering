import { useState, useEffect } from 'react';
import { priceAPI, brandAPI } from '../services/api';
import Layout from '../components/Layout';

const SeasonPriceComparison = () => {
  const [seasons, setSeasons] = useState([]);
  const [brands, setBrands] = useState([]);
  const [selectedSeason1, setSelectedSeason1] = useState('');
  const [selectedSeason2, setSelectedSeason2] = useState('');
  const [selectedBrand, setSelectedBrand] = useState('');
  const [comparison, setComparison] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all'); // all, carryover, new, discontinued, increased, decreased

  // Fetch seasons and brands on mount
  useEffect(() => {
    const fetchData = async () => {
      try {
        const [seasonsRes, brandsRes] = await Promise.all([
          priceAPI.getSeasonsWithPrices(),
          brandAPI.getAll()
        ]);
        setSeasons(seasonsRes.data.seasons || []);
        setBrands(brandsRes.data.brands || []);
      } catch (err) {
        console.error('Error fetching data:', err);
        setError('Failed to load seasons and brands');
      }
    };
    fetchData();
  }, []);

  // Compare seasons
  const handleCompare = async () => {
    if (!selectedSeason1 || !selectedSeason2) {
      setError('Please select both seasons to compare');
      return;
    }

    if (selectedSeason1 === selectedSeason2) {
      setError('Please select two different seasons');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const response = await priceAPI.compare(selectedSeason1, selectedSeason2, selectedBrand || null);
      setComparison(response.data);
    } catch (err) {
      console.error('Comparison error:', err);
      setError(err.response?.data?.error || 'Failed to compare seasons');
    } finally {
      setLoading(false);
    }
  };

  // Filter products based on selected filter
  const getFilteredProducts = () => {
    if (!comparison?.products) return [];

    switch (filter) {
      case 'carryover':
        return comparison.products.filter(p => p.product_status === 'carryover');
      case 'new':
        return comparison.products.filter(p => p.product_status === 'new');
      case 'discontinued':
        return comparison.products.filter(p => p.product_status === 'discontinued');
      case 'increased':
        return comparison.products.filter(p => p.wholesale_diff > 0);
      case 'decreased':
        return comparison.products.filter(p => p.wholesale_diff < 0);
      case 'unchanged':
        return comparison.products.filter(p => p.wholesale_diff === 0 && p.product_status === 'carryover');
      default:
        return comparison.products;
    }
  };

  const formatPrice = (price) => {
    if (price === null || price === undefined) return '-';
    return `$${parseFloat(price).toFixed(2)}`;
  };

  const formatChange = (diff, pctChange) => {
    if (diff === null || diff === undefined) return '-';
    const sign = diff > 0 ? '+' : '';
    const pct = pctChange !== null ? ` (${sign}${pctChange}%)` : '';
    return `${sign}${formatPrice(diff)}${pct}`;
  };

  const getChangeClass = (diff) => {
    if (diff === null || diff === undefined || diff === 0) return '';
    return diff > 0 ? 'text-red-600' : 'text-green-600';
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'carryover':
        return <span className="px-2 py-1 text-xs rounded bg-blue-100 text-blue-800">Carryover</span>;
      case 'new':
        return <span className="px-2 py-1 text-xs rounded bg-green-100 text-green-800">New</span>;
      case 'discontinued':
        return <span className="px-2 py-1 text-xs rounded bg-gray-100 text-gray-800">Discontinued</span>;
      default:
        return null;
    }
  };

  const filteredProducts = getFilteredProducts();

  // Export to CSV
  const exportToCSV = () => {
    if (!comparison?.products) return;

    const headers = [
      'UPC', 'SKU', 'Product Name', 'Brand', 'Category', 'Status',
      `${comparison.seasons.season1} Wholesale`, `${comparison.seasons.season1} MSRP`,
      `${comparison.seasons.season2} Wholesale`, `${comparison.seasons.season2} MSRP`,
      'Wholesale Change', 'Wholesale % Change'
    ];

    const rows = filteredProducts.map(p => [
      p.upc,
      p.sku || '',
      p.name,
      p.brand_name,
      p.category || '',
      p.product_status,
      p.season1_wholesale || '',
      p.season1_msrp || '',
      p.season2_wholesale || '',
      p.season2_msrp || '',
      p.wholesale_diff || '',
      p.wholesale_pct_change || ''
    ]);

    const csvContent = [headers, ...rows]
      .map(row => row.map(cell => `"${cell}"`).join(','))
      .join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `price-comparison-${comparison.seasons.season1}-vs-${comparison.seasons.season2}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  return (
    <Layout>
      <div className="max-w-7xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Season Price Comparison</h1>

        {/* Selection Controls */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                First Season
              </label>
              <select
                value={selectedSeason1}
                onChange={(e) => setSelectedSeason1(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2"
              >
                <option value="">Select season...</option>
                {seasons.map(season => (
                  <option key={season.id} value={season.id}>
                    {season.name} ({season.product_count} products)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Second Season
              </label>
              <select
                value={selectedSeason2}
                onChange={(e) => setSelectedSeason2(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2"
              >
                <option value="">Select season...</option>
                {seasons.map(season => (
                  <option key={season.id} value={season.id}>
                    {season.name} ({season.product_count} products)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Brand (optional)
              </label>
              <select
                value={selectedBrand}
                onChange={(e) => setSelectedBrand(e.target.value)}
                className="w-full border border-gray-300 rounded-md px-3 py-2"
              >
                <option value="">All brands</option>
                {brands.map(brand => (
                  <option key={brand.id} value={brand.id}>{brand.name}</option>
                ))}
              </select>
            </div>

            <div className="flex items-end">
              <button
                onClick={handleCompare}
                disabled={loading || !selectedSeason1 || !selectedSeason2}
                className="w-full bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
              >
                {loading ? 'Comparing...' : 'Compare Seasons'}
              </button>
            </div>
          </div>

          {error && (
            <div className="mt-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
              {error}
            </div>
          )}
        </div>

        {/* Summary Cards */}
        {comparison && (
          <div className="grid grid-cols-2 md:grid-cols-6 gap-4 mb-6">
            <div
              className={`bg-white rounded-lg shadow p-4 cursor-pointer ${filter === 'all' ? 'ring-2 ring-blue-500' : ''}`}
              onClick={() => setFilter('all')}
            >
              <div className="text-2xl font-bold text-gray-900">{comparison.summary.total_products}</div>
              <div className="text-sm text-gray-500">Total Products</div>
            </div>
            <div
              className={`bg-white rounded-lg shadow p-4 cursor-pointer ${filter === 'carryover' ? 'ring-2 ring-blue-500' : ''}`}
              onClick={() => setFilter('carryover')}
            >
              <div className="text-2xl font-bold text-blue-600">{comparison.summary.carryover}</div>
              <div className="text-sm text-gray-500">Carryover</div>
            </div>
            <div
              className={`bg-white rounded-lg shadow p-4 cursor-pointer ${filter === 'new' ? 'ring-2 ring-blue-500' : ''}`}
              onClick={() => setFilter('new')}
            >
              <div className="text-2xl font-bold text-green-600">{comparison.summary.new_products}</div>
              <div className="text-sm text-gray-500">New</div>
            </div>
            <div
              className={`bg-white rounded-lg shadow p-4 cursor-pointer ${filter === 'discontinued' ? 'ring-2 ring-blue-500' : ''}`}
              onClick={() => setFilter('discontinued')}
            >
              <div className="text-2xl font-bold text-gray-600">{comparison.summary.discontinued}</div>
              <div className="text-sm text-gray-500">Discontinued</div>
            </div>
            <div
              className={`bg-white rounded-lg shadow p-4 cursor-pointer ${filter === 'increased' ? 'ring-2 ring-blue-500' : ''}`}
              onClick={() => setFilter('increased')}
            >
              <div className="text-2xl font-bold text-red-600">{comparison.summary.price_increases}</div>
              <div className="text-sm text-gray-500">Price Increases</div>
            </div>
            <div
              className={`bg-white rounded-lg shadow p-4 cursor-pointer ${filter === 'decreased' ? 'ring-2 ring-blue-500' : ''}`}
              onClick={() => setFilter('decreased')}
            >
              <div className="text-2xl font-bold text-green-600">{comparison.summary.price_decreases}</div>
              <div className="text-sm text-gray-500">Price Decreases</div>
            </div>
          </div>
        )}

        {/* Results Table */}
        {comparison && (
          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
              <h2 className="text-lg font-medium text-gray-900">
                {comparison.seasons.season1} vs {comparison.seasons.season2}
                <span className="ml-2 text-sm text-gray-500">
                  ({filteredProducts.length} products)
                </span>
              </h2>
              <button
                onClick={exportToCSV}
                className="px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
              >
                Export CSV
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Product</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">UPC</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                      {comparison.seasons.season1} Wholesale
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                      {comparison.seasons.season2} Wholesale
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Change</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredProducts.map((product) => (
                    <tr key={product.product_id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <div className="text-sm font-medium text-gray-900">{product.name}</div>
                        <div className="text-sm text-gray-500">{product.brand_name}</div>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">{product.upc}</td>
                      <td className="px-4 py-3">{getStatusBadge(product.product_status)}</td>
                      <td className="px-4 py-3 text-sm text-right text-gray-900">
                        {formatPrice(product.season1_wholesale)}
                      </td>
                      <td className="px-4 py-3 text-sm text-right text-gray-900">
                        {formatPrice(product.season2_wholesale)}
                      </td>
                      <td className={`px-4 py-3 text-sm text-right font-medium ${getChangeClass(product.wholesale_diff)}`}>
                        {formatChange(product.wholesale_diff, product.wholesale_pct_change)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {filteredProducts.length === 0 && (
                <div className="text-center py-8 text-gray-500">
                  No products match the selected filter
                </div>
              )}
            </div>
          </div>
        )}

        {!comparison && !loading && (
          <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
            Select two seasons above to compare their prices
          </div>
        )}
      </div>
    </Layout>
  );
};

export default SeasonPriceComparison;
