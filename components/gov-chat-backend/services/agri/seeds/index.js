/**
 * Bundled seed envelopes (remediation-plan.md §5).
 *
 * Every value below is REAL data captured during the 2026-09-16 live
 * verification by the research agents — seeds are a floor for cold starts,
 * never fabricated numbers. The CI seed-export job (phase MR1 follow-up)
 * will regenerate these from Arango snapshots; hand-maintained until then.
 */
const { buildEnvelope, caveat } = require('../envelope');

const QUINTAL = 'USD/quintal (46 kg)';

const ndviSeed = buildEnvelope(
  {
    departments: [
      { name: 'Ahuachapán', ndvi: 0.822, trend: 'stable', changePct: 0, health: 'good' },
      { name: 'Cuscatlán', ndvi: 0.668, trend: 'stable', changePct: 0, health: 'good' },
      { name: 'La Unión', ndvi: 0.767, trend: 'stable', changePct: 0, health: 'good' }
    ],
    average: { ndvi: 0.752, trend: 'stable', changePct: 0 },
    startDate: '2026-09-01',
    endDate: '2026-09-10'
  },
  {
    source: 'WFP VAM via HDX (NASA MODIS)',
    attribution: 'Source: WFP VAM via HDX (CC BY 4.0)',
    coverage: 'Dekad 2026-09-01, department level (partial seed — 3 of 14 departments)',
    caveats: [caveat.curatedStat('2026-09-01')]
  }
);

const maizeSeries = [
  { date: '2026-01-15', value: 25.4, quality: 'actual' },
  { date: '2026-08-15', value: 26.61, quality: 'actual' }
];
const beanSeries = [
  { date: '2026-01-15', value: 80.76, quality: 'actual' },
  { date: '2026-08-15', value: 72.7, quality: 'actual' }
];

const marketSeeds = {
  maize: buildEnvelope(
    {
      title: 'Maize & Basic Grains',
      unit: QUINTAL,
      series: [
        {
          name: 'Maize (white), San Salvador wholesale',
          source: 'wfp-vam',
          country: 'El Salvador',
          market: 'San Salvador',
          data: maizeSeries,
          trend: 'stable',
          latest: 26.61
        },
        {
          name: 'Beans (red), San Salvador wholesale',
          source: 'wfp-vam',
          country: 'El Salvador',
          market: 'San Salvador',
          data: beanSeries,
          trend: 'down',
          latest: 72.7
        }
      ],
      trend: 'stable',
      latest: 26.61
    },
    {
      source: 'WFP VAM via HDX (official MAG/SIMMAG data)',
      attribution: 'Source: WFP VAM via HDX (CC BY-IGO)',
      coverage: 'San Salvador wholesale; Jan–Aug 2026 actuals; no data 2023–2025',
      caveats: [caveat.singleMarket('San Salvador'), caveat.gapYears('2023–2025')]
    }
  ),
  cropProtection: buildEnvelope(
    {
      title: 'Crop Protection Costs',
      unit: 'PPI index (2016=100 basis, US domestic)',
      series: [
        {
          name: 'PPI pesticide & ag-chemical manufacturing',
          source: 'bls',
          country: 'United States',
          data: [{ date: '2026-08-01', value: 186.874, quality: 'actual' }],
          trend: 'unknown',
          latest: 186.874
        }
      ],
      trend: 'unknown',
      latest: 186.874
    },
    {
      source: 'BLS Producer Price Index',
      coverage: 'US-domestic index used as world-price proxy (pesticides are USD-world-priced)',
      caveats: [caveat.proxyIndex('BLS PPI PCU325320325320')]
    }
  ),
  vegetables: buildEnvelope(
    {
      title: 'Fruits & Vegetables',
      unit: QUINTAL,
      series: [
        {
          name: 'Tomatoes, national average retail',
          source: 'wfp-vam',
          country: 'Nicaragua',
          data: [{ date: '2026-05-15', value: 33.0, quality: 'actual' }], // $0.72/lb ≈ $33/quintal
          trend: 'unknown',
          latest: 33.0
        },
        {
          name: 'Onions, national average retail',
          source: 'wfp-vam',
          country: 'Nicaragua',
          data: [{ date: '2026-05-15', value: 56.7, quality: 'actual' }], // $1.25/lb
          trend: 'unknown',
          latest: 56.7
        }
      ],
      trend: 'unknown',
      latest: 33.0
    },
    {
      source: 'WFP VAM Nicaragua via HDX',
      attribution: 'Source: WFP VAM via HDX (CC BY-IGO)',
      coverage: 'Nicaragua national-average retail — no El Salvador local monthly source exists',
      caveats: [caveat.regionalData('Nicaragua')]
    }
  ),
  livestock: buildEnvelope(
    {
      title: 'Poultry & Pigs',
      unit: 'USD/lb',
      series: [
        {
          name: 'Chicken, national average retail',
          source: 'wfp-vam',
          country: 'Nicaragua',
          data: [{ date: '2026-05-15', value: 1.79, quality: 'actual' }],
          trend: 'unknown',
          latest: 1.79
        },
        {
          name: 'Pork, national average retail',
          source: 'wfp-vam',
          country: 'Nicaragua',
          data: [{ date: '2026-05-15', value: 2.38, quality: 'actual' }],
          trend: 'unknown',
          latest: 2.38
        },
        {
          name: 'Eggs, national average retail',
          source: 'wfp-vam',
          country: 'Nicaragua',
          data: [{ date: '2026-05-15', value: 2.46, quality: 'actual' }], // USD/dozen
          trend: 'unknown',
          latest: 2.46
        }
      ],
      trend: 'unknown',
      latest: 1.79
    },
    {
      source: 'WFP VAM Nicaragua via HDX',
      attribution: 'Source: WFP VAM via HDX (CC BY-IGO)',
      coverage: 'Nicaragua national-average retail (regional reference); intl chicken benchmark monthly',
      caveats: [caveat.regionalData('Nicaragua')]
    }
  ),
  fertilizer: buildEnvelope(
    {
      title: 'Fertilizer & Soil',
      unit: 'USD/mt (international spot)',
      series: [
        {
          name: 'Urea (Middle East f.o.b.)',
          source: 'world-bank-cmo',
          country: 'World',
          data: [{ date: '2026-08-01', value: 390, quality: 'actual' }],
          trend: 'unknown',
          latest: 390
        },
        {
          name: 'DAP (US Gulf)',
          source: 'world-bank-cmo',
          country: 'World',
          data: [{ date: '2026-08-01', value: 793.5, quality: 'actual' }],
          trend: 'unknown',
          latest: 793.5
        },
        {
          name: 'TSP (US Gulf)',
          source: 'world-bank-cmo',
          country: 'World',
          data: [{ date: '2026-08-01', value: 704.4, quality: 'actual' }],
          trend: 'unknown',
          latest: 704.4
        },
        {
          name: 'MOP (Brazil CFR granular)',
          source: 'world-bank-cmo',
          country: 'World',
          data: [{ date: '2026-08-01', value: 386.9, quality: 'actual' }],
          trend: 'unknown',
          latest: 386.9
        },
        {
          name: 'Urea import parity (El Salvador CIF)',
          source: 'un-comtrade',
          country: 'El Salvador',
          data: [{ date: '2024-01-01', value: 434, quality: 'actual' }],
          trend: 'unknown',
          latest: 434
        }
      ],
      trend: 'unknown',
      latest: 390
    },
    {
      source: 'World Bank Pink Sheet + UN Comtrade',
      coverage: 'International monthly benchmarks (Aug 2026) + SV import parity (2024, annual)',
      caveats: [caveat.annualOnly(2024)]
    }
  ),
  apiary: buildEnvelope(
    {
      title: 'Apiary & Honey',
      unit: 'USD/kg',
      series: [
        {
          name: 'Natural honey producer price',
          source: 'faostat',
          country: 'El Salvador',
          data: [{ date: '2022-01-01', value: 3.43, quality: 'actual' }],
          trend: 'unknown',
          latest: 3.43
        },
        {
          name: 'Honey export unit value',
          source: 'un-comtrade',
          country: 'El Salvador',
          data: [{ date: '2023-01-01', value: 3.43, quality: 'actual' }],
          trend: 'unknown',
          latest: 3.43
        }
      ],
      trend: 'unknown',
      latest: 3.43
    },
    {
      source: 'FAOSTAT producer prices + UN Comtrade',
      coverage: 'Producer prices to 2022 (annual); export unit values 2023–2025',
      caveats: [caveat.annualOnly(2022)]
    }
  ),
  aquaculture: buildEnvelope(
    {
      title: 'Tilapia & Aquaculture',
      unit: 'USD/kg',
      series: [
        {
          name: 'Tilapia fillets, Honduras exports (FOB)',
          source: 'un-comtrade',
          country: 'Honduras',
          data: [{ date: '2024-01-01', value: 7.65, quality: 'actual' }],
          trend: 'unknown',
          latest: 7.65
        },
        {
          name: 'Whole tilapia, Costa Rica exports (FOB)',
          source: 'un-comtrade',
          country: 'Costa Rica',
          data: [{ date: '2024-01-01', value: 7.36, quality: 'actual' }],
          trend: 'unknown',
          latest: 7.36
        },
        {
          name: 'Fish meal feed cost (intl benchmark)',
          source: 'world-bank-cmo',
          country: 'World',
          data: [{ date: '2026-08-01', value: 2500, quality: 'actual' }],
          trend: 'unknown',
          latest: 2500
        }
      ],
      trend: 'unknown',
      latest: 7.65
    },
    {
      source: 'UN Comtrade + World Bank Pink Sheet',
      coverage: 'Regional export unit values (2024, annual refresh) — no monthly tilapia price exists free',
      caveats: [caveat.regionalData('Honduras / Costa Rica'), caveat.annualOnly(2024)]
    }
  ),
  harvestStorage: buildEnvelope(
    {
      title: 'Harvest & Storage',
      unit: '% of production lost post-harvest',
      series: [
        {
          name: 'Central America post-harvest food loss (SDG 12.3.1)',
          source: 'faostat-sdg',
          country: 'Central America (regional aggregate)',
          data: [{ date: '2023-01-01', value: 16.5, quality: 'actual' }],
          trend: 'stable',
          latest: 16.5
        }
      ],
      trend: 'stable',
      latest: 16.5
    },
    {
      source: 'FAOSTAT SDG 12.3.1 (regional aggregate only — no country data)',
      coverage: 'Modeled regional aggregate; flat since 2021; curated contextual statistic',
      caveats: [caveat.curatedStat('2023')]
    }
  )
};

module.exports = {
  'crop-health': ndviSeed,
  'pest-alerts': null, // built from curated advisories file + DB; seed via buildPestAlerts
  ...Object.fromEntries(Object.entries(marketSeeds).map(([cat, env]) => [`market-prices:${cat}`, env]))
};
