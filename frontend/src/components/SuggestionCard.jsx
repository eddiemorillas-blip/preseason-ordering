import { useState } from 'react';
import PropTypes from 'prop-types';

const SuggestionCard = ({ suggestion, onApprove, onReject, onUpdate }) => {
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState(null);

  const getTypeLabel = (type) => {
    const labels = {
      adjust_quantity: 'Quantity Adjustment',
      add_product: 'Add Product',
      remove_product: 'Remove Product',
      change_ship_date: 'Change Ship Date',
      adjust_budget: 'Budget Adjustment',
      other: 'Other'
    };
    return labels[type] || type;
  };

  const getTypeIcon = (type) => {
    switch (type) {
      case 'adjust_quantity':
        return (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
          </svg>
        );
      case 'add_product':
        return (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
        );
      case 'remove_product':
        return (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        );
      default:
        return (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        );
    }
  };

  const getStatusBadge = (status) => {
    const badges = {
      pending: { bg: 'bg-yellow-100', text: 'text-yellow-800', label: 'Pending' },
      approved: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Approved' },
      rejected: { bg: 'bg-red-100', text: 'text-red-800', label: 'Rejected' },
      applied: { bg: 'bg-green-100', text: 'text-green-800', label: 'Applied' },
      failed: { bg: 'bg-red-100', text: 'text-red-800', label: 'Failed' }
    };

    const badge = badges[status] || badges.pending;
    return (
      <span className={`px-2 py-1 text-xs font-medium rounded-full ${badge.bg} ${badge.text}`}>
        {badge.label}
      </span>
    );
  };

  const getConfidenceColor = (confidence) => {
    if (confidence >= 0.8) return 'text-green-600';
    if (confidence >= 0.6) return 'text-yellow-600';
    return 'text-orange-600';
  };

  const handleApprove = async () => {
    setProcessing(true);
    setError(null);

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/agent/suggestions/${suggestion.id}/approve`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to approve suggestion');
      }

      const data = await response.json();

      if (data.success) {
        onApprove?.(suggestion.id);
        onUpdate?.();
      } else {
        throw new Error(data.message || 'Failed to apply suggestion');
      }
    } catch (err) {
      console.error('Error approving suggestion:', err);
      setError(err.message);
    } finally {
      setProcessing(false);
    }
  };

  const handleReject = async () => {
    setProcessing(true);
    setError(null);

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/agent/suggestions/${suggestion.id}/reject`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to reject suggestion');
      }

      onReject?.(suggestion.id);
      onUpdate?.();
    } catch (err) {
      console.error('Error rejecting suggestion:', err);
      setError(err.message);
    } finally {
      setProcessing(false);
    }
  };

  const formatCost = (cost) => {
    const value = parseFloat(cost);
    return value >= 0 ? `+$${value.toFixed(2)}` : `-$${Math.abs(value).toFixed(2)}`;
  };

  const actionData = suggestion.action_data;

  return (
    <div className="bg-white border rounded-lg shadow-sm hover:shadow-md transition-shadow">
      {/* Header */}
      <div className="px-4 py-3 border-b flex items-center justify-between bg-gray-50">
        <div className="flex items-center space-x-3">
          <div className={`p-2 rounded-lg ${
            suggestion.status === 'pending' ? 'bg-blue-100 text-blue-600' :
            suggestion.status === 'applied' ? 'bg-green-100 text-green-600' :
            'bg-gray-100 text-gray-600'
          }`}>
            {getTypeIcon(suggestion.suggestion_type)}
          </div>
          <div>
            <h3 className="font-semibold text-gray-800">{getTypeLabel(suggestion.suggestion_type)}</h3>
            {suggestion.order_number && (
              <p className="text-xs text-gray-500">Order: {suggestion.order_number}</p>
            )}
          </div>
        </div>
        {getStatusBadge(suggestion.status)}
      </div>

      {/* Content */}
      <div className="px-4 py-3 space-y-3">
        {/* Product Info */}
        {suggestion.product_name && (
          <div>
            <p className="text-sm font-medium text-gray-700">{suggestion.product_name}</p>
            {suggestion.sku && (
              <p className="text-xs text-gray-500">SKU: {suggestion.sku}</p>
            )}
          </div>
        )}

        {/* Action Details */}
        <div className="bg-blue-50 rounded-lg p-3 space-y-2">
          {suggestion.suggestion_type === 'adjust_quantity' && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600">Quantity:</span>
              <div className="flex items-center space-x-2">
                <span className="font-medium text-gray-800">{actionData.from}</span>
                <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
                <span className="font-bold text-blue-600">{actionData.to}</span>
              </div>
            </div>
          )}

          {suggestion.suggestion_type === 'add_product' && (
            <>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">Quantity:</span>
                <span className="font-bold text-blue-600">{actionData.quantity}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600">Unit Cost:</span>
                <span className="font-medium">${parseFloat(actionData.unit_cost).toFixed(2)}</span>
              </div>
              {actionData.ship_date && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-600">Ship Date:</span>
                  <span className="font-medium">{new Date(actionData.ship_date).toLocaleDateString()}</span>
                </div>
              )}
            </>
          )}

          {suggestion.suggestion_type === 'remove_product' && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600">Remove Quantity:</span>
              <span className="font-bold text-red-600">{actionData.current_quantity}</span>
            </div>
          )}

          {/* Cost Impact */}
          {actionData.cost_impact !== undefined && (
            <div className="flex items-center justify-between text-sm pt-2 border-t border-blue-200">
              <span className="text-gray-600">Cost Impact:</span>
              <span className={`font-bold ${actionData.cost_impact >= 0 ? 'text-blue-600' : 'text-green-600'}`}>
                {formatCost(actionData.cost_impact)}
              </span>
            </div>
          )}
        </div>

        {/* Reasoning */}
        {suggestion.reasoning && (
          <div className="text-sm">
            <p className="text-gray-600 font-medium mb-1">Reasoning:</p>
            <p className="text-gray-700 bg-gray-50 rounded p-2 leading-relaxed">
              {suggestion.reasoning}
            </p>
          </div>
        )}

        {/* Confidence Score */}
        {suggestion.confidence_score && (
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-500">Confidence:</span>
            <div className="flex items-center space-x-2">
              <div className="w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className={`h-full ${getConfidenceColor(suggestion.confidence_score)} bg-current`}
                  style={{ width: `${suggestion.confidence_score * 100}%` }}
                />
              </div>
              <span className={`font-medium ${getConfidenceColor(suggestion.confidence_score)}`}>
                {(suggestion.confidence_score * 100).toFixed(0)}%
              </span>
            </div>
          </div>
        )}

        {/* Error Display */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded p-2">
            <p className="text-red-700 text-xs">{error}</p>
          </div>
        )}
      </div>

      {/* Actions */}
      {suggestion.status === 'pending' && (
        <div className="px-4 py-3 border-t bg-gray-50 flex items-center justify-end space-x-3">
          <button
            onClick={handleReject}
            disabled={processing}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {processing ? 'Processing...' : 'Reject'}
          </button>
          <button
            onClick={handleApprove}
            disabled={processing}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center space-x-2"
          >
            {processing ? (
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
                <span>Approve & Apply</span>
              </>
            )}
          </button>
        </div>
      )}

      {/* Timestamp */}
      <div className="px-4 py-2 text-xs text-gray-400 border-t">
        Created {new Date(suggestion.created_at).toLocaleString()}
      </div>
    </div>
  );
};

SuggestionCard.propTypes = {
  suggestion: PropTypes.shape({
    id: PropTypes.number.isRequired,
    suggestion_type: PropTypes.string.isRequired,
    status: PropTypes.string.isRequired,
    action_data: PropTypes.object.isRequired,
    reasoning: PropTypes.string,
    confidence_score: PropTypes.number,
    order_number: PropTypes.string,
    product_name: PropTypes.string,
    sku: PropTypes.string,
    created_at: PropTypes.string.isRequired
  }).isRequired,
  onApprove: PropTypes.func,
  onReject: PropTypes.func,
  onUpdate: PropTypes.func
};

export default SuggestionCard;
