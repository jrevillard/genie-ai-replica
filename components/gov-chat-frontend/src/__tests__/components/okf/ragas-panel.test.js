// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Story 8-6 — RagasPanel behavior tests, on the head-test-dialog mount
// pattern: store-dispatch mocking, fixture builders, and the panel's
// compute wiring (metric rows, trend, advice chips, progress label).

import { mount } from '@vue/test-utils';
import RagasPanel from '@/components/okf/editor/RagasPanel.vue';

jest.mock('@/services/ragasService', () => ({
  __esModule: true,
  default: {
    generateSuite: jest.fn(),
    getSuite: jest.fn(),
    updateSuiteRows: jest.fn(),
    addQueries: jest.fn(),
    renameSuite: jest.fn(),
    deleteSuite: jest.fn(),
    runSuite: jest.fn(),
    getRun: jest.fn(),
    listRuns: jest.fn(),
    probeEntry: jest.fn(),
    explainFailures: jest.fn(),
    getExplain: jest.fn(),
    exportSuite: jest.fn(),
    importSuite: jest.fn(),
    exportResults: jest.fn()
  }
}));
jest.mock('@/composables/useChartTheme', () => ({
  useChartTheme: () => ({
    getCssVarStrings: () => ({ fg: '#fff', border: '#333', chartColors: ['#1f6feb', '#2ecc71', '#e67e22', '#e74c3c'] })
  })
}));

const dispatch = jest.fn();

function suiteFixture() {
  return {
    kind: 'ragas_suite',
    suite_key: 'rs1-test',
    repo_ids: ['me', 'other'],
    name: 'Agri benchmark',
    payload: {
      generator: 'ragas:m',
      entries: [
        {
          id: 'new-1',
          query: 'What seasons apply to tomato planting?',
          reference_answer: 'After the last frost.',
          reference_passages: ['Plant after the last frost date.'],
          oos: false
        },
        { id: 'new-2', query: 'Capital of France?', reference_answer: '', reference_passages: [], oos: true }
      ],
      metrics_config: ['faithfulness', 'context_precision', 'context_recall', 'answer_relevancy']
    }
  };
}

function runFixture() {
  return {
    _key: 'rr1-run',
    kind: 'ragas_run',
    status: 'done',
    suite_key: 'rs1-test',
    metrics: ['faithfulness', 'context_precision', 'context_recall', 'answer_relevancy'],
    created_at: '2026-10-17T12:00:00.000Z',
    payload: {
      summary: {
        n: 2,
        n_errors: 0,
        n_abstained: 1,
        n_evaluable: 1,
        failing_count: 1,
        failing: [{ id: 'new-1', query: 'What seasons apply…', fails: ['context_recall'] }],
        metrics: { faithfulness: 0.9, context_precision: 0.8, context_recall: 0.4, answer_relevancy: 0.7 }
      },
      results: [
        {
          id: 'new-1',
          query: 'What seasons apply to tomato planting?',
          answer: 'Plant after the last frost.',
          abstained: false,
          error: null,
          metrics: { faithfulness: 0.9, context_precision: 0.8, context_recall: 0.4, answer_relevancy: 0.7 }
        },
        { id: 'new-2', query: 'Capital of France?', answer: '', abstained: true, error: null, metrics: {} }
      ]
    }
  };
}

function fakeStore() {
  return {
    dispatch: (action, payload) => dispatch(action, payload),
    state: { okf: {} }
  };
}

function mountPanel(props = {}) {
  return mount(RagasPanel, {
    props: { repo: { repo_id: 'me', name: 'Agri' }, readOnly: false, ...props },
    global: {
      mocks: { $store: fakeStore() },
      stubs: {
        DsButton: { template: '<button><slot /></button>' },
        DsPill: { props: ['label', 'variant'], template: '<span class="pill">{{ label }}</span>' },
        DsSpinner: true,
        DsProgress: true,
        apexchart: { props: ['options', 'series', 'type', 'height'], template: '<div class="chart-stub" />' }
      }
    }
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  dispatch.mockReset();
  // Default: fetchRepos + ragasListRuns succeed with the fixtures.
  dispatch.mockImplementation(async (action) => {
    if (action === 'okf/fetchRepos')
      return {
        ok: true,
        repos: [
          { repo_id: 'me', name: 'Agri', head: {} },
          { repo_id: 'other', name: 'Legal', head: {} }
        ]
      };
    if (action === 'okf/ragasListRuns')
      return {
        ok: true,
        runs: [
          {
            kind: 'ragas_run',
            _key: 'rr1-run',
            suite_key: 'rs1-test',
            status: 'done',
            created_at: '2026-10-17T12:00:00.000Z',
            summary: runFixture().payload.summary
          },
          {
            kind: 'ragas_suite',
            _key: 'rs1-test',
            suite_key: 'rs1-test',
            name: 'Agri benchmark',
            created_at: '2026-10-17T11:00:00.000Z',
            entries: 2
          }
        ]
      };
    if (action === 'okf/ragasGetSuite') return { ok: true, result: suiteFixture() };
    if (action === 'okf/ragasGetRunQuiet') return { ok: true, result: runFixture() };
    return { ok: true, result: null, runs: [] };
  });
});

describe('RagasPanel', () => {
  it('mounts, loads choices + the latest suite, and renders the entries table', async () => {
    const w = mountPanel();
    await new Promise((r) => setTimeout(r, 0));
    expect(dispatch).toHaveBeenCalledWith('okf/fetchRepos', { silent: true });
    expect(w.vm.entries).toHaveLength(2);
    expect(w.vm.suite.suite_key).toBe('rs1-test');
    expect(w.text()).toContain('What seasons apply to tomato planting?');
    expect(w.text()).toContain('RAGAS');
  });

  it('selects the current repo by default and disables its checkbox', async () => {
    const w = mountPanel();
    await new Promise((r) => setTimeout(r, 0));
    expect(w.vm.selectedRepoIds).toEqual(['me']);
    const boxes = w.findAll('input[type="checkbox"]');
    // repo checkboxes for me + other, plus 10 metric checkboxes
    const meBox = boxes.find((b) => b.attributes('value') === 'me');
    expect(meBox.attributes('disabled')).toBeDefined();
  });

  it('runs the benchmark through the store and renders the run + charts', async () => {
    dispatch.mockImplementation(async (action) => {
      if (action === 'okf/ragasRun') return { ok: true, result: runFixture() };
      if (action === 'okf/ragasListRuns')
        return {
          ok: true,
          runs: [
            {
              kind: 'ragas_run',
              _key: 'rr1-run',
              suite_key: 'rs1-test',
              status: 'done',
              created_at: '2026-10-17T12:00:00.000Z',
              summary: runFixture().payload.summary
            }
          ]
        };
      if (action === 'okf/fetchRepos') return { ok: true, repos: [] };
      if (action === 'okf/ragasGetSuite') return { ok: true, result: suiteFixture() };
      return { ok: true, result: null, runs: [] };
    });
    const w = mountPanel();
    await new Promise((r) => setTimeout(r, 0));
    await w.vm.onRun();
    expect(dispatch).toHaveBeenCalledWith(
      'okf/ragasRun',
      expect.objectContaining({ suiteKey: 'rs1-test', metrics: expect.arrayContaining(['faithfulness']) })
    );
    expect(w.vm.runDoc._key).toBe('rr1-run');
    // aggregate gauges for the four scored metrics
    expect(w.vm.aggregateRows.map((g) => g.key)).toEqual([
      'faithfulness',
      'context_precision',
      'context_recall',
      'answer_relevancy'
    ]);
    expect(w.findAll('.chart-stub').length).toBeGreaterThan(0);
    // the failing row is flagged in the summary pill
    expect(w.text()).toContain('failing');
  });

  it('flips an entry in-scope/out-of-scope via the rows endpoint', async () => {
    const w = mountPanel();
    await new Promise((r) => setTimeout(r, 0));
    await w.vm.onFlipEntry(w.vm.entries[0]);
    expect(dispatch).toHaveBeenCalledWith(
      'okf/ragasUpdateRows',
      expect.objectContaining({ payload: { modifications: [{ id: 'new-1', flip_oos: true }] } })
    );
  });

  it('renders explain attributions and guarded advice chips', async () => {
    const w = mountPanel();
    await new Promise((r) => setTimeout(r, 0));
    w.vm.explainDoc = {
      attributions: [
        {
          id: 'new-1',
          query: 'q',
          fails: ['context_recall'],
          stage: 'reranker',
          recommendation: 'raise RERANKER_TOP_N'
        }
      ],
      advice: {
        knob_changes: ['raise RERANKER_TOP_N'],
        repo_tag_changes: ['tomato-season'],
        content_curation: [{ concept: 'c1', gap: 'missing frost dates' }],
        prompt_tweaks: [],
        note: ''
      }
    };
    await w.vm.$nextTick();
    expect(w.text()).toContain('reranker');
    expect(w.text()).toContain('raise RERANKER_TOP_N');
    expect(w.text()).toContain('tomato-season');
    expect(w.text()).toContain('missing frost dates');
  });

  it('formats progress labels with the phase and counts', () => {
    const w = mountPanel();
    w.vm.runProgress = { phase: 'retrieval', done: 3, total: 10 };
    expect(w.vm.progressPct).toBe(30);
    expect(w.vm.runProgressLabel).toContain('3/10');
  });

  it('maps scores and bars honestly (NaN and null render as —)', () => {
    const w = mountPanel();
    expect(w.vm.scoreText(0.42)).toBe('0.42');
    expect(w.vm.scoreText(null)).toBe('—');
    expect(w.vm.scoreText(NaN)).toBe('—');
    expect(w.vm.barWidth(0.9)).toBe('90%');
    expect(w.vm.barWidth(null)).toBe('0%');
  });

  // Live incident 2026-10-18: the page lost a running generation to a
  // refresh, then a second Generate attempt dead-ended on the 409. The 409
  // must ATTACH to the running generation (progress + Cancel), not error.
  it('a GENERATION_IN_FLIGHT 409 attaches to the running generation instead of erroring', async () => {
    const live = {
      kind: 'ragas_suite',
      _key: 'rs-live',
      suite_key: 'rs-live',
      status: 'generating',
      created_at: '2026-10-18T16:23:00.000Z',
      progress: { phase: 'synthesizing-questions', done: 1, total: 5 }
    };
    dispatch.mockImplementation(async (action, payload) => {
      if (action === 'okf/fetchRepos') return { ok: true, repos: [] };
      if (action === 'okf/ragasListRuns') {
        // mount's history sweep (kind:all) sees only completed suites;
        // the adoption lookup (kind:ragas_suite) surfaces the live row —
        // exactly the server's synthetic in-flight listing.
        if (payload && payload.kind === 'ragas_suite') return { ok: true, runs: [live] };
        return {
          ok: true,
          runs: [
            {
              kind: 'ragas_suite',
              _key: 'rs1-test',
              suite_key: 'rs1-test',
              name: 'Agri',
              created_at: '2026-10-17T11:00:00.000Z',
              entries: 2
            }
          ]
        };
      }
      if (action === 'okf/ragasGenerate')
        return {
          ok: false,
          code: 'GENERATION_IN_FLIGHT',
          message: 'a benchmark-suite generation is already running for this repository'
        };
      if (action === 'okf/ragasGetSuite') {
        if (payload && payload.suiteKey === 'rs-live')
          return { ok: true, result: { suite_key: 'rs-live', status: 'generating', progress: live.progress } };
        return { ok: true, result: suiteFixture() };
      }
      // In reality the adoption polls until the generation lands — a
      // pending promise keeps it "in flight" so the busy state persists.
      if (action === 'okf/ragasAdoptGeneration') return new Promise(() => {});
      return { ok: true, result: null, runs: [] };
    });
    const w = mountPanel();
    await new Promise((r) => setTimeout(r, 0));
    expect(w.vm.generatingKey).toBeNull(); // mount did NOT adopt (no live row in history)

    await w.vm.onGenerate();

    expect(dispatch).toHaveBeenCalledWith('okf/ragasAdoptGeneration', expect.objectContaining({ suiteKey: 'rs-live' }));
    // Attached: the adoption owns the busy state — progress + Cancel visible.
    expect(w.vm.generateBusy).toBe(true);
    expect(w.vm.generatingKey).toBe('rs-live');
    expect(w.vm.genProgress).toEqual(live.progress);
    expect(w.vm.error).toBe('');
  });
});
