'use strict';

/**
 * The husk report script (scripts/report-husk-user-docs.js) decides which
 * user documents the deletion wave removes. The unit suite pins the AQL
 * TEMPLATE (substring checks) and the JS predicate, but no CI job ever
 * EXECUTED that AQL: a template edit that keeps its substrings (a different
 * function, a different operator) and a constant edit that BOTH sides share
 * (the system-field allowlist) both pass the unit suite green while the
 * query selects the wrong documents — the silent direction reports "0 husks"
 * on a database full of them.
 *
 * This file is the missing layer: the real AQL, executed against a real
 * ArangoDB, over a corpus whose expected match set is FIXED HERE. A change
 * to the signature — on either side — moves the match set away from the
 * expectation below and fails.
 *
 * SKIPPED unless ARANGO_TEST_URL points at a database:
 *
 *   ARANGO_TEST_URL=http://127.0.0.1:8529 ARANGO_TEST_USER=root \
 *   ARANGO_TEST_PASSWORD=… npx jest __tests__/integration
 *
 * The password is required: the script's own operator gate refuses to run
 * without one, and this suite drives that gate.
 *
 * The suite has no database of its own (the CI job starts one), and this
 * test creates its OWN database and drops it afterwards — it never touches
 * the one the application uses.
 */

const {
  main,
  isHuskDoc,
  compareSignatureSets,
  HUSK_MATCHER_AQL,
  HUSK_REMOVAL_AQL,
  ALL_DOCS_AQL
} = require('../../scripts/report-husk-user-docs');

const TEST_URL = process.env.ARANGO_TEST_URL;
const TEST_USER = process.env.ARANGO_TEST_USER || 'root';
const TEST_PASSWORD = process.env.ARANGO_TEST_PASSWORD || '';
const DB_NAME = 'genie_husk_report_test';
const COLLECTION = 'users';

// The corpus: one document per branch of the signature. The husk signature
// (scripts/report-husk-user-docs.js) accepts a document that carries NO
// identity field (iss_sub/sub/email), is not soft-deleted, and carries no
// application field beyond the timestamps and the explicit deleted marker.
const CORPUS = [
  // --- husks: matched ---
  { _key: 'husk-plain', createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-02T00:00:00.000Z' },
  { _key: 'husk-deleted-false', createdAt: '2025-01-01T00:00:00.000Z', deleted: false },
  // A deleted marker set to null is the allowed field with a null value —
  // still a husk (the signature accepts missing, null or false).
  { _key: 'husk-deleted-null', createdAt: '2025-01-01T00:00:00.000Z', deleted: null },
  // Only the createdAt timestamp: no updatedAt is still a husk.
  { _key: 'husk-created-only', createdAt: '2025-01-01T00:00:00.000Z' },

  // --- not husks: an identity field, or a disqualifying value ---
  { _key: 'legacy-email', email: 'legacy@example.com', createdAt: '2025-01-01T00:00:00.000Z' },
  { _key: 'healthy-iss-sub', iss_sub: 'sub-1', createdAt: '2025-01-01T00:00:00.000Z' },
  { _key: 'healthy-sub', sub: 'sub-2', createdAt: '2025-01-01T00:00:00.000Z' },
  // A present-but-null identity field is still a PRESENT field: it is not
  // in the allowed set, so it disqualifies the document (both sides).
  { _key: 'email-null', email: null, createdAt: '2025-01-01T00:00:00.000Z' },
  // Soft-deleted: explicitly deleted, never a husk.
  { _key: 'soft-deleted', createdAt: '2025-01-01T00:00:00.000Z', deleted: true },
  // The soft-delete marker accepts ONLY null/false — a string 'false' or a
  // 0 is a value the signature does not recognize.
  { _key: 'deleted-string', createdAt: '2025-01-01T00:00:00.000Z', deleted: 'false' },
  { _key: 'deleted-zero', createdAt: '2025-01-01T00:00:00.000Z', deleted: 0 },

  // --- not husks: an application field outside the allowed set ---
  { _key: 'extra-field', createdAt: '2025-01-01T00:00:00.000Z', customSettings: { theme: 'dark' } },
  // An underscore-prefixed APPLICATION field is not an ArangoDB system
  // field: it must disqualify the document exactly like any other.
  { _key: 'underscore-field', createdAt: '2025-01-01T00:00:00.000Z', _internalFlag: true }
];

// The oracle: the exact set of documents the matcher must return. Fixed
// here, so a change to the signature (on either side) is a test failure.
const EXPECTED_HUSK_KEYS = ['husk-created-only', 'husk-deleted-false', 'husk-deleted-null', 'husk-plain'];

// The HTTP calls (creating and dropping the database) carry the same
// credentials the driver does.
function authHeader() {
  if (!TEST_USER) {
    return {};
  }
  return {
    Authorization: `Basic ${Buffer.from(`${TEST_USER}:${TEST_PASSWORD}`).toString('base64')}`
  };
}

// The service container is RUNNING long before ArangoDB answers: the CI job
// must wait for the server, not for the container. Bounded, and it fails
// loudly instead of skipping.
async function waitForServer(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${TEST_URL}/_api/version`, { headers: authHeader() });
      if (response.ok) {
        return;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`ArangoDB at ${TEST_URL} did not answer within ${timeoutMs}ms: ${lastError?.message}`);
}

const describeWithDatabase = TEST_URL ? describe : describe.skip;

describeWithDatabase('the husk report (against a real ArangoDB)', () => {
  let db;

  beforeAll(async () => {
    if (!TEST_PASSWORD) {
      throw new Error(
        'ARANGO_TEST_PASSWORD is required: the husk script refuses to run without a password, ' +
          'and this suite drives that script against the database.'
      );
    }
    await waitForServer(120000);
    const { Database } = require('arangojs');
    // The database is created over the HTTP API (arangojs 8's Database
    // binds to an existing one) and dropped in afterAll. A database left
    // behind by an interrupted run is dropped first: the test must be
    // repeatable.
    await fetch(`${TEST_URL}/_api/database/${DB_NAME}`, { method: 'DELETE', headers: authHeader() });
    const created = await fetch(`${TEST_URL}/_api/database`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ name: DB_NAME })
    });
    const createdBody = await created.json();
    if (createdBody.error && !String(createdBody.errorMessage).includes('duplicate')) {
      throw new Error(`creating ${DB_NAME}: ${JSON.stringify(createdBody)}`);
    }
    db = new Database({
      url: TEST_URL,
      databaseName: DB_NAME,
      auth: { username: TEST_USER, password: TEST_PASSWORD }
    });
    await db.collection(COLLECTION).create();
  });

  afterAll(async () => {
    // The database is dropped over the HTTP API (arangojs 8's Database
    // binds to an existing one).
    await fetch(`${TEST_URL}/_api/database/${DB_NAME}`, { method: 'DELETE', headers: authHeader() });
    // The driver's connection is closed: an open one keeps the test
    // process alive after the run.
    if (db) {
      db.close();
    }
  });

  beforeEach(async () => {
    // Every test starts from the same corpus: the removal tests mutate it.
    await db.collection(COLLECTION).truncate();
    await db.collection(COLLECTION).saveAll(CORPUS);
  });

  const queryAll = async (aql, bind) => (await db.query(aql, bind)).all();

  const remainingKeys = async () => {
    const docs = await queryAll(ALL_DOCS_AQL, { '@collection': COLLECTION });
    return docs.map((doc) => doc._key).sort();
  };

  it('matches EXACTLY the husks of the corpus — the signature cannot drift', async () => {
    const hits = await queryAll(HUSK_MATCHER_AQL, { '@collection': COLLECTION });
    expect(hits.map((doc) => doc._key).sort()).toEqual(EXPECTED_HUSK_KEYS);
  });

  it('agrees with the JS predicate in BOTH directions', async () => {
    const hits = await queryAll(HUSK_MATCHER_AQL, { '@collection': COLLECTION });
    const all = await queryAll(ALL_DOCS_AQL, { '@collection': COLLECTION });
    const { extra, missed } = compareSignatureSets(hits, all);
    // 'extra': the AQL matched a document the predicate rejects (too
    // permissive). 'missed': the predicate accepts a document the AQL
    // never returned (too restrictive — the silent direction).
    expect(extra.map((doc) => doc._key)).toEqual([]);
    expect(missed.map((doc) => doc._key)).toEqual([]);
    // The predicate is pinned against the corpus too, so a change to the
    // JS side alone cannot hide behind an agreeing AQL.
    expect(
      all
        .filter(isHuskDoc)
        .map((doc) => doc._key)
        .sort()
    ).toEqual(EXPECTED_HUSK_KEYS);
  });

  it('reports the exact match count and deletes nothing in dry-run mode', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const previousExitCode = process.exitCode;
    process.exitCode = undefined;
    let output;
    let stderr;
    let exitCode;
    try {
      await main({
        argv: [],
        env: {
          ARANGO_URL: TEST_URL,
          ARANGO_DB: DB_NAME,
          ARANGO_COLLECTION: COLLECTION,
          ARANGO_USER: TEST_USER,
          ARANGO_PASSWORD: TEST_PASSWORD
        }
      });
      // Read the calls BEFORE the restore: mockRestore() clears them.
      output = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
      stderr = errorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
      exitCode = process.exitCode;
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
      process.exitCode = previousExitCode;
    }
    // The divergence cross-check did not fire: the script aborted with an
    // exit code and a stderr line instead of printing a report.
    expect(exitCode).toBeUndefined();
    expect(stderr).not.toContain('ABORT');
    expect(output).toMatch(/Husk matches:\s+4/);
    // The legacy lookalikes (identity-less but WITH an email) are reported
    // for context and never deleted: exactly the one legacy account of the
    // corpus.
    expect(output).toMatch(/Legacy lookalikes \(identity-less but WITH email — NOT husks, never deleted\): 1/);
    expect(output).toContain('Dry run — nothing was deleted.');
    // Nothing was removed.
    expect(await remainingKeys()).toEqual(CORPUS.map((doc) => doc._key).sort());
  });

  it('removes the husks and nothing else', async () => {
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const previousExitCode = process.exitCode;
    process.exitCode = undefined;
    let output;
    let stderr;
    let exitCode;
    try {
      await main({
        argv: ['--delete', '--yes'],
        env: {
          ARANGO_URL: TEST_URL,
          ARANGO_DB: DB_NAME,
          ARANGO_COLLECTION: COLLECTION,
          ARANGO_USER: TEST_USER,
          ARANGO_PASSWORD: TEST_PASSWORD
        }
      });
      // Read the calls BEFORE the restore: mockRestore() clears them.
      output = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
      stderr = errorSpy.mock.calls.map((call) => call.join(' ')).join('\n');
      exitCode = process.exitCode;
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
      process.exitCode = previousExitCode;
    }
    // The divergence cross-check did not fire, and the removal reported its
    // own outcome: an unknown number of removed documents is an exit code 1.
    expect(exitCode).toBeUndefined();
    expect(stderr).not.toContain('ABORT');
    expect(output).toContain('Done. 4 of 4 selected documents removed.');
    expect(await remainingKeys()).toEqual(
      CORPUS.map((doc) => doc._key)
        .filter((key) => !EXPECTED_HUSK_KEYS.includes(key))
        .sort()
    );
  });

  it('re-asserts the signature server-side: a document disqualified after the SELECT survives', async () => {
    // The removal query re-filters the selected keys through the FULL
    // signature, so a document that stopped qualifying between the SELECT
    // and the REMOVE (a GDPR soft-delete landing in between) is skipped,
    // not destroyed. Only a real server can prove that the re-assertion
    // happens in the query and not only in the caller.
    const cursor = await db.query(HUSK_REMOVAL_AQL, {
      '@collection': COLLECTION,
      keys: ['husk-plain', 'soft-deleted', 'healthy-iss-sub']
    });
    await cursor.all();
    expect(cursor.extra.stats.writesExecuted).toBe(1);
    expect(await remainingKeys()).toEqual(
      CORPUS.map((doc) => doc._key)
        .filter((key) => key !== 'husk-plain')
        .sort()
    );
  });
});
