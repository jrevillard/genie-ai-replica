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
 *   ARANGO_DB         (REQUIRED — the database the app uses: 'genie-ai' in
 *                     docker-compose deployments, 'node-services' in the app
 *                     code's fallback. No default on purpose: a wrong-but-
 *                     existing database reports "0 husks" with exit code 0,
 *                     which reads exactly like "this environment is clean")
 *   ARANGO_COLLECTION (default users — the users collection of the app;
 *                     this script is the only place that variable is read)
 *   ARANGO_USER       (default root)
 *   ARANGO_PASSWORD   (no default — required by your Arango setup)
 *   HUSK_SAMPLE_LIMIT (default 50 — how many entries each per-document
 *                     listing prints before the rest are elided. Raise it for
 *                     a one-off diagnostic run to dump the withheld keys;
 *                     every listing honours it, including the divergence
 *                     listing of the abort path)
 */

const { Database } = require('arangojs');
const path = require('path');

// The default cap on the per-document listings. Every listing in this script
// goes through printSampledList below, so this constant and the
// HUSK_SAMPLE_LIMIT override are the only two places the cap is stated.
const DEFAULT_SAMPLE_LIMIT = 50;

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

// The full-collection read the divergence cross-check compares against the
// matcher.
const ALL_DOCS_AQL = 'FOR u IN @@collection RETURN u';

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

/**
 * Renders a document key as a JSON string literal, so a key copied out of a
 * listing can be pasted straight into a query or a JSON payload without
 * re-quoting it (issue #1507).
 * @param {Object} doc
 * @returns {string}
 */
function quotedKey(doc) {
  return JSON.stringify(doc._key);
}

/**
 * Prints a per-document listing capped at `limit` entries, followed by ONE
 * elision line when entries were withheld. Every per-document listing in this
 * script goes through this helper, so the cap, the `>` boundary and the
 * elision wording live in ONE place and the three sites cannot drift apart
 * (issue #1508).
 *
 * `total` may exceed `docs.length`: the lookalike sample is truncated
 * SERVER-side, so the count of all lookalikes and the returned sample are
 * different numbers.
 * @param {Object} params
 * @param {Function} params.write - the sink (console.log / console.error)
 * @param {string} params.label - the noun in the elision line ('' for none)
 * @param {Array<Object>} params.docs - the entries to list
 * @param {number} params.total - how many entries exist in this listing
 * @param {number} params.limit - the cap
 * @param {number} params.suggestedLimit - the HUSK_SAMPLE_LIMIT value that
 *   lists EVERYTHING this run withholds (the knob is global, so it must cover
 *   every listing of the run, not just this one)
 * @param {Function} params.format - renders one entry line
 */
function printSampledList({ write, label, docs, total, limit, suggestedLimit, format }) {
  const listed = docs.slice(0, limit);
  for (const doc of listed) {
    write(format(doc));
  }
  const withheld = total - listed.length;
  if (withheld > 0) {
    write(
      `  ... and ${withheld} more${label ? ` ${label}` : ''} (not listed) — ` +
        `re-run with HUSK_SAMPLE_LIMIT=${suggestedLimit} to list them all`
    );
  }
}

// Renders a rejection value as a short cause string for an operator-facing
// error line. Errors render as their message; anything else is stringified
// (guarded, so a circular structure cannot crash the error path itself).
function causeOf(err) {
  if (err instanceof Error) {
    return err.message || String(err);
  }
  if (typeof err === 'string') {
    return err;
  }
  try {
    return JSON.stringify(err) ?? String(err);
  } catch {
    return String(err);
  }
}

// ---------------------------------------------------------------------------
// Safety gates and run modes
// ---------------------------------------------------------------------------

/**
 * Parses the CLI arguments and the operator gates. Side effects: on a failed
 * gate it prints the reason to stderr and sets process.exitCode, then returns
 * null; when every gate passes it returns the fully resolved run
 * configuration { mode, database, collection, arangoUrl, username, password }
 * — the single source main() reads after gating. It reads only its
 * parameters (no module state, no process.argv/env), which is what makes it
 * unit-testable. Exported for tests (issue #1494).
 * @param {string[]} argv
 * @param {Object} env
 * @returns {Object|null}
 */
function parseAndGateArgs(argv, env) {
  const fail = (message) => {
    console.error(message);
    process.exitCode = 1;
    return null;
  };
  const doDelete = argv.includes('--delete');
  const doConfirm = argv.includes('--yes');

  if (doDelete && !doConfirm) {
    return fail('--delete requires --yes: re-run with `--delete --yes` after reviewing the dry-run output.');
  }

  if (!env.ARANGO_PASSWORD) {
    return fail('ARANGO_PASSWORD is required (from the shell or a .env at the repo root).');
  }

  // No default database name: the app's database differs per deployment
  // ('genie-ai' in compose, 'node-services' in the app code's fallback), and a
  // wrong-but-existing database reports "0 husks" with exit code 0 — the
  // operator cannot tell "this environment is clean" from "this is the wrong
  // database". So the operator must name it, and it must exist.
  if (!env.ARANGO_DB) {
    return fail(
      'ARANGO_DB is required (the database the app uses — e.g. genie-ai in docker-compose ' +
        'deployments, node-services elsewhere). No default: a wrong database reports 0 husks.'
    );
  }

  // The listing cap. An operator raises it for a one-off diagnostic run to
  // see the entries the default cap withholds (issue #1507). A malformed
  // override is a GATE failure, not a silent fallback: an operator who asked
  // for 500 entries and silently gets 50 — with no notice — is back to the
  // very confusion the override exists to remove.
  const sampleLimit = parseSampleLimit(env.HUSK_SAMPLE_LIMIT);
  if (sampleLimit === null) {
    return fail(`HUSK_SAMPLE_LIMIT must be a positive integer (got ${JSON.stringify(env.HUSK_SAMPLE_LIMIT)}).`);
  }

  return {
    mode: doDelete ? 'delete' : 'report',
    database: env.ARANGO_DB,
    collection: env.ARANGO_COLLECTION || 'users',
    arangoUrl: env.ARANGO_URL || 'http://localhost:8529',
    username: env.ARANGO_USER || 'root',
    password: env.ARANGO_PASSWORD,
    sampleLimit
  };
}

/**
 * Resolves the listing cap: the default, or the operator's override for a
 * one-off diagnostic run. Returns null for a malformed override — the caller
 * turns that into a gate failure, because a silent fallback would hand back
 * the same capped listing the override exists to lift (issue #1507).
 * @param {string|undefined} raw
 * @returns {number|null}
 */
function parseSampleLimit(raw) {
  if (raw === undefined || raw === '') {
    return DEFAULT_SAMPLE_LIMIT;
  }
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : null;
}

/**
 * The report body: the field census over the whole collection, the match
 * listing and — in report mode only — the legacy-lookalike context query and
 * the dry-run closing line. A --delete run has already been through a
 * reviewed dry run and needs nothing from the lookalikes.
 */
async function runReport(db, gated, total, husks, allDocs) {
  let lookalikeCount = 0;
  let lookalikes = [];
  if (gated.mode === 'report') {
    const lookalikeCursor = await db.query(LEGACY_LOOKALIKE_AQL, {
      '@collection': gated.collection,
      // The server-side SLICE honours the same cap the client-side listing
      // applies, so raising HUSK_SAMPLE_LIMIT really does surface more
      // lookalikes instead of silently eliding them (issue #1507).
      sampleLimit: gated.sampleLimit
    });
    const lookalikeResult = (await lookalikeCursor.next()) || {};
    lookalikeCount = lookalikeResult.count || 0;
    lookalikes = lookalikeResult.sample || [];
  }

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

  console.log('--- Husk user-document report (READ ONLY unless --delete) ---');
  console.log(`Arango URL:    ${gated.arangoUrl}`);
  console.log(`Database:      ${db.name}`);
  console.log(`Collection:    ${gated.collection}`);
  console.log(`Total docs:    ${total}`);
  console.log(`Husk matches:  ${husks.length}`);
  // The knob is global, so the value the elision line names must cover
  // EVERY listing of this run — the husk listing and the lookalike listing
  // are capped by the same limit, and naming only one of the two totals
  // would leave the other still elided.
  const suggestedLimit = Math.max(husks.length, lookalikeCount);
  printSampledList({
    write: console.log,
    docs: husks,
    total: husks.length,
    limit: gated.sampleLimit,
    suggestedLimit,
    format: (doc) =>
      `  husk _key=${quotedKey(doc)} createdAt=${doc.createdAt || '?'} updatedAt=${doc.updatedAt || '?'} ` +
      `attributes=${JSON.stringify(Object.keys(doc).sort())}`
  });
  if (unexpectedFields.length > 0) {
    console.log('Fields present outside the husk signature (not husks, never deleted):');
    for (const [key, count] of unexpectedFields) {
      console.log(`  field ${key}: ${count} document(s)`);
    }
  }
  if (gated.mode === 'delete') {
    console.log('Legacy lookalikes: not measured in --delete mode.');
  } else {
    console.log(`Legacy lookalikes (identity-less but WITH email — NOT husks, never deleted): ${lookalikeCount}`);
    printSampledList({
      write: console.log,
      docs: lookalikes,
      // The sample is truncated SERVER-side; the count is the full number.
      total: lookalikeCount,
      limit: gated.sampleLimit,
      suggestedLimit,
      format: (doc) => `  lookalike _key=${quotedKey(doc)} createdAt=${doc.createdAt || '?'}`
    });
    console.log('Dry run — nothing was deleted. Re-run with --delete to remove the matches.');
  }
}

/**
 * The destructive tail — reached only with --delete --yes, after the
 * predicate cross-check in main() has passed for every match. One bulk
 * statement that RE-ASSERTS the husk signature, so a document concurrently
 * disqualified between the SELECT and the REMOVE (e.g. a GDPR soft-delete
 * writing deleted:true) is left alone; a mid-way failure cannot leave an
 * ambiguous partial state.
 */
// `collectionName` is the NAME (a string for the AQL bind) — main() passes
// gated.collection, never the arangojs handle it also holds under `collection`.
async function runDelete(db, collectionName, husks) {
  console.log(`--delete given: removing ${husks.length} husk documents...`);
  // A rejection from the removal query splits into two honesty classes:
  // a numeric err.code below 500 is an HTTP status the SERVER returned —
  // the statement was definitively rejected and nothing executed, so the
  // outcome is known. Everything else (network failure, timeout, 5xx,
  // a non-Error rejection value) is genuinely ambiguous: the request may
  // have executed server-side with only the response lost, so the lead
  // states the one thing true in all of those cases — the outcome is
  // unknown — and defers the removal possibility to a conditional clause
  // (issue #1505).
  const bind = {
    '@collection': collectionName,
    keys: husks.map((doc) => doc._key)
  };
  let removalCursor;
  try {
    removalCursor = await db.query(HUSK_REMOVAL_AQL, bind);
  } catch (err) {
    if (typeof err?.code === 'number' && err.code < 500) {
      // A 4xx status from ArangoDB means the statement was definitively
      // rejected and nothing executed. The dry-run directive stays because
      // the equivalence assumes ARANGO_URL answers directly — an
      // intermediary that answers in ArangoDB's place voids it.
      console.error(
        `NOTHING was removed — the server rejected the removal statement (HTTP ${err.code}: ${causeOf(err)}). ` +
          'Verify with a dry run: re-run the report to see what remains.'
      );
    } else {
      console.error(
        'REMOVAL OUTCOME UNKNOWN — the removal query failed before its outcome was known ' +
          `(${causeOf(err)}); if the request reached the server, an unknown number of ` +
          'documents may have been removed. Verify with a dry run: re-run the report to see what remains.'
      );
    }
    if (err && err.stack) {
      console.error(err.stack);
    }
    process.exitCode = 1;
    return;
  }
  // The removal re-asserts the signature, so docs disqualified since the
  // SELECT are skipped server-side — report what actually executed, not the
  // selection size. If the stats are missing, say so and fail rather than
  // claim success: on a destructive path the honest answer is "unknown",
  // and the removal has already executed at this point, so the lead must
  // say an unknown number of documents may be gone (issue #1505).
  const writesExecuted = ((removalCursor.extra || {}).stats || {}).writesExecuted;
  if (typeof writesExecuted !== 'number') {
    console.error(
      'REMOVED an unknown number of documents — the removal query executed but its result ' +
        'carried no writesExecuted stats, so the actual number removed is not observable. ' +
        'Verify with a dry run: re-run the report to see what remains.'
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

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * CLI entry point. Injectable for tests (issue #1494): argv, env and the
 * Database factory can all be passed in, so the gate wiring and the
 * divergence-before-remove ordering run against a fake db.
 * @param {{argv?: string[], env?: Object, createDatabase?: Function}} deps
 */
async function main({
  argv = process.argv,
  env = process.env,
  createDatabase = (config) => new Database(config)
} = {}) {
  const gated = parseAndGateArgs(argv, env);
  if (!gated) {
    return;
  }

  const db = createDatabase({
    url: gated.arangoUrl,
    databaseName: gated.database,
    auth: {
      username: gated.username,
      password: gated.password
    }
  });
  if (!(await db.exists())) {
    console.error(`Database '${db.name}' does not exist on ${gated.arangoUrl} — check ARANGO_DB and ARANGO_URL.`);
    process.exitCode = 1;
    return;
  }
  const collection = db.collection(gated.collection);
  let total;
  try {
    total = (await collection.count()).count || 0;
  } catch {
    console.error(
      `Collection '${gated.collection}' not found in database '${db.name}' on ${gated.arangoUrl} — check ARANGO_COLLECTION.`
    );
    process.exitCode = 1;
    return;
  }

  const huskCursor = await db.query(HUSK_MATCHER_AQL, { '@collection': gated.collection });
  const husks = await huskCursor.all();

  // Defense against AQL/predicate divergence — abort before any destructive
  // step if the two disagree about what a husk is, in EITHER direction: an
  // AQL hit the predicate rejects (AQL too permissive) or a document the
  // predicate accepts that the AQL never returned (AQL too restrictive — the
  // silent direction, which would otherwise report "0 husks" on a database
  // full of them). Only _key and attribute NAMES are printed: the mismatch
  // documents are by definition not husks and can carry real PII, which must
  // not reach the log store via stderr.
  const allDocsCursor = await db.query(ALL_DOCS_AQL, { '@collection': gated.collection });
  const allDocs = await allDocsCursor.all();
  const { extra, missed } = compareSignatureSets(husks, allDocs);
  if (extra.length > 0 || missed.length > 0) {
    console.error(
      `ABORT: the AQL matcher and the signature disagree — ${extra.length} AQL hit(s) rejected by the predicate, ` +
        `${missed.length} document(s) accepted by the predicate but not matched by the AQL. Nothing was deleted. ` +
        'The two reads are not atomic: a document provisioned between them also lands here — re-run the ' +
        'report; if it aborts again with the same counts, the AQL and the signature really disagree.'
    );
    // Bounded like the other per-document listings in this script: the abort
    // fires on ANY divergence, and when it fires the divergence can be as
    // large as the whole collection — an uncapped per-document listing would
    // flood the log pipeline. The full counts stay in the ABORT header; the
    // elision line says how many were not listed AND how to see them (the
    // operator raises HUSK_SAMPLE_LIMIT for one diagnostic run — issue
    // #1507). (The fields census in runReport stays unbounded by design: one
    // line per DISTINCT unexpected field name, not per document.)
    // The knob is global and BOTH directions are capped by it, so the value
    // the elision line names must cover the larger of the two — naming one
    // direction's total would leave the other still elided.
    const suggestedLimit = Math.max(extra.length, missed.length);
    for (const [label, docs] of [
      ['over-matched', extra],
      ['under-matched', missed]
    ]) {
      printSampledList({
        write: console.error,
        label,
        docs,
        total: docs.length,
        limit: gated.sampleLimit,
        suggestedLimit,
        format: (doc) => `  ${label} _key=${quotedKey(doc)} attributes=${JSON.stringify(Object.keys(doc).sort())}`
      });
    }
    process.exitCode = 1;
    return;
  }

  // The report prints on EVERY mode — including --delete, whose stdout is the
  // audit record of what the destructive run selected (old behavior).
  await runReport(db, gated, total, husks, allDocs);
  if (gated.mode !== 'delete') {
    return;
  }
  await runDelete(db, gated.collection, husks);
}

if (require.main === module) {
  // Loaded only for CLI execution — requiring this module (e.g. from the
  // tests) must not pull the operator's .env into the test process.
  require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });
  main().catch((err) => {
    // Message + stack, not the whole arangojs response object (it dumps the
    // entire HTTP exchange, which buries the actual cause).
    console.error('Report failed:', causeOf(err));
    if (err.stack) {
      console.error(err.stack);
    }
    process.exitCode = 1;
  });
}

module.exports = {
  isHuskDoc,
  compareSignatureSets,
  parseAndGateArgs,
  main,
  HUSK_IDENTITY_FIELDS,
  HUSK_SYSTEM_FIELDS,
  HUSK_ALLOWED_FIELDS,
  HUSK_MATCHER_AQL,
  HUSK_REMOVAL_AQL,
  ALL_DOCS_AQL
};
