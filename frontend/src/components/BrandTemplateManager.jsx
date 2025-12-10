import { useState, useEffect } from 'react';
import { brandTemplateAPI } from '../services/api';
import TemplateUploadModal from './TemplateUploadModal';

const BrandTemplateManager = ({ brandId, brandName }) => {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  useEffect(() => {
    fetchTemplates();
  }, [brandId]);

  const fetchTemplates = async () => {
    try {
      setLoading(true);
      const response = await brandTemplateAPI.getAll(brandId);
      setTemplates(response.data.templates);
    } catch (err) {
      console.error('Error fetching templates:', err);
      setError('Failed to load templates');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (template) => {
    if (!window.confirm(`Delete template "${template.name}"? This cannot be undone.`)) {
      return;
    }

    setDeletingId(template.id);
    try {
      await brandTemplateAPI.delete(template.id);
      setTemplates(templates.filter(t => t.id !== template.id));
    } catch (err) {
      console.error('Error deleting template:', err);
      setError('Failed to delete template');
    } finally {
      setDeletingId(null);
    }
  };

  const handleDownload = async (template) => {
    try {
      const response = await brandTemplateAPI.download(template.id);
      const blob = new Blob([response.data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = template.original_filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Error downloading template:', err);
      setError('Failed to download template');
    }
  };

  const handleUploadSuccess = () => {
    setShowUploadModal(false);
    setEditingTemplate(null);
    fetchTemplates();
  };

  const getMappedFieldsCount = (mappings) => {
    if (!mappings || typeof mappings !== 'object') return 0;
    return Object.keys(mappings).length;
  };

  if (loading) {
    return (
      <div className="p-4 text-center text-gray-500">
        Loading templates...
      </div>
    );
  }

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-medium text-gray-700">Order Form Templates</h4>
        <button
          onClick={() => setShowUploadModal(true)}
          className="text-sm bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-700"
        >
          + Add Template
        </button>
      </div>

      {error && (
        <div className="mb-3 p-2 bg-red-50 text-red-700 rounded text-sm">
          {error}
          <button onClick={() => setError('')} className="ml-2 text-red-500 hover:text-red-700">×</button>
        </div>
      )}

      {templates.length === 0 ? (
        <div className="text-center py-6 bg-gray-50 rounded border border-dashed border-gray-300">
          <p className="text-gray-500 text-sm">No templates yet</p>
          <p className="text-gray-400 text-xs mt-1">Upload an Excel template to use for exports</p>
        </div>
      ) : (
        <div className="space-y-2">
          {templates.map(template => (
            <div
              key={template.id}
              className="flex items-center justify-between p-3 bg-gray-50 rounded border border-gray-200"
            >
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-800">{template.name}</span>
                  <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                    {getMappedFieldsCount(template.column_mappings)} fields mapped
                  </span>
                </div>
                {template.description && (
                  <p className="text-xs text-gray-500 mt-0.5">{template.description}</p>
                )}
                <p className="text-xs text-gray-400 mt-0.5">
                  File: {template.original_filename} | Data starts at row {template.data_start_row}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleDownload(template)}
                  className="p-1.5 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded"
                  title="Download template"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                </button>
                <button
                  onClick={() => setEditingTemplate(template)}
                  className="p-1.5 text-gray-500 hover:text-green-600 hover:bg-green-50 rounded"
                  title="Edit template"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>
                <button
                  onClick={() => handleDelete(template)}
                  disabled={deletingId === template.id}
                  className="p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded disabled:opacity-50"
                  title="Delete template"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {(showUploadModal || editingTemplate) && (
        <TemplateUploadModal
          brandId={brandId}
          brandName={brandName}
          existingTemplate={editingTemplate}
          onClose={() => { setShowUploadModal(false); setEditingTemplate(null); }}
          onSuccess={handleUploadSuccess}
        />
      )}
    </div>
  );
};

export default BrandTemplateManager;
