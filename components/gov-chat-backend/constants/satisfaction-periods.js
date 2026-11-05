/**
 * Week-axis constants of the satisfaction heatmap/gauge series.
 *
 * The payload carries these stable keys instead of display text: the frontend
 * translates them through its i18n bundle (`analytics.timePeriods.*`).
 * Localizing them here would duplicate every translation outside the only
 * place that owns them (#220).
 *
 * The frontend keeps its own copy of the key list (the two do not share a
 * build); the contract test in the frontend suite keeps the two in step.
 */

// The period keys, most recent first.
const SATISFACTION_PERIOD_KEYS = ['current', 'week1', 'week2', 'week3', 'week4'];

// The first two periods carry the gauge's headline numbers.
const [CURRENT_PERIOD_KEY, PREVIOUS_PERIOD_KEY] = SATISFACTION_PERIOD_KEYS;

// Length of one period, in milliseconds.
const SATISFACTION_WEEK_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

module.exports = {
  SATISFACTION_PERIOD_KEYS,
  CURRENT_PERIOD_KEY,
  PREVIOUS_PERIOD_KEY,
  SATISFACTION_WEEK_DURATION_MS
};
