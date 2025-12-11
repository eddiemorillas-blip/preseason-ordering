import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import api, { brandAPI } from '../services/api';
import Layout from '../components/Layout';
import BrandTemplateManager from '../components/BrandTemplateManager';

const Brands = () => {
  const { isAdmin } = useAuth();
  const [brands, setBrands] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingBrand, setEditingBrand] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [expandedBrandId, setExpandedBrandId] = useState(null);
  const [formData, setFormData] = useState({
    name: '',
    vendorCode: '',
    contactName: '',
    contactEmail: '',
    contactPhone: '',
    notes: '',
    active: true
  });

  useEffect(() => {
    fetchBrands();
  }, []);

  const fetchBrands = async () => {
    try {
      setLoading(true);
      const response = await brandAPI.getAll();
      setBrands(response.data.brands || []);
      setError('');
    } catch (err) {
      console.error('Error fetching brands:', err);
      setError('Failed to load brands. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenModal = (brand = null) => {
    if (brand) {
      setEditingBrand(brand);
      setFormData({
        name: brand.name || '',
        vendorCode: brand.vendorCode || '',
        contactName: brand.contactName || '',
        contactEmail: brand.contactEmail || '',
        contactPhone: brand.contactPhone || '',
        notes: brand.notes || '',
        active: brand.active !== false
      });
    } else {
      setEditingBrand(null);
      setFormData({
        name: '',
        vendorCode: '',
        contactName: '',
        contactEmail: '',
        contactPhone: '',
        notes: '',
        active: true
      });
    }
    setShowModal(true);
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setEditingBrand(null);
    setFormData({
      name: '',
      vendorCode: '',
      contactName: '',
      contactEmail: '',
      contactPhone: '',
      notes: '',
      active: true
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      if (editingBrand) {
        await brandAPI.update(editingBrand.id, formData);
      } else {
        await brandAPI.create(formData);
      }
      await fetchBrands();
      handleCloseModal();
    } catch (err) {
      console.error('Error saving brand:', err);
      alert(err.response?.data?.error || 'Failed to save brand. Please try again.');
    }
  };

  const handleDelete = async (brand, forceDelete = false) => {
    if (!forceDelete) {
      if (!window.confirm(`Are you sure you want to delete "${brand.name}"? This action cannot be undone.`)) {
        return;
      }
    }

    try {
      if (forceDelete) {
        // Use the migration endpoint to force delete with products
        const response = await api.post('/migrations/delete-brand-with-products', { brandId: brand.id });
        if (response.data.success) {
          await fetchBrands();
        }
      } else {
        await brandAPI.delete(brand.id);
        await fetchBrands();
      }
    } catch (err) {
      console.error('Error deleting brand:', err);
      const errorMessage = err.response?.data?.error || 'Failed to delete brand.';
      const productCount = err.response?.data?.productCount;
      if (productCount) {
        // Offer to force delete
        const confirmForce = window.confirm(
          `This brand has ${productCount} product(s) associated with it.\n\n` +
          `Do you want to delete the brand AND all ${productCount} products?\n\n` +
          `WARNING: This will permanently delete all products for "${brand.name}". This cannot be undone.`
        );
        if (confirmForce) {
          await handleDelete(brand, true);
        }
      } else {
        alert(errorMessage);
      }
    }
  };

  const filteredBrands = brands.filter(brand =>
    brand.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (brand.vendorCode && brand.vendorCode.toLowerCase().includes(searchTerm.toLowerCase()))
  );

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
      <div className="space-y-6">
        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Brand Management</h1>
            <p className="mt-2 text-sm text-gray-600">
              Manage your {brands.length} brand{brands.length !== 1 ? 's' : ''}
            </p>
          </div>
          {isAdmin() && (
            <button
              onClick={() => handleOpenModal()}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors font-medium"
            >
              Add New Brand
            </button>
          )}
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-md p-4">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        {/* Search */}
        <div className="bg-white p-4 rounded-lg shadow">
          <input
            type="text"
            placeholder="Search brands by name or vendor code..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>

        {/* Brands Table */}
        <div className="bg-white shadow rounded-lg overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Brand Name
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Vendor Code
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Contact
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Status
                </th>
                {isAdmin() && (
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {filteredBrands.length === 0 ? (
                <tr>
                  <td colSpan={isAdmin() ? 5 : 4} className="px-6 py-4 text-center text-sm text-gray-500">
                    No brands found
                  </td>
                </tr>
              ) : (
                filteredBrands.map((brand) => (
                  <>
                    <tr key={brand.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setExpandedBrandId(expandedBrandId === brand.id ? null : brand.id)}
                            className="text-gray-400 hover:text-gray-600"
                          >
                            <svg
                              className={`w-4 h-4 transition-transform ${expandedBrandId === brand.id ? 'rotate-90' : ''}`}
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                          </button>
                          <div className="text-sm font-medium text-gray-900">{brand.name}</div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {brand.vendorCode || 'N/A'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {brand.contactName ? (
                          <div className="text-sm">
                            <div className="text-gray-900">{brand.contactName}</div>
                            {brand.contactEmail && (
                              <div className="text-gray-500">{brand.contactEmail}</div>
                            )}
                          </div>
                        ) : (
                          <span className="text-sm text-gray-500">No contact</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                          brand.active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                        }`}>
                          {brand.active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      {isAdmin() && (
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium space-x-3">
                          <button
                            onClick={() => handleOpenModal(brand)}
                            className="text-blue-600 hover:text-blue-900"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDelete(brand)}
                            className="text-red-600 hover:text-red-900"
                          >
                            Delete
                          </button>
                        </td>
                      )}
                    </tr>
                    {expandedBrandId === brand.id && (
                      <tr key={`${brand.id}-templates`}>
                        <td colSpan={isAdmin() ? 5 : 4} className="px-6 py-4 bg-gray-50">
                          <BrandTemplateManager brandId={brand.id} brandName={brand.name} />
                        </td>
                      </tr>
                    )}
                  </>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed z-10 inset-0 overflow-y-auto">
          <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" onClick={handleCloseModal}></div>

            <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
              <form onSubmit={handleSubmit}>
                <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                  <h3 className="text-lg font-medium leading-6 text-gray-900 mb-4">
                    {editingBrand ? 'Edit Brand' : 'Add New Brand'}
                  </h3>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Brand Name *</label>
                      <input
                        type="text"
                        required
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700">Vendor Code</label>
                      <input
                        type="text"
                        value={formData.vendorCode}
                        onChange={(e) => setFormData({ ...formData, vendorCode: e.target.value })}
                        className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700">Contact Name</label>
                      <input
                        type="text"
                        value={formData.contactName}
                        onChange={(e) => setFormData({ ...formData, contactName: e.target.value })}
                        className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700">Contact Email</label>
                      <input
                        type="email"
                        value={formData.contactEmail}
                        onChange={(e) => setFormData({ ...formData, contactEmail: e.target.value })}
                        className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700">Contact Phone</label>
                      <input
                        type="tel"
                        value={formData.contactPhone}
                        onChange={(e) => setFormData({ ...formData, contactPhone: e.target.value })}
                        className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700">Notes</label>
                      <textarea
                        rows={3}
                        value={formData.notes}
                        onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                        className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                      />
                    </div>

                    <div className="flex items-center">
                      <input
                        type="checkbox"
                        id="active"
                        checked={formData.active}
                        onChange={(e) => setFormData({ ...formData, active: e.target.checked })}
                        className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                      />
                      <label htmlFor="active" className="ml-2 block text-sm text-gray-900">
                        Active
                      </label>
                    </div>
                  </div>
                </div>

                <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                  <button
                    type="submit"
                    className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-blue-600 text-base font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:ml-3 sm:w-auto sm:text-sm"
                  >
                    {editingBrand ? 'Update' : 'Create'}
                  </button>
                  <button
                    type="button"
                    onClick={handleCloseModal}
                    className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
};

export default Brands;
