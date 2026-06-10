const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * Categorize stock batches by expiry urgency.
 * Returns { expired, critical (≤7 days), warning (>7 days, within threshold),
 * missing (no expiry recorded) }. Dated entries are annotated with daysUntil.
 *
 * Batches with no expiry date are NOT dropped — they go in `missing` so the
 * expiry tracking UI can surface them for correction. (Stock can be signed in
 * without an expiry; it must remain visible, not silently untracked.)
 */
export function categorizeBatchesByExpiry(batches, now = new Date()) {
  const result = {
    expired: [],
    critical: [], // <= 7 days
    warning: [],  // within the queried threshold
    missing: [],  // no expiry recorded
  };

  for (const batch of batches) {
    if (!batch.expiryDate) {
      result.missing.push({ ...batch, daysUntil: null });
      continue;
    }

    const expiry = new Date(batch.expiryDate);
    const daysUntil = Math.ceil((expiry - now) / MS_PER_DAY);

    if (daysUntil < 0) {
      result.expired.push({ ...batch, daysUntil });
    } else if (daysUntil <= 7) {
      result.critical.push({ ...batch, daysUntil });
    } else {
      result.warning.push({ ...batch, daysUntil });
    }
  }

  return result;
}
