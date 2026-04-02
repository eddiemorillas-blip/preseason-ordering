import { useState, useEffect } from 'react';
import api from '../services/api';

// Convert column letter to number: A=1, B=2, ..., Z=26, AA=27
const colLetterToNum = (letter) => {
  if (!letter) return null;
  letter = letter.toUpperCase().trim();
  let num = 0;
  for (let i = 0; i < letter.length; i++) {
    num = num * 26 + (letter.charCodeAt(i) - 64);
  }
  return num;
};

// Convert column number to letter: 1=A, 2=B, ..., 26=Z, 27=AA
const colNumToLetter = (num) => {
  if (!num) return '';
  let letter = '';
  while (num > 0) {
    const mod = (num - 1) % 26;
    letter = String.fromCharCode(65 + mod) + letter;
    num = Math.floor((num - 1) / 26);
  }
  return letter;
};

const VendorTemplateEditor = ({ brandId, brandName, onSave, onClose }) => {
  const [templates, setTemplates] = useState([]);
  const [editing, setEditing] = useState(null); // null = list view, object = editing
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Preview state
  const [previewFile, setPreviewFile] = useState(null);
  const [previewHeaders, setPreviewHeaders] = useState([]);
  const [previewRows, setPreviewRows] = useState([]);
  const [previewSheets, setPreviewSheets] = useState([]);

  useEffect(() => {
    fetchTemplates();
  }, [brandId]);

  const fetchTemplates = async () => {
    try {
      setLoading(true);
      const res = await api.get('/revisions/templates', { params: { brandId } });
      setTemplates(res.data.templates || []);
    } catch (err) {
      // Endpoint might not exist yet, try direct query
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  };

  const newTemplate = () => ({
    brand_id: brandId,
    name: '',
    sheet_name: '',
    header_row: 1,
    data_start_row: 2,
    column_mappings: {},
    dropdown_options: {},
    fill_rules: {},
    po_pattern: '',
    location_mapping: { 'Salt Lake City': 1, 'Millcreek': 2, 'Ogden': 3 },
    notes: ''
  });

  const handlePreviewFile = (file) => {
    setPreviewFile(file);
    uploadForPreview(file);
  };

  const uploadForPreview = async (file) => {
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('brandId', brandId);
      const res = await api.post('/revisions/template-preview', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      setPreviewSheets(res.data.sheets || []);
      setPreviewHeaders(res.data.headers || []);
      setPreviewRows(res.data.sampleRows || []);

      // Auto-populate detected values into the editing form
      if (editing) {
        setEditing(prev => {
          const updated = { ...prev };

          // Only set values that aren't already configured
          if (res.data.suggestedSheet && !prev.sheet_name) {
            updated.sheet_name = res.data.suggestedSheet;
          }
          if (res.data.detectedHeaderRow && !prev.header_row) {
            updated.header_row = res.data.detectedHeaderRow;
          }
          if (res.data.detectedDataStartRow && !prev.data_start_row) {
            updated.data_start_row = res.data.detectedDataStartRow;
          }

          // Merge detected columns (don't overwrite existing mappings)
          if (res.data.detectedColumns) {
            const merged = { ...prev.column_mappings };
            for (const [field, colNum] of Object.entries(res.data.detectedColumns)) {
              if (!merged[field]) merged[field] = colNum;
            }
            updated.column_mappings = merged;
          }

          // Merge detected dropdowns
          if (res.data.detectedDropdowns) {
            const merged = { ...prev.dropdown_options };
            for (const [field, values] of Object.entries(res.data.detectedDropdowns)) {
              if (!merged[field] || merged[field].length === 0) merged[field] = values;
            }
            updated.dropdown_options = merged;
          }

          return updated;
        });
      }
    } catch (err) {
      setError('Failed to preview file: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleSave = async () => {
    if (!editing.name) {
      setError('Template name is required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (editing.id) {
        await api.put(`/revisions/templates/${editing.id}`, editing);
      } else {
        await api.post('/revisions/templates', editing);
      }
      await fetchTemplates();
      setEditing(null);
      if (onSave) onSave();
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to save template');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this template?')) return;
    try {
      await api.delete(`/revisions/templates/${id}`);
      await fetchTemplates();
    } catch (err) {
      setError('Failed to delete template');
    }
  };

  const updateColumn = (key, value) => {
    const num = value === '' ? undefined : colLetterToNum(value);
    setEditing(prev => ({
      ...prev,
      column_mappings: { ...prev.column_mappings, [key]: num }
    }));
  };

  const updateDropdown = (key, value) => {
    setEditing(prev => ({
      ...prev,
      dropdown_options: {
        ...prev.dropdown_options,
        [key]: value.split('\n').map(v => v.trim()).filter(Boolean)
      }
    }));
  };

  const updateLocationMapping = (locName, locId) => {
    setEditing(prev => ({
      ...prev,
      location_mapping: { ...prev.location_mapping, [locName]: parseInt(locId) || null }
    }));
  };

  const COLUMN_FIELDS = [
    { key: 'upc', label: 'UPC / Barcode', required: true },
    { key: 'ship_to_location', label: 'Ship-to Location' },
    { key: 'purchase_order', label: 'Purchase Order' },
    { key: 'so_number', label: 'SO Number' },
    { key: 'item_name', label: 'Product Name' },
    { key: 'color_name', label: 'Color' },
    { key: 'vpn', label: 'Vendor Product #' },
    { key: 'ordered', label: 'Qty Ordered' },
    { key: 'committed', label: 'Qty Committed' },
    { key: 'backorder', label: 'Qty Backordered' },
    { key: 'eta', label: 'ETA' },
    { key: 'quantity_adjustment', label: 'Qty Adjustment (to fill)', required: true },
    { key: 'ship_cancel', label: 'Ship/Cancel (to fill)', required: true },
  ];

  // Render
  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] flex flex-col mx-4">
        {/* Header */}
        <div className="px-6 py-4 border-b flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-lg font-bold text-gray-900">
              {editing ? (editing.id ? 'Edit Template' : 'New Template') : 'Vendor Form Templates'}
            </h2>
            <p className="text-sm text-gray-500">{brandName || `Brand ${brandId}`}</p>
          </div>
          <button onClick={editing ? () => setEditing(null) : onClose} className="text-gray-400 hover:text-gray-600">
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

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {/* List View */}
          {!editing && (
            <div className="space-y-3">
              {loading && <p className="text-center text-gray-500 py-8">Loading...</p>}

              {!loading && templates.length === 0 && (
                <div className="text-center py-8">
                  <p className="text-gray-500 mb-4">No templates configured for this brand yet.</p>
                  <p className="text-sm text-gray-400 mb-4">
                    Upload a sample spreadsheet to auto-detect columns, then map them to the right fields.
                  </p>
                </div>
              )}

              {templates.map(t => (
                <div key={t.id} className="border rounded-lg p-4 hover:bg-gray-50">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-medium text-gray-900">{t.name}</h3>
                      <p className="text-sm text-gray-500">
                        Sheet: {t.sheet_name || 'default'} | Header row: {t.header_row || 'auto'} | Data starts: {t.data_start_row}
                      </p>
                      {t.column_mappings && (
                        <p className="text-xs text-gray-400 mt-1">
                          {Object.keys(t.column_mappings).filter(k => t.column_mappings[k]).length} columns mapped
                        </p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setEditing({ ...t, column_mappings: t.column_mappings || {}, dropdown_options: t.dropdown_options || {}, fill_rules: t.fill_rules || {}, location_mapping: t.location_mapping || {} })}
                        className="px-3 py-1.5 text-sm bg-blue-50 text-blue-700 rounded hover:bg-blue-100"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(t.id)}
                        className="px-3 py-1.5 text-sm bg-red-50 text-red-700 rounded hover:bg-red-100"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}

              <button
                onClick={() => setEditing(newTemplate())}
                className="w-full border-2 border-dashed border-gray-300 rounded-lg p-4 text-gray-500 hover:border-blue-400 hover:text-blue-600"
              >
                + New Template
              </button>
            </div>
          )}

          {/* Edit View */}
          {editing && (
            <div className="space-y-6">
              {/* Basic Info */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Template Name *</label>
                  <input
                    type="text"
                    value={editing.name}
                    onChange={e => setEditing(prev => ({ ...prev, name: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                    placeholder="e.g., La Sportiva FW26 Incentive"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Sheet Name</label>
                  <input
                    type="text"
                    value={editing.sheet_name || ''}
                    onChange={e => setEditing(prev => ({ ...prev, sheet_name: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                    placeholder="e.g., REVISE HERE (blank = first sheet)"
                  />
                  {previewSheets.length > 0 && (
                    <div className="flex gap-1 mt-1">
                      {previewSheets.map(s => (
                        <button key={s} onClick={() => setEditing(prev => ({ ...prev, sheet_name: s }))}
                          className="text-xs px-2 py-0.5 bg-gray-100 text-gray-600 rounded hover:bg-blue-100">{s}</button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Header Row (1-indexed)</label>
                  <input
                    type="number" min="1"
                    value={editing.header_row || ''}
                    onChange={e => setEditing(prev => ({ ...prev, header_row: parseInt(e.target.value) || null }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Data Start Row (1-indexed)</label>
                  <input
                    type="number" min="1"
                    value={editing.data_start_row || ''}
                    onChange={e => setEditing(prev => ({ ...prev, data_start_row: parseInt(e.target.value) || 2 }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  />
                </div>
              </div>

              {/* File Preview Helper */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Upload sample file to detect columns</label>
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={e => e.target.files[0] && handlePreviewFile(e.target.files[0])}
                  className="block w-full text-sm text-gray-500 file:mr-4 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-sm file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200"
                />
              </div>

              {/* Detected Headers */}
              {previewHeaders.length > 0 && (
                <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
                  <p className="text-xs font-medium text-blue-700 mb-2">Detected columns (click to copy letter):</p>
                  <div className="flex flex-wrap gap-1">
                    {previewHeaders.map((h, i) => {
                      const letter = colNumToLetter(i + 1);
                      return (
                        <button
                          key={i}
                          onClick={() => navigator.clipboard.writeText(letter)}
                          className="text-xs px-2 py-1 bg-white border border-blue-200 rounded hover:bg-blue-100"
                          title={`Column ${letter}`}
                        >
                          <span className="font-mono text-blue-600">{letter}:</span> {h || '(empty)'}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Column Mappings */}
              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-2">Column Mappings (Excel column letters)</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {COLUMN_FIELDS.map(f => (
                    <div key={f.key}>
                      <label className="block text-xs text-gray-500 mb-1">
                        {f.label} {f.required && <span className="text-red-500">*</span>}
                      </label>
                      <input
                        type="text"
                        maxLength="3"
                        value={colNumToLetter(editing.column_mappings[f.key]) || ''}
                        onChange={e => updateColumn(f.key, e.target.value)}
                        className="w-full px-2 py-1.5 border border-gray-300 rounded-md text-sm font-mono uppercase"
                        placeholder="e.g. A, B, AA"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Dropdown Options */}
              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-2">Ship/Cancel Dropdown Values</h3>
                <p className="text-xs text-gray-400 mb-2">One option per line — these are the exact values the vendor's dropdown accepts</p>
                <textarea
                  value={(editing.dropdown_options.ship_cancel || []).join('\n')}
                  onChange={e => updateDropdown('ship_cancel', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono"
                  rows={4}
                  placeholder="Ship Product(s) ASAP&#10;Ship on Requested Ship Date&#10;Keep Open - B/O&#10;Cancel Product(s)"
                />
              </div>

              {/* Location Mapping */}
              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-2">Location Name Mapping</h3>
                <p className="text-xs text-gray-400 mb-2">Map location names in the spreadsheet to internal location IDs</p>
                <div className="space-y-2">
                  {Object.entries(editing.location_mapping || {}).map(([name, id]) => (
                    <div key={name} className="flex gap-2 items-center">
                      <input
                        type="text"
                        value={name}
                        onChange={e => {
                          const newMapping = { ...editing.location_mapping };
                          delete newMapping[name];
                          newMapping[e.target.value] = id;
                          setEditing(prev => ({ ...prev, location_mapping: newMapping }));
                        }}
                        className="flex-1 px-2 py-1.5 border border-gray-300 rounded-md text-sm"
                        placeholder="Location name in spreadsheet"
                      />
                      <span className="text-gray-400">→</span>
                      <select
                        value={id || ''}
                        onChange={e => updateLocationMapping(name, e.target.value)}
                        className="px-2 py-1.5 border border-gray-300 rounded-md text-sm"
                      >
                        <option value="">--</option>
                        <option value="1">SLC</option>
                        <option value="2">South Main</option>
                        <option value="3">Ogden</option>
                      </select>
                      <button
                        onClick={() => {
                          const newMapping = { ...editing.location_mapping };
                          delete newMapping[name];
                          setEditing(prev => ({ ...prev, location_mapping: newMapping }));
                        }}
                        className="text-red-500 hover:text-red-700 text-sm"
                      >Remove</button>
                    </div>
                  ))}
                  <button
                    onClick={() => setEditing(prev => ({
                      ...prev, location_mapping: { ...prev.location_mapping, '': null }
                    }))}
                    className="text-xs text-blue-600 hover:text-blue-800"
                  >+ Add location mapping</button>
                </div>
              </div>

              {/* PO Pattern */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">PO Number Pattern (regex, optional)</label>
                <input
                  type="text"
                  value={editing.po_pattern || ''}
                  onChange={e => setEditing(prev => ({ ...prev, po_pattern: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono"
                  placeholder="e.g., LaSportivaFW(SLC|SouthMain|Ogden)\d{4}"
                />
              </div>

              {/* Notes */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea
                  value={editing.notes || ''}
                  onChange={e => setEditing(prev => ({ ...prev, notes: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  rows={2}
                  placeholder="Any notes about this vendor's form format..."
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t flex justify-between items-center flex-shrink-0">
          <div>
            {editing && editing.id && (
              <button onClick={() => setEditing(null)} className="text-sm text-gray-500 hover:text-gray-700">
                Back to list
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={editing ? () => setEditing(null) : onClose}
              className="px-4 py-2 text-sm border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50">
              {editing ? 'Cancel' : 'Close'}
            </button>
            {editing && (
              <button onClick={handleSave} disabled={saving}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400">
                {saving ? 'Saving...' : 'Save Template'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default VendorTemplateEditor;
