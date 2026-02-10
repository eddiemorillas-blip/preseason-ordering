#!/usr/bin/env node

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');

// Import all tool modules
const ordersTools = require('./tools/orders.js');
const adjustmentsTools = require('./tools/adjustments.js');
const knowledgeTools = require('./tools/knowledge.js');
const patternsTools = require('./tools/patterns.js');
const salesTools = require('./tools/sales.js');
const shipmentsTools = require('./tools/shipments.js');

// Combine all tools
const allTools = [
  ...ordersTools,
  ...adjustmentsTools,
  ...knowledgeTools,
  ...patternsTools,
  ...salesTools,
  ...shipmentsTools
];

// Create the MCP server
const server = new Server({
  name: 'preseason-ordering-mcp',
  version: '1.0.0'
}, {
  capabilities: {
    tools: {}
  }
});

/**
 * Tool listing handler
 * Returns all available tools with their schemas
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: allTools.map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema
    }))
  };
});

/**
 * Tool execution handler
 * Routes tool calls to the appropriate handler
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  // Find the tool
  const tool = allTools.find(t => t.name === name);

  if (!tool) {
    return {
      content: [{
        type: 'text',
        text: `Unknown tool: ${name}`
      }],
      isError: true
    };
  }

  try {
    // Call the tool handler
    const result = await tool.handler(args);
    return result;
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: `Error executing tool ${name}: ${error.message}`
      }],
      isError: true
    };
  }
});

/**
 * Start the server
 */
async function main() {
  const transport = new StdioServerTransport();

  await server.connect(transport);

  // Log that the server is running (to stderr so it doesn't interfere with protocol)
  const errorHandler = console.error;
  errorHandler('Preseason Ordering MCP Server started');
  errorHandler(`Available tools: ${allTools.map(t => t.name).join(', ')}`);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
