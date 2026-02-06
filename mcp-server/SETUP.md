# MCP Server Setup Guide

Complete guide to getting the Preseason Ordering MCP server running.

## Quick Start

### 1. Install Dependencies

```bash
cd /sessions/cool-bold-bell/mnt/preseason-ordering/mcp-server
npm install
```

This will install:
- `@modelcontextprotocol/sdk`: The MCP protocol implementation
- `pg`: PostgreSQL client
- `dotenv`: Environment variable management

### 2. Configure Environment

The server needs a PostgreSQL connection string. It looks for it in this order:

1. `.env.local` (preferred for development)
2. `.env`

Create `.env.local` in the project root (parent directory):

```
DATABASE_URL=postgresql://user:password@localhost:5432/preseason_ordering
```

**For Railway.app (production):**
```
DATABASE_URL=postgresql://postgres:password@railway.app:5432/preseason_ordering
```

**For local development:**
```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/preseason_ordering
```

### 3. Test Database Connection

Run a simple test to verify the connection:

```bash
node -e "
const pool = require('./db.js');
pool.query('SELECT NOW()', (err, res) => {
  if (err) console.error('Connection failed:', err);
  else console.log('Connected! Time:', res.rows[0].now);
  process.exit(err ? 1 : 0);
});
"
```

You should see: `Connected! Time: [current timestamp]`

### 4. Start the Server

```bash
npm start
```

You should see (on stderr):
```
Preseason Ordering MCP Server started
Available tools: list_orders, get_order_details, ...
```

The server is now listening on stdin/stdout for MCP protocol messages.

## Integration with Claude Desktop

### 1. Locate Claude Desktop Config

```bash
# On macOS
~/Library/Application Support/Claude/claude_desktop_config.json

# On Windows
%APPDATA%/Claude/claude_desktop_config.json

# On Linux
~/.config/Claude/claude_desktop_config.json
```

### 2. Add MCP Server Configuration

Open `claude_desktop_config.json` and add the server:

```json
{
  "mcpServers": {
    "preseason-ordering": {
      "command": "node",
      "args": ["/sessions/cool-bold-bell/mnt/preseason-ordering/mcp-server/index.js"],
      "env": {
        "DATABASE_URL": "postgresql://user:password@localhost:5432/preseason_ordering"
      }
    }
  }
}
```

Or, if your `.env.local` is properly set up in the project root:

```json
{
  "mcpServers": {
    "preseason-ordering": {
      "command": "node",
      "args": ["/sessions/cool-bold-bell/mnt/preseason-ordering/mcp-server/index.js"]
    }
  }
}
```

### 3. Restart Claude Desktop

Close and reopen Claude Desktop. The new MCP server should be available.

In Claude, you should see the preseason-ordering server in the available tools list.

### 4. Test a Tool

Ask Claude:
```
List all orders from season 1
```

Or test directly with parameters:
```
Use the list_orders tool to find orders where seasonId is 1
```

## Integration with Cowork

Similar configuration in Cowork's MCP settings:

1. Go to Settings → MCP Servers
2. Add new server
3. Name: `preseason-ordering`
4. Command: `node`
5. Arguments: `/sessions/cool-bold-bell/mnt/preseason-ordering/mcp-server/index.js`
6. Environment: Set `DATABASE_URL` or ensure `.env.local` exists

## Troubleshooting

### "npm: command not found"

You need to install Node.js. Download from https://nodejs.org/ (v18+)

```bash
# Verify installation
node --version
npm --version
```

### "DATABASE_URL not set"

Error: `DATABASE_URL environment variable not set`

Solution:
1. Create `.env.local` in the project root
2. Add: `DATABASE_URL=postgresql://...`
3. Restart the server

### "connect ECONNREFUSED 127.0.0.1:5432"

PostgreSQL connection refused.

Solutions:
1. Verify PostgreSQL is running: `psql --version`
2. Check connection string format
3. For Railway: use the full connection URL from dashboard
4. For local: default is `postgresql://postgres:postgres@localhost:5432/preseason_ordering`

### Server starts but tools don't work

The server might not have database access. Test with:

```bash
npm start
# (Server runs but no immediate output)

# In another terminal:
node -e "
const http = require('http');
const { createConnection } = require('net');

const conn = createConnection({port: 3000});
conn.on('error', () => {
  console.log('MCP Server not listening on port 3000');
  console.log('Server uses stdio protocol - test with MCP client instead');
});
"
```

The MCP server uses stdin/stdout, so it won't listen on a port. Test by connecting through Claude Desktop or using an MCP client test tool.

### "Cannot find module '@modelcontextprotocol/sdk'"

Dependencies not installed.

Solution:
```bash
cd /sessions/cool-bold-bell/mnt/preseason-ordering/mcp-server
npm install
```

### Database tables not found

Make sure migrations have been run on your database:

```bash
cd /sessions/cool-bold-bell/mnt/preseason-ordering
node run-initial-migration.js
```

Or run migrations manually:

```bash
psql -d preseason_ordering < migrations/000_initial_schema.sql
psql -d preseason_ordering < migrations/001_season_orders.sql
# ... continue with other migrations
```

## Performance Tuning

### Increase Connection Pool

Edit `db.js` to adjust pool settings:

```javascript
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 50,              // Increase from 20 for high volume
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000
});
```

### Add Database Indexes

For large datasets, ensure indexes exist:

```bash
psql -d preseason_ordering -c "CREATE INDEX idx_orders_created ON orders(created_at DESC);"
psql -d preseason_ordering -c "CREATE INDEX idx_order_items_adjusted ON order_items(adjusted_quantity);"
```

### Limit Large Queries

Some tools return many rows. Add pagination:

Edit `tools/orders.js` and add LIMIT:

```javascript
query += ` LIMIT 100`;
```

## Production Deployment

### Environment Variables

Use secure environment variable management:

```bash
# Railway
railway link
railway set DATABASE_URL="postgresql://..."

# Docker
docker run -e DATABASE_URL="postgresql://..." preseason-ordering-mcp

# Heroku
heroku config:set DATABASE_URL="postgresql://..."
```

### Process Management

Use PM2 to keep the server running:

```bash
npm install -g pm2

pm2 start index.js --name preseason-ordering --cwd /sessions/cool-bold-bell/mnt/preseason-ordering/mcp-server

# Auto-restart on file changes during dev
pm2 start index.js --watch --name preseason-ordering
```

### Monitoring

Check server health:

```bash
# View logs
pm2 logs preseason-ordering

# Monitor resources
pm2 monit

# View status
pm2 status
```

### Docker Deployment

Create `Dockerfile`:

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

CMD ["node", "index.js"]
```

Build and run:

```bash
docker build -t preseason-ordering-mcp .
docker run -e DATABASE_URL="postgresql://..." preseason-ordering-mcp
```

## Development Tips

### Debugging

Add debug logging:

```bash
DEBUG=* npm start
```

Add console output in tools:

```javascript
console.error('DEBUG: About to query with params:', params);
```

### Testing Tools Locally

Create `test.js`:

```javascript
const ordersTools = require('./tools/orders.js');

// Get list_orders tool
const tool = ordersTools.find(t => t.name === 'list_orders');

// Test it
tool.handler({ seasonId: 1 }).then(result => {
  console.log(result.content[0].text);
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
```

Run: `node test.js`

### Code Style

The codebase uses:
- 2-space indentation
- No semicolon style (actually included)
- CommonJS modules
- Async/await for database queries

### Adding a New Tool

1. Create new function in a tool file
2. Add to module.exports array
3. Import in index.js if new file
4. Add to allTools array
5. Test with Claude Desktop

Example:

```javascript
async function getNewMetric(args) {
  try {
    // Implementation
    return {
      content: [{ type: 'text', text: 'Result' }]
    };
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }]
    };
  }
}

module.exports = [
  {
    name: 'get_new_metric',
    description: 'Describe what this does',
    inputSchema: {
      type: 'object',
      properties: {
        param1: { type: 'string', description: 'Description' }
      },
      required: ['param1']
    },
    handler: getNewMetric
  }
];
```

## Next Steps

1. **Test Connection**: Run the database connection test above
2. **Start Server**: `npm start`
3. **Configure Claude Desktop**: Add to `claude_desktop_config.json`
4. **Try a Query**: Ask Claude to list orders
5. **Monitor Logs**: Watch stderr for any issues

## Getting Help

**Common Issues:**
- Check database connection first
- Verify migrations are run
- Review tool output for specific errors
- Check MCP client logs (Claude Desktop or Cowork)

**Database Help:**
- See `/sessions/cool-bold-bell/mnt/preseason-ordering/migrations/` for schema
- PostgreSQL docs: https://www.postgresql.org/docs/

**MCP Protocol:**
- Model Context Protocol: https://modelcontextprotocol.io/

## File Structure

```
mcp-server/
├── index.js              # Main server entry point
├── db.js                 # Database connection
├── package.json          # Dependencies
├── README.md             # Tool documentation
├── SETUP.md              # This file
└── tools/
    ├── orders.js         # Order querying tools
    ├── adjustments.js    # Quantity adjustment tools
    ├── knowledge.js      # Institutional knowledge tools
    ├── patterns.js       # Historical pattern tools
    └── sales.js          # Sales data tools
```
