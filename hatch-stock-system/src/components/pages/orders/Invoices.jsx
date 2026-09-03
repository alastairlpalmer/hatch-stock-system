import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import { Receipt, Plus, ChevronRight, AlertTriangle, Check, History } from 'lucide-react';
import invoicesService from '../../../services/invoices.service';
import { useStock } from '../../../context/StockContext';
import ProductSearchCombobox from '../../ui/ProductSearchCombobox';
import { useToast } from '../../ui/Toast';

const STATUS_STYLES = {
  draft: 'bg-amber-500/20 text-amber-400',
  reconciled: 'bg-emerald-500/20 text-emerald-400',
};

const money = (n) => `£${Number(n || 0).toFixed(2)}`;

function formatDate(iso, fmt = 'd MMM yyyy') {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : format(d, fmt);
}

// A pasted line's match quality drives how loudly the row asks for attention:
// `exact` is identity (supplier code / SKU / barcode) and needs no review,
// `likely` is a name guess that is pre-filled but must be seen, and a missing
// SKU blocks nothing but silently loses that line's cost.
const CONFIDENCE_STYLES = {
  exact: 'text-emerald-400',
  likely: 'text-amber-400',
  none: 'text-red-400',
};

const CONFIDENCE_LABEL = {
  exact: 'matched',
  likely: 'check',
  none: 'no match',
};

/**
 * Paste-an-invoice panel.
 *
 * The operator converts the supplier's PDF to CSV (an LLM does this in
 * seconds) and pastes it here. We parse it, match every line to the catalogue
 * and show the grid BEFORE anything is saved — an unmatched line is visible
 * and fixable at the point it costs nothing, rather than discovered later as
 * a hole in the cost data.
 */
function NewInvoicePanel({ onCreated, onCancel, initialOrderId = '' }) {
  const { data } = useStock();
  const toast = useToast();

  const [orderId, setOrderId] = useState(initialOrderId);
  const [supplierId, setSupplierId] = useState('');
  const [header, setHeader] = useState({
    invoiceRef: '',
    invoiceDate: format(new Date(), 'yyyy-MM-dd'),
    orderDiscount: '',
    deliveryCharge: '',
    vat: '',
    invoiceTotal: '',
    spreadDelivery: false,
    notes: '',
  });
  const [pasted, setPasted] = useState('');
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState(null); // { lines, warnings, skipped }
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // POs worth invoicing: anything not cancelled, newest first. A pending order
  // can be invoiced before it is fully received (suppliers invoice on despatch).
  // Capped at 60 so the select stays usable — but a PO handed to us by the
  // receive screen is always included, however far down the list it sits, or
  // the dropdown would show blank while the id was quietly still selected.
  const orders = useMemo(() => {
    const all = (data.orders || [])
      .filter((o) => o.status !== 'cancelled')
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    const recent = all.slice(0, 60);
    const preset = initialOrderId && !recent.some((o) => o.id === initialOrderId)
      ? all.find((o) => o.id === initialOrderId)
      : null;
    return preset ? [preset, ...recent] : recent;
  }, [data.orders, initialOrderId]);

  const selectedOrder = orders.find((o) => o.id === orderId) || null;
  // The PO's supplier wins when a PO is chosen — it is the stronger signal,
  // and matching is scoped by supplier.
  const effectiveSupplierId = selectedOrder?.supplierId || supplierId || null;
  const supplierName = (id) => data.suppliers?.find((s) => s.id === id)?.name || null;

  const parse = async () => {
    if (!pasted.trim() || parsing) return;
    setParsing(true);
    setError(null);
    try {
      const res = await invoicesService.parse(pasted, effectiveSupplierId);
      setParsed(res);
      if (res.lines.length === 0) {
        setError(res.warnings[0] || 'No product lines found in that paste.');
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Could not read that table — check the connection and try again.');
    } finally {
      setParsing(false);
    }
  };

  // Hand-matching a line marks it `manual`, which is the signal for reconcile
  // to learn the supplier's code for that product.
  const setLineSku = (idx, sku) => {
    setParsed((prev) => ({
      ...prev,
      lines: prev.lines.map((l, i) => (
        i === idx ? { ...l, sku: sku || null, matchedBy: sku ? 'manual' : null, confidence: sku ? 'exact' : 'none' } : l
      )),
    }));
  };

  const removeLine = (idx) => {
    setParsed((prev) => ({ ...prev, lines: prev.lines.filter((_, i) => i !== idx) }));
  };

  const num = (v) => (v === '' || v == null ? null : Number(v));

  const linesTotal = (parsed?.lines || []).reduce(
    (a, l) => a + ((l.lineTotal || 0) - (l.lineDiscount || 0)), 0,
  );
  const unmatched = (parsed?.lines || []).filter((l) => !l.sku).length;

  const save = async () => {
    if (saving || !parsed?.lines?.length || !header.invoiceRef.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const invoice = await invoicesService.create({
        orderId: orderId || null,
        supplierId: effectiveSupplierId,
        invoiceRef: header.invoiceRef.trim(),
        invoiceDate: header.invoiceDate || null,
        orderDiscount: num(header.orderDiscount),
        deliveryCharge: num(header.deliveryCharge),
        vat: num(header.vat),
        invoiceTotal: num(header.invoiceTotal),
        spreadDelivery: header.spreadDelivery,
        notes: header.notes || null,
        lines: parsed.lines.map((l) => ({
          sku: l.sku || null,
          rawCode: l.rawCode || null,
          rawName: l.rawName || null,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          lineDiscount: l.lineDiscount || 0,
          lineTotal: l.lineTotal,
          matchedBy: l.matchedBy || null,
        })),
      });
      onCreated(invoice);
    } catch (err) {
      const res = err.response?.data;
      setError(res?.error || 'Could not save the invoice — check the connection and try again.');
      if (res?.code === 'DUPLICATE_INVOICE') toast.error('That invoice reference is already recorded.');
      setSaving(false);
    }
  };

  const field = 'w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-teal-500';
  const label = 'block text-xs text-zinc-500 mb-1';

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 sm:p-5 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold text-zinc-100">Log a supplier invoice</h3>
        <button onClick={onCancel} className="text-xs text-zinc-500 hover:text-zinc-300">Cancel</button>
      </div>

      {/* ---- Which order is this invoice for? ---- */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className={label}>Purchase order</label>
          <select value={orderId} onChange={(e) => setOrderId(e.target.value)} className={field}>
            <option value="">No PO — invoice only</option>
            {orders.map((o) => (
              <option key={o.id} value={o.id}>
                {supplierName(o.supplierId) || 'No supplier'} · {formatDate(o.createdAt)} · {money(o.totalAmount)} ({o.status})
              </option>
            ))}
          </select>
          <p className="text-[11px] text-zinc-600 mt-1">
            Linking a PO is what produces the ordered / received / invoiced comparison.
          </p>
        </div>
        <div>
          <label className={label}>Supplier</label>
          <select
            value={effectiveSupplierId || ''}
            onChange={(e) => setSupplierId(e.target.value)}
            disabled={!!selectedOrder}
            className={`${field} disabled:opacity-60`}
          >
            <option value="">Choose a supplier…</option>
            {(data.suppliers || []).map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <p className="text-[11px] text-zinc-600 mt-1">
            {selectedOrder ? "Taken from the PO." : 'Scopes product matching to this supplier.'}
          </p>
        </div>
      </div>

      {/* ---- Header figures, as printed on the invoice ---- */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="col-span-2 sm:col-span-1">
          <label className={label}>Invoice ref *</label>
          <input
            value={header.invoiceRef}
            onChange={(e) => setHeader({ ...header, invoiceRef: e.target.value })}
            placeholder="INV-1234"
            className={field}
          />
        </div>
        <div>
          <label className={label}>Date</label>
          <input
            type="date"
            value={header.invoiceDate}
            onChange={(e) => setHeader({ ...header, invoiceDate: e.target.value })}
            className={field}
          />
        </div>
        <div>
          <label className={label}>Discount £</label>
          <input
            type="number" step="0.01" min="0" placeholder="—"
            value={header.orderDiscount}
            onChange={(e) => setHeader({ ...header, orderDiscount: e.target.value })}
            className={field}
          />
        </div>
        <div>
          <label className={label}>Delivery £</label>
          <input
            type="number" step="0.01" min="0" placeholder="—"
            value={header.deliveryCharge}
            onChange={(e) => setHeader({ ...header, deliveryCharge: e.target.value })}
            className={field}
          />
        </div>
        <div>
          <label className={label}>VAT £</label>
          <input
            type="number" step="0.01" min="0" placeholder="—"
            value={header.vat}
            onChange={(e) => setHeader({ ...header, vat: e.target.value })}
            className={field}
          />
        </div>
        <div>
          <label className={label}>Total £</label>
          <input
            type="number" step="0.01" min="0" placeholder="—"
            value={header.invoiceTotal}
            onChange={(e) => setHeader({ ...header, invoiceTotal: e.target.value })}
            className={field}
          />
        </div>
      </div>

      {header.deliveryCharge !== '' && Number(header.deliveryCharge) > 0 && (
        <label className="flex items-start gap-2 text-xs text-zinc-400 cursor-pointer">
          <input
            type="checkbox"
            checked={header.spreadDelivery}
            onChange={(e) => setHeader({ ...header, spreadDelivery: e.target.checked })}
            className="mt-0.5 accent-emerald-500"
          />
          <span>
            Spread the delivery charge across the products (raises unit costs).
            Leave off unless this supplier quotes ex-delivery prices — delivery is
            a cost of the order, not of the product.
          </span>
        </label>
      )}

      {/* ---- Paste ---- */}
      <div>
        <label className={label}>Paste the invoice table</label>
        <textarea
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          rows={6}
          placeholder={'Code,Description,Qty,Unit Price,Total\nBW-771,Salted Crisps 40g,24,0.42,10.08'}
          className={`${field} font-mono text-xs`}
        />
        <div className="flex flex-wrap items-center justify-between gap-2 mt-2">
          <p className="text-[11px] text-zinc-600">
            CSV, tab-separated, or straight out of a spreadsheet. Letterheads and
            subtotal rows are ignored.
          </p>
          <button
            onClick={parse}
            disabled={!pasted.trim() || parsing}
            className="px-4 py-2 bg-teal-600 text-white rounded text-sm font-medium hover:bg-teal-500 disabled:opacity-50"
          >
            {parsing ? 'Reading…' : 'Read table'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm text-red-400">{error}</div>
      )}

      {/* ---- Matched grid ---- */}
      {parsed?.lines?.length > 0 && (
        <div className="space-y-3">
          {parsed.warnings?.map((w) => (
            <div key={w} className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-xs text-amber-300">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>{w}</span>
            </div>
          ))}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <span className="text-zinc-400">{parsed.lines.length} lines</span>
            {parsed.skipped > 0 && <span className="text-zinc-600">{parsed.skipped} rows skipped</span>}
            <span className={unmatched > 0 ? 'text-red-400' : 'text-emerald-400'}>
              {unmatched > 0 ? `${unmatched} unmatched` : 'all matched'}
            </span>
            <span className="text-zinc-400">Lines total {money(linesTotal)}</span>
          </div>

          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="text-left text-[11px] uppercase text-zinc-500 border-b border-zinc-800">
                  <th className="py-2 px-3 font-medium">On the invoice</th>
                  <th className="py-2 px-3 font-medium">Our product</th>
                  <th className="py-2 px-3 font-medium text-right">Qty</th>
                  <th className="py-2 px-3 font-medium text-right">Unit £</th>
                  <th className="py-2 px-3 font-medium text-right">Was £</th>
                  <th className="py-2 px-3 font-medium text-right">Line £</th>
                  <th className="py-2 px-3" />
                </tr>
              </thead>
              <tbody>
                {parsed.lines.map((line, idx) => (
                  <tr key={`${line.rowNumber}-${idx}`} className="border-b border-zinc-800/60 align-top">
                    <td className="py-2 px-3">
                      <div className="text-zinc-300">{line.rawName || '—'}</div>
                      {line.rawCode && <div className="text-[11px] text-zinc-600 font-mono">{line.rawCode}</div>}
                    </td>
                    <td className="py-2 px-3 min-w-[220px]">
                      <ProductSearchCombobox
                        products={data.products || []}
                        value={line.sku || ''}
                        onSelect={(sku) => setLineSku(idx, sku)}
                        placeholder="Match a product…"
                        recentsKey="hatch-recent-products-invoice"
                      />
                      <div className={`text-[11px] mt-1 ${CONFIDENCE_STYLES[line.confidence] || 'text-zinc-500'}`}>
                        {CONFIDENCE_LABEL[line.confidence] || ''}
                        {line.matchedBy ? ` · ${line.matchedBy}` : ''}
                      </div>
                      {/* Candidates for a line we refused to auto-match: one tap
                          each, rather than retyping a search we already ran. */}
                      {!line.sku && line.candidates?.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {line.candidates.slice(0, 3).map((c) => (
                            <button
                              key={c.sku}
                              onClick={() => setLineSku(idx, c.sku)}
                              className="text-[11px] px-1.5 py-0.5 bg-zinc-800 border border-zinc-700 rounded text-zinc-400 hover:text-zinc-200"
                            >
                              {c.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="py-2 px-3 text-right text-zinc-300">{line.quantity}</td>
                    <td className="py-2 px-3 text-right text-zinc-300">{money(line.unitPrice)}</td>
                    <td className="py-2 px-3 text-right text-zinc-500">
                      {line.currentUnitCost != null ? money(line.currentUnitCost) : '—'}
                    </td>
                    <td className="py-2 px-3 text-right text-zinc-300">
                      {money((line.lineTotal || 0) - (line.lineDiscount || 0))}
                      {line.lineDiscount > 0 && (
                        <div className="text-[11px] text-emerald-400">−{money(line.lineDiscount)}</div>
                      )}
                    </td>
                    <td className="py-2 px-3 text-right">
                      <button
                        onClick={() => removeLine(idx)}
                        className="text-[11px] text-zinc-600 hover:text-red-400"
                      >
                        remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
            {!header.invoiceRef.trim() && (
              <span className="text-xs text-amber-400">Add the invoice reference to save.</span>
            )}
            <button
              onClick={save}
              disabled={saving || !header.invoiceRef.trim()}
              className="px-4 py-2.5 bg-emerald-500 text-zinc-900 rounded text-sm font-medium hover:bg-emerald-400 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save invoice'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Restate historical margin from the invoice trail.
 *
 * Every margin figure comes from sales.cost_price, frozen at ingest. Before
 * invoices could be reconciled that snapshot was VendLive's cost — a number
 * nobody could prove — so reconciling improves new sales while every past
 * month keeps reporting against the old guess. This closes that gap.
 *
 * Dry run first, always. Restating cost moves reported profit on periods that
 * may already have been reported on, and doing that behind one click without
 * showing the size of the change is how a reconciliation tool loses trust.
 */
function BackfillPanel() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const run = async (dryRun) => {
    setBusy(true);
    setError(null);
    try {
      const res = await invoicesService.backfillSaleCosts({ dryRun });
      if (dryRun) {
        setPreview(res);
      } else {
        toast.success(`Restated ${res.applied} sale${res.applied === 1 ? '' : 's'} from the invoice trail`);
        setPreview(null);
        setOpen(false);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Could not run the restatement — check the connection and try again.');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => { setOpen(true); run(true); }}
        className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300"
      >
        <History size={13} />
        Restate historical margin from reconciled invoices
      </button>
    );
  }

  const plan = preview?.plan;
  const nothingToDo = plan && plan.changeCount === 0;

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-medium text-zinc-200 text-sm">Restate historical margin</h3>
          <p className="text-xs text-zinc-500 mt-0.5 max-w-2xl">
            Margin is calculated from the cost frozen onto each sale when it was
            imported — which, before invoices were reconciled, was VendLive's figure
            rather than what we actually paid. This rewrites those to the
            invoice-proved cost that was in force on the day of each sale.
          </p>
        </div>
        <button
          onClick={() => { setOpen(false); setPreview(null); setError(null); }}
          className="text-xs text-zinc-500 hover:text-zinc-300 shrink-0"
        >
          Close
        </button>
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm text-red-400">{error}</div>}

      {busy && !preview && <p className="text-xs text-zinc-500">Working out what would change…</p>}

      {plan && (
        nothingToDo ? (
          <p className="text-sm text-emerald-400">
            Nothing to restate — every sale already carries its invoice-proved cost.
            {plan.noHistory > 0 && (
              <span className="text-zinc-500">
                {' '}({plan.noHistory} sales have no reconciled invoice covering their date, so they are left alone.)
              </span>
            )}
          </p>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-zinc-800/60 rounded-lg p-3">
                <div className="text-[11px] uppercase text-zinc-500">Sales to restate</div>
                <div className="text-lg font-semibold text-zinc-100">{plan.changeCount}</div>
              </div>
              <div className="bg-zinc-800/60 rounded-lg p-3">
                <div className="text-[11px] uppercase text-zinc-500">Cost change</div>
                <div className="text-lg font-semibold text-zinc-100">
                  {plan.costDelta > 0 ? '+' : ''}£{plan.costDelta.toFixed(2)}
                </div>
              </div>
              <div className="bg-zinc-800/60 rounded-lg p-3">
                <div className="text-[11px] uppercase text-zinc-500">Reported profit</div>
                <div className={`text-lg font-semibold ${plan.profitDelta < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                  {plan.profitDelta > 0 ? '+' : ''}£{plan.profitDelta.toFixed(2)}
                </div>
              </div>
              <div className="bg-zinc-800/60 rounded-lg p-3">
                <div className="text-[11px] uppercase text-zinc-500">Margin points</div>
                <div className={`text-lg font-semibold ${(plan.marginDeltaPct ?? 0) < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                  {plan.marginDeltaPct == null ? '—' : `${plan.marginDeltaPct > 0 ? '+' : ''}${plan.marginDeltaPct.toFixed(2)}`}
                </div>
              </div>
            </div>

            {plan.profitDelta < 0 && (
              <p className="text-xs text-amber-400">
                Profit falls because we were under-stating what these products cost.
                The new figure is the one backed by supplier invoices.
              </p>
            )}

            <details className="text-xs">
              <summary className="text-zinc-500 hover:text-zinc-300 cursor-pointer">
                Show a sample of the changes
              </summary>
              <ul className="mt-2 space-y-1">
                {(plan.changes || []).map((c) => (
                  <li key={c.id} className="flex items-baseline justify-between gap-3">
                    <span className="text-zinc-400 font-mono truncate">{c.sku}</span>
                    <span className="text-zinc-500 shrink-0">
                      {c.from == null ? 'no cost' : `£${c.from.toFixed(3)}`} → £{c.to.toFixed(3)}
                    </span>
                  </li>
                ))}
              </ul>
              {plan.changeCount > (plan.changes || []).length && (
                <p className="text-zinc-600 mt-1">
                  …and {plan.changeCount - plan.changes.length} more.
                </p>
              )}
            </details>

            <div className="flex items-center gap-2">
              <button
                onClick={() => run(false)}
                disabled={busy}
                className="px-4 py-2 bg-emerald-500 text-zinc-900 rounded text-sm font-medium hover:bg-emerald-400 disabled:opacity-50"
              >
                {busy ? 'Restating…' : `Restate ${plan.changeCount} sales`}
              </button>
              <button
                onClick={() => run(true)}
                disabled={busy}
                className="px-3 py-2 bg-zinc-800 text-zinc-300 rounded text-sm hover:bg-zinc-700 disabled:opacity-50"
              >
                Re-check
              </button>
            </div>
          </div>
        )
      )}
    </div>
  );
}

export default function Invoices() {
  const navigate = useNavigate();
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // ?orderId= arrives from the receive screen's "check the invoice for this
  // delivery" hand-off — open straight into the paste panel with that PO
  // selected rather than making the operator find it again.
  const [searchParams, setSearchParams] = useSearchParams();
  const presetOrderId = searchParams.get('orderId') || '';
  const [showNew, setShowNew] = useState(!!presetOrderId);

  const closeNew = () => {
    setShowNew(false);
    if (presetOrderId) {
      const next = new URLSearchParams(searchParams);
      next.delete('orderId');
      setSearchParams(next, { replace: true });
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await invoicesService.getAll();
        if (!cancelled) setInvoices(res || []);
      } catch (err) {
        console.error('Failed to load invoices:', err);
        if (!cancelled) setError('Failed to load invoices — check the connection and try again.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const drafts = invoices.filter((i) => i.status === 'draft').length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Invoices</h2>
          <p className="text-sm text-zinc-500 mt-0.5">
            What we were charged, against what we ordered and what turned up.
          </p>
        </div>
        {!showNew && (
          <button
            onClick={() => setShowNew(true)}
            className="flex items-center justify-center gap-1.5 px-3 py-2.5 bg-emerald-500 text-zinc-900 rounded text-sm font-medium hover:bg-emerald-400 transition-colors"
          >
            <Plus size={16} />
            Log an invoice
          </button>
        )}
      </div>

      {showNew && (
        <NewInvoicePanel
          initialOrderId={presetOrderId}
          onCancel={closeNew}
          onCreated={(invoice) => navigate(`/orders/invoices/${invoice.id}`)}
        />
      )}

      {drafts > 0 && !showNew && (
        <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-sm text-amber-300">
          <AlertTriangle size={16} className="shrink-0" />
          <span>
            {drafts} invoice{drafts === 1 ? '' : 's'} still to reconcile — costs and
            discounts on {drafts === 1 ? 'it' : 'them'} have not reached the catalogue yet.
          </span>
        </div>
      )}

      {loading ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center">
          <p className="text-zinc-400 text-sm">Loading invoices…</p>
        </div>
      ) : error ? (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-6 text-center">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      ) : invoices.length === 0 ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-10 text-center">
          <Receipt size={32} className="mx-auto text-zinc-600 mb-3" />
          <p className="text-zinc-300 font-medium">No invoices recorded yet</p>
          <p className="text-zinc-500 text-sm mt-1 max-w-md mx-auto">
            Convert a supplier's PDF invoice to CSV, paste it here, and the system
            checks it line by line against the order — then writes the real costs,
            discounts and all, back to the products.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {invoices.map((inv) => (
            <button
              key={inv.id}
              onClick={() => navigate(`/orders/invoices/${inv.id}`)}
              className="w-full text-left bg-zinc-900 border border-zinc-800 rounded-xl p-4 hover:border-zinc-700 transition-colors group"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-zinc-200 truncate">{inv.invoiceRef}</span>
                    <span className={`text-xs px-2 py-0.5 rounded ${STATUS_STYLES[inv.status] || STATUS_STYLES.draft}`}>
                      {inv.status === 'reconciled' ? (
                        <span className="inline-flex items-center gap-1"><Check size={11} />reconciled</span>
                      ) : 'draft'}
                    </span>
                  </div>
                  <div className="text-sm text-zinc-500 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                    <span className="text-zinc-400">{inv.supplier?.name || 'No supplier'}</span>
                    {inv.invoiceDate && <span>{formatDate(inv.invoiceDate)}</span>}
                    <span>{inv._count?.lines ?? 0} lines</span>
                    {inv.invoiceTotal != null && (
                      <span className="text-emerald-400">{money(inv.invoiceTotal)}</span>
                    )}
                    {!inv.orderId && <span className="text-amber-500/80">no PO linked</span>}
                  </div>
                </div>
                <ChevronRight size={18} className="shrink-0 text-zinc-600 group-hover:text-zinc-400" />
              </div>
            </button>
          ))}
        </div>
      )}

      {!showNew && invoices.some((i) => i.status === 'reconciled') && (
        <div className="pt-2 border-t border-zinc-800/60">
          <BackfillPanel />
        </div>
      )}
    </div>
  );
}
