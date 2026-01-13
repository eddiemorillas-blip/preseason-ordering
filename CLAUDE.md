# Preseason Ordering System

## Overview
A web application for managing preseason product orders for retail stores. Users can upload product catalogs, create orders for specific seasons/brands/locations, manage budgets, sync sales data from BigQuery, and export orders.

## Tech Stack
- **Backend**: Node.js + Express, PostgreSQL (pg library)
- **Frontend**: React 19 + Vite + Tailwind CSS + React Router v6
- **Auth**: JWT (jsonwebtoken + bcryptjs)
- **Data**: BigQuery integration for sales sync, xlsx for Excel export/import
- **Deployment**: Railway (production)

## Project Structure
```
/
├── src/                    # Backend Express server
│   ├── server.js           # Main entry point, route registration
│   ├── config/database.js  # PostgreSQL pool connection
│   ├── middleware/auth.js  # JWT auth + role authorization
│   ├── routes/             # API route handlers
│   │   ├── auth.js         # Login, register, user management
│   │   ├── orders.js       # Order CRUD, items, adjustments (largest file)
│   │   ├── catalogs.js     # CSV/Excel catalog upload & parsing
│   │   ├── exports.js      # Excel export generation
│   │   ├── sales-data.js   # Sales data queries
│   │   ├── sales.js        # BigQuery sync operations
│   │   └── ...             # brands, products, seasons, prices, budgets, etc.
│   └── services/
│       └── bigquery.js     # BigQuery client for sales data sync
├── frontend/               # React SPA
│   ├── src/
│   │   ├── App.jsx         # Route definitions
│   │   ├── main.jsx        # Entry point
│   │   ├── pages/          # Page components (OrderManager, AddProducts, etc.)
│   │   ├── components/     # Layout, ProtectedRoute, modals
│   │   ├── context/AuthContext.jsx  # Auth state management
│   │   └── services/api.js # Axios client with all API calls
│   └── dist/               # Production build (served by Express)
├── migrations/             # SQL schema files (run manually)
├── uploads/                # Temp file uploads
└── credentials/            # BigQuery service account (gitignored)
```

## Key Entities (Database)
- **users**: Role-based (admin, buyer, viewer)
- **brands**: Product manufacturers with vendor codes
- **locations**: Store locations for orders
- **seasons**: Ordering periods (planning/ordering/closed status)
- **products**: Catalog items with UPC, pricing, size/color variants, brand_id, season_id
- **orders**: Per brand/location/season with status (draft/submitted/approved/ordered/received/cancelled)
- **order_items**: Line items with quantity and pricing
- **season_budgets**: Budget allocation per brand/location/season
- **season_prices**: Historical pricing per product per season
- **sales_data**: Historical sales from BigQuery sync

## Running the Project
```bash
# Backend (from root)
npm install
npm run dev          # Starts nodemon on port 5000

# Frontend (from /frontend)
cd frontend
npm install
npm run dev          # Vite dev server on port 5173

# Production build
npm run build        # Builds frontend into frontend/dist
npm start            # Serves frontend from Express
```

## Environment Variables (.env)
```
DATABASE_URL=postgresql://...
JWT_SECRET=your-secret
PORT=5000
NODE_ENV=development|production
```

BigQuery credentials go in `/credentials/` directory.

## API Conventions
- All routes prefixed with `/api/`
- Auth via Bearer token in Authorization header
- Routes use `authenticateToken` middleware for protection
- Admin-only routes use `authorizeRoles('admin')`
- Buyer routes use `authorizeRoles(['admin', 'buyer'])`
- Database uses snake_case, API responses often transform to camelCase

## Frontend Patterns
- `useAuth()` hook from AuthContext for auth state
- `ProtectedRoute` component wraps authenticated pages
- API calls through centralized `services/api.js` (authAPI, orderAPI, etc.)
- Axios interceptors handle token injection and 401 redirects
- Pages are large, self-contained components with local state

## Important Files
- `src/routes/orders.js` - Core order management logic (~80KB, most complex)
- `src/routes/catalogs.js` - Product import logic with column mapping
- `src/routes/exports.js` - Excel export generation
- `frontend/src/pages/OrderManager.jsx` - Main dashboard
- `frontend/src/pages/AddProducts.jsx` - Product selection for orders
- `frontend/src/services/api.js` - All API endpoint definitions

## Migrations
SQL files in `/migrations/` are numbered and run manually. Initial schema in `000_initial_schema.sql`. No migration runner - execute directly against PostgreSQL.
