import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';

// Pages
import Login from './pages/Login';
import Products from './pages/Products';
import Brands from './pages/Brands';
import Users from './pages/Users';
import CatalogUpload from './pages/CatalogUpload';
import OrderManager from './pages/OrderManager';
import OrderBuilder from './pages/OrderBuilder';
import AddProducts from './pages/AddProducts';
import SalesDataUpload from './pages/SalesDataUpload';
import OrderSuggestions from './pages/OrderSuggestions';
import SeasonPriceComparison from './pages/SeasonPriceComparison';
import PriceHistory from './pages/PriceHistory';
import SalesSync from './pages/SalesSync';
import BudgetManagement from './pages/BudgetManagement';
import OrderAdjustment from './pages/OrderAdjustment';
import Help from './pages/Help';

function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          {/* Public Routes */}
          <Route path="/login" element={<Login />} />

          {/* Protected Routes */}
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <OrderManager />
              </ProtectedRoute>
            }
          />
          <Route
            path="/products"
            element={
              <ProtectedRoute>
                <Products />
              </ProtectedRoute>
            }
          />
          <Route
            path="/brands"
            element={
              <ProtectedRoute>
                <Brands />
              </ProtectedRoute>
            }
          />
          <Route
            path="/catalog-upload"
            element={
              <ProtectedRoute requiredRole={['admin', 'buyer']}>
                <CatalogUpload />
              </ProtectedRoute>
            }
          />
          <Route
            path="/users"
            element={
              <ProtectedRoute requiredRole="admin">
                <Users />
              </ProtectedRoute>
            }
          />
          {/* Legacy routes redirect to home */}
          <Route path="/orders" element={<Navigate to="/" replace />} />
          <Route path="/seasons" element={<Navigate to="/" replace />} />
          <Route path="/seasons/:id" element={<Navigate to="/" replace />} />
          <Route
            path="/orders/:id"
            element={
              <ProtectedRoute>
                <OrderBuilder />
              </ProtectedRoute>
            }
          />
          <Route
            path="/orders/:orderId/add-products"
            element={
              <ProtectedRoute requiredRole={['admin', 'buyer']}>
                <AddProducts />
              </ProtectedRoute>
            }
          />
          <Route
            path="/add-products"
            element={
              <ProtectedRoute requiredRole={['admin', 'buyer']}>
                <AddProducts />
              </ProtectedRoute>
            }
          />
          <Route
            path="/sales-data-upload"
            element={
              <ProtectedRoute requiredRole={['admin', 'buyer']}>
                <SalesDataUpload />
              </ProtectedRoute>
            }
          />
          <Route
            path="/order-suggestions"
            element={
              <ProtectedRoute requiredRole={['admin', 'buyer']}>
                <OrderSuggestions />
              </ProtectedRoute>
            }
          />
          <Route
            path="/prices/compare"
            element={
              <ProtectedRoute requiredRole={['admin', 'buyer']}>
                <SeasonPriceComparison />
              </ProtectedRoute>
            }
          />
          <Route
            path="/prices/history"
            element={
              <ProtectedRoute requiredRole={['admin', 'buyer']}>
                <PriceHistory />
              </ProtectedRoute>
            }
          />
          <Route
            path="/sales-sync"
            element={
              <ProtectedRoute requiredRole={['admin', 'buyer']}>
                <SalesSync />
              </ProtectedRoute>
            }
          />
          <Route
            path="/budget"
            element={
              <ProtectedRoute requiredRole={['admin', 'buyer']}>
                <BudgetManagement />
              </ProtectedRoute>
            }
          />
          <Route
            path="/order-adjustment"
            element={
              <ProtectedRoute requiredRole={['admin', 'buyer']}>
                <OrderAdjustment />
              </ProtectedRoute>
            }
          />
          <Route
            path="/help"
            element={
              <ProtectedRoute>
                <Help />
              </ProtectedRoute>
            }
          />

          {/* Redirect unknown routes to home */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Router>
    </AuthProvider>
  );
}

export default App;
