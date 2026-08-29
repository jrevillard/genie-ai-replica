'use strict';

/**
 * Story #978 — okf store editor actions (openEditor / fetchConcepts /
 * getConcept / patchConcept / resplitRepo / autocorrectRepo / setEditorSubTab).
 * Services are mocked at module level; a real Vuex store is built with just
 * the okf module.
 */

const mockList = jest.fn();
const mockGet = jest.fn();
const mockLifecycle = jest.fn();
const mockDeleteRepo = jest.fn();
const mockListVersions = jest.fn();
const mockCreate = jest.fn();
const mockIngest = jest.fn();
const mockListForRepo = jest.fn();
const mockConceptGet = jest.fn();
const mockPatchConcept = jest.fn();
const mockResplit = jest.fn();
const mockAutocorrect = jest.fn();

jest.mock('@/services/conceptService', () => ({
  __esModule: true,
  default: {
    listForRepo: (...a) => mockListForRepo(...a),
    get: (...a) => mockConceptGet(...a),
    update: jest.fn()
  }
}));

jest.mock('@/services/repoOkfService', () => ({
  __esModule: true,
  default: {
    patchConcept: (...a) => mockPatchConcept(...a),
    resplit: (...a) => mockResplit(...a),
    autocorrect: (...a) => mockAutocorrect(...a),
    list: (...a) => mockList(...a),
    get: (...a) => mockGet(...a),
    lifecycle: (...a) => mockLifecycle(...a),
    deleteRepo: (...a) => mockDeleteRepo(...a),
    listVersions: (...a) => mockListVersions(...a),
    create: (...a) => mockCreate(...a),
    ingest: (...a) => mockIngest(...a),
    mintVersion: jest.fn()
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
        // The module exports `state: initialState()` (an object, not a
        // factory) — clone per store so tests don't share mutations.
        state: () => JSON.parse(JSON.stringify(okfModule.state))
      }
    }
  });
}

const CONCEPTS = [
  { concept_id: 'c-2', title: 'Broken', index_status: 'failed' },
  { concept_id: 'c-1', title: 'Fine', index_status: 'indexed' }
];

describe('okf store — editor actions (Story #978)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('openEditor + fetchConcepts', () => {
    it('pins the repo, resets selection and stores the concept list', async () => {
      mockListForRepo.mockResolvedValue(CONCEPTS);
      const store = buildStore();
      const result = await store.dispatch('okf/openEditor', { repoId: 'r-1' });
      expect(result.ok).toBe(true);
      expect(store.state.okf.editor.repoId).toBe('r-1');
      expect(store.state.okf.editor.selectedConceptId).toBeNull();
      expect(store.getters['okf/conceptsByRepo']('r-1')).toHaveLength(2);
      expect(mockListForRepo).toHaveBeenCalledWith('r-1');
    });

    it('stores an empty list on fetch failure (never throws)', async () => {
      mockListForRepo.mockRejectedValue(new Error('boom'));
      const store = buildStore();
      const result = await store.dispatch('okf/fetchConcepts', 'r-1');
      expect(result.ok).toBe(false);
      expect(store.getters['okf/conceptsByRepo']('r-1')).toEqual([]);
    });
  });

  describe('getConcept', () => {
    it('returns the full meta row (frontmatter + body)', async () => {
      mockConceptGet.mockResolvedValue({ concept_id: 'c-1', frontmatter: { type: 'topic' }, body: '# B' });
      const store = buildStore();
      const result = await store.dispatch('okf/getConcept', { repoId: 'r-1', conceptId: 'c-1' });
      expect(result.ok).toBe(true);
      expect(result.concept.body).toBe('# B');
    });
  });

  describe('patchConcept', () => {
    it('PATCHes and splices content_hash + index_status into the row', async () => {
      mockListForRepo.mockResolvedValue(CONCEPTS);
      mockPatchConcept.mockResolvedValue({ ok: true, content_hash: 'NEW', index_status: 'parsed', updated_at: 'T2' });
      const store = buildStore();
      await store.dispatch('okf/openEditor', { repoId: 'r-1' });
      const result = await store.dispatch('okf/patchConcept', {
        repoId: 'r-1',
        conceptId: 'c-1',
        markdown: '# updated'
      });
      expect(result.ok).toBe(true);
      const rows = store.getters['okf/conceptsByRepo']('r-1');
      const row = rows.find((c) => c.concept_id === 'c-1');
      expect(row.content_hash).toBe('NEW');
      expect(row.index_status).toBe('parsed');
    });

    it('fails with VALIDATION_ERROR when markdown is missing', async () => {
      const store = buildStore();
      const result = await store.dispatch('okf/patchConcept', { repoId: 'r-1', conceptId: 'c-1' });
      expect(result.ok).toBe(false);
      expect(result.code).toBe('VALIDATION_ERROR');
      expect(mockPatchConcept).not.toHaveBeenCalled();
    });
  });

  describe('resplitRepo + autocorrectRepo', () => {
    it('resplit refreshes the concept list after re-ingest', async () => {
      mockResplit.mockResolvedValue({ ok: true, mode: 'B', total: 3 });
      // No openEditor ran — the FIRST list call is resplitRepo's refetch.
      mockListForRepo.mockResolvedValueOnce([{ concept_id: 'b-1', title: 'Page 1', index_status: 'parsed' }]);
      const store = buildStore();
      const result = await store.dispatch('okf/resplitRepo', { repoId: 'r-1', mode: 'B', fileId: 'f-1' });
      expect(result.ok).toBe(true);
      expect(mockResplit).toHaveBeenCalledWith('r-1', 'B', 'f-1', undefined);
      expect(store.getters['okf/conceptsByRepo']('r-1')).toHaveLength(1);
    });

    it('autocorrect dry-run does NOT refetch; apply DOES', async () => {
      mockAutocorrect.mockResolvedValue({ ok: true, changes: [], warnings: [] });
      mockListForRepo.mockResolvedValue(CONCEPTS);
      const store = buildStore();
      await store.dispatch('okf/openEditor', { repoId: 'r-1' });
      mockListForRepo.mockClear();
      await store.dispatch('okf/autocorrectRepo', { repoId: 'r-1', dryRun: true });
      expect(mockListForRepo).not.toHaveBeenCalled();
      await store.dispatch('okf/autocorrectRepo', { repoId: 'r-1', dryRun: false });
      expect(mockListForRepo).toHaveBeenCalledTimes(1);
    });
  });

  describe('setEditorSubTab', () => {
    it('defaults to editor and coerces unknown values back to editor', () => {
      const store = buildStore();
      expect(store.getters['okf/editorSubTab']).toBe('editor');
      store.dispatch('okf/setEditorSubTab', 'wizard');
      expect(store.getters['okf/editorSubTab']).toBe('wizard');
      store.dispatch('okf/setEditorSubTab', 'nonsense');
      expect(store.getters['okf/editorSubTab']).toBe('editor');
    });
  });

  describe('lifecycle lanes (David, 2026-08-28)', () => {
    it('maps the five lanes: publish+serving → Ingested, retracted stays visible', async () => {
      mockList.mockResolvedValue([
        { repo_id: 'a', lifecycle_state: 'draft' },
        { repo_id: 'b', lifecycle_state: 'register' },
        { repo_id: 'c', lifecycle_state: 'review' },
        { repo_id: 'd', lifecycle_state: 'approve' },
        { repo_id: 'e', lifecycle_state: 'publish' },
        { repo_id: 'f', lifecycle_state: 'publish', ingested_at: '2026-08-28T10:00:00Z' },
        { repo_id: 'g', lifecycle_state: 'retracted' }
      ]);
      const store = buildStore();
      await store.dispatch('okf/fetchRepos', { stage: 'all' });
      const lanes = store.state.okf.reposByStage;
      expect(lanes.draft.sort()).toEqual(['a', 'b']);
      expect(lanes.in_review.sort()).toEqual(['c', 'd']);
      expect(lanes.published).toEqual(['e']);
      expect(lanes.ingested).toEqual(['f']);
      expect(lanes.retracted).toEqual(['g']);
    });

    it('publish lands in the published lane (the old code compared the NEVER-set "published" value)', async () => {
      mockList.mockResolvedValue([{ repo_id: 'p1', lifecycle_state: 'publish' }]);
      const store = buildStore();
      await store.dispatch('okf/fetchRepos', { stage: 'all' });
      expect(store.state.okf.reposByStage.published).toEqual(['p1']);
    });
  });

  describe('lifecycleTransition / deleteRepoAction / fetchVersions / import', () => {
    it('lifecycleTransition dispatches to ops and refreshes the repo row', async () => {
      mockLifecycle.mockResolvedValueOnce({ ok: true, lifecycle_state: 'review' });
      mockGet.mockResolvedValueOnce({ repo_id: 'r-1', lifecycle_state: 'review', version: 0 });
      const store = buildStore();
      const res = await store.dispatch('okf/lifecycleTransition', { repoId: 'r-1', action: 'submit' });
      expect(res.ok).toBe(true);
      expect(mockLifecycle).toHaveBeenCalledWith('r-1', 'submit', {});
      expect(store.state.okf.reposById['r-1'].lifecycle_state).toBe('review');
    });

    it('lifecycleTransition surfaces gate failures without throwing', async () => {
      mockLifecycle.mockRejectedValueOnce(Object.assign(new Error('no PII scan'), { code: 'PUBLISH_GATE_BLOCKED' }));
      const store = buildStore();
      const res = await store.dispatch('okf/lifecycleTransition', { repoId: 'r-1', action: 'publish' });
      expect(res).toMatchObject({ ok: false, code: 'PUBLISH_GATE_BLOCKED' });
    });

    it('deleteRepoAction removes the repo from the cache + lanes', async () => {
      mockList.mockResolvedValueOnce([{ repo_id: 'r-del', lifecycle_state: 'draft' }]);
      const store = buildStore();
      await store.dispatch('okf/fetchRepos', { stage: 'all' });
      mockDeleteRepo.mockResolvedValueOnce({ status: 'deleted' });
      const res = await store.dispatch('okf/deleteRepoAction', { repoId: 'r-del' });
      expect(res.ok).toBe(true);
      expect(store.state.okf.reposById['r-del']).toBeUndefined();
      expect(store.state.okf.reposByStage.draft).not.toContain('r-del');
    });

    it('fetchVersions caches the manifests per repo', async () => {
      mockListVersions.mockResolvedValue([{ bundle_version: 1, okf_tag: 'okf:v1' }]);
      const store = buildStore();
      const res = await store.dispatch('okf/fetchVersions', 'r-1');
      expect(res.ok).toBe(true);
      expect(store.getters['okf/versionsByRepo']('r-1')).toHaveLength(1);
      expect(store.getters['okf/versionsByRepo']('other')).toHaveLength(0);
    });

    it('upsertImported creates the repo from a zip and refreshes the lanes', async () => {
      mockCreate.mockResolvedValueOnce({ repo_id: 'r-imp', name: 'Imported', domain: 'general' });
      mockIngest.mockResolvedValueOnce({ ok: true });
      const store = buildStore();
      const file = new File(['zip'], 'bundle.zip', { type: 'application/zip' });
      const res = await store.dispatch('okf/upsertImported', { file, name: 'Imported', domain: 'general' });
      expect(res.ok).toBe(true);
      expect(store.state.okf.reposById['r-imp']).toBeTruthy();
      expect(store.state.okf.reposByStage.draft).toContain('r-imp');
    });
  });
});
