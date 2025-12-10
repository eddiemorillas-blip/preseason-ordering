import { useState, useEffect } from 'react';
import api from '../services/api';
import Layout from '../components/Layout';

const SalesDataUpload = () => {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [preview, setPreview] = useState(null);
  const [uploads, setUploads] = useState([]);
  const [columnMapping, setColumnMapping] = useState({});
  const [sheets, setSheets] = useState([]);
  const [selectedSheet, setSelectedSheet] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [locations, setLocations] = useState([]);
  const [selectedLocation, setSelectedLocation] = useState('');

  // Available database fields for mapping with common variations
  const dbFields = [
    {
      key: 'upc',
      label: 'UPC (recommended)',
      required: false,
      variations: ['upc', 'upc code', 'barcode', 'product code', 'item code', 'ean', 'gtin']
    },
    {
      key: 'product',
      label: 'Product Name',
      required: false,
      variations: ['product', 'product name', 'item', 'item name', 'name', 'description', 'sku', 'style']
    },
    {
      key: 'quantity',
      label: 'Quantity *',
      required: true,
      variations: ['quantity', 'qty', 'quantity sold', 'units', 'units sold', 'amount', 'sales quantity', 'sold']
    },
    {
      key: 'location',
      label: 'Location',
      required: false,
      variations: ['location', 'store', 'site', 'shop', 'branch', 'warehouse', 'store name', 'location name']
    },
    {
      key: 'date',
      label: 'Sale Date',
      required: false,
      variations: ['date', 'sale date', 'transaction date', 'purchase date', 'order date', 'sold date', 'trans date', 'txn date', 'created', 'created at']
    }
  ];

  useEffect(() => {
    fetchUploads();
    fetchLocations();
  }, []);

  const fetchUploads = async () => {
    try {
      const response = await api.get('/sales-data/uploads');
      setUploads(response.data.uploads || []);
    } catch (err) {
      console.error('Error fetching uploads:', err);
    }
  };

  const fetchLocations = async () => {
    try {
      const response = await api.get('/locations');
      setLocations(response.data.locations || []);
    } catch (err) {
      console.error('Error fetching locations:', err);
    }
  };

  const [deleting, setDeleting] = useState(null);

  const handleDeleteUpload = async (uploadId, filename) => {
    if (!window.confirm(`Are you sure you want to delete the upload "${filename}"?\n\nThis will also delete all associated sales data records.`)) {
      return;
    }

    setDeleting(uploadId);
    setError('');

    try {
      const response = await api.delete(`/sales-data/uploads/${uploadId}`);
      setSuccess(`Upload deleted successfully. ${response.data.deletedRecords} sales records removed.`);
      fetchUploads();
    } catch (err) {
      console.error('Delete error:', err);
      setError(err.response?.data?.error || 'Failed to delete upload');
    } finally {
      setDeleting(null);
    }
  };

  const handleFileChange = async (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) {
      setFile(selectedFile);
      setError('');
      setSuccess('');
      setPreview(null);
      setSheets([]);
      setSelectedSheet('');
      setColumnMapping({});

      // Fetch sheet names immediately
      setLoading(true);
      try {
        const formData = new FormData();
        formData.append('file', selectedFile);

        const response = await api.post('/sales-data/sheets', formData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });

        setSheets(response.data.sheets || []);
        setSelectedSheet(response.data.defaultSheet || response.data.sheets[0]);
      } catch (err) {
        console.error('Error fetching sheet names:', err);
        setError('Failed to read Excel file');
      } finally {
        setLoading(false);
      }
    }
  };

  const handlePreview = async () => {
    if (!file) {
      setError('Please select a file first');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const formData = new FormData();
      formData.append('file', file);
      if (selectedSheet) {
        formData.append('sheetName', selectedSheet);
      }

      const response = await api.post('/sales-data/preview', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      setPreview(response.data);
      setSuccess(`Preview loaded: ${response.data.totalRows} rows found from sheet "${selectedSheet}"`);

      // Intelligent auto-map columns using variations
      const autoMapping = {};
      const usedColumns = new Set();

      // Normalize string for comparison
      const normalize = (str) => str.toLowerCase().trim().replace(/[_-]/g, ' ').replace(/\s+/g, ' ');

      // First pass: exact matches
      dbFields.forEach((field) => {
        response.data.headers.forEach((col) => {
          const normalizedCol = normalize(col);
          if (!usedColumns.has(col) && field.variations.includes(normalizedCol)) {
            autoMapping[field.key] = col;
            usedColumns.add(col);
          }
        });
      });

      // Second pass: partial matches for unmapped fields
      dbFields.forEach((field) => {
        if (!autoMapping[field.key]) {
          response.data.headers.forEach((col) => {
            if (!usedColumns.has(col)) {
              const normalizedCol = normalize(col);
              // Check if column contains any of the variations
              const isMatch = field.variations.some(variation =>
                normalizedCol.includes(variation) || variation.includes(normalizedCol)
              );
              if (isMatch) {
                autoMapping[field.key] = col;
                usedColumns.add(col);
              }
            }
          });
        }
      });

      setColumnMapping(autoMapping);
    } catch (err) {
      console.error('Preview error:', err);
      setError(err.response?.data?.error || 'Failed to preview file');
    } finally {
      setLoading(false);
    }
  };

  const handleColumnMappingChange = (dbField, fileColumn) => {
    setColumnMapping((prev) => ({
      ...prev,
      [dbField]: fileColumn,
    }));
  };

  // Upload result state for detailed display
  const [uploadResult, setUploadResult] = useState(null);

  const handleUpload = async () => {
    if (!file) {
      setError('Please select a file first');
      return;
    }

    // Validate date range if both are provided
    if (startDate && endDate && new Date(startDate) > new Date(endDate)) {
      setError('Start date must be before end date');
      return;
    }

    // Validate required mappings
    const requiredFields = dbFields.filter((f) => f.required);
    const missingFields = requiredFields.filter((f) => !columnMapping[f.key]);

    if (missingFields.length > 0) {
      setError(`Please map required fields: ${missingFields.map((f) => f.label).join(', ')}`);
      return;
    }

    // Ensure either UPC or Product Name is mapped (at least one is required)
    if (!columnMapping.upc && !columnMapping.product) {
      setError('Please map either UPC or Product Name (at least one is required for product matching)');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');
    setUploadResult(null);

    try {
      const formData = new FormData();
      formData.append('file', file);
      if (selectedSheet) {
        formData.append('sheetName', selectedSheet);
      }
      formData.append('columnMapping', JSON.stringify(columnMapping));
      formData.append('startDate', startDate);
      formData.append('endDate', endDate);
      if (selectedLocation) {
        formData.append('locationId', selectedLocation);
      }

      const response = await api.post('/sales-data/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      const { summary, errors, unmatchedProducts, unmatchedLocations } = response.data;

      let successMsg = `Upload complete! ${summary.recordsAdded} added, ${summary.recordsUpdated} updated`;
      if (summary.recordsFailed > 0) {
        successMsg += `, ${summary.recordsFailed} failed`;
      }
      setSuccess(successMsg);

      // Store full upload result for detailed display
      setUploadResult({ summary, errors, unmatchedProducts, unmatchedLocations });

      // Reset form
      setFile(null);
      setPreview(null);
      fetchUploads();
    } catch (err) {
      console.error('Upload error:', err);
      setError(err.response?.data?.error || 'Failed to upload file');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Sales Data Upload</h1>
          <p className="mt-2 text-sm text-gray-600">
            Upload Excel files containing historical sales data. The system will use this data to calculate sales velocity and suggest order quantities.
          </p>
        </div>

        {/* Upload Section */}
        <div className="bg-white shadow rounded-lg p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Upload Sales Data</h2>

          <div className="space-y-4">
            {/* File Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Excel File (.xlsx)
              </label>
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={handleFileChange}
                className="block w-full text-sm text-gray-500
                  file:mr-4 file:py-2 file:px-4
                  file:rounded-md file:border-0
                  file:text-sm file:font-semibold
                  file:bg-blue-50 file:text-blue-700
                  hover:file:bg-blue-100"
              />
              <p className="mt-1 text-xs text-gray-500">
                Expected columns: UPC (recommended) or Product Name, Quantity, Location (optional), Sale Date (optional - used to determine date range).
              </p>
            </div>

            {/* Sheet Selection (shown immediately when file has multiple sheets) */}
            {sheets.length > 1 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Select Sheet
                </label>
                <select
                  value={selectedSheet}
                  onChange={(e) => {
                    setSelectedSheet(e.target.value);
                    setPreview(null);
                    setColumnMapping({});
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                >
                  {sheets.map((sheet) => (
                    <option key={sheet} value={sheet}>
                      {sheet}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-gray-500">
                  This file has {sheets.length} sheets. Change selection and click "Preview File" to load the selected sheet.
                </p>
              </div>
            )}

            {/* Date Range (Optional - Override) */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Start Date Override (optional)
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Leave blank to auto-detect from Sale Date column
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  End Date Override (optional)
                </label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Leave blank to auto-detect from Sale Date column
                </p>
              </div>
            </div>

            {/* Location Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Location (optional)
              </label>
              <select
                value={selectedLocation}
                onChange={(e) => setSelectedLocation(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
              >
                <option value="">-- All Locations / From File --</option>
                {locations.map((loc) => (
                  <option key={loc.id} value={loc.id}>
                    {loc.name} ({loc.code})
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-gray-500">
                Select a location or leave blank to use location from file data
              </p>
            </div>

            {/* Preview Button */}
            <div>
              <button
                onClick={handlePreview}
                disabled={!file || loading}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 disabled:bg-gray-100 disabled:cursor-not-allowed"
              >
                Preview File
              </button>
            </div>

            {/* Messages */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-md p-4">
                <p className="text-sm text-red-800">{error}</p>
              </div>
            )}
            {success && (
              <div className="bg-green-50 border border-green-200 rounded-md p-4">
                <p className="text-sm text-green-800">{success}</p>
              </div>
            )}
          </div>
        </div>

        {/* Upload Result Details */}
        {uploadResult && (
          <div className="bg-white shadow rounded-lg p-6 space-y-4">
            <h2 className="text-lg font-semibold text-gray-900">Upload Results</h2>

            {/* Summary Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-blue-50 p-3 rounded-md">
                <div className="text-sm text-blue-600">Processed</div>
                <div className="text-xl font-bold text-blue-900">{uploadResult.summary.recordsProcessed}</div>
              </div>
              <div className="bg-green-50 p-3 rounded-md">
                <div className="text-sm text-green-600">Added</div>
                <div className="text-xl font-bold text-green-900">{uploadResult.summary.recordsAdded}</div>
              </div>
              <div className="bg-yellow-50 p-3 rounded-md">
                <div className="text-sm text-yellow-600">Updated</div>
                <div className="text-xl font-bold text-yellow-900">{uploadResult.summary.recordsUpdated}</div>
              </div>
              <div className="bg-red-50 p-3 rounded-md">
                <div className="text-sm text-red-600">Failed</div>
                <div className="text-xl font-bold text-red-900">{uploadResult.summary.recordsFailed}</div>
              </div>
            </div>

            {/* Date Range Info */}
            {uploadResult.summary.dateRange && (
              <div className="bg-purple-50 border border-purple-200 rounded-md p-4">
                <h3 className="font-medium text-purple-800 mb-1">Data Period</h3>
                <div className="text-sm text-purple-700">
                  <span className="font-semibold">
                    {new Date(uploadResult.summary.dateRange.start).toLocaleDateString()} - {new Date(uploadResult.summary.dateRange.end).toLocaleDateString()}
                  </span>
                  <span className="ml-2 text-purple-500">({uploadResult.summary.dateRange.source})</span>
                </div>
                <p className="text-xs text-purple-600 mt-1">
                  {Math.ceil((new Date(uploadResult.summary.dateRange.end) - new Date(uploadResult.summary.dateRange.start)) / (1000 * 60 * 60 * 24))} days of sales data
                </p>
              </div>
            )}

            {/* Unmatched Locations */}
            {uploadResult.unmatchedLocations && uploadResult.unmatchedLocations.length > 0 && (
              <div className="border border-orange-200 rounded-md p-4 bg-orange-50">
                <h3 className="font-medium text-orange-800 mb-2">
                  Unmatched Locations ({uploadResult.summary.uniqueUnmatchedLocations} unique)
                </h3>
                <p className="text-sm text-orange-700 mb-2">
                  These location names in your file didn't match any locations in the system.
                  Add them to the Locations list or select a location from the dropdown above.
                </p>
                <div className="flex flex-wrap gap-2">
                  {uploadResult.unmatchedLocations.map((loc, idx) => (
                    <span key={idx} className="px-2 py-1 bg-orange-100 text-orange-800 text-xs rounded">
                      "{loc.name}" ({loc.count} rows)
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Unmatched Products */}
            {uploadResult.unmatchedProducts && uploadResult.unmatchedProducts.length > 0 && (
              <div className="border border-red-200 rounded-md p-4 bg-red-50">
                <h3 className="font-medium text-red-800 mb-2">
                  Unmatched Products ({uploadResult.summary.uniqueUnmatchedProducts} unique)
                </h3>
                <p className="text-sm text-red-700 mb-2">
                  These products (by UPC or name) were not found in your catalog.
                  Upload product catalogs first to include sales data for these items.
                </p>
                <div className="max-h-64 overflow-y-auto">
                  <table className="min-w-full text-sm">
                    <thead className="sticky top-0 bg-red-100">
                      <tr className="border-b border-red-200">
                        <th className="text-left py-1 px-2 text-red-800">UPC</th>
                        <th className="text-left py-1 px-2 text-red-800">Product Name</th>
                        <th className="text-right py-1 px-2 text-red-800">Rows</th>
                        <th className="text-right py-1 px-2 text-red-800">Total Qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {uploadResult.unmatchedProducts.slice(0, 30).map((prod, idx) => (
                        <tr key={idx} className="border-b border-red-100">
                          <td className="py-1 px-2 text-red-900 font-mono text-xs">{prod.upc || '-'}</td>
                          <td className="py-1 px-2 text-red-900 text-xs max-w-xs truncate" title={prod.name}>
                            {prod.name || '-'}
                          </td>
                          <td className="py-1 px-2 text-right text-red-700">{prod.count}</td>
                          <td className="py-1 px-2 text-right text-red-700">{prod.quantity}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {uploadResult.unmatchedProducts.length > 30 && (
                    <p className="text-xs text-red-600 mt-2 text-center">
                      ... and {uploadResult.unmatchedProducts.length - 30} more
                    </p>
                  )}
                </div>
              </div>
            )}

            <button
              onClick={() => setUploadResult(null)}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Preview Section */}
        {preview && (
          <div className="bg-white shadow rounded-lg p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              File Preview ({preview.totalRows} rows)
            </h2>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    {preview.headers.map((header) => (
                      <th
                        key={header}
                        className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase"
                      >
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {preview.preview.map((row, idx) => (
                    <tr key={idx}>
                      {preview.headers.map((header) => (
                        <td key={header} className="px-4 py-2 text-sm text-gray-900">
                          {row[header]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Column Mapping */}
        {preview && (
          <div className="bg-white shadow rounded-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-gray-700">
                Map File Columns to Database Fields
              </h3>
              <div className="flex items-center space-x-4 text-xs">
                <div className="flex items-center">
                  <div className="w-3 h-3 bg-green-500 rounded-full mr-1"></div>
                  <span className="text-gray-600">Auto-mapped</span>
                </div>
                <div className="flex items-center">
                  <div className="w-3 h-3 bg-red-500 rounded-full mr-1"></div>
                  <span className="text-gray-600">Required</span>
                </div>
              </div>
            </div>

            {/* Mapping Status Summary */}
            <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-md">
              <div className="flex items-start">
                <svg className="h-5 w-5 text-blue-400 mr-2 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
                <div className="text-sm text-blue-800">
                  <p className="font-medium mb-1">Auto-mapping complete!</p>
                  <p>
                    Mapped {Object.keys(columnMapping).length} of {dbFields.length} fields.
                    {dbFields.filter(f => f.required && !columnMapping[f.key]).length > 0 && (
                      <span className="text-red-600 font-medium">
                        {' '}Please map {dbFields.filter(f => f.required && !columnMapping[f.key]).length} required field(s).
                      </span>
                    )}
                    {' '}Review and adjust mappings below before uploading.
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {dbFields.map((field) => {
                const isMapped = !!columnMapping[field.key];
                const isRequired = field.required;
                const needsAttention = isRequired && !isMapped;

                return (
                  <div key={field.key} className="relative">
                    <label className="flex items-center text-sm text-gray-700 mb-1">
                      {field.label}
                      {isMapped && (
                        <svg className="ml-2 h-4 w-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                      )}
                    </label>
                    <select
                      value={columnMapping[field.key] || ''}
                      onChange={(e) => handleColumnMappingChange(field.key, e.target.value)}
                      className={`w-full px-3 py-2 border rounded-md focus:ring-2 focus:ring-blue-500 text-sm ${
                        needsAttention
                          ? 'border-red-300 bg-red-50'
                          : isMapped
                          ? 'border-green-300 bg-green-50'
                          : 'border-gray-300'
                      }`}
                      disabled={loading}
                    >
                      <option value="">-- Select Column --</option>
                      {preview.headers.map((col, idx) => (
                        <option key={idx} value={col}>
                          {col}
                        </option>
                      ))}
                    </select>
                    {needsAttention && (
                      <p className="mt-1 text-xs text-red-600">Required field not mapped</p>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Upload Button */}
            <div className="flex justify-end mt-6">
              <button
                onClick={handleUpload}
                disabled={
                  loading ||
                  dbFields.filter(f => f.required && !columnMapping[f.key]).length > 0
                }
                className={`px-6 py-3 rounded-md font-medium ${
                  loading ||
                  dbFields.filter(f => f.required && !columnMapping[f.key]).length > 0
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    : 'bg-blue-600 text-white hover:bg-blue-700'
                }`}
              >
                {loading ? 'Uploading...' : 'Upload Sales Data'}
              </button>
            </div>
          </div>
        )}

        {/* Upload History */}
        <div className="bg-white shadow rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Upload History</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    File
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Date Range
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Location
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Records
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Uploaded
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {uploads.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-4 text-center text-sm text-gray-500">
                      No uploads yet
                    </td>
                  </tr>
                ) : (
                  uploads.map((upload) => (
                    <tr key={upload.id}>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {upload.filename}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {new Date(upload.start_date).toLocaleDateString()} - {new Date(upload.end_date).toLocaleDateString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {upload.location_name || 'All/Multiple'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        <div className="text-xs">
                          <div>Added: {upload.records_added}</div>
                          <div>Updated: {upload.records_updated}</div>
                          {upload.records_failed > 0 && (
                            <div className="text-red-600">Failed: {upload.records_failed}</div>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                          upload.status === 'completed'
                            ? 'bg-green-100 text-green-800'
                            : 'bg-yellow-100 text-yellow-800'
                        }`}>
                          {upload.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        <div>{new Date(upload.created_at).toLocaleDateString()}</div>
                        <div className="text-xs text-gray-400">{upload.uploaded_by_email}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <button
                          onClick={() => handleDeleteUpload(upload.id, upload.filename)}
                          disabled={deleting === upload.id}
                          className="text-red-600 hover:text-red-800 disabled:text-gray-400 disabled:cursor-not-allowed"
                        >
                          {deleting === upload.id ? 'Deleting...' : 'Delete'}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default SalesDataUpload;
