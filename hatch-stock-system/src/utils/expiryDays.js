// Calendar-day expiry math, mirroring the backend's rule exactly
// (hatch-backend/src/utils/expiry.js): expiry dates are UTC-midnight dates, so
// the difference is taken on UTC date-parts, not elapsed time. The old
// frontend Math.ceil((expiry - now) / DAY) approach mis-bucketed stock that
// expired hours ago as "critical" instead of "expired", and its labels could
// disagree with the backend's pick-list warnings by a day.

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function utcDatePart(d) {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * Whole calendar days until the expiry date: negative = expired,
 * 0 = expires today, null = no/invalid date.
 */
export function daysUntilExpiry(expiryDate, now = new Date()) {
  if (!expiryDate) return null;
  const expiry = new Date(expiryDate);
  if (Number.isNaN(expiry.getTime())) return null;
  return Math.round((utcDatePart(expiry) - utcDatePart(now)) / MS_PER_DAY);
}
