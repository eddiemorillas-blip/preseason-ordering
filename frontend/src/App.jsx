import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';

// Pages
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Products from './pages/Products';
import Brands from './pages/Brands';
import Users from './pages/Users';
import CatalogUpload from './pages/CatalogUpload';
import Seasons from './pages/Seasons';
import SeasonDashboard from './pages/SeasonDashboard';
import OrderBuilder from './pages/OrderBuilder';
import SalesDataUpload from './pages/SalesDataUpload';

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
                <Dashboard />
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
          <Route
            path="/seasons"
            element={
              <ProtectedRoute>
                <Seasons />
              </ProtectedRoute>
            }
          />
          <Route
            path="/seasons/:id"
            element={
              <ProtectedRoute>
                <SeasonDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/orders/:id"
            element={
              <ProtectedRoute>
                <OrderBuilder />
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

          {/* Redirect unknown routes to home */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Router>
    </AuthProvider>
  );
}

export default App;
