'use strict';

// Story 2.11 — the two attribution writes on the `queries` doc: the
// run-start block (metadata.agent_run = {run_id, execution_versions,
// started_at}) and the honest-outcome patch (outcome + finished_at). The
// contract under test: the merge runs SERVER-SIDE (one AQL UPDATE over the
// doc's current state) — a fire-and-forget patch must never write back a
// stale pre-finalize metadata over the assembled answer, and a patch
// replaces only the keys it names, never the siblings.

require('../setup-env');

jest.mock('dotenv', () => ({ config: jest.fn() }));

jest.mock(
  '../../shared-lib',
  () => ({
    ...require('../mocks/shared-lib'),
    logger: {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn()
    },
    dbService: { getConnection: jest.fn() }
  }),
  { virtual: true }
);
jest.mock('../../shared-lib/validation-utils', () => require('../mocks/shared-lib'), { virtual: true });
jest.mock('arangojs', () => ({ aql: (strings, ...values) => ({ _aql: true, strings, values }) }));

const queryService = require('../../services/query-service');

const EXECUTION_VERSIONS = {
  implementation: { version: '0.1.0' },
  model: { id: 'test-model', source: 'discovered' },
  prompt: { version: 'prod-1', sha256: 'abc123def456' },
  configuration: { sha256: '0123456789ab', values: { max_steps: 6 } }
};

let dbQuery;

const queryArg = () => {
  expect(dbQuery).toHaveBeenCalledTimes(1);
  const arg = dbQuery.mock.calls[0][0];
  expect(arg._aql).toBe(true);
  return arg;
};

// The merged statement: agent_run MERGES into the doc's current metadata —
// the siblings survive, the patch replaces only the keys it names.
const expectServerSideMerge = (arg) => {
  const statement = arg.strings.join('');
  expect(statement).toContain('MERGE(doc.metadata || {}');
  expect(statement).toContain('MERGE(doc.metadata.agent_run || {}');
  // The bound values carry the target key and the patch (in template order).
  expect(arg.values[0]).toBe('q1');
  return arg.values[1];
};

beforeEach(() => {
  jest.clearAllMocks();
  dbQuery = jest.fn().mockResolvedValue({ forEach: jest.fn().mockResolvedValue(undefined) });
  queryService.db = { query: dbQuery };
});

describe('persistAgentRunStart (story 2.11)', () => {
  it('merges the run-start block server-side: the patch carries the keys it names', async () => {
    await queryService.persistAgentRunStart('q1', 'run-abc', EXECUTION_VERSIONS);

    const patch = expectServerSideMerge(queryArg());
    expect(patch).toEqual({
      run_id: 'run-abc',
      execution_versions: EXECUTION_VERSIONS,
      started_at: expect.any(String)
    });
    // UTC ISO timestamps everywhere persisted.
    expect(patch.started_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('records run_id + started_at when the payload carried no execution_versions (older agent service)', async () => {
    await queryService.persistAgentRunStart('q1', 'run-abc', null);

    const patch = expectServerSideMerge(queryArg());
    expect(patch).toEqual({ run_id: 'run-abc', started_at: expect.any(String) });
  });

  it('rejects a non-object execution_versions payload (never persisted)', async () => {
    await queryService.persistAgentRunStart('q1', 'run-abc', 'garbage');

    const patch = expectServerSideMerge(queryArg());
    expect(patch).toEqual({ run_id: 'run-abc', started_at: expect.any(String) });
  });
});

describe('persistAgentRunOutcome (story 2.11)', () => {
  it('merges outcome + finished_at server-side into the block the start write created', async () => {
    await queryService.persistAgentRunOutcome('q1', 'timed_out');

    const patch = expectServerSideMerge(queryArg());
    expect(patch).toEqual({ outcome: 'timed_out', finished_at: expect.any(String) });
  });

  it('writes the outcome vocabulary verbatim (cancelled / interrupted / budget_exhausted)', async () => {
    for (const outcome of ['cancelled', 'interrupted', 'budget_exhausted', 'error', 'timed_out']) {
      jest.clearAllMocks();
      dbQuery = jest.fn().mockResolvedValue({ forEach: jest.fn().mockResolvedValue(undefined) });
      queryService.db = { query: dbQuery };

      await queryService.persistAgentRunOutcome('q1', outcome);

      const patch = expectServerSideMerge(queryArg());
      expect(patch.outcome).toBe(outcome);
      expect(patch.finished_at).toEqual(expect.any(String));
    }
  });
});
