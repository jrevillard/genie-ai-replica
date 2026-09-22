/**
 * comtrade — UN Comtrade public preview API (keyless, ~1 req/s enforced).
 *
 * El-Salvador-specific and regional trade unit values:
 * - HS 3102 urea imports (reporter 222) — local fertilizer import parity
 * - HS 3808 pesticide imports (reporter 222) — crop-protection parity
 * - HS 0409 honey exports (reporter 222)
 * - HS 030461 tilapia fillets exports (reporter 340 Honduras, 188 Costa Rica)
 *   and 030271 whole tilapia exports (188) — regional farm-gate proxies
 *
 * Verified 2026-09-16: latest period with data = 2024 (annual; monthly
 * returns 0 rows for these codes). Exporter declarations preferred over
 * SV import declarations (SV unit values implausibly low — disclosed).
 */
const { fetchJson } = require('../http');
const { docKey } = require('../keys');

const QUERIES = [
  { label: 'urea-import-parity', reporter: '222', flow: 'M', code: '3102' },
  { label: 'pesticide-import-parity', reporter: '222', flow: 'M', code: '3808' },
  { label: 'honey-export-uv', reporter: '222', flow: 'X', code: '0409' },
  { label: 'tilapia-fillet-export-uv-hn', reporter: '340', flow: 'X', code: '030461' },
  { label: 'tilapia-fillet-export-uv-cr', reporter: '188', flow: 'X', code: '030461' },
  { label: 'tilapia-whole-export-uv-cr', reporter: '188', flow: 'X', code: '030271' }
];

const THROTTLE_MS = 1100; // documented ~1 req/s — keep a margin

module.exports = {
  id: 'comtrade',
  configPrefix: 'COMTRADE',
  cadence: '24h',
  defaults: {
    years: 3,
    baseUrl: 'https://comtradeapi.un.org/public/v1/preview/C/A/HS'
  },
  endpoints: ['market-prices'],

  async resolve(cfg) {
    const currentYear = new Date().getUTCFullYear();
    const years = [];
    for (let y = currentYear; y > currentYear - cfg.years; y -= 1) years.push(String(y));
    return { years };
  },

  async fetch({ years }, cfg) {
    const out = [];
    for (const q of QUERIES) {
      for (const period of years) {
        const url =
          `${cfg.baseUrl}?reporterCode=${q.reporter}&period=${period}` + `&cmdCode=${q.code}&flowCode=${q.flow}`;
        try {
          const json = await fetchJson(url, { timeoutMs: 20000, maxRetries: 1 });
          out.push({ ...q, period, json });
        } catch (error) {
          out.push({ ...q, period, error: error.message });
        }
        await new Promise((r) => setTimeout(r, THROTTLE_MS));
      }
    }
    return out;
  },

  parse(results) {
    return results;
  },

  normalize(results) {
    const docs = [];
    for (const { label, reporter, code, period, json, error } of results) {
      if (error) continue;
      const rows = (json && json.data) || [];
      // Sum trade value + net weight across PARTNER rows -> aggregate unit
      // value. partnerCode 0 is the pre-aggregated "World" row — including
      // it would double-count. Weight field is `netWgt` (2026 schema; the
      // research-era `netWght` spelling silently zeroed every pass).
      let value = 0;
      let weight = 0;
      for (const row of rows) {
        if (row.partnerCode === 0) continue;
        const v = parseFloat(row.primaryValue);
        const w = parseFloat(row.netWgt ?? row.netWght);
        if (Number.isFinite(v) && Number.isFinite(w) && w > 0) {
          value += v;
          weight += w;
        }
      }
      if (weight <= 0 || value <= 0) continue;

      const logical = `comtrade:${label}:${period}`;
      docs.push({
        _key: docKey(logical),
        key: `COMTRADE:${label}`,
        kind: 'trade-unit-value',
        year: parseInt(period, 10),
        usdPerKg: Math.round((value / weight) * 1000) / 1000,
        currency: 'USD',
        reporter,
        hsCode: code,
        valueUsd: Math.round(value),
        weightKg: Math.round(weight),
        source: 'un-comtrade'
      });
    }
    return { collection: 'agri_series', docs };
  }
};
