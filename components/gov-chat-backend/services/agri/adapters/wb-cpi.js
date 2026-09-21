/**
 * wb-cpi — El Salvador Consumer Price Index (WB indicators API).
 *
 * Feeds the estimation engine (remediation-plan.md §5.1): inflation
 * adjustment of missing years in price series. Verified live 2026-09-17:
 * FP.CPI.TOTL for SLV current through 2025 (2010=100 base), keyless.
 */
const { fetchJson } = require('../http');

module.exports = {
  id: 'wb-cpi',
  configPrefix: 'WB_CPI',
  cadence: '1w', // annual series — weekly staleness check is plenty
  defaults: {
    indicator: 'FP.CPI.TOTL',
    country: 'SLV',
    startYear: '2010'
  },
  endpoints: ['estimation'],

  async resolve(cfg) {
    return (
      `https://api.worldbank.org/v2/country/${cfg.country}/indicator/${cfg.indicator}` +
      `?format=json&date=${cfg.startYear}:${new Date().getFullYear()}&per_page=100`
    );
  },

  async fetch(url) {
    return fetchJson(url, { timeoutMs: 20000 });
  },

  parse(json) {
    // WB returns [metadata, data[]]
    if (!Array.isArray(json) || json.length < 2 || !Array.isArray(json[1])) return [];
    return json[1];
  },

  normalize(rows) {
    const docs = [];
    for (const row of rows) {
      const value = parseFloat(row.value);
      const year = parseInt(row.date, 10);
      if (!Number.isFinite(value) || !Number.isFinite(year)) continue;
      docs.push({
        _key: `wb-cpi-slv-${year}`,
        key: 'WB:CPI:SLV',
        kind: 'cpi',
        year,
        value,
        source: 'world-bank',
        indicator: 'FP.CPI.TOTL'
      });
    }
    return { collection: 'agri_series', docs };
  }
};
