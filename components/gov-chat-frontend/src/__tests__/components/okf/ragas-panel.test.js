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

  it('shows the corpus coverage note when the suite is capped, nothing when the corpus fit', async () => {
    // 2026-10-21: a corpus capped by the chunk budget is a property of the
    // SUITE — shown in the header, never a silent slice.
    const w = mountPanel();
    await new Promise((r) => setTimeout(r, 0));
    const base = suiteFixture();
    w.vm.suite = {
      ...base,
      payload: { ...base.payload, corpus_coverage: [{ repo_id: 'me', graph: 'G', total: 5590, used: 1600 }] }
    };
    expect(w.vm.corpusCoverageNote).toContain('1600');
    expect(w.vm.corpusCoverageNote).toContain('5590');
    w.vm.suite = {
      ...base,
      payload: { ...base.payload, corpus_coverage: [{ repo_id: 'me', graph: 'G', total: 100, used: 100 }] }
    };
    expect(w.vm.corpusCoverageNote).toBe('');
  });

  it('renders the generation sub-step line: active transform, ETA, elapsed (2026-10-20)', async () => {
    // David: "the progress bar keeps flashing by without any sense of what
    // is happening or how long it is going to take" — the KG phase now
    // streams the active transform's own bar; the panel must surface it.
    const w = mountPanel();
    await new Promise((r) => setTimeout(r, 0));
    w.vm.generateBusy = true;
    w.vm.genProgress = {
      phase: 'building-knowledge-graph',
      done: 337,
      total: 1075,
      step: 'Applying CustomNodeFilter',
      eta_s: 840,
      elapsed_s: 1830
    };
    expect(w.vm.genProgressPct).toBe(31); // 337/1075
    expect(w.vm.genProgressLabel).toContain('337/1075');
    const detail = w.vm.genProgressDetail;
    expect(detail).toContain('Applying CustomNodeFilter');
    expect(detail).toContain('14 min');
    expect(detail).toContain('31 min');
    // durations: under a minute, plain minutes, hours+minutes, NaN-safe
    expect(w.vm.fmtDuration(20)).toContain('minute');
    expect(w.vm.fmtDuration(2700)).toContain('45');
    expect(w.vm.fmtDuration(7500)).toContain('2');
    expect(w.vm.fmtDuration(7500)).toContain('5');
    expect(w.vm.fmtDuration(NaN)).toBe('');
    // no sub-step payload yet → the detail line is just the elapsed clock
    w.vm.genProgress = { phase: 'building-knowledge-graph', elapsed_s: 60 };
    expect(w.vm.genProgressDetail).toContain('1');
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

  // David 2026-10-19: every result chart carries an ⓘ with the metric's
  // plain-language RAGAS meaning — honest about what each metric CANNOT see.
  it('every metric gauge carries its RAGAS note via the info tip', async () => {
    const w = mountPanel();
    await new Promise((r) => setTimeout(r, 0));
    w.vm.runDoc = runFixture();
    await w.vm.$nextTick();
    expect(w.vm.aggregateRows.length).toBeGreaterThan(0);
    const tips = w.findAllComponents({ name: 'DsInfoTip' });
    expect(tips.length).toBeGreaterThanOrEqual(w.vm.aggregateRows.length);
    expect(w.vm.metricNote('answer_relevancy')).toMatch(/does NOT check factual correctness/i);
    expect(w.vm.metricNote('noise_sensitivity')).toMatch(/LOWER is better/i);
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

  // David 2026-10-19: "how does the admin user know what possible actions
  // they can take" — the advisor travels with the run. A persisted explain
  // loads automatically; when rows fail with NO advisor output yet, the
  // banner points at it instead of making the admin discover the button.
  it('auto-loads the persisted explain with the run — advisor visible without a click', async () => {
    dispatch.mockImplementation(async (action) => {
      if (action === 'okf/fetchRepos') return { ok: true, repos: [] };
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
              created_at: '2026-10-17T11:00:00.000Z',
              entries: 2
            }
          ]
        };
      if (action === 'okf/ragasGetSuite') return { ok: true, result: suiteFixture() };
      if (action === 'okf/ragasGetRunQuiet') return { ok: true, result: runFixture() };
      if (action === 'okf/ragasGetExplainQuiet')
        return {
          ok: true,
          result: {
            attributions: [
              {
                id: 'new-1',
                query: 'q',
                fails: ['context_recall'],
                stage: 'corpus',
                recommendation: 're-curate the concept'
              }
            ],
            advice: { knob_changes: [], repo_tag_changes: [], content_curation: [], prompt_tweaks: [] }
          }
        };
      return { ok: true, result: null, runs: [] };
    });
    const w = mountPanel();
    await new Promise((r) => setTimeout(r, 0));
    expect(dispatch).toHaveBeenCalledWith(
      'okf/ragasGetExplainQuiet',
      expect.objectContaining({ runKey: 'rr1-run', suiteKey: 'rs1-test' })
    );
    expect(w.vm.explainDoc).toBeTruthy();
    // advisor output rendered without any click; hint suppressed (output on screen)
    expect(w.text()).toContain('Failure attribution and advice');
    expect(w.text()).toContain('re-curate the concept');
    expect(w.find('.okf-ragas__advisor-hint').exists()).toBe(false);
  });

  it('shows the advisor hint when rows fail and no advisor output is loaded', async () => {
    const w = mountPanel();
    await new Promise((r) => setTimeout(r, 0));
    // default mock: run loads (failing_count 1), explain absent
    expect(w.vm.runDoc._key).toBe('rr1-run');
    expect(w.vm.explainDoc).toBeNull();
    const hint = w.find('.okf-ragas__advisor-hint');
    expect(hint.exists()).toBe(true);
    expect(hint.text()).toContain('1');
    expect(hint.text().toLowerCase()).toContain('advisor');
  });

  // David 2026-10-21: explain showed a dead button for minutes while the
  // advisor call thought. The phase + failing count + elapsed must render.
  it('explain in flight shows the advisor phase, failing count and elapsed clock', async () => {
    const w = mountPanel();
    await new Promise((r) => setTimeout(r, 0));
    w.vm.runDoc = runFixture();
    w.vm.explainBusy = true;
    w.vm.explainProgress = { phase: 'advising', failing: 12, elapsed_s: 185 };
    await w.vm.$nextTick();
    const line = w.find('.okf-ragas__explain-progress');
    expect(line.exists()).toBe(true);
    // DsSpinner is stubbed slot-less in this harness — assert on the label
    // computed the template feeds it.
    expect(w.vm.explainProgressLabel).toContain('12');
    expect(w.vm.explainProgressLabel).toContain('3 min');
    w.vm.explainProgress = { phase: 'guarding', failing: 12, elapsed_s: 200 };
    await w.vm.$nextTick();
    expect(w.vm.explainProgressLabel).toContain('Guarding');
    w.vm.explainBusy = false;
    await w.vm.$nextTick();
    expect(w.find('.okf-ragas__explain-progress').exists()).toBe(false);
  });

  // David 2026-10-19: the results table must be resizable and the answers
  // copyable (suite-table parity), and the full answer text is present —
  // not a 60-char ellipsis.
  it('results table: full answers in copyable cells, per-column resize grips', async () => {
    const w = mountPanel();
    await new Promise((r) => setTimeout(r, 0));
    w.vm.runDoc = runFixture();
    await w.vm.$nextTick();
    const ta = w.find('textarea.okf-ragas__answer-text');
    expect(ta.exists()).toBe(true);
    expect(ta.element.value).toBe('Plant after the last frost.'); // FULL answer
    expect(w.vm.resultCols.length).toBe(2 + 4 + 1 + 1); // id, query, 4 metrics, answer, state
    expect(w.findAll('.okf-ragas__col-grip').length).toBe(w.vm.resultCols.length);
    // column resize lands on the colgroup
    w.vm.colWidths = { 'm:context_recall': 140 };
    await w.vm.$nextTick();
    expect(w.vm.colStyle('m:context_recall')).toEqual({ width: '140px' });
    // copy gesture flips the row button to ✓
    const writeText = jest.fn().mockResolvedValue();
    Object.assign(navigator, { clipboard: { writeText } });
    await w.vm.copyAnswer(w.vm.runDoc.payload.results[0]);
    expect(writeText).toHaveBeenCalledWith('Plant after the last frost.');
    expect(w.vm.copiedId).toBe('new-1');
  });

  // David 2026-10-21: "once a model is selected for a specific generation or
  // execution of a benchmark, the system must remember which model was
  // selected and used" — the judge selector restores from the suite's
  // recorded pick on reopen instead of resetting to the deployment default.
  describe('judge pick memory', () => {
    const flush = () => new Promise((r) => setTimeout(r, 0));

    function pickDispatch({ configs, models, runs, run, suite, getRun }) {
      return async (action, payload) => {
        if (action === 'okf/modelConfigList') return { ok: true, configs };
        if (action === 'okf/modelConfigModels') return { ok: true, models: (models && models[payload.key]) || [] };
        if (action === 'okf/ragasListRuns') return { ok: true, runs: runs || [] };
        if (action === 'okf/ragasGetSuite') return { ok: true, result: suite || suiteFixture() };
        if (action === 'okf/ragasGetRunQuiet') return { ok: true, result: getRun ? getRun() : run || runFixture() };
        if (action === 'okf/fetchRepos') return { ok: true, repos: [] };
        return { ok: true, result: null, runs: [] };
      };
    }

    it('reopening restores the generation pick recorded on the suite', async () => {
      const suite = suiteFixture();
      suite.payload.judge_pick = { config_key: 'mm', model: 'mm-large' };
      dispatch.mockImplementation(
        pickDispatch({
          suite,
          configs: [{ _key: 'mm', name: 'MiniMax', active: false }],
          models: { mm: ['mm-small', 'mm-large'] },
          runs: [
            // a run row WITHOUT a pick — the generation pick is the source
            {
              kind: 'ragas_run',
              _key: 'rr1-run',
              suite_key: 'rs1-test',
              status: 'done',
              created_at: '2026-10-17T12:00:00.000Z'
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
        })
      );
      const w = mountPanel();
      await flush();
      await flush();
      expect(w.vm.judgeConfigKey).toBe('mm');
      expect(w.vm.judgeModel).toBe('mm-large');
    });

    it('a config deleted since the pick falls back to the deployment default', async () => {
      const suite = suiteFixture();
      suite.payload.judge_pick = { config_key: 'mm', model: 'mm-large' };
      dispatch.mockImplementation(
        pickDispatch({
          configs: [{ _key: 'other', name: 'Other', active: false }],
          runs: []
        })
      );
      const w = mountPanel();
      await flush();
      await flush();
      expect(w.vm.judgeConfigKey).toBe('');
      expect(w.vm.judgeModel).toBe('');
    });

    it('the latest run pick wins over the generation pick (run-over-run comparability)', async () => {
      const suite = suiteFixture();
      suite.payload.judge_pick = { config_key: 'mm', model: 'mm-large' };
      dispatch.mockImplementation(
        pickDispatch({
          configs: [
            { _key: 'mm', name: 'MiniMax', active: false },
            { _key: 'zz', name: 'z.ai', active: false }
          ],
          models: { mm: ['mm-large'], zz: ['zz-1'] },
          runs: [
            {
              kind: 'ragas_run',
              _key: 'rr1-run',
              suite_key: 'rs1-test',
              status: 'done',
              created_at: '2026-10-17T12:00:00.000Z',
              judge_pick: { config_key: 'zz', model: 'zz-1' }
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
        })
      );
      const w = mountPanel();
      await flush();
      await flush();
      expect(w.vm.judgeConfigKey).toBe('zz');
      expect(w.vm.judgeModel).toBe('zz-1');
    });

    it('viewing a run restores THAT run pick — the selector mirrors the results on screen', async () => {
      const suite = suiteFixture();
      suite.payload.judge_pick = { config_key: 'mm', model: 'mm-large' };
      // The latest run loads WITHOUT a pick at mount (generation pick
      // applies); clicking a run whose fidelity carries a pick switches the
      // selector to that run's judge.
      let runResult = runFixture();
      dispatch.mockImplementation(
        pickDispatch({
          suite,
          configs: [
            { _key: 'mm', name: 'MiniMax', active: false },
            { _key: 'zz', name: 'z.ai', active: false }
          ],
          models: { mm: ['mm-large'], zz: ['zz-1'] },
          runs: [
            {
              kind: 'ragas_run',
              _key: 'rr1-run',
              suite_key: 'rs1-test',
              status: 'done',
              created_at: '2026-10-17T12:00:00.000Z'
            },
            {
              kind: 'ragas_suite',
              _key: 'rs1-test',
              suite_key: 'rs1-test',
              name: 'Agri benchmark',
              created_at: '2026-10-17T11:00:00.000Z',
              entries: 2
            }
          ],
          getRun: () => runResult
        })
      );
      const w = mountPanel();
      await flush();
      await flush();
      expect(w.vm.judgeConfigKey).toBe('mm'); // suite pick first…
      runResult = runFixture();
      runResult.payload.fidelity = {
        judge: { source: 'picked', config: 'z.ai', model: 'zz-1', pick: { config_key: 'zz', model: 'zz-1' } }
      };
      await w.vm.onLoadRun('rr1-run', 'rs1-test');
      await flush();
      expect(w.vm.judgeConfigKey).toBe('zz'); // …then the viewed run's pick
      expect(w.vm.judgeModel).toBe('zz-1');
    });
  });

  // 2026-10-21 review C1: a run whose answers all errored rendered as
  // normal-looking zeros (or an "all passing" pill) — the admin read a
  // broken run as a failing system. The banner states the truth.
  describe('invalid run honesty', () => {
    const flush = () => new Promise((r) => setTimeout(r, 0));
    it('a run with errored rows is flagged invalid (not a measurement)', async () => {
      const bad = runFixture();
      bad.payload.summary.n_errors = 2;
      dispatch.mockImplementation(async (action) => {
        if (action === 'okf/fetchRepos') return { ok: true, repos: [{ repo_id: 'me', name: 'Agri', head: {} }] };
        if (action === 'okf/ragasListRuns')
          return {
            ok: true,
            runs: [
              {
                kind: 'ragas_run',
                _key: 'rr1-run',
                suite_key: 'rs1-test',
                status: 'done',
                created_at: '2026-10-17T12:00:00.000Z'
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
        if (action === 'okf/ragasGetRunQuiet') return { ok: true, result: bad };
        return { ok: true, result: null, runs: [] };
      });
      const w = mountPanel();
      await flush();
      await flush();
      expect(w.vm.invalidRunReason).toBeTruthy();
      expect(w.vm.invalidRunReason).toMatch(/2/);
      expect(w.text()).toContain('not a valid measurement');
    });

    it('a run the judge measured only partially is flagged invalid', async () => {
      const partial = runFixture();
      partial.payload.coverage = { measured_rows: 1, total_rows: 2, per_metric: { faithfulness: 1 } };
      dispatch.mockImplementation(async (action) => {
        if (action === 'okf/fetchRepos') return { ok: true, repos: [{ repo_id: 'me', name: 'Agri', head: {} }] };
        if (action === 'okf/ragasListRuns')
          return {
            ok: true,
            runs: [
              {
                kind: 'ragas_run',
                _key: 'rr1-run',
                suite_key: 'rs1-test',
                status: 'done',
                created_at: '2026-10-17T12:00:00.000Z'
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
        if (action === 'okf/ragasGetRunQuiet') return { ok: true, result: partial };
        return { ok: true, result: null, runs: [] };
      });
      const w = mountPanel();
      await flush();
      await flush();
      expect(w.vm.invalidRunReason).toBeTruthy();
      expect(w.vm.invalidRunReason).toMatch(/1/);
    });

    it('a clean run is NOT flagged invalid', async () => {
      const w = mountPanel();
      await flush();
      await flush();
      expect(w.vm.invalidRunReason).toBe('');
    });
  });
});
