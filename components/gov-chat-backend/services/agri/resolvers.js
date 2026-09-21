/**
 * URL resolvers for volatile upstream endpoints (remediation-plan.md §3).
 *
 * The BMAD red-team verified that HDX resource UUIDs churn and the WB Pink
 * Sheet doc hash changes monthly — adapters never hardcode such URLs;
 * they resolve them here, with a last-known-good fallback from Arango/env.
 */
const { fetchJson } = require('./http');
const { logger } = require('../../shared-lib');

/**
 * Resolve the current resource URL of an HDX (CKAN) dataset resource by
 * dataset id + resource filename. Survives resource-UUID churn.
 *
 * @param {string} datasetId - CKAN package id or name (e.g. 'slv-ndvi-subnational')
 * @param {string} resourceFilename - e.g. 'slv-ndvi-subnat-5ytd.csv'
 * @param {string} fallbackUrl - last-known-good URL used if resolution fails
 * @returns {Promise<string>} direct download URL
 */
async function resolveHdxResource(datasetId, resourceFilename, fallbackUrl) {
  try {
    const pkg = await fetchJson(
      `https://data.humdata.org/api/3/action/package_show?id=${encodeURIComponent(datasetId)}`,
      { timeoutMs: 15000, maxRetries: 1 }
    );
    const resources = (pkg && pkg.result && pkg.result.resources) || [];
    const match = resources.find((r) => r.name === resourceFilename || (r.url || '').includes(resourceFilename));
    if (match && match.url) {
      return match.url;
    }
    logger.warn(`agri resolver: resource ${resourceFilename} not found in dataset ${datasetId}, using fallback`);
  } catch (error) {
    logger.warn(`agri resolver: HDX resolution failed for ${datasetId}: ${error.message}, using fallback`);
  }
  return fallbackUrl;
}

/**
 * Scrape the current Pink Sheet monthly-xlsx URL from the WB commodity
 * markets landing page. Falls back to the last-known-good hash URL.
 *
 * @param {string} landingUrl
 * @param {string} fallbackUrl
 * @returns {Promise<string>}
 */
async function resolvePinkSheet(landingUrl, fallbackUrl) {
  try {
    const { fetchUrl } = require('./http');
    const res = await fetchUrl(landingUrl, { timeoutMs: 20000, maxRetries: 1 });
    const html = res.bodyText || '';
    // Match thedocs.worldbank.org hrefs ending in CMO-Historical-Data-Monthly.xlsx
    const matches = html.match(/https:\/\/thedocs\.worldbank\.org[^"'\s]*CMO-Historical-Data-Monthly\.xlsx/g);
    if (matches && matches.length > 0) {
      return matches[0].replace(/&amp;/g, '&');
    }
    logger.warn('agri resolver: no Pink Sheet link found on landing page, using fallback');
  } catch (error) {
    logger.warn(`agri resolver: Pink Sheet scrape failed: ${error.message}, using fallback`);
  }
  return fallbackUrl;
}

module.exports = { resolveHdxResource, resolvePinkSheet };
