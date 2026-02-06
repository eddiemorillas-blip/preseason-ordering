# Preseason Ordering MCP Server

A Model Context Protocol (MCP) server for The Front's preseason ordering system. This server enables Claude Desktop and other MCP clients to interact with ordering data, make adjustments, analyze patterns, and access sales information.

## Overview

The MCP server provides 20 tools organized into 5 modules:

- **Orders** (5 tools): Query and analyze orders
- **Adjustments** (5 tools): Modify order quantities with bulk operations
- **Knowledge** (4 tools): Access institutional knowledge and adjustment rules
- **Patterns** (3 tools): Analyze historical adjustment patterns
- **Sales** (3 tools): Query sales data and velocity metrics

## Installation

```bash
cd /sessions/cool-bold-bell/mnt/preseason-ordering/mcp-server
npm install
```

## Configuration

The server reads environment variables from `.env.local` (preferred) or `.env` in the parent directory:

```
DATABASE_URL=postgresql://user:password@localhost:5432/preseason_ordering
```

## Running the Server

### Standalone
```bash
npm start
# or
node index.js
```

### With Claude Desktop

Add to your `claude_desktop_config.json`:

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

### With Cowork

Similar configuration in your Cowork settings to connect to the MCP server.

## Tools Reference

### Orders Module

#### list_orders
Find orders by season, brand, location, or status.

**Parameters:**
- `seasonId` (optional): Filter by season ID
- `brandId` (optional): Filter by brand ID
- `locationId` (optional): Filter by location ID
- `status` (optional): Filter by order status (draft, submitted, approved, ordered, received, cancelled)

**Returns:** List of orders with item count, unit totals, and wholesale costs

#### get_order_details
Get complete order information including all items with product details.

**Parameters:**
- `orderId` (required): Order ID

**Returns:** Full order with all items including SKU, UPC, size, color, costs, and adjustments

#### get_order_inventory
Get inventory summary for matching orders grouped by product family.

**Parameters:**
- `seasonId` (optional): Season ID
- `brandId` (optional): Brand ID
- `locationId` (optional): Location ID
- `shipDate` (optional): Ship date (YYYY-MM-DD format)

**Returns:** Inventory grouped by product family showing original vs adjusted quantities

#### get_ship_dates
Get available ship dates for a season/brand combination with order counts.

**Parameters:**
- `seasonId` (required): Season ID
- `brandId` (required): Brand ID

**Returns:** List of ship dates with order and location counts

#### get_finalized_status
Check finalization status of orders by brand and location.

**Parameters:**
- `seasonId` (required): Season ID
- `brandId` (optional): Filter by brand ID

**Returns:** Per-brand/location finalization status with percentages

### Adjustments Module

#### adjust_item
Adjust a single order item's quantity with optional reasoning.

**Parameters:**
- `orderItemId` (required): Order item ID
- `newQuantity` (required): New quantity (integer, >= 0)
- `reasoning` (optional): Reason for adjustment

**Returns:** Item adjustment confirmation with before/after values and cost impact

#### batch_adjust
Adjust multiple items in an order simultaneously.

**Parameters:**
- `orderId` (required): Order ID
- `adjustments` (required): Array of {itemId, newQuantity}
- `reasoning` (optional): Reason for adjustments

**Returns:** Summary of all changes and total cost impact

#### preview_percentage_adjustment
Preview what a percentage adjustment would do without applying it.

**Parameters:**
- `orderId` (required): Order ID
- `percentage` (required): Percentage to adjust (-100 to +100)
- `filters` (optional): Filter by {category, gender, size}

**Returns:** Preview showing affected items and projected cost impact

#### apply_percentage_adjustment
Apply a percentage adjustment to order items.

**Parameters:**
- `orderId` (required): Order ID
- `percentage` (required): Percentage to adjust (-100 to +100)
- `filters` (optional): Filter by {category, gender, size}
- `reasoning` (optional): Reason for adjustment

**Returns:** Confirmation of changes and cost impact

#### apply_size_curve
Apply size-based percentage adjustments (e.g., scale down XS, scale up L).

**Parameters:**
- `orderId` (required): Order ID
- `sizeAdjustments` (required): Object like `{"xs": -30, "s": -10, "m": 0, "l": 10}`
- `filters` (optional): Filter by {category}
- `reasoning` (optional): Reason for adjustment

**Returns:** Changes grouped by size with cost impact

### Knowledge Module

#### get_knowledge
Get institutional knowledge for a specific context (brand/location/category).

**Parameters:**
- `brandId` (optional): Brand ID
- `locationId` (optional): Location ID
- `category` (optional): Product category
- `type` (optional): Knowledge type filter

**Returns:** Formatted knowledge entries grouped by type

#### add_knowledge
Add a new institutional knowledge entry for future reference.

**Parameters:**
- `type` (required): Knowledge type (e.g., "sizing_preference", "demand_pattern")
- `targetId` (optional): Brand/Location/Category ID
- `key` (required): Knowledge identifier
- `description` (required): Description of the knowledge
- `value` (optional): Quantitative value

**Returns:** Confirmation of created entry

#### get_adjustment_rules
Get available adjustment rules configured for a context.

**Parameters:**
- `brandId` (optional): Brand ID
- `locationId` (optional): Location ID
- `category` (optional): Product category
- `ruleType` (optional): Rule type (size_curve, percentage_adjustment, etc)

**Returns:** List of enabled rules with configurations

#### get_full_context
Get complete knowledge context combining orders, products, and patterns.

**Parameters:**
- `brandId` (optional): Brand ID
- `locationId` (optional): Location ID
- `seasonId` (optional): Season ID

**Returns:** Comprehensive context formatted for AI reasoning

### Patterns Module

#### get_brand_patterns
Get historical adjustment patterns for a brand across locations and categories.

**Parameters:**
- `brandId` (required): Brand ID
- `seasonCount` (optional): Number of past seasons to analyze (default 4)

**Returns:** Average adjustment percentages grouped by category, size, and location with standard deviations

#### get_location_patterns
Get historical adjustment patterns for a location across brands and categories.

**Parameters:**
- `locationId` (required): Location ID
- `seasonCount` (optional): Number of past seasons to analyze (default 4)

**Returns:** Average adjustment percentages grouped by brand and category

#### get_suggested_adjustments
Get adjustment suggestions for an order based on previous season patterns.

**Parameters:**
- `orderId` (required): Order ID

**Returns:** Product-by-product suggestions based on historical adjustment patterns with confidence levels

### Sales Module

#### query_sales
Query historical sales data for a brand from the PostgreSQL sales table.

**Parameters:**
- `brandId` (required): Brand ID
- `locationId` (optional): Location ID for filtering
- `months` (optional): Number of months to query (default 12)

**Returns:** Sales data by UPC with quantities, revenue, and average pricing

#### get_velocity
Get sales velocity metrics (units per month) for products.

**Parameters:**
- `brandId` (required): Brand ID
- `locationId` (optional): Location ID
- `upcs` (optional): Array of UPCs to filter

**Returns:** Velocity metrics showing units/month and revenue/month per product

#### compare_year_over_year
Compare current order quantities to historical 12-month sales patterns.

**Parameters:**
- `orderId` (required): Order ID to analyze

**Returns:** Comparison showing whether you're ordering more/less/similar to historical sales with recommendations

## Architecture

### Database Connection
- Uses PostgreSQL connection pool with configurable settings
- Automatic reconnection on failure
- Connection pooling for performance

### Tool Structure
Each tool module exports an array of tool objects with:
- `name`: Tool identifier
- `description`: User-friendly description
- `inputSchema`: JSON Schema for parameters
- `handler`: Async function that executes the tool

### Error Handling
- All tools have comprehensive try-catch blocks
- Errors return user-friendly messages
- Missing tables/data return helpful guidance rather than failures

### SQL Injection Prevention
- All queries use parameterized statements ($1, $2, etc.)
- No string concatenation in SQL
- Safe handling of user input

## Common Workflows

### Analyzing an Order
1. `list_orders` to find the order
2. `get_order_details` for full item breakdown
3. `get_suggested_adjustments` for history-based recommendations
4. `apply_percentage_adjustment` or `adjust_item` to make changes

### Season Planning
1. `get_brand_patterns` to understand adjustment history
2. `get_location_patterns` to see location-specific trends
3. `query_sales` for demand data
4. `compare_year_over_year` to validate ordering decisions

### Size Optimization
1. `preview_percentage_adjustment` to see the impact
2. `apply_size_curve` with appropriate adjustments for each size
3. `get_full_context` to understand the business impact

## Development

### Adding New Tools
1. Create a new tool module in `tools/` directory
2. Export an array of tool definitions
3. Import in `index.js` and add to `allTools`
4. Each tool needs `name`, `description`, `inputSchema`, and `handler`

### Testing Queries
Connect to your PostgreSQL database and test queries:

```sql
-- Check available orders
SELECT * FROM orders LIMIT 5;

-- Check order items
SELECT * FROM order_items WHERE order_id = 1;

-- Check sales data
SELECT * FROM sales_by_upc LIMIT 5;
```

## Performance Considerations

- **Indexes**: Database has indexes on frequently queried columns
- **Limits**: Queries are limited to prevent overwhelming responses
- **Aggregation**: Heavy queries use GROUP BY for efficiency
- **Caching**: Consider caching static reference data (brands, locations, seasons)

## Security

- Database credentials stored in environment variables
- No direct user input in SQL (parameterized queries)
- Read-only access for most queries (except adjustments)
- Audit trail via adjustment history table

## Troubleshooting

### "DATABASE_URL not set"
- Check `.env.local` or `.env` file in parent directory
- Ensure PostgreSQL connection string is correct

### "Connection timeout"
- Verify PostgreSQL server is running
- Check network connectivity
- Review PostgreSQL logs

### "No data found"
- Verify you have seasons, brands, locations in database
- Check that orders exist for your queries
- Run migrations if tables are missing

### Large response times
- Check PostgreSQL server load
- Review indexes on frequently queried tables
- Consider breaking up large date ranges

## Future Enhancements

- Webhook support for order changes
- Real-time notifications for pattern changes
- Advanced ML-based recommendation engine
- Integration with BigQuery for enhanced sales analysis
- Approval workflow integration
- Batch import/export functionality

## Support

For issues or questions:
1. Check database connectivity first
2. Review SQL queries for correctness
3. Verify all required tables exist
4. Check MCP client logs for error details
