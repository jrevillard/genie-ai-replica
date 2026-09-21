/**
 * faostat-pp — FAOSTAT Producer Prices bulk archive (annual, USD/tonne).
 *
 * The ONLY free source with El Salvador vegetables/poultry/eggs producer
 * prices (actual values end 2022 — the estimation engine CPI-fills the
 * gap) and Honduras annual anchors (current to 2024, regional reference).
 *
 * Verified 2026-09-16: the legacy filename Prices_E_All_Data_(Normalized)
 * IS today's Producer Prices domain; all FAOSTAT API hosts are dead —
 * bulk zips are the channel. Zip is 11.6 MB, inner CSV ~204 MB — rows are
 * filtered DURING normalize (line-scanned, matched rows only kept).
 *
 * Flow note: parse() is the identity (zip buffer passthrough) and
 * normalize() is async (zip extraction + row filtering) — the scheduler
 * awaits both, so heavy work lives in normalize where it can stream.
 */
const { fetchUrl } = require('../http');
const { extractEntry } = require('../zip');
const nodeCrypto = require('node:crypto');

const ZIP_URL = 'https://bulks-faostat.fao.org/production/Prices_E_All_Data_(Normalized).zip';
const INNER_CSV = 'Prices_E_All_Data_(Normalized).csv';

// FAOSTAT area codes: 60=El Salvador, 89=Guatemala, 97=Honduras, 117=Nicaragua
const AREAS = { 60: 'El Salvador', 89: 'Guatemala', 97: 'Honduras', 117: 'Nicaragua' };
const ELEMENT_USD = '5532'; // Producer Price (USD/tonne)
const ITEM_FILTERS = [
  'Tomatoes',
  'Onions, dry',
  'Potatoes',
  'Chillies and peppers, dry',
  'Natural honey',
  'Hen eggs in shell, fresh',
  'Meat of chicken',
  'Meat of pig',
  'Maize (corn)',
  'Beans, dry',
  'Rice',
  'Sorghum'
];

module.exports = {
  id: 'faostat-pp',
  configPrefix: 'FAOSTAT_PP',
  cadence: '1w',
  defaults: { url: ZIP_URL, innerCsv: INNER_CSV },
  endpoints: ['market-prices', 'estimation'],

  async resolve(cfg) {
    return cfg.url;
  },

  async fetch(url) {
    // Prices_E_All_Data zip is ~12 MB — larger than the default 5 MB guard
    const res = await fetchUrl(url, { timeoutMs: 180000, responseType: 'arraybuffer', maxBytes: 20 * 1024 * 1024 });
    return Buffer.from(res.data);
  },

  parse(buffer) {
    return buffer; // identity — extraction happens in normalize()
  },

  async normalize(buffer) {
    const inner = await extractEntry(buffer, INNER_CSV);
    const lines = inner.toString('utf8').split('\n');
    const header = splitCsvLine(lines[0]);
    const idx = {
      areaCode: header.indexOf('Area Code'),
      elementCode: header.indexOf('Element Code'),
      item: header.indexOf('Item'),
      year: header.indexOf('Year'),
      value: header.indexOf('Value')
    };

    const docs = [];
    for (let i = 1; i < lines.length; i += 1) {
      const line = lines[i];
      if (!line) continue;
      const row = splitCsvLine(line);
      const country = AREAS[row[idx.areaCode]];
      if (!country || row[idx.elementCode] !== ELEMENT_USD) continue;

      const itemName = (row[idx.item] || '').replace(/"/g, '');
      if (!ITEM_FILTERS.some((f) => itemName.startsWith(f))) continue;

      const value = parseFloat(row[idx.value]);
      const year = parseInt(row[idx.year], 10);
      if (!Number.isFinite(value) || !Number.isFinite(year) || value <= 0) continue;

      const key = `FAOSTAT:PP:${country}:${itemName}`;
      const logical = `${key}:${year}`;
      docs.push({
        _key: nodeCrypto.createHash('sha1').update(logical).digest('base64url'),
        key,
        kind: 'producer-price',
        year,
        usdPerKg: Math.round((value / 1000) * 10000) / 10000, // tonne -> kg
        currency: 'USD',
        country,
        item: itemName,
        source: 'faostat'
      });
    }
    return { collection: 'agri_series', docs };
  }
};

/** Minimal CSV line splitter (quoted commas) — the bulk file is quote-heavy. */
function splitCsvLine(line) {
  const cells = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      cells.push(cell);
      cell = '';
    } else cell += ch;
  }
  cells.push(cell);
  return cells;
}
