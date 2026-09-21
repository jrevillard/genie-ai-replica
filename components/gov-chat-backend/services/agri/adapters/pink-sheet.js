/**
 * pink-sheet — World Bank Commodity Markets Outlook monthly price workbook.
 *
 * Fertilizer (urea, DAP, TSP, MOP, phosphate rock), feed inputs (maize,
 * soybean meal, fish meal) and international food benchmarks (maize, rice,
 * sorghum, wheat, chicken, beef, sugar, coffee, bananas).
 *
 * Verified 2026-09-16: monthly xlsx current through 2026M08, history from
 * 1960M01. The thedocs URL hash changes with every monthly release —
 * resolve() scrapes the commodity-markets landing page, falling back to
 * the last-known-good URL (kept in defaults + Arango-resolvable via env).
 */
const XLSX = require('xlsx');
const { fetchUrl } = require('../http');
const { resolvePinkSheet } = require('../resolvers');
const nodeCrypto = require('node:crypto');

const LANDING_URL = 'https://www.worldbank.org/en/research/commodity-markets';
const FALLBACK_URL =
  'https://thedocs.worldbank.org/en/doc/74e8be41ceb20fa0da750cda2f6b9e4e-0050012026/related/CMO-Historical-Data-Monthly.xlsx';

// Row labels in the "Monthly Prices" sheet -> normalized series keys/units
const SERIES_MAP = {
  'Urea ': { key: 'WB:UREA', name: 'Urea (Middle East f.o.b.)', unit: 'USD/mt' },
  'DAP ': { key: 'WB:DAP', name: 'DAP (US Gulf spot)', unit: 'USD/mt' },
  'TSP ': { key: 'WB:TSP', name: 'TSP (US Gulf)', unit: 'USD/mt' },
  'Potassium chloride ': { key: 'WB:MOP', name: 'MOP (Brazil CFR granular)', unit: 'USD/mt' },
  'Phosphate rock ': { key: 'WB:PHOSROCK', name: 'Phosphate rock', unit: 'USD/mt' },
  'Maize ': { key: 'WB:MAIZE_INTL', name: 'Maize (US #2, US Gulf)', unit: 'USD/mt' },
  'Sorghum ': { key: 'WB:SORGHUM_INTL', name: 'Sorghum (US Gulf)', unit: 'USD/mt' },
  'Rice, Thai 5% ': { key: 'WB:RICE_INTL', name: 'Rice (Thai 5%)', unit: 'USD/mt' },
  'Wheat, US HRW ': { key: 'WB:WHEAT_INTL', name: 'Wheat (US HRW)', unit: 'USD/mt' },
  'Soybean meal ': { key: 'WB:SOYMEAL', name: 'Soybean meal', unit: 'USD/mt' },
  'Fish meal ': { key: 'WB:FISHMEAL', name: 'Fish meal', unit: 'USD/mt' },
  'Chicken ': { key: 'WB:CHICKEN_INTL', name: 'Chicken (Brazil wholesale)', unit: 'USD/kg' },
  'Beef ': { key: 'WB:BEEF_INTL', name: 'Beef (Australia/NZ)', unit: 'USD/kg' },
  'Sugar, world ': { key: 'WB:SUGAR_INTL', name: 'Sugar (world)', unit: 'USD/kg' },
  'Coffee, Arabicas ': { key: 'WB:COFFEE_INTL', name: 'Coffee (Arabicas)', unit: 'USD/kg' },
  // 2026 sheet renamed the label to the singular "Banana"
  'Banana, Europe ': { key: 'WB:BANANA_INTL', name: 'Bananas (Europe)', unit: 'USD/kg' }
};

module.exports = {
  id: 'pink-sheet',
  configPrefix: 'PINK_SHEET',
  cadence: '24h',
  defaults: { landingUrl: LANDING_URL, fallbackUrl: FALLBACK_URL },
  endpoints: ['market-prices'],

  async resolve(cfg) {
    return resolvePinkSheet(cfg.landingUrl, cfg.fallbackUrl);
  },

  async fetch(url) {
    const res = await fetchUrl(url, { timeoutMs: 60000, responseType: 'arraybuffer' });
    return Buffer.from(res.data);
  },

  parse(buffer) {
    // Sheet 2 = "Monthly Prices" (verified layout: row 4+ = commodities,
    // row 6+ headerless months; SheetJS A1 parse then locate by row labels)
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = wb.SheetNames.find((n) => /monthly/i.test(n)) || wb.SheetNames[1];
    return XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: true });
  },

  normalize(rows) {
    const docs = [];
    const mapKeys = Object.keys(SERIES_MAP);

    // 2026 layout: commodities are COLUMNS (names row has a null col0 and
    // string commodity labels), months are ROWS ("1960M01" in col0).
    // Verified live 2026-09-18: row4 = names, row5 = units, row6+ = data.
    const namesRow = rows.find((r) => Array.isArray(r) && r.length > 1 && r[0] == null && typeof r[1] === 'string');
    if (!namesRow) return { collection: 'agri_series', docs };

    const colDefs = [];
    for (let col = 1; col < namesRow.length; col += 1) {
      // Strip the sheet's `**` markers (flagged/discontinued series) and
      // any trailing spaces before matching map labels.
      const label = `${String(namesRow[col] || '')
        .replace(/\*+$/, '')
        .trim()} `;
      const match = mapKeys.find((k) => k === label);
      if (match && !colDefs.some((d) => d.def.key === SERIES_MAP[match].key)) {
        colDefs.push({ col, def: SERIES_MAP[match] });
      }
    }

    for (const row of rows) {
      if (!Array.isArray(row) || row.length < 2) continue;
      const date = parseMonthCell(row[0]);
      if (!date) continue;
      for (const { col, def } of colDefs) {
        const value = row[col];
        if (typeof value !== 'number' || !Number.isFinite(value)) continue; // "…" gaps
        const logical = `${def.key}:${date}`;
        docs.push({
          _key: nodeCrypto.createHash('sha1').update(logical).digest('base64url'),
          key: def.key,
          kind: 'intl-price',
          date,
          value: Math.round(value * 100) / 100,
          unit: def.unit,
          name: def.name,
          currency: 'USD',
          source: 'world-bank-cmo'
        });
      }
    }

    return { collection: 'agri_series', docs };
  }
};

/** Pink Sheet header cells are like "2026M08" or Excel serial dates. */
function parseMonthCell(cell) {
  if (typeof cell === 'string') {
    const m = cell.match(/^(\d{4})M(\d{2})$/);
    if (m) return `${m[1]}-${m[2]}-01`;
  }
  if (typeof cell === 'number' && cell > 20000 && cell < 60000) {
    // Excel serial -> approximate month (1900 epoch, ignore 1904 systems)
    const d = new Date(Date.UTC(1899, 11, 30) + cell * 86400000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
  }
  return null;
}
