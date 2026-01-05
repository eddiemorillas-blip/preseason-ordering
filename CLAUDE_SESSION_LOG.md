# Claude Session Log - Preseason Ordering App

## Last Updated: 2026-01-05

---

## Features Built This Session

### Add Items Panel Filtering (OrderAdjustment.jsx)
- **Category filter**: Multi-select dropdown with checkboxes
- **Size filter**: Multi-select dropdown with checkboxes
- **Gender filter**: Single-select dropdown
- **Has sales history**: Checkbox to filter by products with BigQuery sales data
- **Include in-stock**: Checkbox to show all pricelist products (not just zero-stock)
- **Select All / Clear All**: Buttons in each dropdown
- **Sticky headers**: Filter bar and "Ignore Selected" row stay fixed when scrolling

### Bulk Ignore Feature
- Checkbox on each product family row
- "Select All" checkbox in header
- "Ignore Selected (X)" button for bulk operations

### Backend Endpoints Modified
- `GET /api/orders/available-products` - Added filters: categories, sizes, gender, hasSalesHistory, includeWithStock
- `GET /api/orders/available-products/filters` - Returns distinct categories, genders, sizes for brand/season

---

## Recent Commits (Latest First)

```
506c7b9 - Fix product family grouping - use full name to preserve colors
bb6fdc9 - Fix array serialization for categories and sizes filters
b030551 - Add Select All button to category and size dropdowns
79c7974 - Fix sizes query - wrap DISTINCT in subquery for ORDER BY
96a737e - Fix dropdown close-on-click-outside and add useRef import
a2f2f86 - Add size filter and make filter bar sticky
22fa9c7 - Add bulk selection for ignoring product families
054ab99 - Change category filter to dropdown with checkboxes
cdb0769 - Remove dist from git, let Vercel build fresh
0d318d8 - Add multi-select for categories in Add Items filter
d75fcd9 - Fix SELECT DISTINCT error in available-products endpoint
97f78a4 - Add filtering to Add Items panel in Order Adjustment
```

---

## Key Files Modified

| File | Purpose |
|------|---------|
| `frontend/src/pages/OrderAdjustment.jsx` | Main UI - filters, bulk select, sticky headers |
| `frontend/src/services/api.js` | Added `getAvailableProductFilters` method |
| `src/routes/orders.js` | Backend filtering logic, new `/filters` endpoint |

---

## Known Issues / Notes

1. **Deployment**: Frontend on Vercel, Backend on Railway - both auto-deploy from git push
2. **Browser caching**: Sometimes need to clear cache or use incognito after deploys
3. **PostgreSQL quirk**: `SELECT DISTINCT` with complex `ORDER BY` requires subquery wrapper

### Bug Fixes
- **Product family grouping (2026-01-05)**: Fixed issue where different shoe models were merged together (e.g., Scarpa "Instinct VS" and "Instinct"). The `extractFamilyName` function now uses `product.name` instead of `product.base_name` to preserve color information, since `base_name` strips both size AND color.
- **Model suffix stripping (2026-01-05)**: Fixed issue where model suffixes like "S" in "Instinct S" were incorrectly stripped because the size-stripping regex matched standalone "S". Changed to only strip letter sizes when preceded by a delimiter like "-". Added `/api/migrations/refresh-base-names` endpoint to fix existing data.

---

## Architecture Notes

### Filter Flow
1. User opens "+ Add Items" panel
2. Frontend calls `/available-products/filters` to get options
3. User selects filters and clicks "Apply"
4. Frontend calls `/available-products` with filter params (comma-separated for arrays)
5. Backend filters products and returns grouped by family

### State Management
- `addItemsFilters` - Object with categories[], sizes[], gender, hasSalesHistory, includeWithStock
- `availableFilters` - Object with categories[], genders[], sizes[] from API
- `selectedFamilies` - Set of family names for bulk operations
- `showCategoryDropdown` / `showSizeDropdown` - Boolean toggles with click-outside-to-close

---

## How to Resume Work

1. Project location: `/home/emorillas/Desktop/preseason-ordering`
2. Frontend: `cd frontend && npm run dev`
3. Backend: `npm run dev`
4. Deployed URLs:
   - Frontend: https://thefront.vercel.app
   - Backend: Railway (athletic-gratitude project)
