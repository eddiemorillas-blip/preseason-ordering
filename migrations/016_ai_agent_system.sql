-- AI Agent System Migration
-- Creates tables for conversational AI agent with suggestion approval workflow

BEGIN;

-- Table 1: Store AI agent conversation sessions
CREATE TABLE agent_conversations (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  season_id INTEGER REFERENCES seasons(id) ON DELETE SET NULL,
  brand_id INTEGER REFERENCES brands(id) ON DELETE SET NULL,
  location_id INTEGER REFERENCES locations(id) ON DELETE SET NULL,
  title VARCHAR(500),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_agent_conversations_user ON agent_conversations(user_id);
CREATE INDEX idx_agent_conversations_context ON agent_conversations(season_id, brand_id, location_id);
CREATE INDEX idx_agent_conversations_created ON agent_conversations(created_at DESC);

-- Table 2: Store individual messages in conversations
CREATE TABLE agent_messages (
  id SERIAL PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES agent_conversations(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  metadata JSONB, -- Store tool calls, reasoning, tokens used, etc.
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_agent_messages_conversation ON agent_messages(conversation_id);
CREATE INDEX idx_agent_messages_created ON agent_messages(created_at DESC);

-- Table 3: Store AI-generated suggestions with approval workflow
CREATE TABLE agent_suggestions (
  id SERIAL PRIMARY KEY,
  conversation_id INTEGER REFERENCES agent_conversations(id) ON DELETE CASCADE,
  message_id INTEGER REFERENCES agent_messages(id) ON DELETE CASCADE,
  suggestion_type VARCHAR(50) NOT NULL CHECK (suggestion_type IN (
    'adjust_quantity',
    'add_product',
    'remove_product',
    'change_ship_date',
    'adjust_budget',
    'other'
  )),

  -- Context
  order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  order_item_id INTEGER REFERENCES order_items(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,

  -- Action details (JSONB for flexibility)
  action_data JSONB NOT NULL,
  -- Examples:
  -- adjust_quantity: {"from": 10, "to": 15, "unit": "units"}
  -- add_product: {"product_id": 123, "quantity": 20, "unit_price": 45.50}
  -- remove_product: {"product_id": 123, "current_quantity": 10}

  -- Approval workflow
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN (
    'pending',
    'approved',
    'rejected',
    'applied',
    'failed'
  )),
  approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approved_at TIMESTAMP,
  rejected_at TIMESTAMP,
  applied_at TIMESTAMP,

  -- AI reasoning
  reasoning TEXT,
  confidence_score DECIMAL(3, 2), -- 0.00 to 1.00

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_agent_suggestions_conversation ON agent_suggestions(conversation_id);
CREATE INDEX idx_agent_suggestions_status ON agent_suggestions(status);
CREATE INDEX idx_agent_suggestions_order ON agent_suggestions(order_id);
CREATE INDEX idx_agent_suggestions_created ON agent_suggestions(created_at DESC);

-- Table 4: Track agent API usage for cost monitoring
CREATE TABLE agent_api_usage (
  id SERIAL PRIMARY KEY,
  conversation_id INTEGER REFERENCES agent_conversations(id) ON DELETE CASCADE,
  message_id INTEGER REFERENCES agent_messages(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,

  -- API details
  provider VARCHAR(50) NOT NULL, -- 'openai', 'anthropic'
  model VARCHAR(100) NOT NULL, -- 'gpt-4-turbo-preview', 'claude-3-5-sonnet-20241022'

  -- Token usage
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,

  -- Cost tracking
  estimated_cost DECIMAL(10, 6), -- In USD

  -- Performance
  response_time_ms INTEGER, -- Response time in milliseconds

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_agent_api_usage_conversation ON agent_api_usage(conversation_id);
CREATE INDEX idx_agent_api_usage_user ON agent_api_usage(user_id);
CREATE INDEX idx_agent_api_usage_created ON agent_api_usage(created_at DESC);
CREATE INDEX idx_agent_api_usage_cost ON agent_api_usage(estimated_cost);

-- Add trigger to update agent_conversations.updated_at
CREATE OR REPLACE FUNCTION update_agent_conversation_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE agent_conversations
  SET updated_at = CURRENT_TIMESTAMP
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_conversation_on_message
  AFTER INSERT ON agent_messages
  FOR EACH ROW
  EXECUTE FUNCTION update_agent_conversation_timestamp();

-- Add trigger to auto-set suggestion title based on first message
CREATE OR REPLACE FUNCTION set_conversation_title()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.role = 'user' THEN
    UPDATE agent_conversations
    SET title = LEFT(NEW.content, 100)
    WHERE id = NEW.conversation_id
      AND title IS NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_set_conversation_title
  AFTER INSERT ON agent_messages
  FOR EACH ROW
  EXECUTE FUNCTION set_conversation_title();

COMMIT;

-- Verification queries (commented out - uncomment to verify)
-- SELECT COUNT(*) FROM agent_conversations;
-- SELECT COUNT(*) FROM agent_messages;
-- SELECT COUNT(*) FROM agent_suggestions;
-- SELECT COUNT(*) FROM agent_api_usage;
