#!/usr/bin/env node
/**
 * report-husk-user-docs.js
 *
 * Reports identity-less "husk" user documents left by the old resetUserData
 * (pre-#1428): documents REPLACE'd down to {_key, createdAt, updatedAt}, which
 * no provisioning matcher can re-link to a login (no iss_sub, no sub, no
 * email) and which the admin users list keeps showing (`deleted` missing
 * matches `FILTER u.deleted != true`).
 *
 * Husk signature (ALL of it — tested together, never "no iss_sub" alone):
 *   - no iss_sub, no sub, no email   — nothing to re-link the doc to a login
 *   - deleted missing or false       — soft-deleted docs are NOT husks
 *   - no other application fields    — only _key/_id/_rev system fields remain
 *
 * This script is deliberately NOT under scripts/migrations/: that directory is
 * executed automatically by the db-migrations init container on every deploy
 * (see docs/database-migrations.md). This one runs only when a human runs it.
 *
 * Usage:
 *   node report-husk-user-docs.js              # dry-run report (default)
 *   node report-husk-user-docs.js --delete     # DESTRUCTIVE: removes matched docs
 *
 * Environment variables (from the shell, or a .env at the repo root):
 *   ARANGO_URL        (default http://localhost:8529)
 *   ARANGO_DB         (default _system)
 *   ARANGO_USER       (default root)
 *   ARANGO_PASSWORD   (no default — required by your Arango setup)
 *   ARANGO_COLLECTION (default users)
 */

const { Database } = require('arangojs');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

const COLLECTION = process.env.ARANGO_COLLECTION || 'users';
const SAMPLE_LIMIT = 50;

// The only non-internal fields a husk may carry: the timestamps the old
// reset preserved and an explicit soft-delete marker set to false. The
// identity fields (iss_sub, sub, email) are tested for absence; every other
// application field disqualifies the document.
const HUSK_ALLOWED_FIELDS = ['createdAt', 'updatedAt', 'deleted'];

// ---------------------------------------------------------------------------
// Signature — one JS predicate and the same tests in AQL
// ---------------------------------------------------------------------------

/**
 * True when a document matches the husk signature. The AQL query below runs
 * the same tests; every AQL hit is re-checked through this predicate before
 * anything is reported or removed, so the two cannot silently diverge.
 * @param {Object} doc
 * @returns {boolean}
 */
function isHuskDoc(doc) {
  if (doc.iss_sub != null || doc.sub != null || doc.email != null) {
    return false;
  }
  if (doc.deleted === true) {
    return false;
  }
  const extraFields = Object.keys(doc).filter((key) => !key.startsWith('_') && !HUSK_ALLOWED_FIELDS.includes(key));
  return extraFields.length === 0;
}

// ATTRIBUTES(u, true) strips the internal attributes (_key/_id/_rev); what
// remains must be a subset of the allowed fields.
const HUSK_MATCHER_AQL = `
FOR u IN @@collection
  FILTER u.iss_sub == null
  FILTER u.sub == null
  FILTER u.email == null
  FILTER u.deleted == null || u.deleted == false
  FILTER LENGTH(MINUS(ATTRIBUTES(u, true), ['createdAt', 'updatedAt', 'deleted'])) == 0
  RETURN u
`;

// Docs with no iss_sub/sub but WITH an email: the dangerous lookalikes.
// Legacy pre-Keycloak accounts look exactly like this and are healthy —
// every legitimate document-creation path in the repo sets email, so these
// must never match the husk signature. Reported for operator context only.
const LEGACY_LOOKALIKE_AQL = `
FOR u IN @@collection
  FILTER u.iss_sub == null
  FILTER u.sub == null
  FILTER u.email != null
  LIMIT @sampleLimit
  RETURN KEEP(u, '_key', 'createdAt', 'updatedAt')
`;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const doDelete = process.argv.includes('--delete');

  const db = new Database({
    url: process.env.ARANGO_URL || 'http://localhost:8529',
    databaseName: process.env.ARANGO_DB || '_system',
    auth: {
      username: process.env.ARANGO_USER || 'root',
      password: process.env.ARANGO_PASSWORD || ''
    }
  });
  const totals = await db.query('FOR u IN @@collection COLLECT WITH COUNT INTO c RETURN c', {
    '@collection': COLLECTION
  });
  const total = (await totals.next()) || 0;

  const husks = [];
  const huskCursor = await db.query(HUSK_MATCHER_AQL, { '@collection': COLLECTION });
  for await (const doc of huskCursor) {
    husks.push(doc);
  }

  // Defense against AQL/predicate divergence — abort before any destructive
  // step if the two disagree about what a husk is.
  const mismatches = husks.filter((doc) => !isHuskDoc(doc));
  if (mismatches.length > 0) {
    console.error(
      `ABORT: ${mismatches.length} AQL hits failed the JS husk predicate — ` +
        'signature divergence, nothing was deleted:',
      JSON.stringify(mismatches, null, 2)
    );
    process.exit(1);
  }

  const lookalikes = [];
  const lookalikeCursor = await db.query(LEGACY_LOOKALIKE_AQL, {
    '@collection': COLLECTION,
    sampleLimit: SAMPLE_LIMIT
  });
  for await (const doc of lookalikeCursor) {
    lookalikes.push(doc);
  }

  console.log('--- Husk user-document report (READ ONLY unless --delete) ---');
  console.log(`Database:      ${db.name}`);
  console.log(`Collection:    ${COLLECTION}`);
  console.log(`Total docs:    ${total}`);
  console.log(`Husk matches:  ${husks.length}`);
  for (const doc of husks.slice(0, SAMPLE_LIMIT)) {
    console.log(
      `  husk _key=${doc._key} createdAt=${doc.createdAt || '?'} updatedAt=${doc.updatedAt || '?'} ` +
        `attributes=${JSON.stringify(Object.keys(doc).sort())}`
    );
  }
  if (husks.length > SAMPLE_LIMIT) {
    console.log(`  ... and ${husks.length - SAMPLE_LIMIT} more (not listed)`);
  }
  console.log(`Legacy lookalikes (identity-less but WITH email — NOT husks, never deleted): ${lookalikes.length}`);
  for (const doc of lookalikes) {
    console.log(`  lookalike _key=${doc._key} createdAt=${doc.createdAt || '?'}`);
  }

  if (!doDelete) {
    console.log('Dry run — nothing was deleted. Re-run with --delete to remove the matches.');
    return;
  }

  // Destructive path — reached only with --delete, after the predicate
  // cross-check above has passed for every match.
  console.log(`--delete given: removing ${husks.length} husk documents...`);
  for (const doc of husks) {
    await db.query('REMOVE u IN @@collection', {
      '@collection': COLLECTION,
      u: doc._key
    });
    console.log(`  removed _key=${doc._key}`);
  }
  console.log(`Done. ${husks.length} documents removed.`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Report failed:', err.message);
    process.exit(1);
  });
}

module.exports = { isHuskDoc, HUSK_ALLOWED_FIELDS, HUSK_MATCHER_AQL, LEGACY_LOOKALIKE_AQL };
