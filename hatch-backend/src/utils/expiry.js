const MS_PER_DAY = 1000 * 60 * 60 * 24;

// UTC date-part as an epoch (expiry dates are stored as UTC-midnight dates, so
// calendar comparisons must also be done on UTC date parts).
function utcDatePart(d) {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Categorize stock batches by expiry urgency.
 * Returns { expired, critical (≤7 days), warning (>7 days, within threshold),
 * missing (no expiry recorded) }. Dated entries are annotated with daysUntil.
 *
 * daysUntil is a CALENDAR-day difference, not elapsed time: a batch whose
 * expiry date-part is before today's date-part is expired, and one expiring
 * today is daysUntil 0 → critical. (The old elapsed-time ceil() put stock that
 * expired a few hours ago in critical instead of expired.)
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

  const today = utcDatePart(now);

  for (const batch of batches) {
    if (!batch.expiryDate) {
      result.missing.push({ ...batch, daysUntil: null });
      continue;
    }

    const expiry = new Date(batch.expiryDate);
    const daysUntil = Math.round((utcDatePart(expiry) - today) / MS_PER_DAY);

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
