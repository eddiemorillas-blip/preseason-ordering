import { useState, useEffect, useRef, useCallback } from 'react';
import api from '../services/api';

const THINKING_MESSAGES = [
  'Thinking...',
  'Querying database...',
  'Checking inventory...',
  'Analyzing data...',
  'Running tools...',
  'Processing results...',
  'Almost there...',
];

const RevisionChat = ({ brandId, seasonId, orderIds, brandName, revisionContext, onDecisionsChange }) => {
  const [conversationId, setConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [model, setModel] = useState('sonnet');
  const [collapsed, setCollapsed] = useState(false);
  const [thinkingMsg, setThinkingMsg] = useState(0);
  const thinkingInterval = useRef(null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // Create conversation on mount or when brand changes
  useEffect(() => {
    createConversation();
  }, [brandId, seasonId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const createConversation = async () => {
    try {
      const res = await api.post('/revisions/chat/conversations', { brandId, seasonId });
      setConversationId(res.data.conversationId);
      setMessages([]);
    } catch (err) {
      console.error('Failed to create conversation:', err);
    }
  };

  const sendMessage = async (text) => {
    if (!text?.trim() || !conversationId || sending) return;

    const userMsg = { role: 'user', content: text, created_at: new Date() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setSending(true);
    setThinkingMsg(0);
    thinkingInterval.current = setInterval(() => {
      setThinkingMsg(prev => (prev + 1) % THINKING_MESSAGES.length);
    }, 3000);

    try {
      const res = await api.post(`/revisions/chat/conversations/${conversationId}/messages`, {
        message: text,
        model,
        context: { brandId, seasonId, orderIds, revisionContext }
      });

      let content = res.data.content;

      // Check for decision changes from modify_decision tool
      const dcMatch = content.match(/__decisionChanges__(.+?)__end__/s);
      if (dcMatch && onDecisionsChange) {
        try {
          const changes = JSON.parse(dcMatch[1]);
          onDecisionsChange(changes);
        } catch (e) { /* parse error, ignore */ }
        // Strip the marker from displayed content
        content = content.replace(/__decisionChanges__.+?__end__/s, '').trim();
      }

      const assistantMsg = {
        role: 'assistant',
        content,
        toolResults: res.data.toolResults,
        usage: res.data.usage,
        model: res.data.model,
        created_at: new Date()
      };
      setMessages(prev => [...prev, assistantMsg]);
    } catch (err) {
      const errorMsg = {
        role: 'assistant',
        content: `Error: ${err.response?.data?.error || err.message}`,
        isError: true,
        created_at: new Date()
      };
      setMessages(prev => [...prev, errorMsg]);
    } finally {
      setSending(false);
      clearInterval(thinkingInterval.current);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const quickActions = [
    { label: 'Check inventory', prompt: `Check current inventory levels for ${brandName || 'this brand'} across all locations` },
    { label: 'Run revision', prompt: `Run a revision preview for the selected ${brandName || ''} orders` },
    { label: 'Add rule', prompt: 'I want to add a new ordering rule: ' },
    { label: 'Compare revisions', prompt: `Compare all revisions for ${brandName || 'this brand'} this season` },
  ];

  if (collapsed) {
    return (
      <div className="w-12 border-l bg-gray-50 flex flex-col items-center py-4 flex-shrink-0">
        <button
          onClick={() => setCollapsed(false)}
          className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center hover:bg-blue-700"
          title="Open AI Chat"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div className="w-80 border-l bg-white flex flex-col flex-shrink-0">
      {/* Header */}
      <div className="px-3 py-2 border-b flex items-center justify-between bg-gray-50">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
          </svg>
          <span className="text-sm font-medium text-gray-700">AI Assistant</span>
        </div>
        <div className="flex items-center gap-1">
          <select
            value={model}
            onChange={e => setModel(e.target.value)}
            className="text-xs border border-gray-200 rounded px-1 py-0.5 bg-white"
          >
            <option value="sonnet">Sonnet</option>
            <option value="opus">Opus</option>
          </select>
          <button onClick={() => createConversation()} className="text-gray-400 hover:text-gray-600 p-1" title="New conversation">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
          <button onClick={() => setCollapsed(true)} className="text-gray-400 hover:text-gray-600 p-1" title="Collapse">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-center py-8">
            <p className="text-sm text-gray-400 mb-4">Ask me about orders, inventory, or revision rules.</p>
            <div className="space-y-1">
              {quickActions.map((qa, i) => (
                <button
                  key={i}
                  onClick={() => { setInput(qa.prompt); if (!qa.prompt.endsWith(': ')) sendMessage(qa.prompt); }}
                  className="block w-full text-left px-3 py-2 text-xs bg-gray-50 text-gray-600 rounded hover:bg-blue-50 hover:text-blue-700"
                >
                  {qa.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, idx) => (
          <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[90%] rounded-lg px-3 py-2 text-sm ${
              msg.role === 'user'
                ? 'bg-blue-600 text-white'
                : msg.isError
                  ? 'bg-red-50 text-red-800 border border-red-200'
                  : 'bg-gray-100 text-gray-800'
            }`}>
              <div className="whitespace-pre-wrap break-words">{msg.content}</div>
              {msg.toolResults && msg.toolResults.length > 0 && (
                <div className="mt-2 pt-2 border-t border-gray-200">
                  <p className="text-xs text-gray-500 mb-1">{msg.toolResults.length} tool{msg.toolResults.length !== 1 ? 's' : ''} used</p>
                  {msg.toolResults.map((tr, i) => (
                    <details key={i} className="text-xs">
                      <summary className="cursor-pointer text-gray-500 hover:text-gray-700">{tr.tool}</summary>
                      <pre className="mt-1 p-1 bg-gray-50 rounded text-xs overflow-x-auto max-h-32 overflow-y-auto">{
                        typeof tr.result === 'string' ? tr.result.substring(0, 500) : JSON.stringify(tr.result, null, 2).substring(0, 500)
                      }</pre>
                    </details>
                  ))}
                </div>
              )}
              {msg.usage && (
                <p className="text-xs text-gray-400 mt-1">${msg.usage.cost} · {msg.usage.inputTokens + msg.usage.outputTokens} tokens</p>
              )}
            </div>
          </div>
        ))}

        {sending && (
          <div className="flex justify-start">
            <div className="bg-gray-100 rounded-lg px-3 py-2">
              <div className="flex items-center gap-2">
                <div className="flex gap-1">
                  <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                  <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                  <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                </div>
                <span className="text-xs text-gray-500 transition-opacity">{THINKING_MESSAGES[thinkingMsg]}</span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-3 border-t">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about orders, rules..."
            className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm resize-none"
            rows={2}
            disabled={sending || !conversationId}
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={sending || !input.trim() || !conversationId}
            className="px-3 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:bg-gray-300 self-end"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
};

export default RevisionChat;
