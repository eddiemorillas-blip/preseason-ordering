# Testing Checklist

Comprehensive testing guide for the Preseason Ordering MCP server.

## Pre-Launch Testing

### Environment Setup
- [ ] Node.js v18+ installed (`node --version`)
- [ ] npm installed (`npm --version`)
- [ ] PostgreSQL running and accessible
- [ ] `.env.local` created with valid DATABASE_URL
- [ ] Dependencies installed (`npm install`)

### Database Verification
- [ ] Database connection successful (`node -e "require('./db').query('SELECT 1', console.log)"`)
- [ ] All migrations run
- [ ] Sample data exists in database
  - [ ] At least one season
  - [ ] At least one brand
  - [ ] At least one location
  - [ ] At least one order

### Server Startup
- [ ] Server starts without errors (`npm start`)
- [ ] Stderr shows: "Preseason Ordering MCP Server started"
- [ ] Tool list displays correctly
- [ ] No port conflicts
- [ ] Can stop with Ctrl+C

## Tool Testing

### Orders Module (5 tools)

#### list_orders
- [ ] Test with no parameters (returns all orders)
- [ ] Test with seasonId only
- [ ] Test with brandId only
- [ ] Test with locationId only
- [ ] Test with status filter
- [ ] Test with multiple filters combined
- [ ] Test with invalid ID (should return "not found")
- [ ] Verify formatting (order number, brand, location, status)
- [ ] Check totals calculation

#### get_order_details
- [ ] Test with valid order ID
- [ ] Test with invalid order ID
- [ ] Verify header information displays
- [ ] Verify all items listed
- [ ] Check product details (SKU, UPC, size, color)
- [ ] Check quantity (original vs adjusted)
- [ ] Check costs (unit cost, line total)
- [ ] Verify total wholesale calculation

#### get_order_inventory
- [ ] Test with seasonId only
- [ ] Test with brandId only
- [ ] Test with locationId only
- [ ] Test with shipDate filter
- [ ] Test with multiple filters
- [ ] Verify grouping by product family
- [ ] Check quantity totals (original vs adjusted)
- [ ] Verify cost calculations

#### get_ship_dates
- [ ] Test with valid season and brand
- [ ] Test with invalid season
- [ ] Test with invalid brand
- [ ] Verify date listing
- [ ] Check order and location counts
- [ ] Verify total units calculated

#### get_finalized_status
- [ ] Test with valid seasonId
- [ ] Test with seasonId and brandId
- [ ] Verify brand/location breakdown
- [ ] Check order counts
- [ ] Verify finalization percentages
- [ ] Test with no finalized orders

### Adjustments Module (5 tools)

#### adjust_item
- [ ] Test with valid itemId and newQuantity
- [ ] Test with invalid itemId
- [ ] Test with negative quantity (should fail)
- [ ] Test with zero quantity
- [ ] Test with reasoning parameter
- [ ] Verify before/after display
- [ ] Check cost impact calculation
- [ ] Verify adjustment logged (if table exists)

#### batch_adjust
- [ ] Test with single adjustment
- [ ] Test with multiple adjustments
- [ ] Test with invalid itemIds
- [ ] Test with mixed valid/invalid
- [ ] Verify all items updated
- [ ] Check total cost impact
- [ ] Verify item count
- [ ] Test rollback on error

#### preview_percentage_adjustment
- [ ] Test +10% adjustment
- [ ] Test -10% adjustment
- [ ] Test +50% adjustment
- [ ] Test -50% adjustment
- [ ] Test with category filter
- [ ] Test with gender filter
- [ ] Test with size filter
- [ ] Verify no database changes
- [ ] Check calculations accuracy
- [ ] Verify affected items count

#### apply_percentage_adjustment
- [ ] Test +10% without filters
- [ ] Test -15% with category filter
- [ ] Test with gender and size filters
- [ ] Verify database updated
- [ ] Check quantities adjusted correctly
- [ ] Verify cost impact accurate
- [ ] Test with reasoning parameter
- [ ] Confirm multiple items updated

#### apply_size_curve
- [ ] Test with balanced curve (XS-30, XL+30)
- [ ] Test with skewed curve (favor large)
- [ ] Test with category filter
- [ ] Verify size grouping
- [ ] Check each size adjusted correctly
- [ ] Verify total cost impact
- [ ] Test with invalid sizes (should skip)
- [ ] Check granularity (items, not whole sizes)

### Knowledge Module (4 tools)

#### get_knowledge
- [ ] Test with brandId only
- [ ] Test with locationId only
- [ ] Test with category only
- [ ] Test with multiple parameters
- [ ] Verify brand information shows
- [ ] Check location information
- [ ] Verify category statistics
- [ ] Check product counts

#### add_knowledge
- [ ] Test with required parameters only
- [ ] Test with all parameters
- [ ] Verify entry created
- [ ] Check type stored correctly
- [ ] Verify key and description
- [ ] Test with optional value parameter
- [ ] Test with targetId

#### get_adjustment_rules
- [ ] Test with no parameters
- [ ] Test with brandId filter
- [ ] Test with locationId filter
- [ ] Test with category filter
- [ ] Test with ruleType filter
- [ ] Verify enabled rules only
- [ ] Check rule configuration display
- [ ] Test with non-existent filters

#### get_full_context
- [ ] Test with seasonId only
- [ ] Test with brandId only
- [ ] Test with locationId only
- [ ] Test with all parameters
- [ ] Verify season information
- [ ] Check brand information
- [ ] Verify location information
- [ ] Check order status breakdown
- [ ] Verify formatting for AI

### Patterns Module (3 tools)

#### get_brand_patterns
- [ ] Test with valid brandId
- [ ] Test with invalid brandId
- [ ] Test with custom seasonCount
- [ ] Verify by category breakdown
- [ ] Check by size breakdown
- [ ] Verify by location breakdown
- [ ] Check percentage calculations
- [ ] Verify average calculations

#### get_location_patterns
- [ ] Test with valid locationId
- [ ] Test with invalid locationId
- [ ] Test with custom seasonCount
- [ ] Verify by brand breakdown
- [ ] Check by category breakdown
- [ ] Verify average calculations
- [ ] Check item counts

#### get_suggested_adjustments
- [ ] Test with valid orderId
- [ ] Test with invalid orderId
- [ ] Verify previous season found
- [ ] Check product matching
- [ ] Verify suggestion quantities
- [ ] Check confidence levels
- [ ] Test when no matches found
- [ ] Verify formatting

### Sales Module (3 tools)

#### query_sales
- [ ] Test with valid brandId
- [ ] Test with invalid brandId
- [ ] Test with custom months parameter
- [ ] Verify UPC listing
- [ ] Check quantity data
- [ ] Verify revenue data
- [ ] Check average pricing
- [ ] Verify total calculations

#### get_velocity
- [ ] Test with valid brandId
- [ ] Test with optional locationId
- [ ] Test with UPC filter
- [ ] Verify units/month calculated
- [ ] Check revenue/month calculated
- [ ] Verify overall velocity
- [ ] Test with no UPC filter
- [ ] Check formatting

#### compare_year_over_year
- [ ] Test with valid orderId
- [ ] Test with invalid orderId
- [ ] Verify historical comparison
- [ ] Check more/less/similar categorization
- [ ] Verify totals calculated
- [ ] Check recommendations displayed
- [ ] Verify UPC matching
- [ ] Check monthly rates

## Integration Testing

### Claude Desktop Integration
- [ ] MCP server configured in claude_desktop_config.json
- [ ] Claude Desktop restarted
- [ ] Tools appear in Claude's tool palette
- [ ] Can invoke tools from Claude chat

### Claude Testing Prompts
- [ ] "List all orders"
- [ ] "Show order 1 details"
- [ ] "Reduce order 1 by 10%"
- [ ] "What are size adjustment patterns?"
- [ ] "Compare order 1 to sales data"
- [ ] "Apply a size curve: XS -30, XL +20"
- [ ] Ask for tool help from Claude
- [ ] Test parameter suggestions

### Cowork Integration (if applicable)
- [ ] MCP server configured in Cowork
- [ ] Can connect to server
- [ ] Tools available in Cowork interface
- [ ] Queries work correctly

## Error Handling Testing

### Invalid Parameters
- [ ] Non-integer IDs (should error)
- [ ] Negative quantities (should error)
- [ ] Percentage out of range (should handle)
- [ ] Missing required parameters (should error)
- [ ] Invalid enum values (should error)

### Database Errors
- [ ] Close database connection, try query (should error gracefully)
- [ ] Test with invalid credentials (should error)
- [ ] Test with table not found (should handle)
- [ ] Test with missing columns (should handle)

### Edge Cases
- [ ] Empty result sets (should return message)
- [ ] Very large orders (1000+ items)
- [ ] Special characters in data
- [ ] Null/undefined values
- [ ] Concurrent requests (if applicable)

## Performance Testing

### Response Times
- [ ] list_orders with filters: < 100ms
- [ ] get_order_details: < 50ms
- [ ] get_brand_patterns: < 200ms
- [ ] batch_adjust: < 100ms
- [ ] Large result sets: reasonable (< 1s)

### Data Volumes
- [ ] Test with 100 orders
- [ ] Test with 1000 items in order
- [ ] Test with large date ranges
- [ ] Test with all filters applied

## Documentation Testing

### README.md
- [ ] All tools documented
- [ ] All parameters documented
- [ ] Examples provided
- [ ] Return format explained
- [ ] Error cases mentioned

### SETUP.md
- [ ] Installation steps clear
- [ ] Configuration instructions work
- [ ] Troubleshooting section helpful
- [ ] All platforms covered (Desktop, Cowork, etc)

### QUICK_REFERENCE.md
- [ ] Common prompts work
- [ ] Parameter examples accurate
- [ ] Workflows are complete
- [ ] Error reference helpful

### TOOLS_MANIFEST.md
- [ ] All 20 tools listed
- [ ] Accurate descriptions
- [ ] Database tables correct
- [ ] Statistics accurate

## Regression Testing

### After Code Changes
- [ ] All 20 tools still work
- [ ] No new errors introduced
- [ ] Performance maintained
- [ ] Documentation updated

### Version Compatibility
- [ ] Node.js 18 compatible
- [ ] Node.js 20 compatible
- [ ] PostgreSQL 12 compatible
- [ ] PostgreSQL 14 compatible

## Load Testing

### Multiple Concurrent Requests
- [ ] 2 simultaneous queries work
- [ ] 5 simultaneous queries work
- [ ] 10 simultaneous queries work
- [ ] No connection pool issues
- [ ] No data corruption

### Stress Testing
- [ ] Large adjustments (1000 items)
- [ ] Complex filters
- [ ] Historical pattern queries (large season count)
- [ ] No memory leaks
- [ ] Server remains responsive

## Security Testing

### SQL Injection
- [ ] Test with SQL in string parameters
- [ ] Test with quotes and special chars
- [ ] Verify parameterized queries used
- [ ] No string concatenation in SQL

### Data Access
- [ ] Cannot execute unauthorized queries
- [ ] Cannot modify other users' data
- [ ] Cannot delete data unexpectedly
- [ ] Proper error messages (not SQL)

## Checklist Summary

- [ ] All 20 tools tested individually
- [ ] All modules tested
- [ ] Integration with Claude Desktop verified
- [ ] Error handling tested
- [ ] Performance acceptable
- [ ] Documentation accurate
- [ ] Security verified
- [ ] Ready for production

## Sign-Off

- [ ] Tested by: _________________
- [ ] Date: _________________
- [ ] Status: Ready for Production / Needs Fixes

## Notes

Use this space for any issues found during testing:

```
[Document any issues, bugs, or observations here]
```

## Test Results Summary

| Component | Status | Notes |
|-----------|--------|-------|
| Server Startup | ✓ / ✗ | |
| Orders Module | ✓ / ✗ | |
| Adjustments Module | ✓ / ✗ | |
| Knowledge Module | ✓ / ✗ | |
| Patterns Module | ✓ / ✗ | |
| Sales Module | ✓ / ✗ | |
| Claude Desktop | ✓ / ✗ | |
| Error Handling | ✓ / ✗ | |
| Performance | ✓ / ✗ | |
| Documentation | ✓ / ✗ | |

---

**Testing Template Version**: 1.0
**Last Updated**: 2025-02-06
