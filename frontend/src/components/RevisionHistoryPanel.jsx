import { useState, useEffect } from 'react';
import { revisionAPI } from '../services/api';

const RevisionHistoryPanel = ({ brandId, seasonId, brandName, onClose }) => {
  const [revisions, setRevisions] = useState([]);
  const [expandedRevision, setExpandedRevision] = useState(null);
  const [revisionDetails, setRevisionDetails] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchRevisions();
  }, [brandId, seasonId]);

  const fetchRevisions = async () => {
    try {
      setLoading(true);
      const res = await revisionAPI.compare({ brandId, seasonId });
      setRevisions(res.data.revisions || []);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load revision history');
    } finally {
      setLoading(false);
    }
  };

  const toggleExpand = async (revisionId) => {
    if (expandedRevision === revisionId) {
      setExpandedRevision(null);
      return;
    }

    setExpandedRevision(revisionId);

    if (!revisionDetails[revisionId]) {
      try {
        const res = await revisionAPI.getHistory({ revisionId, limit: 500 });
        setRevisionDetails(prev => ({ ...prev, [revisionId]: res.data.history || [] }));
      } catch (err) {
        console.error('Failed to load revision details:', err);
      }
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return 'N/A';
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  };

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg max-w-5xl w-full max-h-[85vh] flex flex-col mx-4">
        {/* Header */}
        <div className="px-6 py-4 border-b flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Revision History</h2>
            <p className="text-sm text-gray-500">{brandName || `Brand ${brandId}`}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-md p-3 mb-4">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          {loading && (
            <div className="flex justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
          )}

          {!loading && revisions.length === 0 && (
            <p className="text-center text-gray-500 py-12">No revisions found for this brand.</p>
          )}

          {!loading && revisions.length > 0 && (
            <div className="space-y-2">
              {revisions.map(r => (
                <div key={r.revision_id} className="border rounded-lg overflow-hidden">
                  {/* Revision Summary Row */}
                  <button
                    onClick={() => toggleExpand(r.revision_id)}
                    className="w-full text-left px-4 py-3 hover:bg-gray-50 flex items-center justify-between"
                  >
                    <div className="flex items-center gap-4">
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {formatDate(r.created_at)}
                        </p>
                        <p className="text-xs text-gray-500">{r.revision_type || 'revision'}</p>
                      </div>
                      <div className="flex gap-2">
                        <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full">
                          Ship: {r.ship_count}
                        </span>
                        <span className="px-2 py-0.5 bg-red-100 text-red-700 text-xs rounded-full">
                          Cancel: {r.cancel_count}
                        </span>
                        {r.keep_open_count > 0 && (
                          <span className="px-2 py-0.5 bg-yellow-100 text-yellow-700 text-xs rounded-full">
                            Keep Open: {r.keep_open_count}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <p className="text-sm font-medium text-gray-900">
                          {r.original_total_qty} → {r.adjusted_total_qty} units
                        </p>
                        <p className="text-xs text-gray-500">
                          {r.reduction_pct != null ? `${r.reduction_pct}% reduction` : ''}
                        </p>
                      </div>
                      <svg
                        className={`w-5 h-5 text-gray-400 transition-transform ${expandedRevision === r.revision_id ? 'rotate-180' : ''}`}
                        fill="none" stroke="currentColor" viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>
                  </button>

                  {/* Expanded Details */}
                  {expandedRevision === r.revision_id && (
                    <div className="border-t bg-gray-50">
                      {r.notes && (
                        <p className="px-4 py-2 text-sm text-gray-600 bg-blue-50 border-b">
                          Notes: {r.notes}
                        </p>
                      )}

                      {!revisionDetails[r.revision_id] ? (
                        <div className="flex justify-center py-6">
                          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                        </div>
                      ) : revisionDetails[r.revision_id].length === 0 ? (
                        <p className="px-4 py-4 text-sm text-gray-500">No detail records found.</p>
                      ) : (
                        <div className="max-h-80 overflow-y-auto">
                          <table className="w-full text-xs">
                            <thead className="bg-gray-100 sticky top-0">
                              <tr>
                                <th className="text-left px-3 py-2">Product</th>
                                <th className="text-left px-3 py-2">Size</th>
                                <th className="text-left px-3 py-2">Location</th>
                                <th className="text-center px-3 py-2">Orig</th>
                                <th className="text-center px-3 py-2">On Hand</th>
                                <th className="text-center px-3 py-2">Decision</th>
                                <th className="text-center px-3 py-2">Adj</th>
                                <th className="text-left px-3 py-2">Reason</th>
                              </tr>
                            </thead>
                            <tbody>
                              {revisionDetails[r.revision_id].map(d => (
                                <tr key={d.id} className={`border-t ${
                                  d.decision === 'ship' ? 'bg-green-50' :
                                  d.decision === 'cancel' ? 'bg-red-50' : ''
                                }`}>
                                  <td className="px-3 py-1.5 truncate max-w-[180px]">{d.product_name}</td>
                                  <td className="px-3 py-1.5">{d.size || '-'}</td>
                                  <td className="px-3 py-1.5">{d.location_name || '-'}</td>
                                  <td className="px-3 py-1.5 text-center">{d.original_quantity}</td>
                                  <td className="px-3 py-1.5 text-center">{d.on_hand_at_revision ?? '-'}</td>
                                  <td className="px-3 py-1.5 text-center">
                                    <span className={`px-1.5 py-0.5 rounded text-xs ${
                                      d.decision === 'ship' ? 'bg-green-100 text-green-700' :
                                      d.decision === 'cancel' ? 'bg-red-100 text-red-700' :
                                      'bg-yellow-100 text-yellow-700'
                                    }`}>
                                      {d.decision?.toUpperCase() || '-'}
                                    </span>
                                  </td>
                                  <td className="px-3 py-1.5 text-center">{d.new_quantity}</td>
                                  <td className="px-3 py-1.5 text-gray-500">
                                    {d.decision_reason}
                                    {d.was_flipped && <span className="text-amber-500 ml-1">(flipped)</span>}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t flex justify-end flex-shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default RevisionHistoryPanel;
