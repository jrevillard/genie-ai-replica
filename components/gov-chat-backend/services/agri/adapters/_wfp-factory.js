/**
 * Shared factory for WFP VAM food-price adapters (wfp-slv / wfp-nic / wfp-gtm).
 *
 * All three HDX datasets share the same CSV schema:
 * date,admin1,admin2,market,market_id,latitude,longitude,category,commodity,
 * commodity_id,unit,priceflag,pricetype,currency,price,usdprice
 *
 * Normalization rules (remediation-plan.md §6):
 * - use `usdprice` (NIC/GT files also carry local-currency `price`)
 * - canonical value = USD/kg (unit drift 45 KG -> 46 KG neutralized)
 * - priceflag "actual" only (skip aggregates); wholesale and retail kept apart
 */
const nodeCrypto = require('node:crypto');
const { fetchUrl } = require('../http');
const { parseCsvObjects } = require('../csv');
const { resolveHdxResource } = require('../resolvers');
const { wfpRowToUsdPerKg } = require('../series');

/** Deterministic, collision-safe Arango _key from a logical doc key. */
const docKey = (logical) => nodeCrypto.createHash('sha1').update(logical).digest('base64url');

/**
 * @param {Object} opts
 * @param {string} opts.id - adapter id (e.g. 'wfp-slv')
 * @param {string} opts.configPrefix
 * @param {string} opts.dataset - HDX CKAN dataset id
 * @param {string} opts.file - resource filename
 * @param {string} opts.fallbackUrl - last-known-good download URL
 * @param {string} opts.country - label for docs/attribution
 * @returns {Object} adapter
 */
function createWfpAdapter(opts) {
  return {
    id: opts.id,
    configPrefix: opts.configPrefix,
    cadence: '24h',
    defaults: {
      dataset: opts.dataset,
      file: opts.file,
      fallbackUrl: opts.fallbackUrl
    },
    endpoints: ['market-prices'],

    async resolve(cfg) {
      return resolveHdxResource(cfg.dataset, cfg.file, cfg.fallbackUrl);
    },

    async fetch(url) {
      const res = await fetchUrl(url, { timeoutMs: 60000 });
      return res.bodyText; // CSV text
    },

    parse(text) {
      return parseCsvObjects(text, { maxRows: 300000 });
    },

    normalize(rows) {
      const docs = [];
      const seen = new Set();
      for (const row of rows) {
        if (!row.date || row.priceflag !== 'actual') continue;

        const conv = wfpRowToUsdPerKg(row);
        if (!conv) continue;

        const pricetype = row.pricetype || 'retail';
        const key = `${opts.country}:${row.market || 'NA'}:${row.commodity}:${pricetype}`;
        const date = row.date.length === 7 ? `${row.date}-01` : row.date; // YYYY-MM -> YYYY-MM-01
        const logicalKey = `${key}:${date}`;
        if (seen.has(logicalKey)) continue;
        seen.add(logicalKey);

        docs.push({
          _key: docKey(logicalKey),
          key,
          kind: 'price',
          date,
          usdPerKg: Math.round(conv.usdPerKg * 10000) / 10000,
          currency: 'USD',
          country: opts.country,
          market: row.market || null,
          admin1: row.admin1 || null,
          commodity: row.commodity,
          pricetype,
          source: 'wfp-vam'
        });
      }
      return { collection: 'agri_series', docs };
    }
  };
}

module.exports = { createWfpAdapter };
