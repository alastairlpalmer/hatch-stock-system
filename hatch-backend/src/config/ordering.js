/**
 * Default ordering parameters for purchase-order generation.
 *
 * A location may override these via locations.lead_time_days / cover_days
 * (see manual-sql/006_ordering_config.sql); when its column is NULL the app
 * falls back to the constants here. Keep these as the single source of the
 * fallbacks so the API, the suggestion engine and any reporting agree.
 */
export const DEFAULT_LEAD_TIME_DAYS = 3; // order placed -> stock in hand
export const DEFAULT_COVER_DAYS = 7;     // days of demand to top up to

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
