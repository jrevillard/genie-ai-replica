'use strict';

/**
 * Story 7.7 — documents → ONE OKF repository.
 *
 * ImportDocumentsDialog: the preflight list (serving / already-in-OKF badges,
 * servingWarn count), the submit payload and the DUPLICATE_REPO error path.
 * ConceptList provenance deep links: a document source (file_id) renders and
 * clicking it either pushes the ?tab=documents&file= route query (when a
 * router is present) or emits 'open-source' (Studio-embedded fallback).
 */

const { mount } = require('@vue/test-utils');

const mockImportDocuments = jest.fn();
jest.mock('@/services/repoOkfService', () => ({
  __esModule: true,
  default: { importDocuments: (p) => mockImportDocuments(p) }
}));

// Shared translate-less mount mocks: translateMixin falls back to the inline
// English default when $i18n is absent, which is exactly what we assert on.
function fakeStore() {
  const dispatched = [];
  return {
    dispatched,
    getters: {
      'okf/editorSubTab': 'editor',
      'okf/repoById': () => ({ repo_id: 'r-1', name: 'Repo One', lifecycle_state: 'draft' })
    },
    commit() {},
    dispatch() {
      return Promise.resolve({ ok: true });
    }
  };
}

function mountWith(component, props, extraMocks) {
  return mount(component, {
    global: { mocks: Object.assign({ $store: fakeStore() }, extraMocks || {}) },
    props
  });
}

const ImportDocumentsDialog = require('@/components/okf/editor/ImportDocumentsDialog.vue').default;
const ConceptList = require('@/components/okf/editor/ConceptList.vue').default;

describe('ImportDocumentsDialog', () => {
  const docs = [
    { _key: 'f-1', file_name: 'policy.pdf', dataprep: { status: 'Pending' }, okf_repo_id: null },
    { _key: 'f-2', file_name: 'data.xlsx', dataprep: { status: 'Ingested' }, okf_repo_id: null },
    { _key: 'f-3', file_name: 'old.md', dataprep: { status: 'Retracted' }, okf_repo_id: 'r-other' }
  ];

  it('renders the preflight with serving + already badges and the warn count', () => {
    const wrapper = mountWith(ImportDocumentsDialog, { visible: true, documents: docs }, {});
    const text = wrapper.text();
    expect(text).toContain('policy.pdf');
    expect(text).toContain('serving free-form RAG'); // f-2 still serves the corpus
    expect(text).toContain('already in an OKF repo'); // f-3 sourced elsewhere
    expect(text).toContain('1 document(s) still serve the free-form corpus'); // {n} replaced (only f-2 serves)
  });

  it('disables Import until a name is entered', async () => {
    const wrapper = mountWith(ImportDocumentsDialog, { visible: true, documents: docs }, {});
    const go = () => wrapper.findAll('button')[1];
    expect(go().attributes('disabled')).toBeDefined();
    await wrapper.find('input').setValue('Policy pack');
    expect(go().attributes('disabled')).toBeUndefined();
  });

  it('submits file_ids + name + domain + classification and emits imported', async () => {
    mockImportDocuments.mockResolvedValueOnce({ repo_id: 'r-new', name: 'Policy pack' });
    const wrapper = mountWith(ImportDocumentsDialog, { visible: true, documents: docs }, {});
    await wrapper.find('input').setValue('Policy pack');
    await wrapper.findAll('button')[1].trigger('click');
    await Promise.resolve();
    expect(mockImportDocuments).toHaveBeenCalledWith({
      file_ids: ['f-1', 'f-2', 'f-3'],
      name: 'Policy pack',
      domain: 'general',
      classification: 'heuristics'
    });
    expect(wrapper.emitted('imported')).toEqual([[{ repo_id: 'r-new', name: 'Policy pack' }]]);
  });

  it('maps DUPLICATE_REPO to the pick-another-name message', async () => {
    const err = new Error('dup');
    err.code = 'DUPLICATE_REPO';
    mockImportDocuments.mockRejectedValueOnce(err);
    const wrapper = mountWith(ImportDocumentsDialog, { visible: true, documents: docs }, {});
    await wrapper.find('input').setValue('Policy pack');
    await wrapper.findAll('button')[1].trigger('click');
    await Promise.resolve();
    expect(wrapper.text()).toContain('already exists');
  });
});

describe('ConceptList provenance deep links (Story 7.7)', () => {
  const rows = [
    {
      concept_id: 'c-1',
      title: 'Data sheet',
      index_status: 'indexed',
      sources: [
        {
          resource: 'http://docrepo/api/files/f-9',
          file_id: 'f-9',
          file_name: 'data.xlsx',
          locator: 'sheet "Sheet1" rows 1–200'
        }
      ]
    }
  ];

  it('renders the document source on the row and pushes the deep link', async () => {
    const push = jest.fn().mockResolvedValue(undefined);
    const wrapper = mountWith(
      ConceptList,
      { concepts: rows },
      { $router: { push }, $route: { query: { tab: 'documents' } } }
    );
    const link = wrapper.find('.okf-cl__row .okf-cl__row-source');
    expect(link.exists()).toBe(true);
    await link.trigger('click');
    expect(push).toHaveBeenCalledWith({
      query: { tab: 'documents', file: 'f-9' }
    });
  });

  it('emits open-source when no router is available (Studio fallback)', async () => {
    const wrapper = mountWith(ConceptList, { concepts: rows }, {});
    const link = wrapper.find('.okf-cl__row .okf-cl__row-source');
    expect(link.exists()).toBe(true);
    await link.trigger('click');
    expect(wrapper.emitted('open-source')).toEqual([['f-9']]);
  });
});
