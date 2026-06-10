import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useStock } from './context/StockContext';

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

// Redirects to /login when auth is enabled and no token is stored
function RequireAuth({ children }) {
  const authEnabled = import.meta.env.VITE_AUTH_ENABLED === 'true';
  if (authEnabled && !localStorage.getItem('auth_token')) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

function App() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/login" element={<Login />} />
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
  const { loading, syncStatus } = useStock();
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
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/sales" element={<SalesOverview />} />
              <Route path="/locations" element={<LocationStock />} />

              <Route path="/orders" element={<OrdersLayout />}>
                <Route index element={<Navigate to="warehouse" replace />} />
                <Route path="warehouse" element={<Inventory />} />
                <Route path="purchase" element={<Orders />} />
                <Route path="receive" element={<ReceiveStock />} />
              </Route>

              <Route path="/restock" element={<RestockLayout />}>
                <Route index element={<RestockWorkflow />} />
                <Route path="route" element={<SelectRoute />} />
                <Route path="remove" element={<RemoveStock />} />
                <Route path="machine" element={<RestockMachine />} />
                <Route path="shrinkage" element={<Shrinkage />} />
              </Route>

              <Route path="/support" element={<SupportLayout />}>
                <Route index element={<Navigate to="docs" replace />} />
                <Route path="docs" element={<RestockingDocs />} />
                <Route path="settings" element={<Admin />} />
                <Route path="history" element={<History />} />
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
