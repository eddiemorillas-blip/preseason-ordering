import { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import api, { revisionAPI } from '../services/api';
import Layout from '../components/Layout';
import VendorTemplateEditor from '../components/VendorTemplateEditor';
import RevisionChat from '../components/RevisionChat';
import { useAuth } from '../context/AuthContext';

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
  received_not_inventoried: 'Sold (not in inv)',
  user_override: 'Manual override',
};

const Revisions = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { isAdmin, isBuyer } = useAuth();

  // Selectors
  const [seasons, setSeasons] = useState([]);
  const [brands, setBrands] = useState([]);
  const [orders, setOrders] = useState([]);
  const [shipDates, setShipDates] = useState([]);
  const [hasTemplate, setHasTemplate] = useState(false);

  // Filters
  const selectedSeasonId = searchParams.get('season') || '';
  const selectedBrandId = searchParams.get('brand') || '';
  const selectedShipDate = searchParams.get('shipDate') || '';

  // Order selection
  const [selectedOrders, setSelectedOrders] = useState(new Set());

  // Workflow state
  const [mode, setMode] = useState('orders'); // orders | spreadsheet | compare
  const [step, setStep] = useState('idle'); // idle | configure | preview | applying | done
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

  // Spreadsheet state
  const [spreadsheetFile, setSpreadsheetFile] = useState(null);
  const [spreadsheetSummary, setSpreadsheetSummary] = useState(null);
  const [spreadsheetDecisions, setSpreadsheetDecisions] = useState([]);
  const [downloading, setDownloading] = useState(false);
  const [showTemplateEditor, setShowTemplateEditor] = useState(false);

  // Compare state
  const [compareFile, setCompareFile] = useState(null);
  const [compareResults, setCompareResults] = useState(null);
  const [compareLoading, setCompareLoading] = useState(false);

  // History state
  const [showHistory, setShowHistory] = useState(false);
  const [revisions, setRevisions] = useState([]);
  const [expandedRevision, setExpandedRevision] = useState(null);
  const [revisionDetails, setRevisionDetails] = useState({});
  const [historyLoading, setHistoryLoading] = useState(false);

  // Data loading state
  const [dataLoading, setDataLoading] = useState(true);

  // Fetch seasons + brands on mount
  useEffect(() => {
    fetchInitialData();
  }, []);

  // Fetch orders when filters change
  useEffect(() => {
    if (selectedSeasonId && selectedBrandId) {
      fetchOrders();
      checkTemplate();
    } else {
      setOrders([]);
      setShipDates([]);
      setSelectedOrders(new Set());
    }
  }, [selectedSeasonId, selectedBrandId]);

  const fetchInitialData = async () => {
    try {
      setDataLoading(true);
      const [seasonsRes, brandsRes] = await Promise.all([
        api.get('/seasons'),
        api.get('/brands')
      ]);
      const sortedSeasons = (seasonsRes.data.seasons || []).sort((a, b) => {
        const dateA = a.start_date ? new Date(a.start_date) : new Date(0);
        const dateB = b.start_date ? new Date(b.start_date) : new Date(0);
        return dateB - dateA;
      });
      setSeasons(sortedSeasons);
      setBrands(brandsRes.data.brands || []);

      // Auto-select first season if none selected
      if (!selectedSeasonId && sortedSeasons.length > 0) {
        setSearchParams(prev => {
          const params = new URLSearchParams(prev);
          params.set('season', sortedSeasons[0].id.toString());
          return params;
        });
      }
    } catch (err) {
      console.error('Error fetching data:', err);
    } finally {
      setDataLoading(false);
    }
  };

  const fetchOrders = async () => {
    try {
      const res = await api.get(`/orders?seasonId=${selectedSeasonId}&brandId=${selectedBrandId}`);
      const allOrders = res.data.orders || [];
      setOrders(allOrders);
      // Extract unique ship dates
      const dates = [...new Set(allOrders.map(o => o.ship_date).filter(Boolean))].sort();
      setShipDates(dates);
      setSelectedOrders(new Set());
    } catch (err) {
      console.error('Error fetching orders:', err);
    }
  };

  const checkTemplate = async () => {
    try {
      const res = await api.get('/revisions/templates', { params: { brandId: selectedBrandId } });
      setHasTemplate((res.data.templates || []).length > 0);
    } catch { setHasTemplate(false); }
  };

  // Filter orders by ship date
  const filteredOrders = useMemo(() => {
    if (!selectedShipDate) return orders;
    return orders.filter(o => o.ship_date === selectedShipDate);
  }, [orders, selectedShipDate]);

  const updateFilter = (key, value) => {
    const params = new URLSearchParams(searchParams);
    if (value) { params.set(key, value); } else { params.delete(key); }
    setSelectedOrders(new Set());
    setStep('idle');
    setSearchParams(params);
  };

  const toggleOrder = (id) => {
    setSelectedOrders(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAllOrders = () => {
    if (selectedOrders.size === filteredOrders.length) {
      setSelectedOrders(new Set());
    } else {
      setSelectedOrders(new Set(filteredOrders.map(o => o.id)));
    }
  };

  const selectedBrand = brands.find(b => b.id === parseInt(selectedBrandId));
  const selectedOrdersList = filteredOrders.filter(o => selectedOrders.has(o.id));
  const orderIds = selectedOrdersList.map(o => o.id);

  // ---- Revision handlers (extracted from RevisionModal) ----

  const handleRunPreview = async () => {
    if (orderIds.length === 0) { setError('Select at least one order'); return; }
    setLoading(true);
    setError('');
    try {
      const res = await revisionAPI.run({
        brandId: parseInt(selectedBrandId),
        orderIds,
        maxReductionPct: maxReductionPct / 100,
        dryRun: true,
        includeAdditions: true,
        brandName: selectedBrand?.name,
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
      if (d.isDiscontinued || d.receivedNotInventoried) return prev;
      if (d.decision === 'ship') {
        d.decision = 'cancel'; d.adjustedQty = 0; d.reason = 'user_override';
      } else {
        d.decision = 'ship'; d.adjustedQty = d.originalQty; d.reason = 'user_override';
      }
      d.userOverride = true;
      updated[index] = d;
      return updated;
    });
  };

  const liveSummary = useMemo(() => {
    if (!decisions.length) return summary;
    const ship = decisions.filter(d => d.decision === 'ship').length;
    const cancel = decisions.filter(d => d.decision === 'cancel').length;
    const keepOpen = decisions.filter(d => d.decision === 'keep_open_bo').length;
    const totalOriginalQty = decisions.reduce((s, d) => s + d.originalQty, 0);
    const totalAdjustedQty = decisions.reduce((s, d) => s + d.adjustedQty, 0);
    const reductionPct = totalOriginalQty > 0
      ? parseFloat((((totalOriginalQty - totalAdjustedQty) / totalOriginalQty) * 100).toFixed(1)) : 0;
    return { totalItems: decisions.length, ship, cancel, keepOpen, totalOriginalQty, totalAdjustedQty, reductionPct };
  }, [decisions, summary]);

  const handleApply = async () => {
    setStep('applying');
    setError('');
    try {
      const hasOverrides = decisions.some(d => d.userOverride);
      let res;
      if (hasOverrides) {
        res = await revisionAPI.apply({
          brandId: parseInt(selectedBrandId), orderIds, decisions, revisionNotes,
          maxReductionPct: maxReductionPct / 100,
        });
      } else {
        res = await revisionAPI.run({
          brandId: parseInt(selectedBrandId), orderIds,
          maxReductionPct: maxReductionPct / 100, dryRun: false,
          includeAdditions: false, brandName: selectedBrand?.name, revisionNotes,
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

  // Spreadsheet handlers
  const handleSpreadsheetPreview = async () => {
    if (!spreadsheetFile) return;
    setLoading(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('file', spreadsheetFile);
      formData.append('brandId', selectedBrandId);
      formData.append('dryRun', 'true');
      const res = await revisionAPI.spreadsheetPreview(formData);
      setSpreadsheetDecisions(res.data.decisions || []);
      setSpreadsheetSummary(res.data.summary);
      setStep('preview');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to process spreadsheet');
    } finally {
      setLoading(false);
    }
  };

  const handleSpreadsheetDownload = async () => {
    if (!spreadsheetFile) return;
    setDownloading(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('file', spreadsheetFile);
      formData.append('brandId', selectedBrandId);
      formData.append('dryRun', 'false');
      const res = await revisionAPI.spreadsheetDownload(formData);
      const blob = new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const date = new Date().toISOString().split('T')[0];
      a.download = `${(selectedBrand?.name || 'brand').replace(/[^a-zA-Z0-9]/g, '_')}_revised_${date}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setStep('done');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to download revised spreadsheet');
    } finally {
      setDownloading(false);
    }
  };

  // Compare handler
  const handleCompare = async () => {
    if (!compareFile) return;
    setCompareLoading(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('file', compareFile);
      formData.append('brandId', selectedBrandId);
      formData.append('seasonId', selectedSeasonId);
      const res = await api.post('/revisions/compare-spreadsheet', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setCompareResults(res.data);
      setStep('preview');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to compare spreadsheet');
    } finally {
      setCompareLoading(false);
    }
  };

  // Filtered decisions
  const filteredDecisions = useMemo(() => {
    return decisions.filter(d => {
      if (searchFilter) {
        const search = searchFilter.toLowerCase();
        if (!(d.productName || '').toLowerCase().includes(search) &&
            !(d.upc || '').includes(search) &&
            !(d.size || '').toLowerCase().includes(search)) return false;
      }
      if (locationFilter && d.location !== locationFilter) return false;
      if (decisionFilter && d.decision !== decisionFilter) return false;
      return true;
    });
  }, [decisions, searchFilter, locationFilter, decisionFilter]);

  const decisionLocations = useMemo(() => [...new Set(decisions.map(d => d.location))].sort(), [decisions]);

  // History handlers
  const fetchHistory = async () => {
    setHistoryLoading(true);
    try {
      const res = await revisionAPI.compare({ brandId: selectedBrandId, seasonId: selectedSeasonId });
      setRevisions(res.data.revisions || []);
    } catch (err) {
      console.error('Failed to load history:', err);
    } finally {
      setHistoryLoading(false);
    }
  };

  const toggleRevisionExpand = async (rid) => {
    if (expandedRevision === rid) { setExpandedRevision(null); return; }
    setExpandedRevision(rid);
    if (!revisionDetails[rid]) {
      try {
        const res = await revisionAPI.getHistory({ revisionId: rid, limit: 500 });
        setRevisionDetails(prev => ({ ...prev, [rid]: res.data.history || [] }));
      } catch (err) { console.error('Failed to load detail:', err); }
    }
  };

  const resetWorkflow = () => {
    setStep('idle');
    setDecisions([]);
    setSummary(null);
    setRevisionId(null);
    setSpreadsheetFile(null);
    setSpreadsheetDecisions([]);
    setSpreadsheetSummary(null);
    setError('');
    setSearchFilter('');
    setLocationFilter('');
    setDecisionFilter('');
    setCompareFile(null);
    setCompareResults(null);
  };

  const formatDate = (d) => d ? new Date(d).toLocaleDateString() : '-';

  return (
    <Layout fullWidth>
      <div className="flex flex-col h-[calc(100vh-64px)]">
        {/* Top Bar: Season + Brand */}
        <div className="bg-white border-b px-4 py-3 flex items-center gap-4 flex-shrink-0">
          <select
            value={selectedSeasonId}
            onChange={e => updateFilter('season', e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm"
          >
            <option value="">Select Season</option>
            {seasons.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <select
            value={selectedBrandId}
            onChange={e => updateFilter('brand', e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-md text-sm"
          >
            <option value="">Select Brand</option>
            {brands.filter(b => b.active !== false).map(b => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>

          {selectedBrandId && (
            <div className="flex items-center gap-2 ml-auto">
              {hasTemplate && (
                <span className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded-full">Template saved</span>
              )}
              <button
                onClick={() => { setShowHistory(!showHistory); if (!showHistory) fetchHistory(); }}
                className={`px-3 py-1.5 text-sm rounded-md ${showHistory ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
              >
                History
              </button>
            </div>
          )}
        </div>

        {!selectedSeasonId || !selectedBrandId ? (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            Select a season and brand to start
          </div>
        ) : (
          <div className="flex flex-1 overflow-hidden">
            {/* LEFT SIDEBAR */}
            <div className="w-72 border-r bg-gray-50 flex flex-col flex-shrink-0 overflow-hidden">
              {/* Ship Date Filter */}
              <div className="p-3 border-b">
                <select
                  value={selectedShipDate}
                  onChange={e => updateFilter('shipDate', e.target.value)}
                  className="w-full px-2 py-1.5 border border-gray-300 rounded-md text-sm"
                >
                  <option value="">All Ship Dates</option>
                  {shipDates.map(d => (
                    <option key={d} value={d}>{formatDate(d)}</option>
                  ))}
                </select>
              </div>

              {/* Order List */}
              <div className="p-3 border-b flex items-center justify-between">
                <span className="text-xs font-medium text-gray-500">
                  {filteredOrders.length} order{filteredOrders.length !== 1 ? 's' : ''}
                </span>
                <button onClick={selectAllOrders} className="text-xs text-blue-600 hover:text-blue-800">
                  {selectedOrders.size === filteredOrders.length && filteredOrders.length > 0 ? 'Deselect All' : 'Select All'}
                </button>
              </div>

              <div className="flex-1 overflow-y-auto">
                {filteredOrders.map(o => (
                  <label
                    key={o.id}
                    className={`flex items-start gap-2 px-3 py-2 border-b border-gray-100 cursor-pointer hover:bg-white ${selectedOrders.has(o.id) ? 'bg-blue-50' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedOrders.has(o.id)}
                      onChange={() => toggleOrder(o.id)}
                      className="mt-1"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900 truncate">{o.order_number || `#${o.id}`}</div>
                      <div className="text-xs text-gray-500">{o.location_name}</div>
                      <div className="text-xs text-gray-400">
                        {o.ship_date ? formatDate(o.ship_date) : 'No date'} · {o.item_count || 0} items
                      </div>
                    </div>
                  </label>
                ))}
                {filteredOrders.length === 0 && (
                  <p className="px-3 py-8 text-center text-sm text-gray-400">No orders found</p>
                )}
              </div>

              {/* Sidebar Footer */}
              <div className="p-3 border-t bg-white">
                {selectedOrders.size > 0 && step === 'idle' && (
                  <button
                    onClick={() => { setMode('orders'); setStep('configure'); }}
                    className="w-full px-3 py-2 text-sm bg-amber-600 text-white rounded-md hover:bg-amber-700"
                  >
                    Revise {selectedOrders.size} Order{selectedOrders.size !== 1 ? 's' : ''}
                  </button>
                )}
                {step === 'idle' && (
                  <div className={`space-y-2 ${selectedOrders.size > 0 ? 'mt-2' : ''}`}>
                    <button
                      onClick={() => { setMode('spreadsheet'); setStep('configure'); }}
                      className="w-full px-3 py-2 text-sm border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
                    >
                      Upload Spreadsheet
                    </button>
                    <button
                      onClick={() => { setMode('compare'); setStep('configure'); }}
                      className="w-full px-3 py-2 text-sm border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
                    >
                      Compare to Vendor
                    </button>
                  </div>
                )}
                {step !== 'idle' && (
                  <button
                    onClick={resetWorkflow}
                    className="w-full px-3 py-2 text-sm border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
                  >
                    Start Over
                  </button>
                )}
              </div>
            </div>

            {/* MAIN CONTENT */}
            <div className="flex-1 flex flex-col overflow-hidden">
              <div className="flex-1 overflow-y-auto p-6">
                {error && (
                  <div className="mb-4 bg-red-50 border border-red-200 rounded-md p-3">
                    <p className="text-sm text-red-800">{error}</p>
                  </div>
                )}

                {/* IDLE STATE */}
                {step === 'idle' && !showHistory && (
                  <div className="flex flex-col items-center justify-center h-full text-gray-400">
                    <svg className="w-16 h-16 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                    <p className="text-lg mb-1">Select orders to revise</p>
                    <p className="text-sm">or upload a vendor spreadsheet</p>
                  </div>
                )}

                {/* HISTORY VIEW */}
                {showHistory && step === 'idle' && (
                  <div className="space-y-3">
                    <h3 className="text-lg font-bold text-gray-900">Revision History — {selectedBrand?.name}</h3>
                    {historyLoading && <p className="text-center text-gray-500 py-8">Loading...</p>}
                    {!historyLoading && revisions.length === 0 && <p className="text-center text-gray-400 py-8">No revisions yet</p>}
                    {revisions.map(r => (
                      <div key={r.revision_id} className="border rounded-lg overflow-hidden">
                        <button
                          onClick={() => toggleRevisionExpand(r.revision_id)}
                          className="w-full text-left px-4 py-3 hover:bg-gray-50 flex items-center justify-between"
                        >
                          <div className="flex items-center gap-4">
                            <div>
                              <p className="text-sm font-medium">{formatDate(r.created_at)}</p>
                              <p className="text-xs text-gray-500">{r.revision_type}</p>
                            </div>
                            <div className="flex gap-2">
                              <span className="px-2 py-0.5 bg-green-100 text-green-700 text-xs rounded-full">Ship: {r.ship_count}</span>
                              <span className="px-2 py-0.5 bg-red-100 text-red-700 text-xs rounded-full">Cancel: {r.cancel_count}</span>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-medium">{r.original_total_qty} → {r.adjusted_total_qty}</p>
                            <p className="text-xs text-gray-500">{r.reduction_pct != null ? `${r.reduction_pct}%` : ''}</p>
                          </div>
                        </button>
                        {expandedRevision === r.revision_id && (
                          <div className="border-t bg-gray-50">
                            {!revisionDetails[r.revision_id] ? (
                              <div className="flex justify-center py-6">
                                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
                              </div>
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
                                      <tr key={d.id} className={`border-t ${d.decision === 'ship' ? 'bg-green-50' : d.decision === 'cancel' ? 'bg-red-50' : ''}`}>
                                        <td className="px-3 py-1.5 truncate max-w-[180px]">{d.product_name}</td>
                                        <td className="px-3 py-1.5">{d.size || '-'}</td>
                                        <td className="px-3 py-1.5">{d.location_name || '-'}</td>
                                        <td className="px-3 py-1.5 text-center">{d.original_quantity}</td>
                                        <td className="px-3 py-1.5 text-center">{d.on_hand_at_revision ?? '-'}</td>
                                        <td className="px-3 py-1.5 text-center">
                                          <span className={`px-1.5 py-0.5 rounded ${d.decision === 'ship' ? 'bg-green-100 text-green-700' : d.decision === 'cancel' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}`}>
                                            {d.decision?.toUpperCase()}
                                          </span>
                                        </td>
                                        <td className="px-3 py-1.5 text-center">{d.new_quantity}</td>
                                        <td className="px-3 py-1.5 text-gray-500">{d.decision_reason}</td>
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

                {/* CONFIGURE STEP */}
                {step === 'configure' && (
                  <div className="max-w-2xl space-y-6">
                    <h3 className="text-lg font-bold text-gray-900">
                      {mode === 'spreadsheet' ? 'Upload Vendor Spreadsheet' : 'Configure Revision'}
                    </h3>

                    {mode === 'spreadsheet' && (
                      <div className="space-y-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Vendor Spreadsheet</label>
                          <input
                            type="file"
                            accept=".xlsx,.xls,.csv"
                            onChange={e => setSpreadsheetFile(e.target.files[0])}
                            className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                          />
                          <p className="text-xs text-gray-400 mt-1">
                            Uses saved column template for {selectedBrand?.name || 'this brand'}.
                          </p>
                        </div>
                        <button onClick={() => setShowTemplateEditor(true)} className="text-sm text-blue-600 hover:text-blue-800">
                          Configure column mapping
                        </button>
                        <div className="flex gap-2 pt-4">
                          <button onClick={resetWorkflow} className="px-4 py-2 text-sm border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50">Cancel</button>
                          <button onClick={handleSpreadsheetPreview} disabled={loading || !spreadsheetFile}
                            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400">
                            {loading ? 'Processing...' : 'Preview Revisions'}
                          </button>
                        </div>
                      </div>
                    )}

                    {mode === 'orders' && (
                      <div className="space-y-4">
                        <div className="bg-gray-50 rounded-lg p-3">
                          <p className="text-sm text-gray-600">{selectedOrders.size} orders selected from {selectedBrand?.name}</p>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Max Reduction: {maxReductionPct}%</label>
                          <input type="range" min="0" max="100" value={maxReductionPct}
                            onChange={e => setMaxReductionPct(parseInt(e.target.value))}
                            className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer" />
                          <div className="flex justify-between text-xs text-gray-400 mt-1">
                            <span>0%</span><span>50%</span><span>100%</span>
                          </div>
                          <p className="text-xs text-gray-500 mt-1">If cancellations exceed this %, items will be flipped back to ship.</p>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
                          <textarea value={revisionNotes} onChange={e => setRevisionNotes(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm" rows={2}
                            placeholder="e.g., Monthly revision for April 2026" />
                        </div>
                        <div className="flex gap-2 pt-4">
                          <button onClick={resetWorkflow} className="px-4 py-2 text-sm border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50">Cancel</button>
                          <button onClick={handleRunPreview} disabled={loading}
                            className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400">
                            {loading ? 'Running...' : 'Run Preview'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* CONFIGURE — COMPARE MODE */}
                {step === 'configure' && mode === 'compare' && (
                  <div className="max-w-2xl space-y-6">
                    <h3 className="text-lg font-bold text-gray-900">Compare Vendor Form to System</h3>
                    <p className="text-sm text-gray-500">
                      Upload the vendor's spreadsheet to compare their line items against what's in your orders.
                      Shows mismatches in quantities, items they have that you don't, and items you have that they dropped.
                    </p>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Vendor Spreadsheet</label>
                      <input
                        type="file"
                        accept=".xlsx,.xls,.csv"
                        onChange={e => setCompareFile(e.target.files[0])}
                        className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                      />
                    </div>
                    <div className="flex gap-2 pt-4">
                      <button onClick={resetWorkflow} className="px-4 py-2 text-sm border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50">Cancel</button>
                      <button onClick={handleCompare} disabled={compareLoading || !compareFile}
                        className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400">
                        {compareLoading ? 'Comparing...' : 'Compare'}
                      </button>
                    </div>
                  </div>
                )}

                {/* PREVIEW — COMPARE MODE */}
                {step === 'preview' && mode === 'compare' && compareResults && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-bold text-gray-900">Vendor Comparison</h3>
                      <button onClick={resetWorkflow} className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800">Back</button>
                    </div>

                    {/* Summary Stats */}
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                      <div className="bg-gray-50 rounded-lg p-3 text-center">
                        <p className="text-xs text-gray-500">Vendor Items</p>
                        <p className="text-xl font-semibold">{compareResults.summary?.vendorItems || 0}</p>
                      </div>
                      <div className="bg-blue-50 rounded-lg p-3 text-center">
                        <p className="text-xs text-blue-600">Matched</p>
                        <p className="text-xl font-semibold text-blue-700">{compareResults.summary?.matched || 0}</p>
                      </div>
                      <div className="bg-amber-50 rounded-lg p-3 text-center">
                        <p className="text-xs text-amber-600">Qty Mismatches</p>
                        <p className="text-xl font-semibold text-amber-700">{compareResults.summary?.qtyMismatches || 0}</p>
                      </div>
                      <div className="bg-green-50 rounded-lg p-3 text-center">
                        <p className="text-xs text-green-600">Vendor Only</p>
                        <p className="text-xl font-semibold text-green-700">{compareResults.summary?.vendorOnly || 0}</p>
                      </div>
                      <div className="bg-red-50 rounded-lg p-3 text-center">
                        <p className="text-xs text-red-600">System Only</p>
                        <p className="text-xl font-semibold text-red-700">{compareResults.summary?.systemOnly || 0}</p>
                      </div>
                    </div>

                    {/* Qty Mismatches */}
                    {compareResults.qtyMismatches?.length > 0 && (
                      <div>
                        <h4 className="text-sm font-medium text-amber-700 mb-2">Quantity Mismatches</h4>
                        <div className="border rounded-lg overflow-hidden">
                          <div className="max-h-[30vh] overflow-y-auto">
                            <table className="w-full text-sm">
                              <thead className="bg-amber-50 sticky top-0">
                                <tr>
                                  <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Product</th>
                                  <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Size</th>
                                  <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Location</th>
                                  <th className="text-center px-3 py-2 text-xs font-medium text-gray-500">Vendor Qty</th>
                                  <th className="text-center px-3 py-2 text-xs font-medium text-gray-500">System Qty</th>
                                  <th className="text-center px-3 py-2 text-xs font-medium text-gray-500">Diff</th>
                                </tr>
                              </thead>
                              <tbody>
                                {compareResults.qtyMismatches.map((d, i) => (
                                  <tr key={i} className="border-t">
                                    <td className="px-3 py-2">
                                      <div className="font-medium truncate max-w-[200px]">{d.productName || 'Unknown'}</div>
                                      <div className="text-xs text-gray-400 font-mono">{d.upc}</div>
                                    </td>
                                    <td className="px-3 py-2">{d.size || '-'}</td>
                                    <td className="px-3 py-2 text-xs">{d.location || '-'}</td>
                                    <td className="px-3 py-2 text-center">{d.vendorQty}</td>
                                    <td className="px-3 py-2 text-center">{d.systemQty}</td>
                                    <td className="px-3 py-2 text-center font-medium">
                                      <span className={d.diff > 0 ? 'text-green-600' : 'text-red-600'}>
                                        {d.diff > 0 ? '+' : ''}{d.diff}
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Vendor Only */}
                    {compareResults.vendorOnly?.length > 0 && (
                      <div>
                        <h4 className="text-sm font-medium text-green-700 mb-2">In Vendor Form Only (not in your orders)</h4>
                        <div className="border rounded-lg overflow-hidden">
                          <div className="max-h-[25vh] overflow-y-auto">
                            <table className="w-full text-sm">
                              <thead className="bg-green-50 sticky top-0">
                                <tr>
                                  <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Product</th>
                                  <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Size</th>
                                  <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Location</th>
                                  <th className="text-center px-3 py-2 text-xs font-medium text-gray-500">Vendor Qty</th>
                                  <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">UPC</th>
                                </tr>
                              </thead>
                              <tbody>
                                {compareResults.vendorOnly.map((d, i) => (
                                  <tr key={i} className="border-t">
                                    <td className="px-3 py-2 font-medium">{d.productName || d.upc}</td>
                                    <td className="px-3 py-2">{d.size || '-'}</td>
                                    <td className="px-3 py-2 text-xs">{d.location || '-'}</td>
                                    <td className="px-3 py-2 text-center">{d.vendorQty}</td>
                                    <td className="px-3 py-2 text-xs font-mono text-gray-400">{d.upc}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* System Only */}
                    {compareResults.systemOnly?.length > 0 && (
                      <div>
                        <h4 className="text-sm font-medium text-red-700 mb-2">In Your Orders Only (not in vendor form)</h4>
                        <div className="border rounded-lg overflow-hidden">
                          <div className="max-h-[25vh] overflow-y-auto">
                            <table className="w-full text-sm">
                              <thead className="bg-red-50 sticky top-0">
                                <tr>
                                  <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Product</th>
                                  <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Size</th>
                                  <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Color</th>
                                  <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Location</th>
                                  <th className="text-center px-3 py-2 text-xs font-medium text-gray-500">System Qty</th>
                                </tr>
                              </thead>
                              <tbody>
                                {compareResults.systemOnly.map((d, i) => (
                                  <tr key={i} className="border-t">
                                    <td className="px-3 py-2 font-medium">{d.productName}</td>
                                    <td className="px-3 py-2">{d.size || '-'}</td>
                                    <td className="px-3 py-2 text-xs">{d.color || '-'}</td>
                                    <td className="px-3 py-2 text-xs">{d.location || '-'}</td>
                                    <td className="px-3 py-2 text-center">{d.systemQty}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    )}

                    {compareResults.summary?.matched > 0 && compareResults.summary?.qtyMismatches === 0 &&
                     compareResults.summary?.vendorOnly === 0 && compareResults.summary?.systemOnly === 0 && (
                      <div className="text-center py-8">
                        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-green-100 mb-3">
                          <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                        <p className="text-green-700 font-medium">Everything matches!</p>
                      </div>
                    )}
                  </div>
                )}

                {/* PREVIEW — ORDERS MODE */}
                {step === 'preview' && mode === 'orders' && liveSummary && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-bold text-gray-900">Revision Preview</h3>
                      <div className="flex gap-2">
                        <button onClick={() => { setStep('configure'); setDecisions([]); setSummary(null); }}
                          className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800">Back</button>
                        <button onClick={handleApply}
                          className="px-4 py-2 text-sm bg-amber-600 text-white rounded-md hover:bg-amber-700">Apply Revision</button>
                      </div>
                    </div>

                    {/* Summary Stats */}
                    <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                      <div className="bg-gray-50 rounded-lg p-3 text-center">
                        <p className="text-xs text-gray-500">Total</p>
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
                        <p className="text-lg font-semibold text-purple-700">{liveSummary.originalTotalQty} → {liveSummary.adjustedTotalQty}</p>
                      </div>
                    </div>

                    {liveSummary.reductionPct > maxReductionPct && (
                      <p className="text-sm text-amber-600 bg-amber-50 rounded px-3 py-2">
                        Reduction of {liveSummary.reductionPct}% exceeds {maxReductionPct}% target. Use the AI chat to discuss which items to add or increase.
                      </p>
                    )}

                    {/* Filters */}
                    <div className="flex flex-wrap gap-2">
                      <input type="text" placeholder="Search product, UPC, size..." value={searchFilter}
                        onChange={e => setSearchFilter(e.target.value)}
                        className="px-3 py-1.5 border border-gray-300 rounded-md text-sm flex-1 min-w-[200px]" />
                      <select value={locationFilter} onChange={e => setLocationFilter(e.target.value)}
                        className="px-3 py-1.5 border border-gray-300 rounded-md text-sm">
                        <option value="">All Locations</option>
                        {decisionLocations.map(loc => <option key={loc} value={loc}>{loc}</option>)}
                      </select>
                      <select value={decisionFilter} onChange={e => setDecisionFilter(e.target.value)}
                        className="px-3 py-1.5 border border-gray-300 rounded-md text-sm">
                        <option value="">All Decisions</option>
                        <option value="ship">Ship</option>
                        <option value="cancel">Cancel</option>
                        <option value="keep_open_bo">Keep Open</option>
                      </select>
                    </div>

                    {/* Decision Table */}
                    <div className="border rounded-lg overflow-hidden">
                      <div className="max-h-[50vh] overflow-y-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50 sticky top-0">
                            <tr>
                              <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Product</th>
                              <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Size</th>
                              <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Color</th>
                              <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Location</th>
                              <th className="text-center px-3 py-2 text-xs font-medium text-gray-500">Orig</th>
                              <th className="text-center px-3 py-2 text-xs font-medium text-gray-500">On Hand</th>
                              <th className="text-center px-3 py-2 text-xs font-medium text-gray-500">Decision</th>
                              <th className="text-center px-3 py-2 text-xs font-medium text-gray-500">Adj</th>
                              <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Reason</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredDecisions.map((d) => {
                              const realIdx = decisions.indexOf(d);
                              return (
                                <tr key={d.orderItemId} className={`border-t ${DECISION_COLORS[d.decision] || ''}`}>
                                  <td className="px-3 py-2">
                                    <div className="font-medium truncate max-w-[200px]">{d.productName}</div>
                                    <div className="text-xs text-gray-400">{d.upc}</div>
                                  </td>
                                  <td className="px-3 py-2">{d.size || '-'}</td>
                                  <td className="px-3 py-2 text-xs">{d.color || '-'}</td>
                                  <td className="px-3 py-2 text-xs">{d.location}</td>
                                  <td className="px-3 py-2 text-center">{d.originalQty}</td>
                                  <td className="px-3 py-2 text-center font-medium">
                                    <span className={d.onHand > 0 ? 'text-green-600' : d.onHand < 0 ? 'text-red-600' : 'text-gray-500'}>{d.onHand}</span>
                                  </td>
                                  <td className="px-3 py-2 text-center">
                                    <button onClick={() => handleToggleDecision(realIdx)}
                                      disabled={d.isDiscontinued || d.receivedNotInventoried}
                                      className={`px-2 py-0.5 rounded text-xs font-medium ${DECISION_BADGES[d.decision]} ${(d.isDiscontinued || d.receivedNotInventoried) ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:opacity-80'}`}
                                      title={d.isDiscontinued ? 'Discontinued' : d.receivedNotInventoried ? 'Has sales, likely received' : 'Click to toggle'}>
                                      {d.decision === 'keep_open_bo' ? 'KEEP OPEN' : d.decision.toUpperCase()}
                                    </button>
                                  </td>
                                  <td className="px-3 py-2 text-center">{d.adjustedQty}</td>
                                  <td className="px-3 py-2 text-xs text-gray-500">
                                    {REASON_LABELS[d.reason] || d.reason}
                                    {d.userOverride && <span className="ml-1 text-blue-500">(modified)</span>}
                                    {d.recentSales && <span className="ml-1 text-purple-500">({d.recentSales.qtySold} sold)</span>}
                                    {d.priorRevision && <span className="ml-1 text-gray-400">[prev: {d.priorRevision.decision}]</span>}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      <div className="bg-gray-50 px-3 py-2 text-xs text-gray-500 border-t">
                        {filteredDecisions.length} of {decisions.length} items. Click decision to toggle.
                      </div>
                    </div>
                  </div>
                )}

                {/* PREVIEW — SPREADSHEET MODE */}
                {step === 'preview' && mode === 'spreadsheet' && spreadsheetSummary && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-bold text-gray-900">Spreadsheet Preview</h3>
                      <div className="flex gap-2">
                        <button onClick={() => { setStep('configure'); setSpreadsheetDecisions([]); setSpreadsheetSummary(null); }}
                          className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800">Back</button>
                        <button onClick={handleSpreadsheetDownload} disabled={downloading}
                          className="px-4 py-2 text-sm bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-400">
                          {downloading ? 'Generating...' : 'Download Revised Spreadsheet'}
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div className="bg-gray-50 rounded-lg p-3 text-center">
                        <p className="text-xs text-gray-500">Total</p>
                        <p className="text-xl font-semibold">{spreadsheetSummary.totalItems}</p>
                      </div>
                      <div className="bg-green-50 rounded-lg p-3 text-center">
                        <p className="text-xs text-green-600">Ship</p>
                        <p className="text-xl font-semibold text-green-700">{spreadsheetSummary.ship}</p>
                      </div>
                      <div className="bg-red-50 rounded-lg p-3 text-center">
                        <p className="text-xs text-red-600">Cancel</p>
                        <p className="text-xl font-semibold text-red-700">{spreadsheetSummary.cancel}</p>
                      </div>
                      <div className="bg-blue-50 rounded-lg p-3 text-center">
                        <p className="text-xs text-blue-600">Cancel Rate</p>
                        <p className="text-xl font-semibold text-blue-700">{spreadsheetSummary.reductionPct}%</p>
                      </div>
                    </div>

                    <div className="border rounded-lg overflow-hidden">
                      <div className="max-h-[50vh] overflow-y-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50 sticky top-0">
                            <tr>
                              <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Product</th>
                              <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Size</th>
                              <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Color</th>
                              <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Location</th>
                              <th className="text-center px-3 py-2 text-xs font-medium text-gray-500">Ordered</th>
                              <th className="text-center px-3 py-2 text-xs font-medium text-gray-500">On Hand</th>
                              <th className="text-center px-3 py-2 text-xs font-medium text-gray-500">Decision</th>
                              <th className="text-center px-3 py-2 text-xs font-medium text-gray-500">Adj</th>
                              <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Reason</th>
                            </tr>
                          </thead>
                          <tbody>
                            {spreadsheetDecisions.map((d, idx) => (
                              <tr key={idx} className={`border-t ${DECISION_COLORS[d.decision] || ''}`}>
                                <td className="px-3 py-2">
                                  <div className="font-medium truncate max-w-[200px]">{d.productName || 'Unknown'}</div>
                                  <div className="text-xs text-gray-400 font-mono">{d.upc}</div>
                                </td>
                                <td className="px-3 py-2">{d.size || '-'}</td>
                                <td className="px-3 py-2 text-xs">{d.color || '-'}</td>
                                <td className="px-3 py-2 text-xs">{d.location || '-'}</td>
                                <td className="px-3 py-2 text-center">{d.orderedQty}</td>
                                <td className="px-3 py-2 text-center">
                                  <span className={d.onHand > 0 ? 'text-green-600' : d.onHand < 0 ? 'text-red-600' : 'text-gray-500'}>{d.onHand}</span>
                                </td>
                                <td className="px-3 py-2 text-center">
                                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${DECISION_BADGES[d.decision]}`}>
                                    {d.decision.toUpperCase()}
                                  </span>
                                </td>
                                <td className="px-3 py-2 text-center">{d.adjustedQty}</td>
                                <td className="px-3 py-2 text-xs text-gray-500">
                                  {REASON_LABELS[d.reason] || d.reason}
                                  {d.recentSales && <span className="ml-1 text-purple-500">({d.recentSales.qtySold} sold)</span>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="bg-gray-50 px-3 py-2 text-xs text-gray-500 border-t">
                        {spreadsheetDecisions.length} items from spreadsheet
                      </div>
                    </div>
                  </div>
                )}

                {/* APPLYING */}
                {step === 'applying' && (
                  <div className="flex flex-col items-center justify-center py-24">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
                    <p className="text-gray-600">Applying revision decisions...</p>
                  </div>
                )}

                {/* DONE */}
                {step === 'done' && (
                  <div className="flex flex-col items-center justify-center py-16 space-y-6">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100">
                      <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                    <div className="text-center">
                      <h3 className="text-xl font-bold text-gray-900 mb-1">Revision Complete</h3>
                      {revisionId && <p className="text-sm text-gray-500">ID: {revisionId}</p>}
                    </div>
                    {summary && (
                      <div className="grid grid-cols-3 gap-4 max-w-md">
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
                    )}
                    <button onClick={resetWorkflow}
                      className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700">
                      Start New Revision
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* CHAT PANEL */}
            {selectedBrandId && (
              <RevisionChat
                brandId={parseInt(selectedBrandId)}
                seasonId={parseInt(selectedSeasonId)}
                orderIds={orderIds}
                brandName={selectedBrand?.name}
              />
            )}
          </div>
        )}
      </div>

      {showTemplateEditor && (
        <VendorTemplateEditor
          brandId={parseInt(selectedBrandId)}
          brandName={selectedBrand?.name}
          onSave={() => { setShowTemplateEditor(false); checkTemplate(); }}
          onClose={() => setShowTemplateEditor(false)}
        />
      )}
    </Layout>
  );
};

export default Revisions;
