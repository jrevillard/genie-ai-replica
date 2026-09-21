#!/usr/bin/env node
/**
 * export-agri-seeds — regenerate the bundled seed envelopes from the live
 * ArangoDB cache (remediation-plan.md §5 — the CI seed-export job).
 *
 * Run after a healthy prefetch cycle (all adapters green on /api/agri/health):
 *   node scripts/export-agri-seeds.js > services/agri/seeds/generated.json
 *
 * `generated.json` is merged over the hand-maintained seeds/index.js at
 * module load — see seeds/index.js. Regenerate monthly (scheduled pipeline)
 * so cold deployments always boot with recent real data.
 *
 * Env: ARANGO_URL, ARANGO_DB, ARANGO_USER, ARANGO_PASSWORD (same as app).
 *
 * Safety: refuses to run against production ArangoDB without explicit opt-in.
 * Production detection: any ARANGO_DB other than the safe defaults
 * ('genie-ai' for dev/test, 'el-salvador' for el-salvador test stack) requires
 * AGRI_SEEDS_REGEN_CONFIRM=1. Set this env var in CI / scheduled pipelines
 * where the export is intentional.
 */
const arangojs = require('arangojs');

const SAFE_DBS = new Set(['genie-ai', 'genie', 'genie_test']);
const DB_NAME = process.env.ARANGO_DB || 'genie-ai';
if (!SAFE_DBS.has(DB_NAME) && process.env.AGRI_SEEDS_REGEN_CONFIRM !== '1') {
  console.error(
    `export-agri-seeds: refusing to write to non-standard ARANGO_DB='${DB_NAME}'. ` +
      `Re-run with AGRI_SEEDS_REGEN_CONFIRM=1 to override this guard, ` +
      `or set ARANGO_DB to one of: ${[...SAFE_DBS].join(', ')}.`
  );
  process.exit(2);
}

// Redact the password from any error path so it doesn't end up in shared
// log files (VictoriaLogs / CI artifacts). The password is intentionally
// not loaded into a variable — only passed to arangojs via process.env.
const SAFE_ERROR = (msg) =>
  String(msg || '').replace(
    new RegExp(String(process.env.ARANGO_PASSWORD || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
    '***'
  );

const ENDPOINT_KEYS = [
  'crop-health',
  'pest-alerts',
  'maize',
  'cropProtection',
  'vegetables',
  'livestock',
  'fertilizer',
  'apiary',
  'aquaculture',
  'harvestStorage'
].flatMap((key) =>
  key.includes('-') && !key.startsWith('market') && !key.includes('health') ? [key] : [`market-prices:${key}`]
);

async function main() {
  const db = arangojs.createDatabase({
    url: process.env.ARANGO_URL || 'http://localhost:8529',
    databaseName: DB_NAME,
    auth: {
      username: process.env.ARANGO_USER || 'root',
      password: process.env.ARANGO_PASSWORD || ''
    }
  });

  const out = {};
  for (const key of ENDPOINT_KEYS) {
    try {
      const doc = await db
        .collection('agri_cache')
        .document(key)
        .catch(() => null);
      if (doc && doc.envelope) {
        out[key] = { ...doc.envelope, meta: { ...doc.envelope.meta, seeded: true } };
        console.error(`ok: ${key} (fetched ${doc.envelope.meta.fetchedAt})`);
      } else {
        console.error(`skip: ${key} (not in agri_cache — run the prefetch first)`);
      }
    } catch (error) {
      console.error(`error: ${key}: ${SAFE_ERROR(error.message)}`);
    }
  }

  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
}

main().catch((error) => {
  console.error(`export-agri-seeds failed: ${SAFE_ERROR(error.message)}`);
  process.exit(1);
});
