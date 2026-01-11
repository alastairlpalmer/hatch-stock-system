import React, { useState, useEffect } from 'react';
import { useStock } from './context/StockContext';

// Import page components
import Dashboard from './components/pages/Dashboard';
import SalesOverview from './components/pages/SalesOverview';
import LocationStock from './components/pages/LocationStock';
import Orders from './components/pages/Orders';
import ReceiveStock from './components/pages/ReceiveStock';
import Inventory from './components/pages/Inventory';
import RemoveStock from './components/pages/RemoveStock';
import RestockMachine from './components/pages/RestockMachine';
import History from './components/pages/History';
import Admin from './components/pages/Admin';

// Import layout components
import Sidebar from './components/layout/Sidebar';
import Header from './components/layout/Header';
import LoadingScreen from './components/ui/LoadingScreen';

function App() {
  const { loading, syncStatus } = useStock();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // Detect mobile viewport
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

  const handleNavClick = (tabId) => {
    setActiveTab(tabId);
    if (isMobile) {
      setMobileMenuOpen(false);
    }
  };

  if (loading) {
    return <LoadingScreen />;
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex">
      {/* Mobile Menu Overlay */}
      {isMobile && mobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-black/60 z-40 backdrop-blur-sm"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}
      
      {/* Sidebar */}
      <Sidebar
        activeTab={activeTab}
        onTabChange={handleNavClick}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
        isMobile={isMobile}
        mobileMenuOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
        syncStatus={syncStatus}
      />

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        <Header
          activeTab={activeTab}
          syncStatus={syncStatus}
          isMobile={isMobile}
          onMenuClick={() => setMobileMenuOpen(true)}
        />

        {/* Page Content */}
        <main className="flex-1 overflow-auto p-4 md:p-6">
          <div className="max-w-7xl mx-auto">
            {activeTab === 'dashboard' && <Dashboard />}
            {activeTab === 'sales' && <SalesOverview />}
            {activeTab === 'locations' && <LocationStock />}
            {activeTab === 'orders' && <Orders />}
            {activeTab === 'receive' && <ReceiveStock />}
            {activeTab === 'inventory' && <Inventory />}
            {activeTab === 'remove' && <RemoveStock />}
            {activeTab === 'restock' && <RestockMachine />}
            {activeTab === 'history' && <History />}
            {activeTab === 'admin' && <Admin />}
          </div>
        </main>
      </div>
    </div>
  );
}

export default App;
