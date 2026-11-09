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
 * The corpus pins the SEMANTICS of the signature; the vocabulary itself
 * (the exact field lists) is pinned in __tests__/husk-user-docs.test.js —
 * a corpus can only pin the fields it happens to contain, so a drift that
 * adds a field nobody seeded (a user preference, a profile section) is
 * caught there, not here.
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
  HUSK_MATCHER_AQL,
  HUSK_REMOVAL_AQL,
  ALL_DOCS_AQL
} = require('../../scripts/report-husk-user-docs');
// The app's own field vocabulary: the corpus carries a document per class
// so the claim "an app field disqualifies the document" is checked against
// the fields the app ACTUALLY writes, not against hand-copied names.
const { USER_PREFERENCE_FIELDS, GOV_PROFILE_SECTIONS } = require('../../constants/jit-fields');
const {
  WAIT_BUDGET_MS,
  HOOK_TIMEOUT_MS,
  authHeader,
  waitForServer,
  recreateDatabase,
  dropDatabase,
  databaseConfig
} = require('./helpers/arango');

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
  { _key: 'underscore-field', createdAt: '2025-01-01T00:00:00.000Z', _internalFlag: true },
  // A legacy account carrying a CLIENT PREFERENCE field (the app's own
  // vocabulary: USER_PREFERENCE_FIELDS). Such a document is a real
  // account, not a husk — the deletion wave must never take a user's
  // display preferences with it.
  { _key: 'legacy-with-preference', [USER_PREFERENCE_FIELDS[0]]: 'dark', createdAt: '2025-01-01T00:00:00.000Z' },
  // A document carrying a GOV-PROFILE SECTION (the other app vocabulary:
  // GOV_PROFILE_SECTIONS) — profile data, so never a husk either.
  {
    _key: 'legacy-with-profile-section',
    [GOV_PROFILE_SECTIONS[0]]: { id: 'CR-1' },
    createdAt: '2025-01-01T00:00:00.000Z'
  }
];

// The oracle: the exact set of documents the matcher must return. Fixed
// here, so a change to the signature (on either side) is a test failure.
const EXPECTED_HUSK_KEYS = ['husk-created-only', 'husk-deleted-false', 'husk-deleted-null', 'husk-plain'];

// The HTTP calls (creating and dropping the database) carry the same
// credentials the driver does.
const AUTH = authHeader(TEST_USER, TEST_PASSWORD);

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
    await waitForServer(TEST_URL, AUTH, WAIT_BUDGET_MS);
    const { Database } = require('arangojs');
    // The database is created over the HTTP API (arangojs 8's Database
    // binds to an existing one) and dropped in afterAll: a database left
    // behind by an interrupted run is dropped first, both halves checked
    // (the shared helper).
    await recreateDatabase(TEST_URL, DB_NAME, AUTH);
    db = new Database(databaseConfig(TEST_URL, DB_NAME, TEST_USER, TEST_PASSWORD));
    await db.collection(COLLECTION).create();
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    // The database is dropped over the HTTP API (arangojs 8's Database
    // binds to an existing one).
    try {
      await dropDatabase(TEST_URL, DB_NAME, AUTH);
    } finally {
      // The driver's connection is closed: an open one keeps the test
      // process alive after the run — closed even when the drop fails.
      if (db) {
        db.close();
      }
    }
  }, HOOK_TIMEOUT_MS);

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

  it('agrees with the JS predicate on the same corpus', async () => {
    const all = await queryAll(ALL_DOCS_AQL, { '@collection': COLLECTION });
    // The predicate is pinned against the corpus too, so a change to the
    // JS side alone cannot hide behind an agreeing AQL. (With both sets
    // pinned to the oracle, no divergence is possible — the script's own
    // cross-check is exercised on every runScript call below and asserted
    // through the absence of its ABORT output.)
    expect(
      all
        .filter(isHuskDoc)
        .map((doc) => doc._key)
        .sort()
    ).toEqual(EXPECTED_HUSK_KEYS);
  });

  // Runs the operator script itself against the real database and returns
  // what it printed. The database handle is created through the script's
  // own injection seam and closed here: the script never closes it (it is
  // a one-shot CLI), so without this the suite would leave a keep-alive
  // socket open for the rest of the job.
  const runScript = async (argv) => {
    const { Database } = require('arangojs');
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const previousExitCode = process.exitCode;
    process.exitCode = undefined;
    let handle;
    try {
      await main({
        argv,
        env: {
          ARANGO_URL: TEST_URL,
          ARANGO_DB: DB_NAME,
          ARANGO_COLLECTION: COLLECTION,
          ARANGO_USER: TEST_USER,
          ARANGO_PASSWORD: TEST_PASSWORD
        },
        createDatabase: (config) => {
          handle = new Database(config);
          return handle;
        }
      });
      // Read the calls BEFORE the restore: mockRestore() clears them.
      return {
        output: logSpy.mock.calls.map((call) => call.join(' ')).join('\n'),
        stderr: errorSpy.mock.calls.map((call) => call.join(' ')).join('\n'),
        exitCode: process.exitCode
      };
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
      process.exitCode = previousExitCode;
      if (handle) {
        handle.close();
      }
    }
  };

  it('reports the exact match count and deletes nothing in dry-run mode', async () => {
    const { output, stderr, exitCode } = await runScript([]);
    // The divergence cross-check did not fire: the script aborted with an
    // exit code and a stderr line instead of printing a report.
    expect(exitCode).toBeUndefined();
    expect(stderr).not.toContain('ABORT');
    // The reported counts are the subject, not the wording around them:
    // the label and the number, not the sentence.
    expect(output).toMatch(/Husk matches:\s+4/);
    // The legacy lookalikes (identity-less but WITH an email) are reported
    // for context and never deleted: exactly the one legacy account of the
    // corpus.
    expect(output).toMatch(/Legacy lookalikes[^\n]*:\s+1/);
    // Nothing was removed.
    expect(await remainingKeys()).toEqual(CORPUS.map((doc) => doc._key).sort());
  });

  it('removes the husks and nothing else', async () => {
    const { output, stderr, exitCode } = await runScript(['--delete', '--yes']);
    // The divergence cross-check did not fire, and the removal reported its
    // own outcome: an unknown number of removed documents is an exit code 1.
    expect(exitCode).toBeUndefined();
    expect(stderr).not.toContain('ABORT');
    expect(output).toMatch(/Done\.\s+4 of 4\b/);
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
