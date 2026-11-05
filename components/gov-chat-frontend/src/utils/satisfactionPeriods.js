/**
 * The satisfaction period keys the analytics service emits, and the i18n path
 * that carries their display text.
 *
 * The backend owns the vocabulary (SATISFACTION_PERIOD_KEYS in
 * components/gov-chat-backend/services/analytics-service.js); the contract
 * test in src/__tests__/services/satisfactionPeriodContract.test.js keeps the
 * two sides in step.
 */
export const SATISFACTION_PERIOD_KEYS = ['current', 'week1', 'week2', 'week3', 'week4'];

const LABEL_PATH_PREFIX = 'analytics.timePeriods.';

/**
 * Translate a satisfaction period key into its display text. A value that is
 * not a period key is returned unchanged.
 * @param {String} key - Period key (e.g. 'week2') or a plain label
 * @param {Object} i18n - vue-i18n instance
 * @returns {String} The translated label
 */
export function periodLabel(key, i18n) {
  if (!i18n || typeof i18n.t !== 'function') {
    return key;
  }
  const path = `${LABEL_PATH_PREFIX}${key}`;
  const translation = i18n.t(path);
  return translation === path ? key : translation;
}
