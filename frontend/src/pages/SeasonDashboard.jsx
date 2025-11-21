import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../services/api';
import Layout from '../components/Layout';
import { useAuth } from '../context/AuthContext';

const SeasonDashboard = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isAdmin, isBuyer } = useAuth();

  const [season, setSeason] = useState(null);
  const [budgets, setBudgets] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showBudgetModal, setShowBudgetModal] = useState(false);
  const [showAddOrderModal, setShowAddOrderModal] = useState(false);

  useEffect(() => {
    fetchDashboardData();
  }, [id]);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);

      // Fetch season details, budget summary, and orders in parallel
      const [seasonRes, budgetRes, ordersRes] = await Promise.all([
        api.get(`/seasons/${id}`),
        api.get(`/seasons/${id}/summary`),
        api.get(`/orders?seasonId=${id}`)
      ]);

      setSeason(seasonRes.data.season);
      setBudgets(budgetRes.data.budgets);
      setOrders(ordersRes.data.orders);
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

  // Group orders by brand and ship date
  const groupedOrders = orders.reduce((acc, order) => {
    const key = `${order.brand_name}_${order.ship_date || 'No date'}`;
    if (!acc[key]) {
      acc[key] = {
        brand: order.brand_name,
        shipDate: order.ship_date,
        orders: []
      };
    }
    acc[key].orders.push(order);
    return acc;
  }, {});

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
              ← Back to Seasons
            </button>
            <h1 className="text-3xl font-bold text-gray-900">{season.name}</h1>
            <div className="mt-2 flex items-center space-x-4">
              <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${getStatusColor(season.status)}`}>
                {season.status}
              </span>
              {season.start_date && (
                <span className="text-sm text-gray-600">
                  {new Date(season.start_date).toLocaleDateString()} - {season.end_date ? new Date(season.end_date).toLocaleDateString() : 'Ongoing'}
                </span>
              )}
            </div>
          </div>
          {(isAdmin() || isBuyer()) && (
            <div className="flex space-x-2">
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
            </div>
          )}
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-md p-4">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        {/* Budget Overview */}
        <div className="bg-white shadow rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Budget Overview</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Location
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Brand
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                    Budget
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                    Ordered
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                    Remaining
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                    % Used
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {budgets.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-4 text-center text-sm text-gray-500">
                      No budgets set for this season.{' '}
                      {(isAdmin() || isBuyer()) && (
                        <button
                          onClick={() => setShowBudgetModal(true)}
                          className="text-blue-600 hover:text-blue-800"
                        >
                          Add budgets
                        </button>
                      )}
                    </td>
                  </tr>
                ) : (
                  budgets.map((budget) => {
                    const percentUsed = budget.budget_amount > 0
                      ? (parseFloat(budget.total_ordered) / parseFloat(budget.budget_amount)) * 100
                      : 0;
                    const isOverBudget = percentUsed > 100;

                    return (
                      <tr key={budget.id} className={isOverBudget ? 'bg-red-50' : ''}>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {budget.location_name}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {budget.brand_name}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                          {formatCurrency(budget.budget_amount)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-right text-gray-900">
                          {formatCurrency(budget.total_ordered)}
                        </td>
                        <td className={`px-6 py-4 whitespace-nowrap text-sm text-right font-medium ${
                          isOverBudget ? 'text-red-600' : 'text-green-600'
                        }`}>
                          {formatCurrency(budget.remaining)}
                        </td>
                        <td className={`px-6 py-4 whitespace-nowrap text-sm text-right ${
                          isOverBudget ? 'text-red-600' : 'text-gray-900'
                        }`}>
                          {percentUsed.toFixed(1)}%
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Orders List */}
        <div className="bg-white shadow rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Orders</h2>
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
              Object.values(groupedOrders).map((group, idx) => (
                <div key={idx} className="px-6 py-4">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-gray-900">
                      {group.brand} - {group.shipDate ? new Date(group.shipDate).toLocaleDateString() : 'No ship date'}
                    </h3>
                  </div>
                  <div className="space-y-2">
                    {group.orders.map((order) => (
                      <div
                        key={order.id}
                        className="flex items-center justify-between p-3 bg-gray-50 rounded-md hover:bg-gray-100 cursor-pointer"
                        onClick={() => navigate(`/orders/${order.id}`)}
                      >
                        <div className="flex-1">
                          <div className="flex items-center space-x-3">
                            <span className="text-sm font-medium text-gray-900">
                              {order.order_number}
                            </span>
                            <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getOrderStatusColor(order.status)}`}>
                              {order.status}
                            </span>
                          </div>
                          <div className="mt-1 text-xs text-gray-600">
                            {order.location_name} ({order.location_code}) • {order.item_count} items
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-semibold text-gray-900">
                            {formatCurrency(order.current_total)}
                          </div>
                          <div className="text-xs text-gray-500">
                            {order.created_by_email}
                          </div>
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
const AddOrderModal = ({ seasonId, seasonName, onClose, onOrderCreated }) => {
  const [brands, setBrands] = useState([]);
  const [locations, setLocations] = useState([]);
  const [formData, setFormData] = useState({
    brand_id: '',
    location_id: '',
    ship_date: '',
    order_type: 'preseason',
    notes: '',
    budget_total: ''
  });
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

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await api.post('/orders', {
        season_id: seasonId,
        ...formData
      });

      onOrderCreated(response.data.order.id);
    } catch (err) {
      console.error('Error creating order:', err);
      setError(err.response?.data?.error || 'Failed to create order');
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full">
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
              Ship Date
            </label>
            <input
              type="date"
              value={formData.ship_date}
              onChange={(e) => setFormData({ ...formData, ship_date: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
            />
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
              Budget Total
            </label>
            <input
              type="number"
              step="0.01"
              value={formData.budget_total}
              onChange={(e) => setFormData({ ...formData, budget_total: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
              placeholder="Optional"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Notes
            </label>
            <textarea
              value={formData.notes}
              onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
              rows={3}
              placeholder="Optional notes"
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
              {loading ? 'Creating...' : 'Create Order'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default SeasonDashboard;
