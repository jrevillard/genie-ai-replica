/**
 * imf-pcps — IMF Primary Commodity Prices (cross-check tier).
 *
 * Same xlsx layout family as the Pink Sheet. Kept as an independent
 * cross-check for fertilizer (PFERT index, urea, potash, DAP) and poultry
 * (PPOULT). Verified 2026-09-16: 1980M01–2026M08, keyless direct xlsx.
 */
const XLSX = require('xlsx');
const { fetchUrl } = require('../http');
const nodeCrypto = require('node:crypto');

const PCPS_URL = 'https://www.imf.org/-/media/files/research/commodityprices/monthly/external-data.xlsx';

// PCPS row labels -> normalized series keys
const SERIES_MAP = {
  Urea: { key: 'IMF:UREA', name: 'Urea (NOLA granular)', unit: 'USD/short ton' },
  'Potassium chloride': { key: 'IMF:POTASH', name: 'Potassium chloride (Vancouver)', unit: 'USD/mt' },
  DAP: { key: 'IMF:DAP', name: 'DAP (NOLA)', unit: 'USD/mt' },
  'Phosphate rock': { key: 'IMF:PHOSROCK', name: 'Phosphate rock', unit: 'USD/mt' },
  Poultry: { key: 'IMF:POULTRY', name: 'Poultry (Georgia docks)', unit: 'index 2016=100' },
  'Food index': { key: 'IMF:FOOD', name: 'IMF Food Price Index', unit: 'index 2016=100' },
  'Agriculture index': { key: 'IMF:AGRI', name: 'IMF Agriculture Index', unit: 'index 2016=100' }
};

module.exports = {
  id: 'imf-pcps',
  configPrefix: 'IMF_PCPS',
  cadence: '24h',
  defaults: { url: PCPS_URL },
  endpoints: ['market-prices'],

  async resolve(cfg) {
    return cfg.url;
  },

  async fetch(url) {
    const res = await fetchUrl(url, { timeoutMs: 60000, responseType: 'arraybuffer' });
    return Buffer.from(res.data);
  },

  parse(buffer) {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = wb.SheetNames[0]; // "Commodity Prices" monthly sheet
    return XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: true });
  },

  normalize(rows) {
    const docs = [];
    const mapKeys = Object.keys(SERIES_MAP);

    for (const row of rows) {
      if (!Array.isArray(row) || row.length < 2) continue;
      const label = String(row[0] || '').trim();
      const match = mapKeys.find((k) => label === k);
      if (!match) continue;
      const def = SERIES_MAP[match];

      for (let col = 1; col < row.length; col += 1) {
        const value = row[col];
        if (typeof value !== 'number' || !Number.isFinite(value)) continue;

        // PCPS columns carry date headers on a header row; locate by scanning
        // the first rows for date-like cells at the same index
        const header = rows.find((r) => r && (r[col] instanceof Date || /^\d{4}M\d{1,2}$/.test(String(r[col] || ''))));
        const date = header && parseMonthCell(header[col]);
        if (!date) continue;

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
          source: 'imf-pcps'
        });
      }
    }
    return { collection: 'agri_series', docs };
  }
};

function parseMonthCell(cell) {
  if (cell instanceof Date) {
    return `${cell.getUTCFullYear()}-${String(cell.getUTCMonth() + 1).padStart(2, '0')}-01`;
  }
  const m = String(cell || '').match(/^(\d{4})M(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-01`;
  return null;
}
