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

// PCPS column matcher -> normalized series keys. The 2026 layout is
// TRANSPOSED vs the research era: commodities are COLUMNS (code row +
// description row) and months are ROWS ("1980M1"). Match by stable PCPS
// code with a description-regex fallback.
const COLUMN_MATCHERS = [
  { code: /^PURE/i, desc: /urea/i, def: { key: 'IMF:UREA', name: 'Urea (NOLA granular)', unit: 'USD/short ton' } },
  {
    code: /POTAS/i,
    desc: /potassium chloride/i,
    def: { key: 'IMF:POTASH', name: 'Potassium chloride (Vancouver)', unit: 'USD/mt' }
  },
  { code: /^PDAP/i, desc: /\bDAP\b/i, def: { key: 'IMF:DAP', name: 'DAP (NOLA)', unit: 'USD/mt' } },
  {
    code: /PHOS/i,
    desc: /phosphate rock/i,
    def: { key: 'IMF:PHOSROCK', name: 'Phosphate rock', unit: 'USD/mt' }
  },
  {
    code: /POULT/i,
    desc: /poultry/i,
    def: { key: 'IMF:POULTRY', name: 'Poultry (Georgia docks)', unit: 'index 2016=100' }
  },
  {
    code: /^PFERT$/i,
    desc: /fertilizer/i,
    def: { key: 'IMF:FERT', name: 'IMF Fertilizer Index', unit: 'index 2016=100' }
  },
  {
    code: /^PFOOD$/i,
    desc: /food price index/i,
    def: { key: 'IMF:FOOD', name: 'IMF Food Price Index', unit: 'index 2016=100' }
  },
  {
    code: /^PAGRI$/i,
    desc: /agriculture/i,
    def: { key: 'IMF:AGRI', name: 'IMF Agriculture Index', unit: 'index 2016=100' }
  }
];

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
    const codeRow = rows.find((r) => Array.isArray(r) && r[0] === 'Commodity');
    const descRow = rows.find((r) => Array.isArray(r) && r[0] === 'Commodity.Description');
    if (!codeRow) return { collection: 'agri_series', docs };

    const colDefs = [];
    for (let col = 1; col < codeRow.length; col += 1) {
      const code = String(codeRow[col] || '');
      const desc = String((descRow && descRow[col]) || '');
      const m = COLUMN_MATCHERS.find((c) => c.code.test(code) || (desc && c.desc.test(desc)));
      if (m && !colDefs.some((d) => d.def.key === m.def.key)) colDefs.push({ col, def: m.def });
    }

    for (const row of rows) {
      if (!Array.isArray(row) || row.length < 2) continue;
      const date = parseMonthCell(row[0]);
      if (!date) continue;
      for (const { col, def } of colDefs) {
        const value = row[col];
        if (typeof value !== 'number' || !Number.isFinite(value)) continue;
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
