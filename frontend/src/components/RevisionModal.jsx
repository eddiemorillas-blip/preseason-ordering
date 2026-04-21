import { useState, useMemo } from 'react';
import { revisionAPI } from '../services/api';
import VendorTemplateEditor from './VendorTemplateEditor';

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

const RevisionModal = ({ selectedOrders, brandId, brandName, seasonId, onClose, onComplete }) => {
  const [mode, setMode] = useState('orders'); // orders | spreadsheet
  const [step, setStep] = useState('configure'); // configure | preview | applying | done
  const [revisionNotes, setRevisionNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [decisions, setDecisions] = useState([]);
  const [summary, setSummary] = useState(null);
  const [revisionId, setRevisionId] = useState(null);
  const [searchFilter, setSearchFilter] = useState('');
  const [locationFilter, setLocationFilter] = useState('');

  // Spreadsheet mode state
  const [spreadsheetFile, setSpreadsheetFile] = useState(null);
  const [spreadsheetSummary, setSpreadsheetSummary] = useState(null);
  const [spreadsheetDecisions, setSpreadsheetDecisions] = useState([]);
  const [downloading, setDownloading] = useState(false);

  // Paste mode state
  const [spreadsheetSubMode, setSpreadsheetSubMode] = useState('upload'); // upload | paste
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
  const [showTemplateEditor, setShowTemplateEditor] = useState(false);
  const [decisionFilter, setDecisionFilter] = useState('');

  const orderIds = selectedOrders.map(o => o.id);

  const handleRunPreview = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await revisionAPI.run({
        brandId,
        orderIds,
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
      if (d.isDiscontinued || d.receivedNotInventoried) return prev; // Can't override these

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
    return { totalItems: decisions.length, ship, cancel, keepOpen, totalOriginalQty, totalAdjustedQty, reductionPct };
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
        });
      } else {
        // No overrides — run again with dryRun=false
        res = await revisionAPI.run({
          brandId,
          orderIds,
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

  // Spreadsheet handlers
  const handleSpreadsheetPreview = async () => {
    if (!spreadsheetFile) return;
    setLoading(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('file', spreadsheetFile);
      formData.append('brandId', brandId);
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
      formData.append('brandId', brandId);
      formData.append('dryRun', 'false');
      const res = await revisionAPI.spreadsheetDownload(formData);
      const blob = new Blob([res.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const date = new Date().toISOString().split('T')[0];
      a.download = `${(brandName || 'brand').replace(/[^a-zA-Z0-9]/g, '_')}_revised_${date}.xlsx`;
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
  // Parse pasted text locally for column preview
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
    // Auto-detect column mapping
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
    setLoading(true);
    setError('');
    setPasteBuckets(null);
    setPasteDecisions([]);
    setPasteSummary(null);
    setPasteWarnings([]);
    try {
      const res = await revisionAPI.pastePreview({
        brandId,
        seasonId,
        rawText: pasteText,
        separator: pasteSeparator === 'auto' ? undefined : pasteSeparator,
        hasHeaders: pasteHasHeaders,
        columnMapping: pasteColumnMapping,
      });
      setPasteBuckets(res.data.buckets);
      setPasteDecisions(res.data.decisions || []);
      setPasteSummary(res.data.summary);
      setPasteWarnings(res.data.parseWarnings || []);
      setStep('preview');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to parse pasted data');
    } finally {
      setLoading(false);
    }
  };

  const handlePasteCommit = async () => {
    setPasteCommitting(true);
    setError('');
    try {
      const res = await revisionAPI.pasteCommit({
        brandId,
        seasonId,
        rawText: pasteText,
        separator: pasteSeparator === 'auto' ? undefined : pasteSeparator,
        hasHeaders: pasteHasHeaders,
        columnMapping: pasteColumnMapping,
        revisionNotes,
      });
      setRevisionId(res.data.revisionId);
      setSummary(res.data.summary);
      setStep('done');
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to commit paste revision');
    } finally {
      setPasteCommitting(false);
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
              {/* Mode Tabs */}
              <div className="flex border-b">
                <button
                  onClick={() => setMode('orders')}
                  className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${mode === 'orders' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                >
                  From Orders
                </button>
                <button
                  onClick={() => setMode('spreadsheet')}
                  className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${mode === 'spreadsheet' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                >
                  From Spreadsheet
                </button>
              </div>

              {mode === 'spreadsheet' && (
                <div className="space-y-4">
                  {/* Sub-tabs: Upload File vs Paste */}
                  <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
                    <button
                      onClick={() => setSpreadsheetSubMode('upload')}
                      className={`flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${spreadsheetSubMode === 'upload' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                      Upload File
                    </button>
                    <button
                      onClick={() => setSpreadsheetSubMode('paste')}
                      className={`flex-1 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${spreadsheetSubMode === 'paste' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                      Paste from Clipboard
                    </button>
                  </div>

                  {spreadsheetSubMode === 'upload' && (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Upload Vendor Spreadsheet</label>
                        <input
                          type="file"
                          accept=".xlsx,.xls,.csv"
                          onChange={e => setSpreadsheetFile(e.target.files[0])}
                          className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                        />
                        <p className="text-xs text-gray-400 mt-1">
                          The app will use the saved column template for {brandName || 'this brand'} to find UPCs and fill in decisions.
                        </p>
                      </div>
                      <button
                        onClick={() => setShowTemplateEditor(true)}
                        className="text-sm text-blue-600 hover:text-blue-800"
                      >
                        Configure column mapping for {brandName || 'this brand'}
                      </button>
                    </>
                  )}

                  {spreadsheetSubMode === 'paste' && (
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Paste your UPC + quantity data</label>
                        <textarea
                          value={pasteText}
                          onChange={e => { setPasteText(e.target.value); parsePasteLocally(e.target.value); }}
                          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono"
                          rows={8}
                          placeholder={"UPC\tQty\n840016123456\t2\n840016123457\t4\n840016123458\t1"}
                        />
                      </div>

                      {/* Settings row */}
                      <div className="flex flex-wrap gap-4 items-center">
                        <div className="flex items-center gap-2">
                          <label className="text-xs font-medium text-gray-600">Separator</label>
                          <select
                            value={pasteSeparator}
                            onChange={e => { setPasteSeparator(e.target.value); parsePasteLocally(pasteText); }}
                            className="text-xs border border-gray-300 rounded px-2 py-1"
                          >
                            <option value="auto">Auto-detect</option>
                            <option value="tab">Tab</option>
                            <option value="comma">Comma</option>
                            <option value="pipe">Pipe</option>
                            <option value="semicolon">Semicolon</option>
                          </select>
                        </div>
                        <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={pasteHasHeaders}
                            onChange={e => { setPasteHasHeaders(e.target.checked); parsePasteLocally(pasteText); }}
                            className="rounded border-gray-300"
                          />
                          Column Headers
                        </label>
                      </div>

                      {/* Parsed preview with column mapping */}
                      {pasteParsedPreview && pasteParsedPreview.rows.length > 0 && (
                        <div className="border rounded-lg overflow-hidden">
                          <div className="bg-gray-50 px-3 py-1.5 border-b flex items-center justify-between">
                            <span className="text-xs font-medium text-gray-600">Column Mapping — {pasteParsedPreview.totalRows} data row{pasteParsedPreview.totalRows !== 1 ? 's' : ''}</span>
                            <span className="text-xs text-gray-400">Assign columns below</span>
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
                                          pasteColumnMapping.locationCol === i ? 'location' :
                                          pasteColumnMapping.sizeCol === i ? 'size' :
                                          pasteColumnMapping.colorCol === i ? 'color' : ''
                                        }
                                        onChange={e => {
                                          const role = e.target.value;
                                          setPasteColumnMapping(prev => {
                                            const next = { ...prev };
                                            // Clear this column from previous role
                                            for (const k of ['upcCol', 'qtyCol', 'locationCol', 'sizeCol', 'colorCol']) {
                                              if (next[k] === i) delete next[k];
                                            }
                                            if (role) next[role + 'Col'] = i;
                                            return next;
                                          });
                                        }}
                                        className="w-full px-1 py-0.5 border border-gray-300 rounded text-xs bg-white"
                                      >
                                        <option value="">—</option>
                                        <option value="upc">UPC/SKU</option>
                                        <option value="qty">Quantity</option>
                                        <option value="location">Location</option>
                                        <option value="size">Size</option>
                                        <option value="color">Color</option>
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
                                        pasteColumnMapping.locationCol === ci ? 'bg-green-50 text-green-700' :
                                        'text-gray-600'
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
                      )}
                    </div>
                  )}
                </div>
              )}

              {showTemplateEditor && (
                <VendorTemplateEditor
                  brandId={brandId}
                  brandName={brandName}
                  onSave={() => setShowTemplateEditor(false)}
                  onClose={() => setShowTemplateEditor(false)}
                />
              )}

              {mode === 'orders' && (<>
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
                <label className="block text-sm font-medium text-gray-700 mb-1">Revision Notes (optional)</label>
                <textarea
                  value={revisionNotes}
                  onChange={e => setRevisionNotes(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  rows={2}
                  placeholder="e.g., Monthly revision for April 2026"
                />
              </div>
              </>)}
            </div>
          )}

          {/* STEP: Preview (paste mode) */}
          {step === 'preview' && mode === 'spreadsheet' && spreadsheetSubMode === 'paste' && pasteBuckets && (
            <div className="space-y-4">
              {/* Warnings */}
              {pasteWarnings.length > 0 && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3">
                  {pasteWarnings.map((w, i) => <p key={i} className="text-sm text-yellow-800">{w}</p>)}
                </div>
              )}

              {/* Bucket summaries */}
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

              {/* Bucket details (collapsible) */}
              {pasteBuckets.notFound?.length > 0 && (
                <details className="border rounded-lg">
                  <summary className="px-3 py-2 text-sm font-medium text-gray-700 cursor-pointer hover:bg-gray-50">
                    {pasteBuckets.notFound.length} Not Found
                  </summary>
                  <div className="border-t px-3 py-2 space-y-1 max-h-40 overflow-y-auto">
                    {pasteBuckets.notFound.slice(0, 50).map((item, i) => (
                      <div key={i} className="text-xs text-gray-600 font-mono">
                        {item.upc} {item.note ? `— ${item.note}` : ''}
                      </div>
                    ))}
                    {pasteBuckets.notFound.length > 50 && (
                      <p className="text-xs text-gray-400">...and {pasteBuckets.notFound.length - 50} more</p>
                    )}
                    <button
                      onClick={() => {
                        const text = pasteBuckets.notFound.map(i => i.upc).join('\n');
                        navigator.clipboard.writeText(text);
                      }}
                      className="mt-2 text-xs text-blue-600 hover:text-blue-800"
                    >
                      Copy unmatched UPCs
                    </button>
                  </div>
                </details>
              )}

              {pasteBuckets.unavailable?.length > 0 && (
                <details className="border rounded-lg">
                  <summary className="px-3 py-2 text-sm font-medium text-red-700 cursor-pointer hover:bg-red-50">
                    {pasteBuckets.unavailable.length} Unavailable (discontinued)
                  </summary>
                  <div className="border-t max-h-40 overflow-y-auto">
                    <table className="w-full text-xs">
                      <tbody>
                        {pasteBuckets.unavailable.slice(0, 50).map((item, i) => (
                          <tr key={i} className="border-t">
                            <td className="px-3 py-1">{item.productName || item.upc}</td>
                            <td className="px-3 py-1">{item.size || '-'}</td>
                            <td className="px-3 py-1 text-center">{item.qty}</td>
                            <td className="px-3 py-1 text-red-500">{item.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}

              {/* Decision summary */}
              {pasteSummary && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="bg-gray-50 rounded-lg p-3 text-center">
                    <p className="text-xs text-gray-500">Total Items</p>
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
                  <div className="max-h-[40vh] overflow-y-auto">
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
                            </td>
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

          {/* STEP: Preview (spreadsheet file upload mode) */}
          {step === 'preview' && mode === 'spreadsheet' && spreadsheetSubMode === 'upload' && spreadsheetSummary && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="bg-gray-50 rounded-lg p-3 text-center">
                  <p className="text-xs text-gray-500">Total Items</p>
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
                <div className="max-h-[45vh] overflow-y-auto">
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
                        <th className="text-center px-3 py-2 text-xs font-medium text-gray-500">Adj Qty</th>
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
                            <span className={d.onHand > 0 ? 'text-green-600' : d.onHand < 0 ? 'text-red-600' : 'text-gray-500'}>
                              {d.onHand}
                            </span>
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
                            {d.recentSales && (
                              <span className="ml-1 text-purple-500">({d.recentSales.qtySold} sold)</span>
                            )}
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

          {/* STEP: Preview (orders mode) */}
          {step === 'preview' && mode === 'orders' && liveSummary && (
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
                        <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Color</th>
                        <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">Location</th>
                        <th className="text-center px-3 py-2 text-xs font-medium text-gray-500">Orig Qty</th>
                        <th className="text-center px-3 py-2 text-xs font-medium text-gray-500">On Hand</th>
                        <th className="text-center px-3 py-2 text-xs font-medium text-gray-500">Target</th>
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
                            <td className="px-3 py-2 text-xs">{d.color || '-'}</td>
                            <td className="px-3 py-2 text-xs">{d.location}</td>
                            <td className="px-3 py-2 text-center">{d.originalQty}</td>
                            <td className="px-3 py-2 text-center font-medium">
                              <span className={d.onHand > 0 ? 'text-green-600' : d.onHand < 0 ? 'text-red-600' : 'text-gray-500'}>
                                {d.onHand}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-center text-xs text-gray-500">
                              {d.targetQty > 0 ? d.targetQty : '\u2014'}
                            </td>
                            <td className="px-3 py-2 text-center">
                              <button
                                onClick={() => handleToggleDecision(realIdx)}
                                disabled={d.isDiscontinued || d.receivedNotInventoried}
                                className={`px-2 py-0.5 rounded text-xs font-medium ${DECISION_BADGES[d.decision]} ${(d.isDiscontinued || d.receivedNotInventoried) ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:opacity-80'}`}
                                title={d.isDiscontinued ? 'Discontinued — cannot override' : d.receivedNotInventoried ? 'Has sales but no inventory — likely received' : 'Click to toggle ship/cancel'}
                              >
                                {d.decision === 'keep_open_bo' ? 'KEEP OPEN' : d.decision.toUpperCase()}
                              </button>
                            </td>
                            <td className="px-3 py-2 text-center">{d.adjustedQty}</td>
                            <td className="px-3 py-2 text-xs text-gray-500">
                              <span>{REASON_LABELS[d.reason] || d.reason}</span>
                              {d.userOverride && <span className="ml-1 text-blue-500">(modified)</span>}
                              {d.recentSales && (
                                <span className="ml-1 text-purple-500" title={`Last sale: ${d.recentSales.lastSale || 'N/A'}`}>
                                  ({d.recentSales.qtySold} sold / {d.recentSales.transactions} txns)
                                </span>
                              )}
                              {d.priorRevision && (
                                <span className="ml-1 text-gray-400" title={`Prior: ${d.priorRevision.decision} on ${d.priorRevision.date ? new Date(d.priorRevision.date).toLocaleDateString() : 'N/A'}`}>
                                  [prev: {d.priorRevision.decision}]
                                </span>
                              )}
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
                onClick={() => { setStep('configure'); setDecisions([]); setSummary(null); setSpreadsheetDecisions([]); setSpreadsheetSummary(null); setPasteBuckets(null); setPasteDecisions([]); setPasteSummary(null); }}
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

            {step === 'configure' && mode === 'orders' && (
              <button
                onClick={handleRunPreview}
                disabled={loading}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400"
              >
                {loading ? 'Running...' : 'Run Preview'}
              </button>
            )}

            {step === 'configure' && mode === 'spreadsheet' && spreadsheetSubMode === 'upload' && (
              <button
                onClick={handleSpreadsheetPreview}
                disabled={loading || !spreadsheetFile}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400"
              >
                {loading ? 'Processing...' : 'Preview Revisions'}
              </button>
            )}

            {step === 'configure' && mode === 'spreadsheet' && spreadsheetSubMode === 'paste' && (
              <button
                onClick={handlePastePreview}
                disabled={loading || !pasteText.trim()}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400"
              >
                {loading ? 'Parsing...' : 'Parse & Preview'}
              </button>
            )}

            {step === 'preview' && mode === 'orders' && (
              <button
                onClick={handleApply}
                className="px-4 py-2 text-sm bg-amber-600 text-white rounded-md hover:bg-amber-700"
              >
                Apply Revision
              </button>
            )}

            {step === 'preview' && mode === 'spreadsheet' && spreadsheetSubMode === 'upload' && (
              <button
                onClick={handleSpreadsheetDownload}
                disabled={downloading}
                className="px-4 py-2 text-sm bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-400"
              >
                {downloading ? 'Generating...' : 'Download Revised Spreadsheet'}
              </button>
            )}

            {step === 'preview' && mode === 'spreadsheet' && spreadsheetSubMode === 'paste' && (
              <button
                onClick={handlePasteCommit}
                disabled={pasteCommitting || !pasteDecisions.length}
                className="px-4 py-2 text-sm bg-amber-600 text-white rounded-md hover:bg-amber-700 disabled:bg-gray-400"
              >
                {pasteCommitting ? 'Committing...' : 'Commit Revision'}
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
