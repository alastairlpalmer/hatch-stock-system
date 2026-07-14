import React, { useEffect, useMemo, useState } from 'react';
import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { CalendarDays, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Plus, X } from 'lucide-react';
import { restockPlannerService } from '../../../services/restockPlanner.service';
import { authService } from '../../../services/auth.service';
import useIsMobile from '../../../hooks/useIsMobile';

// Restock > Planner: Monday-first month calendar for the weekly cycle.
// Mondays render a virtual Restock slot and Fridays a virtual De-stock slot;
// the API only stores overrides (names, notes, cancellations) and ad-hoc
// in-week entries, keyed by (date, kind). Stock checks are matched to days
// by their local date, so a day's plan shows what was actually checked.

const KINDS = ['restock', 'destock'];

const KIND_META = {
  restock: {
    label: 'Restock',
    defaultDow: 1, // Monday
    pill: 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30',
    dot: 'bg-emerald-400',
  },
  destock: {
    label: 'De-stock',
    defaultDow: 5, // Friday
    pill: 'bg-amber-500/15 text-amber-300 border border-amber-500/30',
    dot: 'bg-amber-400',
  },
};

const dayKey = (date) => format(date, 'yyyy-MM-dd');

const isDefaultDay = (date, kind) => date.getDay() === KIND_META[kind].defaultDow;

// Resolve what a (day, kind) shows: a stored entry beats the virtual default.
function slotFor(date, kind, entriesByKey) {
  const entry = entriesByKey.get(`${dayKey(date)}|${kind}`) || null;
  const isDefault = isDefaultDay(date, kind);
  const active = entry ? entry.status === 'planned' : isDefault;
  return { kind, entry, isDefault, active, cancelled: isDefault && entry?.status === 'cancelled' };
}

export default function RestockPlanner() {
  const isMobile = useIsMobile();
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [entries, setEntries] = useState([]);
  const [stockChecks, setStockChecks] = useState([]);
  const [users, setUsers] = useState([]);
  const [selectedKey, setSelectedKey] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // The visible grid always spans whole Mon-Sun weeks around the month.
  const gridStart = startOfWeek(startOfMonth(month), { weekStartsOn: 1 });
  const gridEnd = endOfWeek(endOfMonth(month), { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  useEffect(() => {
    let stale = false;
    setLoading(true);
    setError(null);
    restockPlannerService
      .getRange(dayKey(gridStart), dayKey(gridEnd))
      .then((data) => {
        if (stale) return;
        setEntries(data.entries || []);
        setStockChecks(data.stockChecks || []);
      })
      .catch(() => !stale && setError('Could not load the planner. Check the connection and try again.'))
      .finally(() => !stale && setLoading(false));
    return () => { stale = true; };
    // gridStart/gridEnd derive from month
  }, [month]); // eslint-disable-line react-hooks/exhaustive-deps

  // Name suggestions for the assignee picker. Admin-gated once auth is on —
  // a 403 just means free-text entry, so failures are silent.
  useEffect(() => {
    authService.listUsers()
      .then((list) => setUsers(Array.isArray(list) ? list : []))
      .catch(() => setUsers([]));
  }, []);

  const entriesByKey = useMemo(
    () => new Map(entries.map((e) => [`${String(e.date).slice(0, 10)}|${e.kind}`, e])),
    [entries]
  );

  // Group checks by the browser's local date — "the check from that day".
  const checksByDay = useMemo(() => {
    const map = new Map();
    for (const check of stockChecks) {
      const key = dayKey(parseISO(check.createdAt));
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(check);
    }
    return map;
  }, [stockChecks]);

  const upsertLocal = (entry) => {
    const key = `${String(entry.date).slice(0, 10)}|${entry.kind}`;
    setEntries((prev) => [...prev.filter((e) => `${String(e.date).slice(0, 10)}|${e.kind}` !== key), entry]);
  };

  const removeLocal = (id) => setEntries((prev) => prev.filter((e) => e.id !== id));

  const selectedDay = selectedKey ? parseISO(selectedKey) : null;

  const editor = selectedDay && (
    <DayEditor
      key={selectedKey}
      day={selectedDay}
      slots={KINDS.map((kind) => slotFor(selectedDay, kind, entriesByKey))}
      checks={checksByDay.get(selectedKey) || []}
      users={users}
      onSaved={upsertLocal}
      onDeleted={removeLocal}
      onClose={() => setSelectedKey(null)}
      asModal={!isMobile}
    />
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold text-zinc-100 flex items-center gap-2">
            <CalendarDays className="w-5 h-5 text-emerald-400" />
            Restock Planner
          </h2>
          <p className="text-sm text-zinc-500">
            Mondays restock, Fridays de-stock — tap a day to add names, notes, or an extra in-week run.
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setMonth((m) => addMonths(m, -1))}
            aria-label="Previous month"
            className="p-2 rounded-lg bg-zinc-800 text-zinc-400 hover:text-white"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => setMonth(startOfMonth(new Date()))}
            className="px-3 py-2 rounded-lg bg-zinc-800 text-sm text-zinc-300 hover:text-white"
          >
            Today
          </button>
          <button
            onClick={() => setMonth((m) => addMonths(m, 1))}
            aria-label="Next month"
            className="p-2 rounded-lg bg-zinc-800 text-zinc-400 hover:text-white"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          {error}
        </div>
      )}

      <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-3 md:p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-medium text-zinc-100">{format(month, 'MMMM yyyy')}</h3>
          <div className="flex items-center gap-3 text-[11px] text-zinc-500">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400" /> Restock</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400" /> De-stock</span>
            <span className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-sky-400" /> Stock check</span>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-zinc-500 mb-1">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d}>{d}</div>)}
        </div>

        <div className={`grid grid-cols-7 gap-1 ${loading ? 'opacity-60' : ''}`}>
          {days.map((day) => {
            const key = dayKey(day);
            const slots = KINDS.map((kind) => slotFor(day, kind, entriesByKey)).filter((s) => s.active);
            const checks = checksByDay.get(key) || [];
            const inMonth = isSameMonth(day, month);
            const isToday = isSameDay(day, new Date());
            return (
              <button
                key={key}
                onClick={() => setSelectedKey(key)}
                className={`min-h-[64px] md:min-h-[88px] rounded-lg border p-1 md:p-1.5 text-left align-top transition-colors ${
                  selectedKey === key
                    ? 'border-emerald-500 bg-emerald-500/5'
                    : 'border-zinc-800 hover:border-zinc-600'
                } ${inMonth ? 'bg-zinc-900/60' : 'bg-zinc-950/40 opacity-50'}`}
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`text-[11px] md:text-xs w-5 h-5 flex items-center justify-center rounded-full ${
                      isToday ? 'bg-emerald-500 text-zinc-900 font-semibold' : 'text-zinc-400'
                    }`}
                  >
                    {format(day, 'd')}
                  </span>
                  {checks.length > 0 && (
                    <span className="flex items-center gap-0.5 text-[10px] text-sky-400">
                      <CheckCircle2 className="w-3 h-3" />
                      {checks.length}
                    </span>
                  )}
                </div>
                <div className="mt-1 space-y-0.5">
                  {slots.map((slot) => (
                    <div key={slot.kind}>
                      {/* Mobile: dot + initials. Desktop: labelled pill + names. */}
                      <div className="md:hidden flex items-center gap-1">
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${KIND_META[slot.kind].dot}`} />
                        <span className="text-[10px] text-zinc-400 truncate">
                          {initials(slot.entry?.assignees)}
                        </span>
                      </div>
                      <div className={`hidden md:block px-1.5 py-0.5 rounded text-[11px] truncate ${KIND_META[slot.kind].pill}`}>
                        {KIND_META[slot.kind].label}
                        {slot.entry?.assignees?.length > 0 && (
                          <span className="opacity-80"> · {slot.entry.assignees.join(', ')}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {editor}
    </div>
  );
}

function initials(assignees) {
  if (!assignees?.length) return '';
  return assignees.map((n) => n.trim().split(/\s+/).map((p) => p[0]).join('').toUpperCase().slice(0, 2)).join(' ');
}

function DayEditor({ day, slots, checks, users, onSaved, onDeleted, onClose, asModal }) {
  const body = (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-medium text-zinc-100">{format(day, 'EEEE d MMMM yyyy')}</h3>
        <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg text-zinc-500 hover:text-white hover:bg-zinc-800">
          <X className="w-4 h-4" />
        </button>
      </div>

      {slots.map((slot) => (
        <SlotEditor key={slot.kind} day={day} slot={slot} users={users} onSaved={onSaved} onDeleted={onDeleted} />
      ))}

      <div>
        <h4 className="text-sm font-medium text-zinc-300 mb-2 flex items-center gap-1.5">
          <CheckCircle2 className="w-4 h-4 text-sky-400" />
          Stock checks this day
        </h4>
        {checks.length === 0 ? (
          <p className="text-sm text-zinc-600">No stock checks logged for this day yet.</p>
        ) : (
          <div className="space-y-2">
            {checks.map((check) => <StockCheckCard key={check.id} check={check} />)}
          </div>
        )}
      </div>
    </div>
  );

  if (!asModal) {
    return <div className="bg-zinc-900/50 border border-zinc-800 rounded-xl p-4">{body}</div>;
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg max-h-[85vh] overflow-y-auto bg-zinc-900 border border-zinc-700 rounded-xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        {body}
      </div>
    </div>
  );
}

function SlotEditor({ day, slot, users, onSaved, onDeleted }) {
  const meta = KIND_META[slot.kind];
  const [open, setOpen] = useState(slot.active || slot.cancelled);
  const [assignees, setAssignees] = useState(slot.entry?.assignees || []);
  const [notes, setNotes] = useState(slot.entry?.notes || '');
  const [nameInput, setNameInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const date = dayKey(day);

  const save = async (status = 'planned', nextAssignees = assignees) => {
    setSaving(true);
    setSaveError(null);
    try {
      const entry = await restockPlannerService.saveEntry({
        date, kind: slot.kind, status, assignees: nextAssignees, notes: notes.trim() || null,
      });
      onSaved(entry);
      if (status === 'planned') setOpen(true);
    } catch {
      setSaveError('Save failed — try again.');
    } finally {
      setSaving(false);
    }
  };

  const revert = async () => {
    if (!slot.entry) return;
    setSaving(true);
    setSaveError(null);
    try {
      await restockPlannerService.deleteEntry(slot.entry.id);
      onDeleted(slot.entry.id);
      if (!slot.isDefault) setOpen(false);
      setAssignees([]);
      setNotes('');
    } catch {
      setSaveError('Could not remove — try again.');
    } finally {
      setSaving(false);
    }
  };

  const toggleName = (name) => {
    setAssignees((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]));
  };

  const addTypedName = () => {
    const name = nameInput.trim();
    if (!name) return;
    if (!assignees.includes(name)) setAssignees((prev) => [...prev, name]);
    setNameInput('');
  };

  // Inactive non-default day (or removed ad-hoc): offer the in-week add.
  if (!open && !slot.active && !slot.cancelled) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-zinc-700 text-sm text-zinc-400 hover:border-emerald-500/60 hover:text-emerald-300"
      >
        <Plus className="w-4 h-4" />
        Add {meta.label.toLowerCase()}
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-zinc-800 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className={`px-2 py-0.5 rounded text-xs ${meta.pill}`}>
          {meta.label}
          {slot.isDefault && <span className="opacity-70"> · weekly</span>}
        </span>
        {slot.cancelled ? (
          <button
            onClick={() => save('planned')}
            disabled={saving}
            className="text-xs text-emerald-400 hover:text-emerald-300 disabled:opacity-50"
          >
            Restore
          </button>
        ) : slot.isDefault ? (
          <button
            onClick={() => save('cancelled', [])}
            disabled={saving}
            className="text-xs text-zinc-500 hover:text-red-400 disabled:opacity-50"
          >
            Cancel this week
          </button>
        ) : slot.entry ? (
          <button onClick={revert} disabled={saving} className="text-xs text-zinc-500 hover:text-red-400 disabled:opacity-50">
            Remove
          </button>
        ) : null}
      </div>

      {slot.cancelled ? (
        <p className="text-sm text-zinc-600">Cancelled for this week.</p>
      ) : (
        <>
          <div>
            <p className="text-xs text-zinc-500 mb-1.5">Who&apos;s doing it</p>
            {users.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {users.map((user) => {
                  const name = user.name || user.email;
                  const on = assignees.includes(name);
                  return (
                    <button
                      key={user.id}
                      onClick={() => toggleName(name)}
                      className={`px-2 py-1 rounded-full text-xs border transition-colors ${
                        on
                          ? 'bg-emerald-500/15 border-emerald-500/50 text-emerald-300'
                          : 'border-zinc-700 text-zinc-400 hover:border-zinc-500'
                      }`}
                    >
                      {name}
                    </button>
                  );
                })}
              </div>
            )}
            {/* Names picked from Users when available; free text always works. */}
            <div className="flex gap-2">
              <input
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addTypedName()}
                placeholder="Add a name…"
                className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-emerald-500"
              />
              <button onClick={addTypedName} className="px-3 rounded-lg bg-zinc-800 text-sm text-zinc-300 hover:text-white">
                Add
              </button>
            </div>
            {assignees.filter((n) => !users.some((u) => (u.name || u.email) === n)).length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {assignees
                  .filter((n) => !users.some((u) => (u.name || u.email) === n))
                  .map((name) => (
                    <button
                      key={name}
                      onClick={() => toggleName(name)}
                      className="px-2 py-1 rounded-full text-xs border bg-emerald-500/15 border-emerald-500/50 text-emerald-300"
                    >
                      {name} ×
                    </button>
                  ))}
              </div>
            )}
          </div>

          <div>
            <p className="text-xs text-zinc-500 mb-1.5">Notes</p>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="Van, route, anything the runner should know…"
              className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => save('planned')}
              disabled={saving}
              className="px-4 py-1.5 rounded-lg bg-emerald-500 text-sm font-medium text-zinc-900 hover:bg-emerald-400 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            {saveError && <span className="text-xs text-red-400">{saveError}</span>}
          </div>
        </>
      )}
    </div>
  );
}

function StockCheckCard({ check }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950/50">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left"
      >
        <div className="flex-1 min-w-0">
          <p className="text-sm text-zinc-200 truncate">{check.locationName || 'Unknown location'}</p>
          <p className="text-xs text-zinc-500">
            {format(parseISO(check.createdAt), 'HH:mm')}
            {check.performedBy ? ` · ${check.performedBy}` : ''}
            {check.source ? ` · ${check.source}` : ''}
            {` · ${check.itemCount} items`}
          </p>
        </div>
        {check.varianceCount > 0 ? (
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 flex-shrink-0">
            {check.varianceCount} variance{check.varianceCount === 1 ? '' : 's'}
          </span>
        ) : (
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 flex-shrink-0">
            all match
          </span>
        )}
        <ChevronDown className={`w-4 h-4 text-zinc-600 flex-shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded && (
        <div className="border-t border-zinc-800 px-3 py-2 space-y-1">
          {check.items.map((item) => (
            <div key={item.sku} className="flex items-center gap-2 text-xs">
              <span className="flex-1 min-w-0 truncate text-zinc-300">{item.productName || item.sku}</span>
              <span className="text-zinc-500">
                {item.counted ?? '—'}/{item.expected ?? '—'}
              </span>
              {item.variance != null && Number(item.variance) !== 0 && (
                <span className="text-amber-400 w-10 text-right">
                  {Number(item.variance) > 0 ? '+' : ''}{item.variance}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
