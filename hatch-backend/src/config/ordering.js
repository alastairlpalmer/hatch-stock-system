/**
 * Default ordering parameters for purchase-order generation.
 *
 * A location may override these via locations.lead_time_days / cover_days
 * (see manual-sql/006_ordering_config.sql); when its column is NULL the app
 * falls back to the constants here. Keep these as the single source of the
 * fallbacks so the API, the suggestion engine and any reporting agree.
 */
export const DEFAULT_LEAD_TIME_DAYS = 3; // order placed -> stock in hand

// coverDays is interpreted as TRADING days (Mon–Fri — the machines only sell
// on weekdays). 5 trading days = one full selling week, matching the weekly
// order → weekend delivery → Monday restock cycle.
export const DEFAULT_COVER_DAYS = 5;     // trading days of demand to top up to

// Trailing windows (CALENDAR days) over which sales velocity is measured. We
// compute a short and a long window and blend them: the short window reacts to
// recent demand shifts, the long one smooths weekly noise. Velocity itself is
// expressed per TRADING day: units in the window ÷ Mon–Fri days in the window.
export const VELOCITY_WINDOW_DAYS = { short: 14, long: 28 };

// Recency-weighted blend of the two windows. Weights must sum to 1.
export const VELOCITY_BLEND_WEIGHTS = { short: 0.6, long: 0.4 };

/**
 * Blend short- and long-window velocities (units/trading-day) into a single
 * figure.
 */
export function blendVelocity(vShort, vLong) {
  return (
    (vShort || 0) * VELOCITY_BLEND_WEIGHTS.short +
    (vLong || 0) * VELOCITY_BLEND_WEIGHTS.long
  );
}

/**
 * Resolve the effective ordering config for a location, applying defaults for
 * any unset (null/undefined) override.
 * @param {{ leadTimeDays?: number|null, coverDays?: number|null }} [location]
 */
export function resolveOrderingConfig(location = {}) {
  return {
    leadTimeDays: location.leadTimeDays ?? DEFAULT_LEAD_TIME_DAYS,
    coverDays: location.coverDays ?? DEFAULT_COVER_DAYS,
  };
}
