'use strict';

// Story 2.11 — the two attribution writes on the `queries` doc: the
// run-start block (metadata.agent_run = {run_id, execution_versions,
// started_at}) and the honest-outcome patch (outcome + finished_at). The
// contract under test: MERGE, never clobber — the doc may carry other
// metadata, the block may already carry the start write, and a patch
// replaces only the keys it names.

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

let collections;

beforeEach(() => {
  jest.clearAllMocks();
  collections = {
    document: jest.fn().mockResolvedValue({ _key: 'q1', isAnswered: false }),
    update: jest.fn().mockResolvedValue({})
  };
  queryService.queries = collections;
});

describe('persistAgentRunStart (story 2.11)', () => {
  it('creates the agent_run block on a doc that carries no metadata yet', async () => {
    await queryService.persistAgentRunStart('q1', 'run-abc', EXECUTION_VERSIONS);

    expect(collections.update).toHaveBeenCalledTimes(1);
    expect(collections.update).toHaveBeenCalledWith('q1', {
      metadata: {
        agent_run: {
          run_id: 'run-abc',
          execution_versions: EXECUTION_VERSIONS,
          started_at: expect.any(String)
        }
      }
    });
    // UTC ISO timestamps everywhere persisted.
    expect(collections.update.mock.calls[0][1].metadata.agent_run.started_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('merges into existing metadata and an existing agent_run block without clobbering siblings', async () => {
    collections.document.mockResolvedValue({
      _key: 'q1',
      isAnswered: false,
      metadata: {
        filter_labels: ['Taxes'],
        agent_run: { outcome: 'stale-from-an-earlier-attempt' }
      }
    });

    await queryService.persistAgentRunStart('q1', 'run-abc', EXECUTION_VERSIONS);

    const written = collections.update.mock.calls[0][1].metadata;
    // MERGE semantics: the sibling metadata key survives, the block's
    // existing keys survive unless the patch names them — the patch
    // replaces only what it carries, never the siblings.
    expect(written.filter_labels).toEqual(['Taxes']);
    expect(written.agent_run).toEqual({
      run_id: 'run-abc',
      execution_versions: EXECUTION_VERSIONS,
      started_at: expect.any(String),
      outcome: 'stale-from-an-earlier-attempt'
    });
  });

  it('records run_id + started_at when the payload carried no execution_versions (older agent service)', async () => {
    await queryService.persistAgentRunStart('q1', 'run-abc', null);

    expect(collections.update).toHaveBeenCalledWith('q1', {
      metadata: { agent_run: { run_id: 'run-abc', started_at: expect.any(String) } }
    });
  });
});

describe('persistAgentRunOutcome (story 2.11)', () => {
  it('patches outcome + finished_at into the block the start write created', async () => {
    collections.document.mockResolvedValue({
      _key: 'q1',
      isAnswered: false,
      metadata: {
        agent_run: { run_id: 'run-abc', execution_versions: EXECUTION_VERSIONS, started_at: '2026-11-22T00:00:00.000Z' }
      }
    });

    await queryService.persistAgentRunOutcome('q1', 'timed_out');

    expect(collections.update).toHaveBeenCalledWith('q1', {
      metadata: {
        agent_run: {
          run_id: 'run-abc',
          execution_versions: EXECUTION_VERSIONS,
          started_at: '2026-11-22T00:00:00.000Z',
          outcome: 'timed_out',
          finished_at: expect.any(String)
        }
      }
    });
  });

  it('writes the outcome vocabulary verbatim (cancelled / interrupted / budget_exhausted)', async () => {
    for (const outcome of ['cancelled', 'interrupted', 'budget_exhausted', 'error', 'timed_out']) {
      jest.clearAllMocks();
      collections.document.mockResolvedValue({ _key: 'q1', metadata: {} });
      collections.update.mockResolvedValue({});

      await queryService.persistAgentRunOutcome('q1', outcome);

      const block = collections.update.mock.calls[0][1].metadata.agent_run;
      expect(block.outcome).toBe(outcome);
      expect(block.finished_at).toEqual(expect.any(String));
    }
  });

  it('creates the block when even the start write never arrived (no run_started seen)', async () => {
    collections.document.mockResolvedValue({ _key: 'q1', isAnswered: false });

    await queryService.persistAgentRunOutcome('q1', 'interrupted');

    expect(collections.update).toHaveBeenCalledWith('q1', {
      metadata: { agent_run: { outcome: 'interrupted', finished_at: expect.any(String) } }
    });
  });
});
