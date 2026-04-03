/**
 * MCP Tool Bridge
 * Imports all MCP tool handlers and provides a unified registry
 * for use with the Anthropic API tool_use feature.
 */

// Import all MCP tool modules
const ordersTools = require('../../mcp-server/tools/orders');
const adjustmentsTools = require('../../mcp-server/tools/adjustments');
const knowledgeTools = require('../../mcp-server/tools/knowledge');
const patternsTools = require('../../mcp-server/tools/patterns');
const salesTools = require('../../mcp-server/tools/sales');
const shipmentsTools = require('../../mcp-server/tools/shipments');
const revisionsTools = require('../../mcp-server/tools/revisions');
const vendorFormsTools = require('../../mcp-server/tools/vendor-forms');

// Combine all tools into a flat array
const allMcpTools = [
  ...ordersTools,
  ...adjustmentsTools,
  ...knowledgeTools,
  ...patternsTools,
  ...salesTools,
  ...shipmentsTools,
  ...revisionsTools,
  ...vendorFormsTools
];

// Build handler map: toolName -> handler function
const handlerMap = {};
for (const tool of allMcpTools) {
  handlerMap[tool.name] = tool.handler;
}

/**
 * Get Anthropic-compatible tool definitions
 * Converts MCP inputSchema format to Anthropic's input_schema format
 */
function getAnthropicToolDefinitions() {
  return allMcpTools.map(tool => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema
  }));
}

/**
 * Execute an MCP tool by name
 * @param {string} toolName
 * @param {Object} args
 * @returns {string} Text result from the tool
 */
async function executeTool(toolName, args) {
  const handler = handlerMap[toolName];
  if (!handler) {
    return `Unknown tool: ${toolName}`;
  }

  try {
    const result = await handler(args);
    // MCP tools return {content: [{type: 'text', text: '...'}]}
    if (result && result.content && result.content.length > 0) {
      return result.content.map(c => c.text || '').join('\n');
    }
    return JSON.stringify(result);
  } catch (error) {
    return `Error executing ${toolName}: ${error.message}`;
  }
}

/**
 * Get tool names grouped by category
 */
function getToolCategories() {
  return {
    orders: ordersTools.map(t => t.name),
    adjustments: adjustmentsTools.map(t => t.name),
    knowledge: knowledgeTools.map(t => t.name),
    patterns: patternsTools.map(t => t.name),
    sales: salesTools.map(t => t.name),
    shipments: shipmentsTools.map(t => t.name),
    revisions: revisionsTools.map(t => t.name),
    vendorForms: vendorFormsTools.map(t => t.name),
  };
}

module.exports = {
  getAnthropicToolDefinitions,
  executeTool,
  handlerMap,
  allMcpTools,
  getToolCategories
};
