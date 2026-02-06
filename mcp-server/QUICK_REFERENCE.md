# Quick Reference Guide

Fast lookup for common MCP server operations.

## Installation & Running

```bash
# One-time setup
cd /sessions/cool-bold-bell/mnt/preseason-ordering/mcp-server
npm install

# Create .env.local in parent directory with:
# DATABASE_URL=postgresql://...

# Start server
npm start
```

## All 20 Tools by Category

### Orders (5)
- `list_orders` - Find orders by season/brand/location
- `get_order_details` - Full order with items
- `get_order_inventory` - Grouped inventory summary
- `get_ship_dates` - Available ship dates
- `get_finalized_status` - Finalization progress

### Adjustments (5)
- `adjust_item` - Change one item's quantity
- `batch_adjust` - Change multiple items at once
- `preview_percentage_adjustment` - Test % change without applying
- `apply_percentage_adjustment` - Apply % change
- `apply_size_curve` - Different % per size

### Knowledge (4)
- `get_knowledge` - Institutional knowledge
- `add_knowledge` - Store new knowledge
- `get_adjustment_rules` - Available rules
- `get_full_context` - Complete context for reasoning

### Patterns (3)
- `get_brand_patterns` - Historical brand adjustments
- `get_location_patterns` - Historical location adjustments
- `get_suggested_adjustments` - Suggestions based on history

### Sales (3)
- `query_sales` - Historical sales data
- `get_velocity` - Units per month
- `compare_year_over_year` - Ordering vs. sales comparison

## Common Claude Prompts

### Finding Orders
```
List all orders from Spring 2025
Show me orders for Patagonia brand
Get orders for the SLC location with draft status
```

### Making Adjustments
```
Reduce all items in order 42 by 10%
Scale down XS by 30% and up L by 20% for order 15
Adjust item 123 to quantity 50
Adjust the following items: 101→40, 102→30, 103→50
```

### Analyzing Data
```
What's the finalization status for all brands this season?
Show me sales velocity for Columbia brand
Compare order 5 to last year's sales patterns
What adjustments have we historically made to Cotopaxi orders?
```

### Using Size Curves
```
Apply a size curve to order 10:
- XS: -40%
- S: -20%
- M: 0%
- L: +15%
- XL: +30%
```

## Parameter Combinations

### Get orders for a specific plan
```javascript
// All orders for a season
{ seasonId: 1 }

// All orders for a brand in a season
{ seasonId: 1, brandId: 2 }

// All draft orders
{ status: "draft" }

// Orders for specific location
{ locationId: 3 }
```

### Adjust with filters
```javascript
// Reduce only Men's products
{ orderId: 5, percentage: -15, filters: { gender: "Men" } }

// Reduce only Tops category
{ orderId: 5, percentage: -10, filters: { category: "Tops" } }

// Reduce only XL size
{ orderId: 5, percentage: -20, filters: { size: "xl" } }
```

## Database IDs to Remember

Run these once to get your common IDs:

```sql
-- Seasons
SELECT id, name FROM seasons;

-- Brands
SELECT id, name FROM brands;

-- Locations
SELECT id, name FROM locations;
```

Common shorthand:
```
Season 1 = S26 or current season
Brand 2 = Patagonia
Location 1 = SLC
```

## Response Format

All tools return formatted text, example:

```
ORDER DETAILS
────────────────────────────────────────────────────────
Order Number: ORD-001
Season: S26 | Brand: Patagonia | Location: SLC
Ship Date: 2025-03-15
Status: draft

ITEMS (5 total)
────────────────────────────────────────────────────────
1. Mens Nano Puff Jacket
   SKU: PAT-001 | UPC: 123456789
   Size: M | Color: Black | Category: Jackets
   Original Qty: 20 | Adjusted Qty: 18
   Unit Cost: $89.50 | Line Total: $1,791.00
```

## Workflows by Task

### Task: Review and Adjust a New Order
1. `list_orders` → Find the order ID
2. `get_order_details` → See all items
3. `get_suggested_adjustments` → Check history
4. `apply_percentage_adjustment` or `adjust_item` → Make changes

### Task: Scale Order Down by 15%
1. `preview_percentage_adjustment` → See impact first
2. Confirm the preview looks good
3. `apply_percentage_adjustment` → Apply it

### Task: Apply Size Curve (Small ↓, Large ↑)
1. `apply_size_curve` with:
   ```
   { "xs": -30, "s": -15, "m": 0, "l": 15, "xl": 30 }
   ```

### Task: Understand Brand Patterns
1. `get_brand_patterns` → See historical trends
2. `get_location_patterns` → See location trends
3. `query_sales` → See actual sales data

### Task: Compare to Last Year
1. `compare_year_over_year` with order ID
2. Review what you ordered vs. what sold

## Error Messages & Fixes

| Error | Cause | Fix |
|-------|-------|-----|
| `ORDER_NOT_FOUND` | Order ID doesn't exist | Check list_orders for correct ID |
| `DATABASE_URL not set` | Missing env variable | Create .env.local with DATABASE_URL |
| `Connection refused` | PostgreSQL not running | Start PostgreSQL service |
| `No data found` | Season/brand/location doesn't exist | Run list_orders to see valid IDs |
| `Adjustment failed` | Invalid quantity | Use positive integers |

## Useful SQL for Context

Connect directly to check status:

```sql
-- How many orders per status?
SELECT status, COUNT(*) FROM orders GROUP BY status;

-- Orders by brand
SELECT b.name, COUNT(*) FROM orders o
  JOIN brands b ON o.brand_id = b.id
  GROUP BY b.name;

-- Biggest orders by value
SELECT order_number, SUM(line_total) as total
  FROM orders o JOIN order_items oi ON o.id = oi.order_id
  GROUP BY o.id
  ORDER BY total DESC LIMIT 10;
```

## Performance Tips

- Use filters to reduce data (category, gender, size)
- Preview before applying big changes
- Batch_adjust is faster than multiple adjust_item calls
- Size curves are optimized for bulk adjustments

## Key Concepts

**Original Quantity**: What was ordered initially
**Adjusted Quantity**: What it will be after adjustments
**Percentage**: -30% = reduce to 70%, +20% = increase to 120%
**Size Curve**: Different adjustments per size (e.g., small sizes down, large sizes up)
**Velocity**: How fast items sell (units per month)
**Pattern**: Historical average adjustments from past seasons

## Getting Help in Claude

Ask Claude:
```
What tools are available?
How do I adjust multiple items?
What does this error mean: [error message]?
Show me examples of using apply_size_curve
```

Claude can:
- Explain what each tool does
- Show examples of parameters
- Help you build complex workflows
- Suggest adjustments based on data
- Format your adjustments for bulk operations

## Common Mistakes to Avoid

1. **Using string IDs instead of integers**
   - Wrong: `seasonId: "1"`
   - Right: `seasonId: 1`

2. **Forgetting to preview first**
   - Use `preview_percentage_adjustment` before applying

3. **Wrong percentage format**
   - For -15%: use `percentage: -15` (not `-0.15`)

4. **Not checking filters**
   - `apply_percentage_adjustment` needs `orderId`, not just filter

5. **Size curve with wrong case**
   - Use lowercase: `{"xs": -30, "m": 0, "xl": 20}`

## Config File Location

```bash
# macOS
~/Library/Application Support/Claude/claude_desktop_config.json

# Windows
%APPDATA%\Claude\claude_desktop_config.json

# Linux
~/.config/Claude/claude_desktop_config.json
```

Add this to mcpServers:
```json
"preseason-ordering": {
  "command": "node",
  "args": ["/sessions/cool-bold-bell/mnt/preseason-ordering/mcp-server/index.js"]
}
```

## Monitoring

Check if server is running:
```bash
ps aux | grep "node.*index.js"
```

View recent errors:
```bash
tail -50 /var/log/claude-mcp.log
```

Test connection:
```bash
node -e "require('./db.js').query('SELECT 1', (e,r) => console.log(e||'OK'))"
```

---

**Need more help?** See:
- `README.md` for detailed tool docs
- `SETUP.md` for installation & config
- Database schema in `/migrations/`
