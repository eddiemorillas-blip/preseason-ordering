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
  flipped_back_cap: 'Flipped (cap)',
  user_override: 'Manual override',
  at_or_above_target: 'At/above target',
  below_target: 'Below target',
  removed_by_chat: 'Removed via chat',
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
  const [step, setStep] = useState('idle'); // idle | configure | reconcile | preview | applying | done
  const [revisionNotes, setRevisionNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [decisions, setDecisions] = useState([]);
  const [summary, setSummary] = useState(null);
  const [revisionId, setRevisionId] = useState(null);
  const [searchFilter, setSearchFilter] = useState('');
  const [locationFilter, setLocationFilter] = useState('');
  const [decisionFilter, setDecisionFilter] = useState('');

  // Brand order paste state
  const [reconcilePaste, setReconcilePaste] = useState('');
  const [pasteColumns, setPasteColumns] = useState({ upc: '', location: '', qty: '' });

  // Spreadsheet state
  const [spreadsheetFile, setSpreadsheetFile] = useState(null);
  const [spreadsheetSummary, setSpreadsheetSummary] = useState(null);
  const [spreadsheetDecisions, setSpreadsheetDecisions] = useState([]);
  const [downloading, setDownloading] = useState(false);
  const [showTemplateEditor, setShowTemplateEditor] = useState(false);

  // Paste-from-clipboard state
  const [spreadsheetSubMode, setSpreadsheetSubMode] = useState('upload');
  const [pasteText, setPasteText] = useState('');
  const [pasteSeparator, setPasteSeparator] = useState('auto');
  const [pasteHasHeaders, setPasteHasHeaders] = useState(true);
  const [pasteColumnMapping, setPasteColumnMapping] = useState({});
  const [pasteParsedPreview, setPasteParsedPreview] = useState(null);
  const [pasteBuckets, setPasteBuckets] = useState(null);
  const [pasteDecisions, setPasteDecisions] = useState([]);
  const [pasteSummary, setPasteSummary] = useState(null);
  const [pasteWarnings, setPasteWarnings] = useState([]);
  const [pasteCommitting, setPasteCommitting] = useState(false);

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

  // Extract unique months from ship dates
  const shipMonths = useMemo(() => {
    const months = new Set();
    for (const o of orders) {
      if (o.ship_date) {
        const d = new Date(o.ship_date);
        months.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
      }
    }
    return [...months].sort();
  }, [orders]);

  const formatMonth = (ym) => {
    const [y, m] = ym.split('-');
    return new Date(y, m - 1).toLocaleDateString(undefined, { year: 'numeric', month: 'long' });
  };

  // Filter orders by month (or exact ship date), sorted by date
  const filteredOrders = useMemo(() => {
    let filtered = orders;
    if (selectedShipDate) {
      // Check if it's a month filter (YYYY-MM) or exact date
      if (/^\d{4}-\d{2}$/.test(selectedShipDate)) {
        filtered = orders.filter(o => {
          if (!o.ship_date) return false;
          const d = new Date(o.ship_date);
          const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
          return ym === selectedShipDate;
        });
      } else {
        filtered = orders.filter(o => o.ship_date === selectedShipDate);
      }
    }
    // Sort by ship date ascending
    return [...filtered].sort((a, b) => {
      const da = a.ship_date ? new Date(a.ship_date) : new Date(0);
      const db = b.ship_date ? new Date(b.ship_date) : new Date(0);
      return da - db;
    });
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

  const hasBrandPaste = reconcilePaste.trim().length > 0;

  // ---- Revision handlers ----

  const handleRunPreview = async () => {
    if (!hasBrandPaste && orderIds.length === 0) { setError('Select at least one order or paste a brand order'); return; }
    setLoading(true);
    setError('');
    try {
      const payload = {
        brandId: parseInt(selectedBrandId),
        seasonId: parseInt(selectedSeasonId),
        orderIds,
        dryRun: true,
        includeAdditions: true,
        brandName: selectedBrand?.name,
        revisionNotes,
      };

      // If brand order is pasted, send it directly to /run
      if (hasBrandPaste) {
        payload.pastedBrandOrder = reconcilePaste.trim();
        // Include column overrides if set
        const hasOverrides = pasteColumns.upc !== '' || pasteColumns.location !== '' || pasteColumns.qty !== '';
        if (hasOverrides) {
          payload.columnOverrides = {
            upc: pasteColumns.upc !== '' ? parseInt(pasteColumns.upc) : null,
            location: pasteColumns.location !== '' ? parseInt(pasteColumns.location) : null,
            qty: pasteColumns.qty !== '' ? parseInt(pasteColumns.qty) : null,
          };
        }
      }

      const res = await revisionAPI.run(payload);
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
        });
      } else {
        res = await revisionAPI.run({
          brandId: parseInt(selectedBrandId), orderIds,
          dryRun: false,
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
      // Run both comparison and revision in parallel
      const formData1 = new FormData();
      formData1.append('file', spreadsheetFile);
      formData1.append('brandId', selectedBrandId);
      formData1.append('dryRun', 'true');

      const formData2 = new FormData();
      formData2.append('file', spreadsheetFile);
      formData2.append('brandId', selectedBrandId);
      formData2.append('seasonId', selectedSeasonId);

      const [revisionRes, compareRes] = await Promise.all([
        revisionAPI.spreadsheetPreview(formData1),
        api.post('/revisions/compare-spreadsheet', formData2, { headers: { 'Content-Type': 'multipart/form-data' } })
      ]);

      setSpreadsheetDecisions(revisionRes.data.decisions || []);
      setSpreadsheetSummary(revisionRes.data.summary);
      setCompareResults(compareRes.data);
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

  // ---- Paste handlers ----
  const parsePasteLocally = (text) => {
    if (!text.trim()) { setPasteParsedPreview(null); return; }
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());
    let sep = '\t';
    if (pasteSeparator !== 'auto') {
      sep = { tab: '\t', comma: ',', pipe: '|', semicolon: ';' }[pasteSeparator] || '\t';
    } else {
      const sample = lines.slice(0, 5).join('\n');
      if ((sample.match(/\t/g) || []).length > 0) sep = '\t';
      else if ((sample.match(/,/g) || []).length > 0) sep = ',';
      else if ((sample.match(/\|/g) || []).length > 0) sep = '|';
      else if ((sample.match(/;/g) || []).length > 0) sep = ';';
    }
    const rows = lines.map(l => l.split(sep).map(c => c.trim()));
    const startIdx = pasteHasHeaders ? 1 : 0;
    const dataRows = rows.slice(startIdx, startIdx + 5);
    const allDataRows = rows.slice(startIdx);
    const maxCols = Math.max(...rows.map(r => r.length), 0);
    if (!pasteColumnMapping.upcCol && !pasteColumnMapping.qtyCol) {
      const autoMapping = {};
      for (let c = 0; c < maxCols; c++) {
        const vals = allDataRows.slice(0, 10).map(r => r[c] || '');
        const digits = vals.filter(v => /^\d{8,14}$/.test(v.replace(/[^0-9]/g, '')));
        const smallNums = vals.filter(v => /^\d{1,4}$/.test(v.trim()) && parseInt(v) < 1000);
        if (digits.length > vals.length * 0.5 && !autoMapping.upcCol) autoMapping.upcCol = c;
        else if (smallNums.length > vals.length * 0.3 && !autoMapping.qtyCol && autoMapping.upcCol !== c) autoMapping.qtyCol = c;
      }
      if (Object.keys(autoMapping).length > 0) setPasteColumnMapping(prev => ({ ...prev, ...autoMapping }));
    }
    setPasteParsedPreview({ rows: dataRows, totalRows: allDataRows.length, maxCols, headers: pasteHasHeaders ? rows[0] : null });
  };

  const handlePastePreview = async () => {
    setLoading(true); setError('');
    setPasteBuckets(null); setPasteDecisions([]); setPasteSummary(null); setPasteWarnings([]);
    try {
      const res = await revisionAPI.pastePreview({
        brandId: parseInt(selectedBrandId), seasonId: parseInt(selectedSeasonId),
        rawText: pasteText,
        separator: pasteSeparator === 'auto' ? undefined : pasteSeparator,
        hasHeaders: pasteHasHeaders, columnMapping: pasteColumnMapping,
      });
      setPasteBuckets(res.data.buckets);
      setPasteDecisions(res.data.decisions || []);
      setPasteSummary(res.data.summary);
      setPasteWarnings(res.data.parseWarnings || []);
      setStep('preview');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to parse pasted data');
    } finally { setLoading(false); }
  };

  const handlePasteCommit = async () => {
    setPasteCommitting(true); setError('');
    try {
      const res = await revisionAPI.pasteCommit({
        brandId: parseInt(selectedBrandId), seasonId: parseInt(selectedSeasonId),
        rawText: pasteText,
        separator: pasteSeparator === 'auto' ? undefined : pasteSeparator,
        hasHeaders: pasteHasHeaders, columnMapping: pasteColumnMapping,
        revisionNotes,
      });
      setRevisionId(res.data.revisionId);
      setSummary(res.data.summary);
      setStep('done');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to commit paste revision');
    } finally { setPasteCommitting(false); }
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
    setReconcilePaste('');
    setPasteColumns({ upc: '', location: '', qty: '' });
    setPasteText('');
    setPasteColumnMapping({});
    setPasteParsedPreview(null);
    setPasteBuckets(null);
    setPasteDecisions([]);
    setPasteSummary(null);
    setPasteWarnings([]);
    setSpreadsheetSubMode('upload');
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
              {/* Month Filter */}
              <div className="p-3 border-b">
                <select
                  value={selectedShipDate}
                  onChange={e => updateFilter('shipDate', e.target.value)}
                  className="w-full px-2 py-1.5 border border-gray-300 rounded-md text-sm"
                >
                  <option value="">All Months</option>
                  {shipMonths.map(m => (
                    <option key={m} value={m}>{formatMonth(m)}</option>
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
                {(() => {
                  let lastDate = null;
                  return filteredOrders.map(o => {
                    const dateStr = o.ship_date ? formatDate(o.ship_date) : 'No date';
                    const showHeader = dateStr !== lastDate;
                    lastDate = dateStr;
                    return (
                      <div key={o.id}>
                        {showHeader && (
                          <div className="px-3 py-1.5 bg-gray-100 border-b border-gray-200 text-xs font-semibold text-gray-600 sticky top-0">
                            {dateStr}
                          </div>
                        )}
                        <label
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
                              {o.item_count || 0} items
                            </div>
                          </div>
                        </label>
                      </div>
                    );
                  });
                })()}
                {filteredOrders.length === 0 && (
                  <p className="px-3 py-8 text-center text-sm text-gray-400">No orders found</p>
                )}
              </div>

              {/* Sidebar Footer */}
              <div className="p-3 border-t bg-white space-y-2">
                {step === 'idle' && (
                  <button
                    onClick={() => { setMode('orders'); setStep('configure'); }}
                    className="w-full px-3 py-2 text-sm bg-amber-600 text-white rounded-md hover:bg-amber-700"
                  >
                    {selectedOrders.size > 0 ? `Revise ${selectedOrders.size} Order${selectedOrders.size !== 1 ? 's' : ''}` : 'Paste Brand Order'}
                  </button>
                )}
                {step === 'idle' && (
                  <button
                    onClick={() => { setMode('spreadsheet'); setStep('configure'); }}
                    className="w-full px-3 py-2 text-sm border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
                  >
                    Upload / Paste
                  </button>
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
                        {/* Sub-tabs: Upload vs Paste */}
                        <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
                          <button onClick={() => setSpreadsheetSubMode('upload')}
                            className={`flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${spreadsheetSubMode === 'upload' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                            Upload File
                          </button>
                          <button onClick={() => setSpreadsheetSubMode('paste')}
                            className={`flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${spreadsheetSubMode === 'paste' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                            Paste from Clipboard
                          </button>
                        </div>

                        {spreadsheetSubMode === 'upload' && (
                          <>
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-2">Vendor Spreadsheet</label>
                              <input type="file" accept=".xlsx,.xls,.csv"
                                onChange={e => setSpreadsheetFile(e.target.files[0])}
                                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100" />
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
                          </>
                        )}

                        {spreadsheetSubMode === 'paste' && (
                          <div className="space-y-4">
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-2">Paste your UPC + quantity data</label>
                              <textarea value={pasteText}
                                onChange={e => { setPasteText(e.target.value); parsePasteLocally(e.target.value); }}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono" rows={8}
                                placeholder={"UPC\tQty\n840016123456\t2\n840016123457\t4\n840016123458\t1"} />
                            </div>
                            <div className="flex flex-wrap gap-4 items-center">
                              <div className="flex items-center gap-2">
                                <label className="text-xs font-medium text-gray-600">Separator</label>
                                <select value={pasteSeparator}
                                  onChange={e => { setPasteSeparator(e.target.value); parsePasteLocally(pasteText); }}
                                  className="text-xs border border-gray-300 rounded px-2 py-1">
                                  <option value="auto">Auto-detect</option>
                                  <option value="tab">Tab</option>
                                  <option value="comma">Comma</option>
                                  <option value="pipe">Pipe</option>
                                  <option value="semicolon">Semicolon</option>
                                </select>
                              </div>
                              <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                                <input type="checkbox" checked={pasteHasHeaders}
                                  onChange={e => { setPasteHasHeaders(e.target.checked); parsePasteLocally(pasteText); }}
                                  className="rounded border-gray-300" />
                                Column Headers
                              </label>
                            </div>

                            {/* Parsed preview with column mapping */}
                            {pasteParsedPreview && pasteParsedPreview.rows.length > 0 && (
                              <div className="border rounded-lg overflow-hidden">
                                <div className="bg-gray-50 px-3 py-1.5 border-b flex items-center justify-between">
                                  <span className="text-xs font-medium text-gray-600">Column Mapping — {pasteParsedPreview.totalRows} data row{pasteParsedPreview.totalRows !== 1 ? 's' : ''}</span>
                                </div>
                                <div className="overflow-x-auto">
                                  <table className="w-full text-xs">
                                    <thead>
                                      <tr className="bg-gray-50 border-b">
                                        {Array.from({ length: pasteParsedPreview.maxCols }, (_, i) => (
                                          <th key={i} className="px-2 py-1.5 text-center min-w-[80px]">
                                            <div className="text-gray-400 mb-1">{String.fromCharCode(65 + i)}</div>
                                            <select
                                              value={
                                                pasteColumnMapping.upcCol === i ? 'upc' :
                                                pasteColumnMapping.qtyCol === i ? 'qty' :
                                                pasteColumnMapping.locationCol === i ? 'location' : ''
                                              }
                                              onChange={e => {
                                                const role = e.target.value;
                                                setPasteColumnMapping(prev => {
                                                  const next = { ...prev };
                                                  for (const k of ['upcCol', 'qtyCol', 'locationCol', 'sizeCol', 'colorCol']) {
                                                    if (next[k] === i) delete next[k];
                                                  }
                                                  if (role) next[role + 'Col'] = i;
                                                  return next;
                                                });
                                              }}
                                              className="w-full px-1 py-0.5 border border-gray-300 rounded text-xs bg-white">
                                              <option value="">—</option>
                                              <option value="upc">UPC/SKU</option>
                                              <option value="qty">Quantity</option>
                                              <option value="location">Location</option>
                                            </select>
                                          </th>
                                        ))}
                                      </tr>
                                      {pasteParsedPreview.headers && (
                                        <tr className="bg-blue-50 border-b">
                                          {pasteParsedPreview.headers.map((h, i) => (
                                            <td key={i} className="px-2 py-1 text-blue-700 font-medium">{h}</td>
                                          ))}
                                        </tr>
                                      )}
                                    </thead>
                                    <tbody>
                                      {pasteParsedPreview.rows.map((row, ri) => (
                                        <tr key={ri} className="border-t">
                                          {Array.from({ length: pasteParsedPreview.maxCols }, (_, ci) => (
                                            <td key={ci} className={`px-2 py-1 font-mono ${
                                              pasteColumnMapping.upcCol === ci ? 'bg-blue-50 text-blue-700' :
                                              pasteColumnMapping.qtyCol === ci ? 'bg-amber-50 text-amber-700' :
                                              pasteColumnMapping.locationCol === ci ? 'bg-green-50 text-green-700' : 'text-gray-600'
                                            }`}>{row[ci] || ''}</td>
                                          ))}
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            )}

                            <div className="flex gap-2 pt-2">
                              <button onClick={resetWorkflow} className="px-4 py-2 text-sm border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50">Cancel</button>
                              <button onClick={handlePastePreview} disabled={loading || !pasteText.trim()}
                                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400">
                                {loading ? 'Parsing...' : 'Parse & Preview'}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {mode === 'orders' && (
                      <div className="space-y-4">
                        {selectedOrders.size > 0 && (
                          <div className="bg-gray-50 rounded-lg p-3">
                            <p className="text-sm text-gray-600">{selectedOrders.size} orders selected from {selectedBrand?.name}</p>
                          </div>
                        )}

                        {/* Brand Order Paste */}
                        <div className="border border-blue-200 rounded-lg p-4 bg-blue-50/50">
                          <label className="text-sm font-medium text-gray-700 mb-1 block">Brand Order (optional)</label>
                          <p className="text-xs text-gray-500 mb-3">
                            Paste the order lines from the brand. The revision will run against these items instead of what's in the system.
                          </p>
                          <textarea
                            value={reconcilePaste}
                            onChange={e => { setReconcilePaste(e.target.value); setPasteColumns({ upc: '', location: '', qty: '' }); }}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono"
                            rows={6}
                            placeholder={"8020647637812\tSLC\t2\n8020647637829\tOgden\t1\n8020647637836\tSouth Main\t3"}
                          />
                              {/* Column mapper — shows preview of pasted data with column assignment */}
                              {reconcilePaste.trim() && (() => {
                                const previewLines = reconcilePaste.trim().split(/\r?\n/).slice(0, 5);
                                const previewRows = previewLines.map(l => l.split(/\t|(?:\s{2,})|\|/).map(s => s.trim()).filter(Boolean));
                                const maxCols = Math.max(...previewRows.map(r => r.length), 0);
                                if (maxCols === 0) return null;
                                return (
                                  <div className="mt-3 border rounded-lg overflow-hidden">
                                    <div className="bg-gray-50 px-3 py-1.5 border-b flex items-center justify-between">
                                      <span className="text-xs font-medium text-gray-600">Column Mapping</span>
                                      <span className="text-xs text-gray-400">Assign columns or leave on Auto</span>
                                    </div>
                                    <div className="overflow-x-auto">
                                      <table className="w-full text-xs">
                                        <thead>
                                          <tr className="bg-gray-50 border-b">
                                            {Array.from({ length: maxCols }, (_, i) => (
                                              <th key={i} className="px-2 py-1.5 text-center">
                                                <select
                                                  value={
                                                    pasteColumns.upc === String(i) ? 'upc' :
                                                    pasteColumns.location === String(i) ? 'location' :
                                                    pasteColumns.qty === String(i) ? 'qty' : ''
                                                  }
                                                  onChange={e => {
                                                    const role = e.target.value;
                                                    setPasteColumns(prev => {
                                                      const next = { ...prev };
                                                      // Clear this column from any previous role
                                                      for (const k of ['upc', 'location', 'qty']) {
                                                        if (next[k] === String(i)) next[k] = '';
                                                      }
                                                      // Assign new role
                                                      if (role) next[role] = String(i);
                                                      return next;
                                                    });
                                                  }}
                                                  className="w-full px-1 py-0.5 border border-gray-300 rounded text-xs bg-white"
                                                >
                                                  <option value="">Auto</option>
                                                  <option value="upc">UPC</option>
                                                  <option value="location">Location</option>
                                                  <option value="qty">Qty</option>
                                                </select>
                                              </th>
                                            ))}
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {previewRows.map((row, ri) => (
                                            <tr key={ri} className="border-t">
                                              {Array.from({ length: maxCols }, (_, ci) => (
                                                <td key={ci} className={`px-2 py-1 font-mono ${
                                                  pasteColumns.upc === String(ci) ? 'bg-blue-50 text-blue-700' :
                                                  pasteColumns.location === String(ci) ? 'bg-green-50 text-green-700' :
                                                  pasteColumns.qty === String(ci) ? 'bg-amber-50 text-amber-700' : 'text-gray-600'
                                                }`}>
                                                  {row[ci] || ''}
                                                </td>
                                              ))}
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  </div>
                                );
                              })()}
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
                            {loading ? 'Running...' : hasBrandPaste ? 'Run Preview (Brand Order)' : 'Run Preview'}
                          </button>
                        </div>
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

                    {/* Brand paste indicator */}
                    {hasBrandPaste && (
                      <div className="bg-blue-50 border border-blue-200 rounded-md px-3 py-2 text-sm text-blue-800">
                        Running revision against pasted brand order ({decisions.length} items matched)
                      </div>
                    )}

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
                              <th className="text-center px-3 py-2 text-xs font-medium text-gray-500">Target</th>
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
                                  <td className="px-3 py-2 text-center text-xs text-gray-500">
                                    {d.targetQty > 0 ? d.targetQty : '\u2014'}
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

                {/* PREVIEW — PASTE MODE */}
                {step === 'preview' && mode === 'spreadsheet' && spreadsheetSubMode === 'paste' && pasteBuckets && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-bold text-gray-900">Paste Preview</h3>
                      <div className="flex gap-2">
                        <button onClick={() => { setStep('configure'); setPasteBuckets(null); setPasteDecisions([]); setPasteSummary(null); }}
                          className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800">Back</button>
                        <button onClick={handlePasteCommit} disabled={pasteCommitting || !pasteDecisions.length}
                          className="px-4 py-2 text-sm bg-amber-600 text-white rounded-md hover:bg-amber-700 disabled:bg-gray-400">
                          {pasteCommitting ? 'Committing...' : 'Commit Revision'}
                        </button>
                      </div>
                    </div>

                    {pasteWarnings.length > 0 && (
                      <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3">
                        {pasteWarnings.map((w, i) => <p key={i} className="text-sm text-yellow-800">{w}</p>)}
                      </div>
                    )}

                    {/* Buckets */}
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                      <div className="bg-green-50 rounded-lg p-2 text-center">
                        <p className="text-xs text-green-600">Available</p>
                        <p className="text-lg font-semibold text-green-700">{pasteBuckets.fullyAvailable?.length || 0}</p>
                      </div>
                      <div className="bg-yellow-50 rounded-lg p-2 text-center">
                        <p className="text-xs text-yellow-600">Partial</p>
                        <p className="text-lg font-semibold text-yellow-700">{pasteBuckets.partiallyAvailable?.length || 0}</p>
                      </div>
                      <div className="bg-blue-50 rounded-lg p-2 text-center">
                        <p className="text-xs text-blue-600">Future</p>
                        <p className="text-lg font-semibold text-blue-700">{pasteBuckets.futureAvailable?.length || 0}</p>
                      </div>
                      <div className="bg-red-50 rounded-lg p-2 text-center">
                        <p className="text-xs text-red-600">Unavailable</p>
                        <p className="text-lg font-semibold text-red-700">{pasteBuckets.unavailable?.length || 0}</p>
                      </div>
                      <div className="bg-gray-50 rounded-lg p-2 text-center">
                        <p className="text-xs text-gray-600">Not Found</p>
                        <p className="text-lg font-semibold text-gray-700">{pasteBuckets.notFound?.length || 0}</p>
                      </div>
                    </div>

                    {pasteBuckets.notFound?.length > 0 && (
                      <details className="border rounded-lg">
                        <summary className="px-3 py-2 text-sm font-medium text-gray-700 cursor-pointer hover:bg-gray-50">
                          {pasteBuckets.notFound.length} Not Found
                        </summary>
                        <div className="border-t px-3 py-2 space-y-1 max-h-40 overflow-y-auto">
                          {pasteBuckets.notFound.slice(0, 50).map((item, i) => (
                            <div key={i} className="text-xs text-gray-600 font-mono">{item.upc} {item.note ? `— ${item.note}` : ''}</div>
                          ))}
                          <button onClick={() => navigator.clipboard.writeText(pasteBuckets.notFound.map(i => i.upc).join('\n'))}
                            className="mt-2 text-xs text-blue-600 hover:text-blue-800">Copy unmatched UPCs</button>
                        </div>
                      </details>
                    )}

                    {pasteBuckets.unavailable?.length > 0 && (
                      <details className="border rounded-lg">
                        <summary className="px-3 py-2 text-sm font-medium text-red-700 cursor-pointer hover:bg-red-50">
                          {pasteBuckets.unavailable.length} Unavailable (discontinued)
                        </summary>
                        <div className="border-t max-h-40 overflow-y-auto">
                          <table className="w-full text-xs"><tbody>
                            {pasteBuckets.unavailable.slice(0, 50).map((item, i) => (
                              <tr key={i} className="border-t">
                                <td className="px-3 py-1">{item.productName || item.upc}</td>
                                <td className="px-3 py-1">{item.size || '-'}</td>
                                <td className="px-3 py-1 text-center">{item.qty}</td>
                                <td className="px-3 py-1 text-red-500">{item.reason}</td>
                              </tr>
                            ))}
                          </tbody></table>
                        </div>
                      </details>
                    )}

                    {/* Decision stats */}
                    {pasteSummary && (
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div className="bg-gray-50 rounded-lg p-3 text-center">
                          <p className="text-xs text-gray-500">Total</p>
                          <p className="text-xl font-semibold">{pasteSummary.totalItems}</p>
                        </div>
                        <div className="bg-green-50 rounded-lg p-3 text-center">
                          <p className="text-xs text-green-600">Ship</p>
                          <p className="text-xl font-semibold text-green-700">{pasteSummary.ship}</p>
                        </div>
                        <div className="bg-red-50 rounded-lg p-3 text-center">
                          <p className="text-xs text-red-600">Cancel</p>
                          <p className="text-xl font-semibold text-red-700">{pasteSummary.cancel}</p>
                        </div>
                        <div className="bg-blue-50 rounded-lg p-3 text-center">
                          <p className="text-xs text-blue-600">Reduction</p>
                          <p className="text-xl font-semibold text-blue-700">{pasteSummary.reductionPct}%</p>
                        </div>
                      </div>
                    )}

                    {/* Decisions table */}
                    {pasteDecisions.length > 0 && (
                      <div className="border rounded-lg overflow-hidden">
                        <div className="max-h-[45vh] overflow-y-auto">
                          <table className="w-full text-sm">
                            <thead className="bg-gray-50 sticky top-0">
                              <tr>
                                <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Product</th>
                                <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Size</th>
                                <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Location</th>
                                <th className="text-center px-3 py-2 text-xs font-medium text-gray-500">Qty</th>
                                <th className="text-center px-3 py-2 text-xs font-medium text-gray-500">On Hand</th>
                                <th className="text-center px-3 py-2 text-xs font-medium text-gray-500">Target</th>
                                <th className="text-center px-3 py-2 text-xs font-medium text-gray-500">Decision</th>
                                <th className="text-center px-3 py-2 text-xs font-medium text-gray-500">Adj Qty</th>
                                <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Reason</th>
                              </tr>
                            </thead>
                            <tbody>
                              {pasteDecisions.map((d, idx) => (
                                <tr key={idx} className={`border-t ${DECISION_COLORS[d.decision] || ''}`}>
                                  <td className="px-3 py-2">
                                    <div className="font-medium truncate max-w-[180px]">{d.productName || 'Unknown'}</div>
                                    <div className="text-xs text-gray-400 font-mono">{d.upc}</div>
                                  </td>
                                  <td className="px-3 py-2">{d.size || '-'}</td>
                                  <td className="px-3 py-2 text-xs">{d.location || '-'}</td>
                                  <td className="px-3 py-2 text-center">{d.originalQty}</td>
                                  <td className="px-3 py-2 text-center">
                                    <span className={d.onHand > 0 ? 'text-green-600' : 'text-gray-500'}>{d.onHand}</span>
                                  </td>
                                  <td className="px-3 py-2 text-center text-xs text-gray-500">{d.targetQty > 0 ? d.targetQty : '\u2014'}</td>
                                  <td className="px-3 py-2 text-center">
                                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${DECISION_BADGES[d.decision]}`}>
                                      {d.decision.toUpperCase()}
                                    </span>
                                  </td>
                                  <td className="px-3 py-2 text-center">{d.adjustedQty}</td>
                                  <td className="px-3 py-2 text-xs text-gray-500">{REASON_LABELS[d.reason] || d.reason}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div className="bg-gray-50 px-3 py-2 text-xs text-gray-500 border-t">
                          {pasteDecisions.length} items from pasted data
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* PREVIEW — SPREADSHEET FILE MODE */}
                {step === 'preview' && mode === 'spreadsheet' && spreadsheetSubMode !== 'paste' && spreadsheetSummary && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-bold text-gray-900">Spreadsheet Analysis</h3>
                      <div className="flex gap-2">
                        <button onClick={() => { setStep('configure'); setSpreadsheetDecisions([]); setSpreadsheetSummary(null); }}
                          className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800">Back</button>
                        <button onClick={handleSpreadsheetDownload} disabled={downloading}
                          className="px-4 py-2 text-sm bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-400">
                          {downloading ? 'Generating...' : 'Download Revised Spreadsheet'}
                        </button>
                      </div>
                    </div>

                    {/* Vendor Comparison */}
                    {compareResults && (
                      <div className="space-y-3">
                        <h4 className="text-sm font-medium text-gray-700">Vendor vs System Comparison</h4>
                        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                          <div className="bg-gray-50 rounded-lg p-2 text-center">
                            <p className="text-xs text-gray-500">Vendor Items</p>
                            <p className="text-lg font-semibold">{compareResults.summary?.vendorItems || 0}</p>
                          </div>
                          <div className="bg-blue-50 rounded-lg p-2 text-center">
                            <p className="text-xs text-blue-600">Matched</p>
                            <p className="text-lg font-semibold text-blue-700">{compareResults.summary?.matched || 0}</p>
                          </div>
                          <div className="bg-amber-50 rounded-lg p-2 text-center">
                            <p className="text-xs text-amber-600">Qty Diff</p>
                            <p className="text-lg font-semibold text-amber-700">{compareResults.summary?.qtyMismatches || 0}</p>
                          </div>
                          <div className="bg-green-50 rounded-lg p-2 text-center">
                            <p className="text-xs text-green-600">Vendor Only</p>
                            <p className="text-lg font-semibold text-green-700">{compareResults.summary?.vendorOnly || 0}</p>
                          </div>
                          <div className="bg-red-50 rounded-lg p-2 text-center">
                            <p className="text-xs text-red-600">System Only</p>
                            <p className="text-lg font-semibold text-red-700">{compareResults.summary?.systemOnly || 0}</p>
                          </div>
                        </div>

                        {compareResults.qtyMismatches?.length > 0 && (
                          <details className="border rounded-lg">
                            <summary className="px-3 py-2 text-sm font-medium text-amber-700 cursor-pointer hover:bg-amber-50">
                              {compareResults.qtyMismatches.length} Quantity Mismatch{compareResults.qtyMismatches.length !== 1 ? 'es' : ''}
                            </summary>
                            <div className="max-h-40 overflow-y-auto border-t">
                              <table className="w-full text-xs">
                                <thead className="bg-amber-50 sticky top-0">
                                  <tr>
                                    <th className="text-left px-3 py-1.5">Product</th>
                                    <th className="text-left px-3 py-1.5">Size</th>
                                    <th className="text-left px-3 py-1.5">Location</th>
                                    <th className="text-center px-3 py-1.5">Vendor</th>
                                    <th className="text-center px-3 py-1.5">System</th>
                                    <th className="text-center px-3 py-1.5">Diff</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {compareResults.qtyMismatches.map((d, i) => (
                                    <tr key={i} className="border-t">
                                      <td className="px-3 py-1 truncate max-w-[150px]">{d.productName || d.upc}</td>
                                      <td className="px-3 py-1">{d.size || '-'}</td>
                                      <td className="px-3 py-1">{d.location || '-'}</td>
                                      <td className="px-3 py-1 text-center">{d.vendorQty}</td>
                                      <td className="px-3 py-1 text-center">{d.systemQty}</td>
                                      <td className="px-3 py-1 text-center font-medium">
                                        <span className={d.diff > 0 ? 'text-green-600' : 'text-red-600'}>{d.diff > 0 ? '+' : ''}{d.diff}</span>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </details>
                        )}

                        {compareResults.vendorOnly?.length > 0 && (
                          <details className="border rounded-lg">
                            <summary className="px-3 py-2 text-sm font-medium text-green-700 cursor-pointer hover:bg-green-50">
                              {compareResults.vendorOnly.length} item{compareResults.vendorOnly.length !== 1 ? 's' : ''} in vendor form only
                            </summary>
                            <div className="max-h-40 overflow-y-auto border-t">
                              <table className="w-full text-xs">
                                <tbody>
                                  {compareResults.vendorOnly.map((d, i) => (
                                    <tr key={i} className="border-t">
                                      <td className="px-3 py-1">{d.productName || d.upc}</td>
                                      <td className="px-3 py-1">{d.size || '-'}</td>
                                      <td className="px-3 py-1">{d.location || '-'}</td>
                                      <td className="px-3 py-1 text-center">{d.vendorQty}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </details>
                        )}

                        {compareResults.systemOnly?.length > 0 && (
                          <details className="border rounded-lg">
                            <summary className="px-3 py-2 text-sm font-medium text-red-700 cursor-pointer hover:bg-red-50">
                              {compareResults.systemOnly.length} item{compareResults.systemOnly.length !== 1 ? 's' : ''} in your orders only
                            </summary>
                            <div className="max-h-40 overflow-y-auto border-t">
                              <table className="w-full text-xs">
                                <tbody>
                                  {compareResults.systemOnly.map((d, i) => (
                                    <tr key={i} className="border-t">
                                      <td className="px-3 py-1">{d.productName}</td>
                                      <td className="px-3 py-1">{d.size || '-'}</td>
                                      <td className="px-3 py-1">{d.location || '-'}</td>
                                      <td className="px-3 py-1 text-center">{d.systemQty}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </details>
                        )}
                      </div>
                    )}

                    {/* Revision Stats */}
                    <h4 className="text-sm font-medium text-gray-700">Revision Decisions</h4>
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
                              <th className="text-center px-3 py-2 text-xs font-medium text-gray-500">Target</th>
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
                                <td className="px-3 py-2 text-center text-xs text-gray-500">
                                  {d.targetQty > 0 ? d.targetQty : '\u2014'}
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
                onDecisionsChange={(changes) => {
                  setDecisions(prev => {
                    const updated = [...prev];
                    for (const change of changes) {
                      for (let i = 0; i < updated.length; i++) {
                        const d = updated[i];
                        // Match by UPC if provided
                        const upcMatch = !change.upc || d.upc === change.upc;
                        // Match by product name substring if provided
                        const nameMatch = !change.productName || (d.productName || '').toLowerCase().includes(change.productName.toLowerCase());
                        // Match by size if provided
                        const sizeMatch = !change.size || (d.size || '').toLowerCase() === change.size.toLowerCase();
                        // Match by location if provided
                        const locMatch = !change.location || (d.location || '').toLowerCase().includes(change.location.toLowerCase());

                        if (upcMatch && nameMatch && sizeMatch && locMatch) {
                          updated[i] = {
                            ...d,
                            decision: change.decision,
                            adjustedQty: change.adjustedQty != null ? change.adjustedQty : (change.decision === 'cancel' ? 0 : d.originalQty),
                            reason: change.reason || 'user_override',
                            userOverride: true,
                          };
                        }
                      }
                    }
                    return updated;
                  });
                }}
                revisionContext={{
                  mode,
                  step,
                  selectedOrderIds: Array.from(selectedOrders),
                  decisions: decisions.length > 0 ? decisions.map(d => ({
                    orderItemId: d.orderItemId, orderId: d.orderId, upc: d.upc,
                    productName: d.productName, size: d.size, color: d.color,
                    location: d.location, locationId: d.locationId,
                    originalQty: d.originalQty, adjustedQty: d.adjustedQty,
                    onHand: d.onHand, decision: d.decision, reason: d.reason
                  })) : undefined,
                  spreadsheetDecisions: spreadsheetDecisions.length > 0 ? spreadsheetDecisions.map(d => ({
                    upc: d.upc, productName: d.productName, size: d.size, color: d.color,
                    location: d.location, orderedQty: d.orderedQty, adjustedQty: d.adjustedQty,
                    onHand: d.onHand, decision: d.decision, reason: d.reason
                  })) : undefined,
                  summary: liveSummary || spreadsheetSummary || undefined,
                  compareResults: compareResults ? {
                    summary: compareResults.summary,
                    qtyMismatches: compareResults.qtyMismatches,
                    vendorOnly: compareResults.vendorOnly,
                    systemOnly: compareResults.systemOnly,
                  } : undefined,
                }}
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
