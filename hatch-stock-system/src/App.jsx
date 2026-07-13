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
import RestockSheet from './components/pages/RestockSheet';
import PickLists from './components/pages/restock/PickLists';
import PickListDetail from './components/pages/restock/PickListDetail';
import StockCheck from './components/pages/restock/StockCheck';
import RestockRun from './components/pages/restock/RestockRun';
import Account from './components/pages/Account';
import MobileHome from './components/pages/mobile/MobileHome';
import MorePage from './components/pages/mobile/MorePage';
import RestockHub from './components/pages/restock/RestockHub';
import OrdersHub from './components/pages/orders/OrdersHub';
import OrdersLanding from './components/pages/orders/OrdersLanding';

// Parent layouts
import OrdersLayout from './components/pages/orders/OrdersLayout';
import SuppliersConfig from './components/pages/orders/SuppliersConfig';
import RestockLayout from './components/pages/restock/RestockLayout';
import RestockWorkflow from './components/pages/restock/RestockWorkflow';
import SelectRoute from './components/pages/restock/SelectRoute';
import SupportLayout from './components/pages/support/SupportLayout';

// Layout components
import Sidebar from './components/layout/Sidebar';
import Header from './components/layout/Header';
import BottomNav from './components/layout/BottomNav';
import LoadingScreen from './components/ui/LoadingScreen';
import ErrorBoundary from './components/ErrorBoundary';
import useIsMobile from './hooks/useIsMobile';

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
        <Route path="/share/restock-sheet/:token" element={<RestockSheet />} />
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

// The /restock index is the action hub on phones and the 3-step workflow on
// desktop. Same URL either way, so the bottom bar and old links both just
// point at /restock.
function RestockIndex() {
  const isMobile = useIsMobile();
  return isMobile ? <RestockHub /> : <RestockWorkflow />;
}

// Same pattern for /orders: action hub on phones, an action landing (cards +
// pending-orders snapshot) on desktop.
function OrdersIndex() {
  const isMobile = useIsMobile();
  return isMobile ? <OrdersHub /> : <OrdersLanding />;
}

function AppLayout() {
  const { loading, syncStatus, error, clearError } = useStock();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const isMobile = useIsMobile();
  // The backend rejected a request with 401 while this build has
  // VITE_AUTH_ENABLED off — the two env flags disagree. Without this banner
  // the app would just look broken. Fired by the axios interceptor.
  const [authConfigMismatch, setAuthConfigMismatch] = useState(false);

  useEffect(() => {
    const onMismatch = () => setAuthConfigMismatch(true);
    window.addEventListener('hatch:auth-config-mismatch', onMismatch);
    return () => window.removeEventListener('hatch:auth-config-mismatch', onMismatch);
  }, []);

  if (loading) {
    return <LoadingScreen />;
  }

  return (
    // h-[100dvh] tracks iOS Safari's collapsing toolbar so the bottom nav
    // always hugs the visible bottom; h-screen stays as the fallback.
    <div className="h-screen h-[100dvh] bg-zinc-950 text-zinc-100 flex overflow-hidden">
      {/* Mobile navigation is the bottom bar; the sidebar (and its old drawer
          mode) is desktop-only chrome. */}
      {!isMobile && (
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
          isMobile={false}
          mobileMenuOpen={false}
          onCloseMobile={() => {}}
          syncStatus={syncStatus}
        />
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <Header syncStatus={syncStatus} isMobile={isMobile} />

        <main className="flex-1 overflow-auto p-4 md:p-6">
          <div className="max-w-7xl mx-auto">
            {authConfigMismatch && (
              <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                <p className="font-medium">Login is required by the server but disabled in this build.</p>
                <p className="mt-1 text-red-300/80">
                  The backend has AUTH_ENABLED=true but this frontend was deployed without
                  VITE_AUTH_ENABLED=true. Set it in Vercel and redeploy — or set AUTH_ENABLED=false
                  in Railway to switch login off everywhere.
                </p>
              </div>
            )}
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
              <Route path="/home" element={<MobileHome />} />
              <Route path="/more" element={<MorePage />} />
              <Route path="/sales" element={<SalesOverview />} />
              <Route path="/locations" element={<LocationStock />} />

              <Route path="/orders" element={<OrdersLayout />}>
                <Route index element={<OrdersIndex />} />
                <Route path="warehouse" element={<Inventory />} />
                <Route path="purchase" element={<Orders />} />
                <Route path="buying-lists" element={<BuyingLists />} />
                <Route path="buying-lists/:id" element={<BuyingListDetail />} />
                <Route path="receive" element={<ReceiveStock />} />
                <Route path="suppliers" element={<SuppliersConfig />} />
              </Route>

              <Route path="/restock" element={<RestockLayout />}>
                <Route index element={<RestockIndex />} />
                <Route path="route" element={<SelectRoute />} />
                <Route path="picklists" element={<PickLists />} />
                <Route path="picklists/:id" element={<PickListDetail />} />
                <Route path="check" element={<StockCheck />} />
                <Route path="run" element={<RestockRun />} />
                <Route path="remove" element={<RemoveStock />} />
                <Route path="machine" element={<RestockMachine />} />
                <Route path="shrinkage" element={<Shrinkage />} />
              </Route>

              <Route path="/support" element={<SupportLayout />}>
                <Route index element={<Navigate to="docs" replace />} />
                <Route path="docs" element={<RestockingDocs />} />
                <Route
                  path="settings"
                  element={
                    <AdminOnly>
                      <Admin />
                    </AdminOnly>
                  }
                />
                <Route path="account" element={<Account />} />
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

        {/* In-flow (not fixed) so <main>'s scrollport ends above it and page
            sticky action bars stack on top with no offsets. */}
        {isMobile && <BottomNav />}
      </div>
    </div>
  );
}

export default App;
