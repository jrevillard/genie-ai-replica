'use strict';

require('../../setup-env');

jest.mock('../../../shared-lib', () => require('../../mocks/shared-lib'), { virtual: true });

const { parseCsv, parseCsvObjects } = require('../../../services/agri/csv');
const { fillMissingYears, projectedCpi } = require('../../../services/agri/estimation');
const { wfpRowToUsdPerKg, unitToKg, usdPerKgToQuintal, computeTrend } = require('../../../services/agri/series');
const { buildEnvelope, caveat, CAVEAT_CODES } = require('../../../services/agri/envelope');
const { parseRss } = require('../../../services/agri/adapters/_rss-factory');

describe('agri csv parser', () => {
  test('parses quoted fields with embedded commas, quotes and newlines', () => {
    const rows = parseCsv('a,b\n"x,1","he said ""hi"""\n"multi\nline",2');
    expect(rows).toEqual([
      ['a', 'b'],
      ['x,1', 'he said "hi"'],
      ['multi\nline', '2']
    ]);
  });

  test('handles CRLF and trailing newline without empty rows', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2']
    ]);
  });

  test('parseCsvObjects keys by header', () => {
    const objs = parseCsvObjects('date,price\n2026-08-15,26.61\n2026-07-15,25.9');
    expect(objs).toHaveLength(2);
    expect(objs[0]).toEqual({ date: '2026-08-15', price: '26.61' });
  });
});

describe('agri estimation engine (CPI fill)', () => {
  // CPI 2010=100 style: ~2-3%/yr
  const cpi = new Map([
    [2020, 100],
    [2021, 103],
    [2022, 106],
    [2023, 110],
    [2024, 113],
    [2025, 116]
  ]);

  test('fills a trailing gap from the last actual (FAOSTAT honey case)', () => {
    const { series, estimation } = fillMissingYears([{ year: 2022, value: 3.43 }], cpi, 2025);
    expect(series).toHaveLength(4);
    const est2025 = series.find((s) => s.date === '2025');
    expect(est2025.quality).toBe('estimated');
    expect(est2025.value).toBeCloseTo(3.43 * (116 / 106), 1);
    expect(estimation).toMatch(/inflation-adjusted/);
  });

  test('fills an interior gap and lets actuals override (WFP 2023-25 hole)', () => {
    const { series } = fillMissingYears(
      [
        { year: 2022, value: 25 },
        { year: 2026, value: 26.6 }
      ],
      cpi,
      2026
    );
    const dates = series.map((s) => s.date);
    expect(dates).toEqual(['2022', '2023', '2024', '2025', '2026']);
    const resumed = series.find((s) => s.date === '2026');
    expect(resumed.quality).toBe('actual');
    expect(resumed.value).toBe(26.6);
    expect(series.find((s) => s.date === '2023').quality).toBe('estimated');
  });

  test('bridges actual-to-actual when CPI estimate deviates > 15% at resume', () => {
    // CPI would say 2024 ≈ 100 * 113/103 = 109.7; actual resumes at 130 -> >15% off
    const { series } = fillMissingYears(
      [
        { year: 2021, value: 100 },
        { year: 2024, value: 130 }
      ],
      cpi,
      2024
    );
    const est2023 = series.find((s) => s.date === '2023');
    expect(est2023.quality).toBe('estimated');
    // Bridge path: between the pure CPI chain (~107) and linear (120)
    expect(est2023.value).toBeGreaterThan(110);
    expect(est2023.value).toBeLessThan(120);
  });

  test('projects CPI beyond the last published year and flags partial', () => {
    const projected = projectedCpi(
      new Map([
        [2023, 110],
        [2024, 113]
      ]),
      2026
    );
    expect(projected.has(2026)).toBe(true);
    // fillMissingYears takes PUBLISHED cpi and projects internally
    const { series } = fillMissingYears(
      [{ year: 2024, value: 10 }],
      new Map([
        [2023, 110],
        [2024, 113]
      ]),
      2026
    );
    expect(series.find((s) => s.date === '2026').partial).toBe(true);
  });

  test('no estimation when no gaps', () => {
    const { series, estimation } = fillMissingYears(
      [
        { year: 2023, value: 1 },
        { year: 2024, value: 2 },
        { year: 2025, value: 3 }
      ],
      cpi,
      2025
    );
    expect(series.every((s) => s.quality === 'actual')).toBe(true);
    expect(estimation).toBeNull();
  });
});

describe('agri series normalization', () => {
  test('unitToKg handles 45/46 KG drift and Libra', () => {
    expect(unitToKg('45 KG')).toBe(45);
    expect(unitToKg('46 KG')).toBe(46);
    expect(unitToKg('Libra')).toBeCloseTo(0.45359237);
  });

  test('wfpRowToUsdPerKg uses usdprice (never local price) and neutralizes quintal drift', () => {
    const a = wfpRowToUsdPerKg({ usdprice: '26.61', unit: '46 KG' });
    const b = wfpRowToUsdPerKg({ usdprice: '26.09', unit: '45 KG' });
    expect(a.usdPerKg).toBeCloseTo(b.usdPerKg, 2); // same quintal, no step artifact
    expect(a.isRetail).toBe(false);
    expect(wfpRowToUsdPerKg({ usdprice: '', unit: '46 KG' })).toBeNull();
  });

  test('quintal conversion', () => {
    expect(usdPerKgToQuintal(1)).toBeCloseTo(45.97);
  });

  test('computeTrend enforces min-3-observations rule', () => {
    expect(
      computeTrend([
        { date: '1', value: 1 },
        { date: '2', value: 2 }
      ])
    ).toBe('unknown');
    expect(
      computeTrend([
        { date: '1', value: 1 },
        { date: '2', value: 2 },
        { date: '3', value: 3 }
      ])
    ).toBe('up');
    expect(
      computeTrend([
        { date: '1', value: 3 },
        { date: '2', value: 3.01 },
        { date: '3', value: 3.02 }
      ])
    ).toBe('stable');
  });
});

describe('agri envelope + caveats', () => {
  test('builds envelope and filters unknown caveat codes', () => {
    const env = buildEnvelope(
      { x: 1 },
      {
        source: 'test',
        caveats: [caveat.regionalData('Nicaragua'), { code: 'NOT_A_CODE' }]
      }
    );
    expect(env.data).toEqual({ x: 1 });
    expect(env.meta.caveats).toEqual([{ code: 'REGIONAL_DATA', params: { country: 'Nicaragua' } }]);
    expect(CAVEAT_CODES).toContain('ESTIMATED_CPI');
  });
});

describe('agri RSS parsing', () => {
  test('extracts items with CDATA, entities and strips HTML from descriptions', () => {
    const xml = `<?xml version="1.0"?>
      <rss><channel>
        <item>
          <title><![CDATA[BCIE entrega al MAG nueva flota &amp; más]]></title>
          <link>https://www.mag.gob.sv/post-1</link>
          <pubDate>Mon, 14 Sep 2026 10:00:00 +0000</pubDate>
          <description><![CDATA[<p>El Ministerio recibió <b>camiones</b>.</p>]]></description>
        </item>
        <item><title>No link item</title></item>
      </channel></rss>`;
    const items = parseRss(xml);
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe('BCIE entrega al MAG nueva flota & más');
    expect(items[0].link).toBe('https://www.mag.gob.sv/post-1');
    expect(items[0].description).toBe('El Ministerio recibió camiones.');
    expect(items[1].link).toBeNull();
  });
});

describe('agri-service module wiring', () => {
  test('exports a shape index.js can resolve to a getInstance-capable class', () => {
    // Regression: index.js destructured `{ AgriService }` while the module
    // exported the class directly, crash-looping the deployed backend
    // (TypeError: Cannot read properties of undefined (reading 'getInstance')).
    const agriModule = require('../../../services/agri/agri-service');
    const AgriServiceClass = agriModule.AgriService || agriModule;
    expect(typeof AgriServiceClass).toBe('function');
    expect(typeof AgriServiceClass.getInstance).toBe('function');
  });
});

describe('agri-service init db wiring', () => {
  test('awaits the async shared-lib getConnection (real API returns a Promise)', async () => {
    // Regression: init stored the un-awaited Promise from the REAL
    // dbService.getConnection() (the mock returns synchronously), so every
    // this.db.collection() call failed on the deployed stack with
    // "this.db.collection is not a function".
    const { dbService } = require('../../../shared-lib');
    const stubColl = { document: jest.fn().mockResolvedValue(null), save: jest.fn().mockResolvedValue({}) };
    const stubDb = {
      createCollection: jest.fn().mockResolvedValue(undefined),
      collection: jest.fn().mockReturnValue(stubColl)
    };
    dbService.getConnection.mockImplementationOnce(() => Promise.resolve(stubDb));

    const prevPrefetch = process.env.AGRI_PREFETCH_ON_START;
    process.env.AGRI_PREFETCH_ON_START = '0'; // no upstream fetches from a unit test
    const AgriServiceCtor = require('../../../services/agri/agri-service');
    const svc = new AgriServiceCtor();
    try {
      await svc.init({});
      // this.db must be the resolved database handle, never a Promise
      expect(svc.db).toBe(stubDb);
      expect(typeof svc.db.then).not.toBe('function');
      expect(svc.db.createCollection).toHaveBeenCalled();
    } finally {
      process.env.AGRI_PREFETCH_ON_START = prevPrefetch;
      if (svc.scheduler) svc.scheduler.stop();
      if (svc.redis) svc.redis.disconnect();
      svc.initialized = false;
    }
  });
});
