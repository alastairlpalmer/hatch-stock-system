import React, { useState, useEffect } from 'react';

function SyncIndicator({ status }) {
  const getStatusDisplay = () => {
    switch (status.status) {
      case 'saving':
        return { icon: '↻', color: 'text-emerald-400', text: 'Saving...' };
      case 'saved':
        return { icon: '✓', color: 'text-emerald-400', text: 'Saved' };
      case 'loaded':
        return { icon: '✓', color: 'text-emerald-400', text: 'Synced' };
      case 'error':
        return { icon: '✗', color: 'text-red-400', text: 'Error' };
      case 'offline':
        return { icon: '○', color: 'text-zinc-500', text: 'Offline' };
      case 'new':
        return { icon: '○', color: 'text-teal-400', text: 'New session' };
      default:
        return { icon: '○', color: 'text-zinc-500', text: '' };
    }
  };

  const { icon, color, text } = getStatusDisplay();
  
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className={`${color} ${status.status === 'saving' ? 'animate-spin' : ''}`}>{icon}</span>
      <span className="text-zinc-400">{text}</span>
    </div>
  );
}

// Hatch Logo Component
function HatchLogo({ collapsed }) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-lg flex items-center justify-center flex-shrink-0">
        <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 2C9.5 2 7 4 7 7c0 2 1 3.5 2.5 4.5V22h5V11.5C16 10.5 17 9 17 7c0-3-2.5-5-5-5zm0 2c1.5 0 3 1.5 3 3 0 1-0.5 2-1.5 2.5V12h-3V9.5C9.5 9 9 8 9 7c0-1.5 1.5-3 3-3z"/>
          <path d="M14 4c0.5 0.5 1 1.5 1 2s-0.3 1-0.5 1.3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          <path d="M16 3c0.8 0.8 1.5 2 1.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </div>
      {!collapsed && (
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">Hatch</h1>
          <p className="text-xs text-emerald-400/70">Fresh made easy</p>
        </div>
      )}
    </div>
  );
}

// Navigation icons
const navIcons = {
  dashboard: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zm10 0a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
    </svg>
  ),
  sales: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
  ),
  locations: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
  orders: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
    </svg>
  ),
  receive: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
    </svg>
  ),
  inventory: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
    </svg>
  ),
  remove: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
    </svg>
  ),
  restock: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  ),
  history: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  admin: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  )
};

const INITIAL_STATE = {
  orders: [],
  stock: {},
  stockBatches: [],
  receipts: [],
  removals: [],
  restocks: [],
  stockChecks: [],
  machineRestocks: [],
  locationStock: {},
  locationConfig: {},
  salesData: [],
  salesImports: [],
  restockRoutes: [
    { id: 'tasting', name: 'Tasting', type: 'adhoc', locations: [] },
    { id: 'other', name: 'Other', type: 'adhoc', locations: [] }
  ],
  warehouses: [
    { id: 'wh1', name: 'Warehouse A', address: '', notes: '' },
    { id: 'wh2', name: 'Warehouse B', address: '', notes: '' },
    { id: 'wh3', name: 'Warehouse C', address: '', notes: '' }
  ],
  locations: [
    { id: 'alstom', name: 'Alstom Trains', type: 'vending', assignedItems: [] }
  ],
  suppliers: [
    { id: 'sup1', name: 'Acme Supplies', contact: '', email: '', phone: '' },
    { id: 'sup2', name: 'Global Parts Co', contact: '', email: '', phone: '' },
    { id: 'sup3', name: 'Prime Distributors', contact: '', email: '', phone: '' },
    { id: 'sup4', name: 'FastShip Ltd', contact: '', email: '', phone: '' }
  ],
  products: []
};

export default function StockTracker() {
  const [data, setData] = useState(INITIAL_STATE);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [loading, setLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState({ status: 'idle', lastSaved: null });
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

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const result = await window.storage.get('stock-tracker-data-v3');
      if (result?.value) {
        const loaded = JSON.parse(result.value);
        setData({ ...INITIAL_STATE, ...loaded });
        setSyncStatus({ status: 'loaded', lastSaved: new Date() });
      } else {
        setSyncStatus({ status: 'new', lastSaved: null });
      }
    } catch (e) {
      console.log('No existing data or storage unavailable');
      setSyncStatus({ status: 'offline', lastSaved: null });
    }
    setLoading(false);
  };

  const saveData = async (newData) => {
    setData(newData);
    setSyncStatus(prev => ({ ...prev, status: 'saving' }));
    try {
      await window.storage.set('stock-tracker-data-v3', JSON.stringify(newData));
      setSyncStatus({ status: 'saved', lastSaved: new Date() });
    } catch (e) {
      console.error('Failed to save:', e);
      setSyncStatus(prev => ({ ...prev, status: 'error' }));
    }
  };

  const handleNavClick = (tabId) => {
    setActiveTab(tabId);
    if (isMobile) {
      setMobileMenuOpen(false);
    }
  };

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: navIcons.dashboard },
    { id: 'sales', label: 'Sales Overview', icon: navIcons.sales },
    { id: 'locations', label: 'Location Stock', icon: navIcons.locations },
    { id: 'orders', label: 'Orders', icon: navIcons.orders },
    { id: 'receive', label: 'Receive Stock', icon: navIcons.receive },
    { id: 'inventory', label: 'Warehouse', icon: navIcons.inventory },
    { id: 'remove', label: 'Remove Stock', icon: navIcons.remove },
    { id: 'restock', label: 'Restock Machine', icon: navIcons.restock },
    { id: 'history', label: 'History', icon: navIcons.history },
    { id: 'admin', label: 'Admin', icon: navIcons.admin }
  ];

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl animate-pulse"></div>
          <div className="text-zinc-400">Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex" style={{ fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
      
      {/* Mobile Menu Overlay */}
      {isMobile && mobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-black/60 z-40 backdrop-blur-sm"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}
      
      {/* Sidebar */}
      <aside className={`
        ${isMobile 
          ? `fixed inset-y-0 left-0 z-50 w-72 transform transition-transform duration-300 ease-in-out ${mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}`
          : `${sidebarCollapsed ? 'w-20' : 'w-64'} relative transition-all duration-300`
        } 
        bg-zinc-900 border-r border-zinc-800 flex flex-col flex-shrink-0
      `}>
        {/* Logo */}
        <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
          <HatchLogo collapsed={!isMobile && sidebarCollapsed} />
          {isMobile && (
            <button
              onClick={() => setMobileMenuOpen(false)}
              className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {navItems.map(item => (
            <button
              key={item.id}
              onClick={() => handleNavClick(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-3 md:py-2.5 rounded-lg text-sm transition-all ${
                activeTab === item.id
                  ? 'bg-gradient-to-r from-emerald-600/20 to-teal-600/20 text-emerald-400 border border-emerald-500/30'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50 active:bg-zinc-800'
              }`}
              title={!isMobile && sidebarCollapsed ? item.label : undefined}
            >
              <span className={`flex-shrink-0 ${activeTab === item.id ? 'text-emerald-400' : ''}`}>
                {item.icon}
              </span>
              {(isMobile || !sidebarCollapsed) && (
                <span className="truncate">{item.label}</span>
              )}
            </button>
          ))}
        </nav>

        {/* Sidebar Footer - Desktop Only */}
        {!isMobile && (
          <div className="p-3 border-t border-zinc-800">
            <button
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 transition-colors"
            >
              <svg className={`w-5 h-5 transition-transform ${sidebarCollapsed ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
              </svg>
              {!sidebarCollapsed && <span className="text-sm">Collapse</span>}
            </button>
          </div>
        )}

        {/* Mobile Footer - Sync Status */}
        {isMobile && (
          <div className="p-4 border-t border-zinc-800">
            <div className="flex items-center justify-between text-sm">
              <SyncIndicator status={syncStatus} />
              <span className="text-zinc-500 text-xs">
                {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
              </span>
            </div>
          </div>
        )}
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top Header */}
        <header className="h-14 md:h-16 border-b border-zinc-800 bg-zinc-900/50 backdrop-blur-sm flex items-center justify-between px-4 md:px-6 flex-shrink-0 sticky top-0 z-30">
          <div className="flex items-center gap-3">
            {/* Mobile Hamburger */}
            {isMobile && (
              <button
                onClick={() => setMobileMenuOpen(true)}
                className="p-2 -ml-2 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 active:bg-zinc-700"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
            )}
            <div>
              <h2 className="text-base md:text-lg font-semibold text-zinc-100">
                {navItems.find(n => n.id === activeTab)?.label || 'Dashboard'}
              </h2>
            </div>
          </div>
          {/* Desktop header items */}
          {!isMobile && (
            <div className="flex items-center gap-6">
              <SyncIndicator status={syncStatus} />
              <div className="text-sm text-zinc-500">
                {new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}
              </div>
            </div>
          )}
          {/* Mobile sync indicator - compact */}
          {isMobile && (
            <div className="flex items-center">
              <span className={`w-2 h-2 rounded-full ${
                syncStatus.status === 'saved' || syncStatus.status === 'loaded' ? 'bg-emerald-500' :
                syncStatus.status === 'saving' ? 'bg-yellow-500 animate-pulse' :
                syncStatus.status === 'error' ? 'bg-red-500' : 'bg-zinc-500'
              }`} />
            </div>
          )}
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-auto p-4 md:p-6">
          <div className="max-w-7xl mx-auto">
            {activeTab === 'dashboard' && <Dashboard data={data} />}
            {activeTab === 'sales' && <SalesOverview data={data} saveData={saveData} />}
            {activeTab === 'locations' && <LocationStock data={data} saveData={saveData} />}
            {activeTab === 'orders' && <Orders data={data} saveData={saveData} />}
            {activeTab === 'receive' && <ReceiveStock data={data} saveData={saveData} />}
            {activeTab === 'inventory' && <Inventory data={data} saveData={saveData} />}
            {activeTab === 'remove' && <RemoveStock data={data} saveData={saveData} />}
            {activeTab === 'restock' && <RestockMachine data={data} saveData={saveData} />}
            {activeTab === 'history' && <History data={data} />}
            {activeTab === 'admin' && <Admin data={data} saveData={saveData} />}
          </div>
        </main>
      </div>
    </div>
  );
}

// ============ SALES OVERVIEW ============

function SalesOverview({ data, saveData }) {
  const [activeSubTab, setActiveSubTab] = useState('overview');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [dateFilter, setDateFilter] = useState({ start: '', end: '' });

  // Parse Vendlive CSV format
  const parseVendliveCSV = (csvText) => {
    const lines = csvText.split('\n').filter(line => line.trim());
    if (lines.length < 2) return { sales: [], products: [] };

    // Find header line (skip empty first line if present)
    let headerIndex = 0;
    if (lines[0].startsWith(',')) headerIndex = 1;
    
    const headers = lines[headerIndex].split(',').map(h => h.trim());
    
    // Find column indices
    const cols = {
      transactionId: headers.indexOf('transaction_id'),
      timestamp: headers.indexOf('timestamp'),
      productId: headers.indexOf('product__id'),
      productName: headers.indexOf('name'),
      category: headers.indexOf('product__category__name'),
      vendStatus: headers.indexOf('vend_status'),
      charged: headers.indexOf('order_sale__charged'),
      price: headers.indexOf('price'),
      costPrice: headers.indexOf('cost_price'),
      defaultPrice: headers.indexOf('product_price_default'),
      barcode: headers.indexOf('product_universal_product_codes'),
      venueName: headers.indexOf('location__venue__name'),
      machineName: headers.indexOf('machine__friendly_name')
    };

    const sales = [];
    const productsMap = new Map();
    const seenTransactions = new Set();

    for (let i = headerIndex + 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i]);
      if (values.length < 10) continue;

      const transactionId = values[cols.transactionId];
      const productId = values[cols.productId];
      const vendStatus = values[cols.vendStatus];
      const charged = values[cols.charged];
      
      // Only process successful sales
      if (vendStatus !== 'Success') continue;
      if (charged === 'Payment Declined') continue;

      // Parse timestamp (DD/MM/YYYY HH:MM format)
      const timestamp = parseVendliveDate(values[cols.timestamp]);
      if (!timestamp) continue;

      const productName = values[cols.productName]?.trim();
      const category = values[cols.category]?.trim();
      const price = parseFloat(values[cols.price]) || 0;
      const costPrice = parseFloat(values[cols.costPrice]) || 0;
      const defaultPrice = parseFloat(values[cols.defaultPrice]) || 0;
      const barcode = values[cols.barcode]?.trim();

      // Create unique key for deduplication
      const saleKey = `${transactionId}-${productId}-${timestamp.getTime()}`;
      if (seenTransactions.has(saleKey)) continue;
      seenTransactions.add(saleKey);

      // Add to sales
      sales.push({
        id: saleKey,
        transactionId,
        timestamp: timestamp.toISOString(),
        productId,
        productName,
        category,
        price,
        costPrice,
        charged: charged === 'Free Vend' ? 0 : price,
        isFreeVend: charged === 'Free Vend'
      });

      // Track products
      if (productId && productName && !productsMap.has(productId)) {
        productsMap.set(productId, {
          sku: productId,
          name: productName,
          category: category || '',
          unitCost: costPrice,
          salePrice: defaultPrice || price,
          barcode: barcode || '',
          unitsPerBox: 1
        });
      }
    }

    return { sales, products: Array.from(productsMap.values()) };
  };

  const parseCSVLine = (line) => {
    const values = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current.trim());
    return values;
  };

  const parseVendliveDate = (dateStr) => {
    if (!dateStr) return null;
    // Format: DD/MM/YYYY HH:MM or DD/MM/YYYY H:MM
    const match = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})/);
    if (!match) return null;
    const [, day, month, year, hour, minute] = match;
    return new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute));
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setImportResult(null);

    try {
      const text = await file.text();
      const { sales, products } = parseVendliveCSV(text);

      // Merge products - update existing or add new
      const existingProducts = [...data.products];
      let newProductCount = 0;
      let updatedProductCount = 0;

      products.forEach(newProduct => {
        const existingIdx = existingProducts.findIndex(p => p.sku === newProduct.sku);
        if (existingIdx >= 0) {
          // Update existing product with new data
          existingProducts[existingIdx] = {
            ...existingProducts[existingIdx],
            name: newProduct.name,
            category: newProduct.category || existingProducts[existingIdx].category,
            unitCost: newProduct.unitCost || existingProducts[existingIdx].unitCost,
            salePrice: newProduct.salePrice || existingProducts[existingIdx].salePrice,
            barcode: newProduct.barcode || existingProducts[existingIdx].barcode
          };
          updatedProductCount++;
        } else {
          existingProducts.push(newProduct);
          newProductCount++;
        }
      });

      // Merge sales - avoid duplicates
      const existingSales = data.salesData || [];
      const existingIds = new Set(existingSales.map(s => s.id));
      const newSales = sales.filter(s => !existingIds.has(s.id));

      // Add import record
      const importRecord = {
        id: Date.now().toString(),
        filename: file.name,
        importedAt: new Date().toISOString(),
        salesCount: newSales.length,
        productsAdded: newProductCount,
        productsUpdated: updatedProductCount
      };

      saveData({
        ...data,
        products: existingProducts,
        salesData: [...existingSales, ...newSales],
        salesImports: [...(data.salesImports || []), importRecord]
      });

      setImportResult({
        success: true,
        salesImported: newSales.length,
        salesSkipped: sales.length - newSales.length,
        productsAdded: newProductCount,
        productsUpdated: updatedProductCount
      });
    } catch (error) {
      console.error('Import error:', error);
      setImportResult({ success: false, error: error.message });
    }

    setImporting(false);
    e.target.value = '';
  };

  // Filter sales by date
  const getFilteredSales = () => {
    let sales = data.salesData || [];
    if (dateFilter.start) {
      const start = new Date(dateFilter.start);
      sales = sales.filter(s => new Date(s.timestamp) >= start);
    }
    if (dateFilter.end) {
      const end = new Date(dateFilter.end);
      end.setHours(23, 59, 59);
      sales = sales.filter(s => new Date(s.timestamp) <= end);
    }
    return sales;
  };

  const filteredSales = getFilteredSales();

  // Calculate metrics
  const totalRevenue = filteredSales.reduce((acc, s) => acc + s.charged, 0);
  const totalCost = filteredSales.reduce((acc, s) => acc + s.costPrice, 0);
  const totalProfit = totalRevenue - totalCost;
  const totalUnits = filteredSales.length;
  const freeVends = filteredSales.filter(s => s.isFreeVend).length;

  // Sales by product
  const salesByProduct = filteredSales.reduce((acc, s) => {
    if (!acc[s.productId]) {
      acc[s.productId] = { name: s.productName, category: s.category, units: 0, revenue: 0, cost: 0 };
    }
    acc[s.productId].units++;
    acc[s.productId].revenue += s.charged;
    acc[s.productId].cost += s.costPrice;
    return acc;
  }, {});

  // Sales by day
  const salesByDay = filteredSales.reduce((acc, s) => {
    const day = new Date(s.timestamp).toLocaleDateString('en-GB');
    if (!acc[day]) acc[day] = { units: 0, revenue: 0 };
    acc[day].units++;
    acc[day].revenue += s.charged;
    return acc;
  }, {});

  // Sales by category
  const salesByCategory = filteredSales.reduce((acc, s) => {
    const cat = s.category || 'Other';
    if (!acc[cat]) acc[cat] = { units: 0, revenue: 0 };
    acc[cat].units++;
    acc[cat].revenue += s.charged;
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-xl font-semibold">Sales Overview</h2>
          <p className="text-zinc-500 text-sm mt-1">Track vending machine sales from Vendlive exports</p>
        </div>
        <div className="flex items-center gap-3">
          <label className={`px-4 py-2 rounded text-sm font-medium cursor-pointer transition-colors ${
            importing ? 'bg-zinc-700 text-zinc-400' : 'bg-emerald-600 text-white hover:bg-emerald-500'
          }`}>
            {importing ? 'Importing...' : '↑ Import CSV'}
            <input
              type="file"
              accept=".csv"
              onChange={handleFileUpload}
              disabled={importing}
              className="hidden"
            />
          </label>
        </div>
      </div>

      {importResult && (
        <div className={`p-4 rounded-lg ${importResult.success ? 'bg-emerald-900/20 border border-emerald-900/50' : 'bg-red-900/20 border border-red-900/50'}`}>
          {importResult.success ? (
            <div className="text-emerald-300 text-sm">
              <strong>Import successful!</strong> {importResult.salesImported} sales imported, {importResult.salesSkipped} duplicates skipped. 
              {importResult.productsAdded > 0 && ` ${importResult.productsAdded} new products added.`}
              {importResult.productsUpdated > 0 && ` ${importResult.productsUpdated} products updated.`}
            </div>
          ) : (
            <div className="text-red-300 text-sm">Import failed: {importResult.error}</div>
          )}
        </div>
      )}

      <div className="flex gap-2 border-b border-zinc-800 pb-4">
        {[
          { id: 'overview', label: 'Overview' },
          { id: 'products', label: 'By Product' },
          { id: 'daily', label: 'Daily Sales' },
          { id: 'transactions', label: 'Transactions' },
          { id: 'imports', label: 'Import History' }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveSubTab(tab.id)}
            className={`px-4 py-2 rounded text-sm transition-colors ${
              activeSubTab === tab.id ? 'bg-emerald-500 text-zinc-900' : 'bg-zinc-800 text-zinc-400 hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Date Filter */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-zinc-500 text-sm">From:</span>
          <input
            type="date"
            value={dateFilter.start}
            onChange={e => setDateFilter({ ...dateFilter, start: e.target.value })}
            className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-emerald-500"
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-zinc-500 text-sm">To:</span>
          <input
            type="date"
            value={dateFilter.end}
            onChange={e => setDateFilter({ ...dateFilter, end: e.target.value })}
            className="bg-zinc-800 border border-zinc-700 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-emerald-500"
          />
        </div>
        {(dateFilter.start || dateFilter.end) && (
          <button
            onClick={() => setDateFilter({ start: '', end: '' })}
            className="text-zinc-400 hover:text-white text-sm"
          >
            Clear filter
          </button>
        )}
      </div>

      {activeSubTab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
              <div className="text-2xl font-bold text-emerald-400">£{totalRevenue.toFixed(2)}</div>
              <div className="text-xs text-zinc-500 mt-1">Total Revenue</div>
            </div>
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
              <div className="text-2xl font-bold text-red-400">£{totalCost.toFixed(2)}</div>
              <div className="text-xs text-zinc-500 mt-1">Total Cost</div>
            </div>
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
              <div className="text-2xl font-bold text-emerald-400">£{totalProfit.toFixed(2)}</div>
              <div className="text-xs text-zinc-500 mt-1">Gross Profit</div>
            </div>
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
              <div className="text-2xl font-bold text-blue-400">{totalUnits}</div>
              <div className="text-xs text-zinc-500 mt-1">Units Sold</div>
            </div>
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
              <div className="text-2xl font-bold text-purple-400">{freeVends}</div>
              <div className="text-xs text-zinc-500 mt-1">Free Vends</div>
            </div>
          </div>

          {/* Category breakdown */}
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6">
            <h3 className="text-sm font-medium text-zinc-400 mb-4">Sales by Category</h3>
            <div className="space-y-3">
              {Object.entries(salesByCategory)
                .sort((a, b) => b[1].revenue - a[1].revenue)
                .map(([category, stats]) => (
                  <div key={category} className="flex items-center justify-between py-2 border-b border-zinc-800 last:border-0">
                    <span className="text-zinc-300">{category}</span>
                    <div className="flex gap-6 text-sm">
                      <span className="text-zinc-500">{stats.units} units</span>
                      <span className="text-emerald-400 font-medium">£{stats.revenue.toFixed(2)}</span>
                    </div>
                  </div>
                ))}
            </div>
          </div>

          {/* Top products */}
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6">
            <h3 className="text-sm font-medium text-zinc-400 mb-4">Top Selling Products</h3>
            <div className="space-y-3">
              {Object.entries(salesByProduct)
                .sort((a, b) => b[1].units - a[1].units)
                .slice(0, 10)
                .map(([productId, stats]) => (
                  <div key={productId} className="flex items-center justify-between py-2 border-b border-zinc-800 last:border-0">
                    <div>
                      <span className="text-zinc-300">{stats.name}</span>
                      <span className="text-zinc-600 text-xs ml-2">{stats.category}</span>
                    </div>
                    <div className="flex gap-6 text-sm">
                      <span className="text-zinc-500">{stats.units} sold</span>
                      <span className="text-emerald-400 font-medium">£{stats.revenue.toFixed(2)}</span>
                      <span className="text-emerald-400">£{(stats.revenue - stats.cost).toFixed(2)} profit</span>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}

      {activeSubTab === 'products' && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Product</th>
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Category</th>
                <th className="text-right px-4 py-3 text-zinc-500 font-medium">Units</th>
                <th className="text-right px-4 py-3 text-zinc-500 font-medium">Revenue</th>
                <th className="text-right px-4 py-3 text-zinc-500 font-medium">Cost</th>
                <th className="text-right px-4 py-3 text-zinc-500 font-medium">Profit</th>
                <th className="text-right px-4 py-3 text-zinc-500 font-medium">Margin</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(salesByProduct)
                .sort((a, b) => b[1].revenue - a[1].revenue)
                .map(([productId, stats]) => {
                  const profit = stats.revenue - stats.cost;
                  const margin = stats.revenue > 0 ? (profit / stats.revenue * 100) : 0;
                  return (
                    <tr key={productId} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                      <td className="px-4 py-3 text-zinc-200">{stats.name}</td>
                      <td className="px-4 py-3 text-zinc-500">{stats.category}</td>
                      <td className="text-right px-4 py-3 text-zinc-300">{stats.units}</td>
                      <td className="text-right px-4 py-3 text-emerald-400">£{stats.revenue.toFixed(2)}</td>
                      <td className="text-right px-4 py-3 text-red-400">£{stats.cost.toFixed(2)}</td>
                      <td className="text-right px-4 py-3 text-emerald-400">£{profit.toFixed(2)}</td>
                      <td className="text-right px-4 py-3 text-zinc-400">{margin.toFixed(1)}%</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      )}

      {activeSubTab === 'daily' && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Date</th>
                <th className="text-right px-4 py-3 text-zinc-500 font-medium">Units Sold</th>
                <th className="text-right px-4 py-3 text-zinc-500 font-medium">Revenue</th>
                <th className="text-right px-4 py-3 text-zinc-500 font-medium">Avg per Sale</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(salesByDay)
                .sort((a, b) => {
                  const [da, ma, ya] = a[0].split('/').map(Number);
                  const [db, mb, yb] = b[0].split('/').map(Number);
                  return new Date(yb, mb-1, db) - new Date(ya, ma-1, da);
                })
                .map(([date, stats]) => (
                  <tr key={date} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                    <td className="px-4 py-3 text-zinc-200">{date}</td>
                    <td className="text-right px-4 py-3 text-zinc-300">{stats.units}</td>
                    <td className="text-right px-4 py-3 text-emerald-400">£{stats.revenue.toFixed(2)}</td>
                    <td className="text-right px-4 py-3 text-zinc-400">£{(stats.revenue / stats.units).toFixed(2)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {activeSubTab === 'transactions' && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Date/Time</th>
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Product</th>
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Category</th>
                <th className="text-right px-4 py-3 text-zinc-500 font-medium">Price</th>
                <th className="text-right px-4 py-3 text-zinc-500 font-medium">Charged</th>
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Type</th>
              </tr>
            </thead>
            <tbody>
              {filteredSales
                .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
                .slice(0, 100)
                .map(sale => (
                  <tr key={sale.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                    <td className="px-4 py-3 text-zinc-400 text-xs">
                      {new Date(sale.timestamp).toLocaleString('en-GB')}
                    </td>
                    <td className="px-4 py-3 text-zinc-200">{sale.productName}</td>
                    <td className="px-4 py-3 text-zinc-500">{sale.category}</td>
                    <td className="text-right px-4 py-3 text-zinc-300">£{sale.price.toFixed(2)}</td>
                    <td className="text-right px-4 py-3 text-emerald-400">£{sale.charged.toFixed(2)}</td>
                    <td className="px-4 py-3">
                      {sale.isFreeVend ? (
                        <span className="text-xs bg-purple-500/20 text-purple-400 px-2 py-0.5 rounded">Free</span>
                      ) : (
                        <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded">Paid</span>
                      )}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          {filteredSales.length > 100 && (
            <div className="px-4 py-3 text-center text-zinc-500 text-sm border-t border-zinc-800">
              Showing 100 of {filteredSales.length} transactions
            </div>
          )}
        </div>
      )}

      {activeSubTab === 'imports' && (
        <div className="space-y-4">
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6">
            <h3 className="text-sm font-medium text-zinc-400 mb-4">Import History</h3>
            {(!data.salesImports || data.salesImports.length === 0) ? (
              <p className="text-zinc-500 text-sm">No imports yet. Upload a Vendlive CSV export to get started.</p>
            ) : (
              <div className="space-y-3">
                {data.salesImports.slice().reverse().map(imp => (
                  <div key={imp.id} className="flex items-center justify-between py-2 border-b border-zinc-800 last:border-0">
                    <div>
                      <span className="text-zinc-300">{imp.filename}</span>
                      <div className="text-xs text-zinc-500 mt-0.5">
                        {new Date(imp.importedAt).toLocaleString('en-GB')}
                      </div>
                    </div>
                    <div className="flex gap-4 text-sm">
                      <span className="text-zinc-400">{imp.salesCount} sales</span>
                      <span className="text-emerald-400">+{imp.productsAdded} products</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-blue-900/20 border border-blue-900/50 rounded-lg p-4">
            <p className="text-blue-300 text-sm">
              <strong>Supported Format:</strong> Vendlive transaction export CSV. The system will automatically extract products (SKU, name, category, cost price, sale price) and sales transactions from successful vends.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ============ LOCATION STOCK DASHBOARD ============

function LocationStock({ data, saveData }) {
  const [selectedLocation, setSelectedLocation] = useState(data.locations[0]?.id || '');
  const [showConfig, setShowConfig] = useState(false);
  const [showAddProduct, setShowAddProduct] = useState(false);
  
  // Stock upload states
  const [showStockUpload, setShowStockUpload] = useState(false);
  const [uploadProcessing, setUploadProcessing] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [extractedStockItems, setExtractedStockItems] = useState([]);
  const [productsToCreate, setProductsToCreate] = useState([]);
  const [uploadImages, setUploadImages] = useState([]);
  const [reviewMode, setReviewMode] = useState(false);

  const location = data.locations.find(l => l.id === selectedLocation);
  const locStock = data.locationStock[selectedLocation] || {};
  const locConfig = data.locationConfig[selectedLocation] || {};

  const getProductsForLocation = () => {
    if (!location) return [];
    if (location.assignedItems?.length > 0) {
      return data.products.filter(p => location.assignedItems.includes(p.sku));
    }
    return data.products;
  };

  const getUnassignedProducts = () => {
    if (!location) return [];
    const assigned = location.assignedItems || [];
    return data.products.filter(p => !assigned.includes(p.sku));
  };

  const addProductToLocation = (sku) => {
    if (!location) return;
    const currentAssigned = location.assignedItems || [];
    const newAssigned = [...currentAssigned, sku];
    const updatedLocations = data.locations.map(l => 
      l.id === selectedLocation ? { ...l, assignedItems: newAssigned } : l
    );
    saveData({ ...data, locations: updatedLocations });
  };

  const removeProductFromLocation = (sku) => {
    if (!location) return;
    const currentAssigned = location.assignedItems || [];
    const newAssigned = currentAssigned.filter(s => s !== sku);
    const updatedLocations = data.locations.map(l => 
      l.id === selectedLocation ? { ...l, assignedItems: newAssigned } : l
    );
    saveData({ ...data, locations: updatedLocations });
  };

  const updateStock = (sku, value) => {
    const newVal = Math.max(0, parseInt(value) || 0);
    const newLocationStock = {
      ...data.locationStock,
      [selectedLocation]: {
        ...(data.locationStock[selectedLocation] || {}),
        [sku]: newVal
      }
    };
    saveData({ ...data, locationStock: newLocationStock });
  };

  const adjustStock = (sku, delta) => {
    const current = locStock[sku] || 0;
    updateStock(sku, current + delta);
  };

  const updateConfig = (sku, field, value) => {
    const newConfig = {
      ...data.locationConfig,
      [selectedLocation]: {
        ...(data.locationConfig[selectedLocation] || {}),
        [sku]: {
          ...(data.locationConfig[selectedLocation]?.[sku] || {}),
          [field]: parseInt(value) || 0
        }
      }
    };
    saveData({ ...data, locationConfig: newConfig });
  };

  const getStockStatus = (sku, qty) => {
    const config = locConfig[sku] || {};
    const min = config.minStock || 0;
    const max = config.maxStock || 0;
    
    if (max > 0 && qty >= max) return { status: 'full', color: 'green' };
    if (min > 0 && qty <= min) return { status: 'low', color: 'red' };
    if (min > 0 && qty <= min * 1.5) return { status: 'warning', color: 'yellow' };
    return { status: 'ok', color: 'zinc' };
  };

  // AI-powered stock screenshot analysis
  const analyzeStockScreenshotWithAI = async (imageData, mimeType) => {
    const existingProducts = data.products.map(p => `- ${p.name} (SKU: ${p.sku}, Category: ${p.category || 'Unknown'})`).join('\n');
    
    const prompt = `Analyze this stock management screenshot and extract all product information.

EXISTING PRODUCTS IN SYSTEM:
${existingProducts || 'No existing products'}

Return ONLY valid JSON with this exact structure (no markdown, no explanation):
{
  "items": [
    {
      "name": "full product name as shown",
      "nameClean": "cleaned/normalized product name for matching",
      "category": "one of: Meals, Drinks, Snacks, Breakfast, Other",
      "stockCount": 0,
      "price": 0.00,
      "matchedSku": "SKU if it matches an existing product, otherwise null",
      "confidence": "high/medium/low"
    }
  ],
  "totalItemsFound": 0,
  "categories": ["list of unique categories found"]
}

MATCHING RULES:
1. Match products by comparing names - look for brand names like "Barebells", "Fiesty", "Marna", "Parsley Box", "Fiid", "MOMA", "Misfits", "Peperami", "Jack Links", etc.
2. Include variant info in the name (e.g., "Barebells Milkshake - Chocolate", "MOMA Porridge Pot - Berry")
3. Stock count is shown as "Stock: X" - extract the number X
4. Price is shown as £X.XX
5. Categories are shown as section headers (Drinks, Meals, Breakfast, Snacks)
6. If a product closely matches an existing one, use its SKU in matchedSku
7. Be thorough - extract EVERY visible product row

Example parsing:
- "Barebells Milkshake -..." with "Stock: 10" and "£3.25" → name: "Barebells Milkshake", stockCount: 10, price: 3.25
- Look for truncated names and expand them logically based on context`;

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4000,
          messages: [{
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mimeType,
                  data: imageData.split(',')[1]
                }
              },
              { type: 'text', text: prompt }
            ]
          }]
        })
      });

      const result = await response.json();
      const textContent = result.content?.find(c => c.type === 'text')?.text || '';
      
      const jsonMatch = textContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      throw new Error('Could not parse AI response');
    } catch (error) {
      console.error('AI analysis error:', error);
      throw error;
    }
  };

  // Find best matching product from existing products
  const findBestProductMatch = (itemName, itemCategory) => {
    const normalizedName = itemName.toLowerCase().trim();
    
    // Try exact match first
    let match = data.products.find(p => 
      p.name.toLowerCase() === normalizedName
    );
    if (match) return { match, confidence: 'exact' };

    // Try contains match
    match = data.products.find(p => 
      p.name.toLowerCase().includes(normalizedName) ||
      normalizedName.includes(p.name.toLowerCase())
    );
    if (match) return { match, confidence: 'high' };

    // Try word-based matching
    const itemWords = normalizedName.split(/[\s\-]+/).filter(w => w.length > 2);
    let bestMatch = null;
    let bestScore = 0;

    for (const product of data.products) {
      const productWords = product.name.toLowerCase().split(/[\s\-]+/).filter(w => w.length > 2);
      const matchingWords = itemWords.filter(w => 
        productWords.some(pw => pw.includes(w) || w.includes(pw))
      );
      const score = matchingWords.length / Math.max(itemWords.length, productWords.length);
      
      if (score > bestScore && score >= 0.5) {
        bestScore = score;
        bestMatch = product;
      }
    }

    if (bestMatch) {
      return { match: bestMatch, confidence: bestScore >= 0.7 ? 'high' : 'medium' };
    }

    return { match: null, confidence: 'none' };
  };

  // Handle stock screenshot upload
  const handleStockUpload = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    setUploadProcessing(true);
    setShowStockUpload(true);
    setUploadError(null);
    setExtractedStockItems([]);
    setProductsToCreate([]);

    const imageDataList = [];
    
    // Read all files
    for (const file of files) {
      const imageData = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (ev) => resolve({ data: ev.target?.result, type: file.type || 'image/png' });
        reader.readAsDataURL(file);
      });
      imageDataList.push(imageData);
    }
    
    setUploadImages(imageDataList);

    try {
      // Process each image
      const allItems = [];
      
      for (const img of imageDataList) {
        const analyzed = await analyzeStockScreenshotWithAI(img.data, img.type);
        if (analyzed.items) {
          allItems.push(...analyzed.items);
        }
      }

      // Process and deduplicate items
      const processedItems = [];
      const newProducts = [];
      const seenNames = new Set();

      for (const item of allItems) {
        // Skip duplicates
        const normalizedName = (item.nameClean || item.name).toLowerCase().trim();
        if (seenNames.has(normalizedName)) continue;
        seenNames.add(normalizedName);

        // Try to match to existing product
        let matchResult = { match: null, confidence: 'none' };
        
        if (item.matchedSku) {
          const existingProduct = data.products.find(p => p.sku === item.matchedSku);
          if (existingProduct) {
            matchResult = { match: existingProduct, confidence: 'high' };
          }
        }
        
        if (!matchResult.match) {
          matchResult = findBestProductMatch(item.name, item.category);
        }

        if (matchResult.match) {
          processedItems.push({
            ...item,
            matchedSku: matchResult.match.sku,
            matchedName: matchResult.match.name,
            isNew: false,
            matchConfidence: matchResult.confidence,
            selected: true,
            stockCount: item.stockCount || 0
          });
        } else {
          // Generate SKU for new product
          const categoryPrefix = (item.category || 'OTHER').substring(0, 3).toUpperCase();
          const generatedSku = `${categoryPrefix}-${Date.now().toString().slice(-4)}-${processedItems.length + newProducts.length + 1}`;
          
          processedItems.push({
            ...item,
            sku: generatedSku,
            isNew: true,
            selected: true,
            matchConfidence: 'new',
            stockCount: item.stockCount || 0
          });
          
          newProducts.push({
            sku: generatedSku,
            name: item.name,
            category: item.category || 'Other',
            unitCost: item.price || 0,
            salePrice: item.price || 0
          });
        }
      }

      setExtractedStockItems(processedItems);
      setProductsToCreate(newProducts);
      setReviewMode(true);
      setUploadProcessing(false);

    } catch (error) {
      console.error('Stock upload error:', error);
      setUploadError('Failed to analyze screenshots. Please try again.');
      setUploadProcessing(false);
    }
  };

  // Update extracted item
  const updateExtractedStockItem = (idx, field, value) => {
    const items = [...extractedStockItems];
    items[idx][field] = value;
    
    // If manually matching to existing product
    if (field === 'matchedSku' && value) {
      const product = data.products.find(p => p.sku === value);
      if (product) {
        items[idx].matchedName = product.name;
        items[idx].isNew = false;
        items[idx].matchConfidence = 'manual';
        setProductsToCreate(prev => prev.filter(p => p.sku !== items[idx].sku));
      }
    }
    
    setExtractedStockItems(items);
  };

  // Toggle item selection
  const toggleStockItemSelection = (idx) => {
    const items = [...extractedStockItems];
    items[idx].selected = !items[idx].selected;
    setExtractedStockItems(items);
  };

  // Apply extracted stock data
  const applyExtractedStockData = () => {
    // Create new products first
    const selectedNewProducts = productsToCreate.filter(p => 
      extractedStockItems.some(item => item.selected && item.isNew && item.sku === p.sku)
    );
    
    let newProductsList = [...data.products];
    
    for (const newProd of selectedNewProducts) {
      if (!newProductsList.find(p => p.sku === newProd.sku)) {
        newProductsList.push({
          sku: newProd.sku,
          name: newProd.name,
          category: newProd.category,
          unitCost: newProd.unitCost,
          salePrice: newProd.salePrice
        });
      }
    }

    // Build new location stock (only updates stock levels, not menu assignment)
    const newLocationStock = { ...(data.locationStock[selectedLocation] || {}) };
    
    for (const item of extractedStockItems) {
      if (!item.selected) continue;
      
      const sku = item.isNew ? item.sku : item.matchedSku;
      if (sku) {
        newLocationStock[sku] = item.stockCount || 0;
      }
    }

    // Save changes (products and stock only - does NOT modify location menu assignments)
    saveData({
      ...data,
      products: newProductsList,
      locationStock: {
        ...data.locationStock,
        [selectedLocation]: newLocationStock
      }
    });

    // Reset upload state
    setShowStockUpload(false);
    setReviewMode(false);
    setExtractedStockItems([]);
    setProductsToCreate([]);
    setUploadImages([]);
  };

  const products = getProductsForLocation();
  const unassignedProducts = getUnassignedProducts();
  const totalUnits = products.reduce((acc, p) => acc + (locStock[p.sku] || 0), 0);
  const lowStockCount = products.filter(p => {
    const config = locConfig[p.sku] || {};
    return config.minStock && (locStock[p.sku] || 0) <= config.minStock;
  }).length;

  const hasAssignedItems = location?.assignedItems?.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Location Stock</h2>
          <p className="text-zinc-500 text-sm mt-1 hidden md:block">View and update stock levels at each location</p>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3">
          <select
            value={selectedLocation}
            onChange={e => { setSelectedLocation(e.target.value); setShowAddProduct(false); }}
            className="bg-zinc-800 border border-zinc-700 rounded px-4 py-2.5 text-sm focus:outline-none focus:border-emerald-500"
          >
            {data.locations.map(l => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
          <div className="flex gap-2">
            <label className="flex-1 sm:flex-none px-3 py-2.5 bg-teal-600 text-white rounded text-sm font-medium hover:bg-teal-500 transition-colors cursor-pointer text-center">
              📷 <span className="hidden sm:inline">Upload Screenshot</span><span className="sm:hidden">Upload</span>
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={handleStockUpload}
                className="hidden"
              />
            </label>
            <button
              onClick={() => { setShowConfig(!showConfig); setShowAddProduct(false); }}
              className={`flex-1 sm:flex-none px-3 py-2.5 rounded text-sm transition-colors ${
                showConfig ? 'bg-emerald-500 text-zinc-900' : 'bg-zinc-800 text-zinc-400 hover:text-white'
              }`}
            >
              {showConfig ? 'Done' : '⚙️ Config'}
            </button>
          </div>
        </div>
      </div>

      {/* Stock Upload Modal */}
      {showStockUpload && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-zinc-200">
              {reviewMode ? 'Review Extracted Stock Data' : 'Analyzing Screenshots'}
            </h3>
            <button 
              onClick={() => { setShowStockUpload(false); setReviewMode(false); setExtractedStockItems([]); }}
              className="text-zinc-500 hover:text-zinc-300 text-xl"
            >
              ×
            </button>
          </div>

          {uploadProcessing && (
            <div className="text-center py-12">
              <div className="inline-block animate-spin text-teal-400 text-3xl mb-4">↻</div>
              <p className="text-zinc-400">Analyzing stock screenshots with AI...</p>
              <p className="text-zinc-500 text-sm mt-2">Extracting products, quantities, and prices</p>
            </div>
          )}

          {uploadError && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
              <p className="text-red-400 text-sm">{uploadError}</p>
            </div>
          )}

          {reviewMode && (
            <div className="space-y-6">
              {/* Screenshots Preview */}
              {uploadImages.length > 0 && (
                <div className="flex gap-2 overflow-x-auto pb-2">
                  {uploadImages.map((img, idx) => (
                    <img 
                      key={idx} 
                      src={img.data} 
                      alt={`Screenshot ${idx + 1}`} 
                      className="h-24 rounded border border-zinc-700 flex-shrink-0"
                    />
                  ))}
                </div>
              )}

              {/* Summary Stats */}
              <div className="grid grid-cols-4 gap-4">
                <div className="bg-zinc-800/50 rounded-lg p-3 text-center">
                  <div className="text-xl font-bold text-teal-400">{extractedStockItems.length}</div>
                  <div className="text-xs text-zinc-500">Items Found</div>
                </div>
                <div className="bg-zinc-800/50 rounded-lg p-3 text-center">
                  <div className="text-xl font-bold text-emerald-400">
                    {extractedStockItems.filter(i => !i.isNew).length}
                  </div>
                  <div className="text-xs text-zinc-500">Matched</div>
                </div>
                <div className="bg-zinc-800/50 rounded-lg p-3 text-center">
                  <div className="text-xl font-bold text-yellow-400">
                    {extractedStockItems.filter(i => i.isNew).length}
                  </div>
                  <div className="text-xs text-zinc-500">New Products</div>
                </div>
                <div className="bg-zinc-800/50 rounded-lg p-3 text-center">
                  <div className="text-xl font-bold text-blue-400">
                    {extractedStockItems.filter(i => i.selected).reduce((acc, i) => acc + (i.stockCount || 0), 0)}
                  </div>
                  <div className="text-xs text-zinc-500">Total Units</div>
                </div>
              </div>

              {/* Category Legend */}
              <div className="flex gap-4 text-xs">
                <span className="text-emerald-400">● Matched (Existing Product)</span>
                <span className="text-yellow-400">● New Product</span>
              </div>

              {/* Extracted Items List */}
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {extractedStockItems.map((item, idx) => (
                  <div 
                    key={idx} 
                    className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${
                      item.selected
                        ? item.isNew
                          ? 'bg-yellow-500/5 border-yellow-500/30'
                          : 'bg-emerald-500/5 border-emerald-500/30'
                        : 'bg-zinc-800/30 border-zinc-700 opacity-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={item.selected}
                      onChange={() => toggleStockItemSelection(idx)}
                      className="w-4 h-4 rounded border-zinc-600"
                    />

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-xs px-1.5 py-0.5 rounded ${
                          item.isNew 
                            ? 'bg-yellow-500/20 text-yellow-400' 
                            : 'bg-emerald-500/20 text-emerald-400'
                        }`}>
                          {item.isNew ? 'NEW' : item.matchConfidence?.toUpperCase() || 'MATCHED'}
                        </span>
                        <span className="text-xs bg-zinc-700 px-1.5 py-0.5 rounded text-zinc-400">
                          {item.category}
                        </span>
                      </div>
                      <p className="text-sm text-zinc-200 mt-1">{item.name}</p>
                      {!item.isNew && item.matchedName && item.matchedName !== item.name && (
                        <p className="text-xs text-zinc-500">→ {item.matchedName}</p>
                      )}
                    </div>

                    {/* Match to existing product dropdown for new items */}
                    {item.isNew && item.selected && (
                      <select
                        value={item.matchedSku || ''}
                        onChange={(e) => {
                          if (e.target.value) {
                            updateExtractedStockItem(idx, 'matchedSku', e.target.value);
                          }
                        }}
                        className="bg-zinc-700 border border-zinc-600 rounded px-2 py-1 text-xs max-w-[150px]"
                      >
                        <option value="">Create New</option>
                        {data.products.map(p => (
                          <option key={p.sku} value={p.sku}>{p.name}</option>
                        ))}
                      </select>
                    )}

                    <div className="text-center">
                      <p className="text-zinc-500 text-xs">Stock</p>
                      <input
                        type="number"
                        value={item.stockCount || 0}
                        onChange={(e) => updateExtractedStockItem(idx, 'stockCount', parseInt(e.target.value) || 0)}
                        className="w-16 bg-zinc-700 border border-zinc-600 rounded px-2 py-1 text-center text-sm"
                      />
                    </div>

                    <div className="text-center">
                      <p className="text-zinc-500 text-xs">Price</p>
                      <p className="text-zinc-300 text-sm">£{(item.price || 0).toFixed(2)}</p>
                    </div>
                  </div>
                ))}

                {extractedStockItems.length === 0 && !uploadProcessing && (
                  <p className="text-zinc-500 text-center py-8">No items extracted from screenshots</p>
                )}
              </div>

              {/* New Products Warning */}
              {productsToCreate.filter(p => extractedStockItems.some(i => i.selected && i.isNew && i.sku === p.sku)).length > 0 && (
                <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
                  <h4 className="text-sm font-medium text-yellow-400 mb-2">
                    New Products to Create ({productsToCreate.filter(p => extractedStockItems.some(i => i.selected && i.isNew && i.sku === p.sku)).length})
                  </h4>
                  <p className="text-zinc-400 text-xs mb-2">
                    These will be added to your product catalog and assigned to this location.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {productsToCreate
                      .filter(p => extractedStockItems.some(i => i.selected && i.isNew && i.sku === p.sku))
                      .map(p => (
                        <span key={p.sku} className="text-xs bg-yellow-500/20 text-yellow-300 px-2 py-1 rounded">
                          {p.name} ({p.category})
                        </span>
                      ))}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex gap-3 pt-4 border-t border-zinc-800">
                <button
                  onClick={applyExtractedStockData}
                  disabled={extractedStockItems.filter(i => i.selected).length === 0}
                  className="flex-1 px-4 py-3 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Apply Stock Updates ({extractedStockItems.filter(i => i.selected).length} items)
                </button>
                <button
                  onClick={() => { setShowStockUpload(false); setReviewMode(false); }}
                  className="px-4 py-3 bg-zinc-700 text-zinc-300 rounded-lg text-sm hover:bg-zinc-600"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {location && !showStockUpload && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
              <div className="text-2xl font-bold text-emerald-400">{products.length}</div>
              <div className="text-xs text-zinc-500 mt-1">Products</div>
            </div>
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
              <div className="text-2xl font-bold text-blue-400">{totalUnits}</div>
              <div className="text-xs text-zinc-500 mt-1">Total Units</div>
            </div>
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
              <div className="text-2xl font-bold text-red-400">{lowStockCount}</div>
              <div className="text-xs text-zinc-500 mt-1">Low Stock Items</div>
            </div>
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
              <div className="text-2xl font-bold text-zinc-400 capitalize">{location.type}</div>
              <div className="text-xs text-zinc-500 mt-1">Location Type</div>
            </div>
          </div>

          {showConfig && (
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h4 className="text-sm font-medium text-zinc-300">Assigned Products</h4>
                  <p className="text-xs text-zinc-500 mt-1">
                    {hasAssignedItems 
                      ? `${products.length} products assigned to this location`
                      : 'All products allowed (no specific assignments)'}
                  </p>
                </div>
                {unassignedProducts.length > 0 && (
                  <button
                    onClick={() => setShowAddProduct(!showAddProduct)}
                    className="px-3 py-1.5 bg-emerald-600 text-white rounded text-sm hover:bg-emerald-500"
                  >
                    + Add Product
                  </button>
                )}
              </div>
              
              {showAddProduct && unassignedProducts.length > 0 && (
                <div className="mb-4 p-3 bg-zinc-800/50 rounded-lg">
                  <p className="text-xs text-zinc-400 mb-2">Select products to add:</p>
                  <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
                    {unassignedProducts.map(p => (
                      <button
                        key={p.sku}
                        onClick={() => addProductToLocation(p.sku)}
                        className="px-3 py-1.5 bg-zinc-700 hover:bg-emerald-600 text-zinc-300 hover:text-white rounded text-sm transition-colors"
                      >
                        {p.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800">
                  <th className="text-left px-4 py-3 text-zinc-500 font-medium">Product</th>
                  <th className="text-left px-4 py-3 text-zinc-500 font-medium">SKU</th>
                  {showConfig && (
                    <>
                      <th className="text-center px-4 py-3 text-zinc-500 font-medium">Min Stock</th>
                      <th className="text-center px-4 py-3 text-zinc-500 font-medium">Max Stock</th>
                    </>
                  )}
                  <th className="text-center px-4 py-3 text-zinc-500 font-medium">Status</th>
                  <th className="text-right px-4 py-3 text-zinc-500 font-medium">Current Stock</th>
                  <th className="text-center px-4 py-3 text-zinc-500 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {products.length === 0 ? (
                  <tr>
                    <td colSpan={showConfig ? 7 : 5} className="px-4 py-8 text-center text-zinc-600">
                      No products assigned to this location
                    </td>
                  </tr>
                ) : (
                  products.map(product => {
                    const qty = locStock[product.sku] || 0;
                    const config = locConfig[product.sku] || {};
                    const { status, color } = getStockStatus(product.sku, qty);
                    
                    return (
                      <tr key={product.sku} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                        <td className="px-4 py-3 text-zinc-200">{product.name}</td>
                        <td className="px-4 py-3 text-zinc-500 text-xs font-mono">{product.sku}</td>
                        {showConfig && (
                          <>
                            <td className="px-4 py-3">
                              <input
                                type="number"
                                value={config.minStock || ''}
                                onChange={e => updateConfig(product.sku, 'minStock', e.target.value)}
                                placeholder="0"
                                className="w-20 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm text-center focus:outline-none focus:border-emerald-500"
                              />
                            </td>
                            <td className="px-4 py-3">
                              <input
                                type="number"
                                value={config.maxStock || ''}
                                onChange={e => updateConfig(product.sku, 'maxStock', e.target.value)}
                                placeholder="0"
                                className="w-20 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm text-center focus:outline-none focus:border-emerald-500"
                              />
                            </td>
                          </>
                        )}
                        <td className="px-4 py-3 text-center">
                          <span className={`inline-block px-2 py-0.5 rounded text-xs ${
                            color === 'red' ? 'bg-red-500/20 text-red-400' :
                            color === 'yellow' ? 'bg-yellow-500/20 text-yellow-400' :
                            color === 'green' ? 'bg-emerald-500/20 text-emerald-400' :
                            'bg-zinc-700 text-zinc-400'
                          }`}>
                            {status}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <input
                            type="number"
                            value={qty}
                            onChange={e => updateStock(product.sku, e.target.value)}
                            className="w-20 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-sm text-right focus:outline-none focus:border-emerald-500 ml-auto block"
                          />
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              onClick={() => adjustStock(product.sku, -10)}
                              className="w-8 h-8 rounded bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white text-xs"
                            >
                              -10
                            </button>
                            <button
                              onClick={() => adjustStock(product.sku, -1)}
                              className="w-8 h-8 rounded bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white"
                            >
                              -
                            </button>
                            <button
                              onClick={() => adjustStock(product.sku, 1)}
                              className="w-8 h-8 rounded bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white"
                            >
                              +
                            </button>
                            <button
                              onClick={() => adjustStock(product.sku, 10)}
                              className="w-8 h-8 rounded bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white text-xs"
                            >
                              +10
                            </button>
                            {showConfig && hasAssignedItems && (
                              <button
                                onClick={() => removeProductFromLocation(product.sku)}
                                className="w-8 h-8 rounded bg-zinc-800 text-red-400 hover:bg-red-900/50 hover:text-red-300 ml-2"
                                title="Remove from location"
                              >
                                ×
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {showConfig && (
            <div className="bg-blue-900/20 border border-blue-900/50 rounded-lg p-4">
              <p className="text-blue-300 text-sm">
                <strong>Configuration Tips:</strong> Set min/max stock levels per product. Items at or below minimum show as "low". Use the + Add Product button to assign new products to this location (syncs with Admin settings).
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ============ DASHBOARD ============

function Dashboard({ data }) {
  const pendingOrders = data.orders.filter(o => o.status === 'pending').length;
  const totalWarehouseUnits = Object.values(data.stock).reduce((acc, loc) => {
    return acc + Object.values(loc || {}).reduce((a, b) => a + b, 0);
  }, 0);
  const totalLocationUnits = Object.values(data.locationStock).reduce((acc, loc) => {
    return acc + Object.values(loc || {}).reduce((a, b) => a + b, 0);
  }, 0);
  const totalValue = Object.entries(data.stock).reduce((acc, [loc, items]) => {
    return acc + Object.entries(items || {}).reduce((a, [sku, qty]) => {
      const product = data.products.find(p => p.sku === sku);
      return a + (product?.unitCost || 0) * qty;
    }, 0);
  }, 0);
  const recentRemovals = data.removals.slice(-5).reverse();

  // Sales summary (last 30 days)
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const recentSales = (data.salesData || []).filter(s => new Date(s.timestamp) >= thirtyDaysAgo);
  const totalSalesRevenue = recentSales.reduce((acc, s) => acc + s.charged, 0);
  const totalSalesProfit = recentSales.reduce((acc, s) => acc + (s.charged - s.costPrice), 0);

  // Expiry tracking
  const getExpiryStatus = (expiryDate) => {
    if (!expiryDate) return null;
    const now = new Date();
    const expiry = new Date(expiryDate);
    const daysUntil = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
    if (daysUntil < 0) return 'expired';
    if (daysUntil <= 7) return 'critical';
    if (daysUntil <= 30) return 'warning';
    return 'ok';
  };

  const batches = (data.stockBatches || []).filter(b => b.remainingQty > 0);
  const expiredBatches = batches.filter(b => getExpiryStatus(b.expiryDate) === 'expired');
  const criticalBatches = batches.filter(b => getExpiryStatus(b.expiryDate) === 'critical');
  const warningBatches = batches.filter(b => getExpiryStatus(b.expiryDate) === 'warning');
  const expiryAlertCount = expiredBatches.length + criticalBatches.length;

  // Find low stock at locations
  const lowStockLocations = data.locations.map(loc => {
    const locStock = data.locationStock[loc.id] || {};
    const locConfig = data.locationConfig[loc.id] || {};
    const lowItems = data.products.filter(p => {
      const config = locConfig[p.sku] || {};
      const qty = locStock[p.sku] || 0;
      return config.minStock && qty <= config.minStock;
    });
    return { location: loc, lowItems };
  }).filter(l => l.lowItems.length > 0);

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
        <StatCard label="Pending Orders" value={pendingOrders} accent="teal" />
        <StatCard label="Warehouse Stock" value={totalWarehouseUnits.toLocaleString()} accent="blue" />
        <StatCard label="Location Stock" value={totalLocationUnits.toLocaleString()} accent="emerald" />
        <StatCard label="Warehouse Value" value={`£${totalValue.toLocaleString('en-GB', { minimumFractionDigits: 2 })}`} accent="purple" />
        <StatCard label="30d Revenue" value={`£${totalSalesRevenue.toFixed(2)}`} accent="emerald" />
        <StatCard label="30d Profit" value={`£${totalSalesProfit.toFixed(2)}`} accent="teal" />
        <StatCard label="Expiry Alerts" value={expiryAlertCount} accent={expiryAlertCount > 0 ? 'red' : 'emerald'} />
      </div>

      {/* Expiry Alerts */}
      {(expiredBatches.length > 0 || criticalBatches.length > 0) && (
        <div className="bg-red-900/20 border border-red-900/50 rounded-lg p-6">
          <h3 className="text-sm font-medium text-red-400 mb-4">⚠ Expiry Alerts</h3>
          <div className="space-y-3">
            {expiredBatches.map(batch => {
              const product = data.products.find(p => p.sku === batch.sku);
              const warehouse = data.warehouses.find(w => w.id === batch.warehouseId);
              return (
                <div key={batch.id} className="flex items-center justify-between py-2 border-b border-red-900/30 last:border-0">
                  <div>
                    <span className="text-zinc-300 text-sm">{product?.name || batch.sku}</span>
                    <span className="text-zinc-600 text-xs ml-2">({warehouse?.name})</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-zinc-400 text-sm">{batch.remainingQty} units</span>
                    <span className="text-xs bg-red-500 text-white px-2 py-0.5 rounded">EXPIRED</span>
                  </div>
                </div>
              );
            })}
            {criticalBatches.map(batch => {
              const product = data.products.find(p => p.sku === batch.sku);
              const warehouse = data.warehouses.find(w => w.id === batch.warehouseId);
              const daysLeft = Math.ceil((new Date(batch.expiryDate) - new Date()) / (1000 * 60 * 60 * 24));
              return (
                <div key={batch.id} className="flex items-center justify-between py-2 border-b border-red-900/30 last:border-0">
                  <div>
                    <span className="text-zinc-300 text-sm">{product?.name || batch.sku}</span>
                    <span className="text-zinc-600 text-xs ml-2">({warehouse?.name})</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-zinc-400 text-sm">{batch.remainingQty} units</span>
                    <span className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded">{daysLeft}d left</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Warning expiry (30 days) */}
      {warningBatches.length > 0 && (
        <div className="bg-emerald-900/20 border border-emerald-900/50 rounded-lg p-6">
          <h3 className="text-sm font-medium text-emerald-400 mb-4">Expiring Within 30 Days</h3>
          <div className="space-y-3">
            {warningBatches.slice(0, 5).map(batch => {
              const product = data.products.find(p => p.sku === batch.sku);
              const warehouse = data.warehouses.find(w => w.id === batch.warehouseId);
              const daysLeft = Math.ceil((new Date(batch.expiryDate) - new Date()) / (1000 * 60 * 60 * 24));
              return (
                <div key={batch.id} className="flex items-center justify-between py-2 border-b border-emerald-900/30 last:border-0">
                  <div>
                    <span className="text-zinc-300 text-sm">{product?.name || batch.sku}</span>
                    <span className="text-zinc-600 text-xs ml-2">({warehouse?.name})</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-zinc-400 text-sm">{batch.remainingQty} units</span>
                    <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded">{daysLeft}d left</span>
                  </div>
                </div>
              );
            })}
            {warningBatches.length > 5 && (
              <div className="text-xs text-emerald-400 pt-2">+{warningBatches.length - 5} more items</div>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6">
          <h3 className="text-sm font-medium text-zinc-400 mb-4">Warehouse Stock</h3>
          {data.warehouses.length === 0 ? (
            <p className="text-zinc-500 text-sm">No warehouses configured</p>
          ) : (
            <div className="space-y-3">
              {data.warehouses.map(wh => {
                const units = Object.values(data.stock[wh.id] || {}).reduce((a, b) => a + b, 0);
                const skus = Object.keys(data.stock[wh.id] || {}).length;
                return (
                  <div key={wh.id} className="flex items-center justify-between py-2 border-b border-zinc-800 last:border-0">
                    <span className="text-zinc-300">{wh.name}</span>
                    <div className="flex gap-4 text-sm">
                      <span className="text-zinc-500">{skus} SKUs</span>
                      <span className="text-emerald-400 font-medium">{units.toLocaleString()} units</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6">
          <h3 className="text-sm font-medium text-zinc-400 mb-4">Location Stock Levels</h3>
          {data.locations.length === 0 ? (
            <p className="text-zinc-500 text-sm">No locations configured</p>
          ) : (
            <div className="space-y-3">
              {data.locations.map(loc => {
                const units = Object.values(data.locationStock[loc.id] || {}).reduce((a, b) => a + b, 0);
                const skus = Object.keys(data.locationStock[loc.id] || {}).length;
                return (
                  <div key={loc.id} className="flex items-center justify-between py-2 border-b border-zinc-800 last:border-0">
                    <span className="text-zinc-300">{loc.name}</span>
                    <div className="flex gap-4 text-sm">
                      <span className="text-zinc-500">{skus} SKUs</span>
                      <span className="text-emerald-400 font-medium">{units.toLocaleString()} units</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {lowStockLocations.length > 0 && (
        <div className="bg-red-900/20 border border-red-900/50 rounded-lg p-6">
          <h3 className="text-sm font-medium text-red-400 mb-4">Low Stock Alerts - Locations</h3>
          <div className="space-y-3">
            {lowStockLocations.map(({ location, lowItems }) => (
              <div key={location.id} className="flex items-start justify-between py-2 border-b border-red-900/30 last:border-0">
                <span className="text-zinc-300">{location.name}</span>
                <div className="flex flex-wrap gap-1 justify-end">
                  {lowItems.slice(0, 3).map(p => (
                    <span key={p.sku} className="text-xs bg-red-900/50 px-2 py-1 rounded text-red-300">
                      {p.name}
                    </span>
                  ))}
                  {lowItems.length > 3 && (
                    <span className="text-xs text-red-400">+{lowItems.length - 3} more</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6">
        <h3 className="text-sm font-medium text-zinc-400 mb-4">Recent Stock Movements</h3>
        {recentRemovals.length === 0 ? (
          <p className="text-zinc-500 text-sm">No recent movements</p>
        ) : (
          <div className="space-y-3">
            {recentRemovals.map((r, i) => {
              const product = data.products.find(p => p.sku === r.sku);
              const fromWh = data.warehouses.find(w => w.id === r.fromLocation);
              const toLoc = data.locations.find(l => l.id === r.toLocation);
              return (
                <div key={i} className="flex items-start justify-between py-2 border-b border-zinc-800 last:border-0">
                  <div>
                    <span className="text-zinc-300 text-sm">{product?.name || r.sku}</span>
                    <div className="text-xs text-zinc-500 mt-0.5">
                      {fromWh?.name || r.fromLocation} → {toLoc?.name || r.toLocation}
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-red-400 text-sm">-{r.quantity}</span>
                    <div className="text-xs text-zinc-600">{r.takenBy}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, accent }) {
  const colors = {
    emerald: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400',
    teal: 'bg-teal-500/10 border-teal-500/20 text-teal-400',
    blue: 'bg-blue-500/10 border-blue-500/20 text-blue-400',
    purple: 'bg-purple-500/10 border-purple-500/20 text-purple-400',
    red: 'bg-red-500/10 border-red-500/20 text-red-400'
  };
  return (
    <div className={`rounded-lg border p-5 ${colors[accent] || colors.emerald}`}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs opacity-70 mt-1">{label}</div>
    </div>
  );
}

// ============ ORDERS ============

function Orders({ data, saveData }) {
  const [showForm, setShowForm] = useState(false);
  const [editingOrder, setEditingOrder] = useState(null);
  const [showInvoiceUpload, setShowInvoiceUpload] = useState(false);
  const [invoiceData, setInvoiceData] = useState(null);
  const [invoiceProcessing, setInvoiceProcessing] = useState(false);
  const [invoiceError, setInvoiceError] = useState(null);
  const [reviewMode, setReviewMode] = useState(false);
  const [extractedItems, setExtractedItems] = useState([]);
  const [productsToCreate, setProductsToCreate] = useState([]);
  
  // Generate Order states
  const [showGenerateOrder, setShowGenerateOrder] = useState(false);
  const [suggestedItems, setSuggestedItems] = useState([]);
  const [selectedLocation, setSelectedLocation] = useState('');
  const [orderSupplier, setOrderSupplier] = useState('');
  const [orderNotes, setOrderNotes] = useState('');
  const [generatingPdf, setGeneratingPdf] = useState(false);
  
  const [form, setForm] = useState({
    supplierId: '',
    deliveryMethod: 'standard',
    deliveryType: 'warehouse',
    warehouseId: '',
    customAddress: '',
    items: [{ sku: '', quantity: '', unitPrice: '' }],
    expectedDate: '',
    deliveryFee: '',
    notes: '',
    invoiceRef: '',
    invoiceImage: null
  });

  const resetForm = () => {
    setForm({
      supplierId: '',
      deliveryMethod: 'standard',
      deliveryType: 'warehouse',
      warehouseId: '',
      customAddress: '',
      items: [{ sku: '', quantity: '', unitPrice: '' }],
      expectedDate: '',
      deliveryFee: '',
      notes: '',
      invoiceRef: '',
      invoiceImage: null
    });
    setEditingOrder(null);
    setShowForm(false);
    setInvoiceData(null);
    setExtractedItems([]);
    setProductsToCreate([]);
    setReviewMode(false);
    setInvoiceError(null);
  };

  // Generate Order - Analyze low stock and suggest items
  const analyzeAndSuggestOrder = (locationId) => {
    const location = data.locations.find(l => l.id === locationId);
    if (!location) return [];

    const locStock = data.locationStock[locationId] || {};
    const locConfig = data.locationConfig[locationId] || {};
    const assignedItems = location.assignedItems || [];
    
    const suggestions = [];
    
    // Get products for this location
    const locationProducts = assignedItems.length > 0
      ? data.products.filter(p => assignedItems.includes(p.sku))
      : data.products;

    for (const product of locationProducts) {
      const currentStock = locStock[product.sku] || 0;
      const config = locConfig[product.sku] || {};
      const minStock = config.minStock || 0;
      const maxStock = config.maxStock || 0;
      
      // Calculate if needs reordering
      let needsOrder = false;
      let priority = 'normal';
      let suggestedQty = 0;
      
      if (minStock > 0 && currentStock <= minStock) {
        needsOrder = true;
        priority = 'critical';
        suggestedQty = maxStock > 0 ? maxStock - currentStock : minStock * 2;
      } else if (minStock > 0 && currentStock <= minStock * 1.5) {
        needsOrder = true;
        priority = 'warning';
        suggestedQty = maxStock > 0 ? maxStock - currentStock : Math.ceil(minStock * 1.5);
      }
      
      if (needsOrder && suggestedQty > 0) {
        suggestions.push({
          sku: product.sku,
          name: product.name,
          category: product.category,
          currentStock,
          minStock,
          maxStock,
          suggestedQty,
          orderQty: suggestedQty,
          unitPrice: product.unitCost || 0,
          priority,
          selected: true
        });
      }
    }
    
    // Sort by priority (critical first)
    return suggestions.sort((a, b) => {
      if (a.priority === 'critical' && b.priority !== 'critical') return -1;
      if (b.priority === 'critical' && a.priority !== 'critical') return 1;
      return a.name.localeCompare(b.name);
    });
  };

  const openGenerateOrder = () => {
    const firstLocation = data.locations[0]?.id || '';
    setSelectedLocation(firstLocation);
    setSuggestedItems(analyzeAndSuggestOrder(firstLocation));
    setOrderSupplier('');
    setOrderNotes('');
    setShowGenerateOrder(true);
  };

  const handleLocationChange = (locId) => {
    setSelectedLocation(locId);
    setSuggestedItems(analyzeAndSuggestOrder(locId));
  };

  const updateSuggestedItem = (idx, field, value) => {
    const items = [...suggestedItems];
    items[idx][field] = field === 'orderQty' ? (parseInt(value) || 0) : value;
    setSuggestedItems(items);
  };

  const toggleSuggestedItem = (idx) => {
    const items = [...suggestedItems];
    items[idx].selected = !items[idx].selected;
    setSuggestedItems(items);
  };

  const calculateSuggestedTotal = () => {
    return suggestedItems
      .filter(i => i.selected)
      .reduce((acc, i) => acc + (i.orderQty * i.unitPrice), 0);
  };

  // Create order from suggestions
  const createOrderFromSuggestions = () => {
    const selectedItems = suggestedItems.filter(i => i.selected && i.orderQty > 0);
    if (selectedItems.length === 0) return;

    setForm({
      supplierId: orderSupplier,
      deliveryMethod: 'standard',
      deliveryType: 'warehouse',
      warehouseId: data.warehouses[0]?.id || '',
      customAddress: '',
      items: selectedItems.map(i => ({
        sku: i.sku,
        quantity: i.orderQty.toString(),
        unitPrice: i.unitPrice.toString()
      })),
      expectedDate: '',
      deliveryFee: '0',
      notes: orderNotes,
      invoiceRef: '',
      invoiceImage: null
    });

    setShowGenerateOrder(false);
    setShowForm(true);
  };

  // Generate PDF Order Sheet
  const generateOrderPDF = async () => {
    setGeneratingPdf(true);
    
    const selectedItems = suggestedItems.filter(i => i.selected && i.orderQty > 0);
    const supplier = data.suppliers.find(s => s.id === orderSupplier);
    const location = data.locations.find(l => l.id === selectedLocation);
    const total = calculateSuggestedTotal();
    const orderDate = new Date().toLocaleDateString('en-GB');
    const orderRef = `PO-${Date.now().toString().slice(-8)}`;
    
    // Create HTML for PDF
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Helvetica Neue', Arial, sans-serif; padding: 40px; color: #1a1a1a; }
    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 40px; padding-bottom: 20px; border-bottom: 3px solid #059669; }
    .logo { font-size: 32px; font-weight: bold; color: #059669; }
    .logo-sub { font-size: 12px; color: #666; margin-top: 4px; }
    .order-info { text-align: right; }
    .order-ref { font-size: 24px; font-weight: bold; color: #1a1a1a; }
    .order-date { font-size: 14px; color: #666; margin-top: 4px; }
    .details-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-bottom: 30px; }
    .detail-box { background: #f8f9fa; padding: 20px; border-radius: 8px; }
    .detail-title { font-size: 12px; text-transform: uppercase; color: #666; margin-bottom: 10px; font-weight: 600; }
    .detail-content { font-size: 14px; line-height: 1.6; }
    .detail-name { font-weight: 600; font-size: 16px; margin-bottom: 4px; }
    table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
    th { background: #059669; color: white; padding: 12px; text-align: left; font-size: 12px; text-transform: uppercase; }
    th:last-child, th:nth-child(3), th:nth-child(4) { text-align: right; }
    td { padding: 12px; border-bottom: 1px solid #e5e5e5; font-size: 14px; }
    td:last-child, td:nth-child(3), td:nth-child(4) { text-align: right; }
    tr:nth-child(even) { background: #f8f9fa; }
    .priority-critical { color: #dc2626; font-weight: 600; }
    .priority-warning { color: #d97706; }
    .totals { margin-left: auto; width: 300px; }
    .total-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #e5e5e5; }
    .total-row.grand { font-size: 18px; font-weight: bold; color: #059669; border-bottom: none; border-top: 2px solid #059669; margin-top: 10px; padding-top: 15px; }
    .notes { background: #fef3c7; padding: 20px; border-radius: 8px; margin-top: 30px; }
    .notes-title { font-weight: 600; margin-bottom: 8px; color: #92400e; }
    .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e5e5; text-align: center; color: #666; font-size: 12px; }
    .category-badge { display: inline-block; background: #e5e5e5; padding: 2px 8px; border-radius: 4px; font-size: 11px; margin-left: 8px; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="logo">Hatch</div>
      <div class="logo-sub">Fresh made easy</div>
    </div>
    <div class="order-info">
      <div class="order-ref">${orderRef}</div>
      <div class="order-date">${orderDate}</div>
    </div>
  </div>

  <div class="details-grid">
    <div class="detail-box">
      <div class="detail-title">Supplier</div>
      <div class="detail-content">
        <div class="detail-name">${supplier?.name || 'Not specified'}</div>
        ${supplier?.contact ? `<div>${supplier.contact}</div>` : ''}
        ${supplier?.email ? `<div>${supplier.email}</div>` : ''}
        ${supplier?.phone ? `<div>${supplier.phone}</div>` : ''}
      </div>
    </div>
    <div class="detail-box">
      <div class="detail-title">Deliver To</div>
      <div class="detail-content">
        <div class="detail-name">${location?.name || 'Not specified'}</div>
        <div>Hatch International Limited</div>
      </div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width: 40%">Product</th>
        <th>Current Stock</th>
        <th>Order Qty</th>
        <th>Unit Price</th>
        <th>Line Total</th>
      </tr>
    </thead>
    <tbody>
      ${selectedItems.map(item => `
        <tr>
          <td>
            ${item.name}
            <span class="category-badge">${item.category || 'Other'}</span>
            ${item.priority === 'critical' ? '<br><small class="priority-critical">⚠ Critical - Below minimum</small>' : ''}
            ${item.priority === 'warning' ? '<br><small class="priority-warning">Low stock warning</small>' : ''}
          </td>
          <td>${item.currentStock} / ${item.maxStock || '-'}</td>
          <td><strong>${item.orderQty}</strong></td>
          <td>£${item.unitPrice.toFixed(2)}</td>
          <td>£${(item.orderQty * item.unitPrice).toFixed(2)}</td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  <div class="totals">
    <div class="total-row">
      <span>Items:</span>
      <span>${selectedItems.length}</span>
    </div>
    <div class="total-row">
      <span>Total Units:</span>
      <span>${selectedItems.reduce((a, i) => a + i.orderQty, 0)}</span>
    </div>
    <div class="total-row grand">
      <span>Order Total:</span>
      <span>£${total.toFixed(2)}</span>
    </div>
  </div>

  ${orderNotes ? `
  <div class="notes">
    <div class="notes-title">Notes</div>
    <div>${orderNotes}</div>
  </div>
  ` : ''}

  <div class="footer">
    Generated by Hatch Stock Management System • ${new Date().toLocaleString('en-GB')}
  </div>
</body>
</html>`;

    // Create and download PDF via print
    const printWindow = window.open('', '_blank');
    printWindow.document.write(html);
    printWindow.document.close();
    
    setTimeout(() => {
      printWindow.print();
      setGeneratingPdf(false);
    }, 500);
  };

  const startEdit = (order) => {
    setForm({
      supplierId: order.supplierId || '',
      deliveryMethod: order.deliveryMethod || 'standard',
      deliveryType: order.deliveryType || 'warehouse',
      warehouseId: order.warehouseId || '',
      customAddress: order.customAddress || '',
      items: order.items.map(i => ({ 
        sku: i.sku, 
        quantity: i.quantity.toString(), 
        unitPrice: i.unitPrice?.toString() || '' 
      })),
      expectedDate: order.expectedDate || '',
      deliveryFee: order.deliveryFee?.toString() || '',
      notes: order.notes || '',
      invoiceRef: order.invoiceRef || '',
      invoiceImage: order.invoiceImage || null
    });
    setEditingOrder(order.id);
    setShowForm(true);
  };

  const addItem = () => {
    setForm({ ...form, items: [...form.items, { sku: '', quantity: '', unitPrice: '' }] });
  };

  const updateItem = (idx, field, value) => {
    const items = [...form.items];
    items[idx][field] = value;
    if (field === 'sku' && value) {
      const product = data.products.find(p => p.sku === value);
      if (product?.unitCost && !items[idx].unitPrice) {
        items[idx].unitPrice = product.unitCost.toString();
      }
    }
    setForm({ ...form, items });
  };

  const removeItem = (idx) => {
    if (form.items.length > 1) {
      setForm({ ...form, items: form.items.filter((_, i) => i !== idx) });
    }
  };

  const calculateSubtotal = () => {
    return form.items.reduce((acc, item) => {
      const qty = parseInt(item.quantity) || 0;
      const price = parseFloat(item.unitPrice) || 0;
      return acc + (qty * price);
    }, 0);
  };

  const calculateTotal = () => {
    return calculateSubtotal() + (parseFloat(form.deliveryFee) || 0);
  };

  const submit = () => {
    if (!form.supplierId || !form.items[0].sku) return;
    if (form.deliveryType === 'warehouse' && !form.warehouseId) return;
    if (form.deliveryType === 'custom' && !form.customAddress) return;
    
    const order = {
      id: editingOrder || Date.now().toString(),
      supplierId: form.supplierId,
      deliveryMethod: form.deliveryMethod,
      deliveryType: form.deliveryType,
      warehouseId: form.deliveryType === 'warehouse' ? form.warehouseId : null,
      customAddress: form.deliveryType === 'custom' ? form.customAddress : null,
      items: form.items.filter(i => i.sku && i.quantity).map(i => ({
        sku: i.sku,
        quantity: parseInt(i.quantity),
        unitPrice: parseFloat(i.unitPrice) || 0,
        lineTotal: (parseInt(i.quantity) || 0) * (parseFloat(i.unitPrice) || 0)
      })),
      expectedDate: form.expectedDate,
      deliveryFee: parseFloat(form.deliveryFee) || 0,
      subtotal: calculateSubtotal(),
      total: calculateTotal(),
      notes: form.notes,
      invoiceRef: form.invoiceRef,
      invoiceImage: form.invoiceImage,
      status: editingOrder ? data.orders.find(o => o.id === editingOrder)?.status || 'pending' : 'pending',
      createdAt: editingOrder ? data.orders.find(o => o.id === editingOrder)?.createdAt : new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    let newOrders;
    if (editingOrder) {
      newOrders = data.orders.map(o => o.id === editingOrder ? order : o);
    } else {
      newOrders = [...data.orders, order];
    }
    
    saveData({ ...data, orders: newOrders });
    resetForm();
  };

  // AI-powered invoice analysis
  const analyzeInvoiceWithAI = async (imageData, mimeType) => {
    const prompt = `Analyze this invoice/purchase order image and extract all information in JSON format.

Return ONLY valid JSON with this exact structure (no markdown, no explanation):
{
  "supplier": {
    "name": "supplier company name",
    "detected": true/false
  },
  "invoiceRef": "invoice/PO number if found",
  "orderDate": "date in YYYY-MM-DD format if found",
  "deliveryFee": 0,
  "items": [
    {
      "sku": "product SKU/part number if available, otherwise generate from name like 'PROD-001'",
      "name": "full product name",
      "description": "any additional description or variant info",
      "quantity": 1,
      "unitPrice": 0.00,
      "lineTotal": 0.00,
      "category": "one of: Meals, Drinks, Snacks, Other",
      "packSize": "e.g., '6x250g' or '8 pack' if mentioned"
    }
  ],
  "subtotal": 0.00,
  "tax": 0.00,
  "total": 0.00,
  "deliveryAddress": "delivery address if found",
  "notes": "any other relevant information"
}

Important:
- Extract ALL line items from the order
- For quantities, look for pack quantities (e.g., "8" means 8 units)
- Unit prices should be per-item prices
- If SKU codes are visible (like EP-WAT-C-008), use those exactly
- Categorize items: Meals (hot food, ready meals), Drinks (beverages, milkshakes), Snacks (chips, bars, biltong)
- If pack size is mentioned (6x250g, 8x330ml), include it in packSize`;

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4000,
          messages: [{
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mimeType,
                  data: imageData.split(',')[1]
                }
              },
              { type: 'text', text: prompt }
            ]
          }]
        })
      });

      const result = await response.json();
      const textContent = result.content?.find(c => c.type === 'text')?.text || '';
      
      // Parse JSON from response
      const jsonMatch = textContent.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      throw new Error('Could not parse AI response');
    } catch (error) {
      console.error('AI analysis error:', error);
      throw error;
    }
  };

  // Handle invoice upload
  const handleInvoiceUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setInvoiceProcessing(true);
    setShowInvoiceUpload(true);
    setInvoiceError(null);

    const reader = new FileReader();
    reader.onload = async (ev) => {
      const imageData = ev.target?.result;
      const mimeType = file.type || 'image/png';
      
      try {
        const analyzed = await analyzeInvoiceWithAI(imageData, mimeType);
        
        // Match supplier to existing suppliers
        let matchedSupplierId = '';
        if (analyzed.supplier?.name) {
          const supplierMatch = data.suppliers.find(s => 
            s.name.toLowerCase().includes(analyzed.supplier.name.toLowerCase()) ||
            analyzed.supplier.name.toLowerCase().includes(s.name.toLowerCase())
          );
          if (supplierMatch) {
            matchedSupplierId = supplierMatch.id;
          }
        }

        // Process items - match to existing products or flag for creation
        const processedItems = [];
        const newProducts = [];

        for (const item of analyzed.items || []) {
          // Try to match existing product by SKU or name
          let matchedProduct = data.products.find(p => 
            p.sku.toLowerCase() === item.sku?.toLowerCase()
          );
          
          if (!matchedProduct) {
            matchedProduct = data.products.find(p => 
              p.name.toLowerCase().includes(item.name?.toLowerCase()) ||
              item.name?.toLowerCase().includes(p.name?.toLowerCase())
            );
          }

          if (matchedProduct) {
            processedItems.push({
              ...item,
              matchedSku: matchedProduct.sku,
              matchedName: matchedProduct.name,
              isNew: false,
              selected: true
            });
          } else {
            // Generate SKU for new product
            const generatedSku = item.sku || `NEW-${Date.now().toString().slice(-4)}-${processedItems.length + newProducts.length + 1}`;
            processedItems.push({
              ...item,
              sku: generatedSku,
              isNew: true,
              selected: true,
              category: item.category || 'Other'
            });
            newProducts.push({
              sku: generatedSku,
              name: item.name,
              category: item.category || 'Other',
              unitCost: item.unitPrice,
              salePrice: item.unitPrice * 1.4, // Default markup
              packSize: item.packSize || ''
            });
          }
        }

        setInvoiceData({
          ...analyzed,
          matchedSupplierId,
          invoiceImage: imageData
        });
        setExtractedItems(processedItems);
        setProductsToCreate(newProducts);
        setReviewMode(true);
        setInvoiceProcessing(false);

      } catch (error) {
        console.error('Invoice processing error:', error);
        setInvoiceError('Failed to analyze invoice. Please try again or enter details manually.');
        setInvoiceProcessing(false);
        setForm(prev => ({ ...prev, invoiceImage: imageData }));
      }
    };
    reader.readAsDataURL(file);
  };

  // Update extracted item
  const updateExtractedItem = (idx, field, value) => {
    const items = [...extractedItems];
    items[idx][field] = value;
    
    // If changing to an existing product
    if (field === 'matchedSku' && value) {
      const product = data.products.find(p => p.sku === value);
      if (product) {
        items[idx].matchedName = product.name;
        items[idx].isNew = false;
        // Remove from products to create if it was there
        setProductsToCreate(prev => prev.filter(p => p.sku !== items[idx].sku));
      }
    }
    
    setExtractedItems(items);
  };

  // Toggle item selection
  const toggleItemSelection = (idx) => {
    const items = [...extractedItems];
    items[idx].selected = !items[idx].selected;
    setExtractedItems(items);
  };

  // Apply extracted data to form
  const applyExtractedData = () => {
    // Create new products first
    const selectedNewProducts = productsToCreate.filter(p => 
      extractedItems.some(item => item.selected && item.isNew && item.sku === p.sku)
    );
    
    let newProductsList = [...data.products];
    for (const newProd of selectedNewProducts) {
      if (!newProductsList.find(p => p.sku === newProd.sku)) {
        newProductsList.push({
          sku: newProd.sku,
          name: newProd.name,
          category: newProd.category,
          unitCost: newProd.unitCost,
          salePrice: newProd.salePrice
        });
      }
    }

    // Create or find supplier
    let supplierId = invoiceData.matchedSupplierId;
    let newSuppliersList = [...data.suppliers];
    
    if (!supplierId && invoiceData.supplier?.name) {
      const newSupplierId = `sup-${Date.now()}`;
      newSuppliersList.push({
        id: newSupplierId,
        name: invoiceData.supplier.name,
        contact: '',
        email: '',
        phone: ''
      });
      supplierId = newSupplierId;
    }

    // Build order items from selected extracted items
    const orderItems = extractedItems
      .filter(item => item.selected)
      .map(item => ({
        sku: item.isNew ? item.sku : (item.matchedSku || item.sku),
        quantity: item.quantity?.toString() || '1',
        unitPrice: item.unitPrice?.toString() || '0'
      }));

    // Update data with new products and suppliers
    if (selectedNewProducts.length > 0 || newSuppliersList.length > data.suppliers.length) {
      saveData({
        ...data,
        products: newProductsList,
        suppliers: newSuppliersList
      });
    }

    // Set form with extracted data
    setForm({
      supplierId: supplierId,
      deliveryMethod: 'standard',
      deliveryType: invoiceData.deliveryAddress ? 'custom' : 'warehouse',
      warehouseId: '',
      customAddress: invoiceData.deliveryAddress || '',
      items: orderItems.length > 0 ? orderItems : [{ sku: '', quantity: '', unitPrice: '' }],
      expectedDate: invoiceData.orderDate || '',
      deliveryFee: invoiceData.deliveryFee?.toString() || '0',
      notes: invoiceData.notes || '',
      invoiceRef: invoiceData.invoiceRef || '',
      invoiceImage: invoiceData.invoiceImage
    });

    setShowInvoiceUpload(false);
    setReviewMode(false);
    setShowForm(true);
  };

  const pendingOrders = data.orders.filter(o => o.status === 'pending');
  const completedOrders = data.orders.filter(o => o.status === 'received');

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Purchase Orders</h2>
        <div className="grid grid-cols-3 sm:flex gap-2">
          <button
            onClick={openGenerateOrder}
            className="px-3 py-2.5 bg-teal-600 text-white rounded text-sm font-medium hover:bg-teal-500 transition-colors"
          >
            📋 <span className="hidden sm:inline">Generate</span>
          </button>
          <label className="px-3 py-2.5 bg-zinc-700 text-zinc-300 rounded text-sm font-medium hover:bg-zinc-600 transition-colors cursor-pointer text-center">
            📄 <span className="hidden sm:inline">Invoice</span>
            <input
              type="file"
              accept="image/*,.pdf"
              onChange={handleInvoiceUpload}
              className="hidden"
            />
          </label>
          <button
            onClick={() => { resetForm(); setShowForm(!showForm); }}
            className="px-3 py-2.5 bg-emerald-500 text-zinc-900 rounded text-sm font-medium hover:bg-emerald-400 transition-colors"
          >
            {showForm ? '✕' : '+'} <span className="hidden sm:inline">{showForm ? 'Cancel' : 'New'}</span>
          </button>
        </div>
      </div>

      {/* Generate Order Modal */}
      {showGenerateOrder && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium text-zinc-200">Generate Order from Low Stock</h3>
              <p className="text-zinc-500 text-sm mt-1">Automatically suggests items below or nearing minimum stock levels</p>
            </div>
            <button 
              onClick={() => setShowGenerateOrder(false)} 
              className="text-zinc-500 hover:text-zinc-300 text-xl"
            >
              ×
            </button>
          </div>

          {/* Location & Supplier Selection */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Location to Restock</label>
              <select
                value={selectedLocation}
                onChange={(e) => handleLocationChange(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-teal-500"
              >
                {data.locations.map(l => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Supplier (Optional)</label>
              <select
                value={orderSupplier}
                onChange={(e) => setOrderSupplier(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-teal-500"
              >
                <option value="">Select supplier</option>
                {data.suppliers.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Summary Stats */}
          <div className="grid grid-cols-4 gap-4">
            <div className="bg-zinc-800/50 rounded-lg p-3 text-center">
              <div className="text-xl font-bold text-teal-400">{suggestedItems.length}</div>
              <div className="text-xs text-zinc-500">Items Need Stock</div>
            </div>
            <div className="bg-zinc-800/50 rounded-lg p-3 text-center">
              <div className="text-xl font-bold text-red-400">
                {suggestedItems.filter(i => i.priority === 'critical').length}
              </div>
              <div className="text-xs text-zinc-500">Critical</div>
            </div>
            <div className="bg-zinc-800/50 rounded-lg p-3 text-center">
              <div className="text-xl font-bold text-yellow-400">
                {suggestedItems.filter(i => i.priority === 'warning').length}
              </div>
              <div className="text-xs text-zinc-500">Warning</div>
            </div>
            <div className="bg-zinc-800/50 rounded-lg p-3 text-center">
              <div className="text-xl font-bold text-emerald-400">
                £{calculateSuggestedTotal().toFixed(2)}
              </div>
              <div className="text-xs text-zinc-500">Est. Total</div>
            </div>
          </div>

          {/* Suggested Items */}
          {suggestedItems.length === 0 ? (
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-6 text-center">
              <div className="text-emerald-400 text-2xl mb-2">✓</div>
              <p className="text-emerald-400 font-medium">All stocked up!</p>
              <p className="text-zinc-500 text-sm mt-1">No items are below or near minimum stock levels for this location.</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {suggestedItems.map((item, idx) => (
                <div 
                  key={item.sku}
                  className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${
                    item.selected
                      ? item.priority === 'critical'
                        ? 'bg-red-500/5 border-red-500/30'
                        : 'bg-yellow-500/5 border-yellow-500/30'
                      : 'bg-zinc-800/30 border-zinc-700 opacity-50'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={item.selected}
                    onChange={() => toggleSuggestedItem(idx)}
                    className="w-4 h-4 rounded border-zinc-600"
                  />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs px-1.5 py-0.5 rounded ${
                        item.priority === 'critical' 
                          ? 'bg-red-500/20 text-red-400' 
                          : 'bg-yellow-500/20 text-yellow-400'
                      }`}>
                        {item.priority === 'critical' ? '⚠ CRITICAL' : 'LOW'}
                      </span>
                      <span className="text-xs bg-zinc-700 px-1.5 py-0.5 rounded text-zinc-400">
                        {item.category || 'Other'}
                      </span>
                    </div>
                    <p className="text-sm text-zinc-200 mt-1">{item.name}</p>
                    <p className="text-xs text-zinc-500">
                      Current: {item.currentStock} | Min: {item.minStock} | Max: {item.maxStock || '-'}
                    </p>
                  </div>

                  <div className="text-center">
                    <p className="text-zinc-500 text-xs">Order Qty</p>
                    <input
                      type="number"
                      value={item.orderQty}
                      onChange={(e) => updateSuggestedItem(idx, 'orderQty', e.target.value)}
                      className="w-16 bg-zinc-700 border border-zinc-600 rounded px-2 py-1 text-center text-sm"
                    />
                  </div>

                  <div className="text-center">
                    <p className="text-zinc-500 text-xs">Unit £</p>
                    <input
                      type="number"
                      step="0.01"
                      value={item.unitPrice}
                      onChange={(e) => updateSuggestedItem(idx, 'unitPrice', parseFloat(e.target.value) || 0)}
                      className="w-16 bg-zinc-700 border border-zinc-600 rounded px-2 py-1 text-center text-sm"
                    />
                  </div>

                  <div className="text-right w-20">
                    <p className="text-zinc-500 text-xs">Line Total</p>
                    <p className="text-zinc-300 text-sm">£{(item.orderQty * item.unitPrice).toFixed(2)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Order Notes (Optional)</label>
            <textarea
              value={orderNotes}
              onChange={(e) => setOrderNotes(e.target.value)}
              placeholder="Any special instructions..."
              rows={2}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-teal-500"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-4 border-t border-zinc-800">
            <button
              onClick={generateOrderPDF}
              disabled={suggestedItems.filter(i => i.selected).length === 0 || generatingPdf}
              className="px-4 py-3 bg-zinc-700 text-zinc-200 rounded-lg text-sm font-medium hover:bg-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {generatingPdf ? (
                <>
                  <span className="animate-spin">↻</span> Generating...
                </>
              ) : (
                <>📄 Generate PDF</>
              )}
            </button>
            <button
              onClick={createOrderFromSuggestions}
              disabled={suggestedItems.filter(i => i.selected).length === 0}
              className="flex-1 px-4 py-3 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Create Order ({suggestedItems.filter(i => i.selected).length} items)
            </button>
            <button
              onClick={() => setShowGenerateOrder(false)}
              className="px-4 py-3 bg-zinc-800 text-zinc-400 rounded-lg text-sm hover:bg-zinc-700"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Invoice Analysis Modal */}
      {showInvoiceUpload && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-zinc-200">
              {reviewMode ? 'Review Extracted Data' : 'Analyzing Invoice'}
            </h3>
            <button onClick={() => { setShowInvoiceUpload(false); setReviewMode(false); }} className="text-zinc-500 hover:text-zinc-300 text-xl">×</button>
          </div>

          {invoiceProcessing && (
            <div className="text-center py-12">
              <div className="inline-block animate-spin text-emerald-400 text-3xl mb-4">↻</div>
              <p className="text-zinc-400">Analyzing invoice with AI...</p>
              <p className="text-zinc-500 text-sm mt-2">Extracting supplier, items, quantities, and prices</p>
            </div>
          )}

          {invoiceError && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
              <p className="text-red-400 text-sm">{invoiceError}</p>
              <button
                onClick={() => { setShowInvoiceUpload(false); setShowForm(true); }}
                className="mt-3 px-4 py-2 bg-zinc-700 text-zinc-300 rounded text-sm hover:bg-zinc-600"
              >
                Enter Manually
              </button>
            </div>
          )}

          {reviewMode && invoiceData && (
            <div className="space-y-6">
              {/* Invoice Preview */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="lg:col-span-1">
                  {invoiceData.invoiceImage && (
                    <div className="bg-zinc-800/50 rounded-lg p-3">
                      <p className="text-xs text-zinc-500 mb-2">Invoice Preview</p>
                      <img src={invoiceData.invoiceImage} alt="Invoice" className="w-full rounded border border-zinc-700" />
                    </div>
                  )}
                </div>

                <div className="lg:col-span-2 space-y-4">
                  {/* Extracted Header Info */}
                  <div className="bg-zinc-800/30 rounded-lg p-4 space-y-3">
                    <h4 className="text-sm font-medium text-zinc-300">Order Details</h4>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <span className="text-zinc-500">Supplier:</span>
                        <span className={`ml-2 ${invoiceData.matchedSupplierId ? 'text-emerald-400' : 'text-yellow-400'}`}>
                          {invoiceData.supplier?.name || 'Not detected'}
                          {invoiceData.matchedSupplierId && ' ✓'}
                          {!invoiceData.matchedSupplierId && invoiceData.supplier?.name && ' (new)'}
                        </span>
                      </div>
                      <div>
                        <span className="text-zinc-500">Invoice Ref:</span>
                        <span className="ml-2 text-zinc-300">{invoiceData.invoiceRef || 'N/A'}</span>
                      </div>
                      <div>
                        <span className="text-zinc-500">Date:</span>
                        <span className="ml-2 text-zinc-300">{invoiceData.orderDate || 'N/A'}</span>
                      </div>
                      <div>
                        <span className="text-zinc-500">Total:</span>
                        <span className="ml-2 text-zinc-300">£{invoiceData.total?.toFixed(2) || '0.00'}</span>
                      </div>
                    </div>
                  </div>

                  {/* Extracted Items */}
                  <div className="bg-zinc-800/30 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="text-sm font-medium text-zinc-300">
                        Extracted Items ({extractedItems.length})
                      </h4>
                      <div className="flex gap-2 text-xs">
                        <span className="text-emerald-400">● Matched</span>
                        <span className="text-yellow-400">● New Product</span>
                      </div>
                    </div>

                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {extractedItems.map((item, idx) => (
                        <div key={idx} className={`flex items-center gap-3 p-3 rounded-lg border ${
                          item.selected 
                            ? item.isNew 
                              ? 'bg-yellow-500/5 border-yellow-500/30' 
                              : 'bg-emerald-500/5 border-emerald-500/30'
                            : 'bg-zinc-800/50 border-zinc-700 opacity-50'
                        }`}>
                          <input
                            type="checkbox"
                            checked={item.selected}
                            onChange={() => toggleItemSelection(idx)}
                            className="w-4 h-4 rounded border-zinc-600"
                          />
                          
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className={`text-xs px-1.5 py-0.5 rounded ${
                                item.isNew ? 'bg-yellow-500/20 text-yellow-400' : 'bg-emerald-500/20 text-emerald-400'
                              }`}>
                                {item.isNew ? 'NEW' : 'MATCHED'}
                              </span>
                              <span className="text-xs text-zinc-500">{item.sku}</span>
                            </div>
                            <p className="text-sm text-zinc-200 truncate">{item.name}</p>
                            {item.packSize && (
                              <p className="text-xs text-zinc-500">{item.packSize}</p>
                            )}
                          </div>

                          <div className="flex items-center gap-4 text-sm">
                            <div className="text-center">
                              <p className="text-zinc-500 text-xs">Qty</p>
                              <input
                                type="number"
                                value={item.quantity}
                                onChange={(e) => updateExtractedItem(idx, 'quantity', parseInt(e.target.value) || 0)}
                                className="w-16 bg-zinc-700 border border-zinc-600 rounded px-2 py-1 text-center text-sm"
                              />
                            </div>
                            <div className="text-center">
                              <p className="text-zinc-500 text-xs">Unit £</p>
                              <input
                                type="number"
                                step="0.01"
                                value={item.unitPrice}
                                onChange={(e) => updateExtractedItem(idx, 'unitPrice', parseFloat(e.target.value) || 0)}
                                className="w-20 bg-zinc-700 border border-zinc-600 rounded px-2 py-1 text-center text-sm"
                              />
                            </div>
                            <div className="text-right w-20">
                              <p className="text-zinc-500 text-xs">Line Total</p>
                              <p className="text-zinc-300">£{((item.quantity || 0) * (item.unitPrice || 0)).toFixed(2)}</p>
                            </div>
                          </div>

                          {item.isNew && item.selected && (
                            <select
                              value={item.category}
                              onChange={(e) => {
                                updateExtractedItem(idx, 'category', e.target.value);
                                setProductsToCreate(prev => prev.map(p => 
                                  p.sku === item.sku ? { ...p, category: e.target.value } : p
                                ));
                              }}
                              className="bg-zinc-700 border border-zinc-600 rounded px-2 py-1 text-xs"
                            >
                              <option value="Meals">Meals</option>
                              <option value="Drinks">Drinks</option>
                              <option value="Snacks">Snacks</option>
                              <option value="Other">Other</option>
                            </select>
                          )}
                        </div>
                      ))}
                    </div>

                    {extractedItems.length === 0 && (
                      <p className="text-zinc-500 text-sm text-center py-4">No items extracted</p>
                    )}
                  </div>

                  {/* New Products Summary */}
                  {productsToCreate.filter(p => extractedItems.some(i => i.selected && i.isNew && i.sku === p.sku)).length > 0 && (
                    <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
                      <h4 className="text-sm font-medium text-yellow-400 mb-2">
                        New Products to Create ({productsToCreate.filter(p => extractedItems.some(i => i.selected && i.isNew && i.sku === p.sku)).length})
                      </h4>
                      <p className="text-zinc-400 text-xs mb-2">
                        These products don't exist in your system and will be created automatically.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {productsToCreate
                          .filter(p => extractedItems.some(i => i.selected && i.isNew && i.sku === p.sku))
                          .map(p => (
                            <span key={p.sku} className="text-xs bg-yellow-500/20 text-yellow-300 px-2 py-1 rounded">
                              {p.name}
                            </span>
                          ))}
                      </div>
                    </div>
                  )}

                  {/* Order Summary */}
                  <div className="bg-zinc-800/30 rounded-lg p-4">
                    <div className="flex justify-between text-sm">
                      <span className="text-zinc-400">Selected Items:</span>
                      <span className="text-zinc-200">{extractedItems.filter(i => i.selected).length}</span>
                    </div>
                    <div className="flex justify-between text-sm mt-1">
                      <span className="text-zinc-400">Subtotal:</span>
                      <span className="text-zinc-200">
                        £{extractedItems.filter(i => i.selected).reduce((acc, i) => acc + (i.quantity || 0) * (i.unitPrice || 0), 0).toFixed(2)}
                      </span>
                    </div>
                    {invoiceData.deliveryFee > 0 && (
                      <div className="flex justify-between text-sm mt-1">
                        <span className="text-zinc-400">Delivery:</span>
                        <span className="text-zinc-200">£{invoiceData.deliveryFee.toFixed(2)}</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-4 border-t border-zinc-800">
                <button
                  onClick={applyExtractedData}
                  disabled={extractedItems.filter(i => i.selected).length === 0}
                  className="flex-1 px-4 py-3 bg-emerald-500 text-zinc-900 rounded-lg text-sm font-medium hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Confirm & Create Order
                </button>
                <button
                  onClick={() => { setShowInvoiceUpload(false); setShowForm(true); setReviewMode(false); }}
                  className="px-4 py-3 bg-zinc-700 text-zinc-300 rounded-lg text-sm hover:bg-zinc-600"
                >
                  Edit Manually
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Order Form */}
      {showForm && !showInvoiceUpload && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-zinc-200">
              {editingOrder ? 'Edit Order' : 'New Purchase Order'}
            </h3>
            {form.invoiceImage && (
              <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2 py-1 rounded">
                ✓ Invoice attached
              </span>
            )}
          </div>

          {/* Supplier & Invoice Ref */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Supplier *</label>
              <select
                value={form.supplierId}
                onChange={e => setForm({ ...form, supplierId: e.target.value })}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
              >
                <option value="">Select supplier</option>
                {data.suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Invoice Reference</label>
              <input
                type="text"
                value={form.invoiceRef}
                onChange={e => setForm({ ...form, invoiceRef: e.target.value })}
                placeholder="e.g., INV-12345"
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          {/* Delivery Method */}
          <div>
            <label className="block text-xs text-zinc-500 mb-2">Delivery Method</label>
            <div className="flex gap-2">
              {[
                { id: 'standard', label: 'Standard Delivery' },
                { id: 'match', label: 'Match Delivery' },
                { id: 'pickup', label: 'Pick Up' }
              ].map(method => (
                <button
                  key={method.id}
                  onClick={() => setForm({ ...form, deliveryMethod: method.id })}
                  className={`px-4 py-2 rounded text-sm transition-colors ${
                    form.deliveryMethod === method.id
                      ? 'bg-emerald-500 text-zinc-900'
                      : 'bg-zinc-800 text-zinc-400 hover:text-white'
                  }`}
                >
                  {method.label}
                </button>
              ))}
            </div>
          </div>

          {/* Delivery Address */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Delivery To *</label>
              <select
                value={form.deliveryType}
                onChange={e => setForm({ ...form, deliveryType: e.target.value })}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
              >
                <option value="warehouse">Warehouse</option>
                <option value="custom">Custom Address</option>
              </select>
            </div>
            {form.deliveryType === 'warehouse' ? (
              <div>
                <label className="block text-xs text-zinc-500 mb-1">Select Warehouse *</label>
                <select
                  value={form.warehouseId}
                  onChange={e => setForm({ ...form, warehouseId: e.target.value })}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
                >
                  <option value="">Select warehouse</option>
                  {data.warehouses.map(w => (
                    <option key={w.id} value={w.id}>{w.name}{w.address ? ` - ${w.address}` : ''}</option>
                  ))}
                </select>
              </div>
            ) : (
              <div>
                <label className="block text-xs text-zinc-500 mb-1">Delivery Address *</label>
                <input
                  type="text"
                  value={form.customAddress}
                  onChange={e => setForm({ ...form, customAddress: e.target.value })}
                  placeholder="Enter full address"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
                />
              </div>
            )}
          </div>

          {/* Expected Date */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Expected Date</label>
              <input
                type="date"
                value={form.expectedDate}
                onChange={e => setForm({ ...form, expectedDate: e.target.value })}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Delivery Fee (£)</label>
              <input
                type="number"
                step="0.01"
                value={form.deliveryFee}
                onChange={e => setForm({ ...form, deliveryFee: e.target.value })}
                placeholder="0.00"
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          {/* Order Items */}
          <div>
            <label className="block text-xs text-zinc-500 mb-2">Order Items</label>
            <div className="space-y-2">
              <div className="grid grid-cols-12 gap-2 text-xs text-zinc-500 font-medium px-1">
                <div className="col-span-5">Product</div>
                <div className="col-span-2">Qty</div>
                <div className="col-span-2">Unit Price</div>
                <div className="col-span-2 text-right">Line Total</div>
                <div className="col-span-1"></div>
              </div>
              {form.items.map((item, idx) => {
                const lineTotal = (parseInt(item.quantity) || 0) * (parseFloat(item.unitPrice) || 0);
                return (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                    <select
                      value={item.sku}
                      onChange={e => updateItem(idx, 'sku', e.target.value)}
                      className="col-span-5 bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
                    >
                      <option value="">Select product</option>
                      {data.products.map(p => (
                        <option key={p.sku} value={p.sku}>
                          {p.name} ({p.sku}) {p.unitCost ? `- £${p.unitCost.toFixed(2)}` : ''}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      placeholder="Qty"
                      value={item.quantity}
                      onChange={e => updateItem(idx, 'quantity', e.target.value)}
                      className="col-span-2 bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
                    />
                    <div className="col-span-2 flex items-center">
                      <span className="text-zinc-500 mr-1">£</span>
                      <input
                        type="number"
                        step="0.01"
                        placeholder="0.00"
                        value={item.unitPrice}
                        onChange={e => updateItem(idx, 'unitPrice', e.target.value)}
                        className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-2 text-sm focus:outline-none focus:border-emerald-500"
                      />
                    </div>
                    <div className="col-span-2 text-right text-zinc-300 text-sm">
                      £{lineTotal.toFixed(2)}
                    </div>
                    <button
                      onClick={() => removeItem(idx)}
                      className="col-span-1 text-zinc-500 hover:text-red-400 transition-colors text-center"
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
            <button onClick={addItem} className="mt-2 text-sm text-emerald-400 hover:text-emerald-300">
              + Add item
            </button>
          </div>

          {/* Order Totals */}
          <div className="border-t border-zinc-800 pt-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-zinc-500">Subtotal</span>
              <span className="text-zinc-300">£{calculateSubtotal().toFixed(2)}</span>
            </div>
            {parseFloat(form.deliveryFee) > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-zinc-500">Delivery Fee</span>
                <span className="text-zinc-300">£{parseFloat(form.deliveryFee).toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between text-sm font-medium pt-2 border-t border-zinc-800">
              <span className="text-zinc-300">Total</span>
              <span className="text-emerald-400">£{calculateTotal().toFixed(2)}</span>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={e => setForm({ ...form, notes: e.target.value })}
              placeholder="Any special instructions..."
              rows={2}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 resize-none"
            />
          </div>

          {/* Invoice Image Upload */}
          {!form.invoiceImage && (
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Attach Invoice (optional)</label>
              <label className="inline-block px-4 py-2 bg-zinc-700 text-zinc-300 rounded text-sm cursor-pointer hover:bg-zinc-600">
                Upload Image
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      const reader = new FileReader();
                      reader.onload = (ev) => {
                        setForm({ ...form, invoiceImage: ev.target?.result });
                      };
                      reader.readAsDataURL(file);
                    }
                  }}
                  className="hidden"
                />
              </label>
            </div>
          )}

          {form.invoiceImage && (
            <div className="flex items-center gap-4">
              <img src={form.invoiceImage} alt="Invoice" className="h-16 rounded border border-zinc-700" />
              <button
                onClick={() => setForm({ ...form, invoiceImage: null })}
                className="text-sm text-red-400 hover:text-red-300"
              >
                Remove
              </button>
            </div>
          )}

          <div className="flex gap-3">
            <button
              onClick={submit}
              disabled={!form.supplierId || !form.items[0].sku || (form.deliveryType === 'warehouse' && !form.warehouseId) || (form.deliveryType === 'custom' && !form.customAddress)}
              className="px-4 py-2 bg-emerald-600 text-white rounded text-sm font-medium hover:bg-emerald-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {editingOrder ? 'Update Order' : 'Create Order'}
            </button>
            <button
              onClick={resetForm}
              className="px-4 py-2 bg-zinc-700 text-zinc-300 rounded text-sm hover:bg-zinc-600"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Pending Orders */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-zinc-400">Pending Orders ({pendingOrders.length})</h3>
        {pendingOrders.length === 0 ? (
          <p className="text-zinc-600 text-sm">No pending orders</p>
        ) : (
          <div className="space-y-3">
            {pendingOrders.map(order => (
              <OrderCard key={order.id} order={order} data={data} onEdit={() => startEdit(order)} />
            ))}
          </div>
        )}
      </div>

      {/* Completed Orders */}
      {completedOrders.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-zinc-400">Completed Orders ({completedOrders.length})</h3>
          <div className="space-y-3">
            {completedOrders.slice(-5).reverse().map(order => (
              <OrderCard key={order.id} order={order} data={data} onEdit={() => startEdit(order)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function OrderCard({ order, data, onEdit }) {
  const [expanded, setExpanded] = useState(false);
  const supplier = data.suppliers.find(s => s.id === order.supplierId);
  const warehouse = data.warehouses.find(w => w.id === order.warehouseId);
  
  const deliveryMethodLabels = {
    standard: 'Standard',
    match: 'Match Delivery',
    pickup: 'Pick Up'
  };

  return (
    <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-zinc-200">{supplier?.name || order.supplierId}</span>
            <span className={`text-xs px-2 py-0.5 rounded ${
              order.status === 'pending' 
                ? 'bg-emerald-500/20 text-emerald-400' 
                : 'bg-emerald-500/20 text-emerald-400'
            }`}>
              {order.status}
            </span>
            <span className="text-xs bg-zinc-800 px-2 py-0.5 rounded text-zinc-400">
              {deliveryMethodLabels[order.deliveryMethod] || 'Standard'}
            </span>
            {order.invoiceRef && (
              <span className="text-xs text-zinc-500">Ref: {order.invoiceRef}</span>
            )}
          </div>
          <div className="text-sm text-zinc-500 mt-1">
            → {order.deliveryType === 'warehouse' ? (warehouse?.name || order.warehouseId) : order.customAddress}
            {order.expectedDate && ` • Expected: ${order.expectedDate}`}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-zinc-600">#{order.id.slice(-6)}</div>
          {order.total > 0 && (
            <div className="text-emerald-400 font-medium mt-1">£{order.total?.toFixed(2)}</div>
          )}
        </div>
      </div>
      
      <div className="mt-3 flex flex-wrap gap-2">
        {order.items.slice(0, expanded ? undefined : 3).map((item, i) => {
          const product = data.products.find(p => p.sku === item.sku);
          return (
            <span key={i} className="text-xs bg-zinc-800 px-2 py-1 rounded">
              {product?.name || item.sku} × {item.quantity}
              {item.unitPrice > 0 && <span className="text-zinc-500 ml-1">@ £{item.unitPrice.toFixed(2)}</span>}
            </span>
          );
        })}
        {!expanded && order.items.length > 3 && (
          <button 
            onClick={() => setExpanded(true)}
            className="text-xs text-emerald-400 hover:text-emerald-300"
          >
            +{order.items.length - 3} more
          </button>
        )}
      </div>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-zinc-800 space-y-2 text-sm">
          {order.deliveryFee > 0 && (
            <div className="flex justify-between">
              <span className="text-zinc-500">Delivery Fee</span>
              <span className="text-zinc-400">£{order.deliveryFee.toFixed(2)}</span>
            </div>
          )}
          {order.notes && (
            <div className="text-zinc-500 text-xs">
              <span className="font-medium">Notes:</span> {order.notes}
            </div>
          )}
          {order.invoiceImage && (
            <div className="mt-2">
              <span className="text-zinc-500 text-xs font-medium block mb-1">Invoice:</span>
              <img src={order.invoiceImage} alt="Invoice" className="max-h-32 rounded border border-zinc-700" />
            </div>
          )}
        </div>
      )}

      <div className="mt-3 pt-3 border-t border-zinc-800 flex gap-3">
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-zinc-400 hover:text-zinc-300"
        >
          {expanded ? 'Show less' : 'Show details'}
        </button>
        {order.status === 'pending' && (
          <button
            onClick={onEdit}
            className="text-xs text-emerald-400 hover:text-emerald-300"
          >
            Edit
          </button>
        )}
      </div>
    </div>
  );
}

// ============ RECEIVE STOCK ============

function ReceiveStock({ data, saveData }) {
  const [activeSubTab, setActiveSubTab] = useState('receive');
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [receivedItems, setReceivedItems] = useState({});
  const [receiveWarehouseId, setReceiveWarehouseId] = useState('');

  const pendingOrders = data.orders.filter(o => o.status === 'pending');
  const receipts = data.receipts || [];

  const selectOrder = (order) => {
    setSelectedOrder(order);
    // For orders with a warehouse, pre-select it. For custom address, user must choose
    setReceiveWarehouseId(order.warehouseId || '');
    const items = {};
    order.items.forEach(item => {
      items[item.sku] = {
        quantity: item.quantity,
        expiryDate: '',
        hasDamage: false,
        damageNotes: ''
      };
    });
    setReceivedItems(items);
  };

  const updateItem = (sku, field, value) => {
    setReceivedItems(prev => ({
      ...prev,
      [sku]: { ...prev[sku], [field]: value }
    }));
  };

  const confirmReceive = () => {
    if (!selectedOrder || !receiveWarehouseId) return;

    const newStock = { ...data.stock };
    if (!newStock[receiveWarehouseId]) {
      newStock[receiveWarehouseId] = {};
    }

    const newBatches = [...(data.stockBatches || [])];
    const receiptItems = [];

    Object.entries(receivedItems).forEach(([sku, itemData]) => {
      const qty = itemData.quantity;
      if (qty > 0) {
        // Update total stock count
        newStock[receiveWarehouseId][sku] = (newStock[receiveWarehouseId][sku] || 0) + qty;

        // Create batch record for expiry tracking
        const batch = {
          id: `batch-${Date.now()}-${sku}`,
          sku,
          warehouseId: receiveWarehouseId,
          quantity: qty,
          remainingQty: qty,
          expiryDate: itemData.expiryDate || null,
          receivedAt: new Date().toISOString(),
          orderId: selectedOrder.id,
          hasDamage: itemData.hasDamage,
          damageNotes: itemData.damageNotes
        };
        newBatches.push(batch);

        receiptItems.push({
          sku,
          quantity: qty,
          expiryDate: itemData.expiryDate || null,
          hasDamage: itemData.hasDamage,
          damageNotes: itemData.damageNotes
        });
      }
    });

    // Create receipt record
    const receipt = {
      id: `rcpt-${Date.now()}`,
      orderId: selectedOrder.id,
      supplierId: selectedOrder.supplierId,
      warehouseId: receiveWarehouseId,
      receivedAt: new Date().toISOString(),
      items: receiptItems,
      totalItems: receiptItems.reduce((acc, i) => acc + i.quantity, 0),
      itemsWithDamage: receiptItems.filter(i => i.hasDamage).length
    };

    const updatedOrders = data.orders.map(o =>
      o.id === selectedOrder.id
        ? { ...o, status: 'received', receivedAt: new Date().toISOString() }
        : o
    );

    saveData({
      ...data,
      orders: updatedOrders,
      stock: newStock,
      stockBatches: newBatches,
      receipts: [...receipts, receipt]
    });

    setSelectedOrder(null);
    setReceivedItems({});
  };

  const getWarehouseName = (id) => data.warehouses.find(w => w.id === id)?.name || id;
  const getSupplierName = (id) => data.suppliers.find(s => s.id === id)?.name || id;
  const getProductName = (sku) => data.products.find(p => p.sku === sku)?.name || sku;

  // Calculate expiry status
  const getExpiryStatus = (expiryDate) => {
    if (!expiryDate) return null;
    const now = new Date();
    const expiry = new Date(expiryDate);
    const daysUntil = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
    
    if (daysUntil < 0) return { status: 'expired', label: 'Expired', color: 'text-red-400 bg-red-500/20' };
    if (daysUntil <= 7) return { status: 'critical', label: `${daysUntil}d left`, color: 'text-red-400 bg-red-500/20' };
    if (daysUntil <= 30) return { status: 'warning', label: `${daysUntil}d left`, color: 'text-emerald-400 bg-emerald-500/20' };
    return { status: 'ok', label: `${daysUntil}d left`, color: 'text-emerald-400 bg-emerald-500/20' };
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Receive Stock</h2>
      </div>

      <div className="flex gap-2 border-b border-zinc-800 pb-4">
        {[
          { id: 'receive', label: 'Receive Orders' },
          { id: 'history', label: 'Receipt History' }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => { setActiveSubTab(tab.id); setSelectedOrder(null); }}
            className={`px-4 py-2 rounded text-sm transition-colors ${
              activeSubTab === tab.id ? 'bg-emerald-500 text-zinc-900' : 'bg-zinc-800 text-zinc-400 hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeSubTab === 'receive' && (
        <>
          {!selectedOrder ? (
            <div className="space-y-4">
              <p className="text-zinc-500 text-sm">Select an order to check in:</p>
              {pendingOrders.length === 0 ? (
                <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-8 text-center">
                  <p className="text-zinc-500">No pending orders to receive</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {pendingOrders.map(order => {
                    const deliveryMethodLabels = { standard: 'Standard', match: 'Match Delivery', pickup: 'Pick Up' };
                    return (
                      <button
                        key={order.id}
                        onClick={() => selectOrder(order)}
                        className="w-full text-left bg-zinc-900/50 border border-zinc-800 rounded-lg p-4 hover:border-emerald-500/50 transition-colors"
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-zinc-200">{getSupplierName(order.supplierId)}</span>
                              {order.deliveryMethod && (
                                <span className="text-xs bg-zinc-800 px-2 py-0.5 rounded text-zinc-400">
                                  {deliveryMethodLabels[order.deliveryMethod] || 'Standard'}
                                </span>
                              )}
                            </div>
                            <div className="text-sm text-zinc-500 mt-1">
                              → {order.warehouseId ? getWarehouseName(order.warehouseId) : order.customAddress || 'Custom Address'}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-sm text-zinc-400">{order.items.length} items</div>
                            {order.total > 0 && (
                              <div className="text-emerald-400 text-sm">£{order.total?.toFixed(2)}</div>
                            )}
                            <div className="text-xs text-zinc-600">{new Date(order.createdAt).toLocaleDateString('en-GB')}</div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium text-zinc-200">Receiving: {getSupplierName(selectedOrder.supplierId)}</h3>
                  <p className="text-sm text-zinc-500">
                    Ordered to: {selectedOrder.warehouseId ? getWarehouseName(selectedOrder.warehouseId) : selectedOrder.customAddress}
                  </p>
                </div>
                <button onClick={() => setSelectedOrder(null)} className="text-zinc-500 hover:text-zinc-300">Cancel</button>
              </div>

              {/* Warehouse selector for custom address orders */}
              {!selectedOrder.warehouseId && (
                <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-4">
                  <p className="text-emerald-400 text-sm mb-2">This order was delivered to a custom address. Select the warehouse to receive stock into:</p>
                  <select
                    value={receiveWarehouseId}
                    onChange={e => setReceiveWarehouseId(e.target.value)}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
                  >
                    <option value="">Select warehouse</option>
                    {data.warehouses.map(w => (
                      <option key={w.id} value={w.id}>{w.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {receiveWarehouseId && (
                <div className="text-sm text-emerald-400 bg-emerald-500/10 px-3 py-2 rounded">
                  ✓ Stock will be received into: {getWarehouseName(receiveWarehouseId)}
                </div>
              )}

              <div className="space-y-4">
                <div className="grid grid-cols-12 gap-2 text-xs text-zinc-500 font-medium px-2">
                  <div className="col-span-4">Product</div>
                  <div className="col-span-2 text-center">Qty Received</div>
                  <div className="col-span-2 text-center">Expiry Date</div>
                  <div className="col-span-1 text-center">Damage?</div>
                  <div className="col-span-3">Damage Notes</div>
                </div>

                {selectedOrder.items.map(item => {
                  const product = data.products.find(p => p.sku === item.sku);
                  const itemData = receivedItems[item.sku] || {};
                  return (
                    <div key={item.sku} className="grid grid-cols-12 gap-2 items-center py-3 border-b border-zinc-800 last:border-0">
                      <div className="col-span-4">
                        <span className="text-zinc-200">{product?.name || item.sku}</span>
                        <div className="text-zinc-600 text-xs">{item.sku}</div>
                        <div className="text-zinc-500 text-xs">Ordered: {item.quantity}</div>
                      </div>
                      <div className="col-span-2">
                        <input
                          type="number"
                          value={itemData.quantity || ''}
                          onChange={e => updateItem(item.sku, 'quantity', parseInt(e.target.value) || 0)}
                          className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm text-center focus:outline-none focus:border-emerald-500"
                        />
                      </div>
                      <div className="col-span-2">
                        <input
                          type="date"
                          value={itemData.expiryDate || ''}
                          onChange={e => updateItem(item.sku, 'expiryDate', e.target.value)}
                          className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-2 text-sm focus:outline-none focus:border-emerald-500"
                        />
                      </div>
                      <div className="col-span-1 flex justify-center">
                        <button
                          onClick={() => updateItem(item.sku, 'hasDamage', !itemData.hasDamage)}
                          className={`w-8 h-8 rounded flex items-center justify-center transition-colors ${
                            itemData.hasDamage 
                              ? 'bg-red-500/20 text-red-400 border border-red-500/50' 
                              : 'bg-zinc-800 text-zinc-500 border border-zinc-700 hover:border-zinc-600'
                          }`}
                        >
                          {itemData.hasDamage ? '✗' : '✓'}
                        </button>
                      </div>
                      <div className="col-span-3">
                        <input
                          type="text"
                          value={itemData.damageNotes || ''}
                          onChange={e => updateItem(item.sku, 'damageNotes', e.target.value)}
                          placeholder={itemData.hasDamage ? 'Describe damage...' : ''}
                          disabled={!itemData.hasDamage}
                          className={`w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 ${
                            !itemData.hasDamage ? 'opacity-50' : ''
                          }`}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Summary before confirmation */}
              <div className="bg-zinc-800/50 rounded-lg p-4">
                <div className="text-sm text-zinc-400 mb-2">Receipt Summary</div>
                <div className="flex gap-6 text-sm">
                  <span className="text-zinc-300">
                    Total items: {Object.values(receivedItems).reduce((acc, i) => acc + (i.quantity || 0), 0)}
                  </span>
                  <span className="text-zinc-300">
                    With expiry: {Object.values(receivedItems).filter(i => i.expiryDate).length}
                  </span>
                  {Object.values(receivedItems).some(i => i.hasDamage) && (
                    <span className="text-red-400">
                      Damaged: {Object.values(receivedItems).filter(i => i.hasDamage).length}
                    </span>
                  )}
                </div>
              </div>

              <button 
                onClick={confirmReceive} 
                disabled={!receiveWarehouseId}
                className="px-4 py-2 bg-emerald-600 text-white rounded text-sm font-medium hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Confirm Receipt
              </button>
            </div>
          )}
        </>
      )}

      {activeSubTab === 'history' && (
        <div className="space-y-4">
          {receipts.length === 0 ? (
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-8 text-center">
              <p className="text-zinc-500">No receipts recorded yet</p>
            </div>
          ) : (
            <div className="space-y-4">
              {receipts.slice().reverse().map(receipt => (
                <div key={receipt.id} className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="font-medium text-zinc-200">{getSupplierName(receipt.supplierId)}</div>
                      <div className="text-sm text-zinc-500">→ {getWarehouseName(receipt.warehouseId)}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm text-zinc-400">{new Date(receipt.receivedAt).toLocaleDateString('en-GB')}</div>
                      <div className="text-xs text-zinc-600">{new Date(receipt.receivedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</div>
                    </div>
                  </div>

                  <div className="border-t border-zinc-800 pt-3">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-zinc-500 text-xs">
                          <th className="text-left pb-2">Product</th>
                          <th className="text-center pb-2">Qty</th>
                          <th className="text-center pb-2">Expiry</th>
                          <th className="text-center pb-2">Condition</th>
                        </tr>
                      </thead>
                      <tbody>
                        {receipt.items.map((item, idx) => {
                          const expiryStatus = getExpiryStatus(item.expiryDate);
                          return (
                            <tr key={idx} className="border-t border-zinc-800/50">
                              <td className="py-2 text-zinc-300">{getProductName(item.sku)}</td>
                              <td className="py-2 text-center text-zinc-400">{item.quantity}</td>
                              <td className="py-2 text-center">
                                {item.expiryDate ? (
                                  <span className={`text-xs px-2 py-0.5 rounded ${expiryStatus?.color || ''}`}>
                                    {new Date(item.expiryDate).toLocaleDateString('en-GB')}
                                  </span>
                                ) : (
                                  <span className="text-zinc-600 text-xs">—</span>
                                )}
                              </td>
                              <td className="py-2 text-center">
                                {item.hasDamage ? (
                                  <span className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded" title={item.damageNotes}>
                                    Damaged
                                  </span>
                                ) : (
                                  <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded">
                                    OK
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {receipt.itemsWithDamage > 0 && (
                    <div className="mt-3 pt-3 border-t border-zinc-800">
                      <div className="text-xs text-red-400">
                        ⚠ {receipt.itemsWithDamage} item(s) received with damage
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============ WAREHOUSE INVENTORY ============

function Inventory({ data, saveData }) {
  const [selectedWarehouse, setSelectedWarehouse] = useState('all');
  const [activeSubTab, setActiveSubTab] = useState('stock');
  
  // Add Stock states
  const [showAddStock, setShowAddStock] = useState(false);
  const [addStockForm, setAddStockForm] = useState({
    warehouseId: '',
    sku: '',
    productName: '',
    quantity: '',
    category: 'Other',
    unitCost: ''
  });
  
  // CSV Upload states
  const [showCsvUpload, setShowCsvUpload] = useState(false);
  const [csvProcessing, setCsvProcessing] = useState(false);
  const [csvItems, setCsvItems] = useState([]);
  const [csvConflicts, setCsvConflicts] = useState([]);
  const [csvReviewMode, setCsvReviewMode] = useState(false);

  const getStockForWarehouse = (whId) => data.stock[whId] || {};

  const getAllStock = () => {
    const combined = {};
    data.warehouses.forEach(wh => {
      Object.entries(data.stock[wh.id] || {}).forEach(([sku, qty]) => {
        if (!combined[sku]) combined[sku] = {};
        combined[sku][wh.id] = qty;
      });
    });
    return combined;
  };

  // Get batches with expiry info
  const getBatches = () => {
    const batches = data.stockBatches || [];
    if (selectedWarehouse === 'all') return batches.filter(b => b.remainingQty > 0);
    return batches.filter(b => b.warehouseId === selectedWarehouse && b.remainingQty > 0);
  };

  // Get expiry status
  const getExpiryStatus = (expiryDate) => {
    if (!expiryDate) return null;
    const now = new Date();
    const expiry = new Date(expiryDate);
    const daysUntil = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
    
    if (daysUntil < 0) return { status: 'expired', label: 'Expired', days: daysUntil, color: 'text-red-400 bg-red-500/20' };
    if (daysUntil <= 7) return { status: 'critical', label: `${daysUntil}d`, days: daysUntil, color: 'text-red-400 bg-red-500/20' };
    if (daysUntil <= 30) return { status: 'warning', label: `${daysUntil}d`, days: daysUntil, color: 'text-emerald-400 bg-emerald-500/20' };
    return { status: 'ok', label: `${daysUntil}d`, days: daysUntil, color: 'text-emerald-400 bg-emerald-500/20' };
  };

  // Get earliest expiry for a SKU
  const getEarliestExpiry = (sku, warehouseId = null) => {
    const batches = (data.stockBatches || []).filter(b => 
      b.sku === sku && 
      b.remainingQty > 0 && 
      b.expiryDate &&
      (warehouseId ? b.warehouseId === warehouseId : true)
    );
    if (batches.length === 0) return null;
    const sorted = batches.sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate));
    return sorted[0].expiryDate;
  };

  // Summary stats
  const expiredBatches = getBatches().filter(b => {
    const status = getExpiryStatus(b.expiryDate);
    return status?.status === 'expired';
  });
  const expiringBatches = getBatches().filter(b => {
    const status = getExpiryStatus(b.expiryDate);
    return status?.status === 'critical' || status?.status === 'warning';
  });

  // ===== ADD STOCK FUNCTIONS =====
  
  const openAddStock = () => {
    setAddStockForm({
      warehouseId: selectedWarehouse !== 'all' ? selectedWarehouse : (data.warehouses[0]?.id || ''),
      sku: '',
      productName: '',
      quantity: '',
      category: 'Other',
      unitCost: ''
    });
    setShowAddStock(true);
  };

  const handleAddStockSubmit = () => {
    if (!addStockForm.warehouseId || !addStockForm.sku || !addStockForm.quantity) return;
    
    const qty = parseInt(addStockForm.quantity) || 0;
    if (qty <= 0) return;

    // Check if product exists
    let product = data.products.find(p => p.sku === addStockForm.sku);
    let newProducts = [...data.products];
    
    if (!product) {
      // Create new product
      const newProduct = {
        sku: addStockForm.sku,
        name: addStockForm.productName || addStockForm.sku,
        category: addStockForm.category,
        unitCost: parseFloat(addStockForm.unitCost) || 0,
        salePrice: parseFloat(addStockForm.unitCost) || 0
      };
      newProducts.push(newProduct);
    }

    // Update stock
    const newStock = {
      ...data.stock,
      [addStockForm.warehouseId]: {
        ...(data.stock[addStockForm.warehouseId] || {}),
        [addStockForm.sku]: ((data.stock[addStockForm.warehouseId] || {})[addStockForm.sku] || 0) + qty
      }
    };

    saveData({ ...data, products: newProducts, stock: newStock });
    setShowAddStock(false);
  };

  // Check for SKU conflicts (same SKU, different name)
  const checkSkuConflict = (sku, name) => {
    const existingProduct = data.products.find(p => p.sku === sku);
    if (existingProduct && existingProduct.name.toLowerCase() !== name.toLowerCase()) {
      return {
        existingSku: existingProduct.sku,
        existingName: existingProduct.name,
        newName: name
      };
    }
    return null;
  };

  // ===== CSV UPLOAD FUNCTIONS =====
  
  const parseCSVLine = (line) => {
    const result = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  };

  const handleCsvUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setCsvProcessing(true);
    setShowCsvUpload(true);

    const text = await file.text();
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    
    if (lines.length < 2) {
      setCsvProcessing(false);
      return;
    }

    const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase().trim());
    
    // Detect CSV format
    const skuCol = headers.findIndex(h => 
      h.includes('sku') || h.includes('product id') || h.includes('product__id') || h.includes('external_id')
    );
    const nameCol = headers.findIndex(h => 
      h.includes('name') || h.includes('item name') || h.includes('product name') || h.includes('description')
    );
    const qtyCol = headers.findIndex(h => 
      h.includes('quantity') || h.includes('stock') || h.includes('current stock') || h.includes('qty')
    );
    const categoryCol = headers.findIndex(h => 
      h.includes('category') || h.includes('product__category__name')
    );
    const priceCol = headers.findIndex(h => 
      h.includes('price') || h.includes('unit price') || h.includes('cost') || h.includes('unit cost')
    );
    const supplierCol = headers.findIndex(h => 
      h.includes('supplier') || h.includes('vendor')
    );

    const items = [];
    const conflicts = [];
    const seenSkus = new Set();

    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i]);
      if (values.length < 2) continue;

      let sku = skuCol >= 0 ? values[skuCol]?.trim() : '';
      const name = nameCol >= 0 ? values[nameCol]?.trim() : '';
      const qtyStr = qtyCol >= 0 ? values[qtyCol]?.trim() : '0';
      const category = categoryCol >= 0 ? values[categoryCol]?.trim() : 'Other';
      let priceStr = priceCol >= 0 ? values[priceCol]?.trim() : '0';
      const supplier = supplierCol >= 0 ? values[supplierCol]?.trim() : '';

      // Skip if no name
      if (!name) continue;

      // Generate SKU if not provided
      if (!sku) {
        // Create SKU from name
        const cleanName = name.replace(/[^a-zA-Z0-9]/g, '').substring(0, 10).toUpperCase();
        sku = `${cleanName}-${Date.now().toString().slice(-4)}-${i}`;
      }

      // Skip duplicates in same CSV
      if (seenSkus.has(sku)) continue;
      seenSkus.add(sku);

      // Parse quantity
      const qty = parseInt(qtyStr.replace(/[^0-9]/g, '')) || 0;

      // Parse price (remove £ symbol)
      const price = parseFloat(priceStr.replace(/[£$,]/g, '')) || 0;

      // Check for conflicts with existing products
      const conflict = checkSkuConflict(sku, name);
      
      const item = {
        sku,
        name,
        quantity: qty,
        category: category || 'Other',
        unitCost: price,
        supplier,
        selected: true,
        isNew: !data.products.find(p => p.sku === sku),
        hasConflict: !!conflict,
        conflict,
        action: conflict ? 'review' : 'add' // 'add', 'skip', 'update'
      };

      items.push(item);
      
      if (conflict) {
        conflicts.push(item);
      }
    }

    setCsvItems(items);
    setCsvConflicts(conflicts);
    setCsvReviewMode(true);
    setCsvProcessing(false);
  };

  const updateCsvItem = (idx, field, value) => {
    const items = [...csvItems];
    items[idx][field] = value;
    setCsvItems(items);
  };

  const toggleCsvItemSelection = (idx) => {
    const items = [...csvItems];
    items[idx].selected = !items[idx].selected;
    setCsvItems(items);
  };

  const resolveConflict = (idx, action) => {
    const items = [...csvItems];
    items[idx].action = action;
    if (action === 'use-existing') {
      // Keep existing product name, just update stock
      items[idx].name = items[idx].conflict.existingName;
      items[idx].hasConflict = false;
    } else if (action === 'use-new') {
      // Update product with new name
      items[idx].hasConflict = false;
    }
    setCsvItems(items);
    setCsvConflicts(prev => prev.filter((_, i) => csvConflicts.indexOf(items[idx]) !== i));
  };

  const applyCsvData = () => {
    const targetWarehouse = selectedWarehouse !== 'all' ? selectedWarehouse : (data.warehouses[0]?.id || '');
    if (!targetWarehouse) return;

    let newProducts = [...data.products];
    const newStock = { ...data.stock };
    
    if (!newStock[targetWarehouse]) {
      newStock[targetWarehouse] = {};
    }

    for (const item of csvItems) {
      if (!item.selected || item.action === 'skip') continue;

      // Handle product
      const existingProductIdx = newProducts.findIndex(p => p.sku === item.sku);
      
      if (existingProductIdx >= 0) {
        // Update existing product if action is 'use-new'
        if (item.action === 'use-new') {
          newProducts[existingProductIdx] = {
            ...newProducts[existingProductIdx],
            name: item.name,
            category: item.category || newProducts[existingProductIdx].category,
            unitCost: item.unitCost || newProducts[existingProductIdx].unitCost
          };
        }
      } else {
        // Create new product
        newProducts.push({
          sku: item.sku,
          name: item.name,
          category: item.category || 'Other',
          unitCost: item.unitCost || 0,
          salePrice: item.unitCost || 0
        });
      }

      // Update stock
      newStock[targetWarehouse][item.sku] = (newStock[targetWarehouse][item.sku] || 0) + item.quantity;
    }

    saveData({ ...data, products: newProducts, stock: newStock });
    
    // Reset
    setShowCsvUpload(false);
    setCsvReviewMode(false);
    setCsvItems([]);
    setCsvConflicts([]);
  };

  const unresolvedConflicts = csvItems.filter(i => i.selected && i.hasConflict && i.action === 'review');

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h2 className="text-xl font-semibold">Warehouse Inventory</h2>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3">
          <select
            value={selectedWarehouse}
            onChange={e => setSelectedWarehouse(e.target.value)}
            className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2.5 text-sm focus:outline-none focus:border-emerald-500"
          >
            <option value="all">All Warehouses</option>
            {data.warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <div className="flex gap-2">
            <button
              onClick={openAddStock}
              className="flex-1 sm:flex-none px-3 py-2.5 bg-emerald-600 text-white rounded text-sm font-medium hover:bg-emerald-500"
            >
              + Add Stock
            </button>
            <label className="flex-1 sm:flex-none px-3 py-2.5 bg-teal-600 text-white rounded text-sm font-medium hover:bg-teal-500 cursor-pointer text-center">
              📄 CSV
              <input
                type="file"
                accept=".csv"
                onChange={handleCsvUpload}
                className="hidden"
              />
            </label>
          </div>
        </div>
      </div>

      {/* Add Stock Modal */}
      {showAddStock && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-zinc-200">Add Stock Manually</h3>
            <button onClick={() => setShowAddStock(false)} className="text-zinc-500 hover:text-zinc-300 text-xl">×</button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Warehouse *</label>
              <select
                value={addStockForm.warehouseId}
                onChange={e => setAddStockForm({ ...addStockForm, warehouseId: e.target.value })}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm"
              >
                {data.warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">SKU *</label>
              <input
                type="text"
                value={addStockForm.sku}
                onChange={e => {
                  const sku = e.target.value;
                  const existing = data.products.find(p => p.sku === sku);
                  setAddStockForm({ 
                    ...addStockForm, 
                    sku,
                    productName: existing?.name || addStockForm.productName,
                    category: existing?.category || addStockForm.category,
                    unitCost: existing?.unitCost?.toString() || addStockForm.unitCost
                  });
                }}
                placeholder="e.g., PROD-001"
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm"
                list="existing-skus"
              />
              <datalist id="existing-skus">
                {data.products.map(p => <option key={p.sku} value={p.sku}>{p.name}</option>)}
              </datalist>
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Product Name {!data.products.find(p => p.sku === addStockForm.sku) && '*'}</label>
              <input
                type="text"
                value={addStockForm.productName}
                onChange={e => setAddStockForm({ ...addStockForm, productName: e.target.value })}
                placeholder="Product name"
                disabled={!!data.products.find(p => p.sku === addStockForm.sku)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm disabled:opacity-50"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Quantity *</label>
              <input
                type="number"
                value={addStockForm.quantity}
                onChange={e => setAddStockForm({ ...addStockForm, quantity: e.target.value })}
                placeholder="0"
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm"
              />
            </div>
            {!data.products.find(p => p.sku === addStockForm.sku) && (
              <>
                <div>
                  <label className="block text-xs text-zinc-500 mb-1">Category</label>
                  <select
                    value={addStockForm.category}
                    onChange={e => setAddStockForm({ ...addStockForm, category: e.target.value })}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm"
                  >
                    <option value="Meals">Meals</option>
                    <option value="Drinks">Drinks</option>
                    <option value="Snacks">Snacks</option>
                    <option value="Breakfast">Breakfast</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-zinc-500 mb-1">Unit Cost (£)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={addStockForm.unitCost}
                    onChange={e => setAddStockForm({ ...addStockForm, unitCost: e.target.value })}
                    placeholder="0.00"
                    className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm"
                  />
                </div>
              </>
            )}
          </div>

          {addStockForm.sku && data.products.find(p => p.sku === addStockForm.sku) && (
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3">
              <p className="text-emerald-400 text-sm">
                ✓ Existing product found: <strong>{data.products.find(p => p.sku === addStockForm.sku)?.name}</strong>
              </p>
            </div>
          )}

          <div className="flex gap-3 pt-4 border-t border-zinc-800">
            <button
              onClick={handleAddStockSubmit}
              disabled={!addStockForm.warehouseId || !addStockForm.sku || !addStockForm.quantity}
              className="px-4 py-2 bg-emerald-600 text-white rounded text-sm font-medium hover:bg-emerald-500 disabled:opacity-50"
            >
              Add Stock
            </button>
            <button
              onClick={() => setShowAddStock(false)}
              className="px-4 py-2 bg-zinc-700 text-zinc-300 rounded text-sm hover:bg-zinc-600"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* CSV Upload Modal */}
      {showCsvUpload && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium text-zinc-200">CSV Stock Import</h3>
              <p className="text-zinc-500 text-sm mt-1">
                {selectedWarehouse !== 'all' 
                  ? `Importing to: ${data.warehouses.find(w => w.id === selectedWarehouse)?.name}`
                  : `Importing to: ${data.warehouses[0]?.name || 'Default Warehouse'}`
                }
              </p>
            </div>
            <button onClick={() => { setShowCsvUpload(false); setCsvReviewMode(false); setCsvItems([]); }} className="text-zinc-500 hover:text-zinc-300 text-xl">×</button>
          </div>

          {csvProcessing && (
            <div className="text-center py-12">
              <div className="inline-block animate-spin text-teal-400 text-3xl mb-4">↻</div>
              <p className="text-zinc-400">Processing CSV...</p>
            </div>
          )}

          {csvReviewMode && (
            <div className="space-y-4">
              {/* Summary Stats */}
              <div className="grid grid-cols-4 gap-4">
                <div className="bg-zinc-800/50 rounded-lg p-3 text-center">
                  <div className="text-xl font-bold text-teal-400">{csvItems.length}</div>
                  <div className="text-xs text-zinc-500">Total Items</div>
                </div>
                <div className="bg-zinc-800/50 rounded-lg p-3 text-center">
                  <div className="text-xl font-bold text-emerald-400">
                    {csvItems.filter(i => !i.isNew && !i.hasConflict).length}
                  </div>
                  <div className="text-xs text-zinc-500">Matched</div>
                </div>
                <div className="bg-zinc-800/50 rounded-lg p-3 text-center">
                  <div className="text-xl font-bold text-yellow-400">
                    {csvItems.filter(i => i.isNew).length}
                  </div>
                  <div className="text-xs text-zinc-500">New Products</div>
                </div>
                <div className="bg-zinc-800/50 rounded-lg p-3 text-center">
                  <div className="text-xl font-bold text-red-400">
                    {unresolvedConflicts.length}
                  </div>
                  <div className="text-xs text-zinc-500">Conflicts</div>
                </div>
              </div>

              {/* Conflicts Warning */}
              {unresolvedConflicts.length > 0 && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
                  <h4 className="text-red-400 font-medium mb-2">⚠ SKU Conflicts Detected</h4>
                  <p className="text-zinc-400 text-sm mb-3">
                    The following items have matching SKUs but different names. Please resolve each conflict before importing.
                  </p>
                  <div className="space-y-3">
                    {unresolvedConflicts.map((item, idx) => {
                      const itemIdx = csvItems.findIndex(i => i.sku === item.sku);
                      return (
                        <div key={item.sku} className="bg-zinc-800/50 rounded-lg p-3">
                          <div className="flex items-start justify-between gap-4">
                            <div className="flex-1">
                              <p className="text-zinc-300 text-sm font-medium">SKU: {item.sku}</p>
                              <div className="mt-2 grid grid-cols-2 gap-4 text-sm">
                                <div>
                                  <p className="text-zinc-500 text-xs">Existing in System:</p>
                                  <p className="text-emerald-400">{item.conflict.existingName}</p>
                                </div>
                                <div>
                                  <p className="text-zinc-500 text-xs">From CSV:</p>
                                  <p className="text-yellow-400">{item.conflict.newName}</p>
                                </div>
                              </div>
                            </div>
                            <div className="flex flex-col gap-2">
                              <button
                                onClick={() => resolveConflict(itemIdx, 'use-existing')}
                                className="px-3 py-1.5 bg-emerald-600 text-white rounded text-xs hover:bg-emerald-500"
                              >
                                Keep Existing
                              </button>
                              <button
                                onClick={() => resolveConflict(itemIdx, 'use-new')}
                                className="px-3 py-1.5 bg-yellow-600 text-white rounded text-xs hover:bg-yellow-500"
                              >
                                Use New Name
                              </button>
                              <button
                                onClick={() => resolveConflict(itemIdx, 'skip')}
                                className="px-3 py-1.5 bg-zinc-600 text-zinc-300 rounded text-xs hover:bg-zinc-500"
                              >
                                Skip Item
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Items List */}
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {csvItems.map((item, idx) => (
                  <div 
                    key={idx}
                    className={`flex items-center gap-3 p-3 rounded-lg border ${
                      item.action === 'skip' ? 'bg-zinc-800/30 border-zinc-700 opacity-50' :
                      item.hasConflict ? 'bg-red-500/5 border-red-500/30' :
                      item.isNew ? 'bg-yellow-500/5 border-yellow-500/30' :
                      'bg-emerald-500/5 border-emerald-500/30'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={item.selected && item.action !== 'skip'}
                      onChange={() => toggleCsvItemSelection(idx)}
                      disabled={item.action === 'skip'}
                      className="w-4 h-4 rounded border-zinc-600"
                    />

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs px-1.5 py-0.5 rounded ${
                          item.action === 'skip' ? 'bg-zinc-600 text-zinc-400' :
                          item.hasConflict ? 'bg-red-500/20 text-red-400' :
                          item.isNew ? 'bg-yellow-500/20 text-yellow-400' :
                          'bg-emerald-500/20 text-emerald-400'
                        }`}>
                          {item.action === 'skip' ? 'SKIP' :
                           item.hasConflict ? 'CONFLICT' :
                           item.isNew ? 'NEW' : 'MATCHED'}
                        </span>
                        <span className="text-xs text-zinc-500 font-mono">{item.sku}</span>
                      </div>
                      <p className="text-sm text-zinc-200 mt-1">{item.name}</p>
                      {item.category && (
                        <span className="text-xs text-zinc-500">{item.category}</span>
                      )}
                    </div>

                    <div className="text-center">
                      <p className="text-zinc-500 text-xs">Qty</p>
                      <input
                        type="number"
                        value={item.quantity}
                        onChange={(e) => updateCsvItem(idx, 'quantity', parseInt(e.target.value) || 0)}
                        className="w-16 bg-zinc-700 border border-zinc-600 rounded px-2 py-1 text-center text-sm"
                      />
                    </div>

                    <div className="text-center">
                      <p className="text-zinc-500 text-xs">Price</p>
                      <p className="text-zinc-300 text-sm">£{(item.unitCost || 0).toFixed(2)}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Actions */}
              <div className="flex gap-3 pt-4 border-t border-zinc-800">
                <button
                  onClick={applyCsvData}
                  disabled={unresolvedConflicts.length > 0 || csvItems.filter(i => i.selected && i.action !== 'skip').length === 0}
                  className="flex-1 px-4 py-3 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {unresolvedConflicts.length > 0 
                    ? `Resolve ${unresolvedConflicts.length} Conflict${unresolvedConflicts.length > 1 ? 's' : ''} First`
                    : `Import ${csvItems.filter(i => i.selected && i.action !== 'skip').length} Items`
                  }
                </button>
                <button
                  onClick={() => { setShowCsvUpload(false); setCsvReviewMode(false); setCsvItems([]); }}
                  className="px-4 py-3 bg-zinc-700 text-zinc-300 rounded-lg text-sm hover:bg-zinc-600"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="flex gap-2 border-b border-zinc-800 pb-4">
        {[
          { id: 'stock', label: 'Stock Levels' },
          { id: 'expiry', label: 'Expiry Tracking' },
          { id: 'batches', label: 'All Batches' }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveSubTab(tab.id)}
            className={`px-4 py-2 rounded text-sm transition-colors ${
              activeSubTab === tab.id ? 'bg-emerald-500 text-zinc-900' : 'bg-zinc-800 text-zinc-400 hover:text-white'
            }`}
          >
            {tab.label}
            {tab.id === 'expiry' && (expiredBatches.length > 0 || expiringBatches.length > 0) && (
              <span className="ml-2 px-1.5 py-0.5 text-xs bg-red-500 text-white rounded">
                {expiredBatches.length + expiringBatches.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {activeSubTab === 'stock' && (
        <>
          {selectedWarehouse === 'all' ? (
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800">
                      <th className="text-left px-4 py-3 text-zinc-500 font-medium">Product</th>
                      <th className="text-left px-4 py-3 text-zinc-500 font-medium">SKU</th>
                      {data.warehouses.map(wh => (
                        <th key={wh.id} className="text-right px-4 py-3 text-zinc-500 font-medium">{wh.name}</th>
                      ))}
                      <th className="text-right px-4 py-3 text-zinc-500 font-medium">Total</th>
                      <th className="text-center px-4 py-3 text-zinc-500 font-medium">Earliest Expiry</th>
                      <th className="text-right px-4 py-3 text-zinc-500 font-medium">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.keys(getAllStock()).length === 0 ? (
                      <tr>
                        <td colSpan={data.warehouses.length + 5} className="px-4 py-8 text-center text-zinc-600">
                          No stock recorded yet. Use "Add Stock" or "Upload CSV" to add inventory.
                        </td>
                      </tr>
                    ) : (
                      Object.entries(getAllStock()).map(([sku, locs]) => {
                        const total = Object.values(locs).reduce((a, b) => a + b, 0);
                        const product = data.products.find(p => p.sku === sku);
                        const value = (product?.unitCost || 0) * total;
                        const earliestExpiry = getEarliestExpiry(sku);
                        const expiryStatus = getExpiryStatus(earliestExpiry);
                        return (
                          <tr key={sku} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                            <td className="px-4 py-3 text-zinc-200">{product?.name || '—'}</td>
                            <td className="px-4 py-3 text-zinc-500 text-xs">{sku}</td>
                            {data.warehouses.map(wh => (
                              <td key={wh.id} className="text-right px-4 py-3 text-zinc-400">{locs[wh.id] || '—'}</td>
                            ))}
                            <td className="text-right px-4 py-3 text-emerald-400 font-medium">{total}</td>
                            <td className="text-center px-4 py-3">
                              {earliestExpiry ? (
                                <span className={`text-xs px-2 py-0.5 rounded ${expiryStatus?.color || ''}`}>
                                  {new Date(earliestExpiry).toLocaleDateString('en-GB')}
                                </span>
                              ) : (
                                <span className="text-zinc-600 text-xs">—</span>
                              )}
                            </td>
                            <td className="text-right px-4 py-3 text-zinc-400">£{value.toFixed(2)}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800">
                    <th className="text-left px-4 py-3 text-zinc-500 font-medium">Product</th>
                    <th className="text-left px-4 py-3 text-zinc-500 font-medium">SKU</th>
                    <th className="text-right px-4 py-3 text-zinc-500 font-medium">Quantity</th>
                    <th className="text-center px-4 py-3 text-zinc-500 font-medium">Earliest Expiry</th>
                    <th className="text-right px-4 py-3 text-zinc-500 font-medium">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.keys(getStockForWarehouse(selectedWarehouse)).length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-zinc-600">
                        No stock in this warehouse. Use "Add Stock" or "Upload CSV" to add inventory.
                      </td>
                    </tr>
                  ) : (
                    Object.entries(getStockForWarehouse(selectedWarehouse)).map(([sku, qty]) => {
                      const product = data.products.find(p => p.sku === sku);
                      const value = (product?.unitCost || 0) * qty;
                      const earliestExpiry = getEarliestExpiry(sku, selectedWarehouse);
                      const expiryStatus = getExpiryStatus(earliestExpiry);
                      return (
                        <tr key={sku} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                          <td className="px-4 py-3 text-zinc-200">{product?.name || '—'}</td>
                          <td className="px-4 py-3 text-zinc-500 text-xs">{sku}</td>
                          <td className="text-right px-4 py-3 text-emerald-400 font-medium">{qty}</td>
                          <td className="text-center px-4 py-3">
                            {earliestExpiry ? (
                              <span className={`text-xs px-2 py-0.5 rounded ${expiryStatus?.color || ''}`}>
                                {new Date(earliestExpiry).toLocaleDateString('en-GB')}
                              </span>
                            ) : (
                              <span className="text-zinc-600 text-xs">—</span>
                            )}
                          </td>
                          <td className="text-right px-4 py-3 text-zinc-400">£{value.toFixed(2)}</td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {activeSubTab === 'expiry' && (
        <div className="space-y-6">
          {/* Summary cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-red-900/20 border border-red-900/50 rounded-lg p-4">
              <div className="text-2xl font-bold text-red-400">{expiredBatches.length}</div>
              <div className="text-xs text-zinc-500 mt-1">Expired Batches</div>
              <div className="text-xs text-red-400 mt-1">
                {expiredBatches.reduce((acc, b) => acc + b.remainingQty, 0)} units affected
              </div>
            </div>
            <div className="bg-emerald-900/20 border border-emerald-900/50 rounded-lg p-4">
              <div className="text-2xl font-bold text-emerald-400">
                {getBatches().filter(b => getExpiryStatus(b.expiryDate)?.status === 'critical').length}
              </div>
              <div className="text-xs text-zinc-500 mt-1">Expiring in 7 days</div>
            </div>
            <div className="bg-emerald-900/20 border border-emerald-900/50 rounded-lg p-4">
              <div className="text-2xl font-bold text-emerald-400">
                {getBatches().filter(b => getExpiryStatus(b.expiryDate)?.status === 'warning').length}
              </div>
              <div className="text-xs text-zinc-500 mt-1">Expiring in 30 days</div>
            </div>
          </div>

          {/* Expiring/Expired items list */}
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-800">
              <h3 className="text-sm font-medium text-zinc-400">Items Requiring Attention</h3>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800">
                  <th className="text-left px-4 py-3 text-zinc-500 font-medium">Product</th>
                  <th className="text-left px-4 py-3 text-zinc-500 font-medium">Warehouse</th>
                  <th className="text-right px-4 py-3 text-zinc-500 font-medium">Qty</th>
                  <th className="text-center px-4 py-3 text-zinc-500 font-medium">Expiry Date</th>
                  <th className="text-center px-4 py-3 text-zinc-500 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {getBatches()
                  .filter(b => {
                    const status = getExpiryStatus(b.expiryDate);
                    return status && (status.status === 'expired' || status.status === 'critical' || status.status === 'warning');
                  })
                  .sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate))
                  .map(batch => {
                    const product = data.products.find(p => p.sku === batch.sku);
                    const warehouse = data.warehouses.find(w => w.id === batch.warehouseId);
                    const expiryStatus = getExpiryStatus(batch.expiryDate);
                    return (
                      <tr key={batch.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                        <td className="px-4 py-3">
                          <div className="text-zinc-200">{product?.name || batch.sku}</div>
                          <div className="text-zinc-600 text-xs">{batch.sku}</div>
                        </td>
                        <td className="px-4 py-3 text-zinc-400">{warehouse?.name || batch.warehouseId}</td>
                        <td className="text-right px-4 py-3 text-zinc-300">{batch.remainingQty}</td>
                        <td className="text-center px-4 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded ${expiryStatus?.color || ''}`}>
                            {new Date(batch.expiryDate).toLocaleDateString('en-GB')}
                          </span>
                        </td>
                        <td className="text-center px-4 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded ${expiryStatus?.color || ''}`}>
                            {expiryStatus?.status === 'expired' ? 'EXPIRED' : expiryStatus?.label}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                {getBatches().filter(b => {
                  const status = getExpiryStatus(b.expiryDate);
                  return status && (status.status === 'expired' || status.status === 'critical' || status.status === 'warning');
                }).length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-zinc-600">
                      No items expiring soon
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeSubTab === 'batches' && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Product</th>
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Warehouse</th>
                <th className="text-right px-4 py-3 text-zinc-500 font-medium">Qty</th>
                <th className="text-center px-4 py-3 text-zinc-500 font-medium">Expiry</th>
                <th className="text-center px-4 py-3 text-zinc-500 font-medium">Received</th>
                <th className="text-center px-4 py-3 text-zinc-500 font-medium">Condition</th>
              </tr>
            </thead>
            <tbody>
              {getBatches().length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-zinc-600">No batch records</td>
                </tr>
              ) : (
                getBatches()
                  .sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt))
                  .map(batch => {
                    const product = data.products.find(p => p.sku === batch.sku);
                    const warehouse = data.warehouses.find(w => w.id === batch.warehouseId);
                    const expiryStatus = getExpiryStatus(batch.expiryDate);
                    return (
                      <tr key={batch.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                        <td className="px-4 py-3">
                          <div className="text-zinc-200">{product?.name || batch.sku}</div>
                          <div className="text-zinc-600 text-xs">{batch.sku}</div>
                        </td>
                        <td className="px-4 py-3 text-zinc-400">{warehouse?.name || batch.warehouseId}</td>
                        <td className="text-right px-4 py-3 text-zinc-300">{batch.remainingQty}</td>
                        <td className="text-center px-4 py-3">
                          {batch.expiryDate ? (
                            <span className={`text-xs px-2 py-0.5 rounded ${expiryStatus?.color || ''}`}>
                              {new Date(batch.expiryDate).toLocaleDateString('en-GB')}
                            </span>
                          ) : (
                            <span className="text-zinc-600 text-xs">—</span>
                          )}
                        </td>
                        <td className="text-center px-4 py-3 text-zinc-500 text-xs">
                          {new Date(batch.receivedAt).toLocaleDateString('en-GB')}
                        </td>
                        <td className="text-center px-4 py-3">
                          {batch.hasDamage ? (
                            <span className="text-xs bg-red-500/20 text-red-400 px-2 py-0.5 rounded" title={batch.damageNotes}>
                              Damaged
                            </span>
                          ) : (
                            <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded">
                              OK
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ============ REMOVE STOCK ============

function RemoveStock({ data, saveData }) {
  const [form, setForm] = useState({
    fromWarehouse: '',
    routeId: '',
    takenBy: '',
    notes: '',
    items: [{ sku: '', quantity: '' }]
  });
  const [warnings, setWarnings] = useState({});

  const availableStock = form.fromWarehouse ? (data.stock[form.fromWarehouse] || {}) : {};
  const routes = data.restockRoutes || [];
  const selectedRoute = routes.find(r => r.id === form.routeId);
  const isAdhocRoute = selectedRoute?.type === 'adhoc';

  // Get all locations in the selected route
  const getRouteLocations = () => {
    if (!selectedRoute) return [];
    if (isAdhocRoute) return [];
    return selectedRoute.locations.map(locId => data.locations.find(l => l.id === locId)).filter(Boolean);
  };

  // Get assigned products for all locations in route
  const getRouteAssignedProducts = () => {
    const routeLocations = getRouteLocations();
    if (routeLocations.length === 0) return null; // null means show all
    const allAssigned = new Set();
    routeLocations.forEach(loc => {
      (loc.assignedItems || []).forEach(sku => allAssigned.add(sku));
    });
    return allAssigned.size > 0 ? Array.from(allAssigned) : null;
  };

  // Calculate max capacity for a product across route locations
  const getRouteMaxCapacity = (sku) => {
    if (isAdhocRoute) return Infinity;
    const routeLocations = getRouteLocations();
    let totalMax = 0;
    routeLocations.forEach(loc => {
      const config = data.locationConfig?.[loc.id]?.[sku];
      if (config?.maxStock) {
        totalMax += config.maxStock;
      }
    });
    return totalMax;
  };

  // Calculate current stock at route locations
  const getRouteCurrentStock = (sku) => {
    if (isAdhocRoute) return 0;
    const routeLocations = getRouteLocations();
    let totalCurrent = 0;
    routeLocations.forEach(loc => {
      totalCurrent += data.locationStock?.[loc.id]?.[sku] || 0;
    });
    return totalCurrent;
  };

  // Calculate available space in route locations
  const getRouteAvailableSpace = (sku) => {
    const maxCapacity = getRouteMaxCapacity(sku);
    if (maxCapacity === 0) return Infinity; // No max configured
    const currentStock = getRouteCurrentStock(sku);
    return Math.max(0, maxCapacity - currentStock);
  };

  const addItem = () => setForm({ ...form, items: [...form.items, { sku: '', quantity: '' }] });

  const updateItem = (idx, field, value) => {
    const items = [...form.items];
    items[idx][field] = value;
    setForm({ ...form, items });

    // Check capacity warning when quantity changes
    if (field === 'quantity' || field === 'sku') {
      const sku = field === 'sku' ? value : items[idx].sku;
      const qty = field === 'quantity' ? parseInt(value) || 0 : parseInt(items[idx].quantity) || 0;
      
      if (sku && qty > 0 && !isAdhocRoute) {
        const availableSpace = getRouteAvailableSpace(sku);
        if (availableSpace !== Infinity && qty > availableSpace) {
          setWarnings(prev => ({ ...prev, [idx]: { sku, qty, availableSpace, maxCapacity: getRouteMaxCapacity(sku) } }));
        } else {
          setWarnings(prev => {
            const newWarnings = { ...prev };
            delete newWarnings[idx];
            return newWarnings;
          });
        }
      } else {
        setWarnings(prev => {
          const newWarnings = { ...prev };
          delete newWarnings[idx];
          return newWarnings;
        });
      }
    }
  };

  const removeItem = (idx) => {
    if (form.items.length > 1) {
      setForm({ ...form, items: form.items.filter((_, i) => i !== idx) });
      setWarnings(prev => {
        const newWarnings = { ...prev };
        delete newWarnings[idx];
        return newWarnings;
      });
    }
  };

  const submit = () => {
    if (!form.fromWarehouse || !form.routeId || !form.takenBy || !form.items[0].sku) return;

    const newStock = { ...data.stock };
    const newRemovals = [...data.removals];
    const newRestocks = [...data.restocks];
    const newLocationStock = { ...data.locationStock };
    const timestamp = new Date().toISOString();

    // For adhoc routes, don't update location stock
    // For regular routes, distribute to first location (simplified)
    const routeLocations = getRouteLocations();
    const targetLocation = routeLocations[0]?.id || form.routeId;

    if (!isAdhocRoute && targetLocation) {
      if (!newLocationStock[targetLocation]) newLocationStock[targetLocation] = {};
    }

    form.items.filter(i => i.sku && i.quantity > 0).forEach(item => {
      const currentQty = newStock[form.fromWarehouse]?.[item.sku] || 0;
      const removeQty = Math.min(parseInt(item.quantity), currentQty);

      if (removeQty > 0) {
        newStock[form.fromWarehouse][item.sku] = currentQty - removeQty;
        
        // Only update location stock for non-adhoc routes
        if (!isAdhocRoute && targetLocation) {
          newLocationStock[targetLocation][item.sku] = (newLocationStock[targetLocation][item.sku] || 0) + removeQty;
        }

        newRemovals.push({
          sku: item.sku,
          quantity: removeQty,
          fromLocation: form.fromWarehouse,
          toLocation: form.routeId,
          routeName: selectedRoute?.name,
          takenBy: form.takenBy,
          notes: form.notes,
          isAdhoc: isAdhocRoute,
          timestamp
        });

        if (!isAdhocRoute) {
          newRestocks.push({
            sku: item.sku,
            quantity: removeQty,
            location: targetLocation,
            routeId: form.routeId,
            routeName: selectedRoute?.name,
            source: form.fromWarehouse,
            takenBy: form.takenBy,
            timestamp
          });
        }
      }
    });

    saveData({ ...data, stock: newStock, removals: newRemovals, restocks: newRestocks, locationStock: isAdhocRoute ? data.locationStock : newLocationStock });
    setForm({ fromWarehouse: '', routeId: '', takenBy: '', notes: '', items: [{ sku: '', quantity: '' }] });
    setWarnings({});
  };

  const getAvailableProducts = () => {
    const stockItems = Object.entries(availableStock).filter(([_, q]) => q > 0);
    const assignedProducts = getRouteAssignedProducts();
    if (!assignedProducts) return stockItems;
    return stockItems.filter(([sku]) => assignedProducts.includes(sku));
  };

  const hasWarnings = Object.keys(warnings).length > 0;

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">Remove Stock</h2>

      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs text-zinc-500 mb-1">From Warehouse</label>
            <select
              value={form.fromWarehouse}
              onChange={e => { setForm({ ...form, fromWarehouse: e.target.value, items: [{ sku: '', quantity: '' }] }); setWarnings({}); }}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
            >
              <option value="">Select warehouse</option>
              {data.warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Re-stock Route</label>
            <select
              value={form.routeId}
              onChange={e => { setForm({ ...form, routeId: e.target.value, items: [{ sku: '', quantity: '' }] }); setWarnings({}); }}
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
            >
              <option value="">Select route</option>
              <optgroup label="Restock Routes">
                {routes.filter(r => r.type !== 'adhoc').map(r => (
                  <option key={r.id} value={r.id}>{r.name} ({r.locations?.length || 0} locations)</option>
                ))}
              </optgroup>
              <optgroup label="Ad-hoc">
                {routes.filter(r => r.type === 'adhoc').map(r => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </optgroup>
            </select>
          </div>
          <div>
            <label className="block text-xs text-zinc-500 mb-1">Taken By</label>
            <input
              type="text"
              value={form.takenBy}
              onChange={e => setForm({ ...form, takenBy: e.target.value })}
              placeholder="Name"
              className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
            />
          </div>
          {isAdhocRoute && (
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Notes (optional)</label>
              <input
                type="text"
                value={form.notes}
                onChange={e => setForm({ ...form, notes: e.target.value })}
                placeholder="Reason for removal"
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
              />
            </div>
          )}
        </div>

        {/* Show route details */}
        {selectedRoute && !isAdhocRoute && (
          <div className="text-xs text-zinc-500 bg-zinc-800/50 px-3 py-2 rounded">
            <span className="text-zinc-400">Route locations:</span> {getRouteLocations().map(l => l.name).join(' → ') || 'None configured'}
          </div>
        )}

        {isAdhocRoute && (
          <div className="text-xs text-emerald-400 bg-emerald-500/10 px-3 py-2 rounded">
            Ad-hoc removal — stock will be removed from warehouse but not added to any location
          </div>
        )}

        {form.fromWarehouse && form.routeId && (
          <>
            <div>
              <label className="block text-xs text-zinc-500 mb-2">Items to Remove</label>
              <div className="space-y-2">
                {form.items.map((item, idx) => {
                  const warning = warnings[idx];
                  const product = data.products.find(p => p.sku === item.sku);
                  return (
                    <div key={idx}>
                      <div className="flex gap-2">
                        <select
                          value={item.sku}
                          onChange={e => updateItem(idx, 'sku', e.target.value)}
                          className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
                        >
                          <option value="">Select product</option>
                          {getAvailableProducts().map(([sku, qty]) => {
                            const prod = data.products.find(p => p.sku === sku);
                            return <option key={sku} value={sku}>{prod?.name || sku} (avail: {qty})</option>;
                          })}
                        </select>
                        <input
                          type="number"
                          placeholder="Qty"
                          value={item.quantity}
                          onChange={e => updateItem(idx, 'quantity', e.target.value)}
                          max={availableStock[item.sku] || 0}
                          className={`w-24 bg-zinc-800 border rounded px-3 py-2 text-sm focus:outline-none ${
                            warning ? 'border-emerald-500' : 'border-zinc-700 focus:border-emerald-500'
                          }`}
                        />
                        <button onClick={() => removeItem(idx)} className="px-3 py-2 text-zinc-500 hover:text-red-400">×</button>
                      </div>
                      {warning && (
                        <div className="mt-1 ml-1 text-xs text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded">
                          ⚠ Quantity ({warning.qty}) exceeds available space ({warning.availableSpace}) on this route. 
                          Max capacity: {warning.maxCapacity} units for {product?.name || warning.sku}.
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <button onClick={addItem} className="mt-2 text-sm text-emerald-400 hover:text-emerald-300">+ Add item</button>
            </div>
          </>
        )}

        {hasWarnings && (
          <div className="bg-emerald-900/20 border border-emerald-900/50 rounded-lg p-4">
            <div className="text-emerald-400 text-sm font-medium mb-1">⚠ Capacity Warning</div>
            <p className="text-zinc-400 text-xs">
              One or more items exceed the maximum capacity configured for locations on this route. 
              You can still proceed, but the vending machines may not have space for all items.
            </p>
          </div>
        )}

        <button
          onClick={submit}
          disabled={!form.fromWarehouse || !form.routeId || !form.takenBy}
          className="px-4 py-2 bg-red-600 text-white rounded text-sm font-medium hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Confirm Removal
        </button>
      </div>
    </div>
  );
}

// ============ RESTOCK MACHINE ============

function RestockMachine({ data, saveData }) {
  const [activeSubTab, setActiveSubTab] = useState('restock');
  const [step, setStep] = useState('select'); // select, stockcheck, addstock, complete
  const [selectedLocation, setSelectedLocation] = useState('');
  const [restockerName, setRestockerName] = useState('');
  const [stockCheckCounts, setStockCheckCounts] = useState({});
  const [stockCheckComplete, setStockCheckComplete] = useState(false);
  const [stockCheckId, setStockCheckId] = useState(null);
  const [restockItems, setRestockItems] = useState([{ sku: '', quantity: '' }]);
  const [uploadedImage, setUploadedImage] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [viewingRestock, setViewingRestock] = useState(null);

  const location = data.locations.find(l => l.id === selectedLocation);
  const locationStock = data.locationStock[selectedLocation] || {};
  const locationConfig = data.locationConfig[selectedLocation] || {};
  const machineRestocks = data.machineRestocks || [];
  const stockChecks = data.stockChecks || [];

  // Get products assigned to this location
  const getLocationProducts = () => {
    if (!location) return [];
    if (location.assignedItems?.length > 0) {
      return data.products.filter(p => location.assignedItems.includes(p.sku));
    }
    return data.products;
  };

  // Check if location has a recent valid stock check (within last 24 hours)
  const hasValidStockCheck = () => {
    if (!selectedLocation) return false;
    const recentCheck = stockChecks
      .filter(sc => sc.locationId === selectedLocation)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];
    
    if (!recentCheck) return false;
    
    const hoursSince = (Date.now() - new Date(recentCheck.timestamp).getTime()) / (1000 * 60 * 60);
    return hoursSince < 24;
  };

  // Initialize stock check with expected values
  const startStockCheck = () => {
    const counts = {};
    getLocationProducts().forEach(p => {
      counts[p.sku] = { counted: '', expected: locationStock[p.sku] || 0 };
    });
    setStockCheckCounts(counts);
    setStep('stockcheck');
  };

  // Complete stock check
  const completeStockCheck = () => {
    const checkId = `sc-${Date.now()}`;
    const items = Object.entries(stockCheckCounts).map(([sku, data]) => ({
      sku,
      expected: data.expected,
      counted: parseInt(data.counted) || 0,
      variance: (parseInt(data.counted) || 0) - data.expected
    }));

    const stockCheck = {
      id: checkId,
      locationId: selectedLocation,
      locationName: location?.name,
      checkedBy: restockerName,
      timestamp: new Date().toISOString(),
      items,
      totalVariance: items.reduce((acc, i) => acc + Math.abs(i.variance), 0)
    };

    // Update locationStock with actual counted values
    const newLocationStock = { ...data.locationStock };
    if (!newLocationStock[selectedLocation]) newLocationStock[selectedLocation] = {};
    items.forEach(item => {
      newLocationStock[selectedLocation][item.sku] = item.counted;
    });

    saveData({
      ...data,
      stockChecks: [...stockChecks, stockCheck],
      locationStock: newLocationStock
    });

    setStockCheckId(checkId);
    setStockCheckComplete(true);
    setStep('addstock');
  };

  // Skip stock check (use existing valid one)
  const skipStockCheck = () => {
    const recentCheck = stockChecks
      .filter(sc => sc.locationId === selectedLocation)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];
    
    setStockCheckId(recentCheck?.id);
    setStockCheckComplete(true);
    setStep('addstock');
  };

  // Handle image upload
  const handleImageUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      setUploadedImage(ev.target?.result);
      setImagePreview(ev.target?.result);
    };
    reader.readAsDataURL(file);
  };

  // Add/update restock items
  const addRestockItem = () => setRestockItems([...restockItems, { sku: '', quantity: '' }]);
  
  const updateRestockItem = (idx, field, value) => {
    const items = [...restockItems];
    items[idx][field] = value;
    setRestockItems(items);
  };

  const removeRestockItem = (idx) => {
    if (restockItems.length > 1) {
      setRestockItems(restockItems.filter((_, i) => i !== idx));
    }
  };

  // Complete restock
  const completeRestock = (override = false) => {
    if (!override && !uploadedImage) return;

    const validItems = restockItems.filter(i => i.sku && parseInt(i.quantity) > 0);
    
    const restock = {
      id: `mr-${Date.now()}`,
      locationId: selectedLocation,
      locationName: location?.name,
      restockerName,
      stockCheckId,
      timestamp: new Date().toISOString(),
      items: validItems.map(i => ({
        sku: i.sku,
        quantity: parseInt(i.quantity),
        productName: data.products.find(p => p.sku === i.sku)?.name || i.sku
      })),
      image: uploadedImage,
      imageOverride: override && !uploadedImage
    };

    // Update location stock
    const newLocationStock = { ...data.locationStock };
    if (!newLocationStock[selectedLocation]) newLocationStock[selectedLocation] = {};
    validItems.forEach(item => {
      newLocationStock[selectedLocation][item.sku] = 
        (newLocationStock[selectedLocation][item.sku] || 0) + parseInt(item.quantity);
    });

    saveData({
      ...data,
      machineRestocks: [...machineRestocks, restock],
      locationStock: newLocationStock
    });

    // Reset form
    setStep('complete');
  };

  // Reset everything
  const resetForm = () => {
    setStep('select');
    setSelectedLocation('');
    setRestockerName('');
    setStockCheckCounts({});
    setStockCheckComplete(false);
    setStockCheckId(null);
    setRestockItems([{ sku: '', quantity: '' }]);
    setUploadedImage(null);
    setImagePreview(null);
  };

  const getProductName = (sku) => data.products.find(p => p.sku === sku)?.name || sku;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Restock Machine</h2>
          <p className="text-zinc-500 text-sm mt-1">Complete stock check and add items to vending machines</p>
        </div>
      </div>

      <div className="flex gap-2 border-b border-zinc-800 pb-4">
        {[
          { id: 'restock', label: 'Add Stock' },
          { id: 'history', label: 'Restock History' },
          { id: 'checks', label: 'Stock Check History' }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => { setActiveSubTab(tab.id); if (tab.id === 'restock') resetForm(); }}
            className={`px-4 py-2 rounded text-sm transition-colors ${
              activeSubTab === tab.id ? 'bg-emerald-500 text-zinc-900' : 'bg-zinc-800 text-zinc-400 hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeSubTab === 'restock' && (
        <>
          {/* Step indicator */}
          <div className="flex items-center gap-2 text-sm">
            <span className={`px-3 py-1 rounded ${step === 'select' ? 'bg-emerald-500 text-zinc-900' : 'bg-zinc-800 text-zinc-400'}`}>
              1. Select Location
            </span>
            <span className="text-zinc-600">→</span>
            <span className={`px-3 py-1 rounded ${step === 'stockcheck' ? 'bg-emerald-500 text-zinc-900' : 'bg-zinc-800 text-zinc-400'}`}>
              2. Stock Check
            </span>
            <span className="text-zinc-600">→</span>
            <span className={`px-3 py-1 rounded ${step === 'addstock' ? 'bg-emerald-500 text-zinc-900' : 'bg-zinc-800 text-zinc-400'}`}>
              3. Add Stock
            </span>
            <span className="text-zinc-600">→</span>
            <span className={`px-3 py-1 rounded ${step === 'complete' ? 'bg-emerald-500 text-zinc-900' : 'bg-zinc-800 text-zinc-400'}`}>
              4. Complete
            </span>
          </div>

          {/* Step 1: Select Location */}
          {step === 'select' && (
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 space-y-4">
              <h3 className="font-medium text-zinc-200">Select Location & Restocker</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-zinc-500 mb-1">Restocker Name *</label>
                  <input
                    type="text"
                    value={restockerName}
                    onChange={e => setRestockerName(e.target.value)}
                    placeholder="Your name"
                    className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-500 mb-1">Location *</label>
                  <select
                    value={selectedLocation}
                    onChange={e => setSelectedLocation(e.target.value)}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
                  >
                    <option value="">Select location</option>
                    {data.locations.map(l => (
                      <option key={l.id} value={l.id}>{l.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {selectedLocation && (
                <div className="bg-zinc-800/50 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-zinc-400 text-sm">Current expected stock:</span>
                    {hasValidStockCheck() && (
                      <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded">
                        Recent stock check available
                      </span>
                    )}
                  </div>
                  <div className="text-zinc-300 text-sm">
                    {Object.keys(locationStock).length === 0 ? (
                      <span className="text-zinc-600">No stock recorded</span>
                    ) : (
                      <span>{Object.values(locationStock).reduce((a, b) => a + b, 0)} units across {Object.keys(locationStock).length} products</span>
                    )}
                  </div>
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={startStockCheck}
                  disabled={!selectedLocation || !restockerName}
                  className="px-4 py-2 bg-emerald-500 text-zinc-900 rounded text-sm font-medium hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Start Stock Check
                </button>
                {hasValidStockCheck() && (
                  <button
                    onClick={skipStockCheck}
                    disabled={!selectedLocation || !restockerName}
                    className="px-4 py-2 bg-zinc-700 text-zinc-300 rounded text-sm font-medium hover:bg-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Skip (Use Recent Check)
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Step 2: Stock Check */}
          {step === 'stockcheck' && (
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-medium text-zinc-200">Stock Check: {location?.name}</h3>
                <button onClick={() => setStep('select')} className="text-zinc-500 hover:text-zinc-300 text-sm">
                  ← Back
                </button>
              </div>

              <p className="text-zinc-500 text-sm">
                Count each product in the machine and enter the actual quantity found.
              </p>

              <div className="space-y-2">
                <div className="grid grid-cols-12 gap-2 text-xs text-zinc-500 font-medium px-2">
                  <div className="col-span-5">Product</div>
                  <div className="col-span-2 text-center">Expected</div>
                  <div className="col-span-2 text-center">Counted</div>
                  <div className="col-span-3 text-center">Variance</div>
                </div>

                {getLocationProducts().map(product => {
                  const counts = stockCheckCounts[product.sku] || { counted: '', expected: 0 };
                  const counted = parseInt(counts.counted) || 0;
                  const variance = counted - counts.expected;
                  return (
                    <div key={product.sku} className="grid grid-cols-12 gap-2 items-center py-2 border-b border-zinc-800 last:border-0">
                      <div className="col-span-5">
                        <span className="text-zinc-200">{product.name}</span>
                        <div className="text-zinc-600 text-xs">{product.sku}</div>
                      </div>
                      <div className="col-span-2 text-center text-zinc-400">
                        {counts.expected}
                      </div>
                      <div className="col-span-2">
                        <input
                          type="number"
                          value={counts.counted}
                          onChange={e => setStockCheckCounts({
                            ...stockCheckCounts,
                            [product.sku]: { ...counts, counted: e.target.value }
                          })}
                          placeholder="0"
                          className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-sm text-center focus:outline-none focus:border-emerald-500"
                        />
                      </div>
                      <div className="col-span-3 text-center">
                        {counts.counted !== '' && (
                          <span className={`text-sm font-medium ${
                            variance === 0 ? 'text-emerald-400' : variance > 0 ? 'text-blue-400' : 'text-red-400'
                          }`}>
                            {variance > 0 ? '+' : ''}{variance}
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <button
                onClick={completeStockCheck}
                disabled={Object.values(stockCheckCounts).some(c => c.counted === '')}
                className="px-4 py-2 bg-emerald-600 text-white rounded text-sm font-medium hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Complete Stock Check
              </button>
            </div>
          )}

          {/* Step 3: Add Stock */}
          {step === 'addstock' && (
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-medium text-zinc-200">Add Stock: {location?.name}</h3>
                <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2 py-1 rounded">
                  ✓ Stock check complete
                </span>
              </div>

              <p className="text-zinc-500 text-sm">
                Enter the items and quantities you're placing into the machine.
              </p>

              <div className="space-y-2">
                <div className="grid grid-cols-12 gap-2 text-xs text-zinc-500 font-medium px-2">
                  <div className="col-span-6">Product</div>
                  <div className="col-span-2 text-center">Current</div>
                  <div className="col-span-2 text-center">Adding</div>
                  <div className="col-span-2"></div>
                </div>

                {restockItems.map((item, idx) => {
                  const currentStock = item.sku ? (data.locationStock[selectedLocation]?.[item.sku] || 0) : 0;
                  const config = item.sku ? (locationConfig[item.sku] || {}) : {};
                  return (
                    <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                      <div className="col-span-6">
                        <select
                          value={item.sku}
                          onChange={e => updateRestockItem(idx, 'sku', e.target.value)}
                          className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
                        >
                          <option value="">Select product</option>
                          {getLocationProducts().map(p => (
                            <option key={p.sku} value={p.sku}>{p.name}</option>
                          ))}
                        </select>
                      </div>
                      <div className="col-span-2 text-center text-zinc-400 text-sm">
                        {item.sku ? currentStock : '—'}
                        {config.maxStock && (
                          <span className="text-zinc-600">/{config.maxStock}</span>
                        )}
                      </div>
                      <div className="col-span-2">
                        <input
                          type="number"
                          value={item.quantity}
                          onChange={e => updateRestockItem(idx, 'quantity', e.target.value)}
                          placeholder="Qty"
                          className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-2 text-sm text-center focus:outline-none focus:border-emerald-500"
                        />
                      </div>
                      <div className="col-span-2 text-right">
                        <button 
                          onClick={() => removeRestockItem(idx)} 
                          className="text-zinc-500 hover:text-red-400 px-2"
                        >×</button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <button onClick={addRestockItem} className="text-sm text-emerald-400 hover:text-emerald-300">
                + Add item
              </button>

              {/* Image upload */}
              <div className="border-t border-zinc-800 pt-4 mt-4">
                <label className="block text-xs text-zinc-500 mb-2">
                  Photo of Restocked Machine <span className="text-emerald-400">*</span>
                </label>
                <div className="flex gap-4 items-start">
                  <label className={`px-4 py-2 rounded text-sm font-medium cursor-pointer transition-colors ${
                    uploadedImage ? 'bg-emerald-600 text-white' : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
                  }`}>
                    {uploadedImage ? '✓ Photo Uploaded' : 'Upload Photo'}
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      onChange={handleImageUpload}
                      className="hidden"
                    />
                  </label>
                  {imagePreview && (
                    <div className="relative">
                      <img 
                        src={imagePreview} 
                        alt="Preview" 
                        className="w-24 h-24 object-cover rounded border border-zinc-700"
                      />
                      <button
                        onClick={() => { setUploadedImage(null); setImagePreview(null); }}
                        className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full text-xs"
                      >×</button>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  onClick={() => completeRestock(false)}
                  disabled={!uploadedImage || restockItems.every(i => !i.sku || !i.quantity)}
                  className="px-4 py-2 bg-emerald-600 text-white rounded text-sm font-medium hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Complete Restock
                </button>
                <button
                  onClick={() => completeRestock(true)}
                  disabled={restockItems.every(i => !i.sku || !i.quantity)}
                  className="px-4 py-2 bg-zinc-800 text-zinc-400 rounded text-sm hover:text-zinc-300 hover:bg-zinc-700 disabled:opacity-50"
                >
                  Override (Skip Photo)
                </button>
              </div>
            </div>
          )}

          {/* Step 4: Complete */}
          {step === 'complete' && (
            <div className="bg-emerald-900/20 border border-emerald-900/50 rounded-lg p-8 text-center space-y-4">
              <div className="text-4xl">✓</div>
              <h3 className="text-xl font-medium text-emerald-400">Restock Complete!</h3>
              <p className="text-zinc-400">
                {location?.name} has been restocked by {restockerName}
              </p>
              <button
                onClick={resetForm}
                className="px-4 py-2 bg-emerald-600 text-white rounded text-sm font-medium hover:bg-emerald-500"
              >
                Start Another Restock
              </button>
            </div>
          )}
        </>
      )}

      {/* History Tab */}
      {activeSubTab === 'history' && (
        <div className="space-y-4">
          {viewingRestock ? (
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-medium text-zinc-200">Restock Details</h3>
                <button onClick={() => setViewingRestock(null)} className="text-zinc-500 hover:text-zinc-300 text-sm">
                  ← Back to list
                </button>
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-zinc-500">Location:</span>
                  <span className="text-zinc-200 ml-2">{viewingRestock.locationName}</span>
                </div>
                <div>
                  <span className="text-zinc-500">Restocked by:</span>
                  <span className="text-zinc-200 ml-2">{viewingRestock.restockerName}</span>
                </div>
                <div>
                  <span className="text-zinc-500">Date:</span>
                  <span className="text-zinc-200 ml-2">
                    {new Date(viewingRestock.timestamp).toLocaleString('en-GB')}
                  </span>
                </div>
                <div>
                  <span className="text-zinc-500">Photo:</span>
                  {viewingRestock.imageOverride ? (
                    <span className="text-emerald-400 ml-2">Overridden (no photo)</span>
                  ) : viewingRestock.image ? (
                    <span className="text-emerald-400 ml-2">✓ Included</span>
                  ) : (
                    <span className="text-zinc-600 ml-2">None</span>
                  )}
                </div>
              </div>

              <div className="border-t border-zinc-800 pt-4">
                <h4 className="text-sm font-medium text-zinc-400 mb-3">Items Restocked</h4>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-zinc-800">
                      <th className="text-left py-2 text-zinc-500 font-medium">Product</th>
                      <th className="text-right py-2 text-zinc-500 font-medium">Quantity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {viewingRestock.items.map((item, idx) => (
                      <tr key={idx} className="border-b border-zinc-800/50">
                        <td className="py-2 text-zinc-200">{item.productName}</td>
                        <td className="text-right py-2 text-emerald-400">+{item.quantity}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {viewingRestock.image && (
                <div className="border-t border-zinc-800 pt-4">
                  <h4 className="text-sm font-medium text-zinc-400 mb-3">Machine Photo</h4>
                  <img 
                    src={viewingRestock.image} 
                    alt="Restocked machine" 
                    className="max-w-full max-h-96 rounded border border-zinc-700"
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-zinc-800">
                    <th className="text-left px-4 py-3 text-zinc-500 font-medium">Date</th>
                    <th className="text-left px-4 py-3 text-zinc-500 font-medium">Location</th>
                    <th className="text-left px-4 py-3 text-zinc-500 font-medium">Restocked By</th>
                    <th className="text-right px-4 py-3 text-zinc-500 font-medium">Items</th>
                    <th className="text-center px-4 py-3 text-zinc-500 font-medium">Photo</th>
                    <th className="text-right px-4 py-3 text-zinc-500 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {machineRestocks.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-zinc-600">
                        No restocks recorded yet
                      </td>
                    </tr>
                  ) : (
                    machineRestocks.slice().reverse().map(restock => (
                      <tr key={restock.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                        <td className="px-4 py-3 text-zinc-400 text-xs">
                          {new Date(restock.timestamp).toLocaleDateString('en-GB')}
                          <div className="text-zinc-600">
                            {new Date(restock.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-zinc-200">{restock.locationName}</td>
                        <td className="px-4 py-3 text-zinc-400">{restock.restockerName}</td>
                        <td className="text-right px-4 py-3 text-emerald-400">
                          +{restock.items.reduce((acc, i) => acc + i.quantity, 0)}
                        </td>
                        <td className="text-center px-4 py-3">
                          {restock.imageOverride ? (
                            <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded">Override</span>
                          ) : restock.image ? (
                            <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded">✓</span>
                          ) : (
                            <span className="text-zinc-600">—</span>
                          )}
                        </td>
                        <td className="text-right px-4 py-3">
                          <button
                            onClick={() => setViewingRestock(restock)}
                            className="text-emerald-400 hover:text-emerald-300 text-sm"
                          >
                            View
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Stock Check History Tab */}
      {activeSubTab === 'checks' && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Date</th>
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Location</th>
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Checked By</th>
                <th className="text-right px-4 py-3 text-zinc-500 font-medium">Products</th>
                <th className="text-right px-4 py-3 text-zinc-500 font-medium">Total Variance</th>
              </tr>
            </thead>
            <tbody>
              {stockChecks.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-zinc-600">
                    No stock checks recorded yet
                  </td>
                </tr>
              ) : (
                stockChecks.slice().reverse().map(check => (
                  <tr key={check.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                    <td className="px-4 py-3 text-zinc-400 text-xs">
                      {new Date(check.timestamp).toLocaleDateString('en-GB')}
                      <div className="text-zinc-600">
                        {new Date(check.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-zinc-200">{check.locationName}</td>
                    <td className="px-4 py-3 text-zinc-400">{check.checkedBy}</td>
                    <td className="text-right px-4 py-3 text-zinc-300">{check.items.length}</td>
                    <td className="text-right px-4 py-3">
                      <span className={`${check.totalVariance === 0 ? 'text-emerald-400' : 'text-emerald-400'}`}>
                        {check.totalVariance === 0 ? '✓ Match' : `±${check.totalVariance}`}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ============ HISTORY ============

function History({ data }) {
  const [tab, setTab] = useState('removals');

  const getWarehouseName = (id) => data.warehouses.find(w => w.id === id)?.name || id;
  const getLocationName = (id) => data.locations.find(l => l.id === id)?.name || id;
  const getRouteName = (id) => {
    const route = (data.restockRoutes || []).find(r => r.id === id);
    return route?.name || getLocationName(id);
  };
  const getProductName = (sku) => data.products.find(p => p.sku === sku)?.name || sku;

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">History</h2>

      <div className="flex gap-2">
        <button onClick={() => setTab('removals')} className={`px-4 py-2 rounded text-sm ${tab === 'removals' ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white'}`}>
          Stock Removals
        </button>
        <button onClick={() => setTab('restocks')} className={`px-4 py-2 rounded text-sm ${tab === 'restocks' ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white'}`}>
          Restocks
        </button>
      </div>

      {tab === 'removals' && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Date</th>
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Product</th>
                <th className="text-right px-4 py-3 text-zinc-500 font-medium">Qty</th>
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">From → Route</th>
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">By</th>
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Type</th>
              </tr>
            </thead>
            <tbody>
              {data.removals.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-zinc-600">No removals yet</td></tr>
              ) : (
                data.removals.slice().reverse().map((r, i) => (
                  <tr key={i} className="border-b border-zinc-800/50">
                    <td className="px-4 py-3 text-zinc-500 text-xs">{new Date(r.timestamp).toLocaleDateString('en-GB')}</td>
                    <td className="px-4 py-3 text-zinc-200">{getProductName(r.sku)}</td>
                    <td className="text-right px-4 py-3 text-red-400">-{r.quantity}</td>
                    <td className="px-4 py-3 text-zinc-400 text-xs">
                      {getWarehouseName(r.fromLocation)} → {r.routeName || getRouteName(r.toLocation)}
                      {r.notes && <div className="text-zinc-600 mt-0.5">{r.notes}</div>}
                    </td>
                    <td className="px-4 py-3 text-zinc-500">{r.takenBy}</td>
                    <td className="px-4 py-3">
                      {r.isAdhoc ? (
                        <span className="text-xs bg-purple-500/20 text-purple-400 px-2 py-0.5 rounded">Ad-hoc</span>
                      ) : (
                        <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded">Restock</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'restocks' && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-800">
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Date</th>
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Product</th>
                <th className="text-right px-4 py-3 text-zinc-500 font-medium">Qty</th>
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">Route / Location</th>
                <th className="text-left px-4 py-3 text-zinc-500 font-medium">By</th>
              </tr>
            </thead>
            <tbody>
              {data.restocks.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-zinc-600">No restocks yet</td></tr>
              ) : (
                data.restocks.slice().reverse().map((r, i) => (
                  <tr key={i} className="border-b border-zinc-800/50">
                    <td className="px-4 py-3 text-zinc-500 text-xs">{new Date(r.timestamp).toLocaleDateString('en-GB')}</td>
                    <td className="px-4 py-3 text-zinc-200">{getProductName(r.sku)}</td>
                    <td className="text-right px-4 py-3 text-emerald-400">+{r.quantity}</td>
                    <td className="px-4 py-3 text-zinc-400">
                      {r.routeName && <span className="text-emerald-400">{r.routeName}</span>}
                      {r.routeName && ' → '}
                      {getLocationName(r.location)}
                    </td>
                    <td className="px-4 py-3 text-zinc-500">{r.takenBy}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ============ ADMIN SECTION ============

function Admin({ data, saveData }) {
  const [adminTab, setAdminTab] = useState('products');

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold">Admin</h2>

      <div className="flex gap-2 border-b border-zinc-800 pb-4 flex-wrap">
        {[
          { id: 'products', label: 'Products' },
          { id: 'warehouses', label: 'Warehouses' },
          { id: 'locations', label: 'Locations' },
          { id: 'routes', label: 'Restock Routes' },
          { id: 'suppliers', label: 'Suppliers' },
          { id: 'data', label: 'Data Management' },
          { id: 'guide', label: '📖 System Guide' }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setAdminTab(tab.id)}
            className={`px-4 py-2 rounded text-sm transition-colors ${
              adminTab === tab.id ? 'bg-emerald-500 text-zinc-900' : 'bg-zinc-800 text-zinc-400 hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {adminTab === 'products' && <AdminProducts data={data} saveData={saveData} />}
      {adminTab === 'warehouses' && <AdminWarehouses data={data} saveData={saveData} />}
      {adminTab === 'locations' && <AdminLocations data={data} saveData={saveData} />}
      {adminTab === 'routes' && <AdminRoutes data={data} saveData={saveData} />}
      {adminTab === 'suppliers' && <AdminSuppliers data={data} saveData={saveData} />}
      {adminTab === 'data' && <AdminData data={data} saveData={saveData} />}
      {adminTab === 'guide' && <AdminSystemGuide />}
    </div>
  );
}

function AdminSystemGuide() {
  const [expandedSection, setExpandedSection] = useState('overview');

  const sections = [
    {
      id: 'overview',
      title: 'System Overview',
      icon: '🏠',
      content: `
**Hatch Stock Management System** is an integrated inventory and operations platform designed for managing stock across warehouses, vending locations, and sales channels.

### Core Purpose
- Track inventory from warehouse receipt to point of sale
- Automate restock decisions based on configurable thresholds
- Provide real-time visibility into stock levels, sales performance, and expiry dates
- Streamline ordering with AI-powered invoice processing

### Architecture
The system uses a **single source of truth** data model where all components read from and write to a unified state. This ensures consistency across all views and eliminates data synchronisation issues.

### Data Persistence
All data is automatically saved to cloud storage after every change. The sync indicator in the header shows:
- ✓ **Saved** - All changes persisted
- ↻ **Saving** - Write in progress
- ✗ **Error** - Save failed (retry automatically)
- ○ **Offline** - Storage unavailable
      `
    },
    {
      id: 'data-model',
      title: 'Data Model & Entities',
      icon: '🗄️',
      content: `
### Products (SKU as Primary Key)
Every product is uniquely identified by its **SKU**. This is the single source of truth for matching products across:
- Warehouse stock records
- Location stock records
- Sales transactions
- Purchase orders
- CSV imports

**Product Fields:**
| Field | Purpose |
|-------|---------|
| SKU | Unique identifier (e.g., "BB-MILK-CHOC-001") |
| Name | Display name |
| Category | Meals, Drinks, Snacks, Breakfast, Other |
| Unit Cost | Purchase price per unit |
| Sale Price | Retail price per unit |

### Warehouses
Central storage facilities where bulk stock is held before distribution.

### Locations
End points where products are sold (vending machines, fridges, retail spots). Each location can have:
- **Assigned Items** - Specific products available at this location
- **Stock Levels** - Current quantity of each product
- **Min/Max Thresholds** - For automated restock suggestions

### Suppliers
Vendor records for purchase order management.

### Stock Batches
Individual receipt records with expiry tracking. Enables FIFO (First In, First Out) inventory management.
      `
    },
    {
      id: 'flow-warehouse',
      title: 'Warehouse Flow',
      icon: '📦',
      content: `
### Stock Entry Points

**1. Purchase Orders → Receive Stock**
\`\`\`
Create Order → Order Pending → Receive Stock → Warehouse Inventory Updated
\`\`\`

**2. Manual Addition**
\`\`\`
Warehouse Inventory → Add Stock → Select Warehouse → Enter SKU/Qty → Stock Added
\`\`\`

**3. CSV Bulk Import**
\`\`\`
Upload CSV → SKU Matching → Conflict Resolution → Stock Added
\`\`\`

### SKU Reconciliation (CSV Import)
When importing CSV data, the system:
1. Extracts SKU and product name from each row
2. Checks if SKU exists in product catalog
3. If SKU exists but name differs → **Conflict flagged**
4. User resolves: Keep existing name, Use new name, or Skip

This prevents duplicate products with different names from polluting the catalog.

### Batch Tracking
Each stock receipt creates a batch record containing:
- Quantity received
- Expiry date (optional)
- Damage status and notes
- Receipt timestamp

Batches enable:
- FIFO consumption tracking
- Expiry alerts (Expired, <7 days, <30 days)
- Damaged goods segregation
      `
    },
    {
      id: 'flow-location',
      title: 'Location Stock Flow',
      icon: '📍',
      content: `
### Location Configuration
Each location requires setup before stock tracking:

**1. Create Location** (Admin → Locations)
- Name and type (vending, retail, storage)

**2. Assign Products** (Location Stock → Configure)
- Select which products are available at this location
- Only assigned products appear in stock counts

**3. Set Thresholds** (Location Stock → Configure)
- **Min Stock**: Triggers "Low" status and reorder suggestions
- **Max Stock**: Target level for reorder quantity calculation

### Stock Updates

**Method 1: Manual Adjustment**
Direct +/- buttons or quantity input in Location Stock view.

**Method 2: AI Screenshot Upload**
Upload screenshots from existing tracking systems (e.g., Vendlive). AI extracts:
- Product names → Matched to catalog by name similarity
- Stock counts → Applied to location
- Prices → Used for new product creation

**Method 3: Restock Machine Workflow**
Full operational flow for physical restocking:
\`\`\`
Select Location → Stock Check (count actual) → Variance Recorded → Add Stock → Photo Capture → Complete
\`\`\`

### Status Indicators
| Status | Condition | Color |
|--------|-----------|-------|
| Full | Current ≥ Max | Green |
| OK | Current > Min × 1.5 | Grey |
| Warning | Current ≤ Min × 1.5 | Yellow |
| Low | Current ≤ Min | Red |
      `
    },
    {
      id: 'flow-restock',
      title: 'Restock Operations',
      icon: '🔄',
      content: `
### Remove Stock (Warehouse → Locations)

**Restock Routes**
Pre-configured sequences of locations for efficient restocking runs:
\`\`\`
Route: "Morning Run" = [Location A] → [Location B] → [Location C]
\`\`\`

**Capacity Warnings**
When removing stock for a route, the system calculates:
- Sum of Max Stock across all locations in route
- Current stock at those locations
- Available space = Max - Current

If removal quantity exceeds available space, a warning appears.

**Ad-hoc Removals**
For tastings, samples, or write-offs:
- Select "Tasting" or "Other" route
- Stock removed without location assignment
- Notes field for documentation

### Restock Machine (Field Operations)

**Step 1: Select Location**
Choose location and enter restocker name.

**Step 2: Stock Check**
Count every product physically present. System shows:
- Expected quantity (from system)
- Counted quantity (entered)
- Variance (auto-calculated, color-coded)

Completing stock check updates location stock to actual counts.

**Step 3: Add Stock**
After verification, add new stock being delivered. Photo capture required (can override).

**Step 4: Complete**
Creates audit trail of:
- Who restocked
- When
- What was added
- Variance from previous count
- Photo evidence
      `
    },
    {
      id: 'flow-orders',
      title: 'Order Management',
      icon: '📋',
      content: `
### Order Creation Methods

**1. Manual Entry**
Traditional form with:
- Supplier selection
- Delivery method (Standard, Match Delivery, Pick Up)
- Delivery destination (Warehouse or Custom Address)
- Line items with quantity and unit price
- Delivery fee, notes, invoice reference

**2. AI Invoice Analysis**
Upload invoice image/PDF → AI extracts:
- Supplier name (matched to existing or flagged as new)
- Line items with SKU, name, quantity, price
- Totals and delivery info

Review interface shows:
- Matched products (green) - SKU found in catalog
- New products (yellow) - Will be created
- Editable quantities and prices

**3. Generate Order (Auto-Suggest)**
Analyzes location stock levels:
\`\`\`
For each product at location:
  If Current Stock ≤ Min Stock → Priority: CRITICAL
  If Current Stock ≤ Min Stock × 1.5 → Priority: WARNING
  
  Suggested Order Qty = Max Stock - Current Stock
\`\`\`

Output options:
- **Create Order** - Populate order form for editing/submission
- **Generate PDF** - Print-ready order sheet with Hatch branding

### Order Lifecycle
\`\`\`
Created (Pending) → Received → Stock Added to Warehouse
\`\`\`

Receiving creates batch records with optional:
- Expiry date per item
- Damage flags and notes
      `
    },
    {
      id: 'flow-sales',
      title: 'Sales & Analytics',
      icon: '📊',
      content: `
### Sales Data Import
Upload Vendlive CSV exports containing transaction records:
- Transaction ID, timestamp
- Product details (ID, name, category)
- Pricing (charged amount, cost price)
- Payment method, vend status

### Deduplication
System tracks imported transaction IDs. Re-importing same CSV:
- Skips already-imported transactions
- Only adds genuinely new sales
- Reports: X imported, Y skipped (duplicates)

### Auto Product Creation
Products in sales data not in catalog are automatically created with:
- SKU from Vendlive product ID
- Name, category from transaction
- Cost and sale prices from transaction

### Analytics Provided

**Overview Tab**
- Total revenue, transactions, units sold
- Average transaction value
- Category breakdown (pie chart data)
- Top products by revenue

**By Product Tab**
- Units sold per product
- Revenue and profit per product
- Margin percentage

**Daily Sales Tab**
- Day-by-day breakdown
- Revenue, units, transaction count

**Dashboard Integration**
- 30-day revenue and profit cards
- Feeds into business performance metrics
      `
    },
    {
      id: 'integrations',
      title: 'AI & Integrations',
      icon: '🤖',
      content: `
### AI-Powered Features

**Invoice Analysis**
- Model: Claude Sonnet
- Input: Invoice image (PNG, JPG) or PDF
- Output: Structured JSON with supplier, items, prices
- Accuracy: High for standard invoice formats
- Fallback: Manual entry always available

**Stock Screenshot Analysis**
- Input: Screenshots from tracking apps
- Extracts: Product names, stock counts, prices, categories
- Matching: Fuzzy name matching to existing products
- Use case: Quick sync from external systems

### Data Formats Supported

**CSV Import (Warehouse)**
Auto-detects columns:
- SKU/Product ID
- Item Name/Description
- Quantity/Stock/Current Stock
- Category
- Unit Price/Cost
- Supplier

**Vendlive CSV (Sales)**
Specific format from Vendlive vending platform:
- 60+ columns
- Key fields: transaction_id, timestamp, product details, pricing

### Export Capabilities

**JSON Backup**
Full system state export for:
- Backup/restore
- Migration
- External analysis

**PDF Order Sheets**
Print-ready purchase orders with:
- Hatch branding
- Supplier/delivery details
- Product table with prices
- Totals and notes
      `
    },
    {
      id: 'config-guide',
      title: 'Configuration Guide',
      icon: '⚙️',
      content: `
### Initial Setup Checklist

**1. Warehouses** (Admin → Warehouses)
- [ ] Create at least one warehouse
- [ ] Name should reflect physical location

**2. Locations** (Admin → Locations)
- [ ] Create each vending machine/retail point
- [ ] Set type (vending, retail, storage)

**3. Suppliers** (Admin → Suppliers)
- [ ] Add all vendors you order from
- [ ] Include contact details for order sheets

**4. Products** (Admin → Products)
- [ ] Add products manually, OR
- [ ] Import via CSV, OR
- [ ] Let AI create from invoices/sales data

**5. Location Product Assignment** (Location Stock → Configure)
- [ ] For each location, assign which products are sold there
- [ ] Set Min Stock (reorder trigger)
- [ ] Set Max Stock (reorder target)

**6. Restock Routes** (Admin → Restock Routes)
- [ ] Create routes for regular restocking runs
- [ ] Order locations by physical route efficiency

### Threshold Guidelines

| Location Type | Min Stock | Max Stock |
|--------------|-----------|-----------|
| High-traffic vending | 3-5 | 10-15 |
| Low-traffic vending | 1-2 | 5-8 |
| Retail display | 2-3 | 6-10 |

Adjust based on:
- Sales velocity (check Sales Overview)
- Restock frequency capability
- Product shelf life
      `
    },
    {
      id: 'workflows',
      title: 'Daily Workflows',
      icon: '📅',
      content: `
### Morning Check
1. **Dashboard** - Review overnight alerts
   - Expiry warnings
   - Low stock at locations
   - Pending orders

2. **Sales Overview** - Yesterday's performance
   - Revenue vs target
   - Top sellers

### Restocking Run
1. **Orders → Generate Order**
   - Select location to restock
   - Review suggested quantities
   - Generate PDF or create order

2. **Remove Stock**
   - Select warehouse source
   - Choose restock route
   - Enter quantities per product
   - Confirm removal

3. **Restock Machine** (on-site)
   - Select location
   - Perform stock check
   - Record variance
   - Add stock
   - Capture photo

### Receiving Deliveries
1. **Orders** - Find pending order
2. **Receive Stock**
   - Confirm quantities received
   - Enter expiry dates
   - Flag any damage
   - Confirm receipt

### Weekly Tasks
- **Warehouse Inventory → Expiry Tracking**
  - Review items expiring within 7 days
  - Plan promotions or write-offs

- **Sales Overview → Import**
  - Upload latest Vendlive export
  - Review new product additions

- **Admin → Data Management**
  - Export JSON backup
      `
    },
    {
      id: 'troubleshooting',
      title: 'Troubleshooting',
      icon: '🔧',
      content: `
### Common Issues

**"Product not showing in location"**
- Check: Is product assigned to location?
- Fix: Location Stock → Configure → Add Product

**"Stock counts don't match"**
- Cause: Manual adjustments not recorded, theft, damage
- Fix: Use Restock Machine → Stock Check to reconcile

**"CSV import created duplicates"**
- Cause: Different SKUs for same product
- Fix: Use SKU conflict resolution during import
- Prevention: Standardise SKUs across all systems

**"AI didn't extract invoice correctly"**
- Cause: Non-standard invoice format
- Fix: Use "Edit Manually" option
- Tip: Clear, high-contrast images work best

**"Generate Order shows no items"**
- Cause: No Min Stock thresholds configured
- Fix: Location Stock → Configure → Set Min/Max for products

**"Sync indicator shows error"**
- Cause: Storage API unavailable
- Fix: Refresh page, check internet connection
- Data: Local changes preserved until sync succeeds

### Data Recovery

**From JSON Backup**
1. Admin → Data Management
2. Import JSON
3. Select backup file
4. Confirm restore

**Best Practice**
- Export JSON weekly
- Before major imports
- Store backups externally
      `
    }
  ];

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-emerald-600/20 to-teal-600/20 border border-emerald-500/30 rounded-lg p-6">
        <h3 className="text-lg font-semibold text-emerald-400 mb-2">Hatch Stock Management System</h3>
        <p className="text-zinc-400 text-sm">
          Comprehensive documentation for system logic, data flows, and operational workflows.
          Use this guide to understand how each component works together.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Navigation */}
        <div className="lg:col-span-1">
          <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4 sticky top-4">
            <h4 className="text-sm font-medium text-zinc-400 mb-3">Contents</h4>
            <nav className="space-y-1">
              {sections.map(section => (
                <button
                  key={section.id}
                  onClick={() => setExpandedSection(section.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-2 ${
                    expandedSection === section.id
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
                  }`}
                >
                  <span>{section.icon}</span>
                  <span className="truncate">{section.title}</span>
                </button>
              ))}
            </nav>
          </div>
        </div>

        {/* Content */}
        <div className="lg:col-span-3">
          {sections.map(section => (
            <div
              key={section.id}
              className={`${expandedSection === section.id ? 'block' : 'hidden'}`}
            >
              <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6">
                <div className="flex items-center gap-3 mb-6 pb-4 border-b border-zinc-800">
                  <span className="text-2xl">{section.icon}</span>
                  <h3 className="text-xl font-semibold text-zinc-100">{section.title}</h3>
                </div>
                <div className="prose prose-invert prose-sm max-w-none">
                  <div className="text-zinc-300 text-sm leading-relaxed space-y-4">
                    {section.content.split('\n\n').map((paragraph, idx) => {
                      // Handle headers
                      if (paragraph.startsWith('### ')) {
                        return <h4 key={idx} className="text-base font-semibold text-zinc-100 mt-6 mb-3">{paragraph.replace('### ', '')}</h4>;
                      }
                      if (paragraph.startsWith('**') && paragraph.endsWith('**')) {
                        return <h5 key={idx} className="text-sm font-semibold text-zinc-200 mt-4 mb-2">{paragraph.replace(/\*\*/g, '')}</h5>;
                      }
                      // Handle code blocks
                      if (paragraph.startsWith('```')) {
                        const code = paragraph.replace(/```[a-z]*\n?/g, '').trim();
                        return (
                          <pre key={idx} className="bg-zinc-800 rounded-lg p-4 overflow-x-auto text-xs font-mono text-emerald-400 my-4">
                            {code}
                          </pre>
                        );
                      }
                      // Handle tables
                      if (paragraph.includes('|') && paragraph.includes('---')) {
                        const lines = paragraph.trim().split('\n').filter(l => !l.includes('---'));
                        const headers = lines[0]?.split('|').filter(c => c.trim());
                        const rows = lines.slice(1).map(l => l.split('|').filter(c => c.trim()));
                        return (
                          <div key={idx} className="overflow-x-auto my-4">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="border-b border-zinc-700">
                                  {headers?.map((h, i) => (
                                    <th key={i} className="text-left px-3 py-2 text-zinc-400 font-medium">{h.trim()}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {rows.map((row, ri) => (
                                  <tr key={ri} className="border-b border-zinc-800">
                                    {row.map((cell, ci) => (
                                      <td key={ci} className="px-3 py-2 text-zinc-300">{cell.trim()}</td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        );
                      }
                      // Handle bullet points
                      if (paragraph.includes('\n- ') || paragraph.startsWith('- ')) {
                        const items = paragraph.split('\n').filter(l => l.startsWith('- '));
                        return (
                          <ul key={idx} className="list-disc list-inside space-y-1 my-3 text-zinc-400">
                            {items.map((item, i) => (
                              <li key={i}>{item.replace('- ', '').replace(/\*\*/g, '')}</li>
                            ))}
                          </ul>
                        );
                      }
                      // Handle checkbox lists
                      if (paragraph.includes('- [ ]')) {
                        const items = paragraph.split('\n').filter(l => l.includes('[ ]'));
                        return (
                          <ul key={idx} className="space-y-2 my-3">
                            {items.map((item, i) => (
                              <li key={i} className="flex items-center gap-2 text-zinc-400">
                                <span className="w-4 h-4 border border-zinc-600 rounded"></span>
                                {item.replace('- [ ]', '').trim()}
                              </li>
                            ))}
                          </ul>
                        );
                      }
                      // Regular paragraph with inline formatting
                      const formatted = paragraph
                        .replace(/\*\*([^*]+)\*\*/g, '<strong class="text-zinc-200">$1</strong>')
                        .replace(/`([^`]+)`/g, '<code class="bg-zinc-800 px-1.5 py-0.5 rounded text-emerald-400 text-xs">$1</code>');
                      return <p key={idx} className="text-zinc-400" dangerouslySetInnerHTML={{ __html: formatted }} />;
                    })}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Quick Stats */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6">
        <h4 className="text-sm font-medium text-zinc-400 mb-4">Current System State</h4>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 text-center">
          <div className="bg-zinc-800/50 rounded-lg p-3">
            <div className="text-xl font-bold text-emerald-400">{window.stockData?.products?.length || '—'}</div>
            <div className="text-xs text-zinc-500">Products</div>
          </div>
          <div className="bg-zinc-800/50 rounded-lg p-3">
            <div className="text-xl font-bold text-teal-400">{window.stockData?.warehouses?.length || '—'}</div>
            <div className="text-xs text-zinc-500">Warehouses</div>
          </div>
          <div className="bg-zinc-800/50 rounded-lg p-3">
            <div className="text-xl font-bold text-blue-400">{window.stockData?.locations?.length || '—'}</div>
            <div className="text-xs text-zinc-500">Locations</div>
          </div>
          <div className="bg-zinc-800/50 rounded-lg p-3">
            <div className="text-xl font-bold text-purple-400">{window.stockData?.suppliers?.length || '—'}</div>
            <div className="text-xs text-zinc-500">Suppliers</div>
          </div>
          <div className="bg-zinc-800/50 rounded-lg p-3">
            <div className="text-xl font-bold text-yellow-400">{window.stockData?.orders?.length || '—'}</div>
            <div className="text-xs text-zinc-500">Orders</div>
          </div>
          <div className="bg-zinc-800/50 rounded-lg p-3">
            <div className="text-xl font-bold text-red-400">{window.stockData?.salesData?.length || '—'}</div>
            <div className="text-xs text-zinc-500">Sales Records</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AdminProducts({ data, saveData }) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ sku: '', name: '', description: '', unitCost: '', unitsPerBox: '', preferredSupplierId: '', category: '', barcode: '' });

  const resetForm = () => { setForm({ sku: '', name: '', description: '', unitCost: '', unitsPerBox: '', preferredSupplierId: '', category: '', barcode: '' }); setEditingId(null); setShowForm(false); };

  const editProduct = (p) => {
    setForm({ sku: p.sku, name: p.name, description: p.description || '', unitCost: p.unitCost?.toString() || '', unitsPerBox: p.unitsPerBox?.toString() || '', preferredSupplierId: p.preferredSupplierId || '', category: p.category || '', barcode: p.barcode || '' });
    setEditingId(p.sku); setShowForm(true);
  };

  const submit = () => {
    if (!form.sku || !form.name) return;
    const product = { sku: form.sku.toUpperCase().trim(), name: form.name.trim(), description: form.description.trim(), unitCost: parseFloat(form.unitCost) || 0, unitsPerBox: parseInt(form.unitsPerBox) || 1, preferredSupplierId: form.preferredSupplierId, category: form.category.trim(), barcode: form.barcode.trim() };
    let newProducts;
    if (editingId) { newProducts = data.products.map(p => p.sku === editingId ? product : p); }
    else { if (data.products.some(p => p.sku === product.sku)) { alert('SKU already exists'); return; } newProducts = [...data.products, product]; }
    saveData({ ...data, products: newProducts }); resetForm();
  };

  const deleteProduct = (sku) => { saveData({ ...data, products: data.products.filter(p => p.sku !== sku) }); };
  const getSupplierName = (id) => data.suppliers.find(s => s.id === id)?.name || '—';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-zinc-500 text-sm">Manage product catalog</p>
        <button onClick={() => { resetForm(); setShowForm(!showForm); }} className="px-4 py-2 bg-emerald-600 text-white rounded text-sm font-medium hover:bg-emerald-500">{showForm ? 'Cancel' : '+ Add Product'}</button>
      </div>

      {showForm && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div><label className="block text-xs text-zinc-500 mb-1">SKU *</label><input type="text" value={form.sku} onChange={e => setForm({ ...form, sku: e.target.value })} disabled={!!editingId} className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm disabled:opacity-50" /></div>
            <div className="md:col-span-2"><label className="block text-xs text-zinc-500 mb-1">Name *</label><input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm" /></div>
          </div>
          <div><label className="block text-xs text-zinc-500 mb-1">Description</label><input type="text" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm" /></div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div><label className="block text-xs text-zinc-500 mb-1">Unit Cost (£)</label><input type="number" step="0.01" value={form.unitCost} onChange={e => setForm({ ...form, unitCost: e.target.value })} className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm" /></div>
            <div><label className="block text-xs text-zinc-500 mb-1">Units per Box</label><input type="number" value={form.unitsPerBox} onChange={e => setForm({ ...form, unitsPerBox: e.target.value })} className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm" /></div>
            <div><label className="block text-xs text-zinc-500 mb-1">Preferred Supplier</label><select value={form.preferredSupplierId} onChange={e => setForm({ ...form, preferredSupplierId: e.target.value })} className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm"><option value="">None</option>{data.suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
            <div><label className="block text-xs text-zinc-500 mb-1">Category</label><input type="text" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm" /></div>
          </div>
          <button onClick={submit} className="px-4 py-2 bg-emerald-600 text-white rounded text-sm font-medium hover:bg-emerald-500">{editingId ? 'Update' : 'Add'} Product</button>
        </div>
      )}

      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-zinc-800"><th className="text-left px-4 py-3 text-zinc-500 font-medium">SKU</th><th className="text-left px-4 py-3 text-zinc-500 font-medium">Name</th><th className="text-left px-4 py-3 text-zinc-500 font-medium">Category</th><th className="text-right px-4 py-3 text-zinc-500 font-medium">Cost</th><th className="text-right px-4 py-3 text-zinc-500 font-medium">Per Box</th><th className="text-left px-4 py-3 text-zinc-500 font-medium">Supplier</th><th className="text-right px-4 py-3 text-zinc-500 font-medium">Actions</th></tr></thead>
          <tbody>
            {data.products.length === 0 ? (<tr><td colSpan={7} className="px-4 py-8 text-center text-zinc-600">No products yet</td></tr>) : (
              data.products.map(p => (
                <tr key={p.sku} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                  <td className="px-4 py-3 text-emerald-400 font-mono text-xs">{p.sku}</td>
                  <td className="px-4 py-3 text-zinc-200">{p.name}</td>
                  <td className="px-4 py-3 text-zinc-500">{p.category || '—'}</td>
                  <td className="text-right px-4 py-3 text-zinc-300">£{p.unitCost?.toFixed(2) || '0.00'}</td>
                  <td className="text-right px-4 py-3 text-zinc-400">{p.unitsPerBox || 1}</td>
                  <td className="px-4 py-3 text-zinc-500">{getSupplierName(p.preferredSupplierId)}</td>
                  <td className="text-right px-4 py-3"><button onClick={() => editProduct(p)} className="text-zinc-400 hover:text-white mr-3">Edit</button><button onClick={() => deleteProduct(p.sku)} className="text-zinc-500 hover:text-red-400">Delete</button></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AdminWarehouses({ data, saveData }) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ name: '', address: '', notes: '' });

  const resetForm = () => { setForm({ name: '', address: '', notes: '' }); setEditingId(null); setShowForm(false); };
  const editWarehouse = (wh) => { setForm({ name: wh.name, address: wh.address || '', notes: wh.notes || '' }); setEditingId(wh.id); setShowForm(true); };

  const submit = () => {
    if (!form.name) return;
    const warehouse = { id: editingId || `wh-${Date.now()}`, name: form.name.trim(), address: form.address.trim(), notes: form.notes.trim() };
    let newWarehouses = editingId ? data.warehouses.map(w => w.id === editingId ? warehouse : w) : [...data.warehouses, warehouse];
    saveData({ ...data, warehouses: newWarehouses }); resetForm();
  };

  const deleteWarehouse = (id) => {
    const newStock = { ...data.stock }; delete newStock[id];
    saveData({ ...data, warehouses: data.warehouses.filter(w => w.id !== id), stock: newStock });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-zinc-500 text-sm">Configure warehouses</p>
        <button onClick={() => { resetForm(); setShowForm(!showForm); }} className="px-4 py-2 bg-emerald-600 text-white rounded text-sm font-medium hover:bg-emerald-500">{showForm ? 'Cancel' : '+ Add Warehouse'}</button>
      </div>

      {showForm && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div><label className="block text-xs text-zinc-500 mb-1">Name *</label><input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm" /></div>
            <div><label className="block text-xs text-zinc-500 mb-1">Address</label><input type="text" value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm" /></div>
          </div>
          <div><label className="block text-xs text-zinc-500 mb-1">Notes</label><textarea value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm" /></div>
          <button onClick={submit} className="px-4 py-2 bg-emerald-600 text-white rounded text-sm font-medium hover:bg-emerald-500">{editingId ? 'Update' : 'Add'} Warehouse</button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {data.warehouses.length === 0 ? (<p className="text-zinc-600 text-sm col-span-2">No warehouses</p>) : (
          data.warehouses.map(wh => {
            const units = Object.values(data.stock[wh.id] || {}).reduce((a, b) => a + b, 0);
            const skus = Object.keys(data.stock[wh.id] || {}).length;
            return (
              <div key={wh.id} className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
                <div className="flex items-start justify-between">
                  <div><h4 className="font-medium text-zinc-200">{wh.name}</h4>{wh.address && <p className="text-zinc-500 text-sm mt-1">{wh.address}</p>}</div>
                  <div className="flex gap-2"><button onClick={() => editWarehouse(wh)} className="text-zinc-400 hover:text-white text-sm">Edit</button><button onClick={() => deleteWarehouse(wh.id)} className="text-zinc-500 hover:text-red-400 text-sm">Delete</button></div>
                </div>
                <div className="mt-3 pt-3 border-t border-zinc-800 flex gap-4 text-sm"><span className="text-zinc-500">{skus} SKUs</span><span className="text-emerald-400">{units.toLocaleString()} units</span></div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function AdminLocations({ data, saveData }) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ name: '', type: 'retail', assignedItems: [] });

  const resetForm = () => { setForm({ name: '', type: 'retail', assignedItems: [] }); setEditingId(null); setShowForm(false); };
  const editLocation = (loc) => { setForm({ name: loc.name, type: loc.type || 'retail', assignedItems: loc.assignedItems || [] }); setEditingId(loc.id); setShowForm(true); };
  const toggleItem = (sku) => { if (form.assignedItems.includes(sku)) setForm({ ...form, assignedItems: form.assignedItems.filter(s => s !== sku) }); else setForm({ ...form, assignedItems: [...form.assignedItems, sku] }); };

  const submit = () => {
    if (!form.name) return;
    const location = { id: editingId || `loc-${Date.now()}`, name: form.name.trim(), type: form.type, assignedItems: form.assignedItems };
    let newLocations = editingId ? data.locations.map(l => l.id === editingId ? location : l) : [...data.locations, location];
    saveData({ ...data, locations: newLocations }); resetForm();
  };

  const deleteLocation = (id) => { saveData({ ...data, locations: data.locations.filter(l => l.id !== id) }); };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-zinc-500 text-sm">Configure restock locations and assign products</p>
        <button onClick={() => { resetForm(); setShowForm(!showForm); }} className="px-4 py-2 bg-emerald-600 text-white rounded text-sm font-medium hover:bg-emerald-500">{showForm ? 'Cancel' : '+ Add Location'}</button>
      </div>

      {showForm && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div><label className="block text-xs text-zinc-500 mb-1">Name *</label><input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm" /></div>
            <div><label className="block text-xs text-zinc-500 mb-1">Type</label><select value={form.type} onChange={e => setForm({ ...form, type: e.target.value })} className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm"><option value="retail">Retail</option><option value="display">Display</option><option value="vending">Vending</option><option value="storage">Storage</option><option value="other">Other</option></select></div>
          </div>
          <div><label className="block text-xs text-zinc-500 mb-2">Assigned Products (leave empty for all)</label>
            <div className="max-h-48 overflow-y-auto bg-zinc-800/50 rounded p-2 space-y-1">
              {data.products.length === 0 ? (<p className="text-zinc-600 text-sm p-2">No products created yet</p>) : (
                data.products.map(p => (<label key={p.sku} className="flex items-center gap-2 p-2 hover:bg-zinc-700/50 rounded cursor-pointer"><input type="checkbox" checked={form.assignedItems.includes(p.sku)} onChange={() => toggleItem(p.sku)} className="rounded border-zinc-600" /><span className="text-zinc-300 text-sm">{p.name}</span><span className="text-zinc-600 text-xs">{p.sku}</span></label>))
              )}
            </div>
          </div>
          <button onClick={submit} className="px-4 py-2 bg-emerald-600 text-white rounded text-sm font-medium hover:bg-emerald-500">{editingId ? 'Update' : 'Add'} Location</button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {data.locations.length === 0 ? (<p className="text-zinc-600 text-sm col-span-2">No locations</p>) : (
          data.locations.map(loc => (
            <div key={loc.id} className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2"><h4 className="font-medium text-zinc-200">{loc.name}</h4><span className="text-xs bg-zinc-800 px-2 py-0.5 rounded text-zinc-400">{loc.type}</span></div>
                <div className="flex gap-2"><button onClick={() => editLocation(loc)} className="text-zinc-400 hover:text-white text-sm">Edit</button><button onClick={() => deleteLocation(loc.id)} className="text-zinc-500 hover:text-red-400 text-sm">Delete</button></div>
              </div>
              <div className="mt-3 pt-3 border-t border-zinc-800">
                {(!loc.assignedItems || loc.assignedItems.length === 0) ? (<span className="text-zinc-500 text-sm">All products allowed</span>) : (
                  <div className="flex flex-wrap gap-1">{loc.assignedItems.slice(0, 5).map(sku => { const product = data.products.find(p => p.sku === sku); return (<span key={sku} className="text-xs bg-zinc-800 px-2 py-1 rounded text-zinc-400">{product?.name || sku}</span>); })}{loc.assignedItems.length > 5 && (<span className="text-xs text-zinc-500">+{loc.assignedItems.length - 5} more</span>)}</div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function AdminRoutes({ data, saveData }) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ name: '', type: 'route', locations: [] });

  const routes = data.restockRoutes || [];

  const resetForm = () => { 
    setForm({ name: '', type: 'route', locations: [] }); 
    setEditingId(null); 
    setShowForm(false); 
  };

  const editRoute = (route) => { 
    setForm({ 
      name: route.name, 
      type: route.type || 'route', 
      locations: route.locations || [] 
    }); 
    setEditingId(route.id); 
    setShowForm(true); 
  };

  const toggleLocation = (locId) => { 
    if (form.locations.includes(locId)) {
      setForm({ ...form, locations: form.locations.filter(l => l !== locId) }); 
    } else {
      setForm({ ...form, locations: [...form.locations, locId] }); 
    }
  };

  const moveLocation = (locId, direction) => {
    const idx = form.locations.indexOf(locId);
    if (idx === -1) return;
    const newLocations = [...form.locations];
    const newIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= newLocations.length) return;
    [newLocations[idx], newLocations[newIdx]] = [newLocations[newIdx], newLocations[idx]];
    setForm({ ...form, locations: newLocations });
  };

  const submit = () => {
    if (!form.name) return;
    const route = { 
      id: editingId || `route-${Date.now()}`, 
      name: form.name.trim(), 
      type: form.type,
      locations: form.type === 'adhoc' ? [] : form.locations 
    };
    let newRoutes;
    if (editingId) {
      newRoutes = routes.map(r => r.id === editingId ? route : r);
    } else {
      newRoutes = [...routes, route];
    }
    saveData({ ...data, restockRoutes: newRoutes }); 
    resetForm();
  };

  const deleteRoute = (id) => { 
    // Don't allow deleting built-in adhoc routes
    const route = routes.find(r => r.id === id);
    if (route?.type === 'adhoc' && ['tasting', 'other'].includes(route.id)) {
      return;
    }
    saveData({ ...data, restockRoutes: routes.filter(r => r.id !== id) }); 
  };

  const getLocationName = (id) => data.locations.find(l => l.id === id)?.name || id;

  // Calculate total max capacity for a route
  const getRouteCapacity = (route) => {
    if (route.type === 'adhoc') return null;
    let total = 0;
    (route.locations || []).forEach(locId => {
      const locConfig = data.locationConfig?.[locId] || {};
      Object.values(locConfig).forEach(config => {
        if (config.maxStock) total += config.maxStock;
      });
    });
    return total;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-zinc-500 text-sm">Create restock routes by combining locations in order</p>
        <button onClick={() => { resetForm(); setShowForm(!showForm); }} className="px-4 py-2 bg-emerald-600 text-white rounded text-sm font-medium hover:bg-emerald-500">
          {showForm ? 'Cancel' : '+ Add Route'}
        </button>
      </div>

      {showForm && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Route Name *</label>
              <input 
                type="text" 
                value={form.name} 
                onChange={e => setForm({ ...form, name: e.target.value })} 
                placeholder="e.g., Morning Route A"
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm" 
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-500 mb-1">Type</label>
              <select 
                value={form.type} 
                onChange={e => setForm({ ...form, type: e.target.value })} 
                className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm"
              >
                <option value="route">Restock Route</option>
                <option value="adhoc">Ad-hoc (Tasting/Other)</option>
              </select>
            </div>
          </div>

          {form.type === 'route' && (
            <div>
              <label className="block text-xs text-zinc-500 mb-2">Select Locations (in restock order)</label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Available locations */}
                <div className="bg-zinc-800/50 rounded p-3">
                  <div className="text-xs text-zinc-500 mb-2">Available Locations</div>
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {data.locations.length === 0 ? (
                      <p className="text-zinc-600 text-sm p-2">No locations created yet</p>
                    ) : (
                      data.locations
                        .filter(loc => !form.locations.includes(loc.id))
                        .map(loc => (
                          <button
                            key={loc.id}
                            onClick={() => toggleLocation(loc.id)}
                            className="w-full text-left px-3 py-2 hover:bg-zinc-700 rounded text-sm text-zinc-300 flex items-center justify-between"
                          >
                            <span>{loc.name}</span>
                            <span className="text-emerald-400">+ Add</span>
                          </button>
                        ))
                    )}
                  </div>
                </div>

                {/* Selected locations (ordered) */}
                <div className="bg-zinc-800/50 rounded p-3">
                  <div className="text-xs text-zinc-500 mb-2">Route Order (drag to reorder)</div>
                  <div className="space-y-1 max-h-48 overflow-y-auto">
                    {form.locations.length === 0 ? (
                      <p className="text-zinc-600 text-sm p-2">No locations selected</p>
                    ) : (
                      form.locations.map((locId, idx) => (
                        <div
                          key={locId}
                          className="px-3 py-2 bg-zinc-700 rounded text-sm text-zinc-200 flex items-center justify-between"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-emerald-400 font-mono text-xs">{idx + 1}.</span>
                            <span>{getLocationName(locId)}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <button 
                              onClick={() => moveLocation(locId, 'up')} 
                              disabled={idx === 0}
                              className="text-zinc-400 hover:text-white disabled:opacity-30 px-1"
                            >↑</button>
                            <button 
                              onClick={() => moveLocation(locId, 'down')} 
                              disabled={idx === form.locations.length - 1}
                              className="text-zinc-400 hover:text-white disabled:opacity-30 px-1"
                            >↓</button>
                            <button 
                              onClick={() => toggleLocation(locId)} 
                              className="text-red-400 hover:text-red-300 px-1 ml-2"
                            >×</button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {form.type === 'adhoc' && (
            <div className="text-xs text-emerald-400 bg-emerald-500/10 px-3 py-2 rounded">
              Ad-hoc routes are for removing stock without restocking locations (e.g., tastings, samples, write-offs)
            </div>
          )}

          <button 
            onClick={submit} 
            className="px-4 py-2 bg-emerald-600 text-white rounded text-sm font-medium hover:bg-emerald-500"
          >
            {editingId ? 'Update' : 'Add'} Route
          </button>
        </div>
      )}

      {/* Route list */}
      <div className="space-y-4">
        {/* Restock routes */}
        <div>
          <h4 className="text-sm font-medium text-zinc-400 mb-3">Restock Routes</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {routes.filter(r => r.type !== 'adhoc').length === 0 ? (
              <p className="text-zinc-600 text-sm">No restock routes created yet</p>
            ) : (
              routes.filter(r => r.type !== 'adhoc').map(route => {
                const capacity = getRouteCapacity(route);
                return (
                  <div key={route.id} className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <h4 className="font-medium text-zinc-200">{route.name}</h4>
                        <div className="text-xs text-zinc-500 mt-1">
                          {route.locations?.length || 0} locations
                          {capacity > 0 && <span className="ml-2 text-emerald-400">• Max capacity: {capacity} units</span>}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => editRoute(route)} className="text-zinc-400 hover:text-white text-sm">Edit</button>
                        <button onClick={() => deleteRoute(route.id)} className="text-zinc-500 hover:text-red-400 text-sm">Delete</button>
                      </div>
                    </div>
                    <div className="border-t border-zinc-800 pt-3">
                      {(!route.locations || route.locations.length === 0) ? (
                        <span className="text-zinc-500 text-sm">No locations assigned</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {route.locations.map((locId, idx) => (
                            <span key={locId} className="text-xs bg-zinc-800 px-2 py-1 rounded text-zinc-400 flex items-center gap-1">
                              <span className="text-emerald-400">{idx + 1}.</span>
                              {getLocationName(locId)}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Ad-hoc routes */}
        <div>
          <h4 className="text-sm font-medium text-zinc-400 mb-3">Ad-hoc Options</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {routes.filter(r => r.type === 'adhoc').map(route => (
              <div key={route.id} className="bg-zinc-900/50 border border-purple-900/50 rounded-lg p-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <h4 className="font-medium text-zinc-200">{route.name}</h4>
                    <span className="text-xs bg-purple-500/20 text-purple-400 px-2 py-0.5 rounded">Ad-hoc</span>
                  </div>
                  {!['tasting', 'other'].includes(route.id) && (
                    <div className="flex gap-2">
                      <button onClick={() => editRoute(route)} className="text-zinc-400 hover:text-white text-sm">Edit</button>
                      <button onClick={() => deleteRoute(route.id)} className="text-zinc-500 hover:text-red-400 text-sm">Delete</button>
                    </div>
                  )}
                </div>
                <p className="text-zinc-500 text-xs mt-2">Stock removed but not restocked to any location</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function AdminSuppliers({ data, saveData }) {
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState({ name: '', contact: '', email: '', phone: '' });

  const resetForm = () => { setForm({ name: '', contact: '', email: '', phone: '' }); setEditingId(null); setShowForm(false); };
  const editSupplier = (sup) => { setForm({ name: sup.name, contact: sup.contact || '', email: sup.email || '', phone: sup.phone || '' }); setEditingId(sup.id); setShowForm(true); };

  const submit = () => {
    if (!form.name) return;
    const supplier = { id: editingId || `sup-${Date.now()}`, name: form.name.trim(), contact: form.contact.trim(), email: form.email.trim(), phone: form.phone.trim() };
    let newSuppliers = editingId ? data.suppliers.map(s => s.id === editingId ? supplier : s) : [...data.suppliers, supplier];
    saveData({ ...data, suppliers: newSuppliers }); resetForm();
  };

  const deleteSupplier = (id) => { saveData({ ...data, suppliers: data.suppliers.filter(s => s.id !== id) }); };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-zinc-500 text-sm">Manage supplier information</p>
        <button onClick={() => { resetForm(); setShowForm(!showForm); }} className="px-4 py-2 bg-emerald-600 text-white rounded text-sm font-medium hover:bg-emerald-500">{showForm ? 'Cancel' : '+ Add Supplier'}</button>
      </div>

      {showForm && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div><label className="block text-xs text-zinc-500 mb-1">Company Name *</label><input type="text" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm" /></div>
            <div><label className="block text-xs text-zinc-500 mb-1">Contact Name</label><input type="text" value={form.contact} onChange={e => setForm({ ...form, contact: e.target.value })} className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm" /></div>
            <div><label className="block text-xs text-zinc-500 mb-1">Email</label><input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm" /></div>
            <div><label className="block text-xs text-zinc-500 mb-1">Phone</label><input type="text" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm" /></div>
          </div>
          <button onClick={submit} className="px-4 py-2 bg-emerald-600 text-white rounded text-sm font-medium hover:bg-emerald-500">{editingId ? 'Update' : 'Add'} Supplier</button>
        </div>
      )}

      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-zinc-800"><th className="text-left px-4 py-3 text-zinc-500 font-medium">Company</th><th className="text-left px-4 py-3 text-zinc-500 font-medium">Contact</th><th className="text-left px-4 py-3 text-zinc-500 font-medium">Email</th><th className="text-left px-4 py-3 text-zinc-500 font-medium">Phone</th><th className="text-right px-4 py-3 text-zinc-500 font-medium">Actions</th></tr></thead>
          <tbody>
            {data.suppliers.length === 0 ? (<tr><td colSpan={5} className="px-4 py-8 text-center text-zinc-600">No suppliers yet</td></tr>) : (
              data.suppliers.map(s => (
                <tr key={s.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                  <td className="px-4 py-3 text-zinc-200">{s.name}</td>
                  <td className="px-4 py-3 text-zinc-400">{s.contact || '—'}</td>
                  <td className="px-4 py-3 text-zinc-400">{s.email || '—'}</td>
                  <td className="px-4 py-3 text-zinc-400">{s.phone || '—'}</td>
                  <td className="text-right px-4 py-3"><button onClick={() => editSupplier(s)} className="text-zinc-400 hover:text-white mr-3">Edit</button><button onClick={() => deleteSupplier(s.id)} className="text-zinc-500 hover:text-red-400">Delete</button></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AdminData({ data, saveData }) {
  const [storageInfo, setStorageInfo] = useState({ size: 0, status: 'checking' });

  useEffect(() => {
    checkStorage();
  }, [data]);

  const checkStorage = async () => {
    try {
      const result = await window.storage.get('stock-tracker-data-v3');
      if (result?.value) {
        const size = new Blob([result.value]).size;
        setStorageInfo({ size, status: 'connected' });
      } else {
        setStorageInfo({ size: 0, status: 'empty' });
      }
    } catch (e) {
      setStorageInfo({ size: 0, status: 'unavailable' });
    }
  };

  const formatBytes = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const exportData = () => {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `stock-data-${new Date().toISOString().split('T')[0]}.json`; a.click();
    URL.revokeObjectURL(url);
  };

  const importData = (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => { try { const imported = JSON.parse(ev.target?.result); saveData({ ...INITIAL_STATE, ...imported }); } catch { alert('Invalid JSON file'); } };
    reader.readAsText(file);
  };

  const forceSync = () => {
    saveData({ ...data });
  };

  return (
    <div className="space-y-6">
      <div className="bg-emerald-900/20 border border-emerald-900/50 rounded-lg p-6">
        <h3 className="text-sm font-medium text-emerald-400 mb-4">Persistent Storage Status</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <div>
            <div className="text-xs text-zinc-500">Status</div>
            <div className={`text-sm font-medium ${storageInfo.status === 'connected' ? 'text-emerald-400' : storageInfo.status === 'empty' ? 'text-blue-400' : 'text-red-400'}`}>
              {storageInfo.status === 'connected' ? '● Connected' : storageInfo.status === 'empty' ? '○ Empty' : '✗ Unavailable'}
            </div>
          </div>
          <div>
            <div className="text-xs text-zinc-500">Data Size</div>
            <div className="text-sm font-medium text-zinc-300">{formatBytes(storageInfo.size)}</div>
          </div>
          <div>
            <div className="text-xs text-zinc-500">Products</div>
            <div className="text-sm font-medium text-zinc-300">{data.products.length}</div>
          </div>
          <div>
            <div className="text-xs text-zinc-500">Orders</div>
            <div className="text-sm font-medium text-zinc-300">{data.orders.length}</div>
          </div>
        </div>
        <p className="text-zinc-500 text-xs mb-3">Data automatically persists across sessions using Claude's storage API.</p>
        <button onClick={forceSync} className="px-4 py-2 bg-emerald-600 text-white rounded text-sm hover:bg-emerald-500">Force Sync Now</button>
      </div>

      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6">
        <h3 className="text-sm font-medium text-zinc-400 mb-4">Export Data</h3>
        <p className="text-zinc-500 text-sm mb-4">Download all stock data as JSON backup</p>
        <button onClick={exportData} className="px-4 py-2 bg-zinc-700 text-white rounded text-sm hover:bg-zinc-600">Export JSON</button>
      </div>

      <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6">
        <h3 className="text-sm font-medium text-zinc-400 mb-4">Import Data</h3>
        <p className="text-zinc-500 text-sm mb-4">Load from a previously exported JSON file</p>
        <label className="px-4 py-2 bg-zinc-700 text-white rounded text-sm hover:bg-zinc-600 cursor-pointer inline-block">Import JSON<input type="file" accept=".json" onChange={importData} className="hidden" /></label>
      </div>
    </div>
  );
}
