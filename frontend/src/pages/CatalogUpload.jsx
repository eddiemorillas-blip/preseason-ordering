import { useState, useEffect, useCallback } from 'react';
import { catalogAPI, brandAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import Layout from '../components/Layout';

const CatalogUpload = () => {
  const { isAdmin } = useAuth();
  const [brands, setBrands] = useState([]);
  const [selectedBrand, setSelectedBrand] = useState('');
  const [brandName, setBrandName] = useState('');
  const [useExistingBrand, setUseExistingBrand] = useState(true);
  const [file, setFile] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [preview, setPreview] = useState(null);
  const [columnMapping, setColumnMapping] = useState({});
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadResult, setUploadResult] = useState(null);
  const [uploadHistory, setUploadHistory] = useState([]);
  const [error, setError] = useState('');

  // Available database fields for mapping with common variations
  const dbFields = [
    {
      key: 'upc',
      label: 'UPC *',
      required: true,
      variations: ['upc', 'upc code', 'barcode', 'ean', 'gtin', 'product code', 'item code']
    },
    {
      key: 'sku',
      label: 'SKU / Product Number *',
      required: true,
      variations: ['sku', 'item number', 'item #', 'style', 'style number', 'model', 'model number', 'part number', 'vendor sku', 'product number', 'product #']
    },
    {
      key: 'name',
      label: 'Product Name *',
      required: true,
      variations: ['name', 'product name', 'product', 'item name', 'item', 'title', 'description', 'product description']
    },
    {
      key: 'size',
      label: 'Size *',
      required: true,
      variations: ['size', 'sizing', 'dimension', 'dimensions']
    },
    {
      key: 'color',
      label: 'Color *',
      required: true,
      variations: ['color', 'colour', 'colorway', 'color name']
    },
    {
      key: 'gender',
      label: 'Gender *',
      required: true,
      variations: ['gender', 'sex', 'mens', 'womens', 'unisex', 'male', 'female']
    },
    {
      key: 'category',
      label: 'Category *',
      required: true,
      variations: ['category', 'product category', 'type', 'product type', 'department', 'class']
    },
    {
      key: 'wholesale_cost',
      label: 'Wholesale Cost',
      required: false,
      variations: ['wholesale cost', 'wholesale', 'wholesale price', 'cost', 'dealer price', 'dealer cost', 'buy price', 'purchase price', 'net price']
    },
    {
      key: 'msrp',
      label: 'MSRP',
      required: false,
      variations: ['msrp', 'retail', 'retail price', 'list price', 'suggested retail', 'srp', 'rrp']
    },
    {
      key: 'subcategory',
      label: 'Subcategory',
      required: false,
      variations: ['subcategory', 'sub category', 'sub-category', 'subclass', 'sub class']
    },
  ];

  useEffect(() => {
    fetchBrands();
    fetchUploadHistory();
  }, []);

  const fetchBrands = async () => {
    try {
      const response = await brandAPI.getAll();
      setBrands(response.data.brands || []);
    } catch (err) {
      console.error('Error fetching brands:', err);
    }
  };

  const fetchUploadHistory = async () => {
    try {
      const response = await catalogAPI.getUploads();
      setUploadHistory(response.data.uploads || []);
    } catch (err) {
      console.error('Error fetching upload history:', err);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);

    const droppedFile = e.dataTransfer.files[0];
    handleFileSelect(droppedFile);
  };

  const handleFileInput = (e) => {
    const selectedFile = e.target.files[0];
    handleFileSelect(selectedFile);
  };

  const handleFileSelect = async (selectedFile) => {
    if (!selectedFile) return;

    // Validate file type
    const validTypes = ['.csv', '.xlsx', '.xls'];
    const fileExt = selectedFile.name.substring(selectedFile.name.lastIndexOf('.')).toLowerCase();

    if (!validTypes.includes(fileExt)) {
      setError('Invalid file type. Please upload a CSV or Excel file.');
      return;
    }

    setFile(selectedFile);
    setError('');
    setUploadResult(null);

    // Preview file
    try {
      const formData = new FormData();
      formData.append('file', selectedFile);

      const response = await catalogAPI.preview(formData);
      setPreview(response.data);

      // Intelligent auto-map columns using variations
      const autoMapping = {};
      const usedColumns = new Set();

      // Normalize string for comparison
      const normalize = (str) => str.toLowerCase().trim().replace(/[_-]/g, ' ').replace(/\s+/g, ' ');

      // First pass: exact matches
      dbFields.forEach((field) => {
        response.data.columns.forEach((col) => {
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
          response.data.columns.forEach((col) => {
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
      console.error('Error previewing file:', err);
      setError(err.response?.data?.error || 'Failed to preview file');
    }
  };

  const handleUpload = async () => {
    if (!file) {
      setError('Please select a file');
      return;
    }

    if (useExistingBrand && !selectedBrand) {
      setError('Please select a brand');
      return;
    }

    if (!useExistingBrand && !brandName.trim()) {
      setError('Please enter a brand name');
      return;
    }

    // Validate required mappings
    const requiredFields = dbFields.filter((f) => f.required);
    const missingFields = requiredFields.filter((f) => !columnMapping[f.key]);

    if (missingFields.length > 0) {
      setError(`Please map required fields: ${missingFields.map((f) => f.label).join(', ')}`);
      return;
    }

    setUploading(true);
    setError('');
    setUploadProgress(0);

    try {
      const formData = new FormData();
      formData.append('file', file);

      if (useExistingBrand) {
        formData.append('brandId', selectedBrand);
      } else {
        formData.append('brandName', brandName.trim());
      }

      formData.append('columnMapping', JSON.stringify(columnMapping));

      const response = await catalogAPI.upload(formData, (progressEvent) => {
        const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
        setUploadProgress(percentCompleted);
      });

      setUploadResult(response.data);
      setFile(null);
      setPreview(null);
      setColumnMapping({});
      setBrandName('');
      setSelectedBrand('');
      await fetchUploadHistory();
      await fetchBrands(); // Refresh brands list in case a new one was created

      // Reset file input
      const fileInput = document.getElementById('fileInput');
      if (fileInput) {
        fileInput.value = '';
      }
    } catch (err) {
      console.error('Upload error:', err);
      setError(err.response?.data?.error || 'Failed to upload catalog');
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  const handleColumnMappingChange = (dbField, fileColumn) => {
    setColumnMapping((prev) => ({
      ...prev,
      [dbField]: fileColumn,
    }));
  };

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Catalog Upload</h1>
          <p className="mt-2 text-sm text-gray-600">
            Import product catalogs from vendor spreadsheets (CSV or Excel)
          </p>
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-md p-4">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        {/* Upload Result */}
        {uploadResult && (
          <div className={`border rounded-md p-4 ${
            uploadResult.stats.errorCount > 0 ? 'bg-yellow-50 border-yellow-200' : 'bg-green-50 border-green-200'
          }`}>
            <h3 className="font-medium text-gray-900 mb-2">Upload Complete!</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-gray-600">Total Rows</p>
                <p className="font-semibold">{uploadResult.stats.totalRows}</p>
              </div>
              <div>
                <p className="text-gray-600">Products Added</p>
                <p className="font-semibold text-green-600">{uploadResult.stats.productsAdded}</p>
              </div>
              <div>
                <p className="text-gray-600">Products Updated</p>
                <p className="font-semibold text-blue-600">{uploadResult.stats.productsUpdated}</p>
              </div>
              <div>
                <p className="text-gray-600">Errors</p>
                <p className="font-semibold text-red-600">{uploadResult.stats.errorCount}</p>
              </div>
            </div>
            {uploadResult.errors && uploadResult.errors.length > 0 && (
              <div className="mt-4">
                <p className="text-sm font-medium text-gray-900">First few errors:</p>
                <ul className="mt-2 text-sm text-gray-700 list-disc list-inside">
                  {uploadResult.errors.slice(0, 5).map((err, idx) => (
                    <li key={idx}>Row {err.row}: {err.errors.join(', ')}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Upload Form */}
        <div className="bg-white shadow rounded-lg p-6 space-y-6">
          {/* Brand Selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Brand *
            </label>

            {/* Toggle between existing and new brand */}
            <div className="flex items-center space-x-4 mb-3">
              <button
                type="button"
                onClick={() => setUseExistingBrand(true)}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  useExistingBrand
                    ? 'bg-blue-100 text-blue-700 border-2 border-blue-500'
                    : 'bg-gray-100 text-gray-600 border-2 border-transparent hover:bg-gray-200'
                }`}
                disabled={uploading}
              >
                Select Existing Brand
              </button>
              <button
                type="button"
                onClick={() => setUseExistingBrand(false)}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                  !useExistingBrand
                    ? 'bg-blue-100 text-blue-700 border-2 border-blue-500'
                    : 'bg-gray-100 text-gray-600 border-2 border-transparent hover:bg-gray-200'
                }`}
                disabled={uploading}
              >
                Enter New Brand Name
              </button>
            </div>

            {useExistingBrand ? (
              <select
                value={selectedBrand}
                onChange={(e) => setSelectedBrand(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                disabled={uploading}
              >
                <option value="">Choose a brand...</option>
                {brands.map((brand) => (
                  <option key={brand.id} value={brand.id}>
                    {brand.name}
                  </option>
                ))}
              </select>
            ) : (
              <div>
                <input
                  type="text"
                  value={brandName}
                  onChange={(e) => setBrandName(e.target.value)}
                  placeholder="Enter brand name (e.g., Black Diamond)"
                  className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  disabled={uploading}
                />
                <p className="mt-1 text-xs text-gray-500">
                  Brand will be created if it doesn't exist, or matched if found
                </p>
              </div>
            )}
          </div>

          {/* File Upload Area */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Upload File (CSV or Excel) *
            </label>
            <div
              className={`border-2 border-dashed rounded-lg p-8 text-center ${
                isDragging
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-300 hover:border-gray-400'
              }`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              {file ? (
                <div>
                  <svg
                    className="mx-auto h-12 w-12 text-green-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <p className="mt-2 text-sm text-gray-900 font-medium">{file.name}</p>
                  <p className="text-xs text-gray-500">
                    {(file.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                  <button
                    onClick={() => {
                      setFile(null);
                      setPreview(null);
                      setColumnMapping({});
                      document.getElementById('fileInput').value = '';
                    }}
                    className="mt-2 text-sm text-red-600 hover:text-red-500"
                    disabled={uploading}
                  >
                    Remove file
                  </button>
                </div>
              ) : (
                <div>
                  <svg
                    className="mx-auto h-12 w-12 text-gray-400"
                    stroke="currentColor"
                    fill="none"
                    viewBox="0 0 48 48"
                  >
                    <path
                      d="M28 8H12a4 4 0 00-4 4v20m32-12v8m0 0v8a4 4 0 01-4 4H12a4 4 0 01-4-4v-4m32-4l-3.172-3.172a4 4 0 00-5.656 0L28 28M8 32l9.172-9.172a4 4 0 015.656 0L28 28m0 0l4 4m4-24h8m-4-4v8m-12 4h.02"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <p className="mt-2 text-sm text-gray-600">
                    <label
                      htmlFor="fileInput"
                      className="cursor-pointer text-blue-600 hover:text-blue-500 font-medium"
                    >
                      Click to upload
                    </label>{' '}
                    or drag and drop
                  </p>
                  <p className="text-xs text-gray-500">CSV or Excel files (max 50MB)</p>
                  <input
                    id="fileInput"
                    type="file"
                    accept=".csv,.xlsx,.xls"
                    onChange={handleFileInput}
                    className="hidden"
                    disabled={uploading}
                  />
                </div>
              )}
            </div>
          </div>

          {/* File Preview */}
          {preview && (
            <div>
              <h3 className="text-sm font-medium text-gray-700 mb-2">
                File Preview ({preview.totalRows} rows detected)
              </h3>
              <div className="overflow-x-auto border border-gray-200 rounded-md">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      {preview.columns.map((col, idx) => (
                        <th
                          key={idx}
                          className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase"
                        >
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {preview.preview.map((row, rowIdx) => (
                      <tr key={rowIdx}>
                        {preview.columns.map((col, colIdx) => (
                          <td key={colIdx} className="px-4 py-2 text-gray-900 whitespace-nowrap">
                            {row[col] || '-'}
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
            <div>
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
                        disabled={uploading}
                      >
                        <option value="">-- Select Column --</option>
                        {preview.columns.map((col, idx) => (
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
            </div>
          )}

          {/* Upload Button */}
          {preview && (
            <div className="flex justify-end">
              <button
                onClick={handleUpload}
                disabled={
                  uploading ||
                  (useExistingBrand ? !selectedBrand : !brandName.trim()) ||
                  dbFields.filter(f => f.required && !columnMapping[f.key]).length > 0
                }
                className={`px-6 py-3 rounded-md font-medium ${
                  uploading ||
                  (useExistingBrand ? !selectedBrand : !brandName.trim()) ||
                  dbFields.filter(f => f.required && !columnMapping[f.key]).length > 0
                    ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                    : 'bg-blue-600 text-white hover:bg-blue-700'
                }`}
              >
                {uploading ? `Uploading... ${uploadProgress}%` : 'Upload Catalog'}
              </button>
            </div>
          )}

          {/* Progress Bar */}
          {uploading && (
            <div className="w-full bg-gray-200 rounded-full h-2.5">
              <div
                className="bg-blue-600 h-2.5 rounded-full transition-all duration-300"
                style={{ width: `${uploadProgress}%` }}
              ></div>
            </div>
          )}
        </div>

        {/* Upload History */}
        <div className="bg-white shadow rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-medium text-gray-900">Upload History</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Date
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Brand
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    File Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Added
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Updated
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {uploadHistory.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-6 py-4 text-center text-sm text-gray-500">
                      No upload history yet
                    </td>
                  </tr>
                ) : (
                  uploadHistory.map((upload) => (
                    <tr key={upload.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {new Date(upload.createdAt).toLocaleString()}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {upload.brandName}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {upload.fileName}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-green-600">
                        {upload.productsAdded}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-blue-600">
                        {upload.productsUpdated}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span
                          className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                            upload.uploadStatus === 'completed'
                              ? 'bg-green-100 text-green-800'
                              : upload.uploadStatus === 'completed_with_errors'
                              ? 'bg-yellow-100 text-yellow-800'
                              : 'bg-red-100 text-red-800'
                          }`}
                        >
                          {upload.uploadStatus ? upload.uploadStatus.replace(/_/g, ' ') : 'unknown'}
                        </span>
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

export default CatalogUpload;
