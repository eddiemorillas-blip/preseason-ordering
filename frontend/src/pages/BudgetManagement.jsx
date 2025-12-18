import { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import { budgetAPI, brandAPI } from '../services/api';
import api from '../services/api';

const BudgetManagement = () => {
  const [seasons, setSeasons] = useState([]);
  const [selectedSeason, setSelectedSeason] = useState(null);
  const [budgetData, setBudgetData] = useState(null);
  const [brands, setBrands] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  // Form state
  const [totalBudget, setTotalBudget] = useState('');
  const [notes, setNotes] = useState('');
  const [allocations, setAllocations] = useState([]);
  const [suggestions, setSuggestions] = useState(null);

  useEffect(() => {
    loadInitialData();
  }, []);

  useEffect(() => {
    if (selectedSeason) {
      loadBudgetData(selectedSeason);
    }
  }, [selectedSeason]);

  const loadInitialData = async () => {
    try {
      setLoading(true);
      const [seasonsRes, brandsRes, statusRes] = await Promise.all([
        api.get('/seasons'),
        brandAPI.getAll(),
        budgetAPI.getStatus()
      ]);
      setSeasons(seasonsRes.data || []);
      setBrands(brandsRes.data || []);

      // Auto-select first active season
      const activeSeason = seasonsRes.data?.find(s => s.status === 'active') || seasonsRes.data?.[0];
      if (activeSeason) {
        setSelectedSeason(activeSeason.id);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const loadBudgetData = async (seasonId) => {
    try {
      const res = await budgetAPI.getSeasonBudget(seasonId);
      setBudgetData(res.data);
      setTotalBudget(res.data.budget?.total_budget || '');
      setNotes(res.data.budget?.notes || '');
      setAllocations(res.data.allocations || []);
    } catch (err) {
      console.error('Error loading budget:', err);
    }
  };

  const handleSaveBudget = async () => {
    if (!selectedSeason || !totalBudget) return;

    try {
      setSaving(true);
      setError(null);
      await budgetAPI.setSeasonBudget(selectedSeason, {
        total_budget: parseFloat(totalBudget),
        notes
      });
      setSuccess('Budget saved successfully');
      loadBudgetData(selectedSeason);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save budget');
    } finally {
      setSaving(false);
    }
  };

  const handleGetSuggestions = async () => {
    if (!selectedSeason || !totalBudget) return;

    try {
      const res = await budgetAPI.getSuggestions(selectedSeason, parseFloat(totalBudget));
      setSuggestions(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to get suggestions');
    }
  };

  const handleApplySuggestions = () => {
    if (!suggestions?.suggestions) return;

    const newAllocations = suggestions.suggestions.map(s => ({
      brand_id: s.brand_id,
      brand_name: s.brand_name,
      allocated_amount: s.suggested_allocation,
      last_year_revenue: s.last_year_revenue,
      last_year_pct: s.last_year_pct
    }));
    setAllocations(newAllocations);
    setSuggestions(null);
  };

  const handleSaveAllocations = async () => {
    if (!selectedSeason || allocations.length === 0) return;

    try {
      setSaving(true);
      setError(null);
      await budgetAPI.setAllocations(selectedSeason, allocations);
      setSuccess('Allocations saved successfully');
      loadBudgetData(selectedSeason);
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save allocations');
    } finally {
      setSaving(false);
    }
  };

  const handleAllocationChange = (index, field, value) => {
    const updated = [...allocations];
    updated[index] = { ...updated[index], [field]: value };
    setAllocations(updated);
  };

  const handleAddAllocation = () => {
    setAllocations([...allocations, { brand_id: '', allocated_amount: 0, notes: '' }]);
  };

  const handleRemoveAllocation = (index) => {
    setAllocations(allocations.filter((_, i) => i !== index));
  };

  const formatCurrency = (value) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value || 0);
  };

  const totalAllocated = allocations.reduce((sum, a) => sum + (parseFloat(a.allocated_amount) || 0), 0);
  const remaining = (parseFloat(totalBudget) || 0) - totalAllocated;

  if (loading) {
    return (
      <Layout>
        <div className="flex justify-center items-center h-64">
          <div className="text-gray-500">Loading budget data...</div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-bold text-gray-900">Season Budget Management</h1>
          <select
            value={selectedSeason || ''}
            onChange={(e) => setSelectedSeason(e.target.value)}
            className="px-4 py-2 border rounded-md"
          >
            <option value="">Select Season</option>
            {seasons.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        )}

        {success && (
          <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded">
            {success}
          </div>
        )}

        {selectedSeason && (
          <>
            {/* Budget Summary */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-white p-4 rounded-lg shadow">
                <div className="text-sm text-gray-500">Total Budget</div>
                <div className="text-xl font-semibold text-blue-600">
                  {formatCurrency(totalBudget)}
                </div>
              </div>
              <div className="bg-white p-4 rounded-lg shadow">
                <div className="text-sm text-gray-500">Total Allocated</div>
                <div className="text-xl font-semibold text-purple-600">
                  {formatCurrency(totalAllocated)}
                </div>
              </div>
              <div className="bg-white p-4 rounded-lg shadow">
                <div className="text-sm text-gray-500">Unallocated</div>
                <div className={`text-xl font-semibold ${remaining < 0 ? 'text-red-600' : 'text-green-600'}`}>
                  {formatCurrency(remaining)}
                </div>
              </div>
              <div className="bg-white p-4 rounded-lg shadow">
                <div className="text-sm text-gray-500">Committed</div>
                <div className="text-xl font-semibold text-orange-600">
                  {formatCurrency(budgetData?.totalCommitted)}
                </div>
              </div>
            </div>

            {/* Budget Settings */}
            <div className="bg-white rounded-lg shadow p-4">
              <h2 className="text-lg font-semibold mb-4">Budget Settings</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Total Budget ($)
                  </label>
                  <input
                    type="number"
                    value={totalBudget}
                    onChange={(e) => setTotalBudget(e.target.value)}
                    className="w-full px-3 py-2 border rounded-md"
                    placeholder="Enter total budget"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Notes
                  </label>
                  <input
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full px-3 py-2 border rounded-md"
                    placeholder="Optional notes"
                  />
                </div>
              </div>
              <div className="mt-4 flex gap-2">
                <button
                  onClick={handleSaveBudget}
                  disabled={saving || !totalBudget}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400"
                >
                  Save Budget
                </button>
                <button
                  onClick={handleGetSuggestions}
                  disabled={!totalBudget}
                  className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 disabled:bg-gray-400"
                >
                  Get AI Suggestions
                </button>
              </div>
            </div>

            {/* Suggestions Modal */}
            {suggestions && (
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-semibold text-purple-900">Suggested Allocations (Based on Last 12 Months Sales)</h3>
                  <div className="flex gap-2">
                    <button
                      onClick={handleApplySuggestions}
                      className="px-3 py-1 bg-purple-600 text-white rounded-md hover:bg-purple-700 text-sm"
                    >
                      Apply All
                    </button>
                    <button
                      onClick={() => setSuggestions(null)}
                      className="px-3 py-1 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 text-sm"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
                <div className="max-h-64 overflow-y-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="text-left text-purple-700">
                        <th className="py-2">Brand</th>
                        <th className="py-2">Last Year Revenue</th>
                        <th className="py-2">% of Total</th>
                        <th className="py-2">Suggested Allocation</th>
                      </tr>
                    </thead>
                    <tbody>
                      {suggestions.suggestions?.slice(0, 20).map((s, idx) => (
                        <tr key={idx} className="border-t border-purple-200">
                          <td className="py-2">{s.brand_name || s.rgp_vendor_name}</td>
                          <td className="py-2">{formatCurrency(s.last_year_revenue)}</td>
                          <td className="py-2">{s.last_year_pct?.toFixed(1)}%</td>
                          <td className="py-2 font-medium">{formatCurrency(s.suggested_allocation)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Allocations Table */}
            <div className="bg-white rounded-lg shadow">
              <div className="p-4 border-b flex justify-between items-center">
                <div>
                  <h2 className="text-lg font-semibold">Brand Allocations</h2>
                  <p className="text-sm text-gray-500">Set budget allocations by brand</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={handleAddAllocation}
                    className="px-3 py-1 bg-green-600 text-white rounded-md hover:bg-green-700 text-sm"
                  >
                    + Add Brand
                  </button>
                  <button
                    onClick={handleSaveAllocations}
                    disabled={saving || allocations.length === 0}
                    className="px-3 py-1 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400 text-sm"
                  >
                    Save Allocations
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Brand</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Allocated</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Last Year Revenue</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Committed</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Remaining</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {allocations.map((alloc, idx) => {
                      const committed = budgetData?.committedByBrand?.find(c => c.brand_id === alloc.brand_id)?.committed_amount || 0;
                      const allocRemaining = (parseFloat(alloc.allocated_amount) || 0) - parseFloat(committed);
                      return (
                        <tr key={idx}>
                          <td className="px-4 py-3">
                            <select
                              value={alloc.brand_id || ''}
                              onChange={(e) => {
                                const brand = brands.find(b => b.id === parseInt(e.target.value));
                                handleAllocationChange(idx, 'brand_id', e.target.value);
                                if (brand) {
                                  handleAllocationChange(idx, 'brand_name', brand.name);
                                }
                              }}
                              className="w-full px-2 py-1 border rounded"
                            >
                              <option value="">Select Brand</option>
                              {brands.map(b => (
                                <option key={b.id} value={b.id}>{b.name}</option>
                              ))}
                            </select>
                          </td>
                          <td className="px-4 py-3">
                            <input
                              type="number"
                              value={alloc.allocated_amount || ''}
                              onChange={(e) => handleAllocationChange(idx, 'allocated_amount', e.target.value)}
                              className="w-32 px-2 py-1 border rounded"
                              placeholder="0"
                            />
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-500">
                            {formatCurrency(alloc.last_year_revenue)}
                          </td>
                          <td className="px-4 py-3 text-sm">
                            {formatCurrency(committed)}
                          </td>
                          <td className={`px-4 py-3 text-sm font-medium ${allocRemaining < 0 ? 'text-red-600' : 'text-green-600'}`}>
                            {formatCurrency(allocRemaining)}
                          </td>
                          <td className="px-4 py-3">
                            <button
                              onClick={() => handleRemoveAllocation(idx)}
                              className="text-red-600 hover:text-red-900"
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {allocations.length === 0 && (
                      <tr>
                        <td colSpan="6" className="px-4 py-8 text-center text-gray-500">
                          No allocations set. Click "Add Brand" or use "Get AI Suggestions" to start.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </Layout>
  );
};

export default BudgetManagement;
