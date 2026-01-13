import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { formTemplateAPI, brandAPI } from '../services/api';
import Layout from '../components/Layout';

const FormTemplateManager = () => {
  const { isAdmin, isBuyer } = useAuth();
  const [templates, setTemplates] = useState([]);
  const [brands, setBrands] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [selectedBrandFilter, setSelectedBrandFilter] = useState('');
  const [expandedTemplateId, setExpandedTemplateId] = useState(null);

  const [formData, setFormData] = useState({
    brand_id: '',
    name: '',
    sheet_name: '',
    header_row: 0,
    data_start_row: 1,
    product_id_column: '',
    product_id_type: 'upc',
    location_column: '',
    quantity_columns: []
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [templatesResponse, brandsResponse] = await Promise.all([
        formTemplateAPI.getAll(),
        brandAPI.getAll()
      ]);
      setTemplates(templatesResponse.data.templates || []);
      setBrands(brandsResponse.data.brands || []);
      setError('');
    } catch (err) {
      console.error('Error fetching data:', err);
      setError('Failed to load templates. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenModal = (template = null) => {
    if (template) {
      setEditingTemplate(template);
      // Fetch full template details with quantity columns
      fetchTemplateDetails(template.id);
    } else {
      setEditingTemplate(null);
      setFormData({
        brand_id: '',
        name: '',
        sheet_name: '',
        header_row: 0,
        data_start_row: 1,
        product_id_column: '',
        product_id_type: 'upc',
        location_column: '',
        quantity_columns: []
      });
      setShowModal(true);
    }
  };

  const fetchTemplateDetails = async (templateId) => {
    try {
      const response = await formTemplateAPI.getById(templateId);
      const template = response.data.template;
      const quantityColumns = response.data.quantityColumns || [];

      setFormData({
        brand_id: template.brand_id,
        name: template.name,
        sheet_name: template.sheet_name || '',
        header_row: template.header_row,
        data_start_row: template.data_start_row,
        product_id_column: template.product_id_column,
        product_id_type: template.product_id_type,
        location_column: template.location_column || '',
        quantity_columns: quantityColumns
      });
      setShowModal(true);
    } catch (err) {
      console.error('Error fetching template details:', err);
      alert('Failed to load template details');
    }
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setEditingTemplate(null);
    setFormData({
      brand_id: '',
      name: '',
      sheet_name: '',
      header_row: 0,
      data_start_row: 1,
      product_id_column: '',
      product_id_type: 'upc',
      location_column: '',
      quantity_columns: []
    });
  };

  const handleAddQuantityColumn = () => {
    setFormData({
      ...formData,
      quantity_columns: [
        ...formData.quantity_columns,
        {
          column_letter: '',
          column_name: '',
          ship_date: '',
          is_editable: true,
          column_order: formData.quantity_columns.length
        }
      ]
    });
  };

  const handleRemoveQuantityColumn = (index) => {
    setFormData({
      ...formData,
      quantity_columns: formData.quantity_columns.filter((_, i) => i !== index)
    });
  };

  const handleQuantityColumnChange = (index, field, value) => {
    const updated = [...formData.quantity_columns];
    updated[index][field] = value;
    setFormData({ ...formData, quantity_columns: updated });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Validation
    if (!formData.brand_id || !formData.name || !formData.product_id_column) {
      alert('Please fill in all required fields');
      return;
    }

    if (formData.quantity_columns.length === 0) {
      alert('At least one quantity column is required');
      return;
    }

    try {
      if (editingTemplate) {
        await formTemplateAPI.update(editingTemplate.id, formData);
      } else {
        await formTemplateAPI.create(formData);
      }
      await fetchData();
      handleCloseModal();
    } catch (err) {
      console.error('Error saving template:', err);
      alert(err.response?.data?.error || 'Failed to save template. Please try again.');
    }
  };

  const handleDelete = async (template) => {
    if (!window.confirm(`Are you sure you want to delete template "${template.name}"? This action cannot be undone.`)) {
      return;
    }

    try {
      await formTemplateAPI.delete(template.id);
      await fetchData();
    } catch (err) {
      console.error('Error deleting template:', err);
      const errorMessage = err.response?.data?.error || 'Failed to delete template.';
      alert(errorMessage);
    }
  };

  const toggleExpand = (templateId) => {
    setExpandedTemplateId(expandedTemplateId === templateId ? null : templateId);
  };

  const filteredTemplates = selectedBrandFilter
    ? templates.filter(t => t.brand_id === parseInt(selectedBrandFilter))
    : templates;

  if (loading) {
    return (
      <Layout>
        <div className="flex justify-center items-center min-h-[400px]">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Form Templates</h1>
            <p className="text-gray-600 mt-1">Manage Excel import templates for brand order forms</p>
          </div>
          {(isAdmin || isBuyer) && (
            <button
              onClick={() => handleOpenModal()}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              + New Template
            </button>
          )}
        </div>

        {error && (
          <div className="mb-4 p-4 bg-red-100 border border-red-300 text-red-700 rounded">
            {error}
          </div>
        )}

        {/* Filters */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Filter by Brand
          </label>
          <select
            value={selectedBrandFilter}
            onChange={(e) => setSelectedBrandFilter(e.target.value)}
            className="w-64 px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Brands</option>
            {brands.map(brand => (
              <option key={brand.id} value={brand.id}>{brand.name}</option>
            ))}
          </select>
        </div>

        {/* Templates list */}
        {filteredTemplates.length === 0 ? (
          <div className="text-center py-12 bg-gray-50 rounded-lg">
            <p className="text-gray-600">
              {selectedBrandFilter ? 'No templates found for this brand' : 'No templates configured yet'}
            </p>
            {(isAdmin || isBuyer) && (
              <button
                onClick={() => handleOpenModal()}
                className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                Create First Template
              </button>
            )}
          </div>
        ) : (
          <div className="bg-white shadow rounded-lg overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Template Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Brand
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Product ID Type
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Qty Columns
                  </th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredTemplates.map((template) => (
                  <tr key={template.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <div className="text-sm font-medium text-gray-900">{template.name}</div>
                      {template.sheet_name && (
                        <div className="text-xs text-gray-500">Sheet: {template.sheet_name}</div>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900">
                      {template.brand_name}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900 uppercase">
                      {template.product_id_type}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900">
                      {template.quantity_column_count || 0}
                    </td>
                    <td className="px-6 py-4 text-right text-sm font-medium space-x-2">
                      <button
                        onClick={() => toggleExpand(template.id)}
                        className="text-blue-600 hover:text-blue-800"
                      >
                        {expandedTemplateId === template.id ? 'Hide' : 'View'}
                      </button>
                      {(isAdmin || isBuyer) && (
                        <>
                          <button
                            onClick={() => handleOpenModal(template)}
                            className="text-yellow-600 hover:text-yellow-800"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDelete(template)}
                            className="text-red-600 hover:text-red-800"
                          >
                            Delete
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Modal for creating/editing template */}
        {showModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto">
              <div className="p-6">
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-2xl font-bold text-gray-900">
                    {editingTemplate ? 'Edit Template' : 'New Template'}
                  </h2>
                  <button
                    onClick={handleCloseModal}
                    className="text-gray-400 hover:text-gray-600 text-2xl"
                  >
                    ×
                  </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                  {/* Info Banner */}
                  <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg p-4">
                    <h3 className="text-sm font-semibold text-blue-900 mb-2">📝 How Form Templates Work</h3>
                    <ul className="text-xs text-blue-800 space-y-1 ml-4 list-disc">
                      <li>Templates tell the system how to read Excel files from brands</li>
                      <li>Map which columns contain product codes (UPC/EAN/SKU) and quantities</li>
                      <li>Once created, you can import Excel files directly in Order Adjustment</li>
                      <li>Products are automatically matched to your database</li>
                    </ul>
                  </div>

                  {/* Brand */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Brand <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={formData.brand_id}
                      onChange={(e) => setFormData({ ...formData, brand_id: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                      required
                    >
                      <option value="">Select a brand</option>
                      {brands.map(brand => (
                        <option key={brand.id} value={brand.id}>{brand.name}</option>
                      ))}
                    </select>
                  </div>

                  {/* Template Name */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Template Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      placeholder="e.g., Petzl Preseason Form"
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                      required
                    />
                  </div>

                  {/* Sheet Name */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Sheet Name <span className="text-gray-500 text-xs">(optional, uses first sheet if empty)</span>
                    </label>
                    <input
                      type="text"
                      value={formData.sheet_name}
                      onChange={(e) => setFormData({ ...formData, sheet_name: e.target.value })}
                      placeholder="e.g., Sheet1"
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  {/* Row numbers */}
                  <div className="bg-blue-50 border border-blue-200 rounded p-3 mb-4">
                    <p className="text-xs text-blue-800 mb-2">
                      <strong>💡 Row Numbering:</strong> Excel rows start at 0. If your column headers are in row 1, enter 0. If data starts in row 2, enter 1.
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Header Row (0-indexed)
                      </label>
                      <p className="text-xs text-gray-500 mb-1">Row containing column names like "UPC", "Product Name", "Qty", etc.</p>
                      <input
                        type="number"
                        value={formData.header_row}
                        onChange={(e) => setFormData({ ...formData, header_row: parseInt(e.target.value) })}
                        min="0"
                        placeholder="Usually 0 (first row)"
                        className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Data Start Row (0-indexed)
                      </label>
                      <p className="text-xs text-gray-500 mb-1">First row with actual product data (not headers)</p>
                      <input
                        type="number"
                        value={formData.data_start_row}
                        onChange={(e) => setFormData({ ...formData, data_start_row: parseInt(e.target.value) })}
                        min="0"
                        placeholder="Usually 1 (second row)"
                        className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                  </div>

                  {/* Product ID configuration */}
                  <div className="bg-green-50 border border-green-200 rounded p-3 mb-4">
                    <p className="text-xs text-green-800">
                      <strong>🔍 Product Matching:</strong> Specify which Excel column contains product identifiers (UPC/EAN/SKU) used to match with your database.
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Product ID Column <span className="text-red-500">*</span>
                      </label>
                      <p className="text-xs text-gray-500 mb-1">Excel column letter containing UPC/EAN/SKU codes</p>
                      <input
                        type="text"
                        value={formData.product_id_column}
                        onChange={(e) => setFormData({ ...formData, product_id_column: e.target.value.toUpperCase() })}
                        placeholder="e.g., A, B, C"
                        className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                        required
                      />
                      <p className="text-xs text-gray-400 mt-1">Column A is the first column, B is second, etc.</p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Product ID Type <span className="text-red-500">*</span>
                      </label>
                      <p className="text-xs text-gray-500 mb-1">Type of identifier in that column</p>
                      <select
                        value={formData.product_id_type}
                        onChange={(e) => setFormData({ ...formData, product_id_type: e.target.value })}
                        className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                        required
                      >
                        <option value="upc">UPC (12-digit barcode)</option>
                        <option value="ean">EAN (13-digit barcode)</option>
                        <option value="sku">SKU (product code)</option>
                      </select>
                    </div>
                  </div>

                  {/* Location Column (optional) */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Location Column <span className="text-gray-500 text-xs">(optional)</span>
                    </label>
                    <p className="text-xs text-gray-500 mb-1">If the Excel has a location/store column, specify it here. Leave blank if not applicable.</p>
                    <input
                      type="text"
                      value={formData.location_column}
                      onChange={(e) => setFormData({ ...formData, location_column: e.target.value.toUpperCase() })}
                      placeholder="e.g., D (leave blank if not used)"
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  {/* Quantity Columns */}
                  <div>
                    <div className="bg-purple-50 border border-purple-200 rounded p-3 mb-3">
                      <p className="text-xs text-purple-800 mb-1">
                        <strong>📊 Quantity Columns:</strong> Define which columns contain order quantities and their ship dates.
                      </p>
                      <p className="text-xs text-purple-700">
                        Example: Column L = "Jan Ship" (date: 2026-01-15), Column M = "Feb Ship" (date: 2026-02-15)
                      </p>
                    </div>
                    <div className="flex justify-between items-center mb-2">
                      <label className="block text-sm font-medium text-gray-700">
                        Quantity Columns <span className="text-red-500">*</span>
                      </label>
                      <button
                        type="button"
                        onClick={handleAddQuantityColumn}
                        className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700"
                      >
                        + Add Column
                      </button>
                    </div>

                    {formData.quantity_columns.length === 0 && (
                      <p className="text-sm text-gray-500 italic mb-2">No quantity columns defined yet</p>
                    )}

                    <div className="space-y-2">
                      {formData.quantity_columns.map((col, idx) => (
                        <div key={idx} className="flex gap-2 items-start p-3 bg-gray-50 rounded border border-gray-200">
                          <div className="flex-1 grid grid-cols-3 gap-2">
                            <div>
                              <label className="block text-xs text-gray-600 mb-1">
                                Column Letter <span className="text-red-500">*</span>
                              </label>
                              <input
                                type="text"
                                value={col.column_letter}
                                onChange={(e) => handleQuantityColumnChange(idx, 'column_letter', e.target.value.toUpperCase())}
                                placeholder="L, M, N..."
                                className="w-full px-2 py-1 text-sm border border-gray-300 rounded"
                                required
                              />
                              <p className="text-xs text-gray-400 mt-0.5">Excel column with quantity</p>
                            </div>
                            <div>
                              <label className="block text-xs text-gray-600 mb-1">
                                Display Name
                              </label>
                              <input
                                type="text"
                                value={col.column_name}
                                onChange={(e) => handleQuantityColumnChange(idx, 'column_name', e.target.value)}
                                placeholder="Jan Ship, Feb Ship..."
                                className="w-full px-2 py-1 text-sm border border-gray-300 rounded"
                              />
                              <p className="text-xs text-gray-400 mt-0.5">Label to show in table</p>
                            </div>
                            <div>
                              <label className="block text-xs text-gray-600 mb-1">
                                Ship Date <span className="text-red-500">*</span>
                              </label>
                              <input
                                type="date"
                                value={col.ship_date}
                                onChange={(e) => handleQuantityColumnChange(idx, 'ship_date', e.target.value)}
                                className="w-full px-2 py-1 text-sm border border-gray-300 rounded"
                                required
                              />
                              <p className="text-xs text-gray-400 mt-0.5">When products ship</p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRemoveQuantityColumn(idx)}
                            className="mt-5 px-2 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Form actions */}
                  <div className="flex justify-end gap-3 pt-4">
                    <button
                      type="button"
                      onClick={handleCloseModal}
                      className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
                    >
                      {editingTemplate ? 'Save Changes' : 'Create Template'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
};

export default FormTemplateManager;
