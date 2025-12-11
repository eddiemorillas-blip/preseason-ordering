# Preseason Ordering System - Backend API

A Node.js/Express backend for a preseason ordering system with JWT authentication, role-based access control, and PostgreSQL database.

## Features

- JWT-based authentication
- Role-based access control (Admin, Buyer, Viewer)
- CRUD operations for brands and products
- Fuzzy product search using Fuse.js
- PostgreSQL database on Railway
- RESTful API design

## Tech Stack

- Node.js
- Express.js
- PostgreSQL
- JWT (jsonwebtoken)
- bcryptjs for password hashing
- Fuse.js for fuzzy search
- CORS enabled

## Project Structure

```
preseason-ordering/
├── src/
│   ├── config/
│   │   └── database.js          # Database connection
│   ├── middleware/
│   │   └── auth.js               # Authentication & authorization middleware
│   ├── routes/
│   │   ├── auth.js               # Authentication routes
│   │   ├── brands.js             # Brand CRUD routes
│   │   └── products.js           # Product CRUD routes with search
│   └── server.js                 # Main server file
├── .env                          # Environment variables
├── .gitignore
├── package.json
└── README.md
```

## Setup Instructions

1. **Install dependencies** (already done):
   ```bash
   npm install
   ```

2. **Environment variables**:
   The `.env` file is already configured with your Railway database URL.
   Make sure to change the JWT_SECRET in production!

3. **Start the server**:
   ```bash
   npm start          # Production mode
   npm run dev        # Development mode with nodemon
   ```

4. **Server will run on**: `http://localhost:5000`

## API Endpoints

### Authentication Routes (`/api/auth`)

#### Register a new user
```
POST /api/auth/register
Content-Type: application/json

{
  "username": "john_doe",
  "email": "john@example.com",
  "password": "securepassword",
  "role": "Buyer"  // Optional: Admin, Buyer, or Viewer (default: Viewer)
}

Response: { user, token }
```

#### Login
```
POST /api/auth/login
Content-Type: application/json

{
  "email": "john@example.com",
  "password": "securepassword"
}

Response: { user, token }
```

#### Get current user (protected)
```
GET /api/auth/me
Authorization: Bearer <token>

Response: { user }
```

### Brand Routes (`/api/brands`)

All routes require authentication. Admin-only routes are marked.

#### Get all brands
```
GET /api/brands
Authorization: Bearer <token>

Response: { brands: [...] }
```

#### Get single brand
```
GET /api/brands/:id
Authorization: Bearer <token>

Response: { brand: {...} }
```

#### Create brand (Admin only)
```
POST /api/brands
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Nike",
  "description": "Athletic wear brand"
}

Response: { message, brand }
```

#### Update brand (Admin only)
```
PUT /api/brands/:id
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Nike Inc.",
  "description": "Updated description"
}

Response: { message, brand }
```

#### Delete brand (Admin only)
```
DELETE /api/brands/:id
Authorization: Bearer <token>

Response: { message }
```

### Product Routes (`/api/products`)

All routes require authentication. Admin-only routes are marked.

#### Get all products (with optional filters)
```
GET /api/products?brand_id=1&min_price=10&max_price=100
Authorization: Bearer <token>

Response: { products: [...] }
```

#### Fuzzy search products
```
GET /api/products/search?q=nike shoe
Authorization: Bearer <token>

Response: { query, count, products: [...] }
```

#### Get single product
```
GET /api/products/:id
Authorization: Bearer <token>

Response: { product: {...} }
```

#### Create product (Admin only)
```
POST /api/products
Authorization: Bearer <token>
Content-Type: application/json

{
  "name": "Air Max 90",
  "sku": "NKE-AM90-001",
  "description": "Classic sneaker",
  "price": 129.99,
  "brand_id": 1,
  "stock_quantity": 100
}

Response: { message, product }
```

#### Update product (Admin only)
```
PUT /api/products/:id
Authorization: Bearer <token>
Content-Type: application/json

{
  "price": 119.99,
  "stock_quantity": 150
}

Response: { message, product }
```

#### Delete product (Admin only)
```
DELETE /api/products/:id
Authorization: Bearer <token>

Response: { message }
```

## Role Permissions

- **Admin**: Full access to all routes (create, read, update, delete)
- **Buyer**: Read access to brands and products, can search
- **Viewer**: Read access to brands and products, can search

## Testing the API

You can test the API using tools like:
- Postman
- Insomnia
- cURL
- Thunder Client (VS Code extension)

### Example cURL commands:

```bash
# Register a user
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","email":"admin@example.com","password":"admin123","role":"Admin"}'

# Login
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"admin123"}'

# Get brands (replace YOUR_TOKEN with the token from login)
curl http://localhost:5000/api/brands \
  -H "Authorization: Bearer YOUR_TOKEN"

# Search products
curl "http://localhost:5000/api/products/search?q=shoe" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## Security Notes

- Change the JWT_SECRET in the `.env` file for production
- Never commit the `.env` file to version control
- Use HTTPS in production
- Consider adding rate limiting for production
- Implement input validation and sanitization as needed

## Database Schema

The backend expects the following tables to exist in your PostgreSQL database:

- `users` (id, username, email, password_hash, role, created_at)
- `brands` (id, name, description, created_at, updated_at)
- `products` (id, name, sku, description, price, brand_id, stock_quantity, created_at, updated_at)

## Next Steps

1. Test the API endpoints
2. Create a frontend application
3. Add more features (orders, order items, etc.)
4. Implement pagination for list endpoints
5. Add input validation with a library like Joi or express-validator
6. Add API documentation with Swagger/OpenAPI
# Trigger deploy
