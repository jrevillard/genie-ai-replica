/**
 * frankfurter — ECB reference FX rates (contingency only; all agri price
 * sources are USD and El Salvador is dollarized). Verified 2026-09-16.
 */
const { fetchJson } = require('../http');
const nodeCrypto = require('node:crypto');

module.exports = {
  id: 'frankfurter',
  configPrefix: 'FRANKFURTER',
  cadence: '24h',
  defaults: {
    url: 'https://api.frankfurter.dev/v1/latest?base=EUR&symbols=USD'
  },
  endpoints: [], // supporting data, not a primary endpoint

  async resolve(cfg) {
    return cfg.url;
  },

  async fetch(url) {
    return fetchJson(url, { timeoutMs: 15000 });
  },

  parse(json) {
    return json && json.rates ? { date: json.date, usd: json.rates.USD } : null;
  },

  normalize({ date, usd }) {
    return {
      collection: 'agri_series',
      docs: [
        {
          _key: nodeCrypto.createHash('sha1').update('fx:eurusd').digest('base64url'),
          key: 'FX:EUR:USD',
          kind: 'fx',
          date,
          value: usd,
          source: 'frankfurter'
        }
      ]
    };
  }
};
