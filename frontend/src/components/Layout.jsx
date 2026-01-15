import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const Layout = ({ children }) => {
  const { user, logout, isAdmin, isBuyer } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const isActive = (path) => {
    return location.pathname === path;
  };

  const navLinkClass = (path, mobile = false) => {
    const baseClass = mobile
      ? "block px-4 py-2 text-sm font-medium"
      : "px-3 py-2 rounded-md text-sm font-medium transition-colors";

    if (mobile) {
      return isActive(path)
        ? `${baseClass} bg-blue-700 text-white`
        : `${baseClass} text-gray-700 hover:bg-gray-100`;
    }
    return isActive(path)
      ? `${baseClass} bg-blue-700 text-white`
      : `${baseClass} text-blue-100 hover:bg-blue-700 hover:text-white`;
  };

  const navGroups = [
    {
      label: 'Orders',
      items: [
        { path: '/', label: 'Order Manager' },
        { path: '/order-adjustment', label: 'Adjust Orders', buyerOnly: true },
        { path: '/order-suggestions', label: 'Suggestions', buyerOnly: true },
        { path: '/export-center', label: 'Export', buyerOnly: true },
        { path: '/ai-assistant', label: 'AI Assistant', buyerOnly: true },
      ]
    },
    {
      label: 'Data',
      items: [
        { path: '/products', label: 'Products' },
        { path: '/brands', label: 'Brands' },
        { path: '/catalog-upload', label: 'Catalog Upload', buyerOnly: true },
      ]
    },
    {
      label: 'Sales',
      items: [
        { path: '/sales-sync', label: 'Sales Sync', buyerOnly: true },
        { path: '/sales-debug', label: 'Sales Debug', buyerOnly: true },
        { path: '/sales-data-upload', label: 'Sales Upload', buyerOnly: true },
      ]
    },
    {
      label: 'Planning',
      items: [
        { path: '/budget', label: 'Budget', buyerOnly: true },
      ]
    },
    {
      label: 'Admin',
      items: [
        { path: '/users', label: 'Users', adminOnly: true },
      ]
    },
  ];

  const filterItems = (items) => {
    return items.filter(item => {
      if (item.adminOnly && !isAdmin()) return false;
      if (item.buyerOnly && !isBuyer()) return false;
      return true;
    });
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header/Navigation */}
      <nav className="bg-blue-600 shadow-lg relative">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo and Hamburger */}
            <div className="flex items-center">
              <button
                onClick={() => setMenuOpen(!menuOpen)}
                className="p-2 rounded-md text-blue-100 hover:text-white hover:bg-blue-700 focus:outline-none"
              >
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  {menuOpen ? (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  )}
                </svg>
              </button>
              <Link to="/" className="ml-4 text-white text-xl font-bold">
                Front Climbing - Preseason
              </Link>
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
              <div className="text-white text-sm hidden sm:block">
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

        {/* Dropdown Menu */}
        {menuOpen && (
          <div className="absolute top-16 left-0 right-0 bg-white shadow-lg border-t z-50">
            <div className="max-w-7xl mx-auto px-4 py-4">
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-6">
                {navGroups.map((group) => {
                  const filteredItems = filterItems(group.items);
                  if (filteredItems.length === 0) return null;

                  return (
                    <div key={group.label}>
                      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                        {group.label}
                      </h3>
                      <div className="space-y-1">
                        {filteredItems.map((item) => (
                          <Link
                            key={item.path}
                            to={item.path}
                            onClick={() => setMenuOpen(false)}
                            className={navLinkClass(item.path, true)}
                          >
                            {item.label}
                          </Link>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </nav>

      {/* Click outside to close menu */}
      {menuOpen && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setMenuOpen(false)}
        />
      )}

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
