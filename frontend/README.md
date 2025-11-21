# Preseason Ordering System - Frontend

A React frontend for The Front Climbing Club's preseason ordering management system.

## Tech Stack

- **React** 18 with Vite
- **React Router** v6 for navigation
- **Tailwind CSS** for styling
- **Axios** for API calls
- **Context API** for state management

## Features

### 1. Authentication System
- Login with email and password
- JWT token storage in localStorage
- Automatic redirect on token expiration
- Role-based access control (Admin, Buyer, Viewer)

### 2. Dashboard
- Quick stats overview
- User information display
- Quick access to main features
- Recent brands listing

### 3. Product Search (PRIORITY FEATURE)
- Fast, debounced search (300ms delay)
- Search by name, UPC, SKU, description
- Filter by brand
- Pagination (50 results per page)
- Displays: name, UPC, brand, category, wholesale cost, MSRP
- Handles large product catalogs efficiently

### 4. Brand Management
- List all brands
- Search/filter brands
- Create new brands (Admin only)
- Edit brand details (Admin only)
- View brand contact information
- Active/inactive status

### 5. User Management (Admin Only)
- List all users
- Create new users
- Assign roles (Admin, Buyer, Viewer)
- View user status and last login

## Getting Started

### Prerequisites
- Node.js (v18+)
- Backend API running on `http://localhost:3000/api`

### Running the Application

```bash
cd frontend
npm run dev
```

The app will be available at `http://localhost:5173`

### Building for Production

```bash
npm run build
```

## API Configuration

The frontend connects to the backend API at `http://localhost:3000/api`.

To change the API URL, edit `src/services/api.js`:

```javascript
const api = axios.create({
  baseURL: 'http://your-api-url/api'
});
```

## User Roles & Permissions

### Admin
- Full access to all features
- Can create/edit brands
- Can create/manage users

### Buyer
- Can view/search products
- Can view brands
- Read-only access

### Viewer
- Can view/search products
- Can view brands
- Read-only access only

## Troubleshooting

### CORS Errors
Make sure the backend is running and has CORS configured for `http://localhost:5173`

### Authentication Errors
- Clear localStorage: `localStorage.clear()`
- Check backend is running on port 3000
- Verify JWT_SECRET is set in backend

### Search Not Working
- Check backend API is running
- Verify search endpoint: `GET /api/products/search`
- Ensure backend has products in database
