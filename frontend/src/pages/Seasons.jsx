import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import Layout from '../components/Layout';
import { useAuth } from '../context/AuthContext';

const Seasons = () => {
  const navigate = useNavigate();
  const { isAdmin } = useAuth();
  const [seasons, setSeasons] = useState([]);
  const [brands, setBrands] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [collapsedSeasons, setCollapsedSeasons] = useState({});
  const [seasonToDelete, setSeasonToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const [newSeason, setNewSeason] = useState({
    name: '',
    start_date: '',
    end_date: '',
    status: 'planning'
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [seasonsRes, brandsRes] = await Promise.all([
        api.get('/seasons'),
        api.get('/brands')
      ]);
      setSeasons(seasonsRes.data.seasons || []);
      setBrands(brandsRes.data.brands || []);
    } catch (err) {
      console.error('Error fetching data:', err);
      setError('Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const handleCreateSeason = async (e) => {
    e.preventDefault();
    try {
      await api.post('/seasons', newSeason);
      setShowCreateModal(false);
      setNewSeason({ name: '', start_date: '', end_date: '', status: 'planning' });
      fetchData();
    } catch (err) {
      console.error('Error creating season:', err);
      setError(err.response?.data?.error || 'Failed to create season');
    }
  };

  const handleStatusChange = async (seasonId, newStatus) => {
    try {
      await api.patch(`/seasons/${seasonId}`, { status: newStatus });
      fetchData();
    } catch (err) {
      console.error('Error updating season status:', err);
      setError('Failed to update season status');
    }
  };

  const toggleSeasonCollapse = (seasonId) => {
    setCollapsedSeasons(prev => ({
      ...prev,
      [seasonId]: !prev[seasonId]
    }));
  };

  const handleDeleteSeason = async () => {
    if (!seasonToDelete) return;

    setDeleting(true);
    try {
      await api.delete(`/seasons/${seasonToDelete.id}`);
      setSeasonToDelete(null);
      fetchData();
    } catch (err) {
      console.error('Error deleting season:', err);
      setError(err.response?.data?.error || 'Failed to delete season');
    } finally {
      setDeleting(false);
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'planning':
        return 'bg-blue-100 text-blue-800';
      case 'ordering':
        return 'bg-green-100 text-green-800';
      case 'closed':
        return 'bg-gray-100 text-gray-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  // Filter to only active brands
  const activeBrands = brands.filter(brand => brand.active !== false);

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Order Builder</h1>
            <p className="mt-2 text-sm text-gray-600">
              Select a season and brand to build orders
            </p>
          </div>
          {isAdmin() && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
              + New Season
            </button>
          )}
        </div>

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-md p-4">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="flex justify-center items-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
        )}

        {/* Seasons with Brands */}
        {!loading && (
          <div className="space-y-4">
            {seasons.length === 0 ? (
              <div className="bg-white rounded-lg shadow p-12 text-center">
                <h3 className="text-sm font-medium text-gray-900">No seasons found</h3>
                <p className="mt-1 text-sm text-gray-500">
                  {isAdmin() ? (
                    <button
                      onClick={() => setShowCreateModal(true)}
                      className="text-blue-600 hover:text-blue-800"
                    >
                      Create a season to get started
                    </button>
                  ) : (
                    'Contact an admin to create a season.'
                  )}
                </p>
              </div>
            ) : (
              seasons.map((season) => {
                const isCollapsed = collapsedSeasons[season.id];

                return (
                  <div key={season.id} className="bg-white rounded-lg shadow overflow-hidden">
                    {/* Season Header */}
                    <button
                      onClick={() => toggleSeasonCollapse(season.id)}
                      className="w-full px-6 py-4 bg-gray-50 border-b border-gray-200 flex items-center justify-between hover:bg-gray-100 transition-colors"
                    >
                      <div className="flex items-center space-x-3">
                        <svg
                          className={`w-5 h-5 text-gray-500 transform transition-transform ${
                            isCollapsed ? '' : 'rotate-90'
                          }`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                        <h2 className="text-lg font-semibold text-gray-900">
                          {season.name}
                        </h2>
                        <span
                          className={`px-2 py-1 text-xs font-semibold rounded-full ${getStatusColor(
                            season.status
                          )}`}
                        >
                          {season.status}
                        </span>
                      </div>
                      <div className="flex items-center space-x-4">
                        <span className="text-sm text-gray-500">
                          {season.start_date
                            ? new Date(season.start_date).toLocaleDateString()
                            : 'No start'}{' '}
                          -{' '}
                          {season.end_date
                            ? new Date(season.end_date).toLocaleDateString()
                            : 'No end'}
                        </span>
                        {isAdmin() && (
                          <>
                            <select
                              value={season.status}
                              onChange={(e) => {
                                e.stopPropagation();
                                handleStatusChange(season.id, e.target.value);
                              }}
                              onClick={(e) => e.stopPropagation()}
                              className="text-sm border rounded px-2 py-1"
                            >
                              <option value="planning">Planning</option>
                              <option value="ordering">Ordering</option>
                              <option value="closed">Closed</option>
                            </select>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setSeasonToDelete(season);
                              }}
                              className="p-1 text-red-600 hover:text-red-800 hover:bg-red-50 rounded"
                              title="Delete season"
                            >
                              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </>
                        )}
                      </div>
                    </button>

                    {/* Brands for this Season */}
                    {!isCollapsed && (
                      <div className="divide-y divide-gray-200">
                        {activeBrands.length === 0 ? (
                          <div className="px-6 py-8 text-center text-sm text-gray-500">
                            No brands found. Upload a catalog to add brands and products.
                          </div>
                        ) : (
                          activeBrands.map((brand) => (
                            <div
                              key={brand.id}
                              className="px-6 py-4 flex items-center justify-between hover:bg-gray-50"
                            >
                              <div className="flex items-center space-x-4">
                                <div className="text-sm font-medium text-gray-900">
                                  {brand.name}
                                </div>
                              </div>
                              <button
                                onClick={() => navigate(`/seasons/${season.id}?brand=${brand.id}`)}
                                className="px-4 py-2 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700"
                              >
                                Build Orders
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* Create Season Modal */}
        {showCreateModal && (
          <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-md w-full">
              <h2 className="text-xl font-bold mb-4">Create New Season</h2>
              <form onSubmit={handleCreateSeason} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Season Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={newSeason.name}
                    onChange={(e) => setNewSeason({ ...newSeason, name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    placeholder="e.g., Fall 2025"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Start Date
                  </label>
                  <input
                    type="date"
                    value={newSeason.start_date}
                    onChange={(e) => setNewSeason({ ...newSeason, start_date: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    End Date
                  </label>
                  <input
                    type="date"
                    value={newSeason.end_date}
                    onChange={(e) => setNewSeason({ ...newSeason, end_date: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  />
                </div>
                <div className="flex justify-end space-x-2 mt-6">
                  <button
                    type="button"
                    onClick={() => {
                      setShowCreateModal(false);
                      setNewSeason({ name: '', start_date: '', end_date: '', status: 'planning' });
                    }}
                    className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                  >
                    Create Season
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Delete Season Confirmation Modal */}
        {seasonToDelete && (
          <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-md w-full">
              <h2 className="text-xl font-bold text-gray-900 mb-4">Delete Season</h2>
              <p className="text-gray-600 mb-2">
                Are you sure you want to delete this season?
              </p>
              <div className="bg-gray-50 rounded-md p-3 mb-6">
                <p className="font-medium text-gray-900">{seasonToDelete.name}</p>
                <p className="text-sm text-gray-600">
                  {seasonToDelete.start_date
                    ? new Date(seasonToDelete.start_date).toLocaleDateString()
                    : 'No start date'}{' '}
                  -{' '}
                  {seasonToDelete.end_date
                    ? new Date(seasonToDelete.end_date).toLocaleDateString()
                    : 'No end date'}
                </p>
              </div>
              <p className="text-sm text-red-600 mb-4">
                This will permanently remove the season and all associated budgets. This action cannot be undone.
              </p>
              <div className="flex justify-end space-x-3">
                <button
                  onClick={() => setSeasonToDelete(null)}
                  className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
                  disabled={deleting}
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteSeason}
                  className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:bg-gray-400"
                  disabled={deleting}
                >
                  {deleting ? 'Deleting...' : 'Delete Season'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
};

export default Seasons;
