/**
 * Source adapter registry (remediation-plan.md §3).
 *
 * Registers every non-underscore module in adapters/; AGRI_SOURCES_ENABLED
 * filters the active set. Adding a source = drop a file here + register.
 *
 * The registry is built once at module load to avoid repeated fs.readdirSync
 * and require() calls on every enabledAdapters() invocation.
 */
const fs = require('fs');
const path = require('path');
const { enabledSources } = require('./config');
const { logger } = require('../../shared-lib');

function buildRegistry() {
  const dir = path.join(__dirname, 'adapters');
  const registry = new Map();

  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.js') || file.startsWith('_')) continue;
    const adapter = require(path.join(dir, file));
    if (!adapter || !adapter.id || typeof adapter.fetch !== 'function') {
      logger.warn(`agri registry: ${file} is not a valid adapter, skipped`);
      continue;
    }
    registry.set(adapter.id, adapter);
  }
  return registry;
}

// Build once at module load — same lifetime as the backend process.
const REGISTRY = buildRegistry();

function loadRegistry() {
  return REGISTRY;
}

/** All registered adapters, filtered by AGRI_SOURCES_ENABLED. */
function enabledAdapters() {
  const ids = [...REGISTRY.keys()];
  const enabled = enabledSources(ids);
  return ids.filter((id) => enabled.has(id)).map((id) => REGISTRY.get(id));
}

module.exports = { loadRegistry, enabledAdapters };
