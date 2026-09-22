'use strict';

require('../../setup-env');

jest.mock('../../../shared-lib', () => require('../../mocks/shared-lib'), { virtual: true });

const { buildEnvelope, caveat } = require('../../../services/agri/envelope');

/**
 * Replicate the gap-derivation algorithm from buildMarketPrices so we can
 * unit-test it without spinning up the full AgriService + database.
 *
 * @param {Array<{data: Array<{date:string}>}>} series
 * @returns {string|null} gap range or null
 */
function deriveGapRange(series) {
  const GAP_THRESHOLD_MS = 365 * 24 * 60 * 60 * 1000;
  let gapRange = null;
  for (const s of series) {
    const dates = s.data
      .map((p) => p.date)
      .filter(Boolean)
      .sort();
    for (let i = 1; i < dates.length; i++) {
      const dt = Date.parse(dates[i]) - Date.parse(dates[i - 1]);
      if (dt > GAP_THRESHOLD_MS) {
        const yr0 = dates[i - 1].slice(0, 4);
        const yr1 = dates[i].slice(0, 4);
        const candidate = `${yr0}–${yr1}`;
        if (!gapRange || candidate.length > gapRange.length) gapRange = candidate;
      }
    }
  }
  return gapRange;
}

/**
 * Replicate the single-market derivation from buildMarketPrices.
 *
 * @param {Array<{market:?string}>} series
 * @returns {string|null} the sole market or null
 */
function deriveSingleMarket(series) {
  const markets = new Set(series.map((s) => s.market).filter(Boolean));
  if (markets.size === 1) return [...markets][0];
  return null;
}

describe('agri envelope — gap-derivation algorithm', () => {
  test('synthetic 2-year gap emits gapYears with correct range', () => {
    const series = [
      {
        name: 'Maize (white)',
        country: 'SV',
        market: 'San Salvador',
        data: [
          { date: '2023-01-01', value: 25.0 },
          { date: '2023-06-01', value: 26.0 },
          { date: '2023-12-01', value: 27.0 },
          // 2-year gap: 2023-12 to 2025-12
          { date: '2025-12-01', value: 28.0 },
          { date: '2026-01-01', value: 29.0 }
        ]
      }
    ];

    const gapRange = deriveGapRange(series);
    expect(gapRange).toBe('2023–2025');
  });

  test('series with no gap returns null', () => {
    const series = [
      {
        name: 'Beans (red)',
        country: 'SV',
        market: 'San Salvador',
        data: [
          { date: '2024-01-01', value: 30.0 },
          { date: '2024-06-01', value: 31.0 },
          { date: '2025-01-01', value: 32.0 }
        ]
      }
    ];

    expect(deriveGapRange(series)).toBeNull();
  });

  test('normal monthly cadence (< 1 year between points) returns null', () => {
    const series = [
      {
        name: 'Rice',
        country: 'SV',
        market: 'San Salvador',
        data: Array.from({ length: 24 }, (_, i) => ({
          date: `2024-${String(i + 1).padStart(2, '0')}-01`,
          value: 25.0
        }))
      }
    ];

    expect(deriveGapRange(series)).toBeNull();
  });
});

describe('agri envelope — single-market derivation', () => {
  test('two different markets returns null (no singleMarket caveat)', () => {
    const series = [
      { name: 'Maize (white)', market: 'San Salvador', data: [] },
      { name: 'Maize (white)', market: 'Santa Ana', data: [] }
    ];

    expect(deriveSingleMarket(series)).toBeNull();
  });

  test('one unique market returns that market', () => {
    const series = [
      { name: 'Maize (white)', market: 'San Salvador', data: [] },
      { name: 'Beans (red)', market: 'San Salvador', data: [] }
    ];

    expect(deriveSingleMarket(series)).toBe('San Salvador');
  });

  test('null/undefined markets are excluded from set', () => {
    const series = [
      { name: 'Maize (white)', market: null, data: [] },
      { name: 'Beans (red)', market: null, data: [] }
    ];

    expect(deriveSingleMarket(series)).toBeNull();
  });
});

describe('agri envelope — buildEnvelope caveat filtering', () => {
  test('gapYears caveat is accepted by buildEnvelope', () => {
    const gapRange = '2023–2025';
    const env = buildEnvelope(
      { series: [], unit: 'USD/kg', trend: 'unknown', latest: null },
      { caveats: [caveat.gapYears(gapRange)], source: 'test' }
    );

    expect(env.meta.caveats).toHaveLength(1);
    expect(env.meta.caveats[0]).toEqual({ code: 'GAP_YEARS', params: { range: gapRange } });
  });

  test('singleMarket caveat is accepted by buildEnvelope', () => {
    const env = buildEnvelope(
      { series: [], unit: 'USD/kg', trend: 'unknown', latest: null },
      { caveats: [caveat.singleMarket('San Salvador')], source: 'test' }
    );

    expect(env.meta.caveats).toHaveLength(1);
    expect(env.meta.caveats[0]).toEqual({ code: 'SINGLE_MARKET', params: { market: 'San Salvador' } });
  });

  test('unknown caveat codes are silently dropped', () => {
    const env = buildEnvelope(
      { series: [], unit: 'USD/kg', trend: 'unknown', latest: null },
      { caveats: [{ code: 'UNKNOWN_CODE', params: {} }], source: 'test' }
    );

    expect(env.meta.caveats).toHaveLength(0);
  });
});
