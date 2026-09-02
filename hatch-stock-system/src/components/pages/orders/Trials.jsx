import React, { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { FlaskConical, Plus, Check, X, AlertTriangle, Clock } from 'lucide-react';
import productTrialsService from '../../../services/productTrials.service';
import { useStock } from '../../../context/StockContext';
import ProductSearchCombobox from '../../ui/ProductSearchCombobox';
import { useToast } from '../../ui/Toast';

const money = (n) => (n == null ? '—' : `£${Number(n).toFixed(2)}`);

function formatDate(iso, fmt = 'd MMM yyyy') {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : format(d, fmt);
}

// Verdicts get their own words and colour. `too_early`, `no_margin` and
// `no_sales` are deliberately neutral — none of them is a judgement on the
// product, and colouring them like a failure would train the operator to drop
// things too soon.
const VERDICT_META = {
  adopt: { label: 'Keep it', tone: 'emerald', Icon: Check },
  marginal: { label: 'Your call', tone: 'amber', Icon: AlertTriangle },
  reject: { label: 'Drop it', tone: 'red', Icon: X },
  too_early: { label: 'Too early', tone: 'zinc', Icon: Clock },
  no_margin: { label: 'Missing prices', tone: 'sky', Icon: AlertTriangle },
  // Not a verdict on the product — almost always a SKU that was never set up
  // in VendLive, so its sales never reach us.
  no_sales: { label: 'Check VendLive', tone: 'sky', Icon: AlertTriangle },
};

const TONE_STYLES = {
  emerald: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  amber: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  red: 'bg-red-500/15 text-red-400 border-red-500/30',
  zinc: 'bg-zinc-700/40 text-zinc-400 border-zinc-700',
  sky: 'bg-sky-500/15 text-sky-400 border-sky-500/30',
};

const STATUS_STYLES = {
  planned: 'bg-zinc-700 text-zinc-300',
  ordered: 'bg-sky-500/20 text-sky-400',
  live: 'bg-emerald-500/20 text-emerald-400',
  adopted: 'bg-emerald-500/20 text-emerald-400',
  rejected: 'bg-zinc-700 text-zinc-500',
};

/**
 * Start a trial.
 *
 * Two entry points in one panel: pick a product we already have in the
 * catalogue, or create one that does not exist yet. The second is the common
 * case and used to require a separate trip to the admin screens before the
 * product could even be searched for.
 */
function NewTrialPanel({ onCreated, onCancel }) {
  // addProduct rather than the raw service: it folds the new product into the
  // shared catalogue, so it is searchable everywhere else without a reload.
  const { data, addProduct } = useStock();
  const toast = useToast();

  const [mode, setMode] = useState('existing'); // 'existing' | 'new'
  const [sku, setSku] = useState('');
  const [newProduct, setNewProduct] = useState({
    sku: '', name: '', category: '', unitCost: '', salePrice: '', unitsPerBox: '1',
    preferredSupplierId: '', supplierCode: '', barcode: '',
  });
  const [locationIds, setLocationIds] = useState([]);
  const [trialQty, setTrialQty] = useState('8');
  const [weeks, setWeeks] = useState('4');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const locations = useMemo(
    () => (data.locations || []).filter((l) => !l.archivedAt),
    [data.locations],
  );

  const toggleLocation = (id) => {
    setLocationIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const num = (v) => (v === '' || v == null ? null : Number(v));

  const canSave = locationIds.length > 0
    && Number(trialQty) > 0
    && (mode === 'existing' ? !!sku : (newProduct.sku.trim() && newProduct.name.trim()));

  const save = async () => {
    if (!canSave || saving) return;
    setSaving(true);
    setError(null);
    try {
      let trialSku = sku;

      // Create the product first so the trial has something to hang off. Doing
      // it here rather than sending both in one call keeps the trial route
      // honest — it only ever trials a product that exists.
      if (mode === 'new') {
        const created = await addProduct({
          sku: newProduct.sku.trim(),
          name: newProduct.name.trim(),
          category: newProduct.category || null,
          unitCost: num(newProduct.unitCost),
          salePrice: num(newProduct.salePrice),
          unitsPerBox: num(newProduct.unitsPerBox) || 1,
          barcode: newProduct.barcode || null,
          preferredSupplierId: newProduct.preferredSupplierId || null,
          supplierCode: newProduct.supplierCode || null,
          lifecycle: 'trial',
        });
        trialSku = created.sku;
      }

      const trial = await productTrialsService.create({
        sku: trialSku,
        locationIds,
        trialQty: Number(trialQty),
        weeks: Number(weeks) || 4,
        notes: notes || null,
      });
      toast.success('Trial started — it will appear on the next weekly buy');
      onCreated(trial);
    } catch (err) {
      const res = err.response?.data;
      setError(res?.error || 'Could not start the trial — check the connection and try again.');
      setSaving(false);
    }
  };

  const field = 'w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-teal-500';
  const label = 'block text-xs text-zinc-500 mb-1';

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 sm:p-5 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold text-zinc-100">Trial a product</h3>
        <button onClick={onCancel} className="text-xs text-zinc-500 hover:text-zinc-300">Cancel</button>
      </div>

      <div className="flex gap-2">
        {[
          { id: 'existing', label: 'Product we already have' },
          { id: 'new', label: "Something we don't stock yet" },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setMode(t.id)}
            className={`px-3 py-2 rounded text-sm transition-colors ${
              mode === t.id ? 'bg-emerald-500 text-zinc-900' : 'bg-zinc-800 text-zinc-400 hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {mode === 'existing' ? (
        <div>
          <label className={label}>Product</label>
          <ProductSearchCombobox
            products={data.products || []}
            value={sku}
            onSelect={setSku}
            recentsKey="hatch-recent-products-trial"
          />
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          <div>
            <label className={label}>SKU *</label>
            <input value={newProduct.sku} onChange={(e) => setNewProduct({ ...newProduct, sku: e.target.value })} placeholder="NEW-BAR-01" className={field} />
          </div>
          <div className="col-span-2">
            <label className={label}>Name *</label>
            <input value={newProduct.name} onChange={(e) => setNewProduct({ ...newProduct, name: e.target.value })} placeholder="Protein Bar — Peanut" className={field} />
          </div>
          <div>
            <label className={label}>Category</label>
            <input value={newProduct.category} onChange={(e) => setNewProduct({ ...newProduct, category: e.target.value })} placeholder="Snacks" className={field} />
          </div>
          <div>
            <label className={label}>Cost £</label>
            <input type="number" step="0.01" min="0" value={newProduct.unitCost} onChange={(e) => setNewProduct({ ...newProduct, unitCost: e.target.value })} placeholder="—" className={field} />
          </div>
          <div>
            <label className={label}>Sell £</label>
            <input type="number" step="0.01" min="0" value={newProduct.salePrice} onChange={(e) => setNewProduct({ ...newProduct, salePrice: e.target.value })} placeholder="—" className={field} />
          </div>
          <div>
            <label className={label}>Units/box</label>
            <input type="number" min="1" value={newProduct.unitsPerBox} onChange={(e) => setNewProduct({ ...newProduct, unitsPerBox: e.target.value })} className={field} />
          </div>
          <div>
            <label className={label}>Supplier</label>
            <select value={newProduct.preferredSupplierId} onChange={(e) => setNewProduct({ ...newProduct, preferredSupplierId: e.target.value })} className={field}>
              <option value="">—</option>
              {(data.suppliers || []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className={label}>Their code</label>
            <input value={newProduct.supplierCode} onChange={(e) => setNewProduct({ ...newProduct, supplierCode: e.target.value })} placeholder="BW-771" className={field} />
          </div>
          <div>
            <label className={label}>Barcode</label>
            <input value={newProduct.barcode} onChange={(e) => setNewProduct({ ...newProduct, barcode: e.target.value })} placeholder="—" className={field} />
          </div>
          <p className="col-span-full text-[11px] text-zinc-600">
            Cost and sell price are what the verdict is calculated from — without
            both, the trial can only be judged on units moved.
          </p>
        </div>
      )}

      <div>
        <label className={label}>Machines to trial in *</label>
        <div className="flex flex-wrap gap-2">
          {locations.map((loc) => (
            <button
              key={loc.id}
              onClick={() => toggleLocation(loc.id)}
              className={`px-3 py-2 rounded text-sm border transition-colors ${
                locationIds.includes(loc.id)
                  ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300'
                  : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {loc.name}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <label className={label}>Units per machine *</label>
          <input type="number" min="1" value={trialQty} onChange={(e) => setTrialQty(e.target.value)} className={field} />
        </div>
        <div>
          <label className={label}>Run for (weeks)</label>
          <input type="number" min="1" max="26" value={weeks} onChange={(e) => setWeeks(e.target.value)} className={field} />
        </div>
        <div className="col-span-2">
          <label className={label}>Notes</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Why we're trying it" className={field} />
        </div>
      </div>

      {locationIds.length > 0 && Number(trialQty) > 0 && (
        <p className="text-xs text-zinc-500">
          The next weekly buy will order <strong className="text-zinc-300">{locationIds.length * Number(trialQty)} units</strong>{' '}
          ({Number(trialQty)} × {locationIds.length} machine{locationIds.length === 1 ? '' : 's'}), and the pick list
          will place them. The clock starts when the stock reaches a machine.
        </p>
      )}

      {error && <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-sm text-red-400">{error}</div>}

      <div className="flex justify-end">
        <button
          onClick={save}
          disabled={!canSave || saving}
          className="px-4 py-2.5 bg-emerald-500 text-zinc-900 rounded text-sm font-medium hover:bg-emerald-400 disabled:opacity-50"
        >
          {saving ? 'Starting…' : 'Start trial'}
        </button>
      </div>
    </div>
  );
}

function TrialCard({ trial, onChanged }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const meta = VERDICT_META[trial.verdict?.verdict] || VERDICT_META.too_early;
  const { Icon } = meta;
  const decided = trial.status === 'adopted' || trial.status === 'rejected';

  const decide = async (decision) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await productTrialsService.decide(trial.id, decision);
      toast.success(res.nextStep);
      onChanged();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not save that decision — try again.');
      setBusy(false);
    }
  };

  const start = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await productTrialsService.start(trial.id);
      toast.success('Trial clock started');
      onChanged();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not start the clock — try again.');
      setBusy(false);
    }
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-zinc-200">{trial.product?.name || trial.sku}</span>
            <span className={`text-xs px-2 py-0.5 rounded ${STATUS_STYLES[trial.status]}`}>{trial.status}</span>
          </div>
          <div className="text-xs text-zinc-500 mt-1 flex flex-wrap gap-x-3">
            <span className="font-mono">{trial.sku}</span>
            <span>{trial.trialQty} per machine</span>
            <span>{(trial.locations || []).map((l) => l.name).join(', ') || 'no machines'}</span>
            {trial.startedAt && <span>Started {formatDate(trial.startedAt)}</span>}
          </div>
        </div>
        <span className={`shrink-0 inline-flex items-center gap-1 text-xs px-2 py-1 rounded border ${TONE_STYLES[meta.tone]}`}>
          <Icon size={12} />
          {meta.label}
        </span>
      </div>

      {/* Progress through the window */}
      {trial.window?.started && (
        <div>
          <div className="flex justify-between text-[11px] text-zinc-500 mb-1">
            <span>{trial.window.tradingDaysElapsed} of {trial.window.plannedTradingDays} selling days</span>
            <span>{trial.window.progressPct}%</span>
          </div>
          <div className="h-1.5 bg-zinc-800 rounded overflow-hidden">
            <div
              className={`h-full ${trial.window.windowComplete ? 'bg-emerald-500' : 'bg-teal-600'}`}
              style={{ width: `${trial.window.progressPct}%` }}
            />
          </div>
        </div>
      )}

      {/* The numbers behind the verdict */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <div>
          <div className="text-[11px] uppercase text-zinc-600">Sold</div>
          <div className="text-zinc-200">{trial.unitsSold ?? 0}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase text-zinc-600">Per day</div>
          <div className="text-zinc-200">{trial.verdict?.unitsPerDay ?? 0}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase text-zinc-600">Margin/day</div>
          <div className="text-zinc-200">{money(trial.verdict?.marginPerDay)}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase text-zinc-600">Typical facing</div>
          <div className="text-zinc-400">{money(trial.benchmark)}</div>
        </div>
      </div>

      <p className="text-xs text-zinc-400">{trial.verdict?.reason}</p>

      {trial.notes && <p className="text-xs text-zinc-600 italic">{trial.notes}</p>}

      {decided ? (
        <p className="text-xs text-zinc-500">
          {trial.decision === 'adopt' ? 'Adopted' : 'Rejected'} {formatDate(trial.decidedAt)}
          {trial.decisionNote ? ` — ${trial.decisionNote}` : ''}
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {!trial.window?.started && (
            <button
              onClick={start}
              disabled={busy}
              className="px-3 py-2 bg-zinc-800 text-zinc-200 rounded text-sm hover:bg-zinc-700 disabled:opacity-50"
            >
              It's in the machine — start the clock
            </button>
          )}
          <button
            onClick={() => decide('adopt')}
            disabled={busy}
            className="px-3 py-2 bg-emerald-500 text-zinc-900 rounded text-sm font-medium hover:bg-emerald-400 disabled:opacity-50"
          >
            Keep it
          </button>
          <button
            onClick={() => decide('reject')}
            disabled={busy}
            className="px-3 py-2 bg-zinc-800 text-zinc-300 rounded text-sm hover:bg-zinc-700 disabled:opacity-50"
          >
            Drop it
          </button>
        </div>
      )}
    </div>
  );
}

export default function Trials() {
  const [trials, setTrials] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [showDecided, setShowDecided] = useState(false);

  const load = async () => {
    try {
      setTrials(await productTrialsService.getAll());
      setError(null);
    } catch (err) {
      console.error('Failed to load trials:', err);
      setError('Failed to load trials — check the connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const open = trials.filter((t) => !['adopted', 'rejected'].includes(t.status));
  const decided = trials.filter((t) => ['adopted', 'rejected'].includes(t.status));
  // A trial whose window is done and whose verdict is a real call is the thing
  // that needs a human this week.
  const awaitingDecision = open.filter(
    (t) => t.window?.windowComplete && ['adopt', 'marginal', 'reject'].includes(t.verdict?.verdict),
  ).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Trials</h2>
          <p className="text-sm text-zinc-500 mt-0.5">
            New products, bought and placed on purpose, judged against what a normal facing earns.
          </p>
        </div>
        {!showNew && (
          <button
            onClick={() => setShowNew(true)}
            className="flex items-center justify-center gap-1.5 px-3 py-2.5 bg-emerald-500 text-zinc-900 rounded text-sm font-medium hover:bg-emerald-400 transition-colors"
          >
            <Plus size={16} />
            Trial a product
          </button>
        )}
      </div>

      {showNew && (
        <NewTrialPanel
          onCancel={() => setShowNew(false)}
          onCreated={() => { setShowNew(false); load(); }}
        />
      )}

      {awaitingDecision > 0 && !showNew && (
        <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-sm text-amber-300">
          <AlertTriangle size={16} className="shrink-0" />
          <span>
            {awaitingDecision} trial{awaitingDecision === 1 ? ' has' : 's have'} run their course and
            need a decision — until then {awaitingDecision === 1 ? 'it keeps' : 'they keep'} taking
            a facing and appearing on the weekly buy.
          </span>
        </div>
      )}

      {loading ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center text-sm text-zinc-400">Loading trials…</div>
      ) : error ? (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-6 text-center text-sm text-red-400">{error}</div>
      ) : trials.length === 0 ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-10 text-center">
          <FlaskConical size={32} className="mx-auto text-zinc-600 mb-3" />
          <p className="text-zinc-300 font-medium">No trials running</p>
          <p className="text-zinc-500 text-sm mt-1 max-w-md mx-auto">
            The weekly buy only ever reorders what the machines already sell. A trial
            is how something new gets bought, placed and measured — pick the machines
            and the quantity, and it joins the next buying list and pick list on its own.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {open.map((t) => <TrialCard key={t.id} trial={t} onChanged={load} />)}

          {decided.length > 0 && (
            <>
              <button
                onClick={() => setShowDecided((v) => !v)}
                className="text-sm text-zinc-500 hover:text-zinc-300 py-1"
              >
                {showDecided ? 'Hide' : 'Show'} {decided.length} decided trial{decided.length === 1 ? '' : 's'}
              </button>
              {showDecided && decided.map((t) => <TrialCard key={t.id} trial={t} onChanged={load} />)}
            </>
          )}
        </div>
      )}
    </div>
  );
}
