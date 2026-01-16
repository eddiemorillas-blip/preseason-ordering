import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import Layout from '../components/Layout';
import AgentChat from '../components/AgentChat';
import SuggestionCard from '../components/SuggestionCard';
import SuggestionsTable from '../components/SuggestionsTable';
import { agentAPI } from '../services/api';
import api from '../services/api';

const AIAssistant = () => {
  const [searchParams, setSearchParams] = useSearchParams();

  // Context filters (optional)
  const [seasons, setSeasons] = useState([]);
  const [brands, setBrands] = useState([]);
  const [locations, setLocations] = useState([]);

  const [selectedSeasonId, setSelectedSeasonId] = useState(searchParams.get('season') || '');
  const [selectedBrandId, setSelectedBrandId] = useState(searchParams.get('brand') || '');
  const [selectedLocationId, setSelectedLocationId] = useState(searchParams.get('location') || '');

  // Conversation state
  const [conversations, setConversations] = useState([]);
  const [currentConversation, setCurrentConversation] = useState(null);
  const [conversationsLoading, setConversationsLoading] = useState(false);

  // Suggestions state
  const [suggestions, setSuggestions] = useState([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);

  // Usage state
  const [usage, setUsage] = useState(null);

  // UI state
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [activeTab, setActiveTab] = useState('chat'); // 'chat' | 'suggestions' | 'history'
  const [viewMode, setViewMode] = useState('table'); // 'table' | 'cards'

  // Load filter options
  useEffect(() => {
    const fetchFilters = async () => {
      try {
        const [seasonsRes, brandsRes, locationsRes] = await Promise.all([
          api.get('/seasons'),
          api.get('/brands'),
          api.get('/locations')
        ]);
        setSeasons(seasonsRes.data.seasons || []);
        setBrands(brandsRes.data.brands || []);
        setLocations(locationsRes.data.locations || []);
      } catch (err) {
        console.error('Error fetching filters:', err);
      }
    };
    fetchFilters();
  }, []);

  // Load conversations
  useEffect(() => {
    loadConversations();
    loadUsage();
  }, []);

  // Load suggestions when conversation changes
  useEffect(() => {
    if (currentConversation) {
      loadSuggestions();
    }
  }, [currentConversation]);

  // Update URL when filters change
  useEffect(() => {
    const params = {};
    if (selectedSeasonId) params.season = selectedSeasonId;
    if (selectedBrandId) params.brand = selectedBrandId;
    if (selectedLocationId) params.location = selectedLocationId;
    setSearchParams(params);
  }, [selectedSeasonId, selectedBrandId, selectedLocationId]);

  const loadConversations = async () => {
    setConversationsLoading(true);
    try {
      const response = await agentAPI.getConversations();
      setConversations(response.data.conversations || []);

      // If no current conversation, create one
      if (response.data.conversations.length === 0) {
        await createNewConversation();
      } else {
        // Select most recent conversation
        setCurrentConversation(response.data.conversations[0]);
      }
    } catch (err) {
      console.error('Error loading conversations:', err);
    } finally {
      setConversationsLoading(false);
    }
  };

  const loadSuggestions = async () => {
    if (!currentConversation) return;

    setSuggestionsLoading(true);
    try {
      const response = await agentAPI.getSuggestions({
        conversationId: currentConversation.id,
        status: 'pending'
      });
      setSuggestions(response.data.suggestions || []);
    } catch (err) {
      console.error('Error loading suggestions:', err);
    } finally {
      setSuggestionsLoading(false);
    }
  };

  const loadUsage = async () => {
    try {
      const response = await agentAPI.getUsage();
      setUsage(response.data.usage);
    } catch (err) {
      console.error('Error loading usage:', err);
    }
  };

  const createNewConversation = async () => {
    try {
      const response = await agentAPI.createConversation({
        seasonId: selectedSeasonId || null,
        brandId: selectedBrandId || null,
        locationId: selectedLocationId || null,
        title: 'New Conversation'
      });

      const newConv = {
        id: response.data.conversation.id,
        title: 'New Conversation',
        created_at: response.data.conversation.created_at,
        message_count: 0,
        suggestion_count: 0,
        total_cost: '0.0000'
      };

      setConversations(prev => [newConv, ...prev]);
      setCurrentConversation(newConv);
      setSuggestions([]);
    } catch (err) {
      console.error('Error creating conversation:', err);
    }
  };

  const handleSuggestionUpdate = () => {
    loadSuggestions();
    loadConversations();
  };

  const getContextDisplay = () => {
    const parts = [];
    if (selectedSeasonId) {
      const season = seasons.find(s => s.id === parseInt(selectedSeasonId));
      if (season) parts.push(season.name);
    }
    if (selectedBrandId) {
      const brand = brands.find(b => b.id === parseInt(selectedBrandId));
      if (brand) parts.push(brand.name);
    }
    if (selectedLocationId) {
      const location = locations.find(l => l.id === parseInt(selectedLocationId));
      if (location) parts.push(location.name);
    }
    return parts.length > 0 ? parts.join(' • ') : 'No specific context';
  };

  return (
    <Layout>
      <div className="space-y-6">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-800 flex items-center space-x-2">
                <svg className="w-8 h-8 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                <span>AI Assistant</span>
              </h1>
              <p className="text-gray-600 mt-1">
                Your intelligent retail buying assistant powered by Claude
              </p>
            </div>

            {/* Usage Display */}
            {usage && (
              <div className="text-right">
                <div className="text-sm text-gray-600 mb-1">Monthly Budget</div>
                <div className="flex items-baseline space-x-2">
                  <span className="text-2xl font-bold text-gray-800">
                    ${parseFloat(usage.total_cost).toFixed(2)}
                  </span>
                  <span className="text-gray-500">/ ${parseFloat(usage.max_monthly_cost).toFixed(0)}</span>
                </div>
                <div className="w-48 h-2 bg-gray-200 rounded-full mt-2 overflow-hidden">
                  <div
                    className={`h-full transition-all ${
                      parseFloat(usage.budget_utilization_pct) > 80 ? 'bg-red-500' :
                      parseFloat(usage.budget_utilization_pct) > 60 ? 'bg-yellow-500' :
                      'bg-green-500'
                    }`}
                    style={{ width: `${Math.min(parseFloat(usage.budget_utilization_pct), 100)}%` }}
                  />
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {usage.conversation_count} conversations • {usage.message_count} messages
                </div>
              </div>
            )}
          </div>

          {/* Context Filters */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Season (Optional)
              </label>
              <select
                value={selectedSeasonId}
                onChange={(e) => setSelectedSeasonId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">All Seasons</option>
                {seasons.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Brand (Optional)
              </label>
              <select
                value={selectedBrandId}
                onChange={(e) => setSelectedBrandId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">All Brands</option>
                {brands.map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Location (Optional)
              </label>
              <select
                value={selectedLocationId}
                onChange={(e) => setSelectedLocationId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="">All Locations</option>
                {locations.map(l => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </div>

            <div className="flex items-end">
              <button
                onClick={createNewConversation}
                className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center justify-center space-x-2"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
                <span>New Conversation</span>
              </button>
            </div>
          </div>

          <div className="mt-3 text-sm text-gray-500 bg-blue-50 rounded p-3">
            <strong>Context:</strong> {getContextDisplay()}
          </div>
        </div>

        {/* Main Content */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Chat Panel */}
          <div className="lg:col-span-2">
            {currentConversation ? (
              <AgentChat
                conversationId={currentConversation.id}
                context={{
                  seasonName: seasons.find(s => s.id === parseInt(selectedSeasonId))?.name,
                  brandName: brands.find(b => b.id === parseInt(selectedBrandId))?.name,
                  locationName: locations.find(l => l.id === parseInt(selectedLocationId))?.name
                }}
                onSuggestionCreated={handleSuggestionUpdate}
                collapsed={chatCollapsed}
                onToggleCollapse={() => setChatCollapsed(!chatCollapsed)}
              />
            ) : (
              <div className="bg-white rounded-lg shadow-md p-8 text-center">
                <p className="text-gray-500">Loading conversation...</p>
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Pending Suggestions */}
            <div className="bg-white rounded-lg shadow-md">
              <div className="px-4 py-3 border-b bg-gray-50 flex items-center justify-between">
                <h2 className="font-semibold text-gray-800 flex items-center space-x-2">
                  <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                  </svg>
                  <span>Pending Suggestions</span>
                </h2>
                <div className="flex items-center space-x-3">
                  <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded-full font-medium">
                    {suggestions.length}
                  </span>
                  {suggestions.length > 0 && (
                    <div className="flex bg-gray-100 rounded-lg p-1">
                      <button
                        onClick={() => setViewMode('table')}
                        className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                          viewMode === 'table' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-800'
                        }`}
                      >
                        Table
                      </button>
                      <button
                        onClick={() => setViewMode('cards')}
                        className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                          viewMode === 'cards' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-800'
                        }`}
                      >
                        Cards
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <div className="max-h-[600px] overflow-y-auto">
                {suggestionsLoading ? (
                  <div className="text-center py-8 text-gray-500">
                    <svg className="animate-spin h-8 w-8 mx-auto mb-2 text-blue-600" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <p>Loading suggestions...</p>
                  </div>
                ) : suggestions.length === 0 ? (
                  <div className="text-center py-8 text-gray-500 p-4">
                    <svg className="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <p>No pending suggestions</p>
                    <p className="text-xs mt-1">Ask the AI for order optimization suggestions</p>
                  </div>
                ) : viewMode === 'table' ? (
                  <SuggestionsTable
                    suggestions={suggestions}
                    onUpdate={handleSuggestionUpdate}
                  />
                ) : (
                  <div className="p-4 space-y-4">
                    {suggestions.map(suggestion => (
                      <SuggestionCard
                        key={suggestion.id}
                        suggestion={suggestion}
                        onUpdate={handleSuggestionUpdate}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Recent Conversations */}
            <div className="bg-white rounded-lg shadow-md">
              <div className="px-4 py-3 border-b bg-gray-50">
                <h2 className="font-semibold text-gray-800">Recent Conversations</h2>
              </div>
              <div className="p-2 space-y-1 max-h-64 overflow-y-auto">
                {conversations.slice(0, 10).map(conv => (
                  <button
                    key={conv.id}
                    onClick={() => setCurrentConversation(conv)}
                    className={`w-full text-left px-3 py-2 rounded-lg transition-colors ${
                      currentConversation?.id === conv.id
                        ? 'bg-blue-100 text-blue-800'
                        : 'hover:bg-gray-100 text-gray-700'
                    }`}
                  >
                    <div className="text-sm font-medium truncate">
                      {conv.title || 'Conversation'}
                    </div>
                    <div className="text-xs text-gray-500 flex items-center justify-between mt-1">
                      <span>{conv.message_count} messages</span>
                      <span>{new Date(conv.created_at).toLocaleDateString()}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Help Section */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
          <h3 className="font-semibold text-gray-800 mb-3 flex items-center space-x-2">
            <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>What can the AI Assistant do?</span>
          </h3>
          <ul className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-gray-700">
            <li className="flex items-start space-x-2">
              <span className="text-green-600 mt-0.5">✓</span>
              <span>Query historical sales data and trends</span>
            </li>
            <li className="flex items-start space-x-2">
              <span className="text-green-600 mt-0.5">✓</span>
              <span>Analyze sales velocity and inventory levels</span>
            </li>
            <li className="flex items-start space-x-2">
              <span className="text-green-600 mt-0.5">✓</span>
              <span>Suggest order quantity adjustments</span>
            </li>
            <li className="flex items-start space-x-2">
              <span className="text-green-600 mt-0.5">✓</span>
              <span>Recommend products to add or remove</span>
            </li>
            <li className="flex items-start space-x-2">
              <span className="text-green-600 mt-0.5">✓</span>
              <span>Check budget utilization and remaining funds</span>
            </li>
            <li className="flex items-start space-x-2">
              <span className="text-green-600 mt-0.5">✓</span>
              <span>Create new orders based on sales data</span>
            </li>
          </ul>
        </div>
      </div>
    </Layout>
  );
};

export default AIAssistant;
