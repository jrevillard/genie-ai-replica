'use strict';

require('../../setup-env');

jest.mock('../../../shared-lib', () => require('../../mocks/shared-lib'), { virtual: true });

const wfpSlv = require('../../../services/agri/adapters/wfp-slv');
const hdxNdvi = require('../../../services/agri/adapters/hdx-ndvi');
const oirsa = require('../../../services/agri/adapters/oirsa');
const gdelt = require('../../../services/agri/adapters/gdelt');
const comtrade = require('../../../services/agri/adapters/comtrade');
const blsPpi = require('../../../services/agri/adapters/bls-ppi');

describe('wfp adapters (fixture: real schema from the 2026-09-16 verification)', () => {
  const csvFixture = [
    'date,admin1,admin2,market,market_id,latitude,longitude,category,commodity,commodity_id,unit,priceflag,pricetype,currency,price,usdprice',
    '2026-08-15,San Salvador,San Salvador,San Salvador,1,13.7,-89.2,cereals and tubers,Maize (white),58,46 KG,actual,wholesale,USD,26.61,26.61',
    '2026-08-15,San Salvador,San Salvador,San Salvador,1,13.7,-89.2,cereals and tubers,Beans (red),59,46 KG,actual,wholesale,USD,72.70,72.70',
    '2026-08-15,San Salvador,San Salvador,San Salvador,1,13.7,-89.2,cereals and tubers,Rice,60,Libra,actual,retail,USD,1.1,1.1',
    '2026-08-15,San Salvador,San Salvador,San Salvador,1,13.7,-89.2,cereals and tubers,Maize (white),58,46 KG,aggregate,wholesale,USD,26.61,26.61',
    '2025-08-15,San Salvador,San Salvador,San Salvador,1,13.7,-89.2,cereals and tubers,Maize (white),58,45 KG,actual,wholesale,USD,25.0,25.0'
  ].join('\n');

  test('normalize keeps actuals only, converts usdprice to USD/kg, splits pricetypes', () => {
    const rows = wfpSlv.parse(csvFixture);
    const { collection, docs } = wfpSlv.normalize(rows);

    expect(collection).toBe('agri_series');
    expect(docs).toHaveLength(4); // aggregate row dropped
    const maizeWholesale = docs.find((d) => d.commodity === 'Maize (white)' && d.pricetype === 'wholesale');
    expect(maizeWholesale.usdPerKg).toBeCloseTo(26.61 / 46, 4);
    expect(maizeWholesale.country).toBe('El Salvador');
    const retail = docs.find((d) => d.commodity === 'Rice');
    expect(retail.pricetype).toBe('retail');
    // Deterministic keys, unique
    const keys = new Set(docs.map((d) => d._key));
    expect(keys.size).toBe(docs.length);
  });

  test('empty parse yields 0 docs (scheduler treats as failure)', () => {
    const { docs } = wfpSlv.normalize([]);
    expect(docs).toHaveLength(0);
  });
});

describe('hdx-ndvi adapter (fixture: real HDX schema)', () => {
  const csvFixture = [
    'date,adm_level,adm_id,PCODE,n_pixels,vim,vim_avg,viq',
    '2026-09-01,1,900391,SV01,1234,0.822,0.822,2.1',
    '2026-09-01,1,900395,SV01,4,0.400,0.400,50.0', // SV11-style sliver on SV01 here
    '2026-09-01,1,900401,SV07,800,0.668,0.668,-1.0',
    '2026-09-01,2,910001,SV01.1,50,0.700,0.700,0.0' // ADM2 row must be skipped
  ].join('\n');

  test('keeps ADM1 only, dedupes by highest n_pixels per PCODE+date', () => {
    const { collection, docs } = hdxNdvi.normalize(hdxNdvi.parse(csvFixture));
    expect(collection).toBe('agri_ndvi');
    expect(docs).toHaveLength(2);
    const sv01 = docs.find((d) => d.pcode === 'SV01');
    expect(sv01.nPixels).toBe(1234);
    expect(sv01.vim).toBe(0.822);
    expect(sv01.department).toBe('Ahuachapán');
  });

  test('all 14 departments mapped', () => {
    const deptNames = Object.values(require('../../../services/agri/adapters/hdx-ndvi'));
    // DEPARTMENTS is module-internal; verify via a synthetic row sweep
    const rows = Object.keys({
      SV01: 1,
      SV02: 1,
      SV03: 1,
      SV04: 1,
      SV05: 1,
      SV06: 1,
      SV07: 1,
      SV08: 1,
      SV09: 1,
      SV10: 1,
      SV11: 1,
      SV12: 1,
      SV13: 1,
      SV14: 1
    }).map((p) => ({
      date: '2026-09-01',
      adm_level: '1',
      adm_id: '1',
      PCODE: p,
      n_pixels: '10',
      vim: '0.5'
    }));
    const { docs } = hdxNdvi.normalize(rows);
    expect(docs).toHaveLength(14);
    expect(new Set(docs.map((d) => d.department)).size).toBe(14);
    expect(deptNames).toBeDefined();
  });
});

describe('oirsa adapter', () => {
  const posts = [
    {
      id: 18027,
      title: { rendered: 'OIRSA y SAG fortalecen el control de la langosta voladora' },
      date: '2025-08-13T00:00:00',
      link: 'https://web.oirsa.org/archivos/18027'
    },
    {
      id: 18028,
      title: { rendered: 'Concurso de plazas vacantes' },
      date: '2026-09-01T00:00:00',
      link: 'https://web.oirsa.org/archivos/18028'
    },
    {
      id: 18029,
      title: { rendered: 'Alerta por Fusarium R4T en la región' },
      date: '2025-08-21T00:00:00',
      link: 'https://web.oirsa.org/archivos/18029'
    }
  ];

  test('keeps only pest-lexicon matches with honest info severity', () => {
    const { collection, docs } = oirsa.normalize(posts);
    expect(collection).toBe('agri_alerts');
    expect(docs).toHaveLength(2);
    expect(docs.every((d) => d.severity === 'info')).toBe(true);
    expect(docs.find((d) => d.title.includes('Fusarium')).matchedKeywords).toContain('fusarium');
  });
});

describe('gdelt adapter', () => {
  test('normalizes artlist JSON, converts seendate, tags language', () => {
    const results = [
      {
        lang: 'es',
        json: {
          articles: [
            {
              url: 'https://rurales.elpais.com.uy/a1',
              title: 'Mercado de trigo: una primavera movida',
              seendate: '20260913T090000Z',
              domain: 'rurales.elpais.com.uy'
            },
            {
              url: 'https://rurales.elpais.com.uy/a2',
              title: 'Concierto benéfico reúne a miles', // irrelevant — filtered
              seendate: '20260913T090000Z',
              domain: 'rurales.elpais.com.uy'
            }
          ]
        }
      },
      { lang: 'en', error: '429' } // one variant failing must not break the other
    ];
    const { collection, docs } = gdelt.normalize(results);
    expect(collection).toBe('agri_news');
    expect(docs).toHaveLength(1);
    expect(docs[0].publishedAt).toBe('2026-09-13T09:00:00Z');
    expect(docs[0].language).toBe('es');
    expect(docs[0].scope).toBe('global');
  });
});

describe('comtrade adapter', () => {
  test('aggregates partner rows into one unit value per label+period', () => {
    const results = [
      {
        label: 'urea-import-parity',
        reporter: '222',
        code: '3102',
        period: '2024',
        json: {
          data: [
            { primaryValue: '11200000', netWght: '25848' },
            { primaryValue: '4210000', netWght: '10000' }
          ]
        }
      },
      { label: 'honey-export-uv', reporter: '222', code: '0409', period: '2026', json: { data: [] } }
    ];
    const { collection, docs } = comtrade.normalize(results);
    expect(collection).toBe('agri_series');
    expect(docs).toHaveLength(1); // 2026 empty -> skipped
    expect(docs[0].usdPerKg).toBeCloseTo(15410000 / 35848, 3);
    expect(docs[0].year).toBe(2024);
  });
});

describe('bls-ppi adapter', () => {
  test('keeps M01-M12 only, maps to monthly dates', () => {
    const obs = [
      { year: '2026', period: 'M08', value: '186.874' },
      { year: '2026', period: 'M13', value: '190.1' },
      { year: '2026', period: 'S01', value: '185.0' }
    ];
    const { collection, docs } = blsPpi.normalize(obs);
    expect(collection).toBe('agri_series');
    expect(docs).toHaveLength(1);
    expect(docs[0].date).toBe('2026-08-01');
    expect(docs[0].key).toBe('BLS:PPI:PESTICIDE');
  });
});
