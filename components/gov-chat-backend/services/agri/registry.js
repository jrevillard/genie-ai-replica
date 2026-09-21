/**
 * Source adapter registry (remediation-plan.md §3).
 *
 * Registers every non-underscore module in adapters/; AGRI_SOURCES_ENABLED
 * filters the active set. Adding a source = drop a file here + register.
 */
const fs = require('fs');
const path = require('path');
const { enabledSources } = require('./config');
const { logger } = require('../../shared-lib');

function loadRegistry() {
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

/** All registered adapters, filtered by AGRI_SOURCES_ENABLED. */
function enabledAdapters() {
  const registry = loadRegistry();
  const ids = [...registry.keys()];
  const enabled = enabledSources(ids);
  return ids.filter((id) => enabled.has(id)).map((id) => registry.get(id));
}

module.exports = { loadRegistry, enabledAdapters };
