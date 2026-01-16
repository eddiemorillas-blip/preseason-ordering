import { useState } from 'react';
import PropTypes from 'prop-types';
import { agentAPI } from '../services/api';

const SuggestionsTable = ({ suggestions, onUpdate }) => {
  const [selectedIds, setSelectedIds] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [bulkProcessing, setBulkProcessing] = useState(false);
  const [errors, setErrors] = useState({});

  const toggleSelection = (id) => {
    setSelectedIds(prev =>
      prev.includes(id) ? prev.filter(sid => sid !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === suggestions.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(suggestions.map(s => s.id));
    }
  };

  const handleBulkApprove = async () => {
    setBulkProcessing(true);
    const newErrors = {};
    let successCount = 0;

    for (const id of selectedIds) {
      try {
        const response = await agentAPI.approveSuggestion(id);
        if (response.data.success) {
          successCount++;
        } else {
          newErrors[id] = response.data.message || 'Failed to apply';
        }
      } catch (err) {
        newErrors[id] = err.response?.data?.error || err.message;
      }
    }

    setErrors(newErrors);
    setBulkProcessing(false);
    setSelectedIds([]);
    onUpdate?.();

    if (successCount > 0) {
      alert(`Successfully applied ${successCount} of ${selectedIds.length} suggestions`);
    }
  };

  const handleBulkReject = async () => {
    if (!confirm(`Are you sure you want to reject ${selectedIds.length} suggestions?`)) {
      return;
    }

    setBulkProcessing(true);

    for (const id of selectedIds) {
      try {
        await agentAPI.rejectSuggestion(id);
      } catch (err) {
        console.error(`Error rejecting ${id}:`, err);
      }
    }

    setBulkProcessing(false);
    setSelectedIds([]);
    onUpdate?.();
  };

  const handleSingleApprove = async (id) => {
    setProcessing(true);
    setErrors(prev => ({ ...prev, [id]: null }));

    try {
      const response = await agentAPI.approveSuggestion(id);
      if (response.data.success) {
        onUpdate?.();
      } else {
        setErrors(prev => ({ ...prev, [id]: response.data.message || 'Failed to apply' }));
      }
    } catch (err) {
      setErrors(prev => ({ ...prev, [id]: err.response?.data?.error || err.message }));
    } finally {
      setProcessing(false);
    }
  };

  const handleSingleReject = async (id) => {
    setProcessing(true);

    try {
      await agentAPI.rejectSuggestion(id);
      onUpdate?.();
    } catch (err) {
      console.error('Error rejecting:', err);
    } finally {
      setProcessing(false);
    }
  };

  const formatCost = (cost) => {
    const value = parseFloat(cost);
    if (value >= 0) {
      return <span className="text-green-600">+${value.toFixed(2)}</span>;
    }
    return <span className="text-red-600">-${Math.abs(value).toFixed(2)}</span>;
  };

  const totalCostImpact = suggestions
    .filter(s => selectedIds.includes(s.id))
    .reduce((sum, s) => sum + parseFloat(s.action_data?.cost_impact || 0), 0);

  return (
    <div className="bg-white rounded-lg shadow-md overflow-hidden">
      {/* Header with bulk actions */}
      <div className="px-4 py-3 bg-gray-50 border-b flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <label className="flex items-center space-x-2 cursor-pointer">
            <input
              type="checkbox"
              checked={selectedIds.length === suggestions.length && suggestions.length > 0}
              onChange={toggleSelectAll}
              className="w-4 h-4 text-blue-600 rounded"
            />
            <span className="text-sm font-medium text-gray-700">
              Select All ({selectedIds.length}/{suggestions.length})
            </span>
          </label>

          {selectedIds.length > 0 && (
            <>
              <div className="h-6 w-px bg-gray-300" />
              <span className="text-sm text-gray-600">
                Total Impact: {formatCost(totalCostImpact)}
              </span>
            </>
          )}
        </div>

        {selectedIds.length > 0 && (
          <div className="flex items-center space-x-2">
            <button
              onClick={handleBulkReject}
              disabled={bulkProcessing}
              className="px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
            >
              Reject ({selectedIds.length})
            </button>
            <button
              onClick={handleBulkApprove}
              disabled={bulkProcessing}
              className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 flex items-center space-x-1"
            >
              {bulkProcessing ? (
                <>
                  <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <span>Applying...</span>
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span>Approve ({selectedIds.length})</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-12">
                Select
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Order
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Product
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Change
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Cost Impact
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Reasoning
              </th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                Confidence
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-32">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {suggestions.map((suggestion) => (
              <tr
                key={suggestion.id}
                className={`${selectedIds.includes(suggestion.id) ? 'bg-blue-50' : 'hover:bg-gray-50'} transition-colors`}
              >
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(suggestion.id)}
                    onChange={() => toggleSelection(suggestion.id)}
                    className="w-4 h-4 text-blue-600 rounded"
                  />
                </td>
                <td className="px-4 py-3">
                  <div className="text-sm font-medium text-gray-900">
                    {suggestion.order_number || `Order #${suggestion.order_id}`}
                  </div>
                  {suggestion.brand_name && (
                    <div className="text-xs text-gray-500">{suggestion.brand_name}</div>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="text-sm text-gray-900">
                    {suggestion.product_name || 'Bulk Change'}
                  </div>
                  {suggestion.sku && (
                    <div className="text-xs text-gray-500">SKU: {suggestion.sku}</div>
                  )}
                </td>
                <td className="px-4 py-3">
                  {suggestion.action_data && (
                    <div className="flex items-center space-x-2 text-sm">
                      <span className="text-gray-600">{suggestion.action_data.from}</span>
                      <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                      </svg>
                      <span className="font-semibold text-blue-600">{suggestion.action_data.to}</span>
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-right text-sm font-medium">
                  {suggestion.action_data?.cost_impact !== undefined
                    ? formatCost(suggestion.action_data.cost_impact)
                    : '-'}
                </td>
                <td className="px-4 py-3">
                  <div className="text-xs text-gray-600 max-w-xs truncate" title={suggestion.reasoning}>
                    {suggestion.reasoning || '-'}
                  </div>
                </td>
                <td className="px-4 py-3 text-center">
                  {suggestion.confidence_score ? (
                    <span className="text-xs font-medium text-gray-700">
                      {(suggestion.confidence_score * 100).toFixed(0)}%
                    </span>
                  ) : '-'}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end space-x-2">
                    <button
                      onClick={() => handleSingleReject(suggestion.id)}
                      disabled={processing || bulkProcessing}
                      className="p-1 text-gray-400 hover:text-red-600 disabled:opacity-50"
                      title="Reject"
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleSingleApprove(suggestion.id)}
                      disabled={processing || bulkProcessing}
                      className="p-1 text-gray-400 hover:text-green-600 disabled:opacity-50"
                      title="Approve"
                    >
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Error messages */}
        {Object.keys(errors).length > 0 && (
          <div className="p-4 bg-red-50 border-t border-red-200">
            <h4 className="text-sm font-medium text-red-800 mb-2">Errors:</h4>
            <ul className="text-xs text-red-700 space-y-1">
              {Object.entries(errors).map(([id, error]) => (
                error && <li key={id}>Suggestion #{id}: {error}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};

SuggestionsTable.propTypes = {
  suggestions: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.number.isRequired,
      order_id: PropTypes.number,
      order_number: PropTypes.string,
      product_name: PropTypes.string,
      sku: PropTypes.string,
      brand_name: PropTypes.string,
      action_data: PropTypes.object,
      reasoning: PropTypes.string,
      confidence_score: PropTypes.number
    })
  ).isRequired,
  onUpdate: PropTypes.func
};

export default SuggestionsTable;
