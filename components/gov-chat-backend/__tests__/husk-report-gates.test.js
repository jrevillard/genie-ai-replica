/**
 * Tests for the operator-facing safety wiring of scripts/report-husk-user-docs.js
 * (issue #1494): the CLI/env gates and the ordering "divergence abort happens
 * BEFORE any remove". The signature itself (predicate + AQL templates) is
 * pinned in husk-user-docs.test.js; here the unit under test is main() —
 * made testable by the parseAndGateArgs extraction and the injectable
 * database factory (createApp()-style).
 */

const {
  parseAndGateArgs,
  main,
  HUSK_MATCHER_AQL,
  HUSK_REMOVAL_AQL,
  ALL_DOCS_AQL
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
// `writesExecuted` is what the removal's stats report carries back.
function fakeDb({ husks = [], allDocs = [], writesExecuted = 0 } = {}) {
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
      return writesExecuted === null
        ? {} // a removal result with no stats — the honest-answer-unknown case
        : { extra: { stats: { writesExecuted } } };
    }
    return { next: async () => ({ count: 0, sample: [] }) };
  });
  return {
    query,
    exists: async () => true,
    name: 'test-db',
    collection: () => ({ count: async () => ({ count: husks.length + allDocs.length }) }),
    removalCalls: () => executed.filter((c) => c.aql === HUSK_REMOVAL_AQL)
  };
}

async function runMain(db, argv = [], env = gateEnv) {
  return main({ argv, env, createDatabase: () => db });
}

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
      password: 'pw'
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

  it('fails when the removal result carries no writesExecuted stats (outcome unknown ≠ success)', async () => {
    const db = fakeDb({ husks: [huskDoc], allDocs: [huskDoc], writesExecuted: null });
    await runMain(db, ['--delete', '--yes']);
    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('writesExecuted stats'));
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('Done.'));
  });

  it('fails when the database does not exist (a wrong db reads as clean)', async () => {
    const db = fakeDb({});
    db.exists = async () => false;
    await runMain(db);
    expect(process.exitCode).toBe(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('does not exist'));
  });
});
