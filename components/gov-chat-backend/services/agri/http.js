/**
 * HTTP fetch helper for agri source adapters.
 *
 * Wraps axios with: hard timeout, bounded retries with exponential backoff,
 * and response-size capping (feeds are third-party content — see the BMAD
 * verification hardening: never parse unbounded payloads).
 */
const axios = require('axios');
const { logger } = require('../../shared-lib');

const DEFAULT_TIMEOUT_MS = 30000;
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB payload cap (BMAD hardening)
const MAX_RETRIES = 2;
const BACKOFF_BASE_MS = 2000;

/**
 * @param {string} url
 * @param {Object} [opts]
 * @param {Object} [opts.headers]
 * @param {string} [opts.method='get']
 * @param {*} [opts.data]
 * @param {number} [opts.timeoutMs]
 * @param {number} [opts.maxRetries]
 * @param {number[]} [opts.retryOnStatus] - extra statuses treated as retryable (default 429,502,503,504)
 * @param {string} [opts.responseType] - axios responseType ('arraybuffer' for binaries)
 * @returns {Promise<{status:number, headers:Object, data:*, bodyText:string|null}>}
 */
async function fetchUrl(url, opts = {}) {
  const {
    headers = {},
    method = 'get',
    data,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxRetries = MAX_RETRIES,
    retryOnStatus = [429, 502, 503, 504],
    responseType
  } = opts;

  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await axios({
        url,
        method,
        headers,
        data,
        timeout: timeoutMs,
        responseType: responseType || 'text',
        // Follow redirects (HDX 302 -> signed S3); axios does by default on node
        maxRedirects: 5,
        // Decompress automatically
        decompress: true,
        transformResponse: [(d) => d] // keep raw; callers parse explicitly
      });

      // Response-size guard
      const size =
        typeof response.data === 'string' ? response.data.length : (response.data && response.data.byteLength) || 0;
      if (size > MAX_BYTES) {
        throw new Error(`Payload too large: ${size} bytes > ${MAX_BYTES} (url: ${url})`);
      }

      return {
        status: response.status,
        headers: response.headers || {},
        data: response.data,
        bodyText: typeof response.data === 'string' ? response.data : null
      };
    } catch (error) {
      lastError = error;
      const status = error.response && error.response.status;
      const retryable = !status || retryOnStatus.includes(status) || error.code === 'ECONNABORTED';

      if (attempt < maxRetries && retryable) {
        const delay = BACKOFF_BASE_MS * Math.pow(2, attempt);
        logger.warn(
          `agri fetch retry ${attempt + 1}/${maxRetries} for ${url} ` +
            `(${status || error.code || error.message}) in ${delay}ms`
        );
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw error;
    }
  }

  throw lastError;
}

/**
 * Fetch a URL that is expected to return JSON.
 * @returns {Promise<Object>} parsed JSON body
 */
async function fetchJson(url, opts = {}) {
  const res = await fetchUrl(url, {
    ...opts,
    headers: { Accept: 'application/json', ...(opts.headers || {}) }
  });
  if (typeof res.data !== 'string') return res.data; // responseType json passthrough
  return JSON.parse(res.data);
}

module.exports = { fetchUrl, fetchJson, MAX_BYTES };
