/**
 * Trading-day (Mon–Fri) calendar utilities for the ordering cycle.
 *
 * The machines only sell Monday–Friday: stock is ordered midweek (Wed/Thu) for
 * weekend delivery, machines are restocked the following Monday morning, and
 * machine stock is frozen Friday night → Monday. All of the ordering maths
 * therefore counts TRADING days, not calendar days.
 *
 * All functions work on CALENDAR DAYS using the UTC date parts of the passed
 * Date objects. Callers pass server-now; sub-day timezone drift (a server in a
 * different zone flipping the calendar day a few hours early/late) is an
 * accepted approximation for these coarse day-level calculations.
 */

const DAY_MS = 86_400_000;

/** Whole days since the Unix epoch for a date's UTC calendar day. */
function utcDayNumber(date) {
  const d = new Date(date);
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / DAY_MS);
}

/** Day of week (0=Sun … 6=Sat) for an epoch day number. Day 0 was a Thursday. */
function dayOfWeek(dayNumber) {
  return (((dayNumber + 4) % 7) + 7) % 7;
}

const isTradingDayNumber = (dayNumber) => {
  const dow = dayOfWeek(dayNumber);
  return dow >= 1 && dow <= 5;
};

/** UTC-midnight Date for an epoch day number. */
const dateFromDayNumber = (dayNumber) => new Date(dayNumber * DAY_MS);

/** True when the date's UTC calendar day falls Monday–Friday. */
export function isTradingDay(date) {
  return isTradingDayNumber(utcDayNumber(date));
}

/**
 * Number of Mon–Fri days STRICTLY AFTER `from`'s calendar day and STRICTLY
 * BEFORE `to`'s calendar day (both endpoints excluded).
 */
export function countTradingDaysBetween(from, to) {
  const start = utcDayNumber(from);
  const end = utcDayNumber(to);
  let count = 0;
  for (let d = start + 1; d < end; d++) {
    if (isTradingDayNumber(d)) count++;
  }
  return count;
}

/**
 * Inclusive count of Mon–Fri days whose calendar day falls within
 * [start, end] (both endpoints included). Returns 0 when end < start.
 */
export function countTradingDaysInWindow(start, end) {
  const s = utcDayNumber(start);
  const e = utcDayNumber(end);
  let count = 0;
  for (let d = s; d <= e; d++) {
    if (isTradingDayNumber(d)) count++;
  }
  return count;
}

/**
 * The next Monday STRICTLY after the date's calendar day (a Monday input
 * returns the FOLLOWING Monday, +7 days). Returned at UTC midnight.
 */
export function nextMonday(date) {
  let d = utcDayNumber(date) + 1;
  while (dayOfWeek(d) !== 1) d++;
  return dateFromDayNumber(d);
}

/**
 * The next Mon–Fri day STRICTLY after the date's calendar day (a Friday or
 * Saturday input returns the following Monday). Returned at UTC midnight.
 */
export function nextTradingDay(date) {
  let d = utcDayNumber(date) + 1;
  while (!isTradingDayNumber(d)) d++;
  return dateFromDayNumber(d);
}
