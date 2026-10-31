'use strict';

/**
 * TESTING LAB DIALOG (Story 1-8, 2026-10-08): the Testing Lab. Contract
 * pinned here: the three tabs, the head badge states (present/stale/
 * missing from repo.head + frontmatter.updated_at), the Test tab verdict
 * (positive vs adversarial expectation), the wizard readOnly mode (no
 * rebuild button), and the suite-run outcome semantics (positive passes
 * on a head win; negative passes on a loss ONLY with competitors —
 * null otherwise, never a fake pass). Story 1-8b adds the gate v2
 * contract: the Floor / Forbidden tags / Margin breakdown strip, and the
 * teaching panel (veto = remove the named tag + republish; floor =
 * correct suppression; claim = no panel). Story 1-8c adds the Lab's
 * teaching loop: per-class count knobs on the generate call, the
 * near-miss class chip, the claim-side "Explain & suggest" loop
 * (routing-explain → suggested forbidden tags → shared two-write
 * frontmatter save → rebuild + re-run), and the batch "Explain failures"
 * advice for a suite run (add-all chips). Story 1-8d makes the loop
 * GUARDED and reversible (the 2026-10-09 poisoning: LLM suggestions
 * forbade the repo's OWN subject and positives collapsed while negatives
 * went 20/20): guardrail-rejected proposals render as muted chips with
 * their reason, removal_suggestions render as one-click danger chips
 * (shape built with the tag excluded), positive failures gate the
 * Explain button alongside negatives, a same-suite positive-pass-rate
 * drop raises the red tripwire strip pointing at the Revert panel, and
 * the frontmatter save history is revertible in place.
 */

const dispatch = jest.fn();

const { mount } = require('@vue/test-utils');
const OkfTestingLabDialog = require('@/components/okf/editor/TestingLabDialog.vue').default;

const REPO = {
  repo_id: 'r-1',
  name: 'NCD Information',
  lifecycle_state: 'publish',
  ingested_at: null,
  version: 3,
  head: {
    vector: [0.1, 0.2],
    dim: 1024,
    model: 'BAAI/bge-large-en-v1.5',
    version: 42,
    computed_at: '2026-10-08T10:00:00.000Z'
  },
  frontmatter: {
    topic: ['cancer-screening'],
    forbidden: ['mental-health'],
    updated_at: '2026-10-08T09:00:00.000Z' // BEFORE computed_at → fresh
  }
};

function fakeStore() {
  return {
    getters: {},
    commit() {},
    dispatch: (...a) => dispatch(...a)
  };
}

function mountDialog(props = {}) {
  return mount(OkfTestingLabDialog, {
    global: {
      mocks: { $store: fakeStore() },
      stubs: {
        // DS internals are not under test — stub the heavy ones.
        DsDialog: { template: '<div><slot /></div>' },
        DsTabs: { template: '<div><slot /></div>' },
        DsInfoTip: true,
        DsSpinner: true
      }
    },
    props: { visible: true, repo: REPO, ...props }
  });
}

function routingResult(wins, siblingCount = 1, gate = null) {
  // gate: null=legacy; 'claimed'|'suppressed' = 1-8a gate semantics.
  const claimed = gate === 'claimed' ? true : gate === 'suppressed' ? false : null;
  const winner = claimed === false ? null : wins ? 'r-1' : 's0';
  return {
    ok: true,
    result: {
      query: 'q',
      embedded_with: 'model + query-instruction',
      under_test: {
        repo_id: 'r-1',
        name: 'NCD Information',
        lifecycle_state: 'publish',
        head_score: 0.7,
        head_rank: wins ? 1 : 2,
        forbidden_cosine: gate ? 0.45 : undefined,
        head_margin: gate ? (claimed ? 0.05 : -0.02) : undefined,
        head_claimed: claimed
      },
      siblings: Array.from({ length: siblingCount }, (_, i) => ({
        repo_id: 's' + i,
        name: 'Sibling ' + i,
        lifecycle_state: 'publish',
        head_score: wins ? 0.4 : 0.9,
        head_rank: wins ? 2 : 1,
        head_claimed: claimed
      })),
      verdict: {
        head_routing_winner: winner,
        under_test_wins_head: wins && claimed !== false,
        head_suppressed: claimed === false,
        margin: siblingCount ? 0.3 : 1,
        provenance: claimed === false ? 'head-suppressed (forbidden/noise)' : 'head-only (no graph under test)'
      }
    }
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  // Default: benign {ok:true} envelope for the visible-watcher's
  // refreshRuns on mount; per-test mockResolvedValueOnce overrides win.
  dispatch.mockResolvedValue({ ok: true, runs: [] });
});

it('renders the four tabs and a fresh-head badge', async () => {
  const w = mountDialog();
  await w.vm.$nextTick();
  // Story 8-6: the fourth tab (Benchmarks) hosts the RAGAS panel. The Models
  // tab moved to the Admin Dashboard (David 2026-10-20).
  const tabs = w.vm.tabDefs.map((t) => t.value);
  expect(tabs).toEqual(['head', 'test', 'suites', 'ragas']);
  expect(w.vm.headStatus).toBe('present');
});

it('marks the head stale when tags were saved after the head was built', async () => {
  const w = mountDialog({
    repo: { ...REPO, frontmatter: { ...REPO.frontmatter, updated_at: '2026-10-08T11:00:00.000Z' } }
  });
  await w.vm.$nextTick();
  expect(w.vm.headStatus).toBe('stale');
});

it('readOnly (wizard) hides the rebuild action', async () => {
  const w = mountDialog({ readOnly: true });
  await w.vm.$nextTick();
  expect(w.vm.dialogActions.map((a) => a.key)).not.toContain('unpublish');
});

it('Test tab: positive expectation passes on a head win, fails on a loss', async () => {
  const w = mountDialog({ initialTab: 'test' });
  await w.vm.$nextTick();
  w.vm.query = 'cancer screening';
  dispatch.mockResolvedValueOnce(routingResult(true));
  await w.vm.onRunTest();
  await w.vm.$nextTick();
  expect(dispatch).toHaveBeenCalledWith('okf/headRoutingTest', {
    repoId: 'r-1',
    query: 'cancer screening',
    formula: undefined
  });
  expect(w.vm.verdictClass).toContain('pass');

  dispatch.mockResolvedValueOnce(routingResult(false));
  await w.vm.onRunTest();
  expect(w.vm.verdictClass).toContain('fail');
});

it('Test tab: adversarial expectation inverts the verdict', async () => {
  const w = mountDialog({ initialTab: 'test' });
  await w.vm.$nextTick();
  w.vm.query = 'mental health policy';
  w.vm.adversarial = true;
  dispatch.mockResolvedValueOnce(routingResult(true)); // repo WON an adversarial query → FAIL
  await w.vm.onRunTest();
  expect(w.vm.verdictClass).toContain('fail');

  dispatch.mockResolvedValueOnce(routingResult(false)); // lost → PASS
  await w.vm.onRunTest();
  expect(w.vm.verdictClass).toContain('pass');
});

it('suite outcomes: negative passes only with competitors (null otherwise, never fake)', async () => {
  const w = mountDialog({ initialTab: 'suites' });
  await w.vm.$nextTick();
  expect(w.vm.outcomeOf({ kind: 'positive', under_test_wins_head: true })).toBe(true);
  expect(w.vm.outcomeOf({ kind: 'positive', under_test_wins_head: false })).toBe(false);
  expect(w.vm.outcomeOf({ kind: 'negative', under_test_wins_head: false, sibling_count: 2 })).toBe(true);
  expect(w.vm.outcomeOf({ kind: 'negative', under_test_wins_head: true, sibling_count: 2 })).toBe(false);
  // One-repo universe: a negative CANNOT fail-select — null, not pass.
  expect(w.vm.outcomeOf({ kind: 'negative', under_test_wins_head: true, sibling_count: 0 })).toBeNull();
});

it('runs a suite and renders the honest summary + steal rows', async () => {
  const w = mountDialog({ initialTab: 'suites' });
  await w.vm.$nextTick();
  w.vm.suite = { suite_key: 's1', payload: { positive: [], negative: [] } };
  dispatch.mockResolvedValueOnce({
    ok: true,
    result: {
      payload: {
        summary: {
          pass_rate: 5 / 6,
          positive_passed: 2,
          positive_total: 3,
          negative_passed: 3,
          negative_evaluatable: 3,
          negative_pass_rate: 1,
          avg_margin: 0.3,
          steals: [{ by_repo: 'Sibling 0', count: 1 }]
        },
        results: [
          {
            query: 'p1',
            kind: 'positive',
            source: 'llm',
            under_test_wins_head: false,
            sibling_count: 2,
            winner_name: 'Sibling 0'
          },
          { query: 'n1', kind: 'negative', source: 'forbidden', under_test_wins_head: false, sibling_count: 2 },
          { query: 'n2', kind: 'negative', source: 'forbidden', under_test_wins_head: true, sibling_count: 0 }
        ]
      }
    }
  });
  dispatch.mockResolvedValueOnce({ ok: true, runs: [] }); // refreshRuns
  await w.vm.onRunSuite();
  await w.vm.$nextTick();
  expect(w.vm.lastRunSummary.pass_rate).toBeCloseTo(5 / 6, 5);
  expect(w.vm.lastRunSummary.steals).toEqual([{ by_repo: 'Sibling 0', count: 1 }]);
  const rows = w.vm.lastRunSummaryRows;
  expect(rows[0].pass).toBe(false); // positive lost → fail row
  expect(rows[1].pass).toBe(true); // negative lost-to-sibling → pass
  expect(rows[2].pass).toBeNull(); // negative in a one-repo race → honest null
});

it('dispatches headRebuild with the repo id and emits changed on success', async () => {
  const w = mountDialog();
  await w.vm.$nextTick();
  dispatch.mockResolvedValueOnce({ ok: true, result: { dim: 1024 } });
  await w.vm.onRebuild();
  expect(dispatch).toHaveBeenCalledWith('okf/headRebuild', { repoId: 'r-1' });
  expect(w.emitted('changed')).toBeTruthy();
});

// ─── Story 1-8a: the forbidden/noise GATE (David: "under no circumstances
//     should 'fun in Indonesia' be routed to the NCD repo") ────────────────

it('1-8a: a suppressed head (negative wins, even in a one-repo universe)', async () => {
  const w = mountDialog({ initialTab: 'test' });
  await w.vm.$nextTick();
  w.vm.query = 'fun in Indonesia';
  dispatch.mockResolvedValueOnce(routingResult(false, 0, 'suppressed'));
  await w.vm.onRunTest();
  expect(w.vm.headSelected).toBe(false);
  expect(w.vm.headSuppressed).toBe(true);
  expect(w.vm.verdictText).toContain('suppressed by the forbidden/noise gate');
});

it('1-8a: a borderline claim (the genetics ruling — "probably in")', async () => {
  const w = mountDialog({ initialTab: 'test' });
  await w.vm.$nextTick();
  w.vm.query = 'genetic risk factors for cancer';
  dispatch.mockResolvedValueOnce(routingResult(true, 0, 'claimed'));
  await w.vm.onRunTest();
  expect(w.vm.headSelected).toBe(true);
  expect(w.vm.headSuppressed).toBe(false);
  expect(w.vm.verdictText).toContain('wins the head routing');
  expect(w.vm.verdictText).toContain('forbidden 0.450');
});

it('1-8a: suite outcome — a negative in a one-repo universe PASSES when the head is suppressed', async () => {
  // exercise outcomeOf in the dialog's path (mirrors the service-side
  // summarizeRun: head_claimed===false is a pass regardless of siblings).
  const w = mountDialog({ initialTab: 'suites' });
  await w.vm.$nextTick();
  expect(w.vm.outcomeOf({ kind: 'negative', under_test_wins_head: false, head_claimed: false, sibling_count: 0 })).toBe(
    true
  );
  expect(w.vm.outcomeOf({ kind: 'negative', under_test_wins_head: true, head_claimed: true, sibling_count: 0 })).toBe(
    false
  );
  // Legacy (head_claimed null) — keeps the sibling-gated floor.
  expect(
    w.vm.outcomeOf({ kind: 'negative', under_test_wins_head: true, head_claimed: null, sibling_count: 0 })
  ).toBeNull();
});

// ─── Story 1-8b: gate v2 telemetry (Floor / Forbidden tags / Margin) and
//     the teaching panel (David: the Lab must TEACH — suppression → which
//     condition + which tag + what to edit) ──────────────────────────────

/** A v2 payload: under_test carries the full gate telemetry
 * (tag_veto / max_tag_cosine / floor_pass / head_claim) + the fidelity
 * knob block the dialog displays its thresholds from. */
function routingResultV2({ claim, tag = null, maxTag = 0.52, score = 0.7, forb = 0.45, floorPass = true }) {
  const claimed = claim === 'claim';
  return {
    ok: true,
    result: {
      query: 'q',
      embedded_with: 'model + query-instruction',
      under_test: {
        repo_id: 'r-1',
        name: 'NCD Information',
        lifecycle_state: 'publish',
        head_score: score,
        head_rank: claimed ? 1 : 2,
        forbidden_cosine: forb,
        head_margin: score - forb,
        tag_veto: tag,
        max_tag_cosine: maxTag,
        floor_pass: floorPass,
        head_claim: claim,
        head_claimed: claimed
      },
      siblings: [],
      verdict: {
        head_routing_winner: claimed ? 'r-1' : null,
        under_test_wins_head: claimed,
        head_suppressed: !claimed,
        margin: 1,
        provenance: !claimed
          ? claim === 'floor'
            ? 'head-suppressed (off-domain)'
            : claim === 'veto'
              ? `head-suppressed (forbidden: ${tag})`
              : 'head-suppressed (forbidden/noise)'
          : 'head-only (no graph under test)'
      },
      fidelity: {
        algorithm: 'story-1.3-replay+v2',
        knobs: { ROUTE_HEAD_MARGIN: 0.01, ROUTE_HEAD_FLOOR: 0.55, ROUTE_FORBIDDEN_TAG_MAX: 0.55 }
      }
    }
  };
}

it('1-8b: a veto renders the gate breakdown and the fix-the-tag teaching panel', async () => {
  const w = mountDialog({ initialTab: 'test' });
  await w.vm.$nextTick();
  w.vm.query = 'genetics of diabetes';
  dispatch.mockResolvedValueOnce(routingResultV2({ claim: 'veto', tag: 'genetics', maxTag: 0.638, score: 0.617 }));
  await w.vm.onRunTest();
  await w.vm.$nextTick();
  // Gate strip: three checks; the forbidden-tag one FAILS and names the tag.
  expect(w.vm.gateChecks.map((c) => c.key)).toEqual(['floor', 'veto', 'margin']);
  expect(w.vm.gateChecks[0].state).toBe('pass');
  expect(w.vm.gateChecks[1].state).toBe('fail');
  expect(w.vm.gateChecks[1].tag).toBe('genetics');
  const strip = w.find('.okf-headtest__gate');
  expect(strip.exists()).toBe(true);
  expect(strip.text()).toContain('genetics');
  // Teaching panel: names the matched tag + the fix (remove it, republish).
  const teach = w.find('.okf-headtest__teach--veto');
  expect(teach.exists()).toBe(true);
  expect(teach.text()).toContain('genetics');
  expect(teach.text()).toContain('remove "genetics"');
  expect(teach.text()).toContain('republish');
});

it('1-8b: a floor suppression teaches that it is correct — no tag fix proposed', async () => {
  const w = mountDialog({ initialTab: 'test' });
  await w.vm.$nextTick();
  w.vm.query = 'weather today';
  dispatch.mockResolvedValueOnce(routingResultV2({ claim: 'floor', score: 0.484, maxTag: 0.31, floorPass: false }));
  await w.vm.onRunTest();
  await w.vm.$nextTick();
  expect(w.vm.gateChecks[0]).toMatchObject({ key: 'floor', state: 'fail' });
  const teach = w.find('.okf-headtest__teach--floor');
  expect(teach.exists()).toBe(true);
  expect(teach.text()).toContain('correct suppression');
  expect(teach.text()).not.toContain('remove');
  expect(w.find('.okf-headtest__teach--veto').exists()).toBe(false);
});

it('1-8b: a plain claim renders no teaching panel and three passing checks', async () => {
  const w = mountDialog({ initialTab: 'test' });
  await w.vm.$nextTick();
  w.vm.query = 'cancer screening';
  dispatch.mockResolvedValueOnce(routingResultV2({ claim: 'claim' }));
  await w.vm.onRunTest();
  await w.vm.$nextTick();
  expect(w.vm.teachNote).toBeNull();
  expect(w.find('.okf-headtest__teach').exists()).toBe(false);
  expect(w.vm.gateChecks).toHaveLength(3);
  expect(w.vm.gateChecks.every((c) => c.state === 'pass')).toBe(true);
  expect(w.vm.verdictText).toContain('wins the head routing');
});

it('1-8b: a legacy (pre-v2) result renders no gate strip and keeps the old banner detail', async () => {
  const w = mountDialog({ initialTab: 'test' });
  await w.vm.$nextTick();
  w.vm.query = 'genetic risk factors for cancer';
  dispatch.mockResolvedValueOnce(routingResult(true, 0, 'claimed'));
  await w.vm.onRunTest();
  await w.vm.$nextTick();
  expect(w.vm.gateChecks).toEqual([]);
  expect(w.find('.okf-headtest__gate').exists()).toBe(false);
  expect(w.find('.okf-headtest__teach').exists()).toBe(false);
  expect(w.vm.verdictText).toContain('score 0.700 − forbidden 0.450 = 0.050');
});

// ─── Story 1-8c: the Lab teaching loop — count knobs, near-miss chip,
//     claim-side explain→add→rebuild, batch explain failures ───────────────

it('1-8c: count controls pass per-class params to the generate call', async () => {
  const w = mountDialog({ initialTab: 'suites' });
  await w.vm.$nextTick();
  // DsInput emits strings — the dialog coerces before dispatching.
  w.vm.counts = { n_positive: '12', n_negative: '9', n_negative_random: '6', n_meta: '5', n_near_miss: '6' };
  dispatch.mockResolvedValueOnce({ ok: true, result: { suite_key: 's9' } });
  dispatch.mockResolvedValueOnce({ ok: true, runs: [] }); // refreshRuns
  await w.vm.onGenerateSuite();
  expect(dispatch).toHaveBeenCalledWith('okf/headSuiteGenerate', {
    repoId: 'r-1',
    nPositive: 12,
    nNegative: 9,
    nNegativeRandom: 6,
    nMeta: 5,
    nNearMiss: 6
  });

  // Non-numeric input → undefined → the server applies its own default.
  w.vm.counts = { n_positive: '8', n_negative: 'abc', n_negative_random: '', n_meta: '3', n_near_miss: 'x' };
  dispatch.mockClear();
  dispatch.mockResolvedValueOnce({ ok: true, result: { suite_key: 's10' } });
  dispatch.mockResolvedValueOnce({ ok: true, runs: [] });
  await w.vm.onGenerateSuite();
  expect(dispatch).toHaveBeenCalledWith('okf/headSuiteGenerate', {
    repoId: 'r-1',
    nPositive: 8,
    nNegative: undefined,
    nNegativeRandom: undefined,
    nMeta: 3,
    nNearMiss: undefined
  });
});

it('1-8c: near-miss rows render a distinct class chip', async () => {
  const w = mountDialog({ initialTab: 'suites' });
  await w.vm.$nextTick();
  w.vm.suite = { suite_key: 's1', payload: { positive: [], negative: [] } };
  dispatch.mockResolvedValueOnce({
    ok: true,
    result: {
      payload: {
        summary: {
          pass_rate: 1,
          positive_passed: 1,
          positive_total: 1,
          negative_passed: 1,
          negative_total: 1,
          negative_evaluatable: 1,
          avg_margin: null,
          steals: []
        },
        results: [
          { query: 'p1', kind: 'positive', source: 'llm', under_test_wins_head: true, sibling_count: 2 },
          {
            query: 'Best hospitals for cancer surgery',
            kind: 'negative',
            cls: 'near-miss',
            source: 'llm',
            head_claimed: false,
            sibling_count: 0
          }
        ]
      }
    }
  });
  dispatch.mockResolvedValueOnce({ ok: true, runs: [] });
  await w.vm.onRunSuite();
  await w.vm.$nextTick();
  expect(w.vm.lastRunSummaryRows[1].cls).toBe('near-miss');
  expect(w.vm.classLabel('near-miss')).toBe('Near miss');
  expect(w.vm.classVariant('near-miss')).toBe('accent');
  expect(w.element.textContent).toContain('Near miss');
});

it('1-8c: explain flow renders suggestion chips, saves via the shared two-write save, then rebuilds and re-runs', async () => {
  const w = mountDialog({ initialTab: 'test' });
  await w.vm.$nextTick();
  w.vm.query = 'hiv and communicable disease prevention';
  // 1. the query (wrongly) CLAIMS
  dispatch.mockResolvedValueOnce(routingResultV2({ claim: 'claim', score: 0.594, maxTag: 0.518 }));
  await w.vm.onRunTest();
  await w.vm.$nextTick();
  expect(w.vm.claimTeachable).toBe(true);
  // 2. Explain & suggest → routing-explain proposes a forbidden tag
  dispatch.mockResolvedValueOnce({
    ok: true,
    result: {
      suggestion: { tags: ['communicable-disease'], source: 'llm', reason: 'suggested forbidden tags for this subject' }
    }
  });
  await w.vm.onExplainClaim();
  await w.vm.$nextTick();
  expect(dispatch).toHaveBeenCalledWith('okf/headRoutingExplain', {
    repoId: 'r-1',
    query: 'hiv and communicable disease prevention'
  });
  const chip = w.find('.okf-headtest__add-chip');
  expect(chip.exists()).toBe(true);
  expect(chip.text()).toContain('communicable-disease');
  // 3. click the chip → the tag lands in the shared saveFrontmatter shape
  dispatch.mockResolvedValueOnce({ ok: true, step: 'done' });
  await chip.trigger('click');
  await w.vm.$nextTick();
  expect(dispatch).toHaveBeenCalledWith('okf/saveFrontmatter', {
    repoId: 'r-1',
    shape: expect.objectContaining({ forbidden: ['mental-health', 'communicable-disease'] })
  });
  expect(w.vm.taughtTags).toEqual(['communicable-disease']);
  // 4. Rebuild head & re-run → headRebuild + routing-test for the SAME query
  const rebuildBtn = w.findAll('button').find((b) => b.text().includes('Rebuild head & re-run'));
  expect(rebuildBtn).toBeTruthy();
  dispatch.mockResolvedValueOnce({ ok: true, result: { dim: 1024 } }); // headRebuild
  dispatch.mockResolvedValueOnce(routingResultV2({ claim: 'floor', score: 0.41 })); // re-run
  await rebuildBtn.trigger('click');
  await w.vm.$nextTick();
  expect(dispatch).toHaveBeenCalledWith('okf/headRebuild', { repoId: 'r-1' });
  expect(dispatch).toHaveBeenCalledWith('okf/headRoutingTest', {
    repoId: 'r-1',
    query: 'hiv and communicable disease prevention'
  });
  expect(w.vm.lastResult.under_test.head_claim).toBe('floor');
  expect(w.vm.explanation).toBeNull(); // spent advice
});

it('1-8c: a tag already in the stored frontmatter renders as added', async () => {
  const w = mountDialog({ initialTab: 'test' });
  await w.vm.$nextTick();
  w.vm.query = 'q';
  dispatch.mockResolvedValueOnce(routingResultV2({ claim: 'claim' }));
  await w.vm.onRunTest();
  dispatch.mockResolvedValueOnce({
    ok: true,
    result: { suggestion: { tags: ['mental-health', 'genetics'], source: 'llm', reason: 'r' } }
  });
  await w.vm.onExplainClaim();
  await w.vm.$nextTick();
  expect(w.vm.isTaught('mental-health')).toBe(true); // in REPO.frontmatter
  expect(w.vm.isTaught('genetics')).toBe(false);
  const chips = w.findAll('.okf-headtest__add-chip');
  expect(chips).toHaveLength(2);
  expect(chips.at(0).text()).toContain('✓');
  expect(chips.at(1).text()).toContain('+');
});

it('1-8c: batch advice — Explain failures renders add-all chips and saves them in one write', async () => {
  const w = mountDialog({ initialTab: 'suites' });
  await w.vm.$nextTick();
  w.vm.suite = { suite_key: 's1', payload: { positive: [], negative: [] } };
  dispatch.mockResolvedValueOnce({
    ok: true,
    result: {
      payload: {
        summary: {
          pass_rate: 0.75,
          positive_passed: 3,
          positive_total: 3,
          negative_passed: 1,
          negative_total: 2,
          negative_evaluatable: 2,
          avg_margin: null,
          steals: []
        },
        results: [
          { query: 'p1', kind: 'positive', source: 'llm', under_test_wins_head: true, sibling_count: 2 },
          { query: 'n1 ok', kind: 'negative', cls: 'near-miss', source: 'llm', head_claimed: false, sibling_count: 0 },
          {
            query: 'hiv prevention guideline',
            kind: 'negative',
            cls: 'near-miss',
            source: 'llm',
            head_claimed: true,
            sibling_count: 0
          }
        ]
      }
    }
  });
  dispatch.mockResolvedValueOnce({ ok: true, runs: [] });
  await w.vm.onRunSuite();
  expect(w.vm.hasNegativeFailures).toBe(true); // 1/2 negatives passed
  // Explain failures → ONE batch call
  dispatch.mockResolvedValueOnce({
    ok: true,
    result: {
      suite_key: 's1',
      run_key: 'r1',
      failing_count: 1,
      failing_queries: [{ query: 'hiv prevention guideline', cls: 'near-miss', head_claim: 'claim' }],
      suggested_tags: ['communicable-disease', 'hiv'],
      source: 'llm',
      note: 'both failures share the communicable-disease subject'
    }
  });
  await w.vm.onExplainFailures();
  await w.vm.$nextTick();
  // objectContaining: the payload also carries the poll cancel token (#80124).
  expect(dispatch).toHaveBeenCalledWith(
    'okf/headSuiteExplainFailures',
    expect.objectContaining({ repoId: 'r-1', suiteKey: 's1' })
  );
  expect(w.vm.batchTags).toEqual(['communicable-disease', 'hiv']);
  expect(w.element.textContent).toContain('both failures share the communicable-disease subject');
  expect(w.element.textContent).toContain('hiv prevention guideline');
  // Add all → ONE saveFrontmatter with every pending tag
  const addAll = w.findAll('button').find((b) => b.text().includes('Add all'));
  expect(addAll).toBeTruthy();
  dispatch.mockResolvedValueOnce({ ok: true, step: 'done' });
  await addAll.trigger('click');
  await w.vm.$nextTick();
  expect(dispatch).toHaveBeenCalledWith('okf/saveFrontmatter', {
    repoId: 'r-1',
    shape: expect.objectContaining({ forbidden: ['mental-health', 'communicable-disease', 'hiv'] })
  });
  // Rebuild head & re-run suite is now offered
  const rerun = w.findAll('button').find((b) => b.text().includes('Rebuild head & re-run suite'));
  expect(rerun).toBeTruthy();
  dispatch.mockResolvedValueOnce({ ok: true, result: { dim: 1024 } }); // headRebuild
  dispatch.mockResolvedValueOnce({
    ok: true,
    result: {
      payload: {
        summary: {
          pass_rate: 1,
          positive_passed: 1,
          positive_total: 1,
          negative_passed: 1,
          negative_total: 1,
          negative_evaluatable: 1,
          avg_margin: null,
          steals: []
        },
        results: [{ query: 'n1', kind: 'negative', cls: 'near-miss', head_claimed: false, sibling_count: 0 }]
      }
    }
  });
  dispatch.mockResolvedValueOnce({ ok: true, runs: [] });
  await rerun.trigger('click');
  await w.vm.$nextTick();
  expect(dispatch).toHaveBeenCalledWith('okf/headRebuild', { repoId: 'r-1' });
  expect(dispatch).toHaveBeenCalledWith('okf/headSuiteRun', { repoId: 'r-1', suiteKey: 's1' });
});

it('1-8g-v: an async run (202 + poll) adopts the run doc when the poll lands it', async () => {
  const w = mountDialog({ initialTab: 'suites' });
  await w.vm.$nextTick();
  w.vm.suite = { suite_key: 's1', payload: { positive: [{ query: 'q1', kind: 'positive' }], negative: [] } };
  dispatch.mockImplementation((action) => {
    if (action === 'okf/headSuiteRun')
      return Promise.resolve({ ok: true, result: { run_key: 'r9', status: 'running' } });
    // Round 18 (#80465): the run wait is the store's pollHeadSuiteRun now —
    // the finished run doc arrives through it (the raw headSuiteGetRun
    // service call is that action's internal detail).
    if (action === 'okf/pollHeadSuiteRun')
      return Promise.resolve({
        ok: true,
        result: {
          _key: 'r9',
          suite_key: 's1',
          payload: {
            summary: {
              pass_rate: 1,
              positive_passed: 1,
              positive_total: 1,
              negative_passed: 0,
              negative_total: 0,
              negative_evaluatable: 0,
              avg_margin: null,
              steals: []
            },
            results: [
              {
                query: 'q1',
                kind: 'positive',
                head_claimed: true,
                sibling_count: 0,
                under_test_wins_head: true,
                probe: { verdict: 'answerable', top_score: 0.9 }
              }
            ]
          }
        }
      });
    if (action === 'okf/headSuiteListRuns') return Promise.resolve({ ok: true, runs: [] });
    return Promise.resolve({ ok: true });
  });
  await w.vm.onRunSuite();
  expect(w.vm.lastRunSummary).toMatchObject({ pass_rate: 1 });
  expect(w.vm.lastRunSummaryRows).toHaveLength(1);
  // the corpus verdict merged into the suite row
  expect(w.vm.suite.payload.positive[0].lastProbe).toMatchObject({ verdict: 'answerable' });
  expect(w.vm.busy).toBeNull();
});

it('1-8c: the claim-side teach loop is hidden in readOnly (wizard writes nothing)', async () => {
  const w = mountDialog({ initialTab: 'test', readOnly: true });
  await w.vm.$nextTick();
  w.vm.query = 'q';
  dispatch.mockResolvedValueOnce(routingResultV2({ claim: 'claim' }));
  await w.vm.onRunTest();
  await w.vm.$nextTick();
  expect(w.vm.claimTeachable).toBe(false);
  expect(w.find('.okf-headtest__add-chip').exists()).toBe(false);
});

// ─── Story 1-8d: the GUARDED teaching loop — rejection chips, removal
//     chips, positive-failure visibility, the tripwire, revert ──────────────

it('1-8d: guardrail rejections render as muted chips with their reason (Test tab)', async () => {
  const w = mountDialog({ initialTab: 'test' });
  await w.vm.$nextTick();
  w.vm.query = 'lung cancer staging';
  dispatch.mockResolvedValueOnce(routingResultV2({ claim: 'claim' }));
  await w.vm.onRunTest();
  dispatch.mockResolvedValueOnce({
    ok: true,
    result: {
      suggestion: {
        tags: [],
        rejected: [{ tag: 'lung-cancer', reason: 'too close to the repository subject (similarity 0.81 >= 0.55)' }],
        source: 'guardrail',
        reason: 'every proposal was screened out by the guardrail'
      }
    }
  });
  await w.vm.onExplainClaim();
  await w.vm.$nextTick();
  const rej = w.findAll('.okf-headtest__rejected-chip');
  expect(rej).toHaveLength(1);
  expect(rej.at(0).text()).toContain('lung-cancer');
  // The reason rides as the tooltip — trust through transparency.
  expect(rej.at(0).attributes('title')).toContain('too close');
  // Rejections are NOT "nothing suggested" — the 1-8c dead-end copy stays hidden.
  expect(w.element.textContent).not.toContain('No forbidden tag was suggested');
  expect(w.element.textContent).toContain('every proposal was screened out by the guardrail');
});

it('1-8d: Explain button gate — positive failures qualify, legacy summaries keep it hidden', async () => {
  const w = mountDialog({ initialTab: 'suites' });
  await w.vm.$nextTick();
  // The explain affordance lives inside the current-suite block.
  w.vm.suite = { suite_key: 's1', payload: { positive: [], negative: [] } };
  // Negatives all pass, positives collapsed (the poisoning signature) → explainable.
  w.vm.lastRunSummary = {
    pass_rate: 0.5,
    positive_passed: 2,
    positive_total: 8,
    negative_passed: 6,
    negative_total: 6,
    negative_evaluatable: 6
  };
  expect(w.vm.hasNegativeFailures).toBe(false);
  expect(w.vm.hasPositiveFailures).toBe(true);
  expect(w.vm.hasExplainableFailures).toBe(true);
  await w.vm.$nextTick();
  expect(w.findAll('button').find((b) => b.text().includes('Explain failures'))).toBeTruthy();
  // Legacy summary without the counters → no button (nothing to explain from).
  w.vm.lastRunSummary = { pass_rate: 1 };
  expect(w.vm.hasExplainableFailures).toBe(false);
});

it('1-8d: removal chips — positive-failure attribution renders and a click filters the shape', async () => {
  const w = mountDialog({
    initialTab: 'suites',
    repo: { ...REPO, frontmatter: { ...REPO.frontmatter, forbidden: ['mental-health', 'lung-cancer'] } }
  });
  await w.vm.$nextTick();
  w.vm.suite = { suite_key: 's1', payload: { positive: [], negative: [] } };
  dispatch.mockResolvedValueOnce({
    ok: true,
    result: {
      suite_key: 's1',
      run_key: 'r1',
      failing_count: 0,
      failing_queries: [],
      suggested_tags: [],
      rejected: [{ tag: 'genetics', reason: 'too close to the repository subject' }],
      removal_suggestions: [
        { tag: 'lung-cancer', killed: 2 },
        { tag: 'non-smoking', killed: 1 }
      ],
      positive_failures: { count: 3, veto_counts: { 'lung-cancer': 2, 'non-smoking': 1 }, margin_killed: 0 },
      source: 'none',
      note: 'no wrongly-claimed negatives — the failures are suppressed positives (see removal_suggestions)'
    }
  });
  await w.vm.onExplainFailures();
  await w.vm.$nextTick();
  // Positive failures are visible on their own terms + veto attribution.
  expect(w.element.textContent).toContain('Why positives stopped passing');
  expect(w.element.textContent).toContain('Vetoed by');
  expect(w.element.textContent).toContain('lung-cancer ×2');
  // The guardrail's rejected proposal renders in the batch panel too.
  expect(w.findAll('.okf-headtest__rejected-chip').map((c) => c.text())).toHaveLength(1);
  // Removal chip: danger variant, tooltip carries the attribution.
  const chips = w.findAll('.okf-headtest__remove-chip');
  expect(chips).toHaveLength(2);
  expect(chips.at(0).attributes('title')).toContain('lung-cancer');
  expect(chips.at(0).attributes('title')).toContain('2');
  // Click → the shared save with the tag FILTERED OUT of forbidden.
  dispatch.mockResolvedValueOnce({ ok: true, step: 'done' });
  await chips.at(0).trigger('click');
  await w.vm.$nextTick();
  expect(dispatch).toHaveBeenCalledWith('okf/saveFrontmatter', {
    repoId: 'r-1',
    shape: expect.objectContaining({ forbidden: ['mental-health'] })
  });
  expect(w.vm.removedTags).toEqual(['lung-cancer']);
  // After a removal the rebuild & re-run flow is offered.
  expect(w.findAll('button').find((b) => b.text().includes('Rebuild head & re-run suite'))).toBeTruthy();
});

it('1-8d: tripwire — a same-suite positive-pass-rate drop raises the strip and points at Revert', async () => {
  const w = mountDialog({ initialTab: 'suites' });
  await w.vm.$nextTick();
  w.vm.suite = { suite_key: 's1', payload: { positive: [], negative: [] } };
  const runWith = (passed) => ({
    ok: true,
    result: {
      payload: {
        summary: {
          pass_rate: passed / 4,
          positive_passed: passed,
          positive_total: 4,
          negative_passed: 2,
          negative_total: 2,
          negative_evaluatable: 2,
          avg_margin: null,
          steals: []
        },
        results: []
      }
    }
  });
  // Cycle 1: 4/4 positives.
  dispatch.mockResolvedValueOnce(runWith(4));
  dispatch.mockResolvedValueOnce({ ok: true, runs: [] });
  await w.vm.onRunSuite();
  expect(w.vm.tripwire).toBeNull();
  // Cycle 2 (rebuild & re-run the SAME suite): positives collapse to 1/4.
  dispatch.mockResolvedValueOnce({ ok: true, result: { dim: 1024 } }); // headRebuild
  dispatch.mockResolvedValueOnce(runWith(1));
  dispatch.mockResolvedValueOnce({ ok: true, runs: [] });
  await w.vm.onRebuildSuiteRerun();
  expect(w.vm.tripwire).toEqual({ dropped: 3 });
  const strip = w.find('.okf-headtest__tripwire');
  expect(strip.exists()).toBe(true);
  expect(strip.text()).toContain('3');
  // The strip's button jumps to the Revert panel and loads its history.
  dispatch.mockResolvedValueOnce({
    ok: true,
    entries: [{ saved_at: '2026-10-09T10:00:00.000Z', actor: 'david.forden', forbidden_count: 3 }]
  });
  await w.vm.showRevertPanel();
  expect(w.vm.revertHighlight).toBe(true);
  expect(w.vm.revertEntries).toHaveLength(1);
  expect(dispatch).toHaveBeenLastCalledWith('okf/frontmatterHistory', { repoId: 'r-1' });
  // A different suite never compares across identities: regenerating clears it.
  dispatch.mockResolvedValueOnce({ ok: true, result: { suite_key: 's2' } });
  dispatch.mockResolvedValueOnce({ ok: true, runs: [] });
  await w.vm.onGenerateSuite();
  expect(w.vm.tripwire).toBeNull();
});

it('1-8e: Apply owns ONE busy token across save → rebuild → re-run and never stops silently', async () => {
  const w = mountDialog({ initialTab: 'suites' });
  await w.vm.$nextTick();
  w.vm.suite = { suite_key: 's1', payload: { positive: [], negative: [] } };
  w.vm.advisor = { changes: { add: ['new-tag'], remove: [] }, add_eval: [], remove_eval: [] };
  // Dispatch order: saveFrontmatter → headRebuild → headSuiteRun → listRuns.
  dispatch.mockResolvedValueOnce({ ok: true });
  dispatch.mockResolvedValueOnce({ ok: true, result: { dim: 1024 } });
  dispatch.mockResolvedValueOnce({
    ok: true,
    result: {
      payload: {
        summary: {
          pass_rate: 1,
          positive_passed: 2,
          positive_total: 2,
          negative_passed: 1,
          negative_total: 1,
          negative_evaluatable: 1
        },
        results: []
      }
    }
  });
  dispatch.mockResolvedValueOnce({ ok: true, runs: [] });
  await w.vm.onAdvisorApply();
  const calls = dispatch.mock.calls.map((c) => c[0]);
  expect(calls).toEqual(expect.arrayContaining(['okf/saveFrontmatter', 'okf/headRebuild', 'okf/headSuiteRun']));
  // The whole leg completed: busy released, no error, summary refreshed.
  expect(w.vm.busy).toBeNull();
  expect(w.vm.error).toBe('');
  expect(w.vm.lastRunSummary.pass_rate).toBe(1);
});

it('1-8g: blocked removals render as confirm chips and Apply includes the confirmed extras', async () => {
  const w = mountDialog({ initialTab: 'suites' });
  await w.vm.$nextTick();
  w.vm.suite = { suite_key: 's1', payload: { positive: [], negative: [] } };
  w.vm.advisor = {
    changes: { add: [], remove: [] },
    add_eval: [],
    remove_eval: [],
    blocked_removals: [
      { tag: 'meat-packaging', predicted_positive_gain: 16, predicted_negative_loss: 2, reason: 'curator_original' },
      { tag: 'food-safety-testing', predicted_positive_gain: 6, predicted_negative_loss: 0, reason: 'history_rotated' }
    ],
    narrow_options: [
      {
        remove: 'meat-packaging',
        add: 'meat-packaging-narrow',
        predicted_positive_gain: 16,
        predicted_negative_loss: 0
      }
    ],
    scope: {
      suites: ['s1'],
      runs: [{ run_key: 'r1', suite_key: 's1', created_at: 'x', tagset: { hash8: 'aa11' } }],
      embedding_prefixed: true,
      embedding_model: 'm'
    }
  };
  await w.vm.$nextTick();
  const html = w.element.innerHTML;
  expect(html).toContain('meat-packaging');
  expect(html).toContain('recovers 16 positive');
  // Confirm BOTH blocked removals + the narrow pair — Apply must carry all
  // of them in the ONE save (the pair's add joins the adds; its remove
  // joins the removes).
  w.vm.toggleExtraRemove('meat-packaging');
  w.vm.toggleExtraRemove('food-safety-testing');
  w.vm.toggleNarrowPair(w.vm.advisorNarrowOptions[0]);
  dispatch.mockResolvedValueOnce({ ok: true }); // saveFrontmatter
  dispatch.mockResolvedValueOnce({ ok: true, result: { dim: 1024 } }); // headRebuild
  dispatch.mockResolvedValueOnce({
    ok: true,
    result: { payload: { summary: { pass_rate: 1, positive_passed: 1, positive_total: 1 }, results: [] } }
  });
  dispatch.mockResolvedValueOnce({ ok: true, runs: [] }); // refreshRuns
  await w.vm.onAdvisorApply();
  const save = dispatch.mock.calls.find((c) => c[0] === 'okf/saveFrontmatter');
  const shape = save[1].shape;
  // The three removals applied, the narrow add kept, the untouched
  // curator tag ('mental-health' from the REPO fixture) preserved.
  expect(shape.forbidden).toEqual(['mental-health', 'meat-packaging-narrow']);
  expect(w.vm.busy).toBeNull();
  expect(w.vm.error).toBe('');
});

it('1-8g: the advisor scope line names the suites and tag sets when the server sends scope', async () => {
  const w = mountDialog({ initialTab: 'suites' });
  await w.vm.$nextTick();
  w.vm.advisor = {
    queries_considered: 100,
    runs_considered: 2,
    current_scorecard: { positive_claimed: 13, positive_total: 50, negative_suppressed: 45, negative_total: 50 },
    recommended_scorecard: { positive_claimed: 13, positive_total: 50, negative_suppressed: 47, negative_total: 50 },
    scope: {
      suites: ['s-a', 's-b'],
      runs: [
        { run_key: 'r1', suite_key: 's-a', tagset: { hash8: 'aa11' } },
        { run_key: 'r2', suite_key: 's-b', tagset: { hash8: 'bb22' } }
      ]
    }
  };
  const text = w.vm.advisorScoreText;
  expect(text).toContain('(across 100 queries from the last 2 runs)');
  expect(text).toContain('s-a, s-b');
  expect(text).toContain('aa11, bb22');
});

it('1-8e: a failed rebuild during Apply surfaces the error instead of stopping silently', async () => {
  const w = mountDialog({ initialTab: 'suites' });
  await w.vm.$nextTick();
  w.vm.suite = { suite_key: 's1', payload: { positive: [], negative: [] } };
  w.vm.advisor = { changes: { add: ['new-tag'], remove: [] }, add_eval: [], remove_eval: [] };
  dispatch.mockResolvedValueOnce({ ok: true }); // saveFrontmatter
  dispatch.mockResolvedValueOnce({ ok: false, message: 'TEI unreachable' }); // headRebuild
  await w.vm.onAdvisorApply();
  expect(w.vm.busy).toBeNull();
  expect(w.vm.error).toContain('TEI unreachable');
  // The leg stopped where it failed — no phantom re-run on a stale head.
  expect(dispatch.mock.calls.map((c) => c[0])).not.toContain('okf/headSuiteRun');
});

it('1-8e: Apply without a suite still saves + rebuilds, then reports instead of stopping', async () => {
  const w = mountDialog({ initialTab: 'suites' });
  await w.vm.$nextTick();
  w.vm.suite = null;
  w.vm.advisor = { changes: { add: ['new-tag'], remove: [] }, add_eval: [], remove_eval: [] };
  dispatch.mockResolvedValueOnce({ ok: true }); // saveFrontmatter
  dispatch.mockResolvedValueOnce({ ok: true, result: { dim: 1024 } }); // headRebuild
  await w.vm.onAdvisorApply();
  expect(w.vm.busy).toBeNull();
  expect(w.vm.error).toContain('generate a suite');
  expect(dispatch.mock.calls.map((c) => c[0])).not.toContain('okf/headSuiteRun');
});

it('1-8d: revert panel — lists the save history and a click calls the store revert action', async () => {
  const w = mountDialog({ initialTab: 'suites' });
  await w.vm.$nextTick();
  w.vm.suite = { suite_key: 's1', payload: { positive: [], negative: [] } };
  w.vm.fmHistory = [
    { saved_at: '2026-10-09T12:00:00.000Z', actor: 'david.forden', forbidden_count: 3 },
    { saved_at: '2026-10-09T10:00:00.000Z', actor: 'system', forbidden_count: 1 }
  ];
  await w.vm.$nextTick();
  const panel = w.find('.okf-headtest__revert');
  expect(panel.exists()).toBe(true);
  expect(panel.text()).toContain('david.forden');
  const buttons = w.findAll('button').filter((b) => b.text().trim() === 'Revert');
  expect(buttons.length).toBeGreaterThanOrEqual(2); // one per pane (suites + test footer)
  dispatch.mockResolvedValueOnce({
    ok: true,
    result: { repo_id: 'r-1', reverted_to: '2026-10-09T10:00:00.000Z', frontmatter: { forbidden: [] } }
  });
  dispatch.mockResolvedValueOnce({ ok: true, entries: [] }); // history refresh
  await buttons.at(0).trigger('click');
  await w.vm.$nextTick();
  expect(dispatch).toHaveBeenCalledWith('okf/frontmatterRevert', {
    repoId: 'r-1',
    savedAt: '2026-10-09T12:00:00.000Z'
  });
  expect(w.emitted('changed')).toBeTruthy();
  expect(w.vm.reverted).toBe(true);
});

it('1-8d: the Revert panel is hidden in readOnly (wizard writes nothing)', async () => {
  const w = mountDialog({ initialTab: 'suites', readOnly: true });
  await w.vm.$nextTick();
  expect(w.findAll('.okf-headtest__revert')).toHaveLength(0);
});

it('1-8d: staleness — forbidden_snapshot drift against the stored tags is flagged', async () => {
  const w = mountDialog({ initialTab: 'suites' });
  await w.vm.$nextTick();
  // REPO forbids [mental-health]; the suite snapshot adds genetics → drifted.
  w.vm.suite = { suite_key: 's1', payload: { forbidden_snapshot: ['mental-health', 'genetics'] } };
  expect(w.vm.suiteForbiddenStale).toBe(true);
  // Same list (order-insensitive set compare) → fresh.
  w.vm.suite = { suite_key: 's1', payload: { forbidden_snapshot: ['Mental-Health'] } };
  expect(w.vm.suiteForbiddenStale).toBe(false);
  // Legacy suite docs without a snapshot never flag.
  w.vm.suite = { suite_key: 's1', payload: {} };
  expect(w.vm.suiteForbiddenStale).toBe(false);
});

// ─── Story 1-8f: suites are savable, modifiable and rerunnable ─────────────

it('1-8f: Saved suites list renders and Load pulls the full rows as the editable current suite', async () => {
  const w = mountDialog({ initialTab: 'suites' });
  await w.vm.$nextTick();
  w.vm.savedSuites = [{ _key: 's-old', created_at: '2026-10-09T10:00:00.000Z', positives: 2, negatives: 2 }];
  await w.vm.$nextTick();
  const loadBtn = w.findAll('button').find((b) => b.text() === 'Load');
  expect(loadBtn).toBeTruthy();
  dispatch.mockResolvedValueOnce({
    ok: true,
    result: {
      suite_key: 's-old',
      payload: {
        positive: [{ query: 'q1', kind: 'positive', cls: null, source: 'llm' }],
        negative: [{ query: 'q2', kind: 'negative', cls: 'near-miss', source: 'llm' }]
      }
    }
  });
  await w.vm.onLoadSuite('s-old');
  expect(dispatch).toHaveBeenCalledWith('okf/headSuiteGet', { repoId: 'r-1', suiteKey: 's-old' });
  expect(w.vm.suite.suite_key).toBe('s-old');
  // Rows are visible BEFORE any run — the old view only rendered post-run.
  expect(w.vm.suiteEditableRows).toHaveLength(2);
  expect(w.vm.suiteEditableRows.every((r) => r.pass === null)).toBe(true);
});

it('1-8f: flip a row kind — dispatches the row update and adopts the returned suite', async () => {
  const w = mountDialog({ initialTab: 'suites' });
  await w.vm.$nextTick();
  w.vm.suite = {
    suite_key: 's1',
    payload: {
      positive: [{ query: 'HIV causes', kind: 'positive', cls: null, source: 'manual' }],
      negative: [{ query: 'q2', kind: 'negative', cls: 'near-miss', source: 'llm' }]
    }
  };
  const updated = {
    suite_key: 's1',
    payload: {
      positive: [],
      negative: [
        { query: 'q2', kind: 'negative', cls: 'near-miss', source: 'llm' },
        { query: 'HIV causes', kind: 'negative', cls: null, source: 'manual' }
      ]
    }
  };
  dispatch.mockResolvedValueOnce({ ok: true, result: updated });
  await w.vm.onFlipRow({ query: 'HIV causes', kind: 'positive' });
  expect(dispatch).toHaveBeenCalledWith('okf/headSuiteUpdateRows', {
    repoId: 'r-1',
    suiteKey: 's1',
    payload: { updates: [{ match: { query: 'HIV causes', kind: 'positive' }, set: { kind: 'negative' } }] }
  });
  expect(w.vm.suite).toEqual(updated);
  expect(w.vm.busy).toBeNull();
});

it('1-8f: delete a row — dispatches removes and adopts the returned suite', async () => {
  const w = mountDialog({ initialTab: 'suites' });
  await w.vm.$nextTick();
  w.vm.suite = {
    suite_key: 's1',
    payload: {
      positive: [],
      negative: [{ query: 'q2', kind: 'negative', cls: 'near-miss', source: 'llm' }]
    }
  };
  const updated = { suite_key: 's1', payload: { positive: [], negative: [] } };
  dispatch.mockResolvedValueOnce({ ok: true, result: updated });
  await w.vm.onDeleteRow({ query: 'q2', kind: 'negative' });
  expect(dispatch).toHaveBeenCalledWith('okf/headSuiteUpdateRows', {
    repoId: 'r-1',
    suiteKey: 's1',
    payload: { removes: [{ query: 'q2', kind: 'negative' }] }
  });
  expect(w.vm.suite).toEqual(updated);
});

it('1-8f: a failed row edit surfaces the error instead of losing the local suite', async () => {
  const w = mountDialog({ initialTab: 'suites' });
  await w.vm.$nextTick();
  const suiteFixture = {
    suite_key: 's1',
    payload: { positive: [], negative: [{ query: 'q2', kind: 'negative', cls: null, source: 'llm' }] }
  };
  w.vm.suite = suiteFixture;
  dispatch.mockResolvedValueOnce({ ok: false, message: 'duplicate query text' });
  await w.vm.onFlipRow({ query: 'q2', kind: 'negative' });
  expect(w.vm.busy).toBeNull();
  expect(w.vm.error).toContain('duplicate query text');
  expect(w.vm.suite).toStrictEqual(suiteFixture); // untouched on failure (deep: vm wraps it in a reactive proxy)
});

it('1-8f2: rename inline in the Saved-suites table dispatches and adopts the new name', async () => {
  const w = mountDialog({ initialTab: 'suites' });
  await w.vm.$nextTick();
  w.vm.savedSuites = [{ _key: 's-old', created_at: 'x', positives: 1, negatives: 1, name: '' }];
  await w.vm.$nextTick();
  dispatch.mockResolvedValueOnce({ ok: true, result: { _key: 's-old', name: 'NCD regression set' } });
  await w.vm.onRenameSuite(w.vm.savedSuites[0], '  NCD regression set  ');
  expect(dispatch).toHaveBeenCalledWith('okf/headSuiteRename', {
    repoId: 'r-1',
    suiteKey: 's-old',
    name: 'NCD regression set'
  });
  expect(w.vm.savedSuites[0].name).toBe('NCD regression set');
});

it('1-8f2: count controls allow any number (max 1000 positives — the clamp regression)', async () => {
  const w = mountDialog({ initialTab: 'suites' });
  await w.vm.$nextTick();
  const pos = w.vm.countControls.find((c) => c.key === 'n_positive');
  expect(pos.max).toBe(1000);
  // 0 is a request (positives-only suite), not a fallback trigger.
  expect(w.vm.intOf('0')).toBe(0);
  expect(w.vm.intOf('')).toBeUndefined();
});

it('1-8f2: generation is 202+poll — the UI polls and adopts the suite when it lands', async () => {
  const w = mountDialog({ initialTab: 'suites' });
  await w.vm.$nextTick();
  const landed = { suite_key: 's-new', payload: { positive: [], negative: [] } };
  dispatch.mockImplementation((action, payload) => {
    if (action === 'okf/headSuiteGenerate') {
      return Promise.resolve({ ok: true, result: { suite_key: 's-new', status: 'generating' } });
    }
    if (action === 'okf/headSuiteGet' && payload && payload.suiteKey === 's-new') {
      return Promise.resolve({ ok: true, result: landed });
    }
    if (action === 'okf/headSuiteListRuns') return Promise.resolve({ ok: true, runs: [] });
    return Promise.resolve({ ok: true });
  });
  w.vm.pollForSuite = jest.fn().mockResolvedValue(landed);
  await w.vm.onGenerateSuite();
  expect(w.vm.pollForSuite).toHaveBeenCalledWith('s-new');
  expect(w.vm.suite.suite_key).toBe('s-new');
  expect(w.vm.busy).toBeNull();
  expect(w.vm.error).toBe('');
});

it('1-8f2: pollForSuite delegates to the pollJob-backed store action and adopts its suite', async () => {
  const w = mountDialog({ initialTab: 'suites' });
  await w.vm.$nextTick();
  const landed = { suite_key: 's-x', payload: { positive: [], negative: [] } };
  // Round 18 (#80465): the wait moved into okf/pollHeadSuite (pollJob
  // tolerance + first-fetch fast path — the generating-envelope patience is
  // asserted at the store level in okf-head-suite-poll.test.js). Here the
  // component seam is: dispatch it with the cancel signal, adopt its result.
  dispatch.mockImplementation((action, payload) => {
    if (action === 'okf/pollHeadSuite') {
      expect(payload).toMatchObject({ repoId: 'r-1', suiteKey: 's-x' });
      expect(payload.signal).toBe(w.vm.pollSignal);
      return Promise.resolve({ ok: true, result: landed });
    }
    return Promise.resolve({ ok: true });
  });
  const suite = await w.vm.pollForSuite('s-x');
  expect(suite).toBe(landed); // NOT the generating envelope
});

// Round 20 (#80778): pollForSuite used to collapse a FAILED envelope to
// null, so onGenerate fell through to the generic "taking unusually long"
// timeout branch and the real server error never reached the steward — the
// exact defect pollForRun's mapping fixed for runs.
it('1-8f2: a FAILED suite envelope maps to a failed doc (not the timeout branch)', async () => {
  const w = mountDialog({ initialTab: 'suites' });
  await w.vm.$nextTick();
  dispatch.mockImplementation((action) => {
    if (action === 'okf/pollHeadSuite') {
      return Promise.resolve({ ok: false, code: 'SUITE_GEN_FAILED', message: 'okf.labErrors.suiteGenFailed' });
    }
    return Promise.resolve({ ok: true });
  });
  const suite = await w.vm.pollForSuite('s-bad');
  expect(suite).toEqual({ status: 'failed', error: { message: 'okf.labErrors.suiteGenFailed' } });
  // The timeout family still maps to null (the friendly server-side branch).
  dispatch.mockImplementation((action) => {
    if (action === 'okf/pollHeadSuite') {
      return Promise.resolve({ ok: false, code: 'SUITE_GEN_TIMEOUT', message: 'still generating' });
    }
    return Promise.resolve({ ok: true });
  });
  await expect(w.vm.pollForSuite('s-slow')).resolves.toBeNull();
});

it('1-8g: onProbeRow runs the click-test and patches matching rows with the probe result', async () => {
  const w = mountDialog({ initialTab: 'suites' });
  await w.vm.$nextTick();
  const probe = { at: '2026-10-10T10:00:00Z', docs: 24, top_score: 0.83, verdict: 'answerable' };
  dispatch.mockImplementation((action, payload) => {
    if (action === 'okf/headSuiteProbe') {
      expect(payload).toMatchObject({ repoId: 'r-1', suiteKey: 's1', query: 'positive query 0' });
      return Promise.resolve({ ok: true, result: { suite_key: 's1', query: 'positive query 0', ...probe } });
    }
    return Promise.resolve({ ok: true });
  });
  w.vm.suite = {
    suite_key: 's1',
    payload: {
      positive: [{ query: 'positive query 0' }],
      negative: [{ query: 'negative query 0' }]
    }
  };
  await w.vm.onProbeRow(w.vm.suite.payload.positive[0]);
  expect(w.vm.busy).toBeNull();
  expect(w.vm.suite.payload.positive[0].lastProbe).toMatchObject({ verdict: 'answerable', top_score: 0.83 });
  expect(w.vm.suite.payload.negative[0].lastProbe).toBeUndefined();
});

it('1-8g: onProbeRow surfaces the error strip when the probe fails', async () => {
  const w = mountDialog({ initialTab: 'suites' });
  await w.vm.$nextTick();
  dispatch.mockResolvedValue({ ok: false, message: 'boom' });
  w.vm.suite = { suite_key: 's1', payload: { positive: [{ query: 'q' }], negative: [] } };
  await w.vm.onProbeRow(w.vm.suite.payload.positive[0]);
  expect(w.vm.error).toBe('boom');
  expect(w.vm.suite.payload.positive[0].lastProbe).toBeUndefined();
});

it('1-8g: the probe summary panel renders head + corpus legs, the reason, reference files and top chunks', async () => {
  const w = mountDialog({ initialTab: 'suites' });
  await w.vm.$nextTick();
  dispatch.mockImplementation((action) => {
    if (action === 'okf/headSuiteProbe') {
      return Promise.resolve({
        ok: true,
        result: {
          suite_key: 's1',
          query: 'positive query 0',
          docs: 24,
          elapsed_ms: 812,
          top_score: 0.83,
          verdict: 'answerable',
          reason: 'Best chunk scores 0.83 (≥ 0.5 answer bar) — "colorectal screening every 2 years"',
          files: [{ id: 'files/f1', name: 'ncd-guidelines.md', chunks: 12 }],
          top_chunks: [{ score: 0.83, preview: 'colorectal screening every 2 years', file: 'ncd-guidelines.md' }],
          head: { claimed: true, claim: 'cancer-screening', score: 0.7 }
        }
      });
    }
    return Promise.resolve({ ok: true });
  });
  w.vm.suite = {
    suite_key: 's1',
    payload: { positive: [{ query: 'positive query 0' }], negative: [] }
  };
  await w.vm.onProbeRow(w.vm.suite.payload.positive[0]);
  expect(w.vm.probePanel).toMatchObject({ verdict: 'answerable', docs: 24, elapsed_ms: 812 });
  const html = w.element.innerHTML;
  expect(html).toContain('positive query 0');
  expect(html).toContain('Best chunk scores 0.83');
  expect(html).toContain('ncd-guidelines.md');
  expect(html).toContain('colorectal screening every 2 years');
  expect(html).toContain('812ms');
});

it('1-8g: suiteEditableRows carries lastProbe through the final map (the Corpus-column regression)', async () => {
  // THE live bug (2026-10-10): the computed's final map rebuilt every row
  // WITHOUT lastProbe — the payload kept it, the rendered rows lost it, and
  // the Corpus column stayed blank for everyone. Assert the OUTPUT.
  const w = mountDialog({ initialTab: 'suites' });
  await w.vm.$nextTick();
  w.vm.suite = {
    suite_key: 's1',
    payload: {
      positive: [{ query: 'q1', lastProbe: { verdict: 'weak', top_score: 0.3, docs: 24 } }],
      negative: []
    }
  };
  const row = w.vm.suiteEditableRows.find((r) => r.query === 'q1');
  expect(row.lastProbe).toMatchObject({ verdict: 'weak', top_score: 0.3 });
});

it('1-8g: Run All merges the run per-row corpus probes into the suite rows', async () => {
  const w = mountDialog({ initialTab: 'suites' });
  await w.vm.$nextTick();
  dispatch.mockImplementation((action) => {
    if (action === 'okf/headSuiteRun') {
      return Promise.resolve({
        ok: true,
        result: {
          payload: {
            summary: {
              pass_rate: 1,
              positive_passed: 1,
              positive_total: 1,
              negative_passed: 0,
              negative_evaluatable: 0,
              negative_pass_rate: null,
              steals: []
            },
            results: [
              {
                query: 'q1',
                kind: 'positive',
                source: 'llm',
                under_test_wins_head: true,
                sibling_count: 0,
                probe: { at: '2026-10-10T10:00:00Z', docs: 24, top_score: 0.83, verdict: 'answerable' }
              }
            ]
          }
        }
      });
    }
    return Promise.resolve({ ok: true, runs: [] });
  });
  w.vm.suite = { suite_key: 's1', payload: { positive: [{ query: 'q1' }], negative: [] } };
  await w.vm.onRunSuite();
  expect(w.vm.suite.payload.positive[0].lastProbe).toMatchObject({ verdict: 'answerable', top_score: 0.83 });
  expect(w.vm.busy).toBeNull();
});

it('1-8g: the corpus probe affordances gate on an ingested corpus (the live 409)', async () => {
  // REPO fixture has no ingested_graph_name → ▶ disabled + hint shown.
  const w = mountDialog({ initialTab: 'suites' });
  await w.vm.$nextTick();
  expect(w.vm.corpusAvailable).toBe(false);
  w.vm.suite = { suite_key: 's1', payload: { positive: [{ query: 'q1' }], negative: [] } };
  await w.vm.$nextTick();
  const btn = w.element.querySelector('.okf-headtest__row-btn');
  expect(btn).not.toBeNull();
  expect(btn.disabled).toBe(true);
});

it('1-8g-t: suite deletion requires the confirm dialog — cancel keeps, confirm deletes', async () => {
  const w = mountDialog({ initialTab: 'suites' });
  await w.vm.$nextTick();
  dispatch.mockImplementation((action) => {
    if (action === 'okf/headSuiteDelete') return Promise.resolve({ ok: true, result: { deleted: true } });
    return Promise.resolve({ ok: true });
  });
  w.vm.savedSuites = [{ _key: 's1' }, { _key: 's2' }];
  w.vm.suite = { suite_key: 's1', payload: { positive: [], negative: [] } };
  w.vm.lastRunSummary = { pass_rate: 0.5 };
  // the × only ARMS the dialog — nothing is deleted yet
  await w.vm.onDeleteSuite(w.vm.savedSuites[0]);
  expect(w.vm.deleteConfirm).toMatchObject({ _key: 's1' });
  expect(w.vm.savedSuites.map((s) => s._key)).toEqual(['s1', 's2']);
  expect(dispatch).not.toHaveBeenCalledWith('okf/headSuiteDelete', expect.anything());
  // cancel closes the dialog, keeps everything
  await w.vm.onDeleteSuiteConfirm('cancel');
  expect(w.vm.deleteConfirm).toBeNull();
  expect(w.vm.savedSuites.map((s) => s._key)).toEqual(['s1', 's2']);
  // confirm deletes: the row leaves the list, the loaded copy clears
  await w.vm.onDeleteSuite(w.vm.savedSuites[0]);
  await w.vm.onDeleteSuiteConfirm('confirm');
  expect(w.vm.savedSuites.map((s) => s._key)).toEqual(['s2']);
  expect(w.vm.suite).toBeNull();
  expect(w.vm.lastRunSummary).toBeNull();
  expect(w.vm.busy).toBeNull();
  expect(w.vm.deleteConfirm).toBeNull();
});

/* ---------------------------------------------------------------------------
 * CONTENDED-STATE REGRESSION (2026-10-12).
 *
 * Commit 091a182b7 fixed ONE read — loadFrontmatterHistory — but shipped
 * WITHOUT a test, so the class recurred. These are the tests that class
 * needed.
 *
 * The smell this closes: the file previously had 11 `expect(w.vm.busy)
 * .toBeNull()` assertions and ZERO assignments to `w.vm.busy`. Every
 * existing test asserted the slot was RELEASED and none ever occupied it,
 * so nothing could have detected a guard that silently drops a request.
 * Every test below therefore ASSIGNS the slot with an unrelated token and
 * asserts the read still dispatched.
 *
 * `busy` is one shared string. A read that claimed it was dropped whenever
 * ANY other control held it — no queue, no retry, no error — and the pane
 * then rendered a confident empty state for a request that never ran.
 * ---------------------------------------------------------------------- */

describe('poll cancel token (round 16, #80124)', () => {
  it('unmounting the Lab aborts the signal the explain poll carries', async () => {
    const w = await mountDialog(); // the suite's own factory
    expect(w.vm.pollSignal.aborted).toBe(false);
    w.unmount();
    expect(w.vm.pollSignal.aborted).toBe(true);
  });

  // Round 17, #80355: the component-LOCAL polls must honor the signal too.
  // Round 18 (#80465): the loops live in the store actions now — the
  // component's job is to PASS the signal and translate POLL_ABORTED to
  // null (the dialog's discard-on-close contract).
  it('pollForSuite/pollForRun pass the signal and translate POLL_ABORTED to null', async () => {
    const w = await mountDialog();
    dispatch.mockClear();
    w.vm.pollSignal.aborted = true;
    dispatch.mockImplementation((action, payload) => {
      if (action === 'okf/pollHeadSuite' || action === 'okf/pollHeadSuiteRun') {
        expect(payload.signal.aborted).toBe(true); // the signal rides along
        return Promise.resolve({ ok: false, code: 'POLL_ABORTED', message: 'Tracking stopped.' });
      }
      return Promise.resolve({ ok: true });
    });
    await expect(w.vm.pollForSuite('s1')).resolves.toBeNull();
    await expect(w.vm.pollForRun('s1', 'rk1')).resolves.toBeNull();
    w.unmount();
  });

  // Round 17, #80355(2): a suite switch mid-run must discard the result.
  it('onRunSuite discards the run result when the suite moved while it ran', async () => {
    const w = await mountDialog();
    w.vm.suite = { suite_key: 's-old' };
    w.vm.lastRunSummary = null;
    dispatch.mockImplementationOnce(async () => {
      // the suite switches WHILE the run request is in flight
      w.vm.suite = { suite_key: 's-new' };
      return {
        ok: true,
        result: { status: 'done', suite_key: 's-old', payload: { summary: { positive_passed: 1 }, results: [] } }
      };
    });
    await w.vm.onRunSuite();
    // the old run's verdict was NOT adopted into the new suite
    expect(w.vm.lastRunSummary).toBeNull();
    w.unmount();
  });
});

describe('headStatus — parsed instants, never raw string compare (round 17, #80358)', () => {
  const withTimes = (updated_at, computed_at) => {
    const repo = { ...REPO, frontmatter: { updated_at }, head: { vector: {}, computed_at } };
    return { repo };
  };
  const epochSeconds = Math.floor(Date.parse('2026-10-13T09:00:00.000Z') / 1000);

  it('an epoch-SECONDS computed_at compares correctly against an ISO updated_at', async () => {
    const w1 = await mountDialog(withTimes('2026-10-13T10:00:00.000Z', epochSeconds));
    expect(w1.vm.headStatus).toBe('stale'); // frontmatter AFTER the head
    w1.unmount();
    const w2 = await mountDialog(withTimes('2026-10-13T08:00:00.000Z', epochSeconds));
    expect(w2.vm.headStatus).toBe('present'); // head is fresh
    w2.unmount();
  });

  it('unparseable stamps degrade to present, never throw', async () => {
    const w = await mountDialog(withTimes('garbage', epochSeconds));
    expect(w.vm.headStatus).toBe('present');
    w.unmount();
  });
});

describe('contended shared-busy slot: reads still dispatch', () => {
  // An UNRELATED token, deliberately not the read's own. The bug was that a
  // tag save ('save-tag') could swallow a history fetch; any token reproduces
  // it, and using a different one proves the read is not merely self-gating.
  const CONTEND = 'run';

  it('onExplainClaim dispatches even while another control holds busy', async () => {
    const w = mountDialog({ initialTab: 'test' });
    await w.vm.$nextTick();
    w.vm.query = 'hiv and communicable disease prevention';
    // Occupy the shared slot the way a suite run would.
    w.vm.busy = CONTEND;
    expect(w.vm.busy).not.toBeNull(); // the precondition is REAL, not decorative
    dispatch.mockResolvedValueOnce({
      ok: true,
      result: { suggestion: { tags: ['communicable-disease'], source: 'llm', reason: 'r' } }
    });
    await w.vm.onExplainClaim();
    expect(dispatch).toHaveBeenCalledWith('okf/headRoutingExplain', {
      repoId: 'r-1',
      query: 'hiv and communicable disease prevention'
    });
    expect(w.vm.explanation.suggestion.tags).toEqual(['communicable-disease']);
    // The read must NOT have cleared the other control's token.
    expect(w.vm.busy).toBe(CONTEND);
    // And it uses its own flag, not the shared slot.
    expect(w.vm.explainLoading).toBe(false);
  });

  it('onRecommend dispatches even while another control holds busy', async () => {
    const w = mountDialog({ initialTab: 'suites' });
    await w.vm.$nextTick();
    w.vm.busy = CONTEND;
    dispatch.mockResolvedValueOnce({ ok: true, result: { changes: { add: [], remove: [] } } });
    await w.vm.onRecommend();
    expect(dispatch).toHaveBeenCalledWith('okf/headRecommend', { repoId: 'r-1' });
    expect(w.vm.advisor).toEqual({ changes: { add: [], remove: [] } });
    expect(w.vm.busy).toBe(CONTEND);
    expect(w.vm.advisorLoading).toBe(false);
  });

  it('onExplainFailures dispatches even while another control holds busy', async () => {
    const w = mountDialog({ initialTab: 'suites' });
    await w.vm.$nextTick();
    w.vm.suite = { suite_key: 's1', payload: { positive: [], negative: [] } };
    w.vm.busy = CONTEND;
    dispatch.mockResolvedValueOnce({ ok: true, result: { suggested_tags: ['x'], failing_count: 1 } });
    await w.vm.onExplainFailures();
    // objectContaining: the payload also carries the poll cancel token (#80124).
    expect(dispatch).toHaveBeenCalledWith(
      'okf/headSuiteExplainFailures',
      expect.objectContaining({ repoId: 'r-1', suiteKey: 's1' })
    );
    expect(w.vm.batchAdvice.suggested_tags).toEqual(['x']);
    expect(w.vm.busy).toBe(CONTEND);
    expect(w.vm.explainFailuresLoading).toBe(false);
  });

  it('onLoadSuite dispatches even while another control holds busy (no stale suite)', async () => {
    const w = mountDialog({ initialTab: 'suites' });
    await w.vm.$nextTick();
    // A previously loaded suite — the exact stale view this defect produced.
    w.vm.suite = { suite_key: 's-old', payload: { positive: [{ query: 'old' }], negative: [] } };
    w.vm.busy = CONTEND;
    dispatch.mockResolvedValueOnce({
      ok: true,
      result: { suite_key: 's-new', payload: { positive: [], negative: [] } }
    });
    await w.vm.onLoadSuite('s-new');
    expect(dispatch).toHaveBeenCalledWith('okf/headSuiteGet', { repoId: 'r-1', suiteKey: 's-new' });
    // The NEW suite replaced the old one — a drop would have left s-old.
    expect(w.vm.suite.suite_key).toBe('s-new');
    expect(w.vm.busy).toBe(CONTEND);
    expect(w.vm.suiteLoading).toBe(false);
  });

  it('loadFrontmatterHistory dispatches even while another control holds busy (091a182b7)', async () => {
    // The originally-fixed read, pinned so the fix cannot silently regress.
    const w = mountDialog({ initialTab: 'suites' });
    await w.vm.$nextTick();
    w.vm.busy = CONTEND;
    dispatch.mockResolvedValueOnce({ ok: true, entries: [{ saved_at: '2026-10-12T00:00:00Z' }] });
    await w.vm.loadFrontmatterHistory();
    expect(dispatch).toHaveBeenCalledWith('okf/frontmatterHistory', { repoId: 'r-1' });
    expect(w.vm.fmHistory).toHaveLength(1);
    expect(w.vm.busy).toBe(CONTEND);
    expect(w.vm.historyLoading).toBe(false);
  });

  it('WRITE guards are NOT relaxed: a save still refuses to double-fire', async () => {
    // The counter-test. Removing read guards must not have weakened the
    // double-submit protection on a mutation — that protection is real.
    const w = mountDialog({ initialTab: 'test' });
    await w.vm.$nextTick();
    w.vm.busy = CONTEND;
    dispatch.mockClear();
    await w.vm.onTeachTag('communicable-disease');
    expect(dispatch).not.toHaveBeenCalled();
    expect(w.vm.taughtTags).toEqual([]);
    await w.vm.onRemoveTag('mental-health');
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('read preconditions still hold: no query means no explain dispatch', async () => {
    // The guards I removed were the BUSY half only. The genuine no-op
    // preconditions must survive — an explain needs a query.
    const w = mountDialog({ initialTab: 'test' });
    await w.vm.$nextTick();
    w.vm.query = '   ';
    dispatch.mockClear();
    await w.vm.onExplainClaim();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('read preconditions still hold: no suite means no batch explain dispatch', async () => {
    const w = mountDialog({ initialTab: 'suites' });
    await w.vm.$nextTick();
    w.vm.suite = null;
    dispatch.mockClear();
    await w.vm.onExplainFailures();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('each read button disables ITSELF while its own read is in flight', async () => {
    // Dropping the shared-slot claim must not drop the SELF-guard: without it
    // the button would stay clickable through its own run and a double-click
    // would fire two explains. The flag replaces exactly what the busy claim
    // used to protect, without re-blocking on unrelated work.
    const w = mountDialog({ initialTab: 'test' });
    await w.vm.$nextTick();
    w.vm.query = 'hiv and communicable disease prevention';
    // The panel only renders when the head CLAIMS the query (claimTeachable).
    dispatch.mockResolvedValueOnce(routingResultV2({ claim: 'claim' }));
    await w.vm.onRunTest();
    await w.vm.$nextTick();
    const btn = () => w.findAll('button').find((b) => b.text().includes('Explain & suggest'));
    expect(btn()).toBeTruthy();
    expect(btn().attributes('disabled')).toBeUndefined();

    // Hold the read open: the flag is set, the shared slot is NOT.
    let release;
    dispatch.mockImplementationOnce(() => new Promise((r) => (release = r)));
    const pending = w.vm.onExplainClaim();
    await w.vm.$nextTick();
    expect(w.vm.explainLoading).toBe(true);
    expect(w.vm.busy).toBeNull();
    expect(btn().attributes('disabled')).toBeDefined();

    release({ ok: true, result: { suggestion: { tags: ['x'], source: 'llm', reason: 'r' } } });
    await pending;
    await w.vm.$nextTick();
    expect(w.vm.explainLoading).toBe(false);
    expect(btn().attributes('disabled')).toBeUndefined();
  });
});

describe('empty states distinguish "ran and found nothing" from "not loaded"', () => {
  it('a completed explain with no suggestion says so, instead of a bare button', async () => {
    const w = mountDialog({ initialTab: 'test' });
    await w.vm.$nextTick();
    w.vm.query = 'hiv and communicable disease prevention';
    dispatch.mockResolvedValueOnce(routingResultV2({ claim: 'claim' }));
    await w.vm.onRunTest();
    // The model ran and proposed nothing at all.
    dispatch.mockResolvedValueOnce({ ok: true, result: { suggestion: null } });
    await w.vm.onExplainClaim();
    await w.vm.$nextTick();
    expect(w.vm.explanationLoaded).toBe(true);
    const html = w.html();
    expect(html).toContain('The explain ran and proposed no forbidden tags');
  });

  it('a FAILED explain does NOT claim it ran (the error is the honest signal)', async () => {
    const w = mountDialog({ initialTab: 'test' });
    await w.vm.$nextTick();
    w.vm.query = 'hiv and communicable disease prevention';
    dispatch.mockResolvedValueOnce(routingResultV2({ claim: 'claim' }));
    await w.vm.onRunTest();
    dispatch.mockResolvedValueOnce({ ok: false, message: 'explain blew up' });
    await w.vm.onExplainClaim();
    await w.vm.$nextTick();
    // A failure is visible as an error and must NOT assert a completed run —
    // that would be a second confident-wrong-answer shape.
    expect(w.vm.explanationLoaded).toBe(false);
    expect(w.vm.error).toBe('explain blew up');
  });

  it('a completed advisor with no recommendation says so', async () => {
    const w = mountDialog({ initialTab: 'suites' });
    await w.vm.$nextTick();
    // The advisor block renders inside the v-if="suite" pane (pre-existing
    // structure), so the empty-state line needs a loaded suite to be in the
    // tree at all — same precondition as its button.
    w.vm.suite = { suite_key: 's1', payload: { positive: [], negative: [] } };
    dispatch.mockResolvedValueOnce({ ok: true, result: null });
    await w.vm.onRecommend();
    await w.vm.$nextTick();
    expect(w.vm.advisorLoaded).toBe(true);
    expect(w.html()).toContain('The advisor ran and recommended no tag changes');
  });

  it('a completed batch explain with no advice says so', async () => {
    const w = mountDialog({ initialTab: 'suites' });
    await w.vm.$nextTick();
    w.vm.suite = { suite_key: 's1', payload: { positive: [], negative: [] } };
    dispatch.mockResolvedValueOnce({ ok: true, result: null });
    await w.vm.onExplainFailures();
    await w.vm.$nextTick();
    expect(w.vm.batchAdviceLoaded).toBe(true);
    expect(w.html()).toContain('The explain ran and returned no advice');
  });

  it('the markers reset when the suite changes (advice belongs to its suite)', async () => {
    const w = mountDialog({ initialTab: 'suites' });
    await w.vm.$nextTick();
    w.vm.suite = { suite_key: 's1', payload: { positive: [], negative: [] } };
    dispatch.mockResolvedValueOnce({ ok: true, result: { suggested_tags: ['x'] } });
    await w.vm.onExplainFailures();
    expect(w.vm.batchAdviceLoaded).toBe(true);
    dispatch.mockResolvedValueOnce({ ok: true, result: { suite_key: 's2', payload: { positive: [], negative: [] } } });
    await w.vm.onLoadSuite('s2');
    // The new suite must not inherit the old suite's "already explained" line.
    expect(w.vm.batchAdviceLoaded).toBe(false);
    expect(w.vm.advisorLoaded).toBe(false);
  });

  it('re-running the test invalidates the previous explanation and its marker', async () => {
    const w = mountDialog({ initialTab: 'test' });
    await w.vm.$nextTick();
    w.vm.query = 'hiv and communicable disease prevention';
    dispatch.mockResolvedValueOnce(routingResultV2({ claim: 'claim' }));
    await w.vm.onRunTest();
    dispatch.mockResolvedValueOnce({ ok: true, result: { suggestion: { tags: ['x'], source: 'llm', reason: 'r' } } });
    await w.vm.onExplainClaim();
    expect(w.vm.explanationLoaded).toBe(true);
    // A different query makes the spent advice stale — the marker must go too,
    // or the new query would render "the explain ran and proposed nothing".
    dispatch.mockResolvedValueOnce(routingResultV2({ claim: 'floor' }));
    await w.vm.onRunTest();
    expect(w.vm.explanation).toBeNull();
    expect(w.vm.explanationLoaded).toBe(false);
  });
  // ── STALE-ANSWER GUARDS ────────────────────────────────────────────────────
  //
  // Removing the shared `busy` claim fixed the silent drops but removed the
  // serialisation it provided as a side effect, so a subject switch (a suite
  // load, a re-test) landing mid-read left the OLD answer rendered under the
  // NEW subject. These pin the epoch guards that replaced it.
  //
  // This is not cosmetic. The batchAdvice block renders DsTag chips wired to
  // onTeachTag / onRemoveTag — the genuine two-write frontmatter mutations — so
  // stale advice is one click from persisting the wrong suite's tags.

  it('discards a batch explain whose suite was switched while it was in flight', async () => {
    const w = mountDialog({ initialTab: 'suites' });
    await w.vm.$nextTick();
    w.vm.suite = { suite_key: 's-A', payload: { positive: [], negative: [] } };

    // The dispatch never resolves on its own: we switch suites, THEN resolve.
    let release;
    dispatch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ ok: true, result: { suggested_tags: ['TAG-FOR-SUITE-A'] } });
        })
    );

    const inflight = w.vm.onExplainFailures();
    // The curator switches to suite B before the explain comes back. This is
    // exactly what the shared `busy` claim used to prevent.
    w.vm.suite = { suite_key: 's-B', payload: { positive: [], negative: [] } };
    w.vm.suiteEpoch += 1;
    release();
    await inflight;

    // Suite A's advice must NOT be rendered under suite B's rows.
    expect(w.vm.batchAdvice).toBeNull();
    expect(w.vm.batchAdviceLoaded).toBe(false);
  });

  it('discards a batch explain when this.suite is swapped without bumping the epoch', async () => {
    // Belt and braces: the epoch is the primary guard, but the suite_key
    // comparison must hold on its own so a future caller that forgets to bump
    // the epoch still cannot render cross-suite advice.
    const w = mountDialog({ initialTab: 'suites' });
    await w.vm.$nextTick();
    w.vm.suite = { suite_key: 's-A', payload: { positive: [], negative: [] } };

    let release;
    dispatch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ ok: true, result: { suggested_tags: ['TAG-FOR-SUITE-A'] } });
        })
    );

    const inflight = w.vm.onExplainFailures();
    w.vm.suite = { suite_key: 's-B', payload: { positive: [], negative: [] } };
    release(); // no epoch bump at all
    await inflight;

    expect(w.vm.batchAdvice).toBeNull();
  });

  it('discards advisor advice whose suite was switched while it was in flight', async () => {
    const w = mountDialog({ initialTab: 'suites' });
    await w.vm.$nextTick();
    w.vm.suite = { suite_key: 's-A', payload: { positive: [], negative: [] } };

    let release;
    dispatch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ ok: true, result: { add_eval: [], remove_eval: [] } });
        })
    );

    const inflight = w.vm.onRecommend();
    w.vm.suite = { suite_key: 's-B', payload: { positive: [], negative: [] } };
    w.vm.suiteEpoch += 1;
    release();
    await inflight;

    // The advisor's Add/Remove chips feed onAdvisorApply, which writes the
    // repository's forbidden set — stale advice is a data mutation away.
    expect(w.vm.advisor).toBeNull();
    expect(w.vm.advisorLoaded).toBe(false);
  });

  it('discards an explanation whose query changed while it was in flight', async () => {
    const w = mountDialog({});
    await w.vm.$nextTick();
    w.vm.query = 'first query';

    let release;
    dispatch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ ok: true, result: { suggestion: { tag: 'stale-tag' } } });
        })
    );

    const inflight = w.vm.onExplainClaim();
    w.vm.query = 'a completely different question';
    release();
    await inflight;

    // A stale suggestion chip is wired to onTeachTag — a two-write mutation.
    expect(w.vm.explanation).toBeNull();
    expect(w.vm.explanationLoaded).toBe(false);
  });

  it('discards an explanation after a re-test even when the query text is unchanged', async () => {
    // The epoch covers a re-run that does not alter the query string; the
    // string comparison alone would let this stale answer through.
    const w = mountDialog({});
    await w.vm.$nextTick();
    w.vm.query = 'same query';

    let release;
    dispatch.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ ok: true, result: { suggestion: { tag: 'stale-tag' } } });
        })
    );

    const inflight = w.vm.onExplainClaim();
    w.vm.queryEpoch += 1; // a re-run, query text untouched
    release();
    await inflight;

    expect(w.vm.explanation).toBeNull();
  });

  it('still applies a batch explain when the suite did NOT change', async () => {
    // The guard must not break the happy path — a completed explain with the
    // same suite still renders its advice and sets its "it ran" marker.
    const w = mountDialog({ initialTab: 'suites' });
    await w.vm.$nextTick();
    w.vm.suite = { suite_key: 's-A', payload: { positive: [], negative: [] } };
    dispatch.mockResolvedValueOnce({ ok: true, result: { suggested_tags: ['keep-me'] } });

    await w.vm.onExplainFailures();

    expect(w.vm.batchAdvice.suggested_tags).toEqual(['keep-me']);
    expect(w.vm.batchAdviceLoaded).toBe(true);
  });
});

describe('#80805 — poll-envelope messages render translated, server detail verbatim', () => {
  const ADVISOR_EN =
    'The advisor is still running on the model host. Reopen the Lab later to see its result — nothing was lost.';

  it('onRecommend maps ADVISOR_TIMEOUT to the translated sentence (no $i18n → the fallback carries it)', async () => {
    const w = mountDialog({ initialTab: 'suites' });
    await w.vm.$nextTick();
    w.vm.suite = { suite_key: 's1', payload: { positive: [], negative: [] } };
    dispatch.mockResolvedValueOnce({ ok: false, code: 'ADVISOR_TIMEOUT', message: ADVISOR_EN });
    await w.vm.onRecommend();
    // No $i18n in tests: translate() returns the fallback — the English
    // sentence this test pins as the key’s fallback text.
    expect(w.vm.error).toBe(ADVISOR_EN);
    expect(w.vm.advisorLoaded).toBe(false);
  });

  it('onRecommend maps RECOMMEND_FAILED by code, not by the raw message', async () => {
    const w = mountDialog({ initialTab: 'suites' });
    await w.vm.$nextTick();
    w.vm.suite = { suite_key: 's1', payload: { positive: [], negative: [] } };
    dispatch.mockResolvedValueOnce({ ok: false, code: 'RECOMMEND_FAILED', message: 'Advisor failed' });
    await w.vm.onRecommend();
    expect(w.vm.error).toBe('Advisor failed');
  });

  it('onRecommend still shows a server message verbatim for unmapped codes', async () => {
    const w = mountDialog({ initialTab: 'suites' });
    await w.vm.$nextTick();
    w.vm.suite = { suite_key: 's1', payload: { positive: [], negative: [] } };
    dispatch.mockResolvedValueOnce({ ok: false, code: 'E_ADVICE', message: 'llm down' });
    await w.vm.onRecommend();
    expect(w.vm.error).toBe('llm down');
  });

  it('a failed run whose envelope carries the labErrors key routes it through the translator', async () => {
    // Round 21 (#80911): this test used to mount with NO $i18n and assert the
    // RAW KEY — translateLabError was a no-op under that mock (the key passed
    // through untranslated and satisfied the assertion), so unwiring ALL TEN
    // call sites left the suite green while users saw 'okf.labErrors.…'. The
    // honest wiring test installs the REAL i18n plugin and asserts the
    // TRANSLATED sentence: it dies on every unwired mutation.
    const { createI18n } = require('vue-i18n');
    const i18n = createI18n({
      legacy: true,
      locale: 'en',
      fallbackLocale: 'en',
      messages: { en: { okf: { labErrors: { suiteRunFailed: 'The suite run blew up (translated).' } } } }
    });
    const w = mount(OkfTestingLabDialog, {
      global: {
        plugins: [i18n],
        mocks: { $store: fakeStore() },
        stubs: {
          DsDialog: { template: '<div><slot /></div>' },
          DsTabs: { template: '<div><slot /></div>' },
          DsInfoTip: true,
          DsSpinner: true
        }
      },
      props: { visible: true, repo: REPO, initialTab: 'suites' }
    });
    await w.vm.$nextTick();
    w.vm.suite = { suite_key: 's1', payload: { positive: [], negative: [] } };
    // headSuiteRun starts the async run; pollHeadSuiteRun answers the
    // store's failed envelope whose message is an okf.labErrors.* KEY.
    dispatch.mockResolvedValueOnce({ ok: true, result: { status: 'running', run_key: 'rk-1' } });
    dispatch.mockResolvedValueOnce({ ok: false, code: 'RUN_FAILED', message: 'okf.labErrors.suiteRunFailed' });
    await w.vm.onRunSuite();
    expect(w.vm.error).toBe('The suite run blew up (translated).');
  });

  it('a failed run with a SERVER message keeps it verbatim', async () => {
    const w = mountDialog({ initialTab: 'suites' });
    await w.vm.$nextTick();
    w.vm.suite = { suite_key: 's1', payload: { positive: [], negative: [] } };
    dispatch.mockResolvedValueOnce({ ok: true, result: { status: 'running', run_key: 'rk-1' } });
    dispatch.mockResolvedValueOnce({ ok: false, code: 'SCORING_FAILED', message: 'reranker down' });
    await w.vm.onRunSuite();
    expect(w.vm.error).toBe('reranker down');
  });

  // Round 21 (#80880): the RECOMMEND_FAILED arm keeps the SERVER's reason
  // ('vLLM 503: model not ready', 'no head tags yet', …) — the generic
  // sentence is only the fallback when the message is absent.
  it('a failed advisor whose envelope carries the server reason keeps it verbatim (#80880)', async () => {
    const w = mountDialog({ initialTab: 'suites' });
    await w.vm.$nextTick();
    dispatch.mockResolvedValueOnce({
      ok: false,
      code: 'RECOMMEND_FAILED',
      message: 'vLLM 503: model not ready'
    });
    await w.vm.onRecommend();
    expect(w.vm.error).toBe('vLLM 503: model not ready');
  });

  it('a failed advisor with NO message falls back to the generic sentence', async () => {
    const w = mountDialog({ initialTab: 'suites' });
    await w.vm.$nextTick();
    dispatch.mockResolvedValueOnce({ ok: false, code: 'RECOMMEND_FAILED', message: '' });
    await w.vm.onRecommend();
    // No $i18n: the fallback IS the translated default (the key passthrough
    // is covered by the onRecommend ADVISOR_TIMEOUT test).
    expect(typeof w.vm.error).toBe('string');
    expect(w.vm.error.length).toBeGreaterThan(0);
  });
});
