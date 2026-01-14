import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { 
  productsService, 
  inventoryService, 
  ordersService, 
  locationsService,
  warehousesService,
  suppliersService,
  routesService,
  salesService 
} from '../services';

// Initial state structure
const INITIAL_STATE = {
  products: [],
  warehouses: [],
  locations: [],
  suppliers: [],
  restockRoutes: [],
  orders: [],
  stock: {},           // { warehouseId: { sku: quantity } }
  locationStock: {},   // { locationId: { sku: quantity } }
  locationConfig: {},  // { locationId: { sku: { minStock, maxStock } } }
  stockBatches: [],
  removals: [],
  restockHistory: [],
  stockCheckHistory: [],
  salesData: [],
  salesImports: [],
};

// Create context
const StockContext = createContext(null);

/**
 * Stock Provider Component
 * Manages application state and provides API integration
 */
export function StockProvider({ children }) {
  const [data, setData] = useState(INITIAL_STATE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [syncStatus, setSyncStatus] = useState({ status: 'idle', lastSaved: null });
  
  // Determine if we're in offline/demo mode (no backend)
  const [isOfflineMode, setIsOfflineMode] = useState(false);

  // ========== INITIALIZATION ==========

  useEffect(() => {
    initializeData();
  }, []);

  const initializeData = async () => {
    try {
      // Try to load from backend first
      const [products, warehouses, locations, suppliers, routes, orders, sales, salesImports, warehouseStock] = await Promise.all([
        productsService.getAll(),
        warehousesService.getAll(),
        locationsService.getAll(),
        suppliersService.getAll(),
        routesService.getAll(),
        ordersService.getAll(),
        salesService.getAll(),
        salesService.getImportHistory(),
        inventoryService.getWarehouseStock(),
      ]);

      // Load location stock and config for each location
      const locationStock = {};
      const locationConfig = {};

      await Promise.all(locations.map(async (loc) => {
        try {
          const [stock, config] = await Promise.all([
            inventoryService.getLocationStock(loc.id),
            inventoryService.getLocationConfig(loc.id),
          ]);
          locationStock[loc.id] = stock;
          locationConfig[loc.id] = config;
        } catch (e) {
          console.log(`Failed to load stock/config for location ${loc.id}`);
        }
      }));

      setData(prev => ({
        ...prev,
        products,
        warehouses,
        locations,
        suppliers,
        restockRoutes: routes,
        orders,
        salesData: sales,
        salesImports,
        stock: warehouseStock,
        locationStock,
        locationConfig,
      }));

      setSyncStatus({ status: 'connected', lastSaved: new Date() });
      setIsOfflineMode(false);
    } catch (err) {
      console.log('Backend unavailable, trying local storage...');
      
      // Fall back to local storage (demo/offline mode)
      try {
        const stored = localStorage.getItem('hatch-stock-data');
        if (stored) {
          setData({ ...INITIAL_STATE, ...JSON.parse(stored) });
        }
        setIsOfflineMode(true);
        setSyncStatus({ status: 'offline', lastSaved: null });
      } catch (e) {
        console.error('Failed to load local data:', e);
      }
    }
    setLoading(false);
  };

  // ========== DATA PERSISTENCE ==========

  const saveData = useCallback(async (newData) => {
    setData(newData);
    setSyncStatus(prev => ({ ...prev, status: 'saving' }));

    if (isOfflineMode) {
      // Save to local storage in offline mode
      try {
        localStorage.setItem('hatch-stock-data', JSON.stringify(newData));
        setSyncStatus({ status: 'saved', lastSaved: new Date() });
      } catch (e) {
        console.error('Failed to save locally:', e);
        setSyncStatus(prev => ({ ...prev, status: 'error' }));
      }
    } else {
      // In connected mode, individual API calls handle persistence
      // This is mainly for bulk/state updates
      setSyncStatus({ status: 'saved', lastSaved: new Date() });
    }
  }, [isOfflineMode]);

  // ========== PRODUCT OPERATIONS ==========

  const addProduct = useCallback(async (product) => {
    if (isOfflineMode) {
      const updated = { ...data, products: [...data.products, product] };
      await saveData(updated);
      return product;
    }
    const created = await productsService.create(product);
    setData(prev => ({ ...prev, products: [...prev.products, created] }));
    return created;
  }, [data, isOfflineMode, saveData]);

  const updateProduct = useCallback(async (sku, updates) => {
    if (isOfflineMode) {
      const updated = {
        ...data,
        products: data.products.map(p => p.sku === sku ? { ...p, ...updates } : p),
      };
      await saveData(updated);
      return updated.products.find(p => p.sku === sku);
    }
    const result = await productsService.update(sku, updates);
    setData(prev => ({
      ...prev,
      products: prev.products.map(p => p.sku === sku ? result : p),
    }));
    return result;
  }, [data, isOfflineMode, saveData]);

  const deleteProduct = useCallback(async (sku) => {
    if (isOfflineMode) {
      const updated = {
        ...data,
        products: data.products.filter(p => p.sku !== sku),
      };
      await saveData(updated);
      return;
    }
    await productsService.delete(sku);
    setData(prev => ({
      ...prev,
      products: prev.products.filter(p => p.sku !== sku),
    }));
  }, [data, isOfflineMode, saveData]);

  // ========== INVENTORY OPERATIONS ==========

  const updateWarehouseStock = useCallback(async (warehouseId, sku, quantity, isDelta = true) => {
    if (isOfflineMode) {
      const currentQty = data.stock[warehouseId]?.[sku] || 0;
      const newQty = isDelta ? currentQty + quantity : quantity;
      const updated = {
        ...data,
        stock: {
          ...data.stock,
          [warehouseId]: {
            ...(data.stock[warehouseId] || {}),
            [sku]: Math.max(0, newQty),
          },
        },
      };
      await saveData(updated);
      return;
    }
    await inventoryService.updateWarehouseStock(warehouseId, sku, quantity, isDelta);
    // Refresh stock data
    const stockData = await inventoryService.getWarehouseStock(warehouseId);
    setData(prev => ({
      ...prev,
      stock: { ...prev.stock, [warehouseId]: stockData },
    }));
  }, [data, isOfflineMode, saveData]);

  const updateLocationStock = useCallback(async (locationId, sku, quantity) => {
    if (isOfflineMode) {
      const updated = {
        ...data,
        locationStock: {
          ...data.locationStock,
          [locationId]: {
            ...(data.locationStock[locationId] || {}),
            [sku]: Math.max(0, quantity),
          },
        },
      };
      await saveData(updated);
      return;
    }
    await inventoryService.updateLocationStock(locationId, sku, quantity);
    const stockData = await inventoryService.getLocationStock(locationId);
    setData(prev => ({
      ...prev,
      locationStock: { ...prev.locationStock, [locationId]: stockData },
    }));
  }, [data, isOfflineMode, saveData]);

  // ========== ORDER OPERATIONS ==========

  const createOrder = useCallback(async (order) => {
    if (isOfflineMode) {
      const newOrder = { ...order, id: `order-${Date.now()}`, status: 'pending', createdAt: new Date().toISOString() };
      const updated = { ...data, orders: [...data.orders, newOrder] };
      await saveData(updated);
      return newOrder;
    }
    const created = await ordersService.create(order);
    setData(prev => ({ ...prev, orders: [...prev.orders, created] }));
    return created;
  }, [data, isOfflineMode, saveData]);

  const receiveOrder = useCallback(async (orderId, receivedItems, warehouseId) => {
    if (isOfflineMode) {
      // Update order status
      const orders = data.orders.map(o => 
        o.id === orderId ? { ...o, status: 'received', receivedAt: new Date().toISOString() } : o
      );
      
      // Update warehouse stock
      const stock = { ...data.stock };
      if (!stock[warehouseId]) stock[warehouseId] = {};
      receivedItems.forEach(item => {
        stock[warehouseId][item.sku] = (stock[warehouseId][item.sku] || 0) + item.quantity;
      });

      // Create batches
      const newBatches = receivedItems.map(item => ({
        id: `batch-${Date.now()}-${item.sku}`,
        sku: item.sku,
        warehouseId,
        quantity: item.quantity,
        remainingQty: item.quantity,
        expiryDate: item.expiryDate,
        hasDamage: item.hasDamage || false,
        damageNotes: item.damageNotes || '',
        receivedAt: new Date().toISOString(),
      }));

      const updated = {
        ...data,
        orders,
        stock,
        stockBatches: [...data.stockBatches, ...newBatches],
      };
      await saveData(updated);
      return;
    }
    await ordersService.receive(orderId, receivedItems, warehouseId);
    // Refresh orders and stock
    const [orders, stockData] = await Promise.all([
      ordersService.getAll(),
      inventoryService.getWarehouseStock(warehouseId),
    ]);
    setData(prev => ({
      ...prev,
      orders,
      stock: { ...prev.stock, [warehouseId]: stockData },
    }));
  }, [data, isOfflineMode, saveData]);

  // ========== WAREHOUSE OPERATIONS ==========

  const addWarehouse = useCallback(async (warehouse) => {
    if (isOfflineMode) {
      const newWarehouse = { ...warehouse, id: `wh-${Date.now()}` };
      const updated = { ...data, warehouses: [...data.warehouses, newWarehouse] };
      await saveData(updated);
      return newWarehouse;
    }
    const created = await warehousesService.create(warehouse);
    setData(prev => ({ ...prev, warehouses: [...prev.warehouses, created] }));
    return created;
  }, [data, isOfflineMode, saveData]);

  const updateWarehouse = useCallback(async (id, updates) => {
    if (isOfflineMode) {
      const updated = {
        ...data,
        warehouses: data.warehouses.map(w => w.id === id ? { ...w, ...updates } : w),
      };
      await saveData(updated);
      return updated.warehouses.find(w => w.id === id);
    }
    const result = await warehousesService.update(id, updates);
    setData(prev => ({
      ...prev,
      warehouses: prev.warehouses.map(w => w.id === id ? result : w),
    }));
    return result;
  }, [data, isOfflineMode, saveData]);

  const deleteWarehouse = useCallback(async (id) => {
    if (isOfflineMode) {
      const newStock = { ...data.stock };
      delete newStock[id];
      const updated = {
        ...data,
        warehouses: data.warehouses.filter(w => w.id !== id),
        stock: newStock,
      };
      await saveData(updated);
      return;
    }
    await warehousesService.delete(id);
    setData(prev => {
      const newStock = { ...prev.stock };
      delete newStock[id];
      return {
        ...prev,
        warehouses: prev.warehouses.filter(w => w.id !== id),
        stock: newStock,
      };
    });
  }, [data, isOfflineMode, saveData]);

  // ========== LOCATION OPERATIONS ==========

  const addLocation = useCallback(async (location) => {
    if (isOfflineMode) {
      const newLocation = { ...location, id: `loc-${Date.now()}` };
      const updated = { ...data, locations: [...data.locations, newLocation] };
      await saveData(updated);
      return newLocation;
    }
    const created = await locationsService.create(location);
    setData(prev => ({ ...prev, locations: [...prev.locations, created] }));
    return created;
  }, [data, isOfflineMode, saveData]);

  const updateLocation = useCallback(async (id, updates) => {
    if (isOfflineMode) {
      const updated = {
        ...data,
        locations: data.locations.map(l => l.id === id ? { ...l, ...updates } : l),
      };
      await saveData(updated);
      return updated.locations.find(l => l.id === id);
    }
    const result = await locationsService.update(id, updates);
    setData(prev => ({
      ...prev,
      locations: prev.locations.map(l => l.id === id ? result : l),
    }));
    return result;
  }, [data, isOfflineMode, saveData]);

  const deleteLocation = useCallback(async (id) => {
    if (isOfflineMode) {
      const newLocationStock = { ...data.locationStock };
      const newLocationConfig = { ...data.locationConfig };
      delete newLocationStock[id];
      delete newLocationConfig[id];
      const updated = {
        ...data,
        locations: data.locations.filter(l => l.id !== id),
        locationStock: newLocationStock,
        locationConfig: newLocationConfig,
      };
      await saveData(updated);
      return;
    }
    await locationsService.delete(id);
    setData(prev => {
      const newLocationStock = { ...prev.locationStock };
      const newLocationConfig = { ...prev.locationConfig };
      delete newLocationStock[id];
      delete newLocationConfig[id];
      return {
        ...prev,
        locations: prev.locations.filter(l => l.id !== id),
        locationStock: newLocationStock,
        locationConfig: newLocationConfig,
      };
    });
  }, [data, isOfflineMode, saveData]);

  const updateLocationAssignedItems = useCallback(async (locationId, skus) => {
    if (isOfflineMode) {
      const updated = {
        ...data,
        locations: data.locations.map(l =>
          l.id === locationId ? { ...l, assignedItems: skus } : l
        ),
      };
      await saveData(updated);
      return updated.locations.find(l => l.id === locationId);
    }
    const result = await locationsService.updateAssignedItems(locationId, skus);
    setData(prev => ({
      ...prev,
      locations: prev.locations.map(l => l.id === locationId ? { ...l, assignedItems: skus } : l),
    }));
    return result;
  }, [data, isOfflineMode, saveData]);

  // ========== LOCATION CONFIG OPERATIONS ==========

  const updateLocationConfig = useCallback(async (locationId, sku, config) => {
    if (isOfflineMode) {
      const updated = {
        ...data,
        locationConfig: {
          ...data.locationConfig,
          [locationId]: {
            ...(data.locationConfig[locationId] || {}),
            [sku]: { ...(data.locationConfig[locationId]?.[sku] || {}), ...config },
          },
        },
      };
      await saveData(updated);
      return;
    }
    await inventoryService.updateLocationConfig(locationId, sku, config);
    const configData = await inventoryService.getLocationConfig(locationId);
    setData(prev => ({
      ...prev,
      locationConfig: { ...prev.locationConfig, [locationId]: configData },
    }));
  }, [data, isOfflineMode, saveData]);

  const loadLocationConfig = useCallback(async (locationId) => {
    if (isOfflineMode) {
      return data.locationConfig[locationId] || {};
    }
    const configData = await inventoryService.getLocationConfig(locationId);
    setData(prev => ({
      ...prev,
      locationConfig: { ...prev.locationConfig, [locationId]: configData },
    }));
    return configData;
  }, [data, isOfflineMode]);

  // ========== SUPPLIER OPERATIONS ==========

  const addSupplier = useCallback(async (supplier) => {
    if (isOfflineMode) {
      const newSupplier = { ...supplier, id: `sup-${Date.now()}` };
      const updated = { ...data, suppliers: [...data.suppliers, newSupplier] };
      await saveData(updated);
      return newSupplier;
    }
    const created = await suppliersService.create(supplier);
    setData(prev => ({ ...prev, suppliers: [...prev.suppliers, created] }));
    return created;
  }, [data, isOfflineMode, saveData]);

  const updateSupplier = useCallback(async (id, updates) => {
    if (isOfflineMode) {
      const updated = {
        ...data,
        suppliers: data.suppliers.map(s => s.id === id ? { ...s, ...updates } : s),
      };
      await saveData(updated);
      return updated.suppliers.find(s => s.id === id);
    }
    const result = await suppliersService.update(id, updates);
    setData(prev => ({
      ...prev,
      suppliers: prev.suppliers.map(s => s.id === id ? result : s),
    }));
    return result;
  }, [data, isOfflineMode, saveData]);

  const deleteSupplier = useCallback(async (id) => {
    if (isOfflineMode) {
      const updated = {
        ...data,
        suppliers: data.suppliers.filter(s => s.id !== id),
      };
      await saveData(updated);
      return;
    }
    await suppliersService.delete(id);
    setData(prev => ({
      ...prev,
      suppliers: prev.suppliers.filter(s => s.id !== id),
    }));
  }, [data, isOfflineMode, saveData]);

  // ========== ROUTE OPERATIONS ==========

  const addRoute = useCallback(async (route) => {
    if (isOfflineMode) {
      const newRoute = { ...route, id: `route-${Date.now()}` };
      const updated = { ...data, restockRoutes: [...data.restockRoutes, newRoute] };
      await saveData(updated);
      return newRoute;
    }
    const created = await routesService.create(route);
    setData(prev => ({ ...prev, restockRoutes: [...prev.restockRoutes, created] }));
    return created;
  }, [data, isOfflineMode, saveData]);

  const updateRoute = useCallback(async (id, updates) => {
    if (isOfflineMode) {
      const updated = {
        ...data,
        restockRoutes: data.restockRoutes.map(r => r.id === id ? { ...r, ...updates } : r),
      };
      await saveData(updated);
      return updated.restockRoutes.find(r => r.id === id);
    }
    const result = await routesService.update(id, updates);
    setData(prev => ({
      ...prev,
      restockRoutes: prev.restockRoutes.map(r => r.id === id ? result : r),
    }));
    return result;
  }, [data, isOfflineMode, saveData]);

  const deleteRoute = useCallback(async (id) => {
    if (isOfflineMode) {
      const updated = {
        ...data,
        restockRoutes: data.restockRoutes.filter(r => r.id !== id),
      };
      await saveData(updated);
      return;
    }
    await routesService.delete(id);
    setData(prev => ({
      ...prev,
      restockRoutes: prev.restockRoutes.filter(r => r.id !== id),
    }));
  }, [data, isOfflineMode, saveData]);

  // ========== ORDER OPERATIONS (Extended) ==========

  const updateOrder = useCallback(async (id, updates) => {
    if (isOfflineMode) {
      const updated = {
        ...data,
        orders: data.orders.map(o => o.id === id ? { ...o, ...updates } : o),
      };
      await saveData(updated);
      return updated.orders.find(o => o.id === id);
    }
    const result = await ordersService.update(id, updates);
    setData(prev => ({
      ...prev,
      orders: prev.orders.map(o => o.id === id ? result : o),
    }));
    return result;
  }, [data, isOfflineMode, saveData]);

  const deleteOrder = useCallback(async (id) => {
    if (isOfflineMode) {
      const updated = {
        ...data,
        orders: data.orders.filter(o => o.id !== id),
      };
      await saveData(updated);
      return;
    }
    await ordersService.delete(id);
    setData(prev => ({
      ...prev,
      orders: prev.orders.filter(o => o.id !== id),
    }));
  }, [data, isOfflineMode, saveData]);

  // ========== INVENTORY MOVEMENT OPERATIONS ==========

  const recordStockRemoval = useCallback(async (removal) => {
    if (isOfflineMode) {
      const newRemoval = { ...removal, id: `rem-${Date.now()}`, timestamp: new Date().toISOString() };
      // Update warehouse stock
      const stock = { ...data.stock };
      if (stock[removal.warehouseId]) {
        removal.items.forEach(item => {
          if (stock[removal.warehouseId][item.sku]) {
            stock[removal.warehouseId][item.sku] = Math.max(0, stock[removal.warehouseId][item.sku] - item.quantity);
          }
        });
      }
      const updated = {
        ...data,
        removals: [...data.removals, newRemoval],
        stock,
      };
      await saveData(updated);
      return newRemoval;
    }
    const result = await inventoryService.recordRemoval(removal);
    // Refresh stock and removals
    const [stockData, removals] = await Promise.all([
      inventoryService.getWarehouseStock(removal.warehouseId),
      inventoryService.getRemovalHistory(),
    ]);
    setData(prev => ({
      ...prev,
      stock: { ...prev.stock, [removal.warehouseId]: stockData },
      removals,
    }));
    return result;
  }, [data, isOfflineMode, saveData]);

  const loadRemovalHistory = useCallback(async (filters = {}) => {
    if (isOfflineMode) {
      return data.removals;
    }
    const removals = await inventoryService.getRemovalHistory(filters);
    setData(prev => ({ ...prev, removals }));
    return removals;
  }, [data, isOfflineMode]);

  const recordRestock = useCallback(async (restock) => {
    if (isOfflineMode) {
      const newRestock = { ...restock, id: `restock-${Date.now()}`, timestamp: new Date().toISOString() };
      // Update location stock
      const locationStock = { ...data.locationStock };
      if (!locationStock[restock.locationId]) locationStock[restock.locationId] = {};
      restock.items.forEach(item => {
        locationStock[restock.locationId][item.sku] = (locationStock[restock.locationId][item.sku] || 0) + item.quantity;
      });
      const updated = {
        ...data,
        restockHistory: [...data.restockHistory, newRestock],
        locationStock,
      };
      await saveData(updated);
      return newRestock;
    }
    const result = await inventoryService.recordRestock(restock);
    // Refresh location stock
    const stockData = await inventoryService.getLocationStock(restock.locationId);
    // Add restock to local history for immediate display
    const newRestock = {
      ...result,
      ...restock,
      id: result.id,
      timestamp: result.createdAt || new Date().toISOString(),
    };
    setData(prev => ({
      ...prev,
      locationStock: { ...prev.locationStock, [restock.locationId]: stockData },
      restockHistory: [...prev.restockHistory, newRestock],
    }));
    return result;
  }, [data, isOfflineMode, saveData]);

  const loadRestockHistory = useCallback(async (locationId) => {
    if (isOfflineMode) {
      return data.restockHistory.filter(r => r.locationId === locationId);
    }
    const history = await inventoryService.getRestockHistory(locationId);
    return history;
  }, [data, isOfflineMode]);

  const submitStockCheck = useCallback(async (stockCheck) => {
    if (isOfflineMode) {
      const newStockCheck = {
        ...stockCheck,
        id: `sc-${Date.now()}`,
        timestamp: new Date().toISOString(),
        totalVariance: stockCheck.items.reduce((sum, item) => sum + Math.abs(item.counted - item.expected), 0),
      };
      // Update location stock based on counted values
      const locationStock = { ...data.locationStock };
      if (!locationStock[stockCheck.locationId]) locationStock[stockCheck.locationId] = {};
      stockCheck.items.forEach(item => {
        locationStock[stockCheck.locationId][item.sku] = item.counted;
      });
      const updated = {
        ...data,
        stockCheckHistory: [...data.stockCheckHistory, newStockCheck],
        locationStock,
      };
      await saveData(updated);
      return newStockCheck;
    }
    const result = await inventoryService.submitStockCheck(stockCheck);
    // Refresh location stock - this is the key update that sets stock to counted values
    const stockData = await inventoryService.getLocationStock(stockCheck.locationId);
    // Also add the stock check to local history for immediate display
    const newStockCheck = {
      ...result,
      timestamp: result.createdAt || new Date().toISOString(),
      totalVariance: stockCheck.items.reduce((sum, item) => sum + Math.abs(item.counted - item.expected), 0),
    };
    setData(prev => ({
      ...prev,
      locationStock: { ...prev.locationStock, [stockCheck.locationId]: stockData },
      stockCheckHistory: [...prev.stockCheckHistory, newStockCheck],
    }));
    return result;
  }, [data, isOfflineMode, saveData]);

  const loadStockCheckHistory = useCallback(async (locationId) => {
    if (isOfflineMode) {
      return data.stockCheckHistory.filter(sc => sc.locationId === locationId);
    }
    const history = await inventoryService.getStockCheckHistory(locationId);
    return history;
  }, [data, isOfflineMode]);

  // ========== BATCH OPERATIONS ==========

  const createBatch = useCallback(async (batch) => {
    if (isOfflineMode) {
      const newBatch = {
        ...batch,
        id: `batch-${Date.now()}-${batch.sku}`,
        remainingQty: batch.quantity,
        receivedAt: new Date().toISOString(),
      };
      const updated = {
        ...data,
        stockBatches: [...data.stockBatches, newBatch],
      };
      await saveData(updated);
      return newBatch;
    }
    const result = await inventoryService.createBatch(batch);
    const batches = await inventoryService.getBatches();
    setData(prev => ({ ...prev, stockBatches: batches }));
    return result;
  }, [data, isOfflineMode, saveData]);

  const updateBatch = useCallback(async (id, updates) => {
    if (isOfflineMode) {
      const updated = {
        ...data,
        stockBatches: data.stockBatches.map(b => b.id === id ? { ...b, ...updates } : b),
      };
      await saveData(updated);
      return updated.stockBatches.find(b => b.id === id);
    }
    const result = await inventoryService.updateBatch(id, updates);
    setData(prev => ({
      ...prev,
      stockBatches: prev.stockBatches.map(b => b.id === id ? result : b),
    }));
    return result;
  }, [data, isOfflineMode, saveData]);

  const loadBatches = useCallback(async (filters = {}) => {
    if (isOfflineMode) {
      let batches = data.stockBatches;
      if (filters.warehouseId) {
        batches = batches.filter(b => b.warehouseId === filters.warehouseId);
      }
      if (filters.sku) {
        batches = batches.filter(b => b.sku === filters.sku);
      }
      return batches;
    }
    const batches = await inventoryService.getBatches(filters);
    setData(prev => ({ ...prev, stockBatches: batches }));
    return batches;
  }, [data, isOfflineMode]);

  const loadExpiryAlerts = useCallback(async (days = 30) => {
    if (isOfflineMode) {
      const now = new Date();
      const threshold = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
      return data.stockBatches.filter(b => {
        if (!b.expiryDate) return false;
        const expiry = new Date(b.expiryDate);
        return expiry <= threshold && b.remainingQty > 0;
      });
    }
    const alerts = await inventoryService.getExpiryAlerts(days);
    return alerts;
  }, [data, isOfflineMode]);

  // ========== SALES OPERATIONS ==========

  const importSales = useCallback(async (salesArray, filename) => {
    if (isOfflineMode) {
      const newImport = {
        id: `import-${Date.now()}`,
        filename,
        importedAt: new Date().toISOString(),
        recordCount: salesArray.length,
      };
      const updated = {
        ...data,
        salesData: [...data.salesData, ...salesArray],
        salesImports: [...data.salesImports, newImport],
      };
      await saveData(updated);
      return { imported: salesArray.length };
    }
    // Send sales array and filename to API
    const result = await salesService.importCsv(salesArray, filename);
    // Refresh sales data
    const [sales, imports] = await Promise.all([
      salesService.getAll(),
      salesService.getImportHistory(),
    ]);
    setData(prev => ({ ...prev, salesData: sales, salesImports: imports }));
    return result;
  }, [data, isOfflineMode, saveData]);

  const loadSales = useCallback(async (filters = {}) => {
    if (isOfflineMode) {
      let sales = data.salesData;
      if (filters.startDate) {
        sales = sales.filter(s => new Date(s.timestamp) >= new Date(filters.startDate));
      }
      if (filters.endDate) {
        sales = sales.filter(s => new Date(s.timestamp) <= new Date(filters.endDate));
      }
      return sales;
    }
    const sales = await salesService.getAll(filters);
    setData(prev => ({ ...prev, salesData: sales }));
    return sales;
  }, [data, isOfflineMode]);

  const loadSalesAnalytics = useCallback(async (params = {}) => {
    if (isOfflineMode) {
      // Calculate basic analytics from local data
      const sales = data.salesData;
      const totalRevenue = sales.reduce((sum, s) => sum + (s.charged || s.price * s.quantity), 0);
      const totalCost = sales.reduce((sum, s) => sum + (s.costPrice || 0) * s.quantity, 0);
      return {
        totalRevenue,
        totalCost,
        profit: totalRevenue - totalCost,
        margin: totalRevenue > 0 ? ((totalRevenue - totalCost) / totalRevenue * 100).toFixed(1) : 0,
        totalTransactions: sales.length,
      };
    }
    const analytics = await salesService.getAnalytics(params);
    return analytics;
  }, [data, isOfflineMode]);

  // ========== BULK OPERATIONS ==========

  const bulkImportProducts = useCallback(async (products) => {
    if (isOfflineMode) {
      const existingSkus = new Set(data.products.map(p => p.sku));
      const newProducts = products.filter(p => !existingSkus.has(p.sku));
      const updatedProducts = data.products.map(existing => {
        const update = products.find(p => p.sku === existing.sku);
        return update ? { ...existing, ...update } : existing;
      });
      const updated = {
        ...data,
        products: [...updatedProducts, ...newProducts],
      };
      await saveData(updated);
      return { created: newProducts.length, updated: products.length - newProducts.length };
    }
    const result = await productsService.bulkImport(products);
    const allProducts = await productsService.getAll();
    setData(prev => ({ ...prev, products: allProducts }));
    return result;
  }, [data, isOfflineMode, saveData]);

  const bulkUpdateWarehouseStock = useCallback(async (warehouseId, items) => {
    if (isOfflineMode) {
      const stock = { ...data.stock };
      if (!stock[warehouseId]) stock[warehouseId] = {};
      items.forEach(item => {
        stock[warehouseId][item.sku] = item.quantity;
      });
      const updated = { ...data, stock };
      await saveData(updated);
      return;
    }
    await inventoryService.bulkUpdateWarehouse(warehouseId, items);
    const stockData = await inventoryService.getWarehouseStock(warehouseId);
    setData(prev => ({
      ...prev,
      stock: { ...prev.stock, [warehouseId]: stockData },
    }));
  }, [data, isOfflineMode, saveData]);

  const setLocationStock = useCallback(async (locationId, items) => {
    if (isOfflineMode) {
      const locationStock = { ...data.locationStock };
      locationStock[locationId] = {};
      items.forEach(item => {
        locationStock[locationId][item.sku] = item.quantity;
      });
      const updated = { ...data, locationStock };
      await saveData(updated);
      return;
    }
    await inventoryService.setLocationStock(locationId, items);
    const stockData = await inventoryService.getLocationStock(locationId);
    setData(prev => ({
      ...prev,
      locationStock: { ...prev.locationStock, [locationId]: stockData },
    }));
  }, [data, isOfflineMode, saveData]);

  // ========== CONTEXT VALUE ==========

  const value = {
    // State
    data,
    loading,
    error,
    syncStatus,
    isOfflineMode,

    // Core operations
    saveData,

    // Product operations
    addProduct,
    updateProduct,
    deleteProduct,
    bulkImportProducts,

    // Warehouse operations
    addWarehouse,
    updateWarehouse,
    deleteWarehouse,

    // Location operations
    addLocation,
    updateLocation,
    deleteLocation,
    updateLocationAssignedItems,

    // Location config operations
    updateLocationConfig,
    loadLocationConfig,

    // Supplier operations
    addSupplier,
    updateSupplier,
    deleteSupplier,

    // Route operations
    addRoute,
    updateRoute,
    deleteRoute,

    // Order operations
    createOrder,
    updateOrder,
    deleteOrder,
    receiveOrder,

    // Inventory operations
    updateWarehouseStock,
    updateLocationStock,
    bulkUpdateWarehouseStock,
    setLocationStock,

    // Stock movement operations
    recordStockRemoval,
    loadRemovalHistory,
    recordRestock,
    loadRestockHistory,
    submitStockCheck,
    loadStockCheckHistory,

    // Batch operations
    createBatch,
    updateBatch,
    loadBatches,
    loadExpiryAlerts,

    // Sales operations
    importSales,
    loadSales,
    loadSalesAnalytics,

    // Refresh data from backend
    refresh: initializeData,
  };

  return (
    <StockContext.Provider value={value}>
      {children}
    </StockContext.Provider>
  );
}

/**
 * Hook to use stock context
 */
export function useStock() {
  const context = useContext(StockContext);
  if (!context) {
    throw new Error('useStock must be used within a StockProvider');
  }
  return context;
}

export default StockContext;
