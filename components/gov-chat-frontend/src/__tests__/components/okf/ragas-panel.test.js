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
        // DsPill renders its SLOT and declares only `variant` — there is no
        // `label` prop (components/ds/Pill.vue). The stub used to declare
        // one, which made every <DsPill :label="..."> render its label in
        // tests while rendering EMPTY in the app — that is how the Stage
        // column shipped blank without a single test failing.
        DsPill: { props: ['variant'], template: '<span class="pill"><slot /></span>' },
        DsSpinner: true,
        DsProgress: true,
        // Gated on `visible` so a CLOSED dialog renders nothing (the real
        // DsDialog) while an open one exposes its slot for assertions.
        DsDialog: { props: ['visible'], template: '<div v-if="visible" class="dialog-stub"><slot /></div>' },
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

  it('reports the REPLAYS apart from the LLM calls (2026-10-26)', async () => {
    // David: "if it is replaying it should report replays not LLM calls" —
    // on a corpus generated before, the sidecar's on-disk cache answered 673
    // "LLM calls" while the remote GPU never moved. The panel must say what
    // reached the model and what the cache answered.
    const w = mountPanel();
    await new Promise((r) => setTimeout(r, 0));
    w.vm.generateBusy = true;
    w.vm.genProgress = {
      phase: 'building-knowledge-graph',
      step: 'Applying CustomNodeFilter',
      calls: 184,
      replays: 1392,
      elapsed_s: 1830
    };
    const detail = w.vm.genProgressDetail;
    expect(detail).toContain('184 LLM calls');
    expect(detail).toContain('1392 replayed from cache');
    // a FULLY replayed generation really did reach the model zero times —
    // the line says so, rather than hiding the calls segment
    w.vm.genProgress = { phase: 'building-knowledge-graph', calls: 0, replays: 1392, elapsed_s: 60 };
    expect(w.vm.genProgressDetail).toContain('0 LLM calls');
    expect(w.vm.genProgressDetail).toContain('1392 replayed from cache');
    // no replays → no replay segment (nothing to say)
    w.vm.genProgress = { phase: 'building-knowledge-graph', calls: 184, elapsed_s: 60 };
    expect(w.vm.genProgressDetail).not.toContain('replayed');
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

  // 2026-10-23: the Stage column shipped BLANK. DsPill renders its slot and
  // declares no `label` prop, so <DsPill :label="a.stage" /> put the stage
  // into $attrs and rendered nothing — while the test stub declared a
  // `label` prop the real component does not have, so every test passed.
  // The stub now mirrors the real component; this test locks the render.
  it('renders the attribution stage INSIDE the pill (not as a dropped prop)', async () => {
    const w = mountPanel();
    await new Promise((r) => setTimeout(r, 0));
    w.vm.explainDoc = {
      attributions: [
        {
          id: 'new-1',
          query: 'q',
          fails: ['context_recall'],
          stage: 'vector-recall',
          recommendation: 'raise OKF_RAGAS_CANDIDATE_K'
        }
      ],
      advice: { knob_changes: [], repo_tag_changes: [], content_curation: [], prompt_tweaks: [], note: '' }
    };
    await w.vm.$nextTick();
    const pills = w.findAll('.okf-headtest__scores .pill');
    const stages = pills.map((p) => p.text()).filter((t) => t.includes('vector-recall'));
    expect(stages.length).toBe(1);
    expect(stages[0]).toContain('vector-recall');
  });

  // A row whose expected passage is not in the corpus measures the
  // benchmark, not the assistant — the operator must be told, or they will
  // tune the pipeline for an unanswerable question.
  it('marks an unfair question (expected passage absent from the corpus)', async () => {
    const w = mountPanel();
    await new Promise((r) => setTimeout(r, 0));
    w.vm.explainDoc = {
      attributions: [
        {
          id: 'new-9',
          query: 'q',
          fails: ['context_recall'],
          stage: 'corpus',
          recommendation: 'regenerate this entry',
          unfair_question: true
        }
      ],
      advice: { knob_changes: [], repo_tag_changes: [], content_curation: [], prompt_tweaks: [], note: '' }
    };
    await w.vm.$nextTick();
    expect(w.text()).toContain('unfair question');
    // The corpus stage is a benchmark defect, not a retrieval knob.
    expect(w.vm.stageVariant('corpus')).toBe('danger');
    expect(w.vm.stageVariant('vector-recall')).toBe('warning');
    expect(w.vm.stageVariant('judge')).toBe('neutral');
  });

  // The evidence counts are shown ONLY for rows whose stage came from the
  // retrieval ladder. For the others the judge credited the content as
  // covered, so showing "0 in context" would contradict the verdict.
  it('shows the retrieval evidence only when the ladder decided the verdict', async () => {
    const w = mountPanel();
    await new Promise((r) => setTimeout(r, 0));
    w.vm.explainDoc = {
      attributions: [
        {
          id: 'new-1',
          query: 'q',
          fails: ['context_recall'],
          stage: 'vector-recall',
          recommendation: 'raise OKF_RAGAS_CANDIDATE_K',
          evidence: {
            passages: 1,
            probeable_passages: 1,
            in_corpus: 1,
            in_candidates: 0,
            in_contexts: 0,
            ladder_applied: true,
            candidate_rank: 28,
            method: 'containment(8-word needles, stride 4) + token coverage >= 0.85'
          }
        },
        {
          id: 'new-2',
          query: 'q',
          fails: ['context_precision'],
          stage: 'reranker',
          recommendation: 'noise ranked above signal',
          evidence: {
            passages: 1,
            probeable_passages: 1,
            in_corpus: 1,
            in_candidates: 0,
            in_contexts: 0,
            ladder_applied: false
          }
        }
      ],
      advice: { knob_changes: [], repo_tag_changes: [], content_curation: [], prompt_tweaks: [], note: '' }
    };
    await w.vm.$nextTick();
    // The ladder-driven row shows the counts and the rank.
    expect(w.text()).toContain('1/1 in corpus');
    expect(w.text()).toContain('rank #28');
    // The metric-driven row shows NONE — its 0/0 counts would contradict
    // the "noise ranked above signal" verdict.
    const summaries = w.findAll('.okf-ragas__muted').filter((n) => n.text().includes('in corpus'));
    expect(summaries.length).toBe(1);
    expect(w.vm.evidenceSummary(w.vm.explainDoc.attributions[1])).toContain('1/1 in corpus');
    // ...and the tooltip carries the method, so the verdict is auditable.
    expect(w.vm.evidenceTitle(w.vm.explainDoc.attributions[0])).toContain('containment');
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

  // The outcome bar's four buckets must PARTITION the rows (2026-10-25).
  // A row counted twice makes the segments sum to more than the suite, and
  // the old arithmetic (n_evaluable − n_abstained − failing_count)
  // subtracted the abstentions twice — the all-abstained runs reached −20.
  // After the judge-only-the-answered-rows fix the errored rows are NOT in
  // failing_count (they were never judged), so they are subtracted
  // explicitly.
  it('the outcome bar partitions the rows — every row counted exactly once', () => {
    const w = mountPanel();
    const doc = runFixture();
    // 10 in-scope rows: 2 errored (never judged), 1 abstained, 3 failing,
    // 4 answered. The SERVER computes the buckets over ONE population now
    // (2026-10-25) — the panel used to derive them by subtracting across
    // two, which relabelled a genuinely failing row as "answered".
    doc.payload.summary = {
      n: 10,
      n_errors: 2,
      n_abstained: 1,
      n_abstained_unjudged: 0,
      n_evaluable: 10,
      n_oos: 0,
      n_failed: 3,
      n_answered: 4,
      failing_count: 3,
      failing: [],
      metrics: {}
    };
    w.vm.runDoc = doc;
    const series = w.vm.statusSeries;
    const byName = Object.fromEntries(series.map((s) => [s.name, s.data[0]]));
    const total = series.reduce((a, s) => a + s.data[0], 0);
    expect(total).toBe(10);
    expect(byName.error).toBe(2);
    expect(byName.abstained).toBe(1);
    expect(byName.failing).toBe(3);
    expect(byName.answered).toBe(4);
    // No bucket may go negative — the all-abstained run reached −20 before.
    for (const s of series) expect(s.data[0]).toBeGreaterThanOrEqual(0);
  });

  // The case the old arithmetic got wrong (2026-10-25): a DECLINE that was
  // never judged is NOT in failing_count (it carries no metric), so
  // subtracting the abstentions from failing_count removed a row that was
  // never there — and relabelled a genuinely failing row as "answered".
  // Verified against the repo's own Arango mock: truth = answered 0,
  // abstained 1, failing 2; the old bar read answered 1, abstained 1,
  // failing 1.
  it('the bar does not subtract a decline that was never judged', () => {
    const w = mountPanel();
    const doc = runFixture();
    doc.payload.summary = {
      n: 3,
      n_errors: 0,
      n_abstained: 1,
      n_abstained_unjudged: 1,
      n_evaluable: 3,
      n_oos: 0,
      n_failed: 2,
      n_answered: 0,
      failing_count: 2,
      failing: [],
      metrics: {}
    };
    w.vm.runDoc = doc;
    const series = w.vm.statusSeries;
    const byName = Object.fromEntries(series.map((s) => [s.name, s.data[0]]));
    expect(byName.failing).toBe(2);
    expect(byName.abstained).toBe(1);
    expect(byName.answered).toBe(0);
    expect(series.reduce((a, s) => a + s.data[0], 0)).toBe(3);
  });

  // A decline that was never judged is a DIFFERENT state from one that was
  // judged, and the row pill must say so — the guide taught the second as
  // if it were the only one.
  it('labels a decline that was never judged apart from one that was', () => {
    const w = mountPanel();
    const judged = {
      id: 'r1',
      answer: 'I cannot answer that',
      abstained: true,
      judged: true,
      metrics: { faithfulness: 0 }
    };
    const unjudged = { id: 'r2', answer: '', abstained: true, judged: false, metrics: {} };
    expect(w.vm.rowJudged(judged)).toBe(true);
    expect(w.vm.rowJudged(unjudged)).toBe(false);
    // A row with no metrics and no flag (an older run) falls back to the
    // numeric-metric test.
    expect(w.vm.rowJudged({ id: 'r3', metrics: {} })).toBe(false);
    expect(w.vm.rowJudged({ id: 'r4', metrics: { faithfulness: 0 } })).toBe(true);
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
  describe('the judge the run is really using (2026-10-21)', () => {
    const flush = () => new Promise((r) => setTimeout(r, 0));

    it('"deployment default" NAMES the active configuration', async () => {
      // The run went to a personal MiniMax key while the panel said
      // "deployment default" — the operator believed the active GLM config
      // was in use. The default must never be a guess.
      const w = mountPanel();
      await flush();
      w.vm.modelConfigs = [
        { _key: 'mm', name: 'Minimax David OpenAI', active: false, default_model: 'MiniMax-M3.1-Flash' },
        { _key: 'glm', name: 'GLM-5.3 ITU - OpenAI', active: true, default_model: 'glm-5.3' }
      ];
      const label = w.vm.defaultJudgeLabel;
      expect(label).toContain('GLM-5.3 ITU - OpenAI');
      expect(label).toContain('glm-5.3');
      expect(label).not.toContain('Minimax');
    });

    it('the in-flight generation names the model it is ACTUALLY using', async () => {
      const w = mountPanel();
      await flush();
      w.vm.generateBusy = true;
      w.vm.genProgress = {
        phase: 'building-knowledge-graph',
        done: 0,
        total: 1075,
        judge: { source: 'picked', config: 'Minimax David OpenAI', model: 'MiniMax-M3.1-Flash' }
      };
      const label = w.vm.effectiveGenerationLabel;
      expect(label).toContain('Minimax David OpenAI');
      expect(label).toContain('MiniMax-M3.1-Flash');
      // and it is RENDERED, not just computed
      await w.vm.$nextTick();
      expect(w.text()).toContain('Minimax David OpenAI');
    });

    it('a pick the dropdown cannot display is dropped, never sent silently', async () => {
      // The v-model/select desync: the state held a key with no matching
      // option, so the browser showed "deployment default" while the
      // request carried the stale key. A list change that removes the key
      // must clear it.
      const w = mountPanel();
      await flush();
      w.vm.judgeConfigKey = 'mm';
      w.vm.judgeModel = 'MiniMax-M3.1-Flash';
      await w.setData({ modelConfigs: [{ _key: 'glm', name: 'GLM-5.3 ITU - OpenAI', active: true }] });
      expect(w.vm.judgeConfigKey).toBe('');
      expect(w.vm.judgeModel).toBe('');
    });

    // David 2026-10-25: "DO NOT CONFUSE GENERATION WITH JUDGING/BENCHMARKING".
    // Generating a suite and scoring it are two operations with two models.
    // They shared ONE v-model, so the panel could not express "generate with
    // A, score with B" — and a pick made for one silently governed the other.
    it('the GENERATION pick and the JUDGE pick are independent controls', async () => {
      const w = mountPanel();
      await flush();
      w.vm.modelConfigs = [
        { _key: 'mm', name: 'Minimax David OpenAI', active: false, default_model: 'MiniMax-M3.1-Flash' },
        { _key: 'glm', name: 'GLM-5.3 ITU - OpenAI', active: true, default_model: 'glm-5.3' }
      ];
      w.vm.genConfigKey = 'mm';
      w.vm.genModel = 'MiniMax-M3.1-Flash';
      w.vm.judgeConfigKey = '__env__';
      w.vm.judgeModel = '';
      // neither pick disturbs the other
      expect(w.vm.genConfigKey).toBe('mm');
      expect(w.vm.genModel).toBe('MiniMax-M3.1-Flash');
      expect(w.vm.judgeConfigKey).toBe('__env__');
      expect(w.vm.judgeModel).toBe('');
    });

    // The dropdown said GLM while the job was on granite (David, live
    // 2026-10-25). A RUNNING job's pick is what the job is using, so the
    // picker adopts it — the two can never disagree.
    it('a RUNNING generation adopts its own pick into the picker', async () => {
      const w = mountPanel();
      await flush();
      w.vm.genProgress = {
        phase: 'building-knowledge-graph',
        done: 0,
        total: 1075,
        judge: { source: 'env', config: null, model: 'ibm-granite/granite-4.1-8b' },
        judge_pick: { config_key: '__env__', model: null }
      };
      await w.vm.$nextTick();
      expect(w.vm.genConfigKey).toBe('__env__');
    });

    it('a RUNNING run adopts its own judge pick into the picker', async () => {
      const w = mountPanel();
      await flush();
      w.vm.runProgress = {
        phase: 'judge',
        done: 3,
        total: 100,
        judge: { source: 'picked', config: 'Minimax David OpenAI', model: 'MiniMax-M3.1-Flash' },
        judge_pick: { config_key: 'mm', model: 'MiniMax-M3.1-Flash' }
      };
      await w.vm.$nextTick();
      expect(w.vm.judgeConfigKey).toBe('mm');
      expect(w.vm.judgeModel).toBe('MiniMax-M3.1-Flash');
    });

    // The model select used to appear ONLY for a NAMED configuration, so
    // the models of the ACTIVE configuration (the empty pick) were not
    // choosable — and the re-score could not name the model it re-scored
    // with (David, 2026-10-25).
    it("the ACTIVE configuration's models are choosable — the model select is not hidden", async () => {
      const w = mountPanel();
      await flush();
      dispatch.mockImplementation((action) => {
        if (action === 'okf/modelConfigModels') {
          return Promise.resolve({ ok: true, models: ['glm-5.3', 'glm-5.3-flash'] });
        }
        return Promise.resolve({ ok: true });
      });
      w.vm.modelConfigs = [{ _key: 'glm', name: 'GLM-5.3 ITU - OpenAI', active: true, default_model: 'glm-5.3' }];
      w.vm.judgeConfigKey = ''; // the empty pick = the active configuration
      await w.vm.onJudgeConfigChange();
      expect(w.vm.judgeModels.length).toBeGreaterThan(0);
      // the generation pick behaves the same way
      w.vm.genConfigKey = '';
      await w.vm.onGenConfigChange();
      expect(w.vm.genModels.length).toBeGreaterThan(0);
      // and so does the re-score pick
      w.vm.rescoreConfigKey = '';
      await w.vm.onRescoreConfigChange();
      expect(w.vm.rescoreModels.length).toBeGreaterThan(0);
      dispatch.mockReset();
    });
  });

  describe('system default (environment) judge pick (David 2026-10-24)', () => {
    const flush = () => new Promise((r) => setTimeout(r, 0));
    const ENVELOPE = {
      ok: true,
      configs: [
        { _key: 'glm', name: 'GLM-5.3 Flash ITU - OpenAI', active: true },
        { _key: 'mm', name: 'Minimax David OpenAI', active: false }
      ],
      env_judge: { base_url: 'https://ai.assembly.govstack.global:444/llm/v1', model: 'ibm-granite/granite-4.1-8b' },
      env_pick: '__env__'
    };

    function envDispatch(extraRuns) {
      const suiteRow = {
        kind: 'ragas_suite',
        _key: 'rs1-test',
        suite_key: 'rs1-test',
        created_at: '2026-10-17T11:00:00.000Z'
      };
      return async (action, payload) => {
        if (action === 'okf/modelConfigList') return ENVELOPE;
        if (action === 'okf/modelConfigModels')
          return { ok: true, models: payload.key === 'mm' ? ['MiniMax-M3.1-Flash', 'MiniMax-M3'] : [] };
        if (action === 'okf/ragasListRuns') return { ok: true, runs: [suiteRow, ...(extraRuns || [])] };
        if (action === 'okf/ragasGetSuite') return { ok: true, result: suiteFixture() };
        if (action === 'okf/ragasGetRunQuiet') return { ok: true, result: runFixture() };
        if (action === 'okf/ragasRun') return { ok: true, result: runFixture() };
        if (action === 'okf/fetchRepos') return { ok: true, repos: [] };
        return { ok: true, result: null, runs: [] };
      };
    }

    it('offers the option in BOTH dropdowns and NAMES the env model it resolves to', async () => {
      dispatch.mockImplementation(envDispatch());
      const w = mountPanel();
      await flush();
      await flush();
      const judgeSelects = w
        .findAll('select')
        .filter((s) => s.findAll('option').some((o) => o.element.value === '__env__'));
      expect(judgeSelects.length).toBe(2); // generation + benchmark run
      const html = w.html();
      expect(html).toContain('Deployment default (.env) (ibm-granite/granite-4.1-8b)');
    });

    it('offers the .env option in the RE-SCORE dialog too — everywhere means everywhere', async () => {
      // The re-score dialog carries its OWN judge picker (David, 2026-10-25:
      // "RESCORING MUST ALSO ALLOW MODEL SELECTION AGAIN"), and the .env
      // default has to be reachable from it too — it is the judge that
      // actually works on a deployment whose active configuration is
      // rate-limited. The two dropdowns above are counted with the dialog
      // CLOSED; this one opens it.
      dispatch.mockImplementation(envDispatch());
      const w = mountPanel();
      await flush();
      await flush();
      w.vm.rescoreAsk = runFixture();
      await flush();
      const withEnv = w.findAll('select').filter((s) => s.findAll('option').some((o) => o.element.value === '__env__'));
      // generation + benchmark run + the re-score dialog's own picker
      expect(withEnv.length).toBe(3);
      // and the dialog's picker offers it under the same honest label
      const dialogSelect = withEnv[2];
      const envOption = dialogSelect.findAll('option').find((o) => o.element.value === '__env__');
      expect(envOption.text()).toContain('ibm-granite/granite-4.1-8b');
    });

    it('picking it submits the sentinel and fetches NO per-config model list', async () => {
      dispatch.mockImplementation(envDispatch());
      const w = mountPanel();
      await flush();
      await flush();
      w.vm.judgeConfigKey = '__env__';
      await w.vm.onJudgeConfigChange();
      expect(w.vm.judgeModels).toEqual([]); // no model sub-field for the env judge
      const modelListCalls = dispatch.mock.calls.filter((c) => c[0] === 'okf/modelConfigModels');
      expect(modelListCalls.length).toBe(0);
      await w.vm.onRun();
      const runCall = dispatch.mock.calls.find((c) => c[0] === 'okf/ragasRun');
      expect(runCall[1].judge_config_key).toBe('__env__');
    });

    it('judge memory restores __env__ as itself — never demoted to the active-config default', async () => {
      const suite = suiteFixture();
      suite.payload.judge_pick = { config_key: '__env__', model: null };
      const suiteRow = {
        kind: 'ragas_suite',
        _key: 'rs1-test',
        suite_key: 'rs1-test',
        created_at: '2026-10-17T11:00:00.000Z'
      };
      dispatch.mockImplementation(async (action) => {
        if (action === 'okf/modelConfigList') return ENVELOPE;
        if (action === 'okf/ragasGetSuite') return { ok: true, result: suite };
        if (action === 'okf/ragasListRuns') return { ok: true, runs: [suiteRow] };
        if (action === 'okf/fetchRepos') return { ok: true, repos: [] };
        return { ok: true, result: null, runs: [] };
      });
      const w = mountPanel();
      await flush();
      await flush();
      expect(w.vm.suite).toBeTruthy(); // the suite loaded — restore path engaged
      expect(w.vm.judgeConfigKey).toBe('__env__'); // not '' (the active GLM default)
    });
  });

  // David 2026-10-25: "you removed the model selection from the RAGAS
  // generation and benchmarking ... make sure it INCLUDES the default
  // configured model from the .env as an option".
  //
  // The judge dropdown was rendered only when the NAMED configuration list
  // was non-empty, and that list 403'd for anyone without tools-admin — so
  // for a curator the picker (env option included) was gone entirely. The
  // env judge alone is a selectable judge: the server resolves the ENV
  // sentinel to the .env-configured judge.
  describe('the model selection exists for a curator, not only for an admin (David 2026-10-25)', () => {
    const flush = () => new Promise((r) => setTimeout(r, 0));
    const ENV_JUDGE = {
      base_url: 'https://ai.assembly.govstack.global:444/llm/v1',
      model: 'ibm-granite/granite-4.1-8b'
    };

    function dispatchWith(envelope) {
      const suiteRow = {
        kind: 'ragas_suite',
        _key: 'rs1-test',
        suite_key: 'rs1-test',
        created_at: '2026-10-17T11:00:00.000Z'
      };
      return async (action) => {
        if (action === 'okf/modelConfigList') return envelope;
        if (action === 'okf/ragasListRuns') return { ok: true, runs: [suiteRow] };
        if (action === 'okf/ragasGetSuite') return { ok: true, result: suiteFixture() };
        if (action === 'okf/ragasGetRunQuiet') return { ok: true, result: runFixture() };
        if (action === 'okf/fetchRepos') return { ok: true, repos: [] };
        return { ok: true, result: null, runs: [] };
      };
    }

    it('renders the picker in BOTH places with ONLY the env judge — no named configurations', async () => {
      dispatch.mockImplementation(dispatchWith({ ok: true, configs: [], env_judge: ENV_JUDGE, env_pick: '__env__' }));
      const w = mountPanel();
      await flush();
      await flush();
      const judgeSelects = w
        .findAll('select')
        .filter((s) => s.findAll('option').some((o) => o.element.value === '__env__'));
      expect(judgeSelects.length).toBe(2); // generation + benchmark run
      expect(w.html()).toContain('Deployment default (.env) (ibm-granite/granite-4.1-8b)');
    });

    it('still offers the env judge when the configuration list cannot be read at all', async () => {
      dispatch.mockImplementation(dispatchWith({ ok: false, code: 'MODEL_CONFIG_LIST_FAILED', message: 'boom' }));
      const w = mountPanel();
      await flush();
      await flush();
      const judgeSelects = w
        .findAll('select')
        .filter((s) => s.findAll('option').some((o) => o.element.value === '__env__'));
      expect(judgeSelects.length).toBe(2);
      // No model name is claimed — the server could not tell us which one.
      expect(w.html()).toContain('Deployment default (.env)');
      expect(w.html()).not.toContain('ibm-granite/granite-4.1-8b');
    });

    it('the env pick still reaches the server as the sentinel', async () => {
      dispatch.mockImplementation(dispatchWith({ ok: true, configs: [], env_judge: ENV_JUDGE, env_pick: '__env__' }));
      const w = mountPanel();
      await flush();
      await flush();
      w.vm.judgeConfigKey = '__env__';
      await w.vm.onJudgeConfigChange();
      await w.vm.onRun();
      const runCall = dispatch.mock.calls.find((c) => c[0] === 'okf/ragasRun');
      expect(runCall[1].judge_config_key).toBe('__env__');
    });
  });

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

  describe('run delete (2026-10-24)', () => {
    const flush = () => new Promise((r) => setTimeout(r, 0));
    const rowButtons = (w) => w.findAll('.okf-ragas__row-actions button');
    const deleteButton = (w) => rowButtons(w).find((b) => /delete/i.test(b.text()));

    it('renders a Delete button per history row and a confirm dialog naming the run', async () => {
      const w = mountPanel();
      await flush();
      expect(deleteButton(w)).toBeTruthy();
      expect(w.vm.runDeleteActions.map((a) => a.key)).toEqual(['cancel', 'confirm']);
      expect(w.vm.runDeleteActions[1].variant).toBe('danger');
      await deleteButton(w).trigger('click');
      expect(w.vm.runDeleteAsk && w.vm.runDeleteAsk._key).toBe('rr1-run');
      expect(w.find('.dialog-stub').exists()).toBe(true);
      expect(w.find('.dialog-stub').text()).toContain('rr1-run');
      // Dismissing without confirming leaves everything in place.
      await w.vm.onRunDeleteAction('cancel');
      expect(w.vm.runDeleteAsk).toBeNull();
      expect(dispatch).not.toHaveBeenCalledWith('okf/ragasDeleteRun', expect.anything());
    });

    it('deletes via the store, refreshes history, and drops the on-screen run when it was the one deleted', async () => {
      const w = mountPanel();
      await flush();
      w.vm.runDoc = runFixture(); // the run on screen IS the one being deleted
      w.vm.runDeleteAsk = w.vm.runHistory[0];
      dispatch.mockImplementation(async (action) => {
        if (action === 'okf/ragasDeleteRun') return { ok: true, result: { deleted: 'rr1-run', removed_docs: 2 } };
        if (action === 'okf/ragasListRuns') return { ok: true, runs: [] }; // post-delete refresh
        return { ok: true, result: null, runs: [] };
      });
      await w.vm.onRunDeleteAction('confirm');
      expect(dispatch).toHaveBeenCalledWith('okf/ragasDeleteRun', {
        repoId: 'me',
        suiteKey: 'rs1-test',
        runKey: 'rr1-run'
      });
      expect(w.vm.runDeleteAsk).toBeNull();
      expect(w.vm.runHistory).toEqual([]);
      expect(w.vm.runDoc).toBeNull(); // dropped, not left dangling on screen
    });

    it('keeps the dialog open and names the refusal when the run is still executing (409)', async () => {
      const w = mountPanel();
      await flush();
      w.vm.runDeleteAsk = w.vm.runHistory[0];
      dispatch.mockImplementation(async (action) => {
        if (action === 'okf/ragasDeleteRun') return { ok: false, code: 'RUN_IN_FLIGHT', message: 'raw socket noise' };
        return { ok: true, result: null, runs: [] };
      });
      await w.vm.onRunDeleteAction('confirm');
      expect(w.vm.runDeleteAsk).not.toBeNull(); // dialog stays open for retry/cancel
      expect(w.vm.error).toMatch(/cancel/i); // readable, code-derived — not the raw message
      expect(w.vm.error).not.toContain('socket');
    });

    it('disables Delete on a RUNNING row (Cancel is that row’s action) and while a run is busy', async () => {
      const base = dispatch.getMockImplementation();
      dispatch.mockImplementation(async (action) => {
        if (action === 'okf/ragasListRuns')
          return {
            ok: true,
            runs: [
              {
                kind: 'ragas_run',
                _key: 'rr-live',
                suite_key: 'rs1-test',
                status: 'running',
                created_at: '2026-10-24T10:00:00.000Z'
              },
              { kind: 'ragas_suite', _key: 'rs1-test', suite_key: 'rs1-test', created_at: '2026-10-17T11:00:00.000Z' }
            ]
          };
        return base(action);
      });
      const w = mountPanel();
      await flush();
      const btn = deleteButton(w);
      expect(btn).toBeTruthy();
      expect(btn.attributes('disabled')).toBeDefined(); // running row → Cancel, not Delete
      // A run in flight anywhere also locks the delete.
      w.vm.runDeleteAsk = null;
      w.vm.runBusy = true;
      await w.vm.$nextTick();
      expect(deleteButton(w).attributes('disabled')).toBeDefined();
    });
  });
  describe('judge visibility + re-score (David 2026-10-24)', () => {
    const flush = () => new Promise((r) => setTimeout(r, 0));
    const RUN = {
      kind: 'ragas_run',
      _key: 'rr1-run',
      suite_key: 'rs1-test',
      status: 'done',
      created_at: '2026-10-17T12:00:00.000Z',
      judge_model: 'MiniMax-M3.1-Flash',
      judge_config: 'Minimax David OpenAI',
      judge_source: 'picked',
      judge_pick: { config_key: 'mc-mini', model: null },
      summary: runFixture().payload.summary
    };

    function judgeDispatch() {
      const base = dispatch.getMockImplementation();
      dispatch.mockImplementation(async (action) => {
        if (action === 'okf/ragasListRuns')
          return { ok: true, runs: [RUN, { kind: 'ragas_suite', _key: 'rs1-test', suite_key: 'rs1-test' }] };
        if (action === 'okf/ragasRescoreRun') return { ok: true, result: { run_key: 'rr-new', status: 'running' } };
        if (action === 'okf/ragasGetRunQuiet') return { ok: true, result: { status: 'done' } };
        if (action === 'okf/modelConfigModels') return { ok: true, models: ['strong-model', 'strong-model-2'] };
        return base(action);
      });
    }

    it('the RUN column names the JUDGE, not just the opaque key', async () => {
      judgeDispatch();
      const w = mountPanel();
      await flush();
      await flush();
      expect(w.text()).toContain('MiniMax-M3.1-Flash');
      expect(w.text()).toContain('Minimax David OpenAI');
      expect(w.text()).toContain('rr1-run');
    });

    it('says WHERE the env judge came from — a bare model id is not a judge label', async () => {
      // The env judge carries no config name, so its label used to read as
      // a bare model id, indistinguishable from a picked config. Two runs
      // scored by different judges must be told apart at a glance.
      const w = mountPanel();
      expect(w.vm.runJudgeLabel({ judge_model: 'ibm-granite/granite-4.1-8b', judge_source: 'env' })).toContain(
        'ibm-granite/granite-4.1-8b'
      );
      expect(w.vm.runJudgeLabel({ judge_model: 'ibm-granite/granite-4.1-8b', judge_source: 'env' })).toContain(
        'system default'
      );
      // A picked config still names the config.
      expect(w.vm.runJudgeLabel({ judge_model: 'MiniMax-M3.1-Flash', judge_config: 'Minimax David OpenAI' })).toContain(
        'Minimax David OpenAI'
      );
    });

    it('re-scores through the store and refreshes the history afterwards', async () => {
      judgeDispatch();
      const w = mountPanel();
      await flush();
      await flush();
      const buttons = w.findAll('.okf-ragas__row-actions button');
      const rescore = buttons.find((b) => /re-score/i.test(b.text()));
      expect(rescore).toBeTruthy();
      await rescore.trigger('click');
      expect(w.vm.rescoreAsk && w.vm.rescoreAsk._key).toBe('rr1-run');
      expect(w.vm.rescoreConfigKey).toBe('mc-mini');
      await w.vm.onRescoreConfigChange();
      expect(w.vm.rescoreModels).toEqual(['strong-model', 'strong-model-2']);
      w.vm.rescoreModel = 'strong-model';
      await w.vm.onRescoreAction('confirm');
      const call = dispatch.mock.calls.find((c) => c[0] === 'okf/ragasRescoreRun');
      expect(call).toBeTruthy();
      expect(call[1]).toMatchObject({ runKey: 'rr1-run', suiteKey: 'rs1-test' });
      expect(call[1].payload).toMatchObject({ judge_config_key: 'mc-mini', judge_model: 'strong-model' });
    });

    it('a failed re-score keeps the dialog open and surfaces the error', async () => {
      dispatch.mockImplementation(async (action) => {
        if (action === 'okf/ragasListRuns') return { ok: true, runs: [RUN] };
        if (action === 'okf/ragasRescoreRun') return { ok: false, code: 'RESCORE_FAILED', message: 'sidecar is busy' };
        return { ok: true, result: null, runs: [] };
      });
      const w = mountPanel();
      await flush();
      await flush();
      w.vm.rescoreAsk = RUN;
      await w.vm.onRescoreAction('confirm');
      expect(w.vm.rescoreAsk).not.toBeNull();
      expect(w.vm.error).toContain('busy');
    });
  });

  describe('metric coverage (2026-10-25)', () => {
    it('says how many rows a metric was actually scored on', () => {
      const summary = {
        n: 100,
        metrics: { faithfulness: 0.9, context_entities_recall: 0.42 },
        // The judge scored the entity metric on 21 of 100 rows only.
        coverage: {
          faithfulness: { scored: 100, total: 100 },
          context_entities_recall: { scored: 21, total: 100 }
        }
      };
      expect(summary.coverage.faithfulness.scored).toBe(summary.coverage.faithfulness.total);
      const w = mountPanel();
      w.vm.runHistory = [{ _key: 'rr1', summary }];
      // A fully covered metric says nothing extra.
      expect(w.vm.coverageText(summary, 'faithfulness')).toBe('');
      // A partial one names the fraction.
      expect(w.vm.coverageText(summary, 'context_entities_recall')).toBe('21/100');
      // A summary with no coverage at all (an older run) says nothing.
      expect(w.vm.coverageText({ metrics: {} }, 'faithfulness')).toBe('');
    });

    it('marks the gauge when the metric was scored on a fraction of the rows', () => {
      const w = mountPanel();
      w.vm.runDoc = {
        metrics: ['faithfulness'],
        payload: {
          summary: {
            n: 100,
            metrics: { faithfulness: 0.42 },
            coverage: { faithfulness: { scored: 21, total: 100 } }
          }
        }
      };
      const g = w.vm.aggregateRows[0];
      expect(g.coverage).toBe('21/100');
      expect(g.coverageTitle).toContain('21');
    });
  });

  describe('run facts the advice cites (2026-10-25)', () => {
    const ADVICE = {
      knob_changes: [],
      repo_tag_changes: [],
      content_curation: [],
      prompt_tweaks: [],
      note: ''
    };

    it('shows the row/abstention/answer-length facts next to the advice', async () => {
      const w = mountPanel();
      await new Promise((r) => setTimeout(r, 0));
      w.vm.explainDoc = {
        attributions: [],
        run_facts: { rows: 100, abstentions: 0, mean_answer_chars: 717 },
        advice: ADVICE
      };
      await w.vm.$nextTick();
      expect(w.vm.explainFactsLabel).toContain('100');
      expect(w.vm.explainFactsLabel).toContain('717');
      // The rendered panel must show it too — the advice cites these numbers.
      expect(w.text()).toContain('717');
    });

    it('says nothing when the explain doc carries no facts', async () => {
      const w = mountPanel();
      await new Promise((r) => setTimeout(r, 0));
      w.vm.explainDoc = { attributions: [], advice: ADVICE };
      await w.vm.$nextTick();
      expect(w.vm.explainFactsLabel).toBe('');
    });
  });
});

// 2026-10-28 live: all 10 metrics ticked, a background loadSuite re-seeded
// the 4 defaults mid-dialog, and the run scored 4. The user's selection is
// intent — background loads must not clobber it, and loading a run restores
// THAT run's metrics (the judge-pick memory pattern, metrics edition).
describe('metric selection survives background loads (2026-10-28)', () => {
  it('a touched selection is NOT re-seeded by loadSuite', async () => {
    const w = mountPanel();
    await new Promise((r) => setTimeout(r, 0));
    // The user ticks everything (the @change handler sets the flag).
    w.vm.selectedMetrics = [
      'faithfulness',
      'context_precision',
      'context_recall',
      'answer_relevancy',
      'context_utilization',
      'context_entities_recall',
      'factual_correctness',
      'answer_correctness',
      'answer_similarity',
      'noise_sensitivity'
    ];
    w.vm.metricsTouched = true;
    await w.vm.loadSuite('rs1-test');
    expect(w.vm.selectedMetrics).toHaveLength(10);
  });

  it('an untouched selection still seeds from the suite (the existing path)', async () => {
    const w = mountPanel();
    await new Promise((r) => setTimeout(r, 0));
    w.vm.metricsTouched = false;
    await w.vm.loadSuite('rs1-test');
    expect(w.vm.selectedMetrics).toEqual(['faithfulness', 'context_precision', 'context_recall', 'answer_relevancy']);
  });

  it("loading a run restores THAT run's metrics into the picker", async () => {
    const w = mountPanel();
    await new Promise((r) => setTimeout(r, 0));
    const ten = runFixture();
    ten.metrics = [
      'faithfulness',
      'context_precision',
      'context_recall',
      'answer_relevancy',
      'context_utilization',
      'context_entities_recall',
      'factual_correctness',
      'answer_correctness',
      'answer_similarity',
      'noise_sensitivity'
    ];
    dispatch.mockImplementation(async (action) => {
      if (action === 'okf/ragasGetRunQuiet') return { ok: true, result: ten };
      if (action === 'okf/ragasGetExplainQuiet') return { ok: false };
      if (action === 'okf/ragasListRuns') return { ok: true, runs: [] };
      return { ok: true, result: suiteFixture() };
    });
    await w.vm.onLoadRun('rr1-run', 'rs1-test', {});
    await new Promise((r) => setTimeout(r, 0));
    expect(w.vm.selectedMetrics).toHaveLength(10);
    expect(w.vm.selectedMetrics).toContain('noise_sensitivity');
  });
});
