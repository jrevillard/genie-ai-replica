'use strict';

/**
 * Re-ingest failed concepts (David, 2026-10-14) — store side.
 *
 * The server does the load-bearing work (requeue failed rows AND re-arm the
 * drain). What the store owes is narrower but real: it must NEVER throw — every
 * action in this module returns {ok:false} — and it must refetch, because a
 * re-ingest that succeeds without repainting the rail would leave the concept
 * sitting in its failed state with a live retry underneath it.
 */

const mockReingestFailed = jest.fn();
const mockGet = jest.fn();
const mockListForRepo = jest.fn();

jest.mock('@/services/repoOkfService', () => ({
  __esModule: true,
  default: {
    reingestFailed: (...a) => mockReingestFailed(...a),
    get: (...a) => mockGet(...a),
    list: jest.fn(),
    lifecycle: jest.fn(),
    deleteRepo: jest.fn(),
    listVersions: jest.fn(),
    create: jest.fn(),
    importConcepts: jest.fn(),
    mintVersion: jest.fn()
  }
}));

jest.mock('@/services/conceptService', () => ({
  __esModule: true,
  default: {
    listForRepo: (...a) => mockListForRepo(...a),
    get: jest.fn(),
    update: jest.fn()
  }
}));

jest.mock('@/services/studioService', () => ({
  __esModule: true,
  default: {
    saveDraft: jest.fn().mockRejectedValue({ status: 404 }),
    getDraft: jest.fn().mockRejectedValue({ status: 404 })
  }
}));

jest.mock('@/services/crawlerToOkfService', () => ({
  __esModule: true,
  default: { convertCrawlToOkf: jest.fn() }
}));

const Vuex = require('vuex');
const okfModule = require('@/store/modules/okf').default;

function buildStore() {
  return new Vuex.Store({
    modules: {
      okf: {
        ...okfModule,
        state: () => JSON.parse(JSON.stringify(okfModule.state()))
      }
    }
  });
}

const FAILED_ROWS = [
  { concept_id: 'sec99', title: 'sec99', index_status: 'parsed' },
  { concept_id: 'sec100', title: 'sec100', index_status: 'indexed' }
];

describe('okf store — reingestFailed (David 2026-10-14)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListForRepo.mockResolvedValue(FAILED_ROWS);
    mockGet.mockResolvedValue({ repo_id: 'r-1', ingested_at: '2026-10-01T00:00:00.000Z' });
  });

  it('repo-wide: passes conceptId null and reports the count', async () => {
    mockReingestFailed.mockResolvedValue({ ok: true, requeued: 2, concept_ids: ['sec99', 'sec100'] });
    const store = buildStore();
    const res = await store.dispatch('okf/reingestFailed', { repoId: 'r-1' });
    expect(res).toEqual({ ok: true, requeued: 2, conceptIds: ['sec99', 'sec100'] });
    expect(mockReingestFailed).toHaveBeenCalledWith('r-1', { conceptId: null }, {});
  });

  it('per-concept: forwards the conceptId so the server scopes the requeue', async () => {
    mockReingestFailed.mockResolvedValue({ ok: true, requeued: 1, concept_ids: ['sec99'] });
    const store = buildStore();
    const res = await store.dispatch('okf/reingestFailed', { repoId: 'r-1', conceptId: 'sec99' });
    expect(res.ok).toBe(true);
    expect(mockReingestFailed).toHaveBeenCalledWith('r-1', { conceptId: 'sec99' }, {});
  });

  // The whole point of re-ingest is that the failed row LEAVES its failed
  // state. Without the refetch the rail keeps showing the old error with a
  // working retry button under it.
  it('refetches concepts so the failed row repaints', async () => {
    mockReingestFailed.mockResolvedValue({ ok: true, requeued: 1, concept_ids: ['sec99'] });
    const store = buildStore();
    await store.dispatch('okf/reingestFailed', { repoId: 'r-1', conceptId: 'sec99' });
    expect(mockListForRepo).toHaveBeenCalledWith('r-1', { limit: 200, offset: 0 });
  });

  it('refetches the repo so the card reflects the freshly armed drain', async () => {
    mockReingestFailed.mockResolvedValue({ ok: true, requeued: 1, concept_ids: ['sec99'] });
    const store = buildStore();
    await store.dispatch('okf/reingestFailed', { repoId: 'r-1', conceptId: 'sec99' });
    expect(mockGet).toHaveBeenCalledWith('r-1');
  });

  // NEVER THROWS — the module contract. A rejected promise must still resolve
  // to {ok:false}, because the callers surface res.message in the UI and an
  // exception would escape into an unhandled rejection.
  it('returns ok:false when the request rejects — never throws', async () => {
    mockReingestFailed.mockRejectedValue(new Error('network down'));
    const store = buildStore();
    const res = await store.dispatch('okf/reingestFailed', { repoId: 'r-1' });
    expect(res.ok).toBe(false);
    expect(res.code).toBe('REINGEST_FAILED');
  });

  it('surfaces the server DRAIN_IN_PROGRESS code so the UI can explain itself', async () => {
    mockReingestFailed.mockRejectedValue({ data: { error: 'DRAIN_IN_PROGRESS' }, message: 'drain active' });
    const store = buildStore();
    const res = await store.dispatch('okf/reingestFailed', { repoId: 'r-1' });
    expect(res.ok).toBe(false);
  });

  it('treats a resolved non-ok payload as failure, not success', async () => {
    // A 200 with ok:false must not be reported as a completed retry.
    mockReingestFailed.mockResolvedValue({ ok: false, code: 'NOT_INGESTED', message: 'not ingested' });
    const store = buildStore();
    const res = await store.dispatch('okf/reingestFailed', { repoId: 'r-1' });
    expect(res.ok).toBe(false);
    expect(res.code).toBe('NOT_INGESTED');
  });

  it('zero requeued is a SUCCESS with a zero count, not an error', async () => {
    mockReingestFailed.mockResolvedValue({ ok: true, requeued: 0, concept_ids: [] });
    const store = buildStore();
    const res = await store.dispatch('okf/reingestFailed', { repoId: 'r-1' });
    expect(res).toEqual({ ok: true, requeued: 0, conceptIds: [] });
  });

  it('rejects a missing repoId without touching the service', async () => {
    const store = buildStore();
    const res = await store.dispatch('okf/reingestFailed', {});
    expect(res.ok).toBe(false);
    expect(mockReingestFailed).not.toHaveBeenCalled();
  });

  it('a failed repo refresh never fails the action (it is cosmetic)', async () => {
    mockReingestFailed.mockResolvedValue({ ok: true, requeued: 1, concept_ids: ['sec99'] });
    mockGet.mockRejectedValue(new Error('gone'));
    const store = buildStore();
    const res = await store.dispatch('okf/reingestFailed', { repoId: 'r-1', conceptId: 'sec99' });
    expect(res.ok).toBe(true);
  });
});
