# MCP Server - START HERE

Welcome to the Preseason Ordering MCP Server! This document guides you through getting started.

## What is This?

This is a **Model Context Protocol (MCP) server** that lets Claude Desktop and other AI clients interact with The Front's preseason ordering system. It provides 20 tools for managing orders, adjustments, patterns, and sales data.

## Quick Start (5 Minutes)

### 1. Install Dependencies
```bash
cd /sessions/cool-bold-bell/mnt/preseason-ordering/mcp-server
npm install
```

### 2. Configure Database
Create `.env.local` in the parent directory (`/sessions/cool-bold-bell/mnt/preseason-ordering/`):
```
DATABASE_URL=postgresql://user:password@localhost:5432/preseason_ordering
```

### 3. Start the Server
```bash
npm start
```

You should see:
```
Preseason Ordering MCP Server started
Available tools: list_orders, get_order_details, ...
```

### 4. Add to Claude Desktop

Find your Claude Desktop config file:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

Add this to the `mcpServers` section:
```json
"preseason-ordering": {
  "command": "node",
  "args": ["/sessions/cool-bold-bell/mnt/preseason-ordering/mcp-server/index.js"]
}
```

### 5. Restart Claude Desktop and Start Using It!

In Claude, try:
```
List all orders from this season
```

## What Can You Do?

### Ask Claude to:
- **Find Orders**: "Show me all draft orders for Patagonia"
- **Adjust Quantities**: "Reduce order 5 by 15%"
- **Analyze Patterns**: "What are our historical size adjustments?"
- **Compare Data**: "How does this order compare to last year's sales?"
- **Use Size Curves**: "Scale down XS by 30% and up L by 20%"

### The 20 Tools

**Orders** (5 tools)
- List orders by season, brand, location
- Get order details with all items
- View inventory summaries
- Check ship dates
- See finalization status

**Adjustments** (5 tools)
- Adjust single items
- Batch adjust multiple items
- Preview percentage changes
- Apply size curves
- Get suggestions based on history

**Knowledge** (4 tools)
- Get institutional knowledge
- Store new knowledge
- Access adjustment rules
- Get complete context

**Patterns** (3 tools)
- Analyze brand adjustment patterns
- Analyze location patterns
- Get adjustment suggestions

**Sales** (3 tools)
- Query historical sales
- Get sales velocity
- Compare to year-over-year

## Documentation

1. **This File** (00_START_HERE.md) - Quick overview
2. **QUICK_REFERENCE.md** - Common operations and prompts
3. **README.md** - Detailed tool documentation
4. **SETUP.md** - Installation and troubleshooting
5. **TOOLS_MANIFEST.md** - Complete tool inventory
6. **TESTING_CHECKLIST.md** - Testing guide

## Troubleshooting

### "DATABASE_URL not set"
- Create `.env.local` with your PostgreSQL connection string
- Make sure it's in the parent directory, not mcp-server/

### "Connection refused"
- Verify PostgreSQL is running
- Check the DATABASE_URL is correct
- Try: `psql` to test connection

### Server starts but tools don't work
- Make sure migrations have been run
- Check you have sample data in the database
- Look at error messages from Claude

### "Module not found"
- Run `npm install` again
- Make sure you're in the mcp-server directory

## Common Workflows

### Making Order Adjustments
1. Ask Claude: "List orders for Patagonia this season"
2. Ask: "Show details for order [number]"
3. Ask: "Preview reducing that order by 10%"
4. Ask: "Apply the 10% reduction"

### Size Optimization
1. Ask: "What are our historical size patterns for Patagonia?"
2. Ask: "Apply this size curve to order 5: XS -30%, M 0%, L +20%"

### Sales Analysis
1. Ask: "Show me sales data for Columbia last 12 months"
2. Ask: "Compare order 10 to historical sales"

## Next Steps

1. ✓ Follow the Quick Start above
2. ✓ Test with a simple query in Claude
3. ✓ Read QUICK_REFERENCE.md for common operations
4. ✓ Check TOOLS_MANIFEST.md for detailed info
5. ✓ Use TESTING_CHECKLIST.md to verify everything works

## File Structure

```
mcp-server/
├── 00_START_HERE.md          ← You are here
├── QUICK_REFERENCE.md        ← Common operations
├── README.md                 ← Tool documentation
├── SETUP.md                  ← Installation guide
├── TOOLS_MANIFEST.md         ← Tool inventory
├── TESTING_CHECKLIST.md      ← Testing guide
├── package.json              ← Dependencies
├── index.js                  ← Main server
├── db.js                     ← Database connection
└── tools/
    ├── orders.js             ← 5 order tools
    ├── adjustments.js        ← 5 adjustment tools
    ├── knowledge.js          ← 4 knowledge tools
    ├── patterns.js           ← 3 pattern tools
    └── sales.js              ← 3 sales tools
```

## Key Concepts

- **Order**: A purchase order for items
- **Order Item**: A single line item in an order
- **Adjusted Quantity**: The quantity after manual adjustments
- **Percentage Adjustment**: -20% means reduce to 80% of original
- **Size Curve**: Different percentage adjustments for each size
- **Velocity**: How fast items sell (units per month)
- **Pattern**: Historical average adjustments from past seasons

## Getting Help

### From Claude:
- "What tools are available?"
- "How do I use [tool name]?"
- "Show me an example of [operation]"

### From Documentation:
- Specific tool questions → README.md
- Setup/config questions → SETUP.md
- Quick lookup → QUICK_REFERENCE.md
- Complete reference → TOOLS_MANIFEST.md

### From Logs:
- Server startup: Check stderr output
- Tool errors: Check Claude's error message
- Database issues: Check PostgreSQL logs

## Requirements

- Node.js 18+ (`node --version`)
- PostgreSQL 12+ (running and accessible)
- `.env.local` with DATABASE_URL
- Migrations run on database

## Support

If something isn't working:

1. Check the error message carefully
2. Review SETUP.md troubleshooting section
3. Verify database connection: `psql` command
4. Check file paths are correct
5. Restart server and try again

## Success Criteria

You'll know it's working when:
- ✓ `npm start` shows "Server started"
- ✓ Claude Desktop shows preseason-ordering in tools
- ✓ You can ask Claude a question like "List all orders"
- ✓ Claude returns formatted order data

## Production Deployment

Once working locally:
1. Review SETUP.md "Production Deployment" section
2. Use environment variables for DATABASE_URL
3. Consider using Docker
4. Set up monitoring and logging
5. Test thoroughly with TESTING_CHECKLIST.md

---

**Ready?** Let's go! Start with the Quick Start section above. 🚀

Questions? Check the documentation files or ask Claude!
