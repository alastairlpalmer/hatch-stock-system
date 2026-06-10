const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * Categorize stock batches by expiry urgency.
 * Returns { expired, critical (≤7 days), warning (>7 days, within threshold) },
 * each entry annotated with daysUntil.
 */
export function categorizeBatchesByExpiry(batches, now = new Date()) {
  const result = {
    expired: [],
    critical: [], // <= 7 days
    warning: [],  // within the queried threshold
  };

  for (const batch of batches) {
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
