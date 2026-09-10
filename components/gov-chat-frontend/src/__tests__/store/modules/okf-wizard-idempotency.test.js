'use strict';

/**
 * WIZARD IDEMPOTENCY (David, 2026-09-04) — the store-side rules:
 *   R-C  a published/ingested repo's draft writes are SKIPPED (nothing to
 *        draft — the server write would 404/409-spam),
 *   R-D  the not-yet-live studio-drafts endpoint is called AT MOST ONCE per
 *        session; after its first 404 every further saveDraft short-circuits
 *        silently (never retried per-step).
 * The in-memory draft ALWAYS updates so the wizard keeps rendering.
 */

jest.mock('@/services/studioService', () => ({
  __esModule: true,
  default: { saveDraft: jest.fn() }
}));

jest.mock('@/services/repoOkfService', () => ({
  __esModule: true,
  default: { list: jest.fn().mockResolvedValue([]) }
}));

const Vuex = require('vuex');
const studioService = require('@/services/studioService').default;
const okfModule = require('@/store/modules/okf').default;

function buildStore() {
  return new Vuex.Store({
    modules: { okf: { ...okfModule, state: () => JSON.parse(JSON.stringify(okfModule.state)) } }
  });
}

const DRAFT = { repo_id: 'r1', name: 'Demo', studio_step: 5 };

describe('okf/saveDraft — wizard idempotency', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    studioService.saveDraft.mockReset();
  });

  it('R-C: a published repo skips the server write (no studioService call)', async () => {
    const store = buildStore();
    store.commit('okf/upsertRepo', { repo_id: 'r1', lifecycle_state: 'publish', version: 2 });
    const res = await store.dispatch('okf/saveDraft', { repoId: 'r1', draft: { ...DRAFT } });
    expect(res.ok).toBe(true);
    expect(res.skipped).toBe('frozen');
    expect(studioService.saveDraft).not.toHaveBeenCalled();
    // the in-memory draft still updated (viewing keeps working)
    expect(store.state.okf.drafts.r1.name).toBe('Demo');
  });

  it('R-C: an ingested (serving) repo skips the server write too', async () => {
    const store = buildStore();
    store.commit('okf/upsertRepo', { repo_id: 'r1', lifecycle_state: 'publish', ingested_at: '2026-09-04T10:00:00Z' });
    const res = await store.dispatch('okf/saveDraft', { repoId: 'r1', draft: { ...DRAFT } });
    expect(res.skipped).toBe('frozen');
    expect(studioService.saveDraft).not.toHaveBeenCalled();
  });

  it('R-D: after the first 404 the drafts endpoint is never called again', async () => {
    studioService.saveDraft.mockRejectedValueOnce(Object.assign(new Error('nope'), { status: 404 }));
    const store = buildStore();
    // first save: hits the dead endpoint once, flags it unavailable
    const first = await store.dispatch('okf/saveDraft', { repoId: 'r1', draft: { ...DRAFT } });
    expect(first.code).toBe('NOT_READY');
    expect(studioService.saveDraft).toHaveBeenCalledTimes(1);
    // many further saves across the wizard: zero further network calls
    for (let i = 0; i < 9; i += 1) {
      const res = await store.dispatch('okf/saveDraft', {
        repoId: 'r1',
        draft: { ...DRAFT, studio_step: 6 + i }
      });
      expect(res.silent).toBe(true);
    }
    expect(studioService.saveDraft).toHaveBeenCalledTimes(1); // still one
  });

  it('a draft (non-frozen) repo with a live endpoint saves normally', async () => {
    studioService.saveDraft.mockResolvedValueOnce({});
    const store = buildStore();
    store.commit('okf/upsertRepo', { repo_id: 'r1', lifecycle_state: 'draft' });
    const res = await store.dispatch('okf/saveDraft', { repoId: 'r1', draft: { ...DRAFT } });
    expect(res.ok).toBe(true);
    expect(studioService.saveDraft).toHaveBeenCalledTimes(1);
  });
});
