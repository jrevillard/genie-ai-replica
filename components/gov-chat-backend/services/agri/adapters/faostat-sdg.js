/**
 * faostat-sdg — FAOSTAT SDG 12.3.1 post-harvest food loss (regional).
 *
 * Verified 2026-09-16 (gap-filler agent): the working bulk URL is the SDG
 * archive; 12.3.1a rows exist ONLY as regional aggregates — Central
 * America "total" = 16.5% (2023), modeled, flat since 2021. Used as the
 * curated Harvest & Storage statistic; country rows do not exist.
 */
const { fetchUrl } = require('../http');
const { extractEntry } = require('../zip');
const { docKey } = require('../keys');

const ZIP_URL = 'https://bulks-faostat.fao.org/production/SDG_BulkDownloads_E_All_Data_(Normalized).zip';

// Regional M49 aggregates that include Central America groupings
const AREA_MATCH = /Central America|Latin America and the Caribbean/;
const ITEM_SDG = '12.3.1';

module.exports = {
  id: 'faostat-sdg',
  configPrefix: 'FAOSTAT_SDG',
  cadence: '1w',
  defaults: { url: ZIP_URL },
  endpoints: ['market-prices'],

  async resolve(cfg) {
    return cfg.url;
  },

  async fetch(url) {
    const res = await fetchUrl(url, { timeoutMs: 120000, responseType: 'arraybuffer' });
    return Buffer.from(res.data);
  },

  async parse(buffer) {
    const entries = require('../zip').readCentralDirectory(buffer);
    const csvName = entries.map((e) => e.name).find((n) => n.toLowerCase().includes('alldata')) || entries[0].name;
    const inner = await extractEntry(buffer, csvName);
    const lines = inner.toString('utf8').split('\n');
    const header = lines[0].split(',').map((cell) => cell.replace(/"/g, ''));

    const areaIdx = header.indexOf('Area');
    const itemIdx = header.indexOf('Item');
    const yearIdx = header.indexOf('Year');
    const valueIdx = header.indexOf('Value');

    const out = [];
    for (let i = 1; i < lines.length; i += 1) {
      const line = lines[i];
      if (!line.includes(ITEM_SDG)) continue;
      const row = line.split(',');
      const area = row[areaIdx] && row[areaIdx].replace(/"/g, '');
      if (!area || !AREA_MATCH.test(area)) continue;
      out.push({
        area,
        item: (row[itemIdx] || '').replace(/"/g, ''),
        year: (row[yearIdx] || '').replace(/"/g, ''),
        value: (row[valueIdx] || '').replace(/"/g, '')
      });
    }
    return out;
  },

  normalize(rows) {
    const docs = [];
    for (const row of rows) {
      const value = parseFloat(row.value);
      const year = parseInt(row.year, 10);
      if (!Number.isFinite(value) || !Number.isFinite(year)) continue;

      const logical = `FAOSTAT:SDG:${row.area}:${year}`;
      docs.push({
        _key: docKey(logical),
        key: `FAOSTAT:SDG:${row.area}`,
        kind: 'loss-rate',
        year,
        value,
        unit: '% of production',
        area: row.area,
        source: 'faostat-sdg'
      });
    }
    return { collection: 'agri_series', docs };
  }
};
