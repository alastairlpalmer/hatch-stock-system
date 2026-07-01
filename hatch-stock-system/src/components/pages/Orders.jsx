import React, { useState } from 'react';
import { useStock } from '../../context/StockContext';
import ordersService from '../../services/orders.service';
import vendliveService from '../../services/vendlive.service';

// Compact "2h ago" / "just now" formatter for sync timestamps.
function formatRelativeTime(ts) {
  if (!ts) return 'never';
  const diffMs = Date.now() - new Date(ts).getTime();
  if (!Number.isFinite(diffMs)) return 'unknown';
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// Shared print styles for the PO order sheets (single-location and consolidated).
const PO_SHEET_STYLES = `
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
    .supplier-head { font-size: 16px; font-weight: 700; color: #059669; margin: 28px 0 8px; padding-bottom: 6px; border-bottom: 2px solid #d1fae5; }
    .supplier-sub { font-size: 12px; color: #666; font-weight: 400; }
    .loc-note { color: #666; font-size: 12px; }
`;

function OrderCard({ order, data, onEdit, onDelete }) {
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
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
          const unitsPerBox = product?.unitsPerBox || 1;
          const boxes = unitsPerBox > 1 ? Math.ceil(item.quantity / unitsPerBox) : null;
          return (
            <span key={i} className="text-xs bg-zinc-800 px-2 py-1 rounded">
              {product?.name || item.sku} × {item.quantity}
              {boxes && unitsPerBox > 1 && (
                <span className="text-teal-400 ml-1">({boxes} box{boxes > 1 ? 'es' : ''})</span>
              )}
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
          <>
            <button
              onClick={onEdit}
              className="text-xs text-emerald-400 hover:text-emerald-300"
            >
              Edit
            </button>
            {!confirmDelete ? (
              <button
                onClick={() => setConfirmDelete(true)}
                className="text-xs text-red-400 hover:text-red-300"
              >
                Delete
              </button>
            ) : (
              <span className="flex items-center gap-2">
                <span className="text-xs text-zinc-500">Delete?</span>
                <button
                  onClick={() => { onDelete(order.id); setConfirmDelete(false); }}
                  className="text-xs text-red-400 hover:text-red-300 font-medium"
                >
                  Yes
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="text-xs text-zinc-400 hover:text-zinc-300"
                >
                  No
                </button>
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function Orders() {
  const { data, createOrder, updateOrder, deleteOrder, bulkImportProducts, addSupplier } = useStock();
  const [showForm, setShowForm] = useState(false);
  const [editingOrder, setEditingOrder] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
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
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionMeta, setSuggestionMeta] = useState(null); // { leadTimeDays, coverDays, velocityWindows }
  const [selectedLocation, setSelectedLocation] = useState('');
  // 'single' restocks one location; 'all' consolidates many locations into one
  // list, grouped by supplier and creating one PO per supplier.
  const [orderMode, setOrderMode] = useState('single');
  const [selectedLocationIds, setSelectedLocationIds] = useState([]);
  const [expandedLines, setExpandedLines] = useState(() => new Set());
  const [orderSupplier, setOrderSupplier] = useState('');
  const [orderNotes, setOrderNotes] = useState('');
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [stockFreshness, setStockFreshness] = useState([]); // [{ locationId, mapped, lastSyncedAt }]
  const [syncingStock, setSyncingStock] = useState(false);

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

  // Fetch suggestions from the server engine (velocity / days-of-cover model,
  // Frive fresh meals collapsed into meal-type groups). Each line is tagged with
  // a stable id, an editable unitPrice (from unit cost) and selected=true.
  // Shared mapper: tag each server suggestion with a stable id, an editable
  // unitPrice (from unit cost) and selected=true. Works for both single-location
  // and consolidated payloads (the latter already carries an `id`).
  const toSuggestionItem = (s) => ({
    ...s,
    id: s.id || (s.type === 'freshMealGroup' ? `frive:${s.mealType}` : s.sku),
    category: s.category || (s.type === 'freshMealGroup' ? 'Fresh Meal' : 'Other'),
    unitPrice: s.unitCost ?? 0,
    selected: true,
  });

  const fetchSuggestions = async (locationId) => {
    if (!locationId) {
      setSuggestedItems([]);
      setSuggestionMeta(null);
      return;
    }
    setSuggestionsLoading(true);
    try {
      const res = await ordersService.generateSuggestions(locationId);
      setSuggestionMeta({
        leadTimeDays: res.leadTimeDays,
        coverDays: res.coverDays,
        velocityWindows: res.velocityWindows,
      });
      setSuggestedItems((res.suggestions || []).map(toSuggestionItem));
    } catch (err) {
      console.error('Failed to load order suggestions:', err);
      setSuggestedItems([]);
      setSuggestionMeta(null);
    } finally {
      setSuggestionsLoading(false);
    }
  };

  // Consolidated across many locations. Per-location lead/cover varies, so the
  // single-line meta banner is hidden (null) in this mode.
  const fetchConsolidatedSuggestions = async (locationIds) => {
    if (!locationIds || locationIds.length === 0) {
      setSuggestedItems([]);
      setSuggestionMeta(null);
      return;
    }
    setSuggestionsLoading(true);
    try {
      const res = await ordersService.generateConsolidatedSuggestions(locationIds);
      setSuggestionMeta(null);
      setSuggestedItems((res.suggestions || []).map(toSuggestionItem));
    } catch (err) {
      console.error('Failed to load consolidated suggestions:', err);
      setSuggestedItems([]);
      setSuggestionMeta(null);
    } finally {
      setSuggestionsLoading(false);
    }
  };

  const loadStockFreshness = async () => {
    try {
      setStockFreshness(await vendliveService.getStockFreshness());
    } catch (err) {
      console.error('Failed to load stock freshness:', err);
    }
  };

  // On-demand: pull VendLive truth into LocationStock for this location, then
  // re-fetch suggestions so they reflect the freshened stock.
  const syncLocationStock = async () => {
    if (!selectedLocation) return;
    setSyncingStock(true);
    try {
      await vendliveService.syncLocationStock(selectedLocation);
      await Promise.all([fetchSuggestions(selectedLocation), loadStockFreshness()]);
    } catch (err) {
      console.error('Stock sync failed:', err);
      alert(err.response?.data?.error || 'Stock sync failed');
    } finally {
      setSyncingStock(false);
    }
  };

  const openGenerateOrder = () => {
    const firstLocation = data.locations[0]?.id || '';
    setOrderMode('single');
    setSelectedLocation(firstLocation);
    setSelectedLocationIds(data.locations.map(l => l.id));
    setExpandedLines(new Set());
    setOrderSupplier('');
    setOrderNotes('');
    setShowGenerateOrder(true);
    loadStockFreshness();
    fetchSuggestions(firstLocation);
  };

  const handleLocationChange = (locId) => {
    setSelectedLocation(locId);
    fetchSuggestions(locId);
  };

  // Flip between single-location and all-locations (consolidated) generation.
  const switchOrderMode = (mode) => {
    if (mode === orderMode) return;
    setOrderMode(mode);
    setExpandedLines(new Set());
    if (mode === 'all') {
      const ids = selectedLocationIds.length ? selectedLocationIds : data.locations.map(l => l.id);
      setSelectedLocationIds(ids);
      fetchConsolidatedSuggestions(ids);
    } else {
      fetchSuggestions(selectedLocation);
    }
  };

  const toggleLocationId = (id) => {
    const next = selectedLocationIds.includes(id)
      ? selectedLocationIds.filter(x => x !== id)
      : [...selectedLocationIds, id];
    setSelectedLocationIds(next);
    fetchConsolidatedSuggestions(next);
  };

  const toggleLineExpanded = (id) => {
    setExpandedLines(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Distinct suppliers among currently-selected consolidated lines (drives the
  // "Create N Orders" button label — one PO per supplier).
  const consolidatedSupplierCount = () => {
    const keys = new Set(
      suggestedItems.filter(i => i.selected && i.orderQty > 0).map(i => i.supplierId || '__none__')
    );
    return keys.size;
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

  // Orders carry concrete SKUs, but a Frive suggestion is a meal-type group.
  // Split a group's quantity across its flavour SKUs by recent sell-through
  // (even split if there's no sales signal), assigning any rounding remainder to
  // the strongest sellers. Non-group lines pass through as a single SKU line.
  const expandSuggestionToLines = (item) => {
    if (item.type !== 'freshMealGroup') {
      return [{ sku: item.sku, quantity: item.orderQty, unitPrice: item.unitPrice }];
    }
    const members = item.members || [];
    if (members.length === 0) return [];

    const totalVel = members.reduce((a, m) => a + (m.velocityLong || 0), 0);
    const shares = members.map(m => ({
      sku: m.sku,
      raw: totalVel > 0
        ? item.orderQty * ((m.velocityLong || 0) / totalVel)
        : item.orderQty / members.length,
    }));

    let assigned = 0;
    const lines = shares.map(s => {
      const q = Math.floor(s.raw);
      assigned += q;
      return { sku: s.sku, quantity: q, frac: s.raw - q };
    });
    let remainder = item.orderQty - assigned;
    lines.sort((a, b) => b.frac - a.frac);
    for (let i = 0; remainder > 0; i++, remainder--) lines[i % lines.length].quantity += 1;

    return lines
      .filter(l => l.quantity > 0)
      .map(l => ({ sku: l.sku, quantity: l.quantity, unitPrice: item.unitPrice }));
  };

  const createOrderFromSuggestions = () => {
    const selectedItems = suggestedItems.filter(i => i.selected && i.orderQty > 0);
    if (selectedItems.length === 0) return;

    const lines = selectedItems.flatMap(expandSuggestionToLines);

    setForm({
      supplierId: orderSupplier,
      deliveryMethod: 'standard',
      deliveryType: 'warehouse',
      warehouseId: data.warehouses[0]?.id || '',
      customAddress: '',
      items: lines.map(l => ({
        sku: l.sku,
        quantity: l.quantity.toString(),
        unitPrice: l.unitPrice.toString()
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

  // Group the currently-selected consolidated lines by preferred supplier.
  // Lines with no preferred supplier fall into a single "No preferred supplier"
  // bucket. Returns [{ supplierId, supplierName, items:[{item, idx}] }].
  const supplierGroups = () => {
    const groups = new Map();
    suggestedItems.forEach((item, idx) => {
      const key = item.supplierId || '__none__';
      if (!groups.has(key)) {
        groups.set(key, {
          supplierId: item.supplierId || null,
          supplierName: item.supplierName || 'No preferred supplier',
          items: [],
        });
      }
      groups.get(key).items.push({ item, idx });
    });
    return [...groups.values()];
  };

  // All-locations mode: split the selected lines by supplier and create one
  // pending PO per supplier (delivered to the first warehouse), bypassing the
  // single-order form since several suppliers can't share one form.
  const createOrdersConsolidated = async () => {
    const selected = suggestedItems.filter(i => i.selected && i.orderQty > 0);
    if (selected.length === 0) return;

    const warehouseId = data.warehouses[0]?.id || null;
    const bySupplier = new Map();
    for (const item of selected) {
      const key = item.supplierId || '';
      if (!bySupplier.has(key)) bySupplier.set(key, []);
      bySupplier.get(key).push(item);
    }

    const stamp = Date.now();
    let created = 0;
    let idx = 0;
    for (const [supplierId, items] of bySupplier.entries()) {
      const lines = items.flatMap(expandSuggestionToLines);
      if (lines.length === 0) { idx++; continue; }
      const subtotal = lines.reduce((a, l) => a + l.quantity * l.unitPrice, 0);
      await createOrder({
        id: (stamp + idx).toString(),
        supplierId: supplierId || null,
        deliveryMethod: 'standard',
        deliveryType: 'warehouse',
        warehouseId,
        customAddress: null,
        items: lines.map(l => ({
          sku: l.sku,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          lineTotal: l.quantity * l.unitPrice,
        })),
        expectedDate: '',
        deliveryFee: 0,
        subtotal,
        total: subtotal,
        notes: orderNotes,
        invoiceRef: '',
        invoiceImage: null,
        status: 'pending',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      created++;
      idx++;
    }

    setShowGenerateOrder(false);
    alert(`Created ${created} purchase order${created === 1 ? '' : 's'} (one per supplier).`);
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

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>${PO_SHEET_STYLES}</style>
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
        <th style="width: 35%">Product</th>
        <th>Current Stock</th>
        <th>Order Qty</th>
        <th>Boxes</th>
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
            ${item.priority === 'critical' ? '<br><small class="priority-critical">Warning - Below minimum</small>' : ''}
            ${item.priority === 'warning' ? '<br><small class="priority-warning">Low stock warning</small>' : ''}
          </td>
          <td>${item.currentStock} / ${item.maxStock || '-'}</td>
          <td><strong>${item.orderQty}</strong></td>
          <td>${item.boxesNeeded} × ${item.unitsPerBox}</td>
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
      <span>Total Boxes:</span>
      <span>${selectedItems.reduce((a, i) => a + i.boxesNeeded, 0)}</span>
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
    Generated by Hatch Stock Management System
  </div>
</body>
</html>`;

    const printWindow = window.open('', '_blank');
    printWindow.document.write(html);
    printWindow.document.close();

    setTimeout(() => {
      printWindow.print();
      setGeneratingPdf(false);
    }, 500);
  };

  // Consolidated order sheet: one printable page with a section per supplier and
  // a grand total, plus a per-line breakdown of which locations drove the qty.
  const generateConsolidatedPDF = async () => {
    setGeneratingPdf(true);

    const groups = supplierGroups()
      .map(g => ({ ...g, items: g.items.map(x => x.item).filter(i => i.selected && i.orderQty > 0) }))
      .filter(g => g.items.length > 0);

    const locNames = data.locations
      .filter(l => selectedLocationIds.includes(l.id))
      .map(l => l.name);
    const grandTotal = calculateSuggestedTotal();
    const totalUnits = groups.reduce((a, g) => a + g.items.reduce((b, i) => b + i.orderQty, 0), 0);
    const orderDate = new Date().toLocaleDateString('en-GB');
    const orderRef = `PO-ALL-${Date.now().toString().slice(-8)}`;

    const sections = groups.map(g => {
      const subtotal = g.items.reduce((a, i) => a + i.orderQty * i.unitPrice, 0);
      const rows = g.items.map(item => {
        const breakdown = (item.perLocation || [])
          .filter(pl => pl.orderQty > 0)
          .map(pl => `${pl.locationName}: ${pl.orderQty}`)
          .join(' · ');
        return `
        <tr>
          <td>
            ${item.name}
            <span class="category-badge">${item.category || 'Other'}</span>
            ${item.priority === 'critical' ? '<br><small class="priority-critical">Critical</small>' : ''}
            ${breakdown ? `<br><small class="loc-note">${breakdown}</small>` : ''}
          </td>
          <td>${item.orderQty}</td>
          <td>${item.boxesNeeded} × ${item.unitsPerBox}</td>
          <td>£${item.unitPrice.toFixed(2)}</td>
          <td>£${(item.orderQty * item.unitPrice).toFixed(2)}</td>
        </tr>`;
      }).join('');
      return `
      <div class="supplier-head">${g.supplierName} <span class="supplier-sub">· ${g.items.length} line${g.items.length === 1 ? '' : 's'} · £${subtotal.toFixed(2)}</span></div>
      <table>
        <thead>
          <tr>
            <th style="width: 45%">Product</th>
            <th>Order Qty</th>
            <th>Boxes</th>
            <th>Unit Price</th>
            <th>Line Total</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
    }).join('');

    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>${PO_SHEET_STYLES}</style>
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
      <div class="detail-title">Consolidated Order</div>
      <div class="detail-content">
        <div class="detail-name">${groups.length} supplier${groups.length === 1 ? '' : 's'}</div>
        <div>Deliver to Hatch International Limited</div>
      </div>
    </div>
    <div class="detail-box">
      <div class="detail-title">Locations Covered (${locNames.length})</div>
      <div class="detail-content">${locNames.join(', ') || 'None'}</div>
    </div>
  </div>

  ${sections}

  <div class="totals">
    <div class="total-row">
      <span>Suppliers:</span>
      <span>${groups.length}</span>
    </div>
    <div class="total-row">
      <span>Total Units:</span>
      <span>${totalUnits}</span>
    </div>
    <div class="total-row grand">
      <span>Grand Total:</span>
      <span>£${grandTotal.toFixed(2)}</span>
    </div>
  </div>

  ${orderNotes ? `
  <div class="notes">
    <div class="notes-title">Notes</div>
    <div>${orderNotes}</div>
  </div>
  ` : ''}

  <div class="footer">
    Generated by Hatch Stock Management System
  </div>
</body>
</html>`;

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

  const submit = async () => {
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

    if (editingOrder) {
      await updateOrder(editingOrder, order);
    } else {
      await createOrder(order);
    }
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
}`;

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

        const processedItems = [];
        const newProducts = [];

        for (const item of analyzed.items || []) {
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
              salePrice: item.unitPrice * 1.4
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

  const updateExtractedItem = (idx, field, value) => {
    const items = [...extractedItems];
    items[idx][field] = value;

    if (field === 'matchedSku' && value) {
      const product = data.products.find(p => p.sku === value);
      if (product) {
        items[idx].matchedName = product.name;
        items[idx].isNew = false;
        setProductsToCreate(prev => prev.filter(p => p.sku !== items[idx].sku));
      }
    }

    setExtractedItems(items);
  };

  const toggleItemSelection = (idx) => {
    const items = [...extractedItems];
    items[idx].selected = !items[idx].selected;
    setExtractedItems(items);
  };

  const applyExtractedData = async () => {
    const selectedNewProducts = productsToCreate.filter(p =>
      extractedItems.some(item => item.selected && item.isNew && item.sku === p.sku)
    );

    if (selectedNewProducts.length > 0) {
      const newProductsList = [...data.products, ...selectedNewProducts.map(p => ({
        sku: p.sku,
        name: p.name,
        category: p.category,
        unitCost: p.unitCost,
        salePrice: p.salePrice
      }))];
      await bulkImportProducts(newProductsList);
    }

    let supplierId = invoiceData.matchedSupplierId;

    if (!supplierId && invoiceData.supplier?.name) {
      const newSupplier = {
        id: `sup-${Date.now()}`,
        name: invoiceData.supplier.name,
        contact: '',
        email: '',
        phone: ''
      };
      await addSupplier(newSupplier);
      supplierId = newSupplier.id;
    }

    const orderItems = extractedItems
      .filter(item => item.selected)
      .map(item => ({
        sku: item.isNew ? item.sku : (item.matchedSku || item.sku),
        quantity: item.quantity?.toString() || '1',
        unitPrice: item.unitPrice?.toString() || '0'
      }));

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

  // Dynamic order search: every typed word must match somewhere in the
  // order's supplier name, invoice ref, notes, status, item SKUs or
  // product names (case-insensitive).
  const orderMatchesSearch = (order) => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return true;
    const supplierName = data.suppliers.find(s => s.id === order.supplierId)?.name || '';
    const haystack = [
      supplierName,
      order.invoiceRef || '',
      order.notes || '',
      order.status || '',
      ...(order.items || []).flatMap(i => [
        i.sku || '',
        data.products.find(p => p.sku === i.sku)?.name || '',
      ]),
    ].join(' ').toLowerCase();
    return query.split(/\s+/).every(token => haystack.includes(token));
  };

  // One suggestion row. `idx` indexes into suggestedItems so the qty/price/select
  // handlers keep working whether rows are shown flat (single mode) or grouped by
  // supplier (all mode). Consolidated lines carry `perLocation` and expand.
  const renderSuggestionRow = (item, idx) => {
    const expandable = Array.isArray(item.perLocation) && item.perLocation.length > 0;
    const expanded = expandedLines.has(item.id);
    return (
      <div
        key={item.id}
        className={`rounded-lg border transition-all ${
          item.selected
            ? item.priority === 'critical'
              ? 'bg-red-500/5 border-red-500/30'
              : 'bg-yellow-500/5 border-yellow-500/30'
            : 'bg-zinc-800/30 border-zinc-700 opacity-50'
        }`}
      >
        <div className="flex items-center gap-3 p-3">
          <input
            type="checkbox"
            checked={item.selected}
            onChange={() => toggleSuggestedItem(idx)}
            className="w-4 h-4 rounded border-zinc-600"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-xs px-1.5 py-0.5 rounded ${
                item.priority === 'critical' ? 'bg-red-500/20 text-red-400' : 'bg-yellow-500/20 text-yellow-400'
              }`}>
                {item.priority === 'critical' ? 'CRITICAL' : 'LOW'}
              </span>
              <span className="text-xs bg-zinc-700 px-1.5 py-0.5 rounded text-zinc-400">{item.category || 'Other'}</span>
              {item.daysOfCover != null ? (
                <span className="text-xs bg-teal-500/20 text-teal-400 px-1.5 py-0.5 rounded">
                  {item.daysOfCover}d cover
                </span>
              ) : item.basis === 'par_fallback' ? (
                <span className="text-xs bg-zinc-600/40 text-zinc-300 px-1.5 py-0.5 rounded">no recent sales</span>
              ) : null}
              {expandable && (
                <span className="text-xs bg-zinc-700 px-1.5 py-0.5 rounded text-zinc-400">
                  {item.perLocation.filter(pl => pl.orderQty > 0).length} location{item.perLocation.filter(pl => pl.orderQty > 0).length === 1 ? '' : 's'}
                </span>
              )}
            </div>
            <p className="text-sm text-zinc-200 mt-1">
              {item.name}
              {item.type === 'freshMealGroup' && item.members && (
                <span className="text-zinc-500"> · {item.members.length} flavour{item.members.length > 1 ? 's' : ''}</span>
              )}
            </p>
            <p className="text-xs text-zinc-500">
              Stock: {item.currentStock}{item.maxStock != null ? `/${item.maxStock}` : ''}
              {' · '}Selling {item.blendedVelocity}/day{' · '}Target {item.targetStock}
              {item.unitsPerBox > 1 && ` · ${item.boxesNeeded} box${item.boxesNeeded > 1 ? 'es' : ''} × ${item.unitsPerBox}`}
            </p>
          </div>
          {expandable && (
            <button
              onClick={() => toggleLineExpanded(item.id)}
              className="shrink-0 text-zinc-500 hover:text-zinc-300 text-xs px-2 py-1"
              title={expanded ? 'Hide locations' : 'Show per-location breakdown'}
            >
              {expanded ? '▾' : '▸'}
            </button>
          )}
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

        {expandable && expanded && (
          <div className="px-3 pb-3 -mt-1">
            <div className="rounded-md bg-zinc-800/40 border border-zinc-700 divide-y divide-zinc-700/60">
              {item.perLocation.filter(pl => pl.orderQty > 0).map(pl => (
                <div key={pl.locationId} className="flex items-center justify-between px-3 py-1.5 text-xs">
                  <span className="text-zinc-300">{pl.locationName}</span>
                  <span className="text-zinc-500">
                    stock {pl.currentStock}
                    {pl.daysOfCover != null && ` · ${pl.daysOfCover}d cover`}
                    {' · '}<span className="text-teal-400">order {pl.orderQty}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  const isSearching = searchQuery.trim().length > 0;
  const pendingOrders = data.orders.filter(o => o.status === 'pending').filter(orderMatchesSearch);
  const completedOrders = data.orders.filter(o => o.status === 'received').filter(orderMatchesSearch);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Purchase Orders</h2>
        <div className="grid grid-cols-3 sm:flex gap-2">
          <button
            onClick={openGenerateOrder}
            className="px-3 py-2.5 bg-teal-600 text-white rounded text-sm font-medium hover:bg-teal-500 transition-colors"
          >
            <span className="hidden sm:inline">Generate</span>
            <span className="sm:hidden">Gen</span>
          </button>
          <label className="px-3 py-2.5 bg-zinc-700 text-zinc-300 rounded text-sm font-medium hover:bg-zinc-600 transition-colors cursor-pointer text-center">
            <span className="hidden sm:inline">Invoice</span>
            <span className="sm:hidden">Inv</span>
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
            {showForm ? 'X' : '+'} <span className="hidden sm:inline">{showForm ? 'Cancel' : 'New'}</span>
          </button>
        </div>
      </div>

      {/* Generate Order Modal */}
      {showGenerateOrder && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium text-zinc-200">Generate Order</h3>
              <p className="text-zinc-500 text-sm mt-1">
                Suggests quantities from sales velocity and days of cover
                {suggestionMeta && ` · ${suggestionMeta.leadTimeDays}d lead + ${suggestionMeta.coverDays}d cover`}
              </p>
            </div>
            <button onClick={() => setShowGenerateOrder(false)} className="text-zinc-500 hover:text-zinc-300 text-xl">×</button>
          </div>

          {/* Single-location vs consolidated all-locations mode */}
          <div className="flex gap-2">
            {[{ id: 'single', label: 'Single Location' }, { id: 'all', label: 'All Locations' }].map(m => (
              <button
                key={m.id}
                onClick={() => switchOrderMode(m.id)}
                className={`px-4 py-2 rounded text-sm transition-colors ${
                  orderMode === m.id ? 'bg-teal-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-white'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {orderMode === 'single' ? (() => {
            const fresh = stockFreshness.find(f => f.locationId === selectedLocation);
            const unmapped = fresh && !fresh.mapped;
            return (
              <div className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-xs border ${
                unmapped ? 'bg-yellow-500/5 border-yellow-500/30 text-yellow-300' : 'bg-zinc-800/40 border-zinc-700 text-zinc-400'
              }`}>
                <span>
                  {unmapped
                    ? 'No VendLive machine linked — stock is a manual estimate, not live truth.'
                    : fresh?.lastSyncedAt
                      ? `Stock last synced from VendLive ${formatRelativeTime(fresh.lastSyncedAt)}`
                      : 'Stock not yet synced from VendLive for this location.'}
                </span>
                {!unmapped && (
                  <button
                    onClick={syncLocationStock}
                    disabled={syncingStock || !selectedLocation}
                    className="shrink-0 px-2.5 py-1 bg-zinc-700 text-zinc-200 rounded hover:bg-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {syncingStock ? 'Syncing…' : 'Sync stock'}
                  </button>
                )}
              </div>
            );
          })() : (
            <div className="rounded-lg px-3 py-2 text-xs border bg-zinc-800/40 border-zinc-700 text-zinc-400">
              <span>Stock read from the database (not re-synced). Per-location freshness:</span>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {data.locations.filter(l => selectedLocationIds.includes(l.id)).map(l => {
                  const fr = stockFreshness.find(f => f.locationId === l.id);
                  const label = !fr || fr.mapped === false
                    ? 'no VendLive link'
                    : fr.lastSyncedAt ? formatRelativeTime(fr.lastSyncedAt) : 'never synced';
                  return (
                    <span key={l.id} className="px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700">
                      {l.name}: <span className="text-zinc-300">{label}</span>
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {orderMode === 'single' ? (
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
          ) : (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs text-zinc-500">Locations to Consolidate ({selectedLocationIds.length})</label>
                <div className="flex gap-3 text-xs">
                  <button
                    onClick={() => { const ids = data.locations.map(l => l.id); setSelectedLocationIds(ids); fetchConsolidatedSuggestions(ids); }}
                    className="text-teal-400 hover:text-teal-300"
                  >
                    Select all
                  </button>
                  <button
                    onClick={() => { setSelectedLocationIds([]); fetchConsolidatedSuggestions([]); }}
                    className="text-zinc-500 hover:text-zinc-300"
                  >
                    Clear
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2 max-h-40 overflow-y-auto">
                {data.locations.map(l => (
                  <label key={l.id} className="flex items-center gap-2 text-sm bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 cursor-pointer hover:border-zinc-600">
                    <input
                      type="checkbox"
                      checked={selectedLocationIds.includes(l.id)}
                      onChange={() => toggleLocationId(l.id)}
                      className="w-4 h-4 rounded border-zinc-600"
                    />
                    <span className="truncate text-zinc-300">{l.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-4 gap-4">
            <div className="bg-zinc-800/50 rounded-lg p-3 text-center">
              <div className="text-xl font-bold text-teal-400">{suggestedItems.length}</div>
              <div className="text-xs text-zinc-500">Items Need Stock</div>
            </div>
            <div className="bg-zinc-800/50 rounded-lg p-3 text-center">
              <div className="text-xl font-bold text-red-400">{suggestedItems.filter(i => i.priority === 'critical').length}</div>
              <div className="text-xs text-zinc-500">Critical</div>
            </div>
            <div className="bg-zinc-800/50 rounded-lg p-3 text-center">
              <div className="text-xl font-bold text-yellow-400">{suggestedItems.filter(i => i.priority === 'warning').length}</div>
              <div className="text-xs text-zinc-500">Warning</div>
            </div>
            <div className="bg-zinc-800/50 rounded-lg p-3 text-center">
              <div className="text-xl font-bold text-emerald-400">£{calculateSuggestedTotal().toFixed(2)}</div>
              <div className="text-xs text-zinc-500">Est. Total</div>
            </div>
          </div>

          {suggestionsLoading ? (
            <div className="bg-zinc-800/40 border border-zinc-700 rounded-lg p-6 text-center">
              <p className="text-zinc-400 text-sm">Analysing stock and sales velocity…</p>
            </div>
          ) : suggestedItems.length === 0 ? (
            <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-6 text-center">
              <p className="text-emerald-400 font-medium">
                {orderMode === 'all' && selectedLocationIds.length === 0 ? 'No locations selected' : 'All stocked up!'}
              </p>
              <p className="text-zinc-500 text-sm mt-1">
                {orderMode === 'all'
                  ? selectedLocationIds.length === 0
                    ? 'Pick one or more locations to consolidate.'
                    : 'Nothing is below its days-of-cover target across the selected locations.'
                  : 'Nothing is below its days-of-cover target for this location.'}
              </p>
            </div>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {orderMode === 'single'
                ? suggestedItems.map((item, idx) => renderSuggestionRow(item, idx))
                : supplierGroups().map(group => {
                    const selectedInGroup = group.items.filter(x => x.item.selected && x.item.orderQty > 0);
                    const subtotal = selectedInGroup.reduce((a, x) => a + x.item.orderQty * x.item.unitPrice, 0);
                    return (
                      <div key={group.supplierId || '__none__'} className="space-y-2">
                        <div className="flex items-center justify-between px-1 pt-2">
                          <span className="text-sm font-medium text-teal-400">{group.supplierName}</span>
                          <span className="text-xs text-zinc-500">
                            {selectedInGroup.length} selected · £{subtotal.toFixed(2)}
                          </span>
                        </div>
                        {group.items.map(({ item, idx }) => renderSuggestionRow(item, idx))}
                      </div>
                    );
                  })}
            </div>
          )}

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

          <div className="flex gap-3 pt-4 border-t border-zinc-800">
            <button
              onClick={orderMode === 'all' ? generateConsolidatedPDF : generateOrderPDF}
              disabled={suggestedItems.filter(i => i.selected).length === 0 || generatingPdf}
              className="px-4 py-3 bg-zinc-700 text-zinc-200 rounded-lg text-sm font-medium hover:bg-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {generatingPdf ? 'Generating...' : 'Generate PDF'}
            </button>
            <button
              onClick={orderMode === 'all' ? createOrdersConsolidated : createOrderFromSuggestions}
              disabled={suggestedItems.filter(i => i.selected && i.orderQty > 0).length === 0}
              className="flex-1 px-4 py-3 bg-teal-600 text-white rounded-lg text-sm font-medium hover:bg-teal-500 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {orderMode === 'all'
                ? `Create ${consolidatedSupplierCount()} Order${consolidatedSupplierCount() === 1 ? '' : 's'} (one per supplier)`
                : `Create Order (${suggestedItems.filter(i => i.selected).length} items)`}
            </button>
            <button onClick={() => setShowGenerateOrder(false)} className="px-4 py-3 bg-zinc-800 text-zinc-400 rounded-lg text-sm hover:bg-zinc-700">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Invoice Analysis Modal */}
      {showInvoiceUpload && (
        <div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-zinc-200">{reviewMode ? 'Review Extracted Data' : 'Analyzing Invoice'}</h3>
            <button onClick={() => { setShowInvoiceUpload(false); setReviewMode(false); }} className="text-zinc-500 hover:text-zinc-300 text-xl">×</button>
          </div>

          {invoiceProcessing && (
            <div className="text-center py-12">
              <div className="inline-block animate-spin text-emerald-400 text-3xl mb-4">↻</div>
              <p className="text-zinc-400">Analyzing invoice with AI...</p>
            </div>
          )}

          {invoiceError && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
              <p className="text-red-400 text-sm">{invoiceError}</p>
              <button onClick={() => { setShowInvoiceUpload(false); setShowForm(true); }} className="mt-3 px-4 py-2 bg-zinc-700 text-zinc-300 rounded text-sm hover:bg-zinc-600">
                Enter Manually
              </button>
            </div>
          )}

          {reviewMode && invoiceData && (
            <div className="space-y-6">
              <div className="bg-zinc-800/30 rounded-lg p-4 space-y-3">
                <h4 className="text-sm font-medium text-zinc-300">Order Details</h4>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-zinc-500">Supplier:</span>
                    <span className={`ml-2 ${invoiceData.matchedSupplierId ? 'text-emerald-400' : 'text-yellow-400'}`}>
                      {invoiceData.supplier?.name || 'Not detected'}
                    </span>
                  </div>
                  <div>
                    <span className="text-zinc-500">Invoice Ref:</span>
                    <span className="ml-2 text-zinc-300">{invoiceData.invoiceRef || 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-zinc-500">Total:</span>
                    <span className="ml-2 text-zinc-300">£{invoiceData.total?.toFixed(2) || '0.00'}</span>
                  </div>
                </div>
              </div>

              <div className="bg-zinc-800/30 rounded-lg p-4">
                <h4 className="text-sm font-medium text-zinc-300 mb-3">Extracted Items ({extractedItems.length})</h4>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {extractedItems.map((item, idx) => (
                    <div key={idx} className={`flex items-center gap-3 p-3 rounded-lg border ${
                      item.selected
                        ? item.isNew ? 'bg-yellow-500/5 border-yellow-500/30' : 'bg-emerald-500/5 border-emerald-500/30'
                        : 'bg-zinc-800/50 border-zinc-700 opacity-50'
                    }`}>
                      <input
                        type="checkbox"
                        checked={item.selected}
                        onChange={() => toggleItemSelection(idx)}
                        className="w-4 h-4 rounded border-zinc-600"
                      />
                      <div className="flex-1 min-w-0">
                        <span className={`text-xs px-1.5 py-0.5 rounded ${item.isNew ? 'bg-yellow-500/20 text-yellow-400' : 'bg-emerald-500/20 text-emerald-400'}`}>
                          {item.isNew ? 'NEW' : 'MATCHED'}
                        </span>
                        <p className="text-sm text-zinc-200 truncate">{item.name}</p>
                      </div>
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
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex gap-3 pt-4 border-t border-zinc-800">
                <button
                  onClick={applyExtractedData}
                  disabled={extractedItems.filter(i => i.selected).length === 0}
                  className="flex-1 px-4 py-3 bg-emerald-500 text-zinc-900 rounded-lg text-sm font-medium hover:bg-emerald-400 disabled:opacity-50"
                >
                  Confirm & Create Order
                </button>
                <button onClick={() => { setShowInvoiceUpload(false); setShowForm(true); setReviewMode(false); }} className="px-4 py-3 bg-zinc-700 text-zinc-300 rounded-lg text-sm hover:bg-zinc-600">
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
            <h3 className="font-medium text-zinc-200">{editingOrder ? 'Edit Order' : 'New Purchase Order'}</h3>
            {form.invoiceImage && <span className="text-xs bg-emerald-500/20 text-emerald-400 px-2 py-1 rounded">Invoice attached</span>}
          </div>

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

          <div>
            <label className="block text-xs text-zinc-500 mb-2">Delivery Method</label>
            <div className="flex gap-2">
              {[{ id: 'standard', label: 'Standard' }, { id: 'match', label: 'Match' }, { id: 'pickup', label: 'Pick Up' }].map(method => (
                <button
                  key={method.id}
                  onClick={() => setForm({ ...form, deliveryMethod: method.id })}
                  className={`px-4 py-2 rounded text-sm transition-colors ${
                    form.deliveryMethod === method.id ? 'bg-emerald-500 text-zinc-900' : 'bg-zinc-800 text-zinc-400 hover:text-white'
                  }`}
                >
                  {method.label}
                </button>
              ))}
            </div>
          </div>

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
                  {data.warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
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

          <div>
            <label className="block text-xs text-zinc-500 mb-2">Order Items</label>
            <div className="space-y-2">
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
                      {data.products.map(p => <option key={p.sku} value={p.sku}>{p.name} ({p.sku})</option>)}
                    </select>
                    <input
                      type="number"
                      placeholder="Qty"
                      value={item.quantity}
                      onChange={e => updateItem(idx, 'quantity', e.target.value)}
                      className="col-span-2 bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
                    />
                    <input
                      type="number"
                      step="0.01"
                      placeholder="Price"
                      value={item.unitPrice}
                      onChange={e => updateItem(idx, 'unitPrice', e.target.value)}
                      className="col-span-2 bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500"
                    />
                    <div className="col-span-2 text-right text-zinc-300 text-sm">£{lineTotal.toFixed(2)}</div>
                    <button onClick={() => removeItem(idx)} className="col-span-1 text-zinc-500 hover:text-red-400">×</button>
                  </div>
                );
              })}
            </div>
            <button onClick={addItem} className="mt-2 text-sm text-emerald-400 hover:text-emerald-300">+ Add item</button>
          </div>

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

          <div className="flex gap-3">
            <button
              onClick={submit}
              disabled={!form.supplierId || !form.items[0].sku || (form.deliveryType === 'warehouse' && !form.warehouseId) || (form.deliveryType === 'custom' && !form.customAddress)}
              className="px-4 py-2 bg-emerald-600 text-white rounded text-sm font-medium hover:bg-emerald-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {editingOrder ? 'Update Order' : 'Create Order'}
            </button>
            <button onClick={resetForm} className="px-4 py-2 bg-zinc-700 text-zinc-300 rounded text-sm hover:bg-zinc-600">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Order search */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search orders — supplier, product, SKU, invoice ref..."
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-emerald-500 placeholder:text-zinc-600"
          />
          {isSearching && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
              title="Clear search"
            >
              ×
            </button>
          )}
        </div>
        {isSearching && (
          <span className="text-xs text-zinc-500">
            {pendingOrders.length + completedOrders.length} match{pendingOrders.length + completedOrders.length === 1 ? '' : 'es'}
          </span>
        )}
      </div>

      {/* Pending Orders */}
      <div className="space-y-4">
        <h3 className="text-sm font-medium text-zinc-400">Pending Orders ({pendingOrders.length})</h3>
        {pendingOrders.length === 0 ? (
          <p className="text-zinc-600 text-sm">{isSearching ? 'No pending orders match your search' : 'No pending orders'}</p>
        ) : (
          <div className="space-y-3">
            {pendingOrders.map(order => (
              <OrderCard key={order.id} order={order} data={data} onEdit={() => startEdit(order)} onDelete={deleteOrder} />
            ))}
          </div>
        )}
      </div>

      {/* Completed Orders */}
      {completedOrders.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-zinc-400">
            Completed Orders ({completedOrders.length}){!isSearching && completedOrders.length > 5 && <span className="text-zinc-600"> — showing last 5</span>}
          </h3>
          <div className="space-y-3">
            {(isSearching ? completedOrders.slice() : completedOrders.slice(-5)).reverse().map(order => (
              <OrderCard key={order.id} order={order} data={data} onEdit={() => startEdit(order)} onDelete={deleteOrder} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
