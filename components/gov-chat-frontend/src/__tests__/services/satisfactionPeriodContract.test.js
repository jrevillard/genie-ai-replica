// Cross-boundary contract: the period keys the analytics service emits must
// match the frontend's key list, and every shipped locale catalogue must
// carry a distinct translation for each of them.
//
// The backend owns the vocabulary (SATISFACTION_PERIOD_KEYS) and the frontend
// owns the wording (analytics.timePeriods.*). Nothing in either component
// suite can see the other side, so a rename on one side would ship a raw key
// to the dashboard with every test still green. This test is that gate.
const fs = require('fs');
const path = require('path');

const { SATISFACTION_PERIOD_KEYS } = require('../../utils/satisfactionPeriods.js');
const {
  SATISFACTION_PERIOD_KEYS: BACKEND_PERIOD_KEYS
} = require('../../../../gov-chat-backend/constants/satisfaction-periods.js');

const localesDir = path.resolve(__dirname, '../../i18n/locales');

const localeCatalogues = () =>
  fs
    .readdirSync(localesDir)
    .filter((file) => file.endsWith('.js'))
    .map((file) => ({ locale: path.basename(file, '.js'), messages: require(path.join(localesDir, file)).default }));

describe('satisfaction period key contract', () => {
  it('emits the same period keys as the frontend expects', () => {
    expect(BACKEND_PERIOD_KEYS).toEqual(SATISFACTION_PERIOD_KEYS);
  });

  it.each(localeCatalogues())('ships a distinct translation for every key in $locale', ({ messages }) => {
    const timePeriods = messages.analytics.timePeriods;

    SATISFACTION_PERIOD_KEYS.forEach((key) => {
      expect(typeof timePeriods[key]).toBe('string');
      expect(timePeriods[key].length).toBeGreaterThan(0);
    });

    // The heatmap groups its columns by the translated x value: two keys
    // sharing a string would silently collapse two weeks into one column.
    const translations = SATISFACTION_PERIOD_KEYS.map((key) => timePeriods[key]);
    expect(new Set(translations).size).toBe(SATISFACTION_PERIOD_KEYS.length);
  });
});
