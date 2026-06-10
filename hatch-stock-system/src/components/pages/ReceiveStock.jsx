import React, { useEffect, useRef, useState } from 'react';
import { useStock } from '../../context/StockContext';
import BarcodeScanner from '../scanner/BarcodeScanner';
import { productsService } from '../../services/products.service';
import { unlockAudio } from '../../utils/feedback';

export default function ReceiveStock() {
  const { data, receiveOrder } = useStock();
  const [activeSubTab, setActiveSubTab] = useState('receive');
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [receivedItems, setReceivedItems] = useState({});
  const [receiveWarehouseId, setReceiveWarehouseId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  // Handle to BarcodeScanner.flash() — set on overlay mount via onReady.
  const scannerApiRef = useRef(null);
  // Latest receivedItems ref so the async scan handler doesn't read stale
  // state when the user scans many items in quick succession.
  const receivedItemsRef = useRef(receivedItems);
  useEffect(() => { receivedItemsRef.current = receivedItems; }, [receivedItems]);
  // Snapshot of received quantities taken when the scanner opens, so we
  // can restore them if the user opens scan-mode by mistake (we zero
  // quantities on open so scanning counts up from 0).
  const [preScanSnapshot, setPreScanSnapshot] = useState(null);
  const [scansThisSession, setScansThisSession] = useState(0);

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
    setError(null);
  };

  const updateItem = (sku, field, value) => {
    setReceivedItems(prev => ({
      ...prev,
      [sku]: { ...prev[sku], [field]: value }
    }));
  };

  // Open the scanner against the current order. Quantities are reset to 0
  // so the user counts each item by scanning. We snapshot first so the
  // close handler can restore the previous (pre-fill) state if no scans
  // happened — which happens when the user taps Scan by mistake.
  const openScanForOrder = () => {
    if (!selectedOrder) return;
    // Must run inside the synchronous user-gesture call stack — iOS only
    // permits AudioContext.resume() from within a tap handler, not from
    // useEffect that runs after the render commits.
    unlockAudio();
    setPreScanSnapshot(receivedItems);
    setReceivedItems(prev => {
      const next = {};
      Object.keys(prev).forEach(sku => {
        next[sku] = { ...prev[sku], quantity: 0 };
      });
      return next;
    });
    setScansThisSession(0);
    setScannerOpen(true);
  };

  const closeScanner = () => {
    setScannerOpen(false);
    // If the user opened the scanner but didn't actually scan anything,
    // restore their previous quantities so we don't silently zero a PO
    // that was about to be confirmed manually.
    if (scansThisSession === 0 && preScanSnapshot) {
      setReceivedItems(preScanSnapshot);
    }
    setPreScanSnapshot(null);
    setScansThisSession(0);
  };

  // Called once per accepted scan from the camera overlay.
  // - Looks up the product by barcode (with SKU fallback)
  // - If the product is on the selected PO, +1 received qty and green flash
  // - If the product exists but isn't on the PO, yellow flash (no auto-add)
  // - If unknown / network error, red flash
  const handleScan = async (code) => {
    if (!selectedOrder) return;
    const flash = scannerApiRef.current?.flash;
    try {
      const result = await productsService.lookupBarcode(code);
      if (!result) {
        flash?.({ kind: 'error', message: 'No product found', detail: code });
        return;
      }
      const { product } = result;
      const onOrder = selectedOrder.items.some(i => i.sku === product.sku);
      if (!onOrder) {
        flash?.({
          kind: 'warn',
          message: 'Not on this order',
          detail: product.name || product.sku,
        });
        return;
      }
      // Cap at the ordered quantity to avoid silent over-receipt.
      // Compute the next quantity from the ref (always current) BEFORE
      // calling the setter, so the flash feedback below can't read a
      // stale value assigned inside the updater.
      const orderedQty = selectedOrder.items.find(i => i.sku === product.sku)?.quantity ?? 0;
      const currentItems = receivedItemsRef.current;
      const current = currentItems[product.sku] || { quantity: 0, expiryDate: '', hasDamage: false, damageNotes: '' };
      const appliedQty = Math.min((current.quantity || 0) + 1, orderedQty);
      const nextItems = { ...currentItems, [product.sku]: { ...current, quantity: appliedQty } };
      // Update the ref synchronously so a rapid follow-up scan sees this
      // quantity even before React commits the state update.
      receivedItemsRef.current = nextItems;
      setReceivedItems(nextItems);
      setScansThisSession(n => n + 1);
      const atCap = appliedQty >= orderedQty;
      flash?.({
        kind: atCap ? 'warn' : 'success',
        message: product.name || product.sku,
        detail: atCap ? `${appliedQty}/${orderedQty} — at ordered max` : `${appliedQty}/${orderedQty}`,
      });
    } catch (err) {
      flash?.({
        kind: 'error',
        message: 'Lookup failed',
        detail: err.message || 'Network error',
      });
    }
  };

  const confirmReceive = async () => {
    if (!selectedOrder || !receiveWarehouseId) return;

    setLoading(true);
    setError(null);

    try {
      // Transform receivedItems into the format expected by receiveOrder
      const items = Object.entries(receivedItems).map(([sku, itemData]) => ({
        sku,
        quantity: itemData.quantity,
        expiryDate: itemData.expiryDate || null,
        hasDamage: itemData.hasDamage,
        damageNotes: itemData.damageNotes
      })).filter(item => item.quantity > 0);

      await receiveOrder(selectedOrder.id, items, receiveWarehouseId);

      setSelectedOrder(null);
      setReceivedItems({});
    } catch (err) {
      setError(err.message || 'Failed to receive order');
    } finally {
      setLoading(false);
    }
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

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400 text-sm">
          {error}
        </div>
      )}

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
                <div className="flex items-center gap-3">
                  <button
                    onClick={openScanForOrder}
                    disabled={!receiveWarehouseId}
                    className="px-3 py-1.5 bg-emerald-600 text-white rounded text-sm font-medium hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    title={!receiveWarehouseId ? 'Select a warehouse first' : 'Scan items into this order'}
                  >
                    Scan items
                  </button>
                  <button onClick={() => setSelectedOrder(null)} className="text-zinc-500 hover:text-zinc-300">Cancel</button>
                </div>
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
                  Stock will be received into: {getWarehouseName(receiveWarehouseId)}
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
                          min="0"
                          max={item.quantity}
                          value={itemData.quantity || ''}
                          onChange={e => {
                            const parsed = parseInt(e.target.value) || 0;
                            updateItem(item.sku, 'quantity', Math.min(Math.max(parsed, 0), item.quantity));
                          }}
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
                          {itemData.hasDamage ? 'X' : '-'}
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
                disabled={!receiveWarehouseId || loading}
                className="px-4 py-2 bg-emerald-600 text-white rounded text-sm font-medium hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Receiving...' : 'Confirm Receipt'}
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
                      <div className="text-sm text-zinc-500">to {getWarehouseName(receipt.warehouseId)}</div>
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
                                  <span className="text-zinc-600 text-xs">-</span>
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
                        {receipt.itemsWithDamage} item(s) received with damage
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <BarcodeScanner
        open={scannerOpen}
        title={selectedOrder ? `Receiving: ${getSupplierName(selectedOrder.supplierId)}` : 'Scan barcode'}
        onScan={handleScan}
        onClose={closeScanner}
        onReady={(api) => { scannerApiRef.current = api; }}
      />
    </div>
  );
}
