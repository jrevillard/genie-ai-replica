'use strict';

/**
 * The wizard's SPLIT REPORT (the concept-document ceiling, plan §8 — "Advise
 * the curator: wizard and editor").
 *
 * The import path splits an oversized concept document losslessly against
 * OKF_MAX_CONCEPT_DOC_CHARS and REPORTS what it did (`split_documents` in the
 * import response). The wizard used to discard that answer, so a curator who
 * picked a 260 000-character page watched it become four topics and was never
 * told why.
 *
 * These tests pin the three claims that matter:
 *
 *   1. the note is rendered FROM THE SERVER'S ANSWER — the wizard never
 *      measures a file against a ceiling of its own, because the ceiling is
 *      the server's to enforce;
 *   2. no report, no note (an import that split nothing says nothing);
 *   3. the note names WHICH file became HOW MANY concepts.
 */

const mockImportConcepts = jest.fn();
const mockListConcepts = jest.fn();
const mockDeleteConcept = jest.fn();
const mockBulkPiiAction = jest.fn();
const mockGetAdminCategories = jest.fn();

jest.mock('@/services/repoOkfService', () => ({
  __esModule: true,
  default: {
    importConcepts: (...a) => mockImportConcepts(...a),
    listConcepts: (...a) => mockListConcepts(...a),
    deleteConcept: (...a) => mockDeleteConcept(...a),
    bulkPiiActionDetached: (...a) => mockBulkPiiAction(...a)
  }
}));

jest.mock('@/services/serviceTreeService', () => ({
  __esModule: true,
  default: { getAdminCategories: (...a) => mockGetAdminCategories(...a) }
}));

const { mount } = require('@vue/test-utils');
const Vuex = require('vuex');
const OkfStepInput = require('@/components/okf/steps/Input.vue').default;

const CONCEPTS = [{ concept_id: 'index', title: 'Index', type: 'index' }];

function mountInput() {
  return mount(OkfStepInput, {
    props: { draft: { repo_id: 'r1', source: 'manual', input: {} }, expert: false },
    global: {
      stubs: { DsInfoTip: true, OkfConceptEditor: true },
      plugins: [
        new Vuex.Store({
          modules: {
            okf: {
              namespaced: true,
              getters: {
                repoById: () => (id) => (id === 'r1' ? { repo_id: 'r1', name: 'R1' } : null)
              },
              actions: { fetchRepos: () => ({}) }
            }
          }
        })
      ]
    }
  });
}

async function settled(wrapper) {
  await wrapper.vm.$nextTick();
  await wrapper.vm.$nextTick();
  await wrapper.vm.$nextTick();
}

function pickedFile(name, body) {
  return { name, text: async () => body };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockImportConcepts.mockResolvedValue({ ok: true });
  mockDeleteConcept.mockResolvedValue({ ok: true });
  mockListConcepts.mockResolvedValue(CONCEPTS.map((c) => ({ ...c })));
  mockGetAdminCategories.mockResolvedValue([]);
});

it("the server's split report is shown to the curator: which file became how many concepts", async () => {
  mockImportConcepts.mockResolvedValue({
    ok: true,
    split_documents: [{ from: 'annual-report.md', into: 4, chars: 259063 }]
  });
  const wrapper = mountInput();
  await settled(wrapper);

  await wrapper.vm.onFsFiles({ target: { files: [pickedFile('annual-report.md', 'x'.repeat(1000))] } });
  await settled(wrapper);

  const note = wrapper.find('[data-test-id="okf-input-split-note"]');
  expect(note.exists()).toBe(true);
  expect(note.text()).toContain('annual-report.md');
  expect(note.text()).toContain('4');
});

it('an import that split NOTHING says nothing (no note, no noise)', async () => {
  mockImportConcepts.mockResolvedValue({ ok: true });
  const wrapper = mountInput();
  await settled(wrapper);

  await wrapper.vm.onFsFiles({ target: { files: [pickedFile('small.md', '# Small')] } });
  await settled(wrapper);

  expect(wrapper.find('[data-test-id="okf-input-split-note"]').exists()).toBe(false);
  expect(wrapper.vm.fsSplitNote).toBe('');
});

it("the note comes from the SERVER's answer, not from a local ceiling (the wizard measures nothing)", async () => {
  // The wizard has no ceiling of its own — a file that is small enough for
  // any ceiling but that the SERVER split is still reported, and a file that
  // is huge but that the server did not split is not.
  mockImportConcepts.mockResolvedValue({
    ok: true,
    split_documents: [{ from: 'server-says-so.md', into: 2, chars: 10 }]
  });
  const wrapper = mountInput();
  await settled(wrapper);

  await wrapper.vm.onFsFiles({ target: { files: [pickedFile('server-says-so.md', 'tiny')] } });
  await settled(wrapper);

  const note = wrapper.find('[data-test-id="okf-input-split-note"]');
  expect(note.exists()).toBe(true);
  expect(note.text()).toContain('server-says-so.md');
  expect(note.text()).toContain('2');
});

it('a refused import (the server answered with an error) shows the failure, not a split report', async () => {
  mockImportConcepts.mockRejectedValue(new Error('CONCEPT_TOO_LARGE'));
  const wrapper = mountInput();
  await settled(wrapper);

  await wrapper.vm.onFsFiles({ target: { files: [pickedFile('huge.md', 'x'.repeat(1000))] } });
  await settled(wrapper);

  expect(wrapper.find('[data-test-id="okf-input-split-note"]').exists()).toBe(false);
  expect(wrapper.vm.fsError).toBeTruthy();
});

it('a report that is not a list says nothing — the wizard does not render a broken note', async () => {
  // `split_documents` is the server's shape, and the server's shape can
  // change. A note built from something that is not a list would render
  // nonsense ("undefined parts"), so the guard returns early and the wizard
  // says nothing at all.
  mockImportConcepts.mockResolvedValue({ ok: true, split_documents: 'not-a-list' });
  const wrapper = mountInput();
  await settled(wrapper);

  await wrapper.vm.onFsFiles({ target: { files: [pickedFile('odd.md', 'x')] } });
  await settled(wrapper);

  expect(wrapper.vm.fsSplitNote).toBe('');
  expect(wrapper.find('[data-test-id="okf-input-split-note"]').exists()).toBe(false);
});
