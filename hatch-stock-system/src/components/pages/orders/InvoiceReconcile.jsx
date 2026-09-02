import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { format } from 'date-fns';
import { ArrowLeft, AlertTriangle, Check, TrendingUp, TrendingDown, Trash2 } from 'lucide-react';
import invoicesService from '../../../services/invoices.service';
import { useToast } from '../../ui/Toast';

const money = (n) => (n == null ? '—' : `£${Number(n).toFixed(2)}`);
// Unit costs are compared at four decimals internally but shown at three —
// enough to see a half-penny move on a 40p line without printing float noise.
const unitMoney = (n) => (n == null ? '—' : `£${Number(n).toFixed(3)}`);
const signed = (n) => (n == null ? '—' : `${n > 0 ? '+' : ''}${Number(n).toFixed(2)}`);

function formatDate(iso, fmt = 'd MMM yyyy') {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : format(d, fmt);
}

// Every flag is a specific accusation, so each gets its own words rather than
// a generic "variance" chip the operator has to decode.
const FLAG_LABELS = {
  not_on_order: { text: 'Not on the order', tone: 'red' },
  not_invoiced: { text: 'Not invoiced', tone: 'zinc' },
  over_invoiced: { text: 'Billed for more than arrived', tone: 'red' },
  under_invoiced: { text: 'Billed for less than arrived', tone: 'amber' },
  price_up: { text: 'Price up', tone: 'red' },
  price_down: { text: 'Price down', tone: 'emerald' },
};

const TONE_STYLES = {
  red: 'bg-red-500/15 text-red-400',
  amber: 'bg-amber-500/15 text-amber-400',
  emerald: 'bg-emerald-500/15 text-emerald-400',
  zinc: 'bg-zinc-700/50 text-zinc-400',
};

function FlagChip({ flag }) {
  const meta = FLAG_LABELS[flag] || { text: flag, tone: 'zinc' };
  return (
    <span className={`text-[11px] px-1.5 py-0.5 rounded whitespace-nowrap ${TONE_STYLES[meta.tone]}`}>
      {meta.text}
    </span>
  );
}

function Stat({ label, value, tone = 'zinc', hint }) {
  const valueTone = {
    zinc: 'text-zinc-100',
    emerald: 'text-emerald-400',
    red: 'text-red-400',
    amber: 'text-amber-400',
  }[tone];
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-3">
      <div className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`text-lg font-semibold mt-0.5 ${valueTone}`}>{value}</div>
      {hint && <div className="text-[11px] text-zinc-600 mt-0.5">{hint}</div>}
    </div>
  );
}

export default function InvoiceReconcile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();

  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  // Reconciling without updating costs is the escape hatch for a one-off price
  // (a promo, a sample order) that shouldn't become the standing cost.
  const [updateCosts, setUpdateCosts] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await invoicesService.getById(id);
      setInvoice(res);
      setError(null);
    } catch (err) {
      console.error('Failed to load invoice:', err);
      setError(err.response?.status === 404
        ? 'That invoice no longer exists.'
        : 'Failed to load the invoice — check the connection and try again.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const reconcile = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await invoicesService.reconcile(id, { updateCosts });
      const changes = res.priceChanges?.length || 0;
      toast.success(
        changes > 0
          ? `Reconciled — ${changes} product cost${changes === 1 ? '' : 's'} updated`
          : 'Reconciled — no cost changes',
      );
      if (res.codesLearned > 0) {
        toast.success(`Learned ${res.codesLearned} supplier code${res.codesLearned === 1 ? '' : 's'} — next invoice will match them automatically`);
      }
      await load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not reconcile — try again.');
    } finally {
      setBusy(false);
    }
  };

  const unreconcile = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await invoicesService.unreconcile(id);
      toast.success('Reopened for editing — the costs it wrote stay as they are');
      await load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not reopen — try again.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await invoicesService.delete(id);
      navigate('/orders/invoices');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not delete — try again.');
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center text-sm text-zinc-400">Loading invoice…</div>;
  }
  if (error) {
    return (
      <div className="space-y-4">
        <button onClick={() => navigate('/orders/invoices')} className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200">
          <ArrowLeft size={16} /> Invoices
        </button>
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-6 text-center text-sm text-red-400">{error}</div>
      </div>
    );
  }

  const { reconciliation: rec, lines } = invoice;
  const isReconciled = invoice.status === 'reconciled';
  const unmatchedLines = lines.filter((l) => !l.sku);
  const varianceTone = (rec.totals.totalValueVariance ?? 0) > 0.5 ? 'red'
    : (rec.totals.totalValueVariance ?? 0) < -0.5 ? 'emerald' : 'zinc';

  return (
    <div className="space-y-5">
      <button onClick={() => navigate('/orders/invoices')} className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200">
        <ArrowLeft size={16} /> Invoices
      </button>

      {/* ---- Header ---- */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-xl font-semibold">{invoice.invoiceRef}</h2>
            <span className={`text-xs px-2 py-0.5 rounded ${isReconciled ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}`}>
              {isReconciled ? 'reconciled' : 'draft'}
            </span>
          </div>
          <div className="text-sm text-zinc-500 mt-1 flex flex-wrap gap-x-3">
            <span className="text-zinc-400">{invoice.supplier?.name || 'No supplier'}</span>
            {invoice.invoiceDate && <span>{formatDate(invoice.invoiceDate)}</span>}
            {invoice.order
              ? <span>PO {formatDate(invoice.order.createdAt)} · {invoice.order.status}</span>
              : <span className="text-amber-500/80">No PO linked</span>}
            {isReconciled && invoice.reconciledAt && (
              <span className="text-zinc-600">Reconciled {formatDate(invoice.reconciledAt)}</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isReconciled ? (
            <button
              onClick={unreconcile}
              disabled={busy}
              className="px-3 py-2.5 bg-zinc-800 text-zinc-300 rounded text-sm hover:bg-zinc-700 disabled:opacity-50"
            >
              Reopen
            </button>
          ) : (
            <>
              {confirmDelete ? (
                <span className="flex items-center gap-2 text-xs">
                  <span className="text-zinc-400">Delete?</span>
                  <button onClick={remove} disabled={busy} className="text-red-400 hover:text-red-300 font-medium">Yes</button>
                  <button onClick={() => setConfirmDelete(false)} className="text-zinc-500 hover:text-zinc-300">No</button>
                </span>
              ) : (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="p-2.5 text-zinc-500 hover:text-red-400 rounded"
                  aria-label="Delete invoice"
                >
                  <Trash2 size={16} />
                </button>
              )}
              <button
                onClick={reconcile}
                disabled={busy}
                className="px-4 py-2.5 bg-emerald-500 text-zinc-900 rounded text-sm font-medium hover:bg-emerald-400 disabled:opacity-50"
              >
                {busy ? 'Working…' : 'Accept & reconcile'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* ---- Money summary ---- */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Order expected" value={money(rec.totals.orderExpected)} hint="PO at catalogue cost" />
        <Stat label="Invoiced" value={money(rec.totals.invoicedValue)} hint="after all discounts" />
        <Stat
          label="Difference"
          value={signed(rec.totals.totalValueVariance)}
          tone={varianceTone}
          hint={(rec.totals.totalValueVariance ?? 0) > 0 ? 'more than expected' : 'less than expected'}
        />
        <Stat
          label="Lines to check"
          value={String(rec.counts.issues)}
          tone={rec.counts.issues > 0 ? 'amber' : 'emerald'}
          hint={`of ${rec.counts.total}`}
        />
      </div>

      {/* ---- Things that need a human before reconciling ---- */}
      {rec.totals.headerMismatch != null && (
        <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-sm text-amber-300">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>
            The lines add up to {money(rec.totals.linesTotal)}, but the invoice total
            implies goods of {money(rec.totals.expectedTotal)} — a gap of{' '}
            <strong>{signed(rec.totals.headerMismatch)}</strong>. Usually a line
            missed in the paste, or a keying slip in the header figures.
          </span>
        </div>
      )}

      {unmatchedLines.length > 0 && (
        <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm text-red-300">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span>
            {unmatchedLines.length} line{unmatchedLines.length === 1 ? '' : 's'} matched no
            product — {unmatchedLines.map((l) => l.rawName || l.rawCode).filter(Boolean).join(', ')}.
            {isReconciled ? ' Their costs were not recorded.' : ' Their costs will not be recorded. Reopen the paste to match them, or accept and lose those lines.'}
          </span>
        </div>
      )}

      {invoice.spreadDelivery && (
        <p className="text-xs text-zinc-500">
          Delivery of {money(invoice.deliveryCharge)} is spread across the products, so unit costs include it.
        </p>
      )}

      {/* ---- The comparison ---- */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-zinc-800">
          <h3 className="font-medium text-zinc-200 text-sm">Ordered · received · invoiced</h3>
          <p className="text-[11px] text-zinc-600 mt-0.5">
            Quantity is compared against what was received where a delivery has been
            booked in, and against what was ordered otherwise.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead>
              <tr className="text-left text-[11px] uppercase text-zinc-500 border-b border-zinc-800">
                <th className="py-2 px-4 font-medium">Product</th>
                <th className="py-2 px-3 font-medium text-right">Ordered</th>
                <th className="py-2 px-3 font-medium text-right">Received</th>
                <th className="py-2 px-3 font-medium text-right">Invoiced</th>
                <th className="py-2 px-3 font-medium text-right">Expected £</th>
                <th className="py-2 px-3 font-medium text-right">Paid £</th>
                <th className="py-2 px-3 font-medium text-right">Value diff</th>
                <th className="py-2 px-4 font-medium">Flags</th>
              </tr>
            </thead>
            <tbody>
              {rec.rows.map((row) => (
                <tr
                  key={row.sku}
                  className={`border-b border-zinc-800/60 ${row.ok ? '' : 'bg-zinc-800/20'}`}
                >
                  <td className="py-2 px-4">
                    <div className="text-zinc-200">{row.name}</div>
                    <div className="text-[11px] text-zinc-600 font-mono">{row.sku}</div>
                  </td>
                  <td className="py-2 px-3 text-right text-zinc-400">{row.orderedQty || '—'}</td>
                  <td className="py-2 px-3 text-right text-zinc-400">{row.receivedQty || '—'}</td>
                  <td className={`py-2 px-3 text-right ${row.qtyVariance !== 0 ? 'text-amber-400 font-medium' : 'text-zinc-300'}`}>
                    {row.invoicedQty || '—'}
                    {row.qtyVariance !== 0 && (
                      <span className="block text-[11px]">{signed(row.qtyVariance)}</span>
                    )}
                  </td>
                  <td className="py-2 px-3 text-right text-zinc-500">{unitMoney(row.expectedUnitPrice)}</td>
                  <td className="py-2 px-3 text-right text-zinc-200">
                    {unitMoney(row.invoicedUnitCost)}
                    {row.priceVariancePct != null && Math.abs(row.priceVariancePct) >= 1 && (
                      <span className={`block text-[11px] inline-flex items-center gap-0.5 ${row.priceVariancePct > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                        {row.priceVariancePct > 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                        {Math.abs(row.priceVariancePct).toFixed(1)}%
                      </span>
                    )}
                  </td>
                  <td className={`py-2 px-3 text-right ${(row.valueVariance ?? 0) > 0 ? 'text-red-400' : (row.valueVariance ?? 0) < 0 ? 'text-emerald-400' : 'text-zinc-500'}`}>
                    {row.valueVariance != null ? signed(row.valueVariance) : '—'}
                  </td>
                  <td className="py-2 px-4">
                    <div className="flex flex-wrap gap-1">
                      {row.ok
                        ? <Check size={14} className="text-emerald-500" />
                        : row.flags.map((f) => <FlagChip key={f} flag={f} />)}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ---- What accepting will do ---- */}
      {!isReconciled && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
          <h3 className="font-medium text-zinc-200 text-sm">What "accept & reconcile" does</h3>
          <ul className="text-sm text-zinc-400 space-y-1.5 list-disc list-inside">
            <li>Writes the invoiced quantity and price onto the purchase order lines.</li>
            <li>
              Updates each product's cost to what we actually paid — line and
              whole-invoice discounts applied — and records the change in its price
              history.
            </li>
            <li>Locks those costs so the nightly VendLive sync can't overwrite them.</li>
            <li>Learns this supplier's product codes from any line you matched by hand.</li>
          </ul>
          <label className="flex items-start gap-2 text-xs text-zinc-400 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={updateCosts}
              onChange={(e) => setUpdateCosts(e.target.checked)}
              className="mt-0.5 accent-emerald-500"
            />
            <span>
              Update product costs from this invoice.
              {!updateCosts && (
                <strong className="text-amber-400"> Off — the invoice is recorded but standing costs stay put (use for one-off promo prices).</strong>
              )}
            </span>
          </label>
        </div>
      )}

      {invoice.notes && (
        <div className="text-sm text-zinc-400">
          <span className="text-zinc-600">Notes: </span>{invoice.notes}
        </div>
      )}
    </div>
  );
}
