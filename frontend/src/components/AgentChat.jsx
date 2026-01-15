import { useState, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';

const AgentChat = ({
  conversationId,
  context = {},
  onSuggestionCreated,
  collapsed = false,
  onToggleCollapse
}) => {
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [usage, setUsage] = useState(null);
  const [error, setError] = useState(null);
  const messagesEndRef = useRef(null);

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Load messages when conversation ID changes
  useEffect(() => {
    if (conversationId) {
      loadMessages();
      loadUsage();
    }
  }, [conversationId]);

  const loadMessages = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/agent/conversations/${conversationId}/messages`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) throw new Error('Failed to load messages');

      const data = await response.json();
      setMessages(data.messages || []);
    } catch (err) {
      console.error('Error loading messages:', err);
      setError('Failed to load chat history');
    }
  };

  const loadUsage = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch('/api/agent/usage', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) throw new Error('Failed to load usage');

      const data = await response.json();
      setUsage(data.usage);
    } catch (err) {
      console.error('Error loading usage:', err);
    }
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!inputMessage.trim() || loading) return;

    const userMessage = inputMessage.trim();
    setInputMessage('');
    setLoading(true);
    setError(null);

    // Add user message to UI immediately
    const tempUserMsg = {
      id: Date.now(),
      role: 'user',
      content: userMessage,
      created_at: new Date().toISOString()
    };
    setMessages(prev => [...prev, tempUserMsg]);

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/agent/conversations/${conversationId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ message: userMessage })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to send message');
      }

      const data = await response.json();

      // Add assistant response
      const assistantMsg = {
        id: data.message_id,
        role: 'assistant',
        content: data.content,
        created_at: new Date().toISOString(),
        usage: data.usage
      };
      setMessages(prev => [...prev, assistantMsg]);

      // Reload messages to get any system messages (tool results)
      await loadMessages();
      await loadUsage();

      // Notify parent if suggestions were created
      if (data.tool_results?.some(tr => tr.result.success && tr.result.suggestion_id)) {
        onSuggestionCreated?.();
      }
    } catch (err) {
      console.error('Error sending message:', err);
      setError(err.message);
      // Remove the temporary user message on error
      setMessages(prev => prev.filter(m => m.id !== tempUserMsg.id));
    } finally {
      setLoading(false);
    }
  };

  const formatCost = (cost) => {
    return `$${parseFloat(cost).toFixed(4)}`;
  };

  const formatTimestamp = (timestamp) => {
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit'
    });
  };

  if (collapsed) {
    return (
      <div className="bg-white rounded-lg shadow-md">
        <button
          onClick={onToggleCollapse}
          className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center space-x-2">
            <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
            <span className="font-semibold text-gray-700">AI Assistant</span>
            {messages.length > 0 && (
              <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs rounded-full">
                {messages.length}
              </span>
            )}
          </div>
          <svg className="w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-md">
      {/* Header */}
      <div className="px-4 py-3 border-b flex items-center justify-between bg-blue-50">
        <div className="flex items-center space-x-2">
          <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
          <span className="font-semibold text-gray-700">AI Assistant</span>
          {context.seasonName && (
            <span className="text-xs text-gray-500">
              {context.seasonName}
              {context.brandName && ` • ${context.brandName}`}
              {context.locationName && ` • ${context.locationName}`}
            </span>
          )}
        </div>
        <div className="flex items-center space-x-3">
          {usage && (
            <div className="text-xs text-gray-600">
              <span className="font-medium">{formatCost(usage.total_cost)}</span>
              <span className="text-gray-400"> / </span>
              <span>{formatCost(usage.max_monthly_cost)}</span>
              <span className="ml-1 text-gray-500">({usage.budget_utilization_pct}%)</span>
            </div>
          )}
          <button
            onClick={onToggleCollapse}
            className="p-1 rounded hover:bg-blue-100 transition-colors"
            title="Collapse"
          >
            <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="h-96 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && !loading && (
          <div className="text-center text-gray-500 mt-16">
            <svg className="w-12 h-12 mx-auto mb-3 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <p className="text-sm">Start a conversation with the AI assistant</p>
            <p className="text-xs text-gray-400 mt-1">Ask about sales data, inventory, or order optimization</p>
          </div>
        )}

        {messages.map((msg, idx) => (
          <div
            key={msg.id || idx}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-lg px-4 py-2 ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : msg.role === 'system'
                  ? 'bg-gray-100 text-gray-600 text-xs'
                  : 'bg-gray-100 text-gray-800'
              }`}
            >
              {msg.role !== 'system' && (
                <div className="text-xs opacity-70 mb-1">
                  {msg.role === 'user' ? 'You' : 'AI Assistant'} • {formatTimestamp(msg.created_at)}
                </div>
              )}
              <div className="whitespace-pre-wrap">{msg.content}</div>
              {msg.usage && (
                <div className="text-xs opacity-70 mt-1">
                  {formatCost(msg.usage.cost)} • {msg.usage.tokens} tokens • {msg.usage.response_time_ms}ms
                </div>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-gray-100 rounded-lg px-4 py-3">
              <div className="flex space-x-2">
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Error Display */}
      {error && (
        <div className="px-4 py-2 bg-red-50 border-t border-red-200">
          <div className="flex items-center space-x-2 text-red-700 text-sm">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
            <span>{error}</span>
            <button
              onClick={() => setError(null)}
              className="ml-auto text-red-500 hover:text-red-700"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* Input Form */}
      <form onSubmit={sendMessage} className="px-4 py-3 border-t bg-gray-50">
        <div className="flex space-x-2">
          <input
            type="text"
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            placeholder="Ask about sales, inventory, or order optimization..."
            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !inputMessage.trim()}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed flex items-center space-x-2"
          >
            {loading ? (
              <>
                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span>Thinking...</span>
              </>
            ) : (
              <>
                <span>Send</span>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
};

AgentChat.propTypes = {
  conversationId: PropTypes.number.isRequired,
  context: PropTypes.shape({
    seasonName: PropTypes.string,
    brandName: PropTypes.string,
    locationName: PropTypes.string
  }),
  onSuggestionCreated: PropTypes.func,
  collapsed: PropTypes.bool,
  onToggleCollapse: PropTypes.func
};

export default AgentChat;
