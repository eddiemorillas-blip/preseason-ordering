import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const Layout = ({ children }) => {
  const { user, logout, isAdmin, isBuyer } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const isActive = (path) => {
    return location.pathname === path;
  };

  const navLinkClass = (path) => {
    const baseClass = "px-3 py-2 rounded-md text-sm font-medium transition-colors";
    return isActive(path)
      ? `${baseClass} bg-blue-700 text-white`
      : `${baseClass} text-blue-100 hover:bg-blue-700 hover:text-white`;
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header/Navigation */}
      <nav className="bg-blue-600 shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo and Navigation Links */}
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <Link to="/" className="text-white text-xl font-bold">
                  Front Climbing - Preseason
                </Link>
              </div>
              <div className="ml-10 flex items-baseline space-x-4">
                <Link to="/" className={navLinkClass('/')}>
                  Orders
                </Link>
                <Link to="/products" className={navLinkClass('/products')}>
                  Products
                </Link>
                <Link to="/brands" className={navLinkClass('/brands')}>
                  Brands
                </Link>
                {isBuyer() && (
                  <>
                    <Link to="/catalog-upload" className={navLinkClass('/catalog-upload')}>
                      Catalog Upload
                    </Link>
                    <Link to="/sales-data-upload" className={navLinkClass('/sales-data-upload')}>
                      Sales Data
                    </Link>
                    <Link to="/order-suggestions" className={navLinkClass('/order-suggestions')}>
                      Suggestions
                    </Link>
                    <Link to="/sales-sync" className={navLinkClass('/sales-sync')}>
                      Sales Sync
                    </Link>
                    <Link to="/budget" className={navLinkClass('/budget')}>
                      Budget
                    </Link>
                    <Link to="/order-adjustment" className={navLinkClass('/order-adjustment')}>
                      Adjust Orders
                    </Link>
                    <Link to="/export-center" className={navLinkClass('/export-center')}>
                      Export
                    </Link>
                  </>
                )}
                {isAdmin() && (
                  <Link to="/users" className={navLinkClass('/users')}>
                    Users
                  </Link>
                )}
              </div>
            </div>

            {/* User Info and Logout */}
            <div className="flex items-center space-x-4">
              <Link
                to="/help"
                className="text-blue-100 hover:text-white transition-colors"
                title="Help"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </Link>
              <div className="text-white text-sm">
                <span className="font-medium">{user?.firstName} {user?.lastName}</span>
                <span className="ml-2 px-2 py-1 bg-blue-500 rounded text-xs">
                  {user?.role}
                </span>
              </div>
              <button
                onClick={handleLogout}
                className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 transition-colors text-sm font-medium"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {children}
      </main>

      {/* Footer */}
      <footer className="bg-white border-t border-gray-200 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <p className="text-center text-gray-500 text-sm">
            © 2025 The Front Climbing Club - Preseason Ordering System
          </p>
        </div>
      </footer>
    </div>
  );
};

export default Layout;
