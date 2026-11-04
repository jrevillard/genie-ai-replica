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
 * The signature is defined ONCE, as the HUSK_IDENTITY_FIELDS and
 * HUSK_ALLOWED_FIELDS constants below; the JS predicate, the AQL matcher and
 * the tests are all derived from them, so the sides cannot drift apart.
 *
 * This script is deliberately NOT under scripts/migrations/: that directory is
 * executed automatically by the db-migrations init container on every deploy
 * (see docs/database-migrations.md). This one runs only when a human runs it.
 *
 * Usage:
 *   node report-husk-user-docs.js                  # dry-run report (default)
 *   node report-husk-user-docs.js --delete --yes   # DESTRUCTIVE: removes matched docs
 *                                                  # (--delete alone only explains how to confirm)
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

// --- The husk signature, defined once --------------------------------------
// Identity fields the document must LACK entirely (null or missing).
const HUSK_IDENTITY_FIELDS = ['iss_sub', 'sub', 'email'];
// The only non-internal fields it may CARRY: the timestamps the old reset
// preserved and an explicit soft-delete marker set to false. Every other
// application field disqualifies the document.
const HUSK_ALLOWED_FIELDS = ['createdAt', 'updatedAt', 'deleted'];

/**
 * True when a document matches the husk signature. The AQL matcher below is
 * generated from the same two constants; every AQL hit is re-checked through
 * this predicate before anything is reported or removed, so even a genuine
 * AQL-semantics surprise cannot reach the destructive path.
 * @param {Object} doc
 * @returns {boolean}
 */
function isHuskDoc(doc) {
  if (HUSK_IDENTITY_FIELDS.some((field) => doc[field] != null)) {
    return false;
  }
  // Mirrors the AQL test exactly: missing, null or boolean false only —
  // any other value ('false', 0, true) disqualifies the document.
  if (!(doc.deleted == null || doc.deleted === false)) {
    return false;
  }
  const extraFields = Object.keys(doc).filter((key) => !key.startsWith('_') && !HUSK_ALLOWED_FIELDS.includes(key));
  return extraFields.length === 0;
}

/**
 * Returns the AQL hits that failed the JS predicate — a non-empty result
 * means the two sides of the signature disagree and nothing may be deleted.
 * Exported for tests.
 * @param {Array<Object>} husks
 * @returns {Array<Object>}
 */
function findDivergences(husks) {
  return husks.filter((doc) => !isHuskDoc(doc));
}

const IDENTITY_FILTERS_AQL = HUSK_IDENTITY_FIELDS.map((field) => `FILTER u.${field} == null`).join('\n');

// ATTRIBUTES(u, true) strips the internal attributes (_key/_id/_rev); what
// remains must be a subset of the allowed fields.
const HUSK_MATCHER_AQL = `
FOR u IN @@collection
${IDENTITY_FILTERS_AQL}
  FILTER u.deleted == null || u.deleted == false
  FILTER LENGTH(MINUS(ATTRIBUTES(u, true), [${HUSK_ALLOWED_FIELDS.map((field) => `'${field}'`).join(', ')}])) == 0
  RETURN u
`;

// Docs with no iss_sub/sub but WITH an email: the dangerous lookalikes.
// Legacy pre-Keycloak accounts look exactly like this and are healthy —
// every legitimate document-creation path in the repo sets email, so these
// must never match the husk signature. Reported for operator context only.
// Derived from the identity fields MINUS email (a lookalike HAS an email —
// including the email-absence filter here would contradict it to zero rows).
const LOOKALIKE_IDENTITY_FIELDS = HUSK_IDENTITY_FIELDS.filter((field) => field !== 'email');
const LOOKALIKE_IDENTITY_FILTERS_AQL = LOOKALIKE_IDENTITY_FIELDS.map((field) => `FILTER u.${field} == null`).join('\n');
const LEGACY_LOOKALIKE_AQL = `
LET lookalikeDocs = (
  FOR u IN @@collection
  ${LOOKALIKE_IDENTITY_FILTERS_AQL}
    FILTER u.email != null
    RETURN KEEP(u, '_key', 'createdAt')
)
RETURN { count: LENGTH(lookalikeDocs), sample: SLICE(lookalikeDocs, 0, @sampleLimit) }
`;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const doDelete = process.argv.includes('--delete');
  const doConfirm = process.argv.includes('--yes');

  if (doDelete && !doConfirm) {
    console.error('--delete requires --yes: re-run with `--delete --yes` after reviewing the dry-run output.');
    process.exit(1);
  }

  if (!process.env.ARANGO_PASSWORD) {
    console.error('ARANGO_PASSWORD is required (from the shell or a .env at the repo root).');
    process.exit(1);
  }

  const db = new Database({
    url: process.env.ARANGO_URL || 'http://localhost:8529',
    databaseName: process.env.ARANGO_DB || '_system',
    auth: {
      username: process.env.ARANGO_USER || 'root',
      password: process.env.ARANGO_PASSWORD || ''
    }
  });
  const collection = db.collection(COLLECTION);
  const total = ((await collection.count()) || {}).count || 0;

  const huskCursor = await db.query(HUSK_MATCHER_AQL, { '@collection': COLLECTION });
  const husks = await huskCursor.all();

  // Defense against AQL/predicate divergence — abort before any destructive
  // step if the two disagree about what a husk is.
  const mismatches = findDivergences(husks);
  if (mismatches.length > 0) {
    console.error(
      `ABORT: ${mismatches.length} AQL hits failed the JS husk predicate — ` +
        'signature divergence, nothing was deleted:',
      JSON.stringify(mismatches, null, 2)
    );
    process.exit(1);
  }

  let lookalikeCount = 0;
  let lookalikes = [];
  if (!doDelete) {
    // Context for the dry-run report only — a --delete run has already been
    // through a reviewed dry run and needs nothing from these lookalikes.
    const lookalikeCursor = await db.query(LEGACY_LOOKALIKE_AQL, {
      '@collection': COLLECTION,
      sampleLimit: SAMPLE_LIMIT
    });
    const lookalikeResult = (await lookalikeCursor.next()) || {};
    lookalikeCount = lookalikeResult.count || 0;
    lookalikes = lookalikeResult.sample || [];
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
  console.log(`Legacy lookalikes (identity-less but WITH email — NOT husks, never deleted): ${lookalikeCount}`);
  for (const doc of lookalikes) {
    console.log(`  lookalike _key=${doc._key} createdAt=${doc.createdAt || '?'}`);
  }
  if (lookalikeCount > lookalikes.length) {
    console.log(`  ... and ${lookalikeCount - lookalikes.length} more (not listed)`);
  }

  if (!doDelete) {
    console.log('Dry run — nothing was deleted. Re-run with --delete to remove the matches.');
    return;
  }

  // Destructive path — reached only with --delete --yes, after the predicate
  // cross-check above has passed for every match. One bulk statement, so a
  // mid-way failure cannot leave an ambiguous partial state.
  console.log(`--delete given: removing ${husks.length} husk documents...`);
  await db.query('FOR k IN @keys REMOVE { _key: k } IN @@collection', {
    '@collection': COLLECTION,
    keys: husks.map((doc) => doc._key)
  });
  for (const doc of husks) {
    console.log(`  removed _key=${doc._key}`);
  }
  console.log(`Done. ${husks.length} documents removed.`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Report failed:', err);
    process.exit(1);
  });
}

module.exports = { isHuskDoc, findDivergences, HUSK_IDENTITY_FIELDS, HUSK_ALLOWED_FIELDS, HUSK_MATCHER_AQL };
