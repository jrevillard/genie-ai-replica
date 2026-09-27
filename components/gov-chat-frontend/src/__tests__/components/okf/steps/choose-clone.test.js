'use strict';

/**
 * Amendment A decision #9 (David, 2026-09-27): the Choose step's Clone card
 * is REAL — a source-repository picker (non-serving repos only) whose
 * Continue imports the source's concepts into the repo Entry already created
 * via the standard /import upsert (idempotent re-runs; no destroy-and-mint).
 */

const mockListConcepts = jest.fn();
const mockGetConcept = jest.fn();
const mockImportConcepts = jest.fn();

jest.mock('@/services/repoOkfService', () => ({
  __esModule: true,
  default: {
    listConcepts: (...a) => mockListConcepts(...a),
    getConcept: (...a) => mockGetConcept(...a),
    importConcepts: (...a) => mockImportConcepts(...a)
  }
}));

const { mount } = require('@vue/test-utils');
const Vuex = require('vuex');
const OkfStepChoose = require('@/components/okf/steps/Choose.vue').default;

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
                reposByStage: () => ({
                  draft: [{ repo_id: 'src-1', name: 'Source A' }],
                  review: [{ repo_id: 'src-2', name: 'Source B' }],
                  serving: [{ repo_id: 'srv-1', name: 'Serving X', ingested_at: 't' }]
                })
              }
            }
          }
        })
      ]
    }
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockListConcepts.mockResolvedValue([{ concept_id: 'c1' }, { concept_id: 'c2' }]);
  mockGetConcept.mockImplementation((src, id) =>
    Promise.resolve({ concept_id: id, path: id, title: 'T ' + id, frontmatter: { type: 'topic' }, body: 'B' })
  );
  mockImportConcepts.mockResolvedValue({ ok: true });
});

it('the picker lists only non-serving repositories and gates until a source is picked', async () => {
  const w = mountChoose();
  expect(w.emitted('gate')[0][0]).toBe(false); // nothing chosen yet
  await w.findAll('.okf-step__card')[3].trigger('click'); // the clone card
  expect(w.emitted('update').pop()[0]).toEqual({ source: 'clone' });
  expect(w.emitted('gate').pop()[0]).toBe(false); // clone alone does not open the gate
  const options = w.findAll('option').map((o) => o.text());
  expect(options.join('|')).toContain('Source A');
  expect(options.join('|')).toContain('Source B');
  expect(options.join('|')).not.toContain('Serving X');
  w.vm.local.clone_source_repo_id = 'src-1';
  await w.vm.pickSource();
  expect(w.emitted('update').pop()[0]).toEqual({ clone_source_repo_id: 'src-1' });
  expect(w.emitted('gate').pop()[0]).toBe(true);
});

it('beforeAdvance clones via list → details → /import upsert and writes the lineage back', async () => {
  const w = mountChoose();
  w.vm.local.source = 'clone';
  w.vm.local.clone_source_repo_id = 'src-1';
  await expect(w.vm.beforeAdvance()).resolves.toBe(true);
  expect(mockListConcepts).toHaveBeenCalledWith('src-1');
  expect(mockGetConcept).toHaveBeenCalledTimes(2);
  expect(mockImportConcepts).toHaveBeenCalledWith('new-1', [
    { path: 'c1', frontmatter: { type: 'topic' }, body: 'B' },
    { path: 'c2', frontmatter: { type: 'topic' }, body: 'B' }
  ]);
  const patch = w.emitted('update').pop()[0];
  expect(patch.cloned_from).toBe('src-1');
  expect(patch.concept_count).toBe(2);
});

it('beforeAdvance refuses a clone with no source picked', async () => {
  const w = mountChoose();
  w.vm.local.source = 'clone';
  await expect(w.vm.beforeAdvance()).resolves.toBe(false);
  expect(w.vm.cloneError).toBeTruthy();
  expect(mockImportConcepts).not.toHaveBeenCalled();
});

it('non-clone sources advance without touching the clone path', async () => {
  const w = mountChoose();
  w.vm.local.source = 'documents';
  await expect(w.vm.beforeAdvance()).resolves.toBe(true);
  expect(mockListConcepts).not.toHaveBeenCalled();
});
