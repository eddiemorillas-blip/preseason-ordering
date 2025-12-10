import { useState, useRef } from 'react';
import { brandTemplateAPI } from '../services/api';

const TemplateUploadModal = ({ brandId, brandName, onClose, onSuccess, existingTemplate = null }) => {
  const [step, setStep] = useState(1);
  const [file, setFile] = useState(null);
  const [previewData, setPreviewData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Form state
  const [name, setName] = useState(existingTemplate?.name || '');
  const [description, setDescription] = useState(existingTemplate?.description || '');
  const [dataStartRow, setDataStartRow] = useState(existingTemplate?.data_start_row || 2);
  const [columnMappings, setColumnMappings] = useState(existingTemplate?.column_mappings || {});
  const [selectedSheet, setSelectedSheet] = useState(existingTemplate?.sheet_name || '');
  const [shipDateColumns, setShipDateColumns] = useState(existingTemplate?.ship_date_columns || {});

  const fileInputRef = useRef(null);

  const handleFileSelect = async (e) => {
    const selectedFile = e.target.files[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    setError('');
    setLoading(true);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);

      const response = await brandTemplateAPI.preview(formData);
      setPreviewData(response.data);
      if (response.data.sheetNames.length > 0 && !selectedSheet) {
        setSelectedSheet(response.data.sheetNames[0]);
      }
      setStep(2);
    } catch (err) {
      console.error('Error previewing file:', err);
      setError(err.response?.data?.error || 'Failed to preview file');
      setFile(null);
    } finally {
      setLoading(false);
    }
  };

  const handleMappingChange = (fieldKey, columnLetter) => {
    if (columnLetter === '') {
      // Remove mapping
      const newMappings = { ...columnMappings };
      delete newMappings[fieldKey];
      setColumnMappings(newMappings);
    } else {
      setColumnMappings({ ...columnMappings, [fieldKey]: columnLetter });
    }
  };

  const handleShipDateColumnChange = (columnLetter, date) => {
    if (date === '') {
      const newCols = { ...shipDateColumns };
      delete newCols[columnLetter];
      setShipDateColumns(newCols);
    } else {
      setShipDateColumns({ ...shipDateColumns, [columnLetter]: date });
    }
  };

  const addShipDateColumn = () => {
    // Find the first unmapped column
    const mappedCols = Object.keys(shipDateColumns);
    const availableCol = previewData?.columns.find(c => !mappedCols.includes(c));
    if (availableCol) {
      setShipDateColumns({ ...shipDateColumns, [availableCol]: '' });
    }
  };

  const removeShipDateColumn = (columnLetter) => {
    const newCols = { ...shipDateColumns };
    delete newCols[columnLetter];
    setShipDateColumns(newCols);
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Template name is required');
      return;
    }

    if (Object.keys(columnMappings).length === 0) {
      setError('At least one column mapping is required');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const formData = new FormData();
      if (file) {
        formData.append('file', file);
      }
      formData.append('brandId', brandId);
      formData.append('name', name.trim());
      formData.append('description', description.trim());
      formData.append('dataStartRow', dataStartRow);
      formData.append('columnMappings', JSON.stringify(columnMappings));
      formData.append('shipDateColumns', JSON.stringify(shipDateColumns));
      if (selectedSheet) {
        formData.append('sheetName', selectedSheet);
      }

      if (existingTemplate) {
        await brandTemplateAPI.update(existingTemplate.id, formData);
      } else {
        await brandTemplateAPI.create(formData);
      }

      onSuccess();
    } catch (err) {
      console.error('Error saving template:', err);
      setError(err.response?.data?.error || 'Failed to save template');
    } finally {
      setLoading(false);
    }
  };

  const renderStep1 = () => (
    <div className="space-y-4">
      <div className="text-center">
        <div
          className="border-2 border-dashed border-gray-300 rounded-lg p-8 cursor-pointer hover:border-blue-400 transition-colors"
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="text-gray-400 mb-2">
            <svg className="mx-auto h-12 w-12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
          </div>
          <p className="text-gray-600">Click to upload Excel template</p>
          <p className="text-sm text-gray-400 mt-1">Supports .xlsx and .xls files</p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls"
          onChange={handleFileSelect}
          className="hidden"
        />
      </div>

      {file && (
        <div className="flex items-center justify-between bg-gray-50 p-3 rounded">
          <span className="text-sm text-gray-600">{file.name}</span>
          <button
            onClick={() => { setFile(null); setPreviewData(null); }}
            className="text-red-500 hover:text-red-700"
          >
            Remove
          </button>
        </div>
      )}
    </div>
  );

  const renderStep2 = () => (
    <div className="space-y-4">
      <div className="flex gap-4">
        <div className="flex-1">
          <label className="block text-sm font-medium text-gray-700 mb-1">Data Start Row</label>
          <input
            type="number"
            min="1"
            max={previewData?.totalRows || 100}
            value={dataStartRow}
            onChange={(e) => setDataStartRow(parseInt(e.target.value) || 2)}
            className="w-full border border-gray-300 rounded px-3 py-2"
          />
          <p className="text-xs text-gray-500 mt-1">Row where data should begin (rows above are preserved as headers)</p>
        </div>

        {previewData?.sheetNames.length > 1 && (
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-700 mb-1">Sheet</label>
            <select
              value={selectedSheet}
              onChange={(e) => setSelectedSheet(e.target.value)}
              className="w-full border border-gray-300 rounded px-3 py-2"
            >
              {previewData.sheetNames.map(sheet => (
                <option key={sheet} value={sheet}>{sheet}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Preview (First 10 rows)</label>
        <div className="overflow-x-auto border border-gray-200 rounded max-h-64">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 sticky top-0">
              <tr>
                <th className="px-2 py-1 text-left text-xs font-medium text-gray-500">Row</th>
                {previewData?.columns.map(col => (
                  <th key={col} className="px-2 py-1 text-left text-xs font-medium text-gray-500">{col}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {previewData?.previewRows.map((row, idx) => (
                <tr key={idx} className={idx + 1 === dataStartRow - 1 ? 'bg-yellow-50' : ''}>
                  <td className="px-2 py-1 text-gray-400">{idx + 1}</td>
                  {previewData.columns.map(col => (
                    <td key={col} className="px-2 py-1 truncate max-w-[150px]" title={String(row[col] || '')}>
                      {row[col] || ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-500 mt-1">Yellow row = last header row (row {dataStartRow - 1})</p>
      </div>

      <button
        onClick={() => setStep(3)}
        className="w-full bg-blue-600 text-white py-2 rounded hover:bg-blue-700"
      >
        Next: Map Columns
      </button>
    </div>
  );

  const renderStep3 = () => (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Column Mappings</label>
        <p className="text-xs text-gray-500 mb-3">Map Excel columns to data fields. Header values from row {dataStartRow - 1} shown for reference.</p>

        <div className="space-y-2 max-h-64 overflow-y-auto">
          {previewData?.availableFields.map(field => {
            const headerRow = previewData.previewRows[dataStartRow - 2] || previewData.previewRows[0] || {};
            const currentMapping = Object.entries(columnMappings).find(([k, v]) => k === field.key)?.[1];

            return (
              <div key={field.key} className="flex items-center gap-3 p-2 bg-gray-50 rounded">
                <span className="w-32 text-sm font-medium text-gray-700">{field.label}</span>
                <select
                  value={currentMapping || ''}
                  onChange={(e) => handleMappingChange(field.key, e.target.value)}
                  className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm"
                >
                  <option value="">-- Not mapped --</option>
                  {previewData.columns.map(col => (
                    <option key={col} value={col}>
                      {col} {headerRow[col] ? `(${headerRow[col]})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>

        <div className="mt-3 p-2 bg-blue-50 rounded">
          <p className="text-xs text-blue-700">
            <strong>Mapped fields:</strong> {Object.keys(columnMappings).length > 0
              ? Object.entries(columnMappings).map(([k, v]) => `${k}→${v}`).join(', ')
              : 'None'}
          </p>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => setStep(2)}
          className="flex-1 bg-gray-100 text-gray-700 py-2 rounded hover:bg-gray-200"
        >
          Back
        </button>
        <button
          onClick={() => setStep(4)}
          disabled={Object.keys(columnMappings).length === 0}
          className="flex-1 bg-blue-600 text-white py-2 rounded hover:bg-blue-700 disabled:bg-gray-300"
        >
          Next: Ship Date Columns
        </button>
      </div>
    </div>
  );

  const renderStep4 = () => {
    const headerRow = previewData?.previewRows[dataStartRow - 2] || previewData?.previewRows[0] || {};
    const shipOptions = ['ship_1', 'ship_2', 'ship_3', 'ship_4', 'ship_5', 'ship_6'];
    const shipLabels = {
      'ship_1': 'Ship 1',
      'ship_2': 'Ship 2',
      'ship_3': 'Ship 3',
      'ship_4': 'Ship 4',
      'ship_5': 'Ship 5',
      'ship_6': 'Ship 6'
    };

    return (
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Ship Window Quantity Columns</label>
          <p className="text-xs text-gray-500 mb-3">
            If this template has multiple quantity columns for different ship windows, map each column to a ship number.
            Orders are assigned to ship windows chronologically (earliest ship date = Ship 1, etc.).
          </p>

          <div className="space-y-2 max-h-48 overflow-y-auto">
            {Object.entries(shipDateColumns).map(([col, shipNum]) => (
              <div key={col} className="flex items-center gap-2 p-2 bg-gray-50 rounded">
                <select
                  value={col}
                  onChange={(e) => {
                    const newCols = { ...shipDateColumns };
                    delete newCols[col];
                    newCols[e.target.value] = shipNum;
                    setShipDateColumns(newCols);
                  }}
                  className="border border-gray-300 rounded px-2 py-1 text-sm"
                >
                  {previewData?.columns.map(c => {
                    // Only disable if this column is already used in another ship date row
                    const usedByOther = Object.keys(shipDateColumns).includes(c) && c !== col;
                    return (
                      <option key={c} value={c} disabled={usedByOther}>
                        {c} {headerRow[c] ? `(${headerRow[c]})` : ''}
                      </option>
                    );
                  })}
                </select>
                <span className="text-gray-500">=</span>
                <select
                  value={shipNum}
                  onChange={(e) => handleShipDateColumnChange(col, e.target.value)}
                  className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm"
                >
                  <option value="">-- Select Ship --</option>
                  {shipOptions.map(opt => (
                    <option key={opt} value={opt} disabled={Object.values(shipDateColumns).includes(opt) && shipDateColumns[col] !== opt}>
                      {shipLabels[opt]}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => removeShipDateColumn(col)}
                  className="text-red-500 hover:text-red-700 p-1"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>

          <button
            onClick={addShipDateColumn}
            className="mt-2 text-sm text-blue-600 hover:text-blue-700"
          >
            + Add Ship Column
          </button>

          {Object.keys(shipDateColumns).length > 0 && (
            <div className="mt-3 p-2 bg-blue-50 rounded">
              <p className="text-xs text-blue-700">
                <strong>Mapped:</strong> {Object.entries(shipDateColumns)
                  .filter(([, s]) => s)
                  .map(([col, s]) => `${col}=${shipLabels[s] || s}`)
                  .join(', ') || 'None complete'}
              </p>
            </div>
          )}

          <div className="mt-3 p-2 bg-yellow-50 rounded">
            <p className="text-xs text-yellow-700">
              <strong>Note:</strong> If you don't use ship columns, leave this section empty.
              The regular "Quantity" field mapping will be used instead.
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setStep(3)}
            className="flex-1 bg-gray-100 text-gray-700 py-2 rounded hover:bg-gray-200"
          >
            Back
          </button>
          <button
            onClick={() => setStep(5)}
            className="flex-1 bg-blue-600 text-white py-2 rounded hover:bg-blue-700"
          >
            Next: Save Template
          </button>
        </div>
      </div>
    );
  };

  const renderStep5 = () => (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Template Name *</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g., Standard Order Form"
          className="w-full border border-gray-300 rounded px-3 py-2"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional description..."
          rows={2}
          className="w-full border border-gray-300 rounded px-3 py-2"
        />
      </div>

      <div className="bg-gray-50 p-3 rounded text-sm">
        <p><strong>Brand:</strong> {brandName}</p>
        <p><strong>File:</strong> {file?.name || existingTemplate?.original_filename}</p>
        <p><strong>Data starts at row:</strong> {dataStartRow}</p>
        <p><strong>Mapped columns:</strong> {Object.keys(columnMappings).length}</p>
        <p><strong>Ship columns:</strong> {Object.keys(shipDateColumns).length > 0
          ? Object.entries(shipDateColumns).filter(([,s]) => s).map(([col, s]) => `${col}=${s.replace('ship_', 'Ship ')}`).join(', ')
          : 'None (using regular quantity)'}</p>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => setStep(4)}
          className="flex-1 bg-gray-100 text-gray-700 py-2 rounded hover:bg-gray-200"
        >
          Back
        </button>
        <button
          onClick={handleSave}
          disabled={loading || !name.trim()}
          className="flex-1 bg-green-600 text-white py-2 rounded hover:bg-green-700 disabled:bg-gray-300"
        >
          {loading ? 'Saving...' : (existingTemplate ? 'Update Template' : 'Save Template')}
        </button>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-hidden">
        <div className="flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold">
            {existingTemplate ? 'Edit Template' : 'Add Order Form Template'}
            <span className="text-sm font-normal text-gray-500 ml-2">for {brandName}</span>
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Step indicator */}
        <div className="px-4 py-2 bg-gray-50 border-b">
          <div className="flex items-center justify-between text-xs">
            {['Upload', 'Configure', 'Map Fields', 'Ship Dates', 'Save'].map((label, idx) => (
              <div key={idx} className="flex items-center">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${
                  step > idx + 1 ? 'bg-green-500 text-white' :
                  step === idx + 1 ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-500'
                }`}>
                  {step > idx + 1 ? '✓' : idx + 1}
                </div>
                <span className={`ml-1 hidden sm:inline ${step === idx + 1 ? 'font-medium' : 'text-gray-500'}`}>{label}</span>
                {idx < 4 && <div className="w-4 sm:w-6 h-0.5 mx-1 bg-gray-200" />}
              </div>
            ))}
          </div>
        </div>

        <div className="p-4 overflow-y-auto max-h-[60vh]">
          {error && (
            <div className="mb-4 p-3 bg-red-50 text-red-700 rounded text-sm">
              {error}
            </div>
          )}

          {loading && step === 1 && (
            <div className="text-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
              <p className="mt-2 text-gray-500">Processing file...</p>
            </div>
          )}

          {!loading && step === 1 && renderStep1()}
          {step === 2 && renderStep2()}
          {step === 3 && renderStep3()}
          {step === 4 && renderStep4()}
          {step === 5 && renderStep5()}
        </div>
      </div>
    </div>
  );
};

export default TemplateUploadModal;
