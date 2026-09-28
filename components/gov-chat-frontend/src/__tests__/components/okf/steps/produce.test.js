'use strict';

/**
 * 3.10 T3 — Produce is DATA-driven (D6) and multi-crawl runs as a
 * sequential per-file chain with per-source merge accounting (D2):
 *   - needsProduction keys off document_ids, not the variant;
 *   - crawl sources convert ONE file per repo-scoped job; on each done
 *     the leg is accounted (+delta over the running total) and the next
 *     kicks; the queue rides the draft so a restart resumes the tail;
 *   - finalization sets converted_ids, clears the queue, opens the gate.
 */

const mockGet = jest.fn();
const mockImportDocuments = jest.fn();
const mockConvertFromCrawl = jest.fn();
const mockListConcepts = jest.fn();

jest.mock('@/services/repoOkfService', () => ({
  __esModule: true,
  default: {
    get: (...a) => mockGet(...a),
    importDocuments: (...a) => mockImportDocuments(...a),
    convertFromCrawlInto: (...a) => mockConvertFromCrawl(...a),
    listConcepts: (...a) => mockListConcepts(...a)
  }
}));

const { mount } = require('@vue/test-utils');
const Vuex = require('vuex');
const OkfStepProduce = require('@/components/okf/steps/Produce.vue').default;

function mountProduce(draft) {
  return mount(OkfStepProduce, {
    props: { draft: draft || { repo_id: 'r1' }, expert: false },
    global: {
      stubs: { DsInfoTip: true },
      plugins: [
        new Vuex.Store({
          modules: {
            okf: {
              namespaced: true,
              getters: { repoById: () => () => null },
              actions: { fetchRepos: () => ({}) }
            }
          }
        })
      ]
    }
  });
}

function convState(status) {
  return { repo_id: 'r1', conversion: { status } };
}

async function settled(wrapper, times = 3) {
  // The conversion chain is a deep promise tree (poll → tick → account →
  // next kick → poll …): drain the MICROTASK queue fully, not just Vue's
  // scheduler — a fixed nextTick count strands it mid-chain.
  for (let i = 0; i < 40; i += 1) await Promise.resolve();
  for (let i = 0; i < times; i += 1) await wrapper.vm.$nextTick();
}

beforeEach(() => {
  jest.clearAllMocks();
  mockListConcepts.mockResolvedValue([]);
});

it('production is DATA-driven: a manual-variant draft with picked sources converts (D6)', async () => {
  mockGet.mockResolvedValue(convState('done'));
  mockListConcepts.mockResolvedValue([1, 2, 3]);
  const wrapper = mountProduce({
    repo_id: 'r1',
    source: 'manual',
    input: { document_ids: ['f1'], document_names: [{ file_id: 'f1', file_name: 'a.pdf' }] }
  });
  await settled(wrapper);
  expect(wrapper.vm.needsProduction).toBe(true);
});

it('a manual-variant draft with NO sources skips production (gate open, no kick)', async () => {
  const wrapper = mountProduce({ repo_id: 'r1', source: 'manual', input: {} });
  await settled(wrapper);
  expect(wrapper.vm.needsProduction).toBe(false);
  expect(mockImportDocuments).not.toHaveBeenCalled();
  expect(mockConvertFromCrawl).not.toHaveBeenCalled();
  expect(wrapper.emitted('gate').pop()[0]).toBe(true);
});

it('multi-crawl: kicks file-by-file, accounts each leg, finalizes with converted_ids', async () => {
  // Baseline 10 topics; after c1 → 14 (+4); after c2 → 20 (+6).
  // Registered BEFORE mount — the baseline fetch consumes the first.
  mockListConcepts.mockResolvedValueOnce(new Array(10))
    .mockResolvedValueOnce(new Array(14)) // account after c1
    .mockResolvedValueOnce(new Array(20)); // account after c2
  mockGet.mockResolvedValue(convState('done'));

  const wrapper = mountProduce({
    repo_id: 'r1',
    source: 'crawl',
    input: {
      document_ids: ['c1', 'c2'],
      document_names: [
        { file_id: 'c1', file_name: 'naat.digital_full_crawl.md' },
        { file_id: 'c2', file_name: 'example.org_full_crawl.md' }
      ]
    }
  });

  await settled(wrapper, 5);

  expect(mockConvertFromCrawl).toHaveBeenCalledTimes(2);
  expect(mockConvertFromCrawl).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({ repo_id: 'r1', file_id: 'c1', split_mode: 'B' })
  );
  expect(mockConvertFromCrawl).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({ repo_id: 'r1', file_id: 'c2', split_mode: 'B' })
  );
  expect(wrapper.vm.status).toBe('done');
  expect(wrapper.vm.sourceLog.map((e) => `${e.name} ${e.stat}`)).toEqual([
    'naat.digital_full_crawl.md +4 new (total 14)',
    'example.org_full_crawl.md +6 new (total 20)'
  ]);
  const last = wrapper.emitted('update').pop()[0].input;
  expect(last.converted_ids).toEqual(['c1', 'c2']);
  expect(last.convert_queue).toEqual([]);
  expect(last.converting_id).toBeNull();
  expect(wrapper.emitted('gate').pop()[0]).toBe(true);
});

it('documents: one repo-scoped job takes ALL ids at once (no queue)', async () => {
  mockGet.mockResolvedValue(convState('done'));
  mockListConcepts.mockResolvedValue([1, 2]);
  const wrapper = mountProduce({
    repo_id: 'r1',
    source: 'documents',
    input: { document_ids: ['f1', 'f2'], document_names: [] }
  });
  await settled(wrapper, 4);
  expect(mockImportDocuments).toHaveBeenCalledTimes(1);
  expect(mockImportDocuments).toHaveBeenCalledWith(expect.objectContaining({ file_ids: ['f1', 'f2'], repo_id: 'r1' }));
  expect(mockConvertFromCrawl).not.toHaveBeenCalled();
  expect(wrapper.vm.status).toBe('done');
});

it('a failed conversion surfaces the friendly error and reopens the gate', async () => {
  mockConvertFromCrawl.mockRejectedValue({ code: 'DUPLICATE_CONTENT' });
  mockGet.mockResolvedValue(convState('running'));
  const wrapper = mountProduce({
    repo_id: 'r1',
    source: 'crawl',
    input: { document_ids: ['c1'], document_names: [{ file_id: 'c1', file_name: 'x.md' }] }
  });
  await settled(wrapper, 4);
  expect(wrapper.vm.status).toBe('failed');
  expect(wrapper.vm.errorText).toContain('already imported into another OKF repository');
  expect(wrapper.emitted('gate').pop()[0]).toBe(true);
});
