/**
 * Match legacy (CSV-imported) sale rows against VendLive-synced rows to find
 * duplicates of the same physical vend stored twice.
 *
 * Background: when the VendLive integration was first enabled, the poll
 * backfilled the full sales history, re-creating sales that had already been
 * imported from CSV exports (under different ids, so the unique constraint
 * could not catch them). Diagnosed June 2026: 427 duplicated rows inflating
 * revenue by ~£1,109.
 *
 * Matching is per-SKU, one-to-one, nearest-timestamp within a tolerance
 * (CSV timestamps are minute-rounded; observed skew is 0–1 minute). The
 * one-to-one pairing means two genuine same-SKU purchases minutes apart each
 * consume their own VendLive row and are never both flagged against one row.
 *
 * The VendLive copy is the one to KEEP: it records what was actually paid
 * (CSV exports carry list price even for discounted vends), tracks refunds,
 * and carries machine metadata.
 *
 * Returns [{ legacyId, vendliveId, sku, timestamp, charged }].
 */
export function findLegacyDuplicates(legacyRows, vendliveRows, toleranceMs = 5 * 60 * 1000) {
  const bySku = new Map();
  for (const v of vendliveRows) {
    if (!bySku.has(v.sku)) bySku.set(v.sku, []);
    bySku.get(v.sku).push({ id: v.id, t: new Date(v.timestamp).getTime(), used: false });
  }

  const duplicates = [];
  const sorted = [...legacyRows].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  for (const legacy of sorted) {
    const t = new Date(legacy.timestamp).getTime();
    const candidates = (bySku.get(legacy.sku) || [])
      .filter(v => !v.used && Math.abs(v.t - t) <= toleranceMs)
      .sort((a, b) => Math.abs(a.t - t) - Math.abs(b.t - t));
    if (candidates.length === 0) continue;
    candidates[0].used = true;
    duplicates.push({
      legacyId: legacy.id,
      vendliveId: candidates[0].id,
      sku: legacy.sku,
      timestamp: legacy.timestamp,
      charged: legacy.charged || 0,
    });
  }
  return duplicates;
}
