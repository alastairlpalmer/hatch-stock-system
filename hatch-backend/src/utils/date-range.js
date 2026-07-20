// Shared end-of-range handling for sales/analytics date filters.
//
// Callers filter with an exclusive upper bound (`timestamp < end`). What that
// bound should be depends on what the client sent:
// - a day boundary (date-only string like "2026-07-15", or a Date at exactly
//   UTC midnight, e.g. from previousPeriod()) means "include the whole of that
//   day", so the bound is the start of the NEXT day
// - an explicit timestamp (string with a time part, or a mid-day Date) means
//   "include up to this instant", so the bound is that instant plus 1ms
//
// Historically every call site assumed date-only and always added a day, which
// made timestamp-suffixed endDates (e.g. "...T23:59:59.999" from older frontend
// builds, or the client-report default range) overshoot into the following day.
export function exclusiveEndBound(endDate) {
  const end = new Date(endDate);
  const atUtcMidnight =
    end.getUTCHours() === 0 && end.getUTCMinutes() === 0 &&
    end.getUTCSeconds() === 0 && end.getUTCMilliseconds() === 0;
  const isDayBoundary = endDate instanceof Date
    ? atUtcMidnight
    : !String(endDate).includes('T') || atUtcMidnight;
  if (isDayBoundary) {
    end.setUTCDate(end.getUTCDate() + 1);
  } else {
    end.setMilliseconds(end.getMilliseconds() + 1);
  }
  return end;
}
