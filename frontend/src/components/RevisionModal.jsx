import { useState, useMemo } from 'react';
import { revisionAPI } from '../services/api';

const DECISION_COLORS = {
  ship: 'bg-green-50 text-green-800',
  cancel: 'bg-red-50 text-red-800',
  keep_open_bo: 'bg-yellow-50 text-yellow-800',
};

const DECISION_BADGES = {
  ship: 'bg-green-100 text-green-700',
  cancel: 'bg-red-100 text-red-700',
  keep_open_bo: 'bg-yellow-100 text-yellow-700',
};

const REASON_LABELS = {
  zero_stock: 'Zero stock',
  positive_stock_cancel: 'In stock',
  discontinued_product: 'Discontinued',
  flipped_back_cap: 'Flipped (cap)',
  user_override: 'Manual override',
};

const RevisionModal = ({ selectedOrders, brandId, brandName, seasonId, onClose, onComplete }) => {
  const [step, setStep] = useState('configure'); // configure | preview | applying | done
  const [maxReductionPct, setMaxReductionPct] = useState(20);
  const [revisionNotes, setRevisionNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [decisions, setDecisions] = useState([]);
  const [summary, setSummary] = useState(null);
  const [revisionId, setRevisionId] = useState(null);
  const [searchFilter, setSearchFilter] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [decisionFilter, setDecisionFilter] = useState('');

  const orderIds = selectedOrders.map(o => o.id);

  const handleRunPreview = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await revisionAPI.run({
        brandId,
        orderIds,
        maxReductionPct: maxReductionPct / 100,
        dryRun: true,
        includeAdditions: true,
        brandName,
        revisionNotes,
      });
      setDecisions(res.data.decisions);
      setSummary(res.data.summary);
      setStep('preview');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to run revision preview');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleDecision = (index) => {
    setDecisions(prev => {
      const updated = [...prev];
      const d = { ...updated[index] };
      if (d.isDiscontinued) return prev; // Can't override discontinued

      if (d.decision === 'ship') {
        d.decision = 'cancel';
        d.adjustedQty = 0;
        d.reason = 'user_override';
      } else {
        d.decision = 'ship';
        d.adjustedQty = d.originalQty;
        d.reason = 'user_override';
      }
      d.userOverride = true;
      updated[index] = d;
      return updated;
    });
  };

  // Recompute summary from current decisions
  const liveSummary = useMemo(() => {
    if (!decisions.length) return summary;
    const ship = decisions.filter(d => d.decision === 'ship').length;
    const cancel = decisions.filter(d => d.decision === 'cancel').length;
    const keepOpen = decisions.filter(d => d.decision === 'keep_open_bo').length;
    const totalOriginalQty = decisions.reduce((s, d) => s + d.originalQty, 0);
    const totalAdjustedQty = decisions.reduce((s, d) => s + d.adjustedQty, 0);
    const reductionPct = totalOriginalQty > 0
      ? parseFloat((((totalOriginalQty - totalAdjustedQty) / totalOriginalQty) * 100).toFixed(1))
      : 0;
    const flippedBack = decisions.filter(d => d.wasFlipped).length;
    return { totalItems: decisions.length, ship, cancel, keepOpen, totalOriginalQty, totalAdjustedQty, reductionPct, flippedBack };
  }, [decisions, summary]);

  const handleApply = async () => {
    setStep('applying');
    setError('');
    try {
      const hasOverrides = decisions.some(d => d.userOverride);

      let res;
      if (hasOverrides) {
        // User modified decisions — send the exact decision set
        res = await revisionAPI.apply({
          brandId,
          orderIds,
          decisions,
          revisionNotes,
          maxReductionPct: maxReductionPct / 100,
        });
      } else {
        // No overrides — run again with dryRun=false
        res = await revisionAPI.run({
          brandId,
          orderIds,
          maxReductionPct: maxReductionPct / 100,
          dryRun: false,
          includeAdditions: false,
          brandName,
          revisionNotes,
        });
      }

      setRevisionId(res.data.revisionId);
      setSummary(res.data.summary);
      setStep('done');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to apply revision');
      setStep('preview');
    }
  };

  // Filtered decisions for display
  const filteredDecisions = useMemo(() => {
    return decisions.filter(d => {
      if (searchFilter) {
        const search = searchFilter.toLowerCase();
        const matchName = (d.productName || '').toLowerCase().includes(search);
        const matchUpc = (d.upc || '').includes(search);
        const matchSize = (d.size || '').toLowerCase().includes(search);
        if (!matchName && !matchUpc && !matchSize) return false;
      }
      if (locationFilter && d.location !== locationFilter) return false;
      if (decisionFilter && d.decision !== decisionFilter) return false;
      return true;
    });
  }, [decisions, searchFilter, locationFilter, decisionFilter]);

  const locations = useMemo(() => {
    return [...new Set(decisions.map(d => d.location))].sort();
  }, [decisions]);

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg max-w-6xl w-full max-h-[92vh] flex flex-col mx-4">
        {/* Header */}
        <div className="px-6 py-4 border-b flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-lg font-bold text-gray-900">
              {step === 'done' ? 'Revision Complete' : 'Order Revision'}
            </h2>
            <p className="text-sm text-gray-500">
              {brandName} — {selectedOrders.length} order{selectedOrders.length !== 1 ? 's' : ''}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {error && (
          <div className="mx-6 mt-4 bg-red-50 border border-red-200 rounded-md p-3">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {/* STEP: Configure */}
          {step === 'configure' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-3">Selected Orders</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                  {selectedOrders.map(o => (
                    <div key={o.id} className="bg-gray-50 rounded-lg px-3 py-2 text-sm">
                      <span className="font-medium">{o.order_number || `#${o.id}`}</span>
                      <span className="text-gray-500 ml-2">{o.location_name}</span>
                      <span className="text-gray-400 ml-2">{o.item_count || '?'} items</span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Max Reduction: {maxReductionPct}%
                </label>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={maxReductionPct}
                  onChange={e => setMaxReductionPct(parseInt(e.target.value))}
                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                />
                <div className="flex justify-between text-xs text-gray-400 mt-1">
                  <span>0%</span>
                  <span>50%</span>
                  <span>100%</span>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  If cancellations exceed this %, items will be flipped back to ship (lowest stock first).
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Revision Notes (optional)</label>
                <textarea
                  value={revisionNotes}
                  onChange={e => setRevisionNotes(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  rows={2}
                  placeholder="e.g., Monthly revision for April 2026"
                />
              </div>
            </div>
          )}

          {/* STEP: Preview */}
          {step === 'preview' && liveSummary && (
            <div className="space-y-4">
              {/* Summary Stats */}
              <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <p className="text-xs text-gray-500">Total Items</p>
                  <p className="text-xl font-semibold">{liveSummary.totalItems}</p>
                </div>
                <div className="bg-green-50 rounded-lg p-3 text-center">
                  <p className="text-xs text-green-600">Ship</p>
                  <p className="text-xl font-semibold text-green-700">{liveSummary.ship}</p>
                </div>
                <div className="bg-red-50 rounded-lg p-3 text-center">
                  <p className="text-xs text-red-600">Cancel</p>
                  <p className="text-xl font-semibold text-red-700">{liveSummary.cancel}</p>
                </div>
                <div className="bg-yellow-50 rounded-lg p-3 text-center">
                  <p className="text-xs text-yellow-600">Keep Open</p>
                  <p className="text-xl font-semibold text-yellow-700">{liveSummary.keepOpen}</p>
                </div>
                <div className="bg-blue-50 rounded-lg p-3 text-center">
                  <p className="text-xs text-blue-600">Reduction</p>
                  <p className="text-xl font-semibold text-blue-700">{liveSummary.reductionPct}%</p>
                </div>
                <div className="bg-purple-50 rounded-lg p-3 text-center">
                  <p className="text-xs text-purple-600">Qty</p>
                  <p className="text-lg font-semibold text-purple-700">
                    {liveSummary.originalTotalQty} → {liveSummary.adjustedTotalQty}
                  </p>
                </div>
              </div>

              {liveSummary.flippedBack > 0 && (
                <p className="text-sm text-amber-600 bg-amber-50 rounded px-3 py-2">
                  {liveSummary.flippedBack} item{liveSummary.flippedBack !== 1 ? 's' : ''} flipped back to ship to stay within {maxReductionPct}% cap.
                </p>
              )}

              {/* Filters */}
              <div className="flex flex-wrap gap-2">
                <input
                  type="text"
                  placeholder="Search product, UPC, size..."
                  value={searchFilter}
                  onChange={e => setSearchFilter(e.target.value)}
                  className="px-3 py-1.5 border border-gray-300 rounded-md text-sm flex-1 min-w-[200px]"
                />
                <select
                  value={locationFilter}
                  onChange={e => setLocationFilter(e.target.value)}
                  className="px-3 py-1.5 border border-gray-300 rounded-md text-sm"
                >
                  <option value="">All Locations</option>
                  {locations.map(loc => (
                    <option key={loc} value={loc}>{loc}</option>
                  ))}
                </select>
                <select
                  value={decisionFilter}
                  onChange={e => setDecisionFilter(e.target.value)}
                  className="px-3 py-1.5 border border-gray-300 rounded-md text-sm"
                >
                  <option value="">All Decisions</option>
                  <option value="ship">Ship</option>
                  <option value="cancel">Cancel</option>
                  <option value="keep_open_bo">Keep Open</option>
                </select>
              </div>

              {/* Decision Table */}
              <div className="border rounded-lg overflow-hidden">
                <div className="max-h-[45vh] overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Product</th>
                        <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Size</th>
                        <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Location</th>
                        <th className="text-center px-3 py-2 text-xs font-medium text-gray-500">Orig Qty</th>
                        <th className="text-center px-3 py-2 text-xs font-medium text-gray-500">On Hand</th>
                        <th className="text-center px-3 py-2 text-xs font-medium text-gray-500">Decision</th>
                        <th className="text-center px-3 py-2 text-xs font-medium text-gray-500">Adj Qty</th>
                        <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredDecisions.map((d, idx) => {
                        const realIdx = decisions.indexOf(d);
                        return (
                          <tr key={d.orderItemId} className={`border-t ${DECISION_COLORS[d.decision] || ''}`}>
                            <td className="px-3 py-2">
                              <div className="font-medium truncate max-w-[200px]">{d.productName}</div>
                              <div className="text-xs text-gray-400">{d.upc}</div>
                            </td>
                            <td className="px-3 py-2">{d.size || '-'}</td>
                            <td className="px-3 py-2 text-xs">{d.location}</td>
                            <td className="px-3 py-2 text-center">{d.originalQty}</td>
                            <td className="px-3 py-2 text-center font-medium">
                              <span className={d.onHand > 0 ? 'text-green-600' : d.onHand < 0 ? 'text-red-600' : 'text-gray-500'}>
                                {d.onHand}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-center">
                              <button
                                onClick={() => handleToggleDecision(realIdx)}
                                disabled={d.isDiscontinued}
                                className={`px-2 py-0.5 rounded text-xs font-medium ${DECISION_BADGES[d.decision]} ${d.isDiscontinued ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:opacity-80'}`}
                                title={d.isDiscontinued ? 'Discontinued — cannot override' : 'Click to toggle ship/cancel'}
                              >
                                {d.decision === 'keep_open_bo' ? 'KEEP OPEN' : d.decision.toUpperCase()}
                              </button>
                            </td>
                            <td className="px-3 py-2 text-center">{d.adjustedQty}</td>
                            <td className="px-3 py-2 text-xs text-gray-500">
                              {REASON_LABELS[d.reason] || d.reason}
                              {d.wasFlipped && !d.userOverride && <span className="ml-1 text-amber-500">(flipped)</span>}
                              {d.userOverride && <span className="ml-1 text-blue-500">(modified)</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="bg-gray-50 px-3 py-2 text-xs text-gray-500 border-t">
                  Showing {filteredDecisions.length} of {decisions.length} items.
                  Click a decision badge to toggle between ship and cancel.
                </div>
              </div>
            </div>
          )}

          {/* STEP: Applying */}
          {step === 'applying' && (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
              <p className="text-gray-600">Applying revision decisions...</p>
            </div>
          )}

          {/* STEP: Done */}
          {step === 'done' && summary && (
            <div className="space-y-6 py-8">
              <div className="text-center">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100 mb-4">
                  <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-1">Revision Applied</h3>
                <p className="text-sm text-gray-500">Revision ID: {revisionId}</p>
              </div>

              <div className="grid grid-cols-3 gap-4 max-w-md mx-auto">
                <div className="bg-green-50 rounded-lg p-3 text-center">
                  <p className="text-xs text-green-600">Ship</p>
                  <p className="text-2xl font-bold text-green-700">{summary.ship}</p>
                </div>
                <div className="bg-red-50 rounded-lg p-3 text-center">
                  <p className="text-xs text-red-600">Cancel</p>
                  <p className="text-2xl font-bold text-red-700">{summary.cancel}</p>
                </div>
                <div className="bg-blue-50 rounded-lg p-3 text-center">
                  <p className="text-xs text-blue-600">Reduction</p>
                  <p className="text-2xl font-bold text-blue-700">{summary.reductionPct}%</p>
                </div>
              </div>

              <p className="text-center text-sm text-gray-500">
                {summary.originalTotalQty} units → {summary.adjustedTotalQty} units
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t flex justify-between items-center flex-shrink-0">
          <div>
            {step === 'preview' && (
              <button
                onClick={() => { setStep('configure'); setDecisions([]); setSummary(null); }}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                Back to Configure
              </button>
            )}
          </div>
          <div className="flex gap-2">
            {step !== 'done' && (
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
            )}

            {step === 'configure' && (
              <button
                onClick={handleRunPreview}
                disabled={loading}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400"
              >
                {loading ? 'Running...' : 'Run Preview'}
              </button>
            )}

            {step === 'preview' && (
              <button
                onClick={handleApply}
                className="px-4 py-2 text-sm bg-amber-600 text-white rounded-md hover:bg-amber-700"
              >
                Apply Revision
              </button>
            )}

            {step === 'done' && (
              <button
                onClick={onComplete}
                className="px-4 py-2 text-sm bg-green-600 text-white rounded-md hover:bg-green-700"
              >
                Done
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default RevisionModal;
