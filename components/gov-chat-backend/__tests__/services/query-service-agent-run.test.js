'use strict';

// Story 2.11 — the two attribution writes on the `queries` doc: the
// run-start block (metadata.agent_run = {run_id, execution_versions,
// started_at}) and the honest-outcome patch (outcome + finished_at). The
// contract under test: the merge runs SERVER-SIDE (one AQL UPDATE over the
// doc's current state) — a fire-and-forget patch must never write back a
// stale pre-finalize metadata over the assembled answer, and a patch
// replaces only the keys it names, never the siblings.

require('../setup-env');
const { EXECUTION_VERSIONS } = require('../fixtures/agent-run-attribution');

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
  it('persists the consumer-minted block verbatim: the patch carries exactly its keys', async () => {
    await queryService.persistAgentRunStart('q1', {
      run_id: 'run-abc',
      execution_versions: EXECUTION_VERSIONS,
      started_at: '2026-11-22T00:00:00.000Z'
    });

    const patch = expectServerSideMerge(queryArg());
    // The block's own timestamp — minted ONCE at the consumer, the same
    // bytes the success finalize later completes.
    expect(patch).toEqual({
      run_id: 'run-abc',
      execution_versions: EXECUTION_VERSIONS,
      started_at: '2026-11-22T00:00:00.000Z'
    });
  });

  it('records run_id + started_at when the payload carried no execution_versions (older agent service)', async () => {
    await queryService.persistAgentRunStart('q1', {
      run_id: 'run-abc',
      execution_versions: null,
      started_at: '2026-11-22T00:00:00.000Z'
    });

    const patch = expectServerSideMerge(queryArg());
    expect(patch).toEqual({ run_id: 'run-abc', started_at: '2026-11-22T00:00:00.000Z' });
  });

  it('degrades a garbage block to the null-run_id fallback, never a thrown write', async () => {
    await queryService.persistAgentRunStart('q1', 'garbage');

    const patch = expectServerSideMerge(queryArg());
    expect(patch).toEqual({ run_id: null, started_at: expect.any(String) });
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
