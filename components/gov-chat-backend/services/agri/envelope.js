/**
 * Response envelope + structured caveat codes for the /api/agri/* contract.
 *
 * Caveats are structured {code, params} so clients render them via i18n —
 * the same text the user sees is what the AI prompt builders inject
 * (correctness mandate, remediation-plan.md §4).
 */

const CAVEAT_CODES = [
  'REGIONAL_DATA', // params: {country}
  'ESTIMATED_CPI', // params: {years, baseYear}
  'GAP_YEARS', // params: {range}
  'ANNUAL_ONLY', // params: {lastYear}
  'SINGLE_MARKET', // params: {market}
  'COMMUNITY_DATA', // no params
  'CURATED_STAT', // params: {asOf}
  'PROXY_INDEX', // params: {index}
  'STALE_CACHE' // params: {ageHours}
];

/**
 * @param {*} data - payload
 * @param {Object} meta
 * @param {string} meta.source - primary source label
 * @param {string} [meta.attribution] - license attribution line
 * @param {string} [meta.coverage] - human-readable coverage statement
 * @param {string} [meta.estimation] - estimation disclosure (§5.1)
 * @param {Date|string} [meta.fetchedAt]
 * @param {boolean} [meta.stale=false]
 * @param {boolean} [meta.seeded=false] - served from bundled seed
 * @param {Array<{code:string, params:Object}>} [meta.caveats=[]]
 * @param {Date|string} [meta.nextRefresh]
 */
function buildEnvelope(data, meta = {}) {
  const caveats = (meta.caveats || []).filter((c) => CAVEAT_CODES.includes(c.code));
  return {
    data,
    meta: {
      fetchedAt: meta.fetchedAt || new Date().toISOString(),
      source: meta.source || 'unknown',
      attribution: meta.attribution || null,
      coverage: meta.coverage || null,
      estimation: meta.estimation || null,
      stale: Boolean(meta.stale),
      seeded: Boolean(meta.seeded),
      caveats,
      nextRefresh: meta.nextRefresh || null
    }
  };
}

/** Caveat factory helpers keep call sites terse and typo-free. */
const caveat = {
  regionalData: (country) => ({ code: 'REGIONAL_DATA', params: { country } }),
  estimatedCpi: (years, baseYear) => ({ code: 'ESTIMATED_CPI', params: { years, baseYear } }),
  gapYears: (range) => ({ code: 'GAP_YEARS', params: { range } }),
  annualOnly: (lastYear) => ({ code: 'ANNUAL_ONLY', params: { lastYear } }),
  singleMarket: (market) => ({ code: 'SINGLE_MARKET', params: { market } }),
  communityData: () => ({ code: 'COMMUNITY_DATA', params: {} }),
  curatedStat: (asOf) => ({ code: 'CURATED_STAT', params: { asOf } }),
  proxyIndex: (index) => ({ code: 'PROXY_INDEX', params: { index } }),
  staleCache: (ageHours) => ({ code: 'STALE_CACHE', params: { ageHours } })
};

module.exports = { buildEnvelope, caveat, CAVEAT_CODES };
