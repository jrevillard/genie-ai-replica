'use strict';

/**
 * Amendment A decision #9 (David, 2026-09-27): the Choose step's Clone card
 * is REAL — a source-repository picker (non-serving repos only) whose
 * Continue hands off to the 4.8 clone API (wholesale meta copy: links, PII
 * state, labels). Entry's empty shell (which holds the target name) is
 * deleted first; the delete is an ASYNC 202, so a 409 from the clone is
 * retried with backoff.
 *
 * Store-shape regression (max-review F3/G1): reposByStage lanes carry
 * repo_id STRINGS — the picker must resolve them through repoById.
 */

const mockDeleteRepo = jest.fn();
const mockClone = jest.fn();

jest.mock('@/services/repoOkfService', () => ({
  __esModule: true,
  default: {
    deleteRepo: (...a) => mockDeleteRepo(...a),
    clone: (...a) => mockClone(...a)
  }
}));

const { mount } = require('@vue/test-utils');
const Vuex = require('vuex');
const OkfStepChoose = require('@/components/okf/steps/Choose.vue').default;

const REPOS = {
  'src-1': { repo_id: 'src-1', name: 'Source A' },
  'src-2': { repo_id: 'src-2', name: 'Source B' },
  'srv-1': { repo_id: 'srv-1', name: 'Serving X', ingested_at: 't' }
};

function mountChoose(draft) {
  return mount(OkfStepChoose, {
    props: { draft: draft || { repo_id: 'new-1', name: 'New Repo', domain: 'general' }, expert: false },
    global: {
      stubs: { DsInfoTip: true },
      plugins: [
        new Vuex.Store({
          modules: {
            okf: {
              namespaced: true,
              getters: {
                // REAL SHAPE: the lanes hold id strings, not objects.
                reposByStage: () => ({
                  draft: ['src-1', 'srv-1', 'src-1'], // dup + serving + a string, like laneFor pushes
                  in_review: ['src-2']
                }),
                repoById: () => (id) => REPOS[id] || null
              },
              actions: { fetchRepos: () => ({}) }
            }
          }
        })
      ]
    }
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDeleteRepo.mockResolvedValue({ status: 'deleted' });
  mockClone.mockResolvedValue({ repo_id: 'cloned-1', name: 'New Repo', concept_count: 7 });
});

it('the picker resolves lane id STRINGS to repos, dedupes, and filters serving', async () => {
  const w = mountChoose();
  await w.findAll('.okf-step__card')[3].trigger('click'); // the clone card
  const options = w.findAll('option').map((o) => o.text());
  expect(options.filter((t) => t === 'Source A').length).toBe(1); // deduped despite the repeated id
  expect(options).toContain('Source B');
  expect(options.join('|')).not.toContain('Serving X');
});

it('beforeAdvance deletes the empty shell, calls the 4.8 clone API, and swaps the repo id', async () => {
  const w = mountChoose();
  w.vm.local.source = 'clone';
  w.vm.local.clone_source_repo_id = 'src-1';
  await expect(w.vm.beforeAdvance()).resolves.toBe(true);
  expect(mockDeleteRepo).toHaveBeenCalledWith('new-1');
  expect(mockClone).toHaveBeenCalledWith('src-1', { name: 'New Repo', domain: 'general' });
  const patch = w.emitted('update').pop()[0];
  expect(patch.repo_id).toBe('cloned-1');
  expect(patch.cloned_from).toBe('src-1');
  expect(patch.concept_count).toBe(7);
});

it('a 409 (async delete still settling) retries and succeeds', async () => {
  const w = mountChoose();
  w.vm.local.source = 'clone';
  w.vm.local.clone_source_repo_id = 'src-1';
  mockClone.mockRejectedValueOnce(Object.assign(new Error('dup'), { status: 409 }));
  const started = Date.now();
  await expect(w.vm.beforeAdvance()).resolves.toBe(true);
  expect(mockClone).toHaveBeenCalledTimes(2);
  expect(Date.now() - started).toBeGreaterThanOrEqual(1100); // the backoff ran
});

it('beforeAdvance refuses a clone with no source picked', async () => {
  const w = mountChoose();
  w.vm.local.source = 'clone';
  await expect(w.vm.beforeAdvance()).resolves.toBe(false);
  expect(w.vm.cloneError).toBeTruthy();
  expect(mockClone).not.toHaveBeenCalled();
});

it('a clone that keeps failing surfaces the error and refuses the advance', async () => {
  const w = mountChoose();
  w.vm.local.source = 'clone';
  w.vm.local.clone_source_repo_id = 'src-1';
  mockClone.mockRejectedValue(new Error('boom'));
  await expect(w.vm.beforeAdvance()).resolves.toBe(false);
  expect(w.vm.cloneError).toBeTruthy();
  expect(mockClone).toHaveBeenCalledTimes(1); // non-409 → no retry loop
});

it('non-clone sources advance without touching the clone path', async () => {
  const w = mountChoose();
  w.vm.local.source = 'documents';
  await expect(w.vm.beforeAdvance()).resolves.toBe(true);
  expect(mockClone).not.toHaveBeenCalled();
});

it('switching the workflow card clears a stale Input selection (G3)', async () => {
  const w = mountChoose({ repo_id: 'new-1', source: 'documents', input: { document_ids: ['f1', 'f2'] } });
  await w.findAll('.okf-step__card')[2].trigger('click'); // manual — a real switch
  const patches = w.emitted('update').map((e) => e[0]);
  expect(patches.some((p) => p.input === null)).toBe(true);
});
