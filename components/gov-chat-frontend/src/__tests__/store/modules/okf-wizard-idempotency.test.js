'use strict';

/**
 * Story 10.5 — studio draft persistence, store side.
 *
 *   R-C  a published/ingested repo's draft writes are SKIPPED (nothing to
 *        draft — the server write would 409-spam),
 *   R-D  the drafts endpoint is LIVE as of 10.5, so the old session
 *        short-circuit is GONE — every write now reaches the server. The
 *        `draftsUnavailable` flag survives only as the "this server has no
 *        such endpoint" guard (NOT_READY), which must never arm on a null
 *        draft (the normal first-open case),
 *   hydration `fetchDraft` is what makes the wizard survive a browser
 *        refresh: `drafts` used to live only in Vuex.
 * The in-memory draft ALWAYS updates first, so the wizard renders regardless
 * of the network outcome.
 */

jest.mock('@/services/studioService', () => ({
  __esModule: true,
  default: { saveDraft: jest.fn(), getDraft: jest.fn() }
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
    modules: { okf: { ...okfModule, state: () => JSON.parse(JSON.stringify(okfModule.state())) } }
  });
}

const DRAFT = { repo_id: 'r1', name: 'Demo', studio_step: 5 };

/** The shape httpService's response interceptor rejects with. */
function httpError(status, errorCode) {
  return { status, statusText: 'Not Found', data: { error: errorCode }, message: 'boom' };
}

describe('okf/saveDraft — wizard idempotency', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    studioService.saveDraft.mockReset();
    studioService.getDraft.mockReset();
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

  it('a draft (non-frozen) repo with a live endpoint saves normally', async () => {
    studioService.saveDraft.mockResolvedValueOnce({});
    const store = buildStore();
    store.commit('okf/upsertRepo', { repo_id: 'r1', lifecycle_state: 'draft' });
    const res = await store.dispatch('okf/saveDraft', { repoId: 'r1', draft: { ...DRAFT } });
    expect(res.ok).toBe(true);
    expect(studioService.saveDraft).toHaveBeenCalledTimes(1);
  });

  it('R-D is GONE: every step change reaches the server, no session short-circuit', async () => {
    studioService.saveDraft.mockResolvedValue({});
    const store = buildStore();
    store.commit('okf/upsertRepo', { repo_id: 'r1', lifecycle_state: 'draft' });
    for (let i = 0; i < 9; i += 1) {
      const res = await store.dispatch('okf/saveDraft', {
        repoId: 'r1',
        draft: { ...DRAFT, studio_step: 6 + i }
      });
      expect(res.ok).toBe(true);
    }
    expect(studioService.saveDraft).toHaveBeenCalledTimes(9);
    expect(store.state.okf.draftsUnavailable).toBe(false);
  });

  it('a transient save failure does NOT disarm later writes (the old bug)', async () => {
    studioService.saveDraft.mockRejectedValueOnce(httpError(500, 'INTERNAL_ERROR'));
    const store = buildStore();
    store.commit('okf/upsertRepo', { repo_id: 'r1', lifecycle_state: 'draft' });
    const first = await store.dispatch('okf/saveDraft', { repoId: 'r1', draft: { ...DRAFT } });
    expect(first.ok).toBe(false);
    expect(first.code).toBe('INTERNAL_ERROR');
    // the in-memory draft still committed — the wizard never breaks
    expect(store.state.okf.drafts.r1.name).toBe('Demo');
    // and the NEXT write still reaches the server
    studioService.saveDraft.mockResolvedValueOnce({});
    const second = await store.dispatch('okf/saveDraft', {
      repoId: 'r1',
      draft: { ...DRAFT, studio_step: 7 }
    });
    expect(second.ok).toBe(true);
    expect(studioService.saveDraft).toHaveBeenCalledTimes(2);
    expect(store.state.okf.draftsUnavailable).toBe(false);
  });

  it('a server WITHOUT the endpoint (NOT_READY) still flags the session', async () => {
    studioService.saveDraft.mockRejectedValueOnce(Object.assign(new Error('NOT_READY'), { code: 'NOT_READY' }));
    const store = buildStore();
    store.commit('okf/upsertRepo', { repo_id: 'r1', lifecycle_state: 'draft' });
    const res = await store.dispatch('okf/saveDraft', { repoId: 'r1', draft: { ...DRAFT } });
    expect(res.code).toBe('NOT_READY');
    expect(store.state.okf.draftsUnavailable).toBe(true);
  });

  it('rejects a missing repoId/draft before touching the network', async () => {
    const store = buildStore();
    const res = await store.dispatch('okf/saveDraft', { repoId: 'r1', draft: null });
    expect(res.code).toBe('VALIDATION_ERROR');
    expect(studioService.saveDraft).not.toHaveBeenCalled();
  });
});

describe('okf/fetchDraft — server-backed hydration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    studioService.saveDraft.mockReset();
    studioService.getDraft.mockReset();
  });

  it('commits the FLAT wire draft so the wizard survives a refresh', async () => {
    const flat = { repo_id: 'r1', name: 'Bali', studio_step: 5, source: 'crawl', source_file_id: 'f9' };
    studioService.getDraft.mockResolvedValueOnce(flat);
    const store = buildStore();
    // a fresh page load: NOTHING in the Vuex store yet
    const res = await store.dispatch('okf/fetchDraft', { repoId: 'r1' });
    expect(res.ok).toBe(true);
    expect(store.state.okf.drafts.r1).toEqual(flat);
    // read straight off the flat shape the wizard consumes
    expect(store.getters['okf/activeDraft']('r1').studio_step).toBe(5);
    expect(store.getters['okf/activeDraft']('r1').source_file_id).toBe('f9');
  });

  it('a null draft (no draft yet) is ok:true, NOT a failure, and does not arm R-D', async () => {
    studioService.getDraft.mockResolvedValueOnce(null);
    const store = buildStore();
    const res = await store.dispatch('okf/fetchDraft', { repoId: 'r1' });
    expect(res).toEqual({ ok: true, draft: null });
    expect(store.state.okf.drafts.r1).toBeUndefined();
    expect(store.state.okf.draftsUnavailable).toBe(false);
  });

  it('a gone repo (REPO_NOT_FOUND → null) is ok:true, never NOT_READY', async () => {
    // studioService resolves null for REPO_NOT_FOUND; the store must not
    // mistake it for a missing endpoint.
    studioService.getDraft.mockResolvedValueOnce(null);
    const store = buildStore();
    const res = await store.dispatch('okf/fetchDraft', { repoId: 'gone' });
    expect(res.code).toBeUndefined();
    expect(res.draft).toBeNull();
    expect(store.state.okf.draftsUnavailable).toBe(false);
  });

  it('is cache-first: an in-session resume costs no round-trip', async () => {
    studioService.getDraft.mockResolvedValueOnce({ repo_id: 'r1', studio_step: 3 });
    const store = buildStore();
    await store.dispatch('okf/fetchDraft', { repoId: 'r1' });
    const again = await store.dispatch('okf/fetchDraft', { repoId: 'r1' });
    expect(again.cached).toBe(true);
    expect(studioService.getDraft).toHaveBeenCalledTimes(1);
  });

  it('force:true re-reads from the server', async () => {
    studioService.getDraft.mockResolvedValue({ repo_id: 'r1', studio_step: 3 });
    const store = buildStore();
    await store.dispatch('okf/fetchDraft', { repoId: 'r1' });
    studioService.getDraft.mockResolvedValueOnce({ repo_id: 'r1', studio_step: 8 });
    const res = await store.dispatch('okf/fetchDraft', { repoId: 'r1', force: true });
    expect(res.draft.studio_step).toBe(8);
    expect(store.state.okf.drafts.r1.studio_step).toBe(8);
    expect(studioService.getDraft).toHaveBeenCalledTimes(2);
  });

  it('NOT_READY (endpoint missing on an older server) arms R-D for the session', async () => {
    studioService.getDraft.mockRejectedValueOnce(Object.assign(new Error('NOT_READY'), { code: 'NOT_READY' }));
    const store = buildStore();
    const res = await store.dispatch('okf/fetchDraft', { repoId: 'r1' });
    expect(res).toEqual({ ok: false, code: 'NOT_READY', message: 'okf.studio.draft.notReady' });
    expect(store.state.okf.draftsUnavailable).toBe(true);
  });

  it('an unexpected failure returns ok:false WITHOUT arming R-D', async () => {
    studioService.getDraft.mockRejectedValueOnce(httpError(500, 'INTERNAL_ERROR'));
    const store = buildStore();
    const res = await store.dispatch('okf/fetchDraft', { repoId: 'r1' });
    expect(res.ok).toBe(false);
    expect(res.code).toBe('DRAFT_FETCH_FAILED');
    expect(store.state.okf.draftsUnavailable).toBe(false);
  });

  it('rejects a missing repoId', async () => {
    const store = buildStore();
    const res = await store.dispatch('okf/fetchDraft', {});
    expect(res.code).toBe('VALIDATION_ERROR');
    expect(studioService.getDraft).not.toHaveBeenCalled();
  });

  it('never throws — the wizard resume path is UI code', async () => {
    studioService.getDraft.mockRejectedValueOnce(Object.assign(new Error('NOT_READY'), { code: 'NOT_READY' }));
    const store = buildStore();
    await expect(store.dispatch('okf/fetchDraft', { repoId: 'r1' })).resolves.toBeTruthy();
  });

  it('stamps repo_id from the requested id, never from a stale server body', async () => {
    studioService.getDraft.mockResolvedValueOnce({ repo_id: 'WRONG', name: 'Bali', studio_step: 2 });
    const store = buildStore();
    await store.dispatch('okf/fetchDraft', { repoId: 'r1' });
    expect(store.state.okf.drafts.r1.repo_id).toBe('r1');
    expect(store.state.okf.drafts.WRONG).toBeUndefined();
  });
});

// ─── Round 18, #80472 — the pre-create local-draft path is pinned ──────────
// Two credible green regressions these cases close:
//   (a) re-pointing StudioWizard at saveDraft would PUT /okf/repos/pending/draft
//       on every keystroke → 404 → arms draftsUnavailable against a HEALTHY
//       backend (the exact round-17 #80359 bug);
//   (b) deleting saveDraft's consume branch re-hammers the missing route.
describe('okf/setDraftLocal + the draftsUnavailable consume branch (#80472)', () => {
  beforeEach(() => {
    studioService.saveDraft.mockReset();
    studioService.getDraft.mockReset();
  });

  it('setDraftLocal commits the draft and NEVER touches the server', async () => {
    const store = buildStore();
    const res = await store.dispatch('okf/setDraftLocal', {
      repoId: 'pending',
      draft: { name: 'New repo', studio_step: 0 }
    });
    expect(res).toMatchObject({ ok: true, local: true });
    expect(studioService.saveDraft).not.toHaveBeenCalled();
    // the draft is resumable in-session and carries a stamp
    const d = store.state.okf.drafts.pending;
    expect(d.name).toBe('New repo');
    expect(typeof d.updated_at).toBe('number');
    // an explicit stamp is preserved (caller-owned ordering wins)
    await store.dispatch('okf/setDraftLocal', {
      repoId: 'pending',
      draft: { name: 'New repo 2', studio_step: 1, updated_at: 12345 }
    });
    expect(store.state.okf.drafts.pending.updated_at).toBe(12345);
  });

  it('saveDraft CONSUMES draftsUnavailable: local-only, no more server calls, skipped flag', async () => {
    const store = buildStore();
    // arm the flag the honest way — a NOT_READY from the server
    studioService.saveDraft.mockRejectedValueOnce(Object.assign(new Error('no route'), { code: 'NOT_READY' }));
    await store.dispatch('okf/saveDraft', { repoId: 'r1', draft: { name: 'A' } });
    expect(store.state.okf.draftsUnavailable).toBe(true);
    // the consume branch: same dispatch again — no further server call
    const res = await store.dispatch('okf/saveDraft', { repoId: 'r1', draft: { name: 'B' } });
    expect(res).toMatchObject({ ok: true, skipped: 'unavailable' });
    expect(studioService.saveDraft).toHaveBeenCalledTimes(1); // only the arming call
    expect(store.state.okf.drafts.r1.name).toBe('B'); // local cache updated
  });
});
