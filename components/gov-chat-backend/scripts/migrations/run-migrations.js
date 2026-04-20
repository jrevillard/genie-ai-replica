#!/usr/bin/env node
'use strict';

/**
 * ArangoDB Migration Runner
 *
 * Scans scripts/migrations/ for files matching NNN-description.js,
 * checks which have already been applied (via schema_migrations collection),
 * and runs pending migrations in order.
 *
 * Each migration script must export an async up(db) function.
 * Each migration is responsible for its own idempotency.
 *
 * Usage:
 *   node run-migrations.js
 *
 * Environment Variables:
 * - ARANGO_URL (default: http://127.0.0.1:8529)
 * - ARANGO_DB (default: genie-ai)
 * - ARANGO_USER (default: root)
 * - ARANGO_PASSWORD (required)
 */

require('dotenv').config({ path: require('path').join(__dirname, '../../../.env') });
const { Database } = require('arangojs');
const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, 'scripts', 'migrations');
const COLLECTION_NAME = 'schema_migrations';

async function main() {
  const dbUrl = process.env.ARANGO_URL || 'http://127.0.0.1:8529';
  const dbName = process.env.ARANGO_DB || 'genie-ai';
  const user = process.env.ARANGO_USER || 'root';
  const password = process.env.ARANGO_PASSWORD;

  if (!password) {
    console.error('[migrations] ERROR: ARANGO_PASSWORD is required');
    process.exit(1);
  }

  const db = new Database({ url: dbUrl, databaseName: dbName, auth: { username: user, password } });
  await db.get();
  console.log(`[migrations] Connected to ${dbName} at ${dbUrl}`);

  const collection = db.collection(COLLECTION_NAME);
  const exists = await collection.exists();
  if (!exists) {
    await db.createCollection(COLLECTION_NAME);
    console.log(`[migrations] Created ${COLLECTION_NAME} collection`);
  }

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => /^\d{3}-.*\.js$/.test(f))
    .sort();

  if (files.length === 0) {
    console.log('[migrations] No migration scripts found');
    return;
  }

  console.log(`[migrations] Found ${files.length} migration script(s)`);

  let applied = 0;
  let skipped = 0;

  for (const file of files) {
    const migrationKey = file.replace('.js', '');

    const doc = await collection.documentExists(migrationKey);
    if (doc) {
      console.log(`  SKIP ${file} (already applied)`);
      skipped++;
      continue;
    }

    console.log(`  RUN  ${file} ...`);
    const startTime = Date.now();

    try {
      const migration = require(path.join(MIGRATIONS_DIR, file));
      if (typeof migration.up !== 'function') {
        throw new Error('Migration must export an up(db) function');
      }
      await migration.up(db);

      await collection.insert({
        _key: migrationKey,
        appliedAt: new Date().toISOString()
      });

      const elapsed = Date.now() - startTime;
      console.log(`  OK   ${file} (${elapsed}ms)`);
      applied++;
    } catch (error) {
      console.error(`  FAIL ${file}: ${error.message}`);
      process.exit(1);
    }
  }

  console.log(`[migrations] Done: ${applied} applied, ${skipped} skipped, ${files.length} total`);
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('[migrations] Fatal error:', err.message);
    process.exit(1);
  });
