'use strict';

/**
 * Story 1-8g-x — the run PROGRESS BAR (David, 2026-10-11: "the UI should show
 * a progress bar for the run").
 *
 * A 100+100 suite run takes minutes. Until now the dialog showed a spinner
 * with "Running every suite query…" and no number, which is indistinguishable
 * from a hang — and the async 202+poll work made that worse, because the poll
 * simply waited. The server now carries `{phase, done, total}` on the live run
 * envelope, and these pin that the dialog actually RENDERS it rather than
 * discarding it in the poll loop.
 */

const { mount } = require('@vue/test-utils');
const dispatch = jest.fn();

jest.mock('@/services/headTestService', () => ({
  default: {
    runSuite: jest.fn(),
    getRun: jest.fn(),
    getSuite: jest.fn(),
    listRuns: jest.fn()
  }
}));
jest.mock('oidc-client-ts', () => ({ UserManager: jest.fn() }));

const OkfTestingLabDialog = require('@/components/okf/editor/TestingLabDialog.vue').default;

const REPO = {
  repo_id: 'r-1',
  name: 'Test repo',
  head: { vector: { tags: [] }, updated_at: '2026-01-01T00:00:00Z' }
};

function fakeStore() {
  return {
    getters: { 'okf/isExpert': false },
    // Every dispatch resolves to a shaped envelope — the dialog dereferences
    // the result unguarded on several paths (refreshRuns), so a bare
    // mockResolvedValue(undefined) crashes the mount.
    dispatch: (action, payload) => {
      const r = dispatch(action, payload);
      return r === undefined ? Promise.resolve({ ok: true, result: null, runs: [] }) : r;
    }
  };
}

function mountDialog(props = {}) {
  return mount(OkfTestingLabDialog, {
    global: {
      mocks: { $store: fakeStore() },
      stubs: {
        DsDialog: { template: '<div><slot /></div>' },
        DsTabs: { template: '<div><slot /></div>' },
        DsInfoTip: true,
        DsSpinner: true
      }
    },
    props: { visible: true, repo: REPO, ...props }
  });
}

const summary = {
  pass_rate: 1,
  positive_passed: 1,
  positive_total: 1,
  negative_passed: 0,
  negative_total: 0,
  negative_evaluatable: 0,
  avg_margin: null,
  steals: []
};

describe('TestingLabDialog — 1-8g-x run progress bar', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    dispatch.mockReset();
  });
  afterEach(() => jest.useRealTimers());

  it('keeps the LIVE {phase, done, total} from each poll instead of discarding it', async () => {
    const w = mountDialog({ initialTab: 'suites' });
    await w.vm.$nextTick();
    w.vm.suite = { suite_key: 's1', payload: { positive: [{ query: 'q1', kind: 'positive' }], negative: [] } };

    // Round 18 (#80465): the wait is the store's okf/pollHeadSuiteRun now —
    // the live bar is fed through the onProgress tap the dialog passes in
    // the dispatch payload, and the terminal doc resolves the action.
    dispatch.mockImplementation((action, payload) => {
      if (action === 'okf/headSuiteRun')
        return Promise.resolve({ ok: true, result: { run_key: 'r9', status: 'running' } });
      if (action === 'okf/pollHeadSuiteRun') {
        payload.onProgress({ phase: 'routing', done: 12, total: 200 });
        return new Promise((resolve) => {
          setTimeout(() => payload.onProgress({ phase: 'corpus', done: 180, total: 200 }), 1500);
          setTimeout(
            () => resolve({ ok: true, result: { _key: 'r9', suite_key: 's1', payload: { summary, results: [] } } }),
            2000
          );
        });
      }
      return Promise.resolve({ ok: true, result: null });
    });

    w.vm.busy = 'run';
    w.vm.onRunSuite();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    // The bar is bound to the poll's own counts, not an animation.
    expect(w.vm.runProgress).toEqual({ phase: 'routing', done: 12, total: 200 });
    expect(w.vm.runProgressLabel).toContain('12 of 200');
    expect(w.vm.runProgressLabel).toContain('6%');
    expect(w.vm.runProgressLabel).toContain('Scoring routes');

    await jest.advanceTimersByTimeAsync(2500);
    await w.vm.$nextTick();
    expect(w.vm.runProgressLabel).toContain('180 of 200');
    expect(w.vm.runProgressLabel).toContain('Checking the corpus');
    // The terminal doc landed through the same action — adopted, not lost.
    expect(w.vm.lastRunSummary).toMatchObject({ pass_rate: 1 });
    expect(w.vm.busy).toBeNull();
  });

  it('starts indeterminate and never shows the previous run counts', async () => {
    const w = mountDialog({ initialTab: 'suites' });
    await w.vm.$nextTick();
    w.vm.suite = { suite_key: 's1', payload: { positive: [{ query: 'q1', kind: 'positive' }], negative: [] } };
    w.vm.runProgress = { phase: 'routing', done: 99, total: 99 }; // a previous run

    dispatch.mockImplementation((action) => {
      if (action === 'okf/headSuiteRun')
        return Promise.resolve({ ok: true, result: { run_key: 'r9', status: 'running' } });
      if (action === 'okf/pollHeadSuiteRun') {
        // In flight, reporting nothing yet.
        return new Promise(() => {});
      }
      return Promise.resolve({ ok: true, result: null });
    });
    w.vm.onRunSuite();
    await Promise.resolve();
    await Promise.resolve();
    // Reset, not stale — showing 99/99 while the new run starts is a lie.
    expect(w.vm.runProgress).toBeNull();
    expect(w.vm.runProgressLabel).toBe('Starting the run…');
  });
});
