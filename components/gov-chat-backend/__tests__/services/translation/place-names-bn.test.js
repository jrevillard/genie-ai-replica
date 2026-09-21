const fs = require('fs');
const path = require('path');
const { PLACE_NAMES_BN } = require('../../../services/translation/place-names-bn');
const { DISTRICTS } = require('../../../services/bd-districts');

describe('PLACE_NAMES_BN', () => {
  test('covers every backend district plus the pilot sub-district', () => {
    const missing = DISTRICTS.map(([name]) => name).filter((n) => !PLACE_NAMES_BN.has(n));
    expect(missing).toEqual([]);
    expect(PLACE_NAMES_BN.get('Sapahar')).toBe('সাপাহার');
    expect(PLACE_NAMES_BN.get('Naogaon')).toBe('নওগাঁ');
  });

  test('every spelling is Bengali script only', () => {
    for (const [en, bn] of PLACE_NAMES_BN) {
      expect(bn).toMatch(/^[\p{Script=Bengali}\s]+$/u);
      expect(en).toMatch(/^[A-Za-z' ]+$/);
    }
  });

  test('stays in step with weather-mcp BENGALI_TO_ENGLISH (the source of truth)', () => {
    const py = path.resolve(__dirname, '../../../../weather-mcp-service/mcp_weather/tools/weather_forecast.py');
    if (!fs.existsSync(py)) return; // backend built standalone (CI image): nothing to compare
    const src = fs.readFileSync(py, 'utf8');
    const block = src.match(/^BENGALI_TO_ENGLISH\s*=\s*\{([\s\S]*?)^\}/m)[1];
    for (const [, bn, en] of block.matchAll(/"([^"]+)":\s*"([^"]+)"/g)) {
      expect(PLACE_NAMES_BN.get(en)).toBe(bn);
    }
  });
});
