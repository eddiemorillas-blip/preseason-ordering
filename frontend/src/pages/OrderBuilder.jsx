import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import api from '../services/api';
import Layout from '../components/Layout';
import { useAuth } from '../context/AuthContext';

const OrderBuilder = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isAdmin, isBuyer } = useAuth();

  const [order, setOrder] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Removed modal state - now using full page for adding products
  const [showCopyOrderModal, setShowCopyOrderModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editingQuantities, setEditingQuantities] = useState({}); // { itemId: newQuantity }
  const [savingItems, setSavingItems] = useState(new Set()); // Track which items are being saved
  const [itemToDelete, setItemToDelete] = useState(null); // Item pending deletion confirmation
  const [familyToDelete, setFamilyToDelete] = useState(null); // Family pending deletion { name, items }
  const [deletingFamily, setDeletingFamily] = useState(false);
  const [showExportDropdown, setShowExportDropdown] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [collapsedFamilies, setCollapsedFamilies] = useState(new Set());

  useEffect(() => {
    fetchOrder();
  }, [id]);

  // Close export dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (showExportDropdown && !event.target.closest('.export-dropdown')) {
        setShowExportDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showExportDropdown]);

  const fetchOrder = async () => {
    try {
      setLoading(true);
      const response = await api.get(`/orders/${id}`);
      setOrder(response.data.order);
      setItems(response.data.items || []);
    } catch (err) {
      console.error('Error fetching order:', err);
      setError('Failed to load order');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateStatus = async (newStatus) => {
    try {
      await api.patch(`/orders/${id}`, { status: newStatus });
      setOrder({ ...order, status: newStatus });
    } catch (err) {
      console.error('Error updating status:', err);
      setError('Failed to update order status');
    }
  };

  const handleDeleteOrder = async () => {
    try {
      setDeleting(true);
      await api.delete(`/orders/${id}`);
      navigate(`/seasons/${order.season_id}`);
    } catch (err) {
      console.error('Error deleting order:', err);
      setError(err.response?.data?.error || 'Failed to delete order');
      setDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  // Handle quantity change in input field
  const handleQuantityChange = (itemId, value) => {
    setEditingQuantities({
      ...editingQuantities,
      [itemId]: value
    });
  };

  // Save updated quantity for an item
  const handleSaveQuantity = async (itemId) => {
    const newQuantity = editingQuantities[itemId];
    if (newQuantity === undefined || newQuantity === '') return;

    const quantity = parseInt(newQuantity, 10);
    if (isNaN(quantity) || quantity < 0) {
      setError('Please enter a valid quantity');
      return;
    }

    // If quantity is 0, prompt for deletion instead
    if (quantity === 0) {
      const item = items.find(i => i.id === itemId);
      setItemToDelete(item);
      return;
    }

    setSavingItems(prev => new Set(prev).add(itemId));
    setError('');

    try {
      await api.patch(`/orders/${id}/items/${itemId}`, { quantity });

      // Update local state
      const updatedItems = items.map(item =>
        item.id === itemId
          ? { ...item, quantity, line_total: quantity * parseFloat(item.unit_price || 0) }
          : item
      );
      setItems(updatedItems);

      // Update order total locally
      const newTotal = updatedItems.reduce((sum, item) => sum + parseFloat(item.line_total || 0), 0);
      setOrder(prev => ({ ...prev, current_total: newTotal }));

      // Clear editing state for this item
      const newEditing = { ...editingQuantities };
      delete newEditing[itemId];
      setEditingQuantities(newEditing);
    } catch (err) {
      console.error('Error updating quantity:', err);
      setError(err.response?.data?.error || 'Failed to update quantity');
    } finally {
      setSavingItems(prev => {
        const newSet = new Set(prev);
        newSet.delete(itemId);
        return newSet;
      });
    }
  };

  // Handle key press in quantity input (Enter to save and advance, Escape to cancel)
  const handleQuantityKeyDown = (e, itemId, originalQuantity) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSaveQuantity(itemId);

      // Find and focus the next quantity input
      const allInputs = Array.from(document.querySelectorAll('input[type="number"]'));
      const currentIndex = allInputs.findIndex(input => input === e.target);
      if (currentIndex !== -1 && currentIndex < allInputs.length - 1) {
        const nextInput = allInputs[currentIndex + 1];
        nextInput.focus();
        nextInput.select();
      }
    } else if (e.key === 'Escape') {
      const newEditing = { ...editingQuantities };
      delete newEditing[itemId];
      setEditingQuantities(newEditing);
    }
  };

  // Delete an item from the order
  const handleDeleteItem = async (itemId) => {
    setSavingItems(prev => new Set(prev).add(itemId));
    setError('');

    try {
      await api.delete(`/orders/${id}/items/${itemId}`);

      // Update local state
      const updatedItems = items.filter(item => item.id !== itemId);
      setItems(updatedItems);
      setItemToDelete(null);

      // Update order total locally
      const newTotal = updatedItems.reduce((sum, item) => sum + parseFloat(item.line_total || 0), 0);
      setOrder(prev => ({ ...prev, current_total: newTotal }));
    } catch (err) {
      console.error('Error deleting item:', err);
      setError(err.response?.data?.error || 'Failed to remove item');
    } finally {
      setSavingItems(prev => {
        const newSet = new Set(prev);
        newSet.delete(itemId);
        return newSet;
      });
    }
  };

  // Delete all items in a product family
  const handleDeleteFamily = async () => {
    if (!familyToDelete) return;

    setDeletingFamily(true);
    setError('');

    try {
      // Delete all items in the family
      for (const item of familyToDelete.items) {
        await api.delete(`/orders/${id}/items/${item.id}`);
      }

      // Update local state
      const deletedIds = new Set(familyToDelete.items.map(i => i.id));
      const updatedItems = items.filter(item => !deletedIds.has(item.id));
      setItems(updatedItems);
      setFamilyToDelete(null);

      // Update order total locally
      const newTotal = updatedItems.reduce((sum, item) => sum + parseFloat(item.line_total || 0), 0);
      setOrder(prev => ({ ...prev, current_total: newTotal }));
    } catch (err) {
      console.error('Error deleting family:', err);
      setError(err.response?.data?.error || 'Failed to remove product family');
    } finally {
      setDeletingFamily(false);
    }
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount || 0);
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'draft':
        return 'bg-gray-100 text-gray-800';
      case 'submitted':
        return 'bg-blue-100 text-blue-800';
      case 'confirmed':
        return 'bg-green-100 text-green-800';
      case 'cancelled':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  // Group items by product family (base_name, fallback to product_name)
  const groupedItems = items.reduce((acc, item) => {
    const key = item.base_name || item.product_name || 'Ungrouped';
    if (!acc[key]) {
      acc[key] = [];
    }
    acc[key].push(item);
    return acc;
  }, {});


  const toggleFamilyCollapse = (familyName) => {
    const newCollapsed = new Set(collapsedFamilies);
    if (newCollapsed.has(familyName)) {
      newCollapsed.delete(familyName);
    } else {
      newCollapsed.add(familyName);
    }
    setCollapsedFamilies(newCollapsed);
  };

  const toggleAllFamilies = () => {
    const familyNames = Object.keys(groupedItems);
    if (collapsedFamilies.size === familyNames.length) {
      // All collapsed, expand all
      setCollapsedFamilies(new Set());
    } else {
      // Some or none collapsed, collapse all
      setCollapsedFamilies(new Set(familyNames));
    }
  };

  const allCollapsed = Object.keys(groupedItems).length > 0 && collapsedFamilies.size === Object.keys(groupedItems).length;

  const canEdit = isAdmin() || isBuyer();

  // Handle export
  const handleExport = async (template, format) => {
    setExporting(true);
    setShowExportDropdown(false);
    try {
      const response = await api.get(`/exports/orders/${id}?template=${template}&format=${format}`, {
        responseType: 'blob'
      });

      // Create download link
      const blob = new Blob([response.data], {
        type: format === 'csv' ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `order_${order.order_number}_${template}.${format}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error exporting order:', err);
      setError('Failed to export order');
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex justify-center items-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      </Layout>
    );
  }

  if (!order) {
    return (
      <Layout>
        <div className="text-center py-12">
          <p className="text-red-600">Order not found</p>
          <button
            onClick={() => navigate('/seasons')}
            className="mt-4 text-blue-600 hover:text-blue-800"
          >
            Back to Seasons
          </button>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex justify-between items-start">
          <div>
            <button
              onClick={() => navigate(`/seasons/${order.season_id}`)}
              className="text-sm text-blue-600 hover:text-blue-800 mb-2"
            >
              ← Back to Season Dashboard
            </button>
            <div className="flex items-center space-x-3">
              <h1 className="text-3xl font-bold text-gray-900">{order.order_number}</h1>
              <span className={`px-3 py-1 inline-flex text-sm font-semibold rounded-full ${getStatusColor(order.status)}`}>
                {order.status}
              </span>
            </div>
            <div className="mt-2 text-sm text-gray-600 space-y-1">
              <div><strong>Season:</strong> {order.season_name}</div>
              <div><strong>Brand:</strong> {order.brand_name}</div>
              <div><strong>Location:</strong> {order.location_name} ({order.location_code})</div>
              {order.ship_date && (
                <div><strong>Ship Date:</strong> {new Date(order.ship_date).toLocaleDateString()}</div>
              )}
              {order.notes && (
                <div><strong>Notes:</strong> {order.notes}</div>
              )}
            </div>
          </div>
          <div className="flex space-x-2">
            {/* Export Dropdown */}
            <div className="relative export-dropdown">
              <button
                onClick={() => setShowExportDropdown(!showExportDropdown)}
                disabled={exporting || items.length === 0}
                className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:bg-gray-400 flex items-center"
              >
                {exporting ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Exporting...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Export
                    <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </>
                )}
              </button>
              {showExportDropdown && (
                <div className="absolute right-0 mt-2 w-56 bg-white rounded-md shadow-lg ring-1 ring-black ring-opacity-5 z-50">
                  <div className="py-1">
                    <div className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50">
                      NuOrder Format
                    </div>
                    <button
                      onClick={() => handleExport('nuorder', 'xlsx')}
                      className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      Excel (.xlsx)
                    </button>
                    <button
                      onClick={() => handleExport('nuorder', 'csv')}
                      className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      CSV (.csv)
                    </button>
                    <div className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50">
                      Elastic Format
                    </div>
                    <button
                      onClick={() => handleExport('elastic', 'xlsx')}
                      className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      Excel (.xlsx)
                    </button>
                    <button
                      onClick={() => handleExport('elastic', 'csv')}
                      className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      CSV (.csv)
                    </button>
                    <div className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50">
                      Standard Format
                    </div>
                    <button
                      onClick={() => handleExport('standard', 'xlsx')}
                      className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      Excel (.xlsx)
                    </button>
                    <button
                      onClick={() => handleExport('standard', 'csv')}
                      className="block w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                    >
                      CSV (.csv)
                    </button>
                  </div>
                </div>
              )}
            </div>
            {canEdit && (
              <>
                <button
                  onClick={() => navigate(`/orders/${id}/add-products`)}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                  + Add Products
                </button>
                <button
                  onClick={() => setShowCopyOrderModal(true)}
                  className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
                >
                  Copy Order
                </button>
              </>
            )}
            {isAdmin() && (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
              >
                Delete Order
              </button>
            )}
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-md p-4">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        {/* Order Summary */}
        <div className="bg-white shadow rounded-lg p-6">
          <div className="grid grid-cols-3 gap-6">
            <div>
              <p className="text-sm text-gray-600">Total Items</p>
              <p className="text-2xl font-bold text-gray-900">{items.reduce((sum, item) => sum + parseInt(item.quantity), 0)}</p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Product Variants</p>
              <p className="text-2xl font-bold text-gray-900">{items.length}</p>
            </div>
            <div>
              <p className="text-sm text-gray-600">Order Total</p>
              <p className="text-2xl font-bold text-blue-600">{formatCurrency(order.current_total)}</p>
            </div>
          </div>
        </div>

        {/* Items by Family */}
        <div className="bg-white shadow rounded-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Order Items</h2>
            {items.length > 0 && (
              <button
                onClick={toggleAllFamilies}
                className="text-sm text-blue-600 hover:text-blue-800"
              >
                {allCollapsed ? 'Expand All' : 'Collapse All'}
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <div className="px-6 py-8 text-center text-sm text-gray-500">
              No items in this order yet.{' '}
              {canEdit && (
                <button
                  onClick={() => navigate(`/orders/${id}/add-products`)}
                  className="text-blue-600 hover:text-blue-800"
                >
                  Add products
                </button>
              )}
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {Object.entries(groupedItems).map(([familyName, familyItems]) => (
                <div key={familyName}>
                  <div
                    className="p-4 flex items-center justify-between cursor-pointer hover:bg-gray-50"
                    onClick={() => toggleFamilyCollapse(familyName)}
                  >
                    <div className="flex items-center gap-2">
                      <svg
                        className={`w-4 h-4 text-gray-500 transition-transform ${collapsedFamilies.has(familyName) ? '' : 'rotate-90'}`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                      <h3 className="font-semibold text-gray-900">{familyName}</h3>
                      <span className="text-sm text-gray-500">
                        ({familyItems.length} items &bull; {formatCurrency(familyItems.reduce((sum, item) => sum + parseFloat(item.line_total), 0))})
                      </span>
                    </div>
                    {canEdit && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setFamilyToDelete({ name: familyName, items: familyItems }); }}
                        className="flex items-center text-sm text-red-600 hover:text-red-800 px-2 py-1 rounded hover:bg-red-50"
                        title="Remove entire family"
                      >
                        <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        Remove Family
                      </button>
                    )}
                  </div>
                  {!collapsedFamilies.has(familyName) && (
                  <div className="px-6 pb-6 overflow-x-auto">
                    <table className="min-w-full">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                            Product
                          </th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                            Size
                          </th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                            Color
                          </th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                            Inseam
                          </th>
                          <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">
                            Unit Price
                          </th>
                          <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">
                            Quantity
                          </th>
                          <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase">
                            Line Total
                          </th>
                          {canEdit && (
                            <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase w-20">
                              Actions
                            </th>
                          )}
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-100">
                        {familyItems.map((item) => {
                          const isEditing = editingQuantities[item.id] !== undefined;
                          const isSaving = savingItems.has(item.id);
                          const displayQuantity = isEditing ? editingQuantities[item.id] : item.quantity;

                          return (
                            <tr key={item.id} className={`hover:bg-gray-50 ${isSaving ? 'opacity-50' : ''}`}>
                              <td className="px-4 py-3 text-sm text-gray-900">
                                {item.product_name}
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-600">
                                {item.size || '-'}
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-600">
                                {item.color || '-'}
                              </td>
                              <td className="px-4 py-3 text-sm text-gray-600">
                                {item.inseam || '-'}
                              </td>
                              <td className="px-4 py-3 text-sm text-right text-gray-900">
                                {formatCurrency(item.unit_price)}
                              </td>
                              <td className="px-4 py-3 text-sm text-right">
                                {canEdit ? (
                                  <div className="flex items-center justify-end space-x-1">
                                    <input
                                      type="number"
                                      min="0"
                                      value={displayQuantity}
                                      onChange={(e) => handleQuantityChange(item.id, e.target.value)}
                                      onKeyDown={(e) => handleQuantityKeyDown(e, item.id, item.quantity)}
                                      onBlur={() => {
                                        if (isEditing && editingQuantities[item.id] !== String(item.quantity)) {
                                          handleSaveQuantity(item.id);
                                        }
                                      }}
                                      className="w-16 px-2 py-1 text-right border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                                      disabled={isSaving}
                                    />
                                    {isEditing && editingQuantities[item.id] !== String(item.quantity) && (
                                      <span className="text-xs text-blue-600">*</span>
                                    )}
                                  </div>
                                ) : (
                                  <span className="font-medium text-gray-900">{item.quantity}</span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-sm text-right font-semibold text-gray-900">
                                {formatCurrency(
                                  isEditing && editingQuantities[item.id]
                                    ? parseInt(editingQuantities[item.id] || 0, 10) * parseFloat(item.unit_price || 0)
                                    : item.line_total
                                )}
                              </td>
                              {canEdit && (
                                <td className="px-4 py-3 text-center">
                                  <button
                                    onClick={() => setItemToDelete(item)}
                                    className="text-red-600 hover:text-red-800 p-1 rounded hover:bg-red-50"
                                    title="Remove item"
                                    disabled={isSaving}
                                  >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                    </svg>
                                  </button>
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Copy Order Modal */}
        {showCopyOrderModal && (
          <CopyOrderModal
            orderId={id}
            order={order}
            onClose={() => {
              setShowCopyOrderModal(false);
            }}
          />
        )}

        {/* Delete Confirmation Modal */}
        {showDeleteConfirm && (
          <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-md w-full">
              <h2 className="text-xl font-bold text-gray-900 mb-4">Delete Order</h2>
              <p className="text-gray-600 mb-6">
                Are you sure you want to delete order <strong>{order.order_number}</strong>?
                This will permanently remove the order and all its items. This action cannot be undone.
              </p>
              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                  disabled={deleting}
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteOrder}
                  className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:bg-gray-400"
                  disabled={deleting}
                >
                  {deleting ? 'Deleting...' : 'Delete Order'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Delete Item Confirmation Modal */}
        {itemToDelete && (
          <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-md w-full">
              <h2 className="text-xl font-bold text-gray-900 mb-4">Remove Item</h2>
              <p className="text-gray-600 mb-2">
                Are you sure you want to remove this item from the order?
              </p>
              <div className="bg-gray-50 rounded-md p-3 mb-6">
                <p className="font-medium text-gray-900">{itemToDelete.product_name}</p>
                <p className="text-sm text-gray-600">
                  {itemToDelete.size && `Size: ${itemToDelete.size}`}
                  {itemToDelete.size && itemToDelete.color && ' • '}
                  {itemToDelete.color && `Color: ${itemToDelete.color}`}
                </p>
                <p className="text-sm text-gray-600">
                  Quantity: {itemToDelete.quantity} × {formatCurrency(itemToDelete.unit_price)} = {formatCurrency(itemToDelete.line_total)}
                </p>
              </div>
              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => setItemToDelete(null)}
                  className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                  disabled={savingItems.has(itemToDelete.id)}
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleDeleteItem(itemToDelete.id)}
                  className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:bg-gray-400"
                  disabled={savingItems.has(itemToDelete.id)}
                >
                  {savingItems.has(itemToDelete.id) ? 'Removing...' : 'Remove Item'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Delete Family Confirmation Modal */}
        {familyToDelete && (
          <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-lg w-full">
              <h2 className="text-xl font-bold text-gray-900 mb-4">Remove Product Family</h2>
              <p className="text-gray-600 mb-2">
                Are you sure you want to remove <strong>all items</strong> in this product family from the order?
              </p>
              <div className="bg-gray-50 rounded-md p-4 mb-6">
                <p className="font-semibold text-gray-900 mb-2">{familyToDelete.name}</p>
                <div className="text-sm text-gray-600 space-y-1 max-h-40 overflow-y-auto">
                  {familyToDelete.items.map(item => (
                    <div key={item.id} className="flex justify-between">
                      <span>
                        {item.size && `${item.size}`}
                        {item.size && item.color && ' / '}
                        {item.color && `${item.color}`}
                      </span>
                      <span>Qty: {item.quantity}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-3 pt-3 border-t border-gray-200 flex justify-between font-medium">
                  <span>Total: {familyToDelete.items.length} items</span>
                  <span>{formatCurrency(familyToDelete.items.reduce((sum, item) => sum + parseFloat(item.line_total || 0), 0))}</span>
                </div>
              </div>
              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => setFamilyToDelete(null)}
                  className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                  disabled={deletingFamily}
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteFamily}
                  className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:bg-gray-400"
                  disabled={deletingFamily}
                >
                  {deletingFamily ? 'Removing...' : `Remove ${familyToDelete.items.length} Items`}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
};

// Copy Order Modal Component with Variant Mapping
const CopyOrderModal = ({ orderId, order, onClose }) => {
  const navigate = useNavigate();
  const [locations, setLocations] = useState([]);
  const [targetLocationId, setTargetLocationId] = useState('');
  const [shipDate, setShipDate] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState(1); // 1: Select location, 2: Configure variant mapping
  const [familyGroups, setFamilyGroups] = useState([]);
  const [variantMapping, setVariantMapping] = useState({});
  const [availableVariants, setAvailableVariants] = useState({});
  const [skipFamilies, setSkipFamilies] = useState(new Set()); // Families to exclude from copy

  useEffect(() => {
    fetchLocations();
    fetchFamilyGroups();
  }, []);

  const fetchLocations = async () => {
    try {
      const response = await api.get('/locations');
      setLocations(response.data.locations || []);
    } catch (err) {
      console.error('Error fetching locations:', err);
      setError('Failed to load locations');
    }
  };

  const fetchFamilyGroups = async () => {
    try {
      const response = await api.get(`/orders/${orderId}/family-groups`);
      setFamilyGroups(response.data.families || []);
    } catch (err) {
      console.error('Error fetching family groups:', err);
      setError('Failed to load product families');
    }
  };

  const handleNextStep = async () => {
    if (!targetLocationId) {
      setError('Please select a target location');
      return;
    }

    // Fetch available variants for each family
    setLoading(true);
    try {
      const variantsData = {};
      for (const family of familyGroups) {
        const response = await api.get(`/product-families/variants?brandId=${order.brand_id}&baseName=${encodeURIComponent(family.base_name)}`);
        variantsData[family.base_name] = response.data.colorGroups || {};
      }
      setAvailableVariants(variantsData);
      setStep(2);
    } catch (err) {
      console.error('Error fetching variants:', err);
      setError('Failed to load variant options');
    } finally {
      setLoading(false);
    }
  };

  const handleColorMapping = (baseName, sourceColor, targetColor) => {
    setVariantMapping({
      ...variantMapping,
      [baseName]: {
        ...variantMapping[baseName],
        color: { from: sourceColor, to: targetColor }
      }
    });
  };

  const toggleSkipFamily = (baseName) => {
    const newSkip = new Set(skipFamilies);
    if (newSkip.has(baseName)) {
      newSkip.delete(baseName);
    } else {
      newSkip.add(baseName);
    }
    setSkipFamilies(newSkip);
  };

  const buildVariantMappingPayload = () => {
    // Transform the mapping into the format expected by the backend
    const mapping = {};

    Object.entries(variantMapping).forEach(([baseName, config]) => {
      if (config.color) {
        mapping[baseName] = {};

        // Find the family to get all sizes
        const family = familyGroups.find(f => f.base_name === baseName);
        if (family && family.items) {
          family.items.forEach(item => {
            if (item.color === config.color.from) {
              mapping[baseName][item.size] = {
                from: config.color.from,
                to: config.color.to
              };
            }
          });
        }
      }
    });

    return mapping;
  };

  const handleCopyOrder = async () => {
    try {
      setLoading(true);
      setError('');

      const payload = {
        targetLocationId,
        shipDate: shipDate || undefined,
        notes: notes || undefined
      };

      // Add variant mapping if any exists
      const mappingPayload = buildVariantMappingPayload();
      if (Object.keys(mappingPayload).length > 0) {
        payload.variantMapping = mappingPayload;
      }

      // Add skip families if any are selected
      if (skipFamilies.size > 0) {
        payload.skipFamilies = Array.from(skipFamilies);
      }

      const response = await api.post(`/orders/${orderId}/copy`, payload);
      navigate(`/orders/${response.data.order.id}`);
    } catch (err) {
      console.error('Error copying order:', err);
      setError(err.response?.data?.error || 'Failed to copy order');
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50 overflow-y-auto">
      <div className="bg-white rounded-lg p-6 max-w-4xl w-full my-8 max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl font-bold mb-4">Copy Order to Another Location</h2>

        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded-md p-3">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        {step === 1 ? (
          <div className="space-y-4">
            <div>
              <p className="text-sm text-gray-600 mb-4">
                This will create a new order in the selected location. You'll be able to map product variants (e.g., change White to Black) in the next step.
              </p>
              <p className="text-sm text-gray-600 mb-4">
                Source: <strong>{order.location_name}</strong>
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Target Location *
              </label>
              <select
                value={targetLocationId}
                onChange={(e) => setTargetLocationId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
                required
              >
                <option value="">Select Location</option>
                {locations
                  .filter(loc => loc.id !== order.location_id)
                  .map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name} ({location.code})
                    </option>
                  ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Ship Date (optional)
              </label>
              <input
                type="date"
                value={shipDate}
                onChange={(e) => setShipDate(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Notes (optional)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
                rows={3}
                placeholder="Add any notes about this copy..."
              />
            </div>

            <div className="flex justify-end space-x-2 mt-6 pt-4 border-t">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                disabled={loading}
              >
                Cancel
              </button>
              <button
                onClick={handleNextStep}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400"
                disabled={loading || !targetLocationId}
              >
                {loading ? 'Loading...' : 'Next: Configure Variants'}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <p className="text-sm text-gray-600 mb-4">
                Optionally map product variants. For example, if the source order has White products, you can map them to Black for the target location.
              </p>
            </div>

            <div className="space-y-6">
              {familyGroups.map((family) => {
                const colors = Object.keys(availableVariants[family.base_name] || {});
                const sourceColor = family.color || 'default';
                const isSkipped = skipFamilies.has(family.base_name);

                return (
                  <div key={family.base_name} className={`border rounded-md p-4 ${isSkipped ? 'border-gray-300 bg-gray-50 opacity-60' : 'border-gray-200'}`}>
                    <div className="flex items-start justify-between mb-2">
                      <h3 className={`font-semibold ${isSkipped ? 'text-gray-500 line-through' : 'text-gray-900'}`}>
                        {family.base_name}
                      </h3>
                      <label className="flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isSkipped}
                          onChange={() => toggleSkipFamily(family.base_name)}
                          className="mr-2 h-4 w-4 text-red-600 border-gray-300 rounded focus:ring-red-500"
                        />
                        <span className="text-sm text-gray-600">Skip</span>
                      </label>
                    </div>
                    <div className="text-sm text-gray-600 mb-3">
                      {family.items.length} items in source order (Color: {sourceColor})
                    </div>

                    {!isSkipped && colors.length > 1 ? (
                      <div className="flex items-center space-x-3">
                        <span className="text-sm text-gray-700">Map color:</span>
                        <span className="px-3 py-1 bg-gray-100 rounded text-sm font-medium">
                          {sourceColor}
                        </span>
                        <span className="text-gray-500">→</span>
                        <select
                          value={variantMapping[family.base_name]?.color?.to || ''}
                          onChange={(e) => handleColorMapping(family.base_name, sourceColor, e.target.value)}
                          className="px-3 py-1 border border-gray-300 rounded-md text-sm"
                        >
                          <option value="">Keep same ({sourceColor})</option>
                          {colors.filter(c => c !== sourceColor).map((color) => (
                            <option key={color} value={color}>
                              {color}
                            </option>
                          ))}
                        </select>
                      </div>
                    ) : !isSkipped ? (
                      <div className="text-sm text-gray-500">
                        Only one color available - no mapping needed
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>

            {skipFamilies.size > 0 && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3">
                <p className="text-sm text-yellow-800">
                  <strong>{skipFamilies.size}</strong> of {familyGroups.length} product families will be skipped.
                  {familyGroups.length - skipFamilies.size === 0 && (
                    <span className="text-red-600 ml-1">Warning: No products will be copied!</span>
                  )}
                </p>
              </div>
            )}

            <div className="flex justify-between space-x-2 mt-6 pt-4 border-t">
              <button
                type="button"
                onClick={() => setStep(1)}
                className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                disabled={loading}
              >
                ← Back
              </button>
              <div className="flex space-x-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                  disabled={loading}
                >
                  Cancel
                </button>
                <button
                  onClick={handleCopyOrder}
                  className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-400"
                  disabled={loading || familyGroups.length - skipFamilies.size === 0}
                >
                  {loading ? 'Copying...' : `Copy ${familyGroups.length - skipFamilies.size} Families`}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default OrderBuilder;
