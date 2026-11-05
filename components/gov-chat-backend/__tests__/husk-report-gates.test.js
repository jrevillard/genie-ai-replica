/**
 * Tests for the operator-facing safety wiring of scripts/report-husk-user-docs.js
 * (issue #1494): the CLI/env gates, the ordering "divergence abort happens
 * BEFORE any remove", and the removal-outcome output honesty (issue #1505:
 * bounded abort listing, honest leads when the removal's outcome is unknown
 * or definitively nothing). The signature itself (predicate + AQL templates)
 * is pinned in husk-user-docs.test.js; here the unit under test is main() —
 * made testable by the parseAndGateArgs extraction and the injectable
 * database factory (createApp()-style).
 */

const {
  parseAndGateArgs,
  main,
  HUSK_MATCHER_AQL,
  HUSK_REMOVAL_AQL,
  LEGACY_LOOKALIKE_AQL,
  ALL_DOCS_AQL,
  printSampledList
} = require('../scripts/report-husk-user-docs');

const huskDoc = {
  _key: '12345',
  _id: 'users/12345',
  _rev: '_abc',
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-02T00:00:00.000Z'
};

const gateEnv = { ARANGO_PASSWORD: 'pw', ARANGO_DB: 'genie-ai' };

// A database double that answers every query the script makes and records
// which AQL statements ran. `husks`/`allDocs` drive the divergence cross-check;
// `writesExecuted` is what the removal's stats report carries back;
// `lookalikes` is what the legacy-lookalike query returns (the count is the
// number of ALL lookalikes, the sample the server-side-truncated subset).
function fakeDb({
  husks = [],
  allDocs = [],
  writesExecuted = 0,
  removalError = null,
  lookalikeCount = 0,
  lookalikes = []
} = {}) {
  const executed = [];
  const query = jest.fn(async (aql, bind) => {
    executed.push({ aql, bind });
    if (aql === HUSK_MATCHER_AQL) {
      return { all: async () => husks };
    }
    if (aql === ALL_DOCS_AQL) {
      return { all: async () => allDocs };
    }
    if (aql === HUSK_REMOVAL_AQL) {
      if (removalError) {
        throw removalError; // the removal query rejects (e.g. lost response)
      }
      return writesExecuted === null
        ? {} // a removal result with no stats — the honest-answer-unknown case
        : { extra: { stats: { writesExecuted } } };
    }
    return { next: async () => ({ count: lookalikeCount, sample: lookalikes }) };
  });
  return {
    query,
    exists: async () => true,
    name: 'test-db',
    // Husks ⊆ allDocs by construction — the count() model must not double-count them.
    collection: () => ({ count: async () => ({ count: allDocs.length }) }),
    removalCalls: () => executed.filter((c) => c.aql === HUSK_REMOVAL_AQL),
    lookalikeCalls: () => executed.filter((c) => c.aql === LEGACY_LOOKALIKE_AQL)
  };
}

async function runMain(db, argv = [], env = gateEnv) {
  return main({ argv, env, createDatabase: () => db });
}

// Collected stderr as one string — the abort/missing-stats tests assert on
// rendered lines, not on individual console.error calls.
const stderrText = (errorSpy) => errorSpy.mock.calls.map((c) => c.join(' ')).join('\n');

// n over-matched and n under-matched documents, driving both directions of
// the divergence cross-check (issue #1505). _id derives from _key — the
// fixtures must look like real documents, not huskDoc with a swapped key.
const divergentDocs = (extraN, missedN = extraN) => ({
  extra: Array.from({ length: extraN }, (_, i) => ({
    ...huskDoc,
    _key: `extra-${i}`,
    _id: `users/extra-${i}`,
    customSettings: { theme: 'dark' }
  })),
  missed: Array.from({ length: missedN }, (_, i) => ({
    ...huskDoc,
    _key: `missed-${i}`,
    _id: `users/missed-${i}`
  }))
});

describe('parseAndGateArgs', () => {
  let exitCode;
  let errorSpy;

  beforeEach(() => {
    exitCode = process.exitCode;
    process.exitCode = undefined;
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.exitCode = exitCode;
    errorSpy.mockRestore();
  });

  it('returns the fully resolved run config with the documented defaults', () => {
    expect(parseAndGateArgs([], gateEnv)).toEqual({
      mode: 'report',
      database: 'genie-ai',
      collection: 'users',
      arangoUrl: 'http://localhost:8529',
      username: 'root',
      password: 'pw',
      sampleLimit: 50
    });
  });

  it('enters delete mode only with --delete --yes together', () => {
    expect(parseAndGateArgs(['--delete', '--yes'], gateEnv).mode).toBe('delete');
  });

  it('rejects --delete without --yes (the operator confirmation gate)', () => {
    expect(parseAndGateArgs(['--delete'], gateEnv)).toBeNull();
    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('--delete requires --yes'));
  });

  it('rejects a run without ARANGO_PASSWORD', () => {
    expect(parseAndGateArgs([], { ARANGO_DB: 'genie-ai' })).toBeNull();
    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('ARANGO_PASSWORD'));
  });

  it('rejects a run without ARANGO_DB (no default: a wrong db reads as clean)', () => {
    expect(parseAndGateArgs([], { ARANGO_PASSWORD: 'pw' })).toBeNull();
    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('ARANGO_DB'));
  });

  it('accepts a positive integer HUSK_SAMPLE_LIMIT and rejects anything else', () => {
    // The diagnostic override for the listing cap (issue #1507): the operator
    // raises it for one run to see the entries the default cap withholds.
    expect(parseAndGateArgs([], { ...gateEnv, HUSK_SAMPLE_LIMIT: '500' }).sampleLimit).toBe(500);
    // An EMPTY value is "not set" — the default, not a gate failure (an
    // operator who exports HUSK_SAMPLE_LIMIT= in their shell means "unset").
    expect(parseAndGateArgs([], { ...gateEnv, HUSK_SAMPLE_LIMIT: '' }).sampleLimit).toBe(50);
    expect(parseAndGateArgs([], { ...gateEnv, HUSK_SAMPLE_LIMIT: undefined }).sampleLimit).toBe(50);
    // A malformed value is a GATE failure, never a silent fallback to 50: an
    // operator who asked for 500 entries and silently gets 50 is back to the
    // very confusion the override exists to remove.
    for (const bad of ['abc', '0', '-3', '1.5', ' ', '0x1f', '1e3', ' 500 ', '99999999999999999999']) {
      expect(parseAndGateArgs([], { ...gateEnv, HUSK_SAMPLE_LIMIT: bad })).toBeNull();
      expect(process.exitCode).toBe(1);
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('HUSK_SAMPLE_LIMIT'));
    }
  });
});

describe('printSampledList', () => {
  // The helper is the single place the cap is applied, so the cap's OWN
  // invariant lives here: a listing is NEVER unbounded. Before the default
  // was added, an omitted limit made slice(0, undefined) return the WHOLE
  // array — a listing with no cap at all.
  const docs = Array.from({ length: 60 }, (_, i) => ({ _key: `k-${i}` }));

  it('caps the listing at the default when the caller omits the limit', () => {
    const written = [];
    printSampledList({ write: (l) => written.push(l), docs, format: (d) => `  entry ${d._key}` });
    expect(written.filter((l) => l.startsWith('  entry '))).toHaveLength(50);
    expect(written.some((l) => l.includes('(not listed)'))).toBe(true);
  });

  it('honours an explicit cap', () => {
    const written = [];
    printSampledList({ write: (l) => written.push(l), docs, limit: 10, format: (d) => `  entry ${d._key}` });
    expect(written.filter((l) => l.startsWith('  entry '))).toHaveLength(10);
  });

  it('does not list an elision line when nothing was withheld', () => {
    const written = [];
    printSampledList({ write: (l) => written.push(l), docs: docs.slice(0, 5), format: (d) => `  entry ${d._key}` });
    expect(written.filter((l) => l.includes('(not listed)'))).toHaveLength(0);
  });
});

describe('main safety wiring', () => {
  let exitCode;
  let logSpy;
  let errorSpy;

  beforeEach(() => {
    exitCode = process.exitCode;
    process.exitCode = undefined;
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.exitCode = exitCode;
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('aborts BEFORE any remove when the AQL and the predicate disagree (ordering pin)', async () => {
    // AQL matched a document the predicate rejects — the cross-check must
    // abort with exit code 1 and the removal query must never have run. If
    // the divergence check moved after the REMOVE, removalCalls() would be
    // non-empty and this test would fail.
    const stray = { ...huskDoc, _key: 'stray', customSettings: { theme: 'dark' } };
    const db = fakeDb({ husks: [stray], allDocs: [stray] });
    await runMain(db, ['--delete', '--yes']);
    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('ABORT'));
    expect(db.removalCalls()).toEqual([]);
  });

  it('aborts BEFORE any remove on the missed direction too (predicate accepts what AQL never returned)', async () => {
    // The silent direction: the AQL matcher returns nothing while the
    // collection holds husks. The cross-check must still abort before any
    // remove — a weakened cross-check that only compares the extra direction
    // would let --delete --yes report success on a database full of husks.
    const db = fakeDb({ husks: [], allDocs: [huskDoc] });
    await runMain(db, ['--delete', '--yes']);
    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('ABORT'));
    expect(db.removalCalls()).toEqual([]);
  });

  it('removes the matched keys only after the cross-check passes', async () => {
    const db = fakeDb({ husks: [huskDoc], allDocs: [huskDoc], writesExecuted: 1 });
    await runMain(db, ['--delete', '--yes']);
    expect(process.exitCode).toBeUndefined();
    const calls = db.removalCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].bind).toEqual({ '@collection': 'users', keys: ['12345'] });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Done. 1 of 1'));
  });

  it('dry run never reaches the removal query', async () => {
    const db = fakeDb({ husks: [huskDoc], allDocs: [huskDoc] });
    await runMain(db, []);
    expect(process.exitCode).toBeUndefined();
    expect(db.removalCalls()).toEqual([]);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Dry run'));
  });

  it('fails when the removal result carries no writesExecuted stats — and says the removal RAN, not ABORT (issue #1505)', async () => {
    // The removal query has already executed by the time the stats are read:
    // leading with ABORT would imply nothing happened while an unknown number
    // of documents may be gone. The wording must state the honest outcome.
    const db = fakeDb({ husks: [huskDoc], allDocs: [huskDoc], writesExecuted: null });
    await runMain(db, ['--delete', '--yes']);
    expect(process.exitCode).toBe(1);
    const message = stderrText(errorSpy);
    // The LEAD is pinned, not just the word 'removed': a message that merely
    // mentions 'the number removed' could still imply nothing happened.
    expect(message).toMatch(/^REMOVED an unknown number/);
    expect(message).toContain('unknown');
    // The technical cause stays named: it is what distinguishes an arangojs
    // drift from a server bug.
    expect(message).toContain('writesExecuted');
    expect(message).not.toContain('ABORT');
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('Done.'));
  });

  it('caps the abort listing at SAMPLE_LIMIT entries per direction and says how many were elided (issue #1505)', async () => {
    // 60 over-matched and 60 under-matched documents: the abort fires exactly
    // when divergence can cover the whole collection — an uncapped listing
    // would emit one stderr line per document through the log pipeline.
    // Mirrors the script's other listings: SAMPLE_LIMIT entries, then one
    // "... and N more (not listed)" line per direction.
    const { extra, missed } = divergentDocs(60);
    const db = fakeDb({ husks: extra, allDocs: [...extra, ...missed] });
    await runMain(db, ['--delete', '--yes']);
    expect(process.exitCode).toBe(1);
    const stderr = stderrText(errorSpy);
    const overMatched = stderr.split('\n').filter((l) => l.includes('over-matched _key='));
    const underMatched = stderr.split('\n').filter((l) => l.includes('under-matched _key='));
    expect(overMatched).toHaveLength(50);
    expect(underMatched).toHaveLength(50);
    // The ABORT header carries the FULL counts — the only record of the
    // totals once the listing is capped.
    expect(stderr).toContain('60 AQL hit(s) rejected by the predicate');
    expect(stderr).toContain('60 document(s) accepted by the predicate');
    expect(stderr).toContain('... and 10 more over-matched (not listed)');
    expect(stderr).toContain('... and 10 more under-matched (not listed)');
  });

  it('says the removal outcome is UNKNOWN when the removal query itself rejects (lost response ≠ nothing happened)', async () => {
    // A rejection is ambiguous in both directions: the request may have
    // executed server-side with only the response lost, or never reached
    // the server. The lead must be honest in BOTH cases (issue #1505).
    const db = fakeDb({
      husks: [huskDoc],
      allDocs: [huskDoc],
      removalError: Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })
    });
    await runMain(db, ['--delete', '--yes']);
    expect(process.exitCode).toBe(1);
    const message = stderrText(errorSpy);
    expect(message).toMatch(/^REMOVAL OUTCOME UNKNOWN/);
    expect(message).toContain('may have been removed');
    expect(message).toContain('socket hang up');
    expect(message).toContain('dry run');
    expect(message).not.toContain('ABORT');
    expect(db.removalCalls()).toHaveLength(1);
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('Done.'));
  });

  it('says NOTHING was removed when the server definitively rejects the removal statement (4xx)', async () => {
    // A numeric err.code below 500 is an HTTP status the server returned:
    // the statement was rejected and nothing executed — the outcome is
    // KNOWN, and claiming "may have been removed" would overstate (the
    // same honesty class the ambiguous-branch lead handles correctly).
    const db = fakeDb({
      husks: [huskDoc],
      allDocs: [huskDoc],
      removalError: Object.assign(new Error('not authorized'), { code: 403 })
    });
    await runMain(db, ['--delete', '--yes']);
    expect(process.exitCode).toBe(1);
    const message = stderrText(errorSpy);
    expect(message).toMatch(/^NOTHING was removed/);
    expect(message).toContain('HTTP 403');
    expect(message).toContain('not authorized');
    expect(message).not.toContain('may have been removed');
    expect(message).toContain('dry run');
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('Done.'));
  });

  it('survives a circular non-Error rejection without crashing the error path', async () => {
    // causeOf renders unknown rejection shapes via JSON.stringify, guarded
    // so a circular structure cannot throw from INSIDE the catch — that
    // would replace the honest removal lead with the generic 'Report
    // failed' line, which says nothing about the destructive outcome.
    const circular = {};
    circular.self = circular;
    const db = fakeDb({ husks: [huskDoc], allDocs: [huskDoc], removalError: circular });
    await runMain(db, ['--delete', '--yes']);
    expect(process.exitCode).toBe(1);
    expect(stderrText(errorSpy)).toMatch(/^REMOVAL OUTCOME UNKNOWN/);
  });

  it('renders a usable cause when the removal query rejects with a non-Error value', async () => {
    // `${err.message}` on a non-Error rejection prints 'undefined' — the
    // cause line must fall back to the value itself.
    const db = fakeDb({ husks: [huskDoc], allDocs: [huskDoc], removalError: 'boom' });
    await runMain(db, ['--delete', '--yes']);
    expect(process.exitCode).toBe(1);
    expect(stderrText(errorSpy)).toContain('(boom)');
  });

  it('lists every entry with NO elision line when divergence length equals SAMPLE_LIMIT exactly (boundary pin)', async () => {
    // Guards the '>' in the elision check: a '>=' drift would print a bogus
    // '... and 0 more (not listed)' on an exactly-full sample.
    const { extra, missed } = divergentDocs(50);
    const db = fakeDb({ husks: extra, allDocs: [...extra, ...missed] });
    await runMain(db, ['--delete', '--yes']);
    expect(process.exitCode).toBe(1);
    const stderr = stderrText(errorSpy);
    expect(stderr.split('\n').filter((l) => l.includes('over-matched _key='))).toHaveLength(50);
    expect(stderr.split('\n').filter((l) => l.includes('under-matched _key='))).toHaveLength(50);
    expect(stderr).not.toContain('more over-matched');
    expect(stderr).not.toContain('more under-matched');
  });

  it('fails when the database does not exist (a wrong db reads as clean)', async () => {
    const db = fakeDb({});
    db.exists = async () => false;
    await runMain(db);
    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('does not exist'));
  });

  it('lists the ELIDED divergence entries when the operator raises HUSK_SAMPLE_LIMIT (issue #1507)', async () => {
    // The abort remedy is "re-run the report" — which, with the default cap,
    // reproduces the IDENTICAL 50 keys and leaves the other 10 unreachable.
    // Raising the cap for one diagnostic run must actually surface them.
    const { extra, missed } = divergentDocs(60);
    const db = fakeDb({ husks: extra, allDocs: [...extra, ...missed] });
    await runMain(db, ['--delete', '--yes'], { ...gateEnv, HUSK_SAMPLE_LIMIT: '200' });
    expect(process.exitCode).toBe(1);
    const stderr = stderrText(errorSpy);
    expect(stderr.split('\n').filter((l) => l.includes('over-matched _key='))).toHaveLength(60);
    expect(stderr.split('\n').filter((l) => l.includes('under-matched _key='))).toHaveLength(60);
    // Nothing is elided any more, so no elision line remains.
    expect(stderr).not.toContain('(not listed)');
  });

  it('prints the divergence keys as valid JSON strings, so a copy-paste from stderr works (issue #1507)', async () => {
    // The listed keys are the operator's raw material for the follow-up
    // query; unquoted, they are not paste-able into JSON. The quoted form
    // must be a valid JSON string literal that round-trips back to the key.
    // The key carries an apostrophe — a character ArangoDB allows in a _key
    // and one a hand-written quoting would get wrong.
    const key = "it's-a-key";
    const stray = { ...huskDoc, _key: key, _id: `users/${key}`, customSettings: { theme: 'dark' } };
    const db = fakeDb({ husks: [stray], allDocs: [stray] });
    await runMain(db, ['--delete', '--yes']);
    const stderr = stderrText(errorSpy);
    const line = stderr.split('\n').find((l) => l.includes('over-matched _key='));
    expect(line).toBeDefined();
    // The token after _key= is a JSON string literal...
    const literal = line.slice(line.indexOf('_key=') + '_key='.length).split(' ')[0];
    expect(() => JSON.parse(literal)).not.toThrow();
    // ...and it decodes back to the exact key.
    expect(JSON.parse(literal)).toBe(key);
  });

  it("names the knob, the dry run and THIS listing's own count in each elision line (issue #1507)", async () => {
    // The operator must be told HOW to see the withheld entries, and with
    // WHICH value — a bare "not listed" leaves the remedy undiscoverable.
    // Each listing's total is printed in its own header, so the elision
    // line names the count that lists THAT listing in full. Naming a
    // run-wide maximum instead would inflate one listing's remedy with an
    // unrelated listing's count — the operator would dump thousands of
    // lookalikes to reach a handful of withheld husks.
    //
    // 60 over-matched, 100 under-matched: the two directions have DIFFERENT
    // totals, so a run-wide maximum would name 100 on BOTH lines.
    const { extra, missed } = divergentDocs(60, 100);
    const db = fakeDb({ husks: extra, allDocs: [...extra, ...missed] });
    await runMain(db, ['--delete', '--yes']);
    const stderr = stderrText(errorSpy);
    const lines = stderr.split('\n');
    const overElision = lines.find((l) => l.includes('more over-matched'));
    const underElision = lines.find((l) => l.includes('more under-matched'));
    expect(overElision).toBeDefined();
    expect(underElision).toBeDefined();
    // Each line names its OWN listing's count.
    expect(overElision).toContain('HUSK_SAMPLE_LIMIT=60');
    expect(underElision).toContain('HUSK_SAMPLE_LIMIT=100');
    // The remedy names the DRY RUN: on a destructive script, an unqualified
    // "re-run" could be read as "re-run the same command", which deletes.
    expect(overElision).toContain('re-run the dry run (without --delete)');
  });

  it('applies the same cap and elision wording to the husk and lookalike listings (issue #1508)', async () => {
    // The three per-document listings share ONE cap and ONE elision wording:
    // the husk listing (stdout), the lookalike listing (stdout, sample
    // truncated SERVER-side) and the divergence listing (stderr). A cap or
    // wording that drifts between them is the bug this pin guards.
    //
    // The two stdout listings are given DIFFERENT totals on purpose: with the
    // same total they emit the same elision line, and an assertion on that
    // line would still pass if ONE of the two listings stopped eliding (or
    // stopped listing altogether) — the pin would be blind to the removal.
    const husks = Array.from({ length: 60 }, (_, i) => ({ ...huskDoc, _key: `h-${i}`, _id: `users/h-${i}` }));
    const lookalikes = Array.from({ length: 50 }, (_, i) => ({
      _key: `l-${i}`,
      createdAt: '2025-01-01T00:00:00.000Z'
    }));
    const db = fakeDb({
      husks,
      allDocs: husks,
      lookalikeCount: 75,
      lookalikes
    });
    await runMain(db);
    const stdout = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    // The husk listing caps at 50 and elides the rest — with ITS own count.
    const huskLines = stdout.split('\n').filter((l) => l.includes('husk _key='));
    expect(huskLines).toHaveLength(50);
    expect(stdout).toContain('... and 10 more (not listed)');
    // The husk line keeps its full shape (the listing is not degraded to a
    // bare key while it is being unified).
    expect(huskLines[0]).toContain('createdAt=');
    expect(huskLines[0]).toContain('attributes=');
    // The lookalike listing caps at 50 too and elides the rest — with a
    // DIFFERENT count, so the two elision lines cannot be confused. Its
    // sample arrives already truncated (the count is the number of ALL
    // lookalikes).
    const lookalikeLines = stdout.split('\n').filter((l) => l.includes('lookalike _key='));
    expect(lookalikeLines).toHaveLength(50);
    expect(stdout).toContain('... and 25 more (not listed)');
    expect(lookalikeLines[0]).toContain('createdAt=');
    // Each listing names its OWN count: 60 for the husks, 75 for the
    // lookalikes. Neither is inflated by the other.
    expect(stdout).toContain('HUSK_SAMPLE_LIMIT=60');
    expect(stdout).toContain('HUSK_SAMPLE_LIMIT=75');
  });

  it('applies the RAISED cap to the husk listing, not just to the divergence listing (issue #1507)', async () => {
    // The override must reach EVERY listing, not only the abort path's. A
    // client-side cap still pinned to the default would leave the report
    // printing exactly 50 husk lines however high the operator raises the
    // knob — the exact defect #1507 was filed for.
    const husks = Array.from({ length: 60 }, (_, i) => ({ ...huskDoc, _key: `h-${i}`, _id: `users/h-${i}` }));
    const db = fakeDb({ husks, allDocs: husks });
    await runMain(db, [], { ...gateEnv, HUSK_SAMPLE_LIMIT: '200' });
    const stdout = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(stdout.split('\n').filter((l) => l.includes('husk _key='))).toHaveLength(60);
    expect(stdout).not.toContain('(not listed)');
  });

  it('applies the RAISED cap to the lookalike listing (issue #1507)', async () => {
    // Same for the lookalike listing: the server-side slice honours the
    // raised cap (pinned by the next test), and the client-side re-slice
    // must honour it too — otherwise the operator sees fewer entries than
    // they asked for, silently.
    const lookalikes = Array.from({ length: 60 }, (_, i) => ({
      _key: `l-${i}`,
      createdAt: '2025-01-01T00:00:00.000Z'
    }));
    const db = fakeDb({ lookalikeCount: 60, lookalikes });
    await runMain(db, [], { ...gateEnv, HUSK_SAMPLE_LIMIT: '200' });
    const stdout = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(stdout.split('\n').filter((l) => l.includes('lookalike _key='))).toHaveLength(60);
    expect(stdout).not.toContain('(not listed)');
  });

  it('slices the lookalikes with the cap BIND, not a literal (issue #1507)', () => {
    // The bind assertion in the next test alone is blind to a literal: a
    // SLICE(..., 0, 50) would still carry sampleLimit=200 in the bind and
    // still pass, while the SERVER would keep truncating at the default.
    // The AQL text IS the contract here (the server-side slice is executed
    // by ArangoDB, not by the fake), so it is pinned the same way the
    // matcher/removal templates are pinned in husk-user-docs.test.js.
    expect(LEGACY_LOOKALIKE_AQL).toContain('SLICE(lookalikeDocs, 0, @sampleLimit)');
  });

  it('prints the husk and lookalike keys as valid JSON strings (issue #1507)', async () => {
    // The quoted-key contract is not confined to the abort path: the stdout
    // listings are the operator's other copy-paste source (a key pasted into
    // a follow-up AQL query). A key carrying an apostrophe AND a double
    // quote is what a hand-written quoting gets wrong.
    const key = 'it\'s-a-"key"';
    const husk = { ...huskDoc, _key: key, _id: `users/${key}` };
    const lookalike = { _key: key, createdAt: '2025-01-01T00:00:00.000Z' };
    const db = fakeDb({ husks: [husk], allDocs: [husk], lookalikeCount: 1, lookalikes: [lookalike] });
    await runMain(db);
    const stdout = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    for (const marker of ['husk _key=', 'lookalike _key=']) {
      const line = stdout.split('\n').find((l) => l.includes(marker));
      expect(line).toBeDefined();
      const literal = line.slice(line.indexOf('_key=') + '_key='.length).split(' ')[0];
      expect(() => JSON.parse(literal)).not.toThrow();
      expect(JSON.parse(literal)).toBe(key);
    }
  });

  it('states the EFFECTIVE cap, so a misspelled override is visible (issue #1507)', async () => {
    // HUSK_SAMPLE_LIMIT is read from the environment, so a typo in the
    // variable NAME is invisible: the run quietly uses the default. Printing
    // the effective cap in the report header makes the override
    // self-verifying — the operator sees the cap they actually got.
    await runMain(fakeDb({}), [], { ...gateEnv, HUSK_SAMPLE_LIMIT: '200' });
    let stdout = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(stdout).toContain('Listing cap:   200');
    logSpy.mockClear();
    await runMain(fakeDb({}), [], gateEnv);
    stdout = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(stdout).toContain('Listing cap:   50');
  });

  it('states the effective cap on the abort path too, where no report header is printed', async () => {
    const { extra, missed } = divergentDocs(60);
    const db = fakeDb({ husks: extra, allDocs: [...extra, ...missed] });
    await runMain(db, ['--delete', '--yes'], { ...gateEnv, HUSK_SAMPLE_LIMIT: '200' });
    expect(stderrText(errorSpy)).toContain('capped at 200 entries per direction');
  });

  it('does not tell the operator to list entries the same --delete run removes', async () => {
    // On the --delete path the withheld husks are removed by THIS run, so
    // the dry-run advice would point at documents that are about to be gone.
    // The elision line must say what actually happens to them.
    const husks = Array.from({ length: 60 }, (_, i) => ({ ...huskDoc, _key: `h-${i}`, _id: `users/h-${i}` }));
    const db = fakeDb({ husks, allDocs: husks, writesExecuted: 60 });
    await runMain(db, ['--delete', '--yes']);
    const stdout = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    const elision = stdout.split('\n').find((l) => l.includes('more (not listed)'));
    expect(elision).toBeDefined();
    expect(elision).not.toContain('re-run the dry run');
    expect(elision).toContain('included in the removal below');
    // The knob still works on this path: the report is printed BEFORE the
    // removal, so a raised cap lists the withheld matches in the audit
    // record of the very run that removes them.
    expect(elision).toContain('HUSK_SAMPLE_LIMIT=60');
  });

  it("reconciles the in-output advice with the cap's stated purpose (issue #1507)", async () => {
    // The remedy names the value that lists the withheld entries in full —
    // which for a large collection means a large dump. The file header says
    // the cap exists to keep the log pipeline from being flooded, so the
    // in-output advice must carry the same caveat, or the tool contradicts
    // its own rationale.
    const { extra, missed } = divergentDocs(60);
    const db = fakeDb({ husks: extra, allDocs: [...extra, ...missed] });
    await runMain(db, ['--delete', '--yes']);
    const elision = stderrText(errorSpy)
      .split('\n')
      .find((l) => l.includes('more over-matched'));
    expect(elision).toContain('redirect the output to a file');
  });

  it('couples the lookalike server-side slice to the configured cap (issue #1507)', async () => {
    // The lookalike sample is truncated SERVER-side by the SLICE in
    // LEGACY_LOOKALIKE_AQL. If that slice kept the DEFAULT cap while the
    // client-side listing honoured the override, raising HUSK_SAMPLE_LIMIT
    // would elide the extra lookalikes server-side — silently, with the
    // operator seeing fewer entries than they asked for.
    const db = fakeDb({});
    await runMain(db, [], { ...gateEnv, HUSK_SAMPLE_LIMIT: '200' });
    expect(db.lookalikeCalls()[0].bind.sampleLimit).toBe(200);
  });
});
