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
 *   ARANGO_DB         (default genie-ai — the docker-compose default, also
 *                     used by run-migrations.js and seed-synthetic-data.js;
 *                     other siblings differ — the app code's own fallback is
 *                     'node-services', create-ingestion-log.js uses
 *                     ARANGO_DATABASE — so verify the printed 'Database:'
 *                     line before trusting the report)
 *   ARANGO_USER       (default root)
 *   ARANGO_PASSWORD   (no default — required by your Arango setup)
 *   ARANGO_COLLECTION (default users)
 */

const { Database } = require('arangojs');
const path = require('path');

const SAMPLE_LIMIT = 50;

// --- The husk signature, defined once --------------------------------------
// Deliberately NOT imported from constants/jit-fields.js: that module describes
// the fields the CURRENT reset (post-#1428) manages, while this signature
// describes the shape the OLD reset (pre-#1428) left behind — the husk keeps
// only the timestamps that reset preserved.
// ArangoDB's own document fields (the complete set — anything else that
// looks internal but is not one of these disqualifies the document).
const HUSK_SYSTEM_FIELDS = ['_key', '_id', '_rev'];
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
  const extraFields = Object.keys(doc).filter(
    (key) => !HUSK_SYSTEM_FIELDS.includes(key) && !HUSK_ALLOWED_FIELDS.includes(key)
  );
  return extraFields.length === 0;
}

/**
 * Compares the AQL match set with the set the JS predicate computes from the
 * whole collection — in BOTH directions. `extra` = AQL matched a document the
 * predicate rejects (AQL too permissive); `missed` = the predicate accepts a
 * document the AQL never returned (AQL too restrictive — the silent
 * direction, which would report "0 husks" on a database full of them).
 * Exported for tests.
 * @param {Array<Object>} aqlHits
 * @param {Array<Object>} allDocs
 * @returns {{extra: Array<Object>, missed: Array<Object>}}
 */
function compareSignatureSets(aqlHits, allDocs) {
  const expectedKeys = new Set(allDocs.filter(isHuskDoc).map((doc) => doc._key));
  const aqlKeys = new Set(aqlHits.map((doc) => doc._key));
  return {
    extra: aqlHits.filter((doc) => !expectedKeys.has(doc._key)),
    missed: allDocs.filter((doc) => isHuskDoc(doc) && !aqlKeys.has(doc._key))
  };
}

const IDENTITY_FILTERS_AQL = HUSK_IDENTITY_FIELDS.map((field) => `FILTER u.${field} == null`).join('\n');

// The full signature as an AQL FILTER fragment, shared by the matcher and the
// removal query — the removal re-asserts the signature so a document that was
// soft-deleted between the SELECT and the REMOVE (or any other concurrent
// write that disqualifies it) is not destroyed by its _key alone.
const HUSK_SIGNATURE_FILTERS_AQL = [
  IDENTITY_FILTERS_AQL,
  'FILTER u.deleted == null || u.deleted == false',
  // ATTRIBUTES(u) keeps the internal fields, and MINUS subtracts the exact
  // allowlist (system fields + allowed set) — an underscore-prefixed
  // application field the document should not carry therefore disqualifies
  // it here exactly as it does in the JS predicate.
  `FILTER LENGTH(MINUS(ATTRIBUTES(u), [${[...HUSK_SYSTEM_FIELDS, ...HUSK_ALLOWED_FIELDS]
    .map((field) => `'${field}'`)
    .join(', ')}])) == 0`
].join('\n  ');

// What remains on a husk is exactly the system fields plus the allowed set.
const HUSK_MATCHER_AQL = `
FOR u IN @@collection
  ${HUSK_SIGNATURE_FILTERS_AQL}
  RETURN u
`;

// The removal: keys selected by the matcher, re-filtered through the full
// signature at removal time so a concurrent disqualifying write (e.g. a GDPR
// soft-delete landing between SELECT and REMOVE) is skipped, not destroyed.
const HUSK_REMOVAL_AQL = `
FOR k IN (
  FOR u IN @@collection
  FILTER u._key IN @keys
  ${HUSK_SIGNATURE_FILTERS_AQL}
  RETURN u._key
)
REMOVE { _key: k } IN @@collection
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
    FILTER u.deleted == null || u.deleted == false
    RETURN KEEP(u, '_key', 'createdAt')
)
RETURN { count: LENGTH(lookalikeDocs), sample: SLICE(lookalikeDocs, 0, @sampleLimit) }
`;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  // Resolved here, not at module scope: dotenv loads the repo-root .env when
  // the script runs, so a module-scope read would miss ARANGO_COLLECTION.
  const COLLECTION = process.env.ARANGO_COLLECTION || 'users';
  const ARANGO_URL = process.env.ARANGO_URL || 'http://localhost:8529';
  const doDelete = process.argv.includes('--delete');
  const doConfirm = process.argv.includes('--yes');

  if (doDelete && !doConfirm) {
    console.error('--delete requires --yes: re-run with `--delete --yes` after reviewing the dry-run output.');
    process.exitCode = 1;
    return;
  }

  if (!process.env.ARANGO_PASSWORD) {
    console.error('ARANGO_PASSWORD is required (from the shell or a .env at the repo root).');
    process.exitCode = 1;
    return;
  }

  const db = new Database({
    url: ARANGO_URL,
    databaseName: process.env.ARANGO_DB || 'genie-ai',
    auth: {
      username: process.env.ARANGO_USER || 'root',
      password: process.env.ARANGO_PASSWORD || ''
    }
  });
  const collection = db.collection(COLLECTION);
  const total = (await collection.count()).count || 0;

  const huskCursor = await db.query(HUSK_MATCHER_AQL, { '@collection': COLLECTION });
  const husks = await huskCursor.all();

  // Defense against AQL/predicate divergence — abort before any destructive
  // step if the two disagree about what a husk is, in EITHER direction: an
  // AQL hit the predicate rejects (AQL too permissive) or a document the
  // predicate accepts that the AQL never returned (AQL too restrictive — the
  // silent direction, which would otherwise report "0 husks" on a database
  // full of them). Only _key and attribute NAMES are printed: the mismatch
  // documents are by definition not husks and can carry real PII, which must
  // not reach the log store via stderr.
  const allDocsCursor = await db.query('FOR u IN @@collection RETURN u', { '@collection': COLLECTION });
  const allDocs = await allDocsCursor.all();
  const { extra, missed } = compareSignatureSets(husks, allDocs);
  if (extra.length > 0 || missed.length > 0) {
    console.error(
      `ABORT: the AQL matcher and the signature disagree — ${extra.length} AQL hit(s) rejected by the predicate, ` +
        `${missed.length} document(s) accepted by the predicate but not matched by the AQL. Nothing was deleted.`
    );
    for (const doc of extra) {
      console.error(`  over-matched _key=${doc._key} attributes=${JSON.stringify(Object.keys(doc).sort())}`);
    }
    for (const doc of missed) {
      console.error(`  under-matched _key=${doc._key} attributes=${JSON.stringify(Object.keys(doc).sort())}`);
    }
    process.exitCode = 1;
    return;
  }

  // Field census over the whole collection: any field outside the signature's
  // allowlist, with its count. The operator sees shape surprises the signature
  // cannot know about (a field every document carries, a new issuer's field),
  // instead of a bare "N husks" that cannot explain itself.
  const fieldCounts = new Map();
  for (const doc of allDocs) {
    for (const key of Object.keys(doc)) {
      if (!fieldCounts.has(key)) {
        fieldCounts.set(key, 0);
      }
      fieldCounts.set(key, fieldCounts.get(key) + 1);
    }
  }
  const unexpectedFields = [...fieldCounts.entries()]
    .filter(([key]) => !HUSK_SYSTEM_FIELDS.includes(key) && !HUSK_ALLOWED_FIELDS.includes(key))
    .sort((a, b) => b[1] - a[1]);

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
  console.log(`Arango URL:    ${ARANGO_URL}`);
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
  if (unexpectedFields.length > 0) {
    console.log('Fields present outside the husk signature (not husks, never deleted):');
    for (const [key, count] of unexpectedFields) {
      console.log(`  field ${key}: ${count} document(s)`);
    }
  }
  if (doDelete) {
    console.log('Legacy lookalikes: not measured in --delete mode.');
  } else {
    console.log(`Legacy lookalikes (identity-less but WITH email — NOT husks, never deleted): ${lookalikeCount}`);
    for (const doc of lookalikes) {
      console.log(`  lookalike _key=${doc._key} createdAt=${doc.createdAt || '?'}`);
    }
    if (lookalikeCount > lookalikes.length) {
      console.log(`  ... and ${lookalikeCount - lookalikes.length} more (not listed)`);
    }
  }

  if (!doDelete) {
    console.log('Dry run — nothing was deleted. Re-run with --delete to remove the matches.');
    return;
  }

  // Destructive path — reached only with --delete --yes, after the predicate
  // cross-check above has passed for every match. One bulk statement that
  // RE-ASSERTS the husk signature, so a document concurrently disqualified
  // between the SELECT and the REMOVE (e.g. a GDPR soft-delete writing
  // deleted:true) is left alone; a mid-way failure cannot leave an ambiguous
  // partial state.
  console.log(`--delete given: removing ${husks.length} husk documents...`);
  const removalCursor = await db.query(HUSK_REMOVAL_AQL, {
    '@collection': COLLECTION,
    keys: husks.map((doc) => doc._key)
  });
  // The removal re-asserts the signature, so docs disqualified since the
  // SELECT are skipped server-side — report what actually executed, not the
  // selection size. If the stats are missing, say so and fail rather than
  // claim success: on a destructive path the honest answer is "unknown".
  const writesExecuted = ((removalCursor.extra || {}).stats || {}).writesExecuted;
  if (typeof writesExecuted !== 'number') {
    console.error(
      'ABORT: the removal result carried no writesExecuted stats — the actual ' +
        'number of removed documents is unknown. Re-run the dry run to verify.'
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    `Done. ${writesExecuted} of ${husks.length} selected documents removed.` +
      (writesExecuted < husks.length
        ? ` ${husks.length - writesExecuted} were NOT removed — the reason is not observable ` +
          'from this run (the removal re-checks the signature at removal time); re-run the dry run to see what remains.'
        : '')
  );
}

if (require.main === module) {
  // Loaded only for CLI execution — requiring this module (e.g. from the
  // tests) must not pull the operator's .env into the test process.
  require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });
  main().catch((err) => {
    // Message + stack, not the whole arangojs response object (it dumps the
    // entire HTTP exchange, which buries the actual cause).
    console.error('Report failed:', err.message);
    if (err.stack) {
      console.error(err.stack);
    }
    process.exitCode = 1;
  });
}

module.exports = {
  isHuskDoc,
  compareSignatureSets,
  HUSK_IDENTITY_FIELDS,
  HUSK_SYSTEM_FIELDS,
  HUSK_ALLOWED_FIELDS,
  HUSK_MATCHER_AQL,
  HUSK_REMOVAL_AQL
};
