/**
 * Adapter configuration (remediation-plan.md §3 — pluggable harness).
 *
 * Every adapter declares a configPrefix; its defaults live in the adapter,
 * and every key is env-overridable as AGRI_<PREFIX>_<KEY>. Sources are
 * enabled/disabled globally via AGRI_SOURCES_ENABLED (comma list; default
 * all registered). This is what makes "the endpoint moved" a config or
 * one-adapter change instead of a code hunt.
 */
const { logger } = require('../../shared-lib');

const DEFAULT_CADENCE_MS = 24 * 60 * 60 * 1000; // 24 h
const CADENCES = {
  '1h': 60 * 60 * 1000,
  '24h': DEFAULT_CADENCE_MS,
  '1w': 7 * DEFAULT_CADENCE_MS
};

/**
 * @param {Object} adapter - adapter module
 * @param {Object} adapter.defaults - default config values
 * @param {string} adapter.configPrefix
 * @returns {Object} merged config (env wins)
 */
function adapterConfig(adapter) {
  const cfg = { ...(adapter.defaults || {}) };
  for (const key of Object.keys(cfg)) {
    const envKey = `AGRI_${adapter.configPrefix}_${key.toUpperCase()}`;
    if (process.env[envKey] !== undefined) {
      cfg[key] = process.env[envKey];
    }
  }
  return cfg;
}

function cadenceMs(adapter) {
  const raw = adapter.cadence || '24h';
  if (CADENCES[raw]) return CADENCES[raw];
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : DEFAULT_CADENCE_MS;
}

/**
 * Parse the enabled-sources list. Empty/unset = all registered adapters.
 * @param {string[]} registeredIds
 * @returns {Set<string>}
 */
function enabledSources(registeredIds) {
  const raw = process.env.AGRI_SOURCES_ENABLED;
  if (!raw || !raw.trim()) return new Set(registeredIds);
  const requested = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const unknown = requested.filter((id) => !registeredIds.includes(id));
  if (unknown.length > 0) {
    logger.warn(`agri config: AGRI_SOURCES_ENABLED contains unknown adapters: ${unknown.join(', ')}`);
  }
  return new Set(requested.filter((id) => registeredIds.includes(id)));
}

module.exports = { adapterConfig, cadenceMs, enabledSources, DEFAULT_CADENCE_MS };
