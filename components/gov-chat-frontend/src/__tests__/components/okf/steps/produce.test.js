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
  mockListConcepts
    .mockResolvedValueOnce(Array.from({ length: 10 }, () => ({})))
    .mockResolvedValueOnce(Array.from({ length: 14 }, () => ({}))) // account after c1
    .mockResolvedValueOnce(Array.from({ length: 20 }, () => ({}))); // account after c2
  mockGet.mockResolvedValue(convState('done'));

  const wrapper = mountProduce({
    repo_id: 'r1',
    source: 'crawl',
    input: {
      document_ids: ['c1', 'c2'],
      document_names: [
        { file_id: 'c1', file_name: 'naat.digital_full_crawl.md', source: 'crawl' },
        { file_id: 'c2', file_name: 'example.org_full_crawl.md', source: 'crawl' }
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
  expect(last.source_log).toHaveLength(2);
  expect(wrapper.emitted('gate').pop()[0]).toBe(true);
});

it('A2: dispatch keys on each file ORIGIN, not the draft variant (mixed picks)', async () => {
  // A crawl file picked in a documents draft MUST go through the crawl
  // converter (slug identity), an upload through the documents batch —
  // the variant-keyed dispatch silently mis-converted mixed picks.
  mockListConcepts.mockResolvedValue([1, 2]);
  mockGet.mockResolvedValue(convState('done'));
  const wrapper = mountProduce({
    repo_id: 'r1',
    source: 'documents',
    input: {
      document_ids: ['c1', 'f1'],
      document_names: [
        { file_id: 'c1', file_name: 'site_crawl.md', source: 'crawl' },
        { file_id: 'f1', file_name: 'report.pdf' }
      ]
    }
  });
  await settled(wrapper, 5);
  expect(mockConvertFromCrawl).toHaveBeenCalledTimes(1);
  expect(mockConvertFromCrawl).toHaveBeenCalledWith(expect.objectContaining({ file_id: 'c1' }));
  expect(mockImportDocuments).toHaveBeenCalledTimes(1);
  expect(mockImportDocuments).toHaveBeenCalledWith(expect.objectContaining({ file_ids: ['f1'] }));
  expect(wrapper.vm.status).toBe('done');
});

it('B1: a SEEDED handoff draft (ids, no names rows) routes by the draft VARIANT', async () => {
  // The crawler→wizard handoff seeds document_ids WITHOUT names rows. A
  // crawl-variant draft's unstamped ids are crawl files — defaulting them
  // to the documents batch heading-segments them and destroys per-URL slug
  // identity (the verifier's blocker).
  mockListConcepts.mockResolvedValue([1, 2]);
  mockGet.mockResolvedValue(convState('done'));
  const wrapper = mountProduce({
    repo_id: 'r1',
    source: 'crawl',
    input: { document_ids: ['c1'], document_names: [] }
  });
  await settled(wrapper, 5);
  expect(mockConvertFromCrawl).toHaveBeenCalledTimes(1);
  expect(mockConvertFromCrawl).toHaveBeenCalledWith(expect.objectContaining({ file_id: 'c1', split_mode: 'B' }));
  expect(mockImportDocuments).not.toHaveBeenCalled();
  expect(wrapper.vm.status).toBe('done');
});

it('B3: a resume whose queued legs are no longer selected drops the queue without kicking them', async () => {
  // Draft queue holds a stale leg (f9 was deselected mid-chain). The stale
  // leg must NEVER kick; the chain finalizes for what actually ran, and the
  // final draft write clears the queue.
  mockListConcepts.mockResolvedValue([1, 2, 3]);
  mockGet.mockResolvedValue(convState('done'));
  mockConvertFromCrawl.mockResolvedValue({});
  const wrapper = mountProduce({
    repo_id: 'r1',
    source: 'crawl',
    input: {
      document_ids: ['c1'],
      document_names: [{ file_id: 'c1', file_name: 'a.md', source: 'crawl' }],
      conversion_kicked: true,
      convert_queue: [{ k: 'c', id: 'f9' }]
    }
  });
  await settled(wrapper, 5);
  expect(mockConvertFromCrawl).not.toHaveBeenCalled();
  const last = wrapper.emitted('update').pop()[0].input;
  expect(last.convert_queue).toEqual([]);
  expect(wrapper.vm.status).toBe('done');
});

it('A3: a MID-CHAIN kick failure fails the step and reopens the gate (never wedged running)', async () => {
  // Leg c1 completes; the c2 kick rejects with a non-in-flight error —
  // before the guard this was swallowed by the poll's transient catch and
  // the step sat at "running" with Retry disabled.
  mockListConcepts
    .mockResolvedValueOnce(Array.from({ length: 10 }, () => ({})))
    .mockResolvedValueOnce(Array.from({ length: 12 }, () => ({})));
  mockConvertFromCrawl.mockResolvedValueOnce({}).mockRejectedValueOnce({ code: 'SERVER_ERROR' });
  mockGet.mockResolvedValue(convState('done'));
  const wrapper = mountProduce({
    repo_id: 'r1',
    source: 'crawl',
    input: {
      document_ids: ['c1', 'c2'],
      document_names: [
        { file_id: 'c1', file_name: 'a.md', source: 'crawl' },
        { file_id: 'c2', file_name: 'b.md', source: 'crawl' }
      ]
    }
  });
  await settled(wrapper, 5);
  expect(wrapper.vm.status).toBe('failed');
  expect(wrapper.vm.errorText).toBeTruthy();
  expect(wrapper.emitted('gate').pop()[0]).toBe(true);
});

it('B1: a conversion summary renders merge accounting (created + slug-merged)', async () => {
  mockListConcepts.mockResolvedValue(Array.from({ length: 14 }, () => ({})));
  mockGet.mockResolvedValue({
    repo_id: 'r1',
    conversion: { status: 'done', summary: { created: 4, updated: 2, skipped_dedup: 0 } }
  });
  const wrapper = mountProduce({
    repo_id: 'r1',
    source: 'crawl',
    input: { document_ids: ['c1'], document_names: [{ file_id: 'c1', file_name: 'site.md', source: 'crawl' }] }
  });
  await settled(wrapper, 4);
  expect(wrapper.vm.status).toBe('done');
  expect(wrapper.vm.sourceLog[0].stat).toContain('merged by slug');
  expect(wrapper.vm.sourceLog[0].stat).toContain('+4');
});

it('B1: the concept count EXCLUDES index meta rows', async () => {
  mockGet.mockResolvedValue(convState('done'));
  mockListConcepts.mockResolvedValue([
    { concept_id: 'index', is_index: true },
    { concept_id: 'a', is_index: false },
    { concept_id: 'b', is_index: false }
  ]);
  const wrapper = mountProduce({
    repo_id: 'r1',
    source: 'crawl',
    input: { document_ids: ['c1'], document_names: [{ file_id: 'c1', file_name: 'site.md', source: 'crawl' }] }
  });
  await settled(wrapper, 4);
  expect(wrapper.vm.conceptCount).toBe(2);
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

it("a 'queued' conversion is ACTIVE — the poll must not declare neverStarted (the PDF field bug)", async () => {
  // The server registers status 'queued' and returns 202 BEFORE the
  // background run flips it to downloading/running. The old binary check
  // treated 'queued' as "no conversion" and failed the step on the
  // IMMEDIATE first tick while the conversion ran to completion.
  jest.useFakeTimers();
  try {
    mockListConcepts.mockResolvedValue([1, 2]);
    mockGet.mockResolvedValue({ repo_id: 'r1', conversion: { status: 'queued' } });
    const wrapper = mountProduce({
      repo_id: 'r1',
      source: 'documents',
      input: { document_ids: ['f1'], document_names: [{ file_id: 'f1', file_name: 'guide.pdf' }] }
    });
    await jest.advanceTimersByTimeAsync(0); // the immediate first tick
    await settled(wrapper, 3);
    expect(wrapper.vm.status).toBe('running'); // NOT failed/neverStarted
    expect(wrapper.vm.errorText).toBe('');
    // the queued flips to done → the next interval tick finalizes
    mockGet.mockResolvedValue(convState('done'));
    await jest.advanceTimersByTimeAsync(3100);
    await settled(wrapper, 4);
    expect(wrapper.vm.status).toBe('done');
    expect(wrapper.emitted('gate').pop()[0]).toBe(true);
  } finally {
    jest.useRealTimers();
  }
});

it('a failed conversion surfaces the friendly error and reopens the gate', async () => {
  mockConvertFromCrawl.mockRejectedValue({ code: 'DUPLICATE_CONTENT' });
  mockGet.mockResolvedValue(convState('running'));
  const wrapper = mountProduce({
    repo_id: 'r1',
    source: 'crawl',
    input: { document_ids: ['c1'], document_names: [{ file_id: 'c1', file_name: 'x.md', source: 'crawl' }] }
  });
  await settled(wrapper, 4);
  expect(wrapper.vm.status).toBe('failed');
  expect(wrapper.vm.errorText).toContain('already imported into another OKF repository');
  expect(wrapper.emitted('gate').pop()[0]).toBe(true);
});
