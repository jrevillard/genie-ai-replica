/**
 * bls-ppi — BLS Producer Price Index for pesticide manufacturing.
 *
 * Crop-protection cost proxy (PROXY_INDEX caveat). Verified 2026-09-16:
 * PCU325320325320 current to 2026-M08, keyless v1 API (25 queries/day —
 * fine for a daily scheduler call), CORS-open.
 */
const { fetchUrl } = require('../http');
const nodeCrypto = require('node:crypto');

module.exports = {
  id: 'bls-ppi',
  configPrefix: 'BLS_PPI',
  cadence: '24h',
  defaults: {
    seriesId: 'PCU325320325320' // PPI: pesticide & ag-chemical manufacturing
  },
  endpoints: ['market-prices'],

  async resolve(cfg) {
    return { url: 'https://api.bls.gov/publicAPI/v1/timeseries/data/', seriesId: cfg.seriesId };
  },

  async fetch({ url, seriesId }) {
    const res = await fetchUrl(url, {
      method: 'post',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      data: JSON.stringify({ seriesid: [seriesId] }),
      timeoutMs: 20000
    });
    return JSON.parse(res.bodyText);
  },

  parse(json) {
    const series = (json && json.Results && json.Results.series) || [];
    return series.length > 0 ? series[0].data || [] : [];
  },

  normalize(observations) {
    const docs = [];
    for (const obs of observations) {
      const value = parseFloat(obs.value);
      const year = parseInt(obs.year, 10);
      const period = String(obs.period || '');
      // M01..M12 only (M13 = annual average, skip duplicates)
      const m = period.match(/^M(0[1-9]|1[0-2])$/);
      if (!Number.isFinite(value) || !Number.isFinite(year) || !m) continue;

      const date = `${year}-${m[1]}-01`;
      const logical = `bls-ppi:${date}`;
      docs.push({
        _key: nodeCrypto.createHash('sha1').update(logical).digest('base64url'),
        key: 'BLS:PPI:PESTICIDE',
        kind: 'index',
        date,
        value,
        unit: 'index',
        source: 'bls',
        seriesId: 'PCU325320325320'
      });
    }
    return { collection: 'agri_series', docs };
  }
};
