import { useState, useEffect, useCallback } from 'react';
import { productAPI, priceAPI } from '../services/api';
import Layout from '../components/Layout';

const PriceHistory = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [priceData, setPriceData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [error, setError] = useState('');

  // Search for products
  const searchProducts = useCallback(async (query) => {
    if (!query || query.trim().length < 2) {
      setSearchResults([]);
      return;
    }

    setSearchLoading(true);
    try {
      const response = await productAPI.search({ q: query.trim(), limit: 10 });
      setSearchResults(response.data.products || []);
    } catch (err) {
      console.error('Search error:', err);
      setSearchResults([]);
    } finally {
      setSearchLoading(false);
    }
  }, []);

  // Debounced search
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      searchProducts(searchQuery);
    }, 300);
    return () => clearTimeout(timeoutId);
  }, [searchQuery, searchProducts]);

  // Load price history for selected product
  const loadPriceHistory = async (product) => {
    setSelectedProduct(product);
    setSearchResults([]);
    setSearchQuery('');
    setLoading(true);
    setError('');

    try {
      const response = await priceAPI.getProductHistory(product.id);
      setPriceData(response.data);
    } catch (err) {
      console.error('Error loading price history:', err);
      setError(err.response?.data?.error || 'Failed to load price history');
      setPriceData(null);
    } finally {
      setLoading(false);
    }
  };

  const formatPrice = (price) => {
    if (price === null || price === undefined) return '-';
    return `$${parseFloat(price).toFixed(2)}`;
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getChangeReason = (reason) => {
    switch (reason) {
      case 'catalog_upload':
        return 'Catalog Upload';
      case 'manual_edit':
        return 'Manual Edit';
      case 'migration_from_products':
        return 'Initial Migration';
      default:
        return reason || 'Unknown';
    }
  };

  const getPriceChange = (oldPrice, newPrice) => {
    if (oldPrice === null || oldPrice === undefined) return null;
    if (newPrice === null || newPrice === undefined) return null;
    return parseFloat(newPrice) - parseFloat(oldPrice);
  };

  return (
    <Layout>
      <div className="max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Price History</h1>

        {/* Search Box */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Search for a product by name, UPC, or SKU
          </label>
          <div className="relative">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Enter product name, UPC, or SKU..."
              className="w-full border border-gray-300 rounded-md px-4 py-2"
            />

            {/* Search Results Dropdown */}
            {searchResults.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-auto">
                {searchResults.map((product) => (
                  <div
                    key={product.id}
                    className="px-4 py-3 hover:bg-gray-100 cursor-pointer border-b border-gray-100 last:border-b-0"
                    onClick={() => loadPriceHistory(product)}
                  >
                    <div className="font-medium text-gray-900">{product.name}</div>
                    <div className="text-sm text-gray-500">
                      UPC: {product.upc} | {product.brand_name}
                      {product.wholesale_cost && ` | ${formatPrice(product.wholesale_cost)}`}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {searchLoading && (
              <div className="absolute right-3 top-3">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600"></div>
              </div>
            )}
          </div>

          {selectedProduct && (
            <div className="mt-4 p-4 bg-blue-50 rounded-md">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-medium text-gray-900">{selectedProduct.name}</h3>
                  <p className="text-sm text-gray-600">
                    UPC: {selectedProduct.upc} | SKU: {selectedProduct.sku || '-'} | {selectedProduct.brand_name}
                  </p>
                </div>
                <button
                  onClick={() => {
                    setSelectedProduct(null);
                    setPriceData(null);
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-100 border border-red-400 text-red-700 rounded">
            {error}
          </div>
        )}

        {loading && (
          <div className="bg-white rounded-lg shadow p-8 text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
            <p className="mt-2 text-gray-500">Loading price history...</p>
          </div>
        )}

        {/* Seasonal Prices */}
        {priceData && priceData.season_prices && priceData.season_prices.length > 0 && (
          <div className="bg-white rounded-lg shadow mb-6">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-medium text-gray-900">Prices by Season</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Season</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Wholesale</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">MSRP</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Updated</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {priceData.season_prices.map((sp, index) => {
                    const prevSeason = priceData.season_prices[index + 1];
                    const wholesaleChange = prevSeason
                      ? getPriceChange(prevSeason.wholesale_cost, sp.wholesale_cost)
                      : null;

                    return (
                      <tr key={sp.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4">
                          <div className="font-medium text-gray-900">{sp.season_name}</div>
                          {sp.start_date && (
                            <div className="text-sm text-gray-500">
                              {new Date(sp.start_date).toLocaleDateString()} - {new Date(sp.end_date).toLocaleDateString()}
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          <span className={`px-2 py-1 text-xs rounded ${
                            sp.season_status === 'ordering' ? 'bg-green-100 text-green-800' :
                            sp.season_status === 'closed' ? 'bg-gray-100 text-gray-800' :
                            'bg-yellow-100 text-yellow-800'
                          }`}>
                            {sp.season_status}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="font-medium text-gray-900">{formatPrice(sp.wholesale_cost)}</div>
                          {wholesaleChange !== null && wholesaleChange !== 0 && (
                            <div className={`text-sm ${wholesaleChange > 0 ? 'text-red-600' : 'text-green-600'}`}>
                              {wholesaleChange > 0 ? '+' : ''}{formatPrice(wholesaleChange)}
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4 text-right font-medium text-gray-900">
                          {formatPrice(sp.msrp)}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-500">
                          {formatDate(sp.updated_at)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Price Change History */}
        {priceData && priceData.history && priceData.history.length > 0 && (
          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-medium text-gray-900">Change History</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Season</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Reason</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Old Wholesale</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">New Wholesale</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Change</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {priceData.history.map((entry) => {
                    const change = getPriceChange(entry.old_wholesale_cost, entry.new_wholesale_cost);
                    return (
                      <tr key={entry.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 text-sm text-gray-900">
                          {formatDate(entry.changed_at)}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-500">
                          {entry.season_name || '-'}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-500">
                          {getChangeReason(entry.change_reason)}
                        </td>
                        <td className="px-6 py-4 text-sm text-right text-gray-500">
                          {formatPrice(entry.old_wholesale_cost)}
                        </td>
                        <td className="px-6 py-4 text-sm text-right font-medium text-gray-900">
                          {formatPrice(entry.new_wholesale_cost)}
                        </td>
                        <td className={`px-6 py-4 text-sm text-right font-medium ${
                          change === null ? 'text-gray-400' :
                          change > 0 ? 'text-red-600' :
                          change < 0 ? 'text-green-600' :
                          'text-gray-500'
                        }`}>
                          {change !== null ? (
                            <>
                              {change > 0 ? '+' : ''}{formatPrice(change)}
                            </>
                          ) : (
                            'Initial'
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* No History Message */}
        {priceData && (!priceData.history || priceData.history.length === 0) && (!priceData.season_prices || priceData.season_prices.length === 0) && (
          <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
            No price history found for this product
          </div>
        )}

        {/* Initial State */}
        {!selectedProduct && !loading && (
          <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
            Search for a product above to view its price history across seasons
          </div>
        )}
      </div>
    </Layout>
  );
};

export default PriceHistory;
