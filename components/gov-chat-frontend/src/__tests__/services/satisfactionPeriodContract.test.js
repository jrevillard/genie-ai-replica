// Cross-boundary contract: the period keys the analytics service emits must
// exist, and must stay distinct, in every shipped locale catalogue.
//
// The backend owns the vocabulary (SATISFACTION_PERIOD_KEYS) and the frontend
// owns the wording (analytics.timePeriods.*). Nothing in either component
// suite can see the other side, so a rename on one side would ship a raw key
// to the dashboard with every test still green. This test is that gate.
const fs = require('fs');
const path = require('path');

const backendServicePath = path.resolve(__dirname, '../../../../gov-chat-backend/services/analytics-service.js');
const localesDir = path.resolve(__dirname, '../../i18n/locales');

const backendKeys = () => {
  const source = fs.readFileSync(backendServicePath, 'utf8');
  const declaration = source.match(/SATISFACTION_PERIOD_KEYS\s*=\s*\[([^\]]*)\]/);
  expect(declaration).not.toBeNull();
  return [...declaration[1].matchAll(/'([^']+)'/g)].map((match) => match[1]);
};

const localeCatalogues = () =>
  fs
    .readdirSync(localesDir)
    .filter((file) => file.endsWith('.js'))
    .map((file) => ({ locale: path.basename(file, '.js'), messages: require(path.join(localesDir, file)).default }));

describe('satisfaction period key contract', () => {
  const keys = backendKeys();

  it('reads the period keys from the analytics service', () => {
    expect(keys).toEqual(['current', 'week1', 'week2', 'week3', 'week4']);
  });

  it.each(localeCatalogues())('ships a distinct translation for every key in $locale', ({ messages }) => {
    const timePeriods = messages.analytics.timePeriods;

    keys.forEach((key) => {
      expect(typeof timePeriods[key]).toBe('string');
      expect(timePeriods[key].length).toBeGreaterThan(0);
    });

    // The heatmap groups its columns by the translated x value: two keys
    // sharing a string would silently collapse two weeks into one column.
    const translations = keys.map((key) => timePeriods[key]);
    expect(new Set(translations).size).toBe(keys.length);
  });
});
