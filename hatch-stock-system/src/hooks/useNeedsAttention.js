import { useState, useEffect, useMemo, useCallback } from 'react';
import { useStock } from '../context/StockContext';
import { vendliveService } from '../services/vendlive.service';
import { inventoryService } from '../services/inventory.service';
import { attentionService } from '../services/attention.service';
import { productParentsService } from '../services/productParents.service';
import usePickLists from './usePickLists';
import { daysUntilExpiry } from '../utils/expiryDays';

// Builds the Dashboard's prioritised "Needs attention" list. Free items come
// straight from StockContext and render immediately; three independent
// fail-silent fetches (VendLive health, machine expiry, pick lists) merge in
// as they arrive — a failed fetch just means that item group is absent,
// matching the app's independent-sections idiom.
//
// NOTE: health and machine-expiry deliberately duplicate the Dashboard
// panels' own cheap GETs rather than sharing lifted state — the panels have
// different lifecycles (the health panel polls every 5 min, this fetches
// once), so the two can briefly disagree after a panel refresh. Cosmetic.

const dateOnly = (v) => (typeof v === 'string' ? v.slice(0, 10) : new Date(v).toISOString().slice(0, 10));

function relativeTime(ts) {
  if (!ts) return 'never';
  const mins = Math.floor((Date.now() - new Date(ts).getTime()) / 60000);
  if (!Number.isFinite(mins) || mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function useNeedsAttention() {
  const { data } = useStock();

  const [health, setHealth] = useState(null);
  const [healthDone, setHealthDone] = useState(false);
  const [expiryRows, setExpiryRows] = useState([]);
  const [expiryDone, setExpiryDone] = useState(false);
  // Admin dismissals (server-shared). Fail-soft like the other fetches: if
  // the endpoint is unreachable nothing is hidden.
  const [dismissals, setDismissals] = useState([]);
  // Product groups (fail-soft like the rest): used to spot new flavours that
  // name-match a group but were never assigned to it.
  const [productParents, setProductParents] = useState([]);
  // Flavour starvation: family stock looks fine but the best seller is at 0.
  const [starvation, setStarvation] = useState([]);
  const { lists: pickLists, loading: pickListsLoading } = usePickLists({ limit: 20 });

  useEffect(() => {
    let cancelled = false;
    vendliveService.getHealth()
      .then((h) => { if (!cancelled) setHealth(h); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setHealthDone(true); });
    inventoryService.getMachineExpiry(7)
      .then((res) => { if (!cancelled) setExpiryRows(res.rows || []); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setExpiryDone(true); });
    attentionService.getDismissals()
      .then((res) => { if (!cancelled) setDismissals(Array.isArray(res) ? res : []); })
      .catch(() => {});
    productParentsService.getAll()
      .then((res) => { if (!cancelled) setProductParents(Array.isArray(res) ? res : []); })
      .catch(() => {});
    productParentsService.getStarvation()
      .then((res) => { if (!cancelled) setStarvation(Array.isArray(res?.items) ? res.items : []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const items = useMemo(() => {
    const out = [];

    // ---- red ----

    // 0. A DISABLED sync outranks a stale one: with stock or product sync off,
    // quantities silently drift and each week's new rotating flavours never
    // enter the catalog — and previously nothing anywhere in the UI said so
    // (stock sync sat off for six days in July 2026 before anyone noticed).
    if (health && Array.isArray(health.syncsDisabled) && health.syncsDisabled.length > 0) {
      out.push({
        id: 'sync-disabled',
        severity: 'red',
        title: `VendLive ${health.syncsDisabled.join(' + ')} sync switched OFF`,
        detail: 'stock and product data are not updating',
        to: '/support/settings',
      });
    }

    // 1. Stale sync taints every number below it — always ranked first.
    if (health && ((health.salesSync?.enabled && health.salesSync?.stale) || (health.stockSync?.enabled && health.stockSync?.stale))) {
      const salesStale = health.salesSync?.enabled && health.salesSync?.stale;
      out.push({
        id: 'sync-stale',
        severity: 'red',
        title: 'VendLive sync stale',
        detail: salesStale
          ? `sales last synced ${relativeTime(health.salesSync.lastSuccessAt)}`
          : `stock last synced ${relativeTime(health.stockSync.lastSyncAt)}`,
        to: '/support/settings',
      });
    }

    // 2/9. Machines with sold-out / low configured items (same computation as
    // MachineOverview — configured SKUs only, non-archived locations).
    let outLocations = 0;
    let lowLocations = 0;
    (data.locations || []).filter((l) => !l.archivedAt).forEach((loc) => {
      const stock = data.locationStock?.[loc.id] || {};
      const config = data.locationConfig?.[loc.id] || {};
      let hasOut = false;
      let hasLow = false;
      Object.entries(config).forEach(([sku, c]) => {
        const qty = stock[sku] || 0;
        if (c?.maxStock != null || c?.minStock != null) {
          if (qty === 0) hasOut = true;
          else if (c?.minStock != null && qty < c.minStock) hasLow = true;
        }
      });
      if (hasOut) outLocations += 1;
      else if (hasLow) lowLocations += 1;
    });
    if (outLocations > 0) {
      out.push({
        id: 'machines-out',
        severity: 'red',
        title: `${outLocations} machine${outLocations === 1 ? ' has' : 's have'} sold-out items`,
        to: '/locations',
      });
    }

    // 3/5. Warehouse batch expiry (same thresholds as the Dashboard panels).
    const liveBatches = (data.stockBatches || []).filter((b) => b.remainingQty > 0 && b.expiryDate);
    let expiredCount = 0;
    let expiredUnits = 0;
    let criticalCount = 0;
    liveBatches.forEach((b) => {
      const daysUntil = daysUntilExpiry(b.expiryDate);
      if (daysUntil < 0) { expiredCount += 1; expiredUnits += b.remainingQty; }
      else if (daysUntil <= 7) criticalCount += 1;
    });
    if (expiredCount > 0) {
      out.push({
        id: 'batches-expired',
        severity: 'red',
        title: `${expiredCount} expired batch${expiredCount === 1 ? '' : 'es'} in the warehouse`,
        detail: `${expiredUnits} unit${expiredUnits === 1 ? '' : 's'} to write off`,
        to: '/warehouse',
      });
    }

    // 4/10. Expiring inside machines (fetched).
    const expiringSoonRows = expiryRows.filter((r) => r.daysUntil <= 2);
    const expiringLaterRows = expiryRows.filter((r) => r.daysUntil > 2);
    if (expiringSoonRows.length > 0) {
      out.push({
        id: 'machine-expiry-soon',
        severity: 'red',
        title: `${expiringSoonRows.length} item${expiringSoonRows.length === 1 ? '' : 's'} in machines expire within 2 days`,
        to: '/locations',
      });
    }
    if (criticalCount > 0) {
      out.push({
        id: 'batches-critical',
        severity: 'red',
        title: `${criticalCount} warehouse batch${criticalCount === 1 ? '' : 'es'} expire within 7 days`,
        to: '/warehouse',
      });
    }

    // ---- amber ----

    // 6. Orders waiting to be received (one merged row).
    const pending = (data.orders || []).filter((o) => o.status === 'pending');
    const partial = pending.filter((o) => (o.items || []).some((i) => (i.receivedQty || 0) > 0));
    if (pending.length > 0) {
      out.push({
        id: 'orders-to-receive',
        severity: 'amber',
        title: `${pending.length} order${pending.length === 1 ? '' : 's'} to receive`,
        detail: partial.length > 0 ? `${partial.length} partially received` : null,
        to: '/orders/receive',
      });
    }

    // 7. Draft pick lists due (date-only compare avoids TZ off-by-one).
    const today = dateOnly(new Date());
    const drafts = pickLists.filter((l) => l.status === 'draft');
    const dueDrafts = drafts.filter((l) => l.targetDate && dateOnly(l.targetDate) <= today);
    const relevantDrafts = dueDrafts.length > 0 ? dueDrafts : drafts;
    if (relevantDrafts.length > 0) {
      const soonest = dueDrafts[0];
      out.push({
        id: 'picklists-draft',
        severity: 'amber',
        title: `${relevantDrafts.length} draft pick list${relevantDrafts.length === 1 ? '' : 's'} to pack`,
        detail: soonest?.targetDate ? `due ${dateOnly(soonest.targetDate)}` : null,
        to: '/restock/picklists',
      });
    }

    // 8. In-flight/finished list with shortfalls — the run left short.
    // 'packed' is the legacy two-step status; new-flow lists move
    // draft → in_progress → completed.
    const shortStatuses = new Set(['packed', 'in_progress', 'completed']);
    const shortPacked = pickLists
      .filter((l) => shortStatuses.has(l.status) && Array.isArray(l.shortfalls) && l.shortfalls.length > 0)
      .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))[0];
    if (shortPacked) {
      out.push({
        id: 'picklist-shortfalls',
        severity: 'amber',
        title: `Pick list has ${shortPacked.shortfalls.length} shortfall${shortPacked.shortfalls.length === 1 ? '' : 's'}`,
        to: `/restock/picklists/${shortPacked.id}`,
      });
    }

    // 9. Machines running low (locations with low-but-nothing-out).
    if (lowLocations > 0) {
      out.push({
        id: 'machines-low',
        severity: 'amber',
        title: `${lowLocations} machine${lowLocations === 1 ? ' is' : 's are'} running low`,
        to: '/locations',
      });
    }

    // 10. Expiring in machines within the week (rows already flagged red excluded).
    if (expiringLaterRows.length > 0) {
      out.push({
        id: 'machine-expiry-week',
        severity: 'amber',
        title: `${expiringLaterRows.length} item${expiringLaterRows.length === 1 ? '' : 's'} in machines expire within 7 days`,
        to: '/locations',
      });
    }

    // 11. VendLive housekeeping (one aggregated row).
    if (health) {
      const q = health.quarantine?.unresolved || 0;
      const u = health.unmappedMachines || 0;
      const e = health.errorsLast24h || 0;
      if (q > 0 || u > 0 || e > 0) {
        out.push({
          id: 'vendlive-housekeeping',
          severity: 'amber',
          title: 'VendLive needs attention',
          detail: [q > 0 && `${q} quarantined`, u > 0 && `${u} unmapped`, e > 0 && `${e} errors in 24h`]
            .filter(Boolean).join(' · '),
          to: '/support/settings',
        });
      }
    }

    // 11b. A family's total stock hides a starved best-seller: the machine
    // shows "Barebells: 8" while chocolate — the flavour people actually buy —
    // sits at zero. Parent-level min/max can't catch this, and the missing
    // sales also skew the data behind the order split, so it self-reinforces.
    if (starvation.length > 0) {
      out.push({
        id: 'family-flavour-starved',
        severity: 'amber',
        title: `${starvation.length} machine${starvation.length === 1 ? '' : 's'} stock a family but not its best-selling flavour`,
        detail: starvation.slice(0, 2).map((s) => `${s.flavourName} at ${s.locationName}`).join(' · '),
        to: '/locations',
      });
    }

    // 12. Products that look like they belong to a product group but aren't
    // assigned — the usual cause is a new flavour auto-created by VendLive
    // sync, which arrives with no group and silently misses family-level
    // reporting/ordering. Matched on "<group name> " as a name prefix.
    if (productParents.length > 0) {
      const assigned = new Set(
        productParents.flatMap((pp) => (pp.products || []).map((m) => m.sku))
      );
      const groupNames = productParents.map((pp) => pp.name.toLowerCase());
      const orphans = (data.products || []).filter((p) =>
        !p.isFreshMeal && !assigned.has(p.sku) &&
        groupNames.some((n) => (p.name || '').toLowerCase().startsWith(`${n} `)));
      if (orphans.length > 0) {
        out.push({
          id: 'product-group-orphans',
          severity: 'amber',
          title: `${orphans.length} product${orphans.length === 1 ? '' : 's'} name-match a product group but aren't in it`,
          detail: orphans.slice(0, 3).map((p) => p.name).join(' · '),
          to: '/support/settings',
        });
      }
    }

    // red first, catalogue order within severity (push order already encodes rank).
    return [...out.filter((i) => i.severity === 'red'), ...out.filter((i) => i.severity === 'amber')];
  }, [data, health, expiryRows, pickLists, productParents, starvation]);

  // A dismissal hides an item only while its SIGNATURE (rendered title, which
  // carries the counts) still matches and it is under 7 days old — a changed
  // signal or a week's silence resurfaces it.
  const DISMISSAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const { visibleItems, dismissedItems } = useMemo(() => {
    const active = new Map(
      dismissals
        .filter((d) => Date.now() - new Date(d.createdAt).getTime() < DISMISSAL_TTL_MS)
        .map((d) => [d.itemId, d.signature])
    );
    const visible = [];
    const hidden = [];
    items.forEach((item) => {
      if (active.get(item.id) === item.title) hidden.push(item);
      else visible.push(item);
    });
    return { visibleItems: visible, dismissedItems: hidden };
  }, [items, dismissals]);

  // Optimistic dismiss/restore; server errors roll the local state back by
  // refetching (simplest correct recovery).
  const dismiss = useCallback(async (item) => {
    setDismissals((prev) => [
      ...prev.filter((d) => d.itemId !== item.id),
      { itemId: item.id, signature: item.title, createdAt: new Date().toISOString() },
    ]);
    try {
      await attentionService.dismiss(item.id, item.title);
    } catch {
      attentionService.getDismissals().then((res) => setDismissals(Array.isArray(res) ? res : [])).catch(() => {});
    }
  }, []);

  const restore = useCallback(async (itemId) => {
    setDismissals((prev) => prev.filter((d) => d.itemId !== itemId));
    try {
      await attentionService.restore(itemId);
    } catch {
      attentionService.getDismissals().then((res) => setDismissals(Array.isArray(res) ? res : [])).catch(() => {});
    }
  }, []);

  const loading = !healthDone || !expiryDone || pickListsLoading;

  return {
    items: visibleItems,
    dismissedItems,
    allClear: !loading && visibleItems.length === 0,
    loading,
    dismiss,
    restore,
  };
}
