'use strict';

/**
 * HEAD TEST DIALOG (Story 1-8, 2026-10-08): the Routing Lab. Contract
 * pinned here: the three tabs, the head badge states (present/stale/
 * missing from repo.head + frontmatter.updated_at), the Test tab verdict
 * (positive vs adversarial expectation), the wizard readOnly mode (no
 * rebuild button), and the suite-run outcome semantics (positive passes
 * on a head win; negative passes on a loss ONLY with competitors —
 * null otherwise, never a fake pass).
 */

const dispatch = jest.fn();

const { mount } = require('@vue/test-utils');
const OkfHeadTestDialog = require('@/components/okf/editor/HeadTestDialog.vue').default;

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
  return mount(OkfHeadTestDialog, {
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

function routingResult(wins, siblingCount = 1) {
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
        head_rank: wins ? 1 : 2
      },
      siblings: Array.from({ length: siblingCount }, (_, i) => ({
        repo_id: 's' + i,
        name: 'Sibling ' + i,
        lifecycle_state: 'publish',
        head_score: wins ? 0.4 : 0.9,
        head_rank: wins ? 2 : 1
      })),
      verdict: {
        head_routing_winner: wins ? 'r-1' : 's0',
        under_test_wins_head: wins,
        margin: siblingCount ? 0.3 : 1,
        provenance: 'head-only (no graph under test)'
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

it('renders the three tabs and a fresh-head badge', async () => {
  const w = mountDialog();
  await w.vm.$nextTick();
  const tabs = w.vm.tabDefs.map((t) => t.value);
  expect(tabs).toEqual(['head', 'test', 'suites']);
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
