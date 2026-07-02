import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useStock } from './context/StockContext';
import { useAuth } from './context/AuthContext';

// Page components
import Dashboard from './components/pages/Dashboard';
import SalesOverview from './components/pages/SalesOverview';
import LocationStock from './components/pages/LocationStock';
import Orders from './components/pages/Orders';
import ReceiveStock from './components/pages/ReceiveStock';
import Inventory from './components/pages/Inventory';
import RemoveStock from './components/pages/RemoveStock';
import RestockMachine from './components/pages/RestockMachine';
import History from './components/pages/History';
import Shrinkage from './components/pages/Shrinkage';
import Admin from './components/pages/Admin';
import RestockingDocs from './components/pages/RestockingDocs';
import Login from './components/pages/Login';
import Users from './components/pages/Users';
import BuyingLists from './components/pages/orders/BuyingLists';
import BuyingListDetail from './components/pages/orders/BuyingListDetail';
import SharedBuyingList from './components/pages/SharedBuyingList';
import PickLists from './components/pages/restock/PickLists';
import PickListDetail from './components/pages/restock/PickListDetail';
import StockCheck from './components/pages/restock/StockCheck';

// Parent layouts
import OrdersLayout from './components/pages/orders/OrdersLayout';
import RestockLayout from './components/pages/restock/RestockLayout';
import RestockWorkflow from './components/pages/restock/RestockWorkflow';
import SelectRoute from './components/pages/restock/SelectRoute';
import SupportLayout from './components/pages/support/SupportLayout';

// Layout components
import Sidebar from './components/layout/Sidebar';
import Header from './components/layout/Header';
import LoadingScreen from './components/ui/LoadingScreen';
import ErrorBoundary from './components/ErrorBoundary';

const AUTH_ENABLED = import.meta.env.VITE_AUTH_ENABLED === 'true';

// Redirects to /login when auth is enabled and there is no active session.
function RequireAuth({ children }) {
  const { isAuthenticated } = useAuth();
  if (AUTH_ENABLED && !isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

// Admin-only route guard. Non-admins are redirected home; the backend
// (adminOnly middleware) is the real enforcement for the data itself.
function AdminOnly({ children }) {
  const { isAdmin } = useAuth();
  if (AUTH_ENABLED && !isAdmin) {
    return <Navigate to="/" replace />;
  }
  return children;
}

function App() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/login" element={<Login />} />
        {/* Public share view — the unguessable token is the credential, so this
            deliberately sits outside RequireAuth and the app chrome. */}
        <Route path="/share/buying-list/:token" element={<SharedBuyingList />} />
        <Route
          path="/*"
          element={
            <RequireAuth>
              <AppLayout />
            </RequireAuth>
          }
        />
      </Routes>
    </ErrorBoundary>
  );
}

function AppLayout() {
  const { loading, syncStatus, error, clearError } = useStock();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
      if (window.innerWidth < 768) {
        setSidebarCollapsed(true);
      }
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const closeMobileMenu = () => setMobileMenuOpen(false);

  if (loading) {
    return <LoadingScreen />;
  }

  return (
    <div className="h-screen bg-zinc-950 text-zinc-100 flex overflow-hidden">
      {isMobile && mobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 backdrop-blur-sm"
          onClick={closeMobileMenu}
        />
      )}

      <Sidebar
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        isMobile={isMobile}
        mobileMenuOpen={mobileMenuOpen}
        onCloseMobile={closeMobileMenu}
        onNavigate={isMobile ? closeMobileMenu : undefined}
        syncStatus={syncStatus}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <Header
          syncStatus={syncStatus}
          isMobile={isMobile}
          onMenuClick={() => setMobileMenuOpen(true)}
        />

        <main className="flex-1 overflow-auto p-4 md:p-6">
          <div className="max-w-7xl mx-auto">
            {error && (
              <div className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
                <p className="min-w-0">{error}</p>
                <button
                  onClick={clearError}
                  aria-label="Dismiss"
                  className="flex-shrink-0 rounded px-2 py-0.5 text-amber-300 hover:bg-amber-500/20 hover:text-amber-100"
                >
                  Dismiss
                </button>
              </div>
            )}
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/sales" element={<SalesOverview />} />
              <Route path="/locations" element={<LocationStock />} />

              <Route path="/orders" element={<OrdersLayout />}>
                <Route index element={<Navigate to="purchase" replace />} />
                <Route path="warehouse" element={<Inventory />} />
                <Route path="purchase" element={<Orders />} />
                <Route path="buying-lists" element={<BuyingLists />} />
                <Route path="buying-lists/:id" element={<BuyingListDetail />} />
                <Route path="receive" element={<ReceiveStock />} />
              </Route>

              <Route path="/restock" element={<RestockLayout />}>
                <Route index element={<RestockWorkflow />} />
                <Route path="route" element={<SelectRoute />} />
                <Route path="picklists" element={<PickLists />} />
                <Route path="picklists/:id" element={<PickListDetail />} />
                <Route path="check" element={<StockCheck />} />
                <Route path="remove" element={<RemoveStock />} />
                <Route path="machine" element={<RestockMachine />} />
                <Route path="shrinkage" element={<Shrinkage />} />
              </Route>

              <Route path="/support" element={<SupportLayout />}>
                <Route index element={<Navigate to="docs" replace />} />
                <Route path="docs" element={<RestockingDocs />} />
                <Route path="settings" element={<Admin />} />
                <Route path="history" element={<History />} />
                <Route
                  path="users"
                  element={
                    <AdminOnly>
                      <Users />
                    </AdminOnly>
                  }
                />
              </Route>

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </div>
        </main>
      </div>
    </div>
  );
}

export default App;
