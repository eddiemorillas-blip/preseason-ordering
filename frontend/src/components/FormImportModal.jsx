import { useState, useRef } from 'react';
import { formAPI, formTemplateAPI } from '../services/api';

const FormImportModal = ({ brandId, seasonId, onClose, onSuccess }) => {
  const [step, setStep] = useState(1); // 1: upload, 2: preview/confirm, 3: create template
  const [file, setFile] = useState(null);
  const [uploadedFilePath, setUploadedFilePath] = useState(null);
  const [originalFilename, setOriginalFilename] = useState('');
  const [previewData, setPreviewData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');

  // Template creation state (if no template exists)
  const [templateName, setTemplateName] = useState('');
  const [selectedSheet, setSelectedSheet] = useState('');
  const [headerRow, setHeaderRow] = useState(0);
  const [dataStartRow, setDataStartRow] = useState(1);
  const [productIdColumn, setProductIdColumn] = useState('');
  const [productIdType, setProductIdType] = useState('upc');
  const [quantityColumns, setQuantityColumns] = useState([]);

  const fileInputRef = useRef(null);

  const handleFileSelect = async (e) => {
    const selectedFile = e.target.files[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    setError('');
    setLoading(true);
    setProgress('Uploading and analyzing file...');

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('brandId', brandId);
      formData.append('seasonId', seasonId);

      const response = await formAPI.upload(formData);
      const data = response.data;

      setPreviewData(data);
      setUploadedFilePath(data.uploadedFilePath);
      setOriginalFilename(data.originalFilename);

      if (data.hasTemplate) {
        // Template exists - show preview and proceed to import
        setProgress(`Found ${data.matchedCount} of ${data.totalRows} products`);
        setStep(2);
      } else {
        // No template - need to create one
        setProgress('No template found. Please configure column mappings.');
        if (data.sheetNames.length > 0) {
          setSelectedSheet(data.sheetNames[0]);
        }
        setStep(3);
      }
    } catch (err) {
      console.error('Error uploading file:', err);
      setError(err.response?.data?.error || 'Failed to upload file');
      setFile(null);
    } finally {
      setLoading(false);
    }
  };

  const handleImportWithTemplate = async () => {
    setLoading(true);
    setError('');
    setProgress('Importing form...');

    try {
      await formAPI.import({
        uploadedFilePath,
        originalFilename,
        templateId: previewData.template.id,
        brandId,
        seasonId
      });

      setProgress('Import complete!');
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1000);
    } catch (err) {
      console.error('Error importing form:', err);
      setError(err.response?.data?.error || 'Failed to import form');
      setLoading(false);
    }
  };

  const handleAddQuantityColumn = () => {
    setQuantityColumns([
      ...quantityColumns,
      {
        column_letter: '',
        column_name: '',
        ship_date: '',
        is_editable: true,
        column_order: quantityColumns.length
      }
    ]);
  };

  const handleRemoveQuantityColumn = (index) => {
    setQuantityColumns(quantityColumns.filter((_, i) => i !== index));
  };

  const handleQuantityColumnChange = (index, field, value) => {
    const updated = [...quantityColumns];
    updated[index][field] = value;
    setQuantityColumns(updated);
  };

  const handleCreateTemplateAndImport = async () => {
    // Validation
    if (!templateName.trim()) {
      setError('Template name is required');
      return;
    }
    if (!productIdColumn.trim()) {
      setError('Product ID column is required');
      return;
    }
    if (quantityColumns.length === 0) {
      setError('At least one quantity column is required');
      return;
    }

    // Validate quantity columns
    for (let i = 0; i < quantityColumns.length; i++) {
      const col = quantityColumns[i];
      if (!col.column_letter.trim()) {
        setError(`Quantity column ${i + 1}: Column letter is required`);
        return;
      }
      if (!col.ship_date) {
        setError(`Quantity column ${i + 1}: Ship date is required`);
        return;
      }
    }

    setLoading(true);
    setError('');
    setProgress('Creating template...');

    try {
      // Create template
      const templateResponse = await formTemplateAPI.create({
        brand_id: brandId,
        name: templateName,
        sheet_name: selectedSheet || null,
        header_row: headerRow,
        data_start_row: dataStartRow,
        product_id_column: productIdColumn,
        product_id_type: productIdType,
        quantity_columns: quantityColumns
      });

      const newTemplateId = templateResponse.data.template.id;

      setProgress('Template created. Importing form...');

      // Import form with new template
      await formAPI.import({
        uploadedFilePath,
        originalFilename,
        templateId: newTemplateId,
        brandId,
        seasonId
      });

      setProgress('Import complete!');
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1000);
    } catch (err) {
      console.error('Error creating template and importing:', err);
      setError(err.response?.data?.error || 'Failed to create template and import form');
      setLoading(false);
    }
  };

  const renderStepIndicator = () => (
    <div className="flex items-center justify-center mb-6">
      <div className={`flex items-center ${step >= 1 ? 'text-blue-600' : 'text-gray-400'}`}>
        <div className="rounded-full h-8 w-8 flex items-center justify-center border-2 border-current">
          1
        </div>
        <span className="ml-2 font-medium">Upload</span>
      </div>
      <div className="w-12 h-0.5 mx-2 bg-gray-300" />
      <div className={`flex items-center ${step >= 2 ? 'text-blue-600' : 'text-gray-400'}`}>
        <div className="rounded-full h-8 w-8 flex items-center justify-center border-2 border-current">
          2
        </div>
        <span className="ml-2 font-medium">{step === 3 ? 'Configure' : 'Preview'}</span>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          {/* Header */}
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-2xl font-bold text-gray-900">Import Brand Form</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 text-2xl"
              disabled={loading}
            >
              ×
            </button>
          </div>

          {renderStepIndicator()}

          {/* Error message */}
          {error && (
            <div className="mb-4 p-3 bg-red-100 border border-red-300 text-red-700 rounded">
              {error}
            </div>
          )}

          {/* Progress message */}
          {progress && !error && (
            <div className="mb-4 p-3 bg-blue-100 border border-blue-300 text-blue-700 rounded">
              {progress}
            </div>
          )}

          {/* Step 1: Upload */}
          {step === 1 && (
            <div>
              <p className="text-gray-600 mb-4">
                Upload an Excel file from the brand. If a template exists for this brand, it will be used automatically.
              </p>
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleFileSelect}
                  className="hidden"
                  disabled={loading}
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={loading}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400"
                >
                  {loading ? 'Processing...' : 'Choose Excel File'}
                </button>
                {file && (
                  <p className="mt-4 text-sm text-gray-600">Selected: {file.name}</p>
                )}
              </div>
            </div>
          )}

          {/* Step 2: Preview and Confirm (when template exists) */}
          {step === 2 && previewData && (
            <div>
              <div className="mb-4">
                <p className="text-sm text-gray-600">
                  <strong>Template:</strong> {previewData.template.name}
                </p>
                <p className="text-sm text-gray-600">
                  <strong>Matched:</strong> {previewData.matchedCount} of {previewData.totalRows} products
                </p>
              </div>

              {/* Preview table */}
              <div className="border rounded overflow-x-auto mb-4 max-h-96">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Row</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Product ID</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Match</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Product Name</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {previewData.preview.map((row, idx) => (
                      <tr key={idx} className={row.matched ? '' : 'bg-yellow-50'}>
                        <td className="px-4 py-2 text-sm">{row.rowNumber + 1}</td>
                        <td className="px-4 py-2 text-sm font-mono">{row.productId}</td>
                        <td className="px-4 py-2 text-sm">
                          {row.matched ? (
                            <span className="text-green-600">✓</span>
                          ) : (
                            <span className="text-yellow-600">✗</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-sm">
                          {row.product ? (
                            <span>{row.product.name} {row.product.size && `- ${row.product.size}`}</span>
                          ) : (
                            <span className="text-gray-400 italic">Not found</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {previewData.matchedCount < previewData.totalRows && (
                <div className="mb-4 p-3 bg-yellow-100 border border-yellow-300 text-yellow-800 rounded text-sm">
                  Some products could not be matched. Only matched products will be imported.
                </div>
              )}

              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setStep(1)}
                  disabled={loading}
                  className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50 disabled:bg-gray-100"
                >
                  Back
                </button>
                <button
                  onClick={handleImportWithTemplate}
                  disabled={loading || previewData.matchedCount === 0}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400"
                >
                  {loading ? 'Importing...' : 'Confirm Import'}
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Configure Template (when no template exists) */}
          {step === 3 && previewData && (
            <div>
              <p className="text-gray-600 mb-4">
                Configure how to read this Excel file. This template will be saved for future imports.
              </p>

              <div className="space-y-4">
                {/* Template name */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Template Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={templateName}
                    onChange={(e) => setTemplateName(e.target.value)}
                    placeholder="e.g., Petzl Preseason Form"
                    className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* Sheet selection */}
                {previewData.sheetNames && previewData.sheetNames.length > 1 && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Sheet Name
                    </label>
                    <select
                      value={selectedSheet}
                      onChange={(e) => setSelectedSheet(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {previewData.sheetNames.map((sheet) => (
                        <option key={sheet} value={sheet}>{sheet}</option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Row numbers */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Header Row (0-indexed)
                    </label>
                    <input
                      type="number"
                      value={headerRow}
                      onChange={(e) => setHeaderRow(parseInt(e.target.value))}
                      min="0"
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Data Start Row (0-indexed)
                    </label>
                    <input
                      type="number"
                      value={dataStartRow}
                      onChange={(e) => setDataStartRow(parseInt(e.target.value))}
                      min="0"
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                {/* Product ID column */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Product ID Column <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={productIdColumn}
                      onChange={(e) => setProductIdColumn(e.target.value.toUpperCase())}
                      placeholder="e.g., A, B, C"
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Product ID Type <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={productIdType}
                      onChange={(e) => setProductIdType(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="upc">UPC</option>
                      <option value="ean">EAN</option>
                      <option value="sku">SKU</option>
                    </select>
                  </div>
                </div>

                {/* Quantity columns */}
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="block text-sm font-medium text-gray-700">
                      Quantity Columns <span className="text-red-500">*</span>
                    </label>
                    <button
                      onClick={handleAddQuantityColumn}
                      className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700"
                    >
                      + Add Column
                    </button>
                  </div>

                  {quantityColumns.length === 0 && (
                    <p className="text-sm text-gray-500 italic mb-2">No quantity columns defined yet</p>
                  )}

                  <div className="space-y-2">
                    {quantityColumns.map((col, idx) => (
                      <div key={idx} className="flex gap-2 items-start p-3 bg-gray-50 rounded border border-gray-200">
                        <div className="flex-1 grid grid-cols-3 gap-2">
                          <div>
                            <label className="block text-xs text-gray-600 mb-1">Column Letter</label>
                            <input
                              type="text"
                              value={col.column_letter}
                              onChange={(e) => handleQuantityColumnChange(idx, 'column_letter', e.target.value.toUpperCase())}
                              placeholder="e.g., L"
                              className="w-full px-2 py-1 text-sm border border-gray-300 rounded"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-600 mb-1">Column Name</label>
                            <input
                              type="text"
                              value={col.column_name}
                              onChange={(e) => handleQuantityColumnChange(idx, 'column_name', e.target.value)}
                              placeholder="e.g., Jan Ship"
                              className="w-full px-2 py-1 text-sm border border-gray-300 rounded"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-600 mb-1">Ship Date</label>
                            <input
                              type="date"
                              value={col.ship_date}
                              onChange={(e) => handleQuantityColumnChange(idx, 'ship_date', e.target.value)}
                              className="w-full px-2 py-1 text-sm border border-gray-300 rounded"
                            />
                          </div>
                        </div>
                        <button
                          onClick={() => handleRemoveQuantityColumn(idx)}
                          className="mt-5 px-2 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-3 mt-6">
                <button
                  onClick={() => setStep(1)}
                  disabled={loading}
                  className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50 disabled:bg-gray-100"
                >
                  Back
                </button>
                <button
                  onClick={handleCreateTemplateAndImport}
                  disabled={loading}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400"
                >
                  {loading ? 'Creating...' : 'Create Template & Import'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default FormImportModal;
