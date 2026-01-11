import React, { useState } from 'react';
import { useStock } from '../../context/StockContext';

export default function ReceiveStock() {
  const { data, receiveOrder } = useStock();
  const [activeSubTab, setActiveSubTab] = useState('receive');
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [receivedItems, setReceivedItems] = useState({});
  const [receiveWarehouseId, setReceiveWarehouseId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

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
    </div>
  );
}
