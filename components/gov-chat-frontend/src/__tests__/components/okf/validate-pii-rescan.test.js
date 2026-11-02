'use strict';

/**
 * PII RE-SCAN HONESTY — the repo-level re-scan in Step 7 (2026-10-12).
 *
 * A concept whose scan ERRORED cannot be cleared by any per-occurrence action:
 * "Accept all" is scan-free arithmetic that subtracts occurrences (an 'error'
 * has none), and version-service.js deliberately does NOT let an 'error' be
 * waived by acknowledgement — only a reviewed 'hit' can. Correct behaviour,
 * unreachable outcome. The cure is the server's repo-wide concept rescan
 * (`POST /:repo_id/pii-scan {"scope":"concepts"}`), which walks the
 * okf_concepts_meta rows the publish gate actually reads.
 *
 * The run is DETACHED (202 + poll): one sidecar round-trip per concept cannot
 * finish inside a gateway timeout. So the panel's whole job is: arm the run,
 * poll until a TERMINAL state, and report the tally — a poll that stops on
 * 'running' forever is the exact dead end this story exists to avoid (the same
 * class of bug as the topic-link spinner).
 *
 * It also pins the visibility fix: the flagged list filtered
 * pii_state === 'hit' only, so the ONE concept blocking publish had no row.
 */

const { mount } = require('@vue/test-utils');
const Vuex = require('vuex');

// The panel is stubbed here: this file is about the STEP, not the panel
// (pii-panel-rescan.test.js drives the panel directly).
jest.mock('@/components/okf/editor/PiiOccurrences.vue', () => ({
  name: 'OkfPiiOccurrences',
  props: ['repoId', 'conceptId', 'revision', 'readOnly'],
  template: '<div class="pii-stub" />'
}));

const Validate = require('@/components/okf/steps/Validate.vue').default;

// Microtask-only flush where possible; the poll re-arms itself with setTimeout,
// so those tests drive fake timers.
const settle = async (w, ticks = 4) => {
  for (let i = 0; i < ticks; i++) {
    await w.vm.$nextTick();
    await Promise.resolve();
  }
};

function mountStep(concepts, overrides = {}) {
  const dispatched = [];
  const store = new Vuex.Store({
    modules: {
      okf: {
        namespaced: true,
        getters: {
          repoById: () => () => ({ repo_id: 'r1', lifecycle_state: 'draft' }),
          isExpert: () => false
        }
      }
    }
  });
  store.dispatch = (type, payload) => {
    dispatched.push({ type, payload });
    if (type === 'okf/fetchConcepts') return Promise.resolve({ ok: true, concepts });
    if (type === 'okf/fetchRepoMetrics') return Promise.resolve({ ok: true, metrics: null });
    if (type === 'okf/fetchValidation')
      return Promise.resolve({ ok: true, report: { issues: [], summary: { total: 0 } } });
    if (overrides[type]) return Promise.resolve(overrides[type](payload));
    return Promise.resolve({ ok: false });
  };
  const w = mount(Validate, {
    props: { draft: { repo_id: 'r1', concept_count: concepts.length }, expert: false },
    global: { plugins: [store] }
  });
  return { w, dispatched };
}

// The terminal run document, in the server's own field names.
const RUN_DONE = {
  repo_id: 'r1',
  scan_key: 'sk1',
  status: 'done',
  scanned: 3,
  clean: 1,
  hit: 1,
  error: 1,
  missing: 0,
  results: [
    { concept_id: 'c1', pii_state: 'clean', pii_hits_summary: null },
    { concept_id: 'c2', pii_state: 'hit', pii_hits_summary: { PERSON: 1 } },
    { concept_id: 'c3', pii_state: 'error', pii_hits_summary: null, error: 'ECONNREFUSED sidecar' }
  ]
};

describe('OkfStepValidate — repo-wide PII re-scan (2026-10-12)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('lists a concept whose scan ERRORED alongside flagged ones', async () => {
    const { w } = mountStep([
      { concept_id: 'c1', title: 'One', pii_state: 'clean' },
      { concept_id: 'c2', title: 'Two', pii_state: 'hit' },
      { concept_id: 'c3', title: 'Three', pii_state: 'error' }
    ]);
    await settle(w);

    // c3 was invisible: the list filtered pii_state === 'hit' only, so the ONE
    // concept blocking publish had no row to select.
    expect(w.vm.piiConcepts.map((c) => c.concept_id)).toEqual(['c2', 'c3']);
    expect(w.text()).toContain('Scan error');
  });

  it('arms the run with scope:concepts and follows the scan_key it returns', async () => {
    const { w, dispatched } = mountStep([{ concept_id: 'c3', title: 'Three', pii_state: 'error' }], {
      'okf/startRepoPiiScan': () => ({ ok: true, result: { repo_id: 'r1', scan_key: 'sk1', status: 'running' } }),
      'okf/getRepoPiiScan': () => ({ ok: true, result: RUN_DONE })
    });
    await settle(w);

    await w.vm.onRescanAllPii();
    await settle(w);

    expect(dispatched.find((d) => d.type === 'okf/startRepoPiiScan').payload).toEqual({ repoId: 'r1' });
    expect(w.vm.piiRescanKey).toBe('sk1');
    expect(dispatched.find((d) => d.type === 'okf/getRepoPiiScan').payload).toEqual({ repoId: 'r1', scanKey: 'sk1' });
  });

  it('keeps polling while the run is running, showing real progress', async () => {
    const { w, dispatched } = mountStep([{ concept_id: 'c3', title: 'Three', pii_state: 'error' }], {
      'okf/startRepoPiiScan': () => ({ ok: true, result: { repo_id: 'r1', scan_key: 'sk1', status: 'running' } }),
      'okf/getRepoPiiScan': () => ({
        ok: true,
        result: { status: 'running', progress: { phase: 'concepts', done: 2, total: 10 } }
      })
    });
    await settle(w);
    await w.vm.onRescanAllPii();
    await settle(w);

    expect(w.text()).toContain('2 of 10');
    expect(w.vm.piiRescanBusy).toBe(true);

    // A run stuck on 'running' must keep the button disabled and re-arm.
    await jest.advanceTimersByTimeAsync(3000);
    await settle(w);
    expect(dispatched.filter((d) => d.type === 'okf/getRepoPiiScan').length).toBe(2);
  });

  // Round 19, #80774: a run wedged at 'running' (worker crash without
  // reaping) used to re-arm the 3s timer FOREVER. Past the 15-minute horizon
  // the poll stops with a readable timeout; the button releases.
  it('gives up with a readable timeout after 15 minutes of a wedged running run', async () => {
    const { w, dispatched } = mountStep([{ concept_id: 'c3', title: 'Three', pii_state: 'error' }], {
      'okf/startRepoPiiScan': () => ({ ok: true, result: { repo_id: 'r1', scan_key: 'sk1', status: 'running' } }),
      'okf/getRepoPiiScan': () => ({
        ok: true,
        result: { status: 'running', progress: { phase: 'concepts', done: 2, total: 10 } }
      })
    });
    await settle(w);
    await w.vm.onRescanAllPii();
    await settle(w);

    // Past the ceiling: the timeout surfaces and polling STOPS.
    await jest.advanceTimersByTimeAsync(15 * 60 * 1000 + 3100);
    await settle(w);
    expect(w.vm.piiRescanBusy).toBe(false);
    expect(w.vm.piiRescanError).toBeTruthy();
    expect(w.text()).toContain('still running after 15 minutes');
    const polls = dispatched.filter((d) => d.type === 'okf/getRepoPiiScan').length;
    await jest.advanceTimersByTimeAsync(9000);
    await settle(w);
    expect(dispatched.filter((d) => d.type === 'okf/getRepoPiiScan').length).toBe(polls);
  });

  it('stops at a terminal state and renders the per-concept tally', async () => {
    let poll = 0;
    const { w, dispatched } = mountStep([{ concept_id: 'c3', title: 'Three', pii_state: 'error' }], {
      'okf/startRepoPiiScan': () => ({ ok: true, result: { repo_id: 'r1', scan_key: 'sk1', status: 'running' } }),
      'okf/getRepoPiiScan': () => {
        poll += 1;
        return Promise.resolve({
          ok: true,
          result: poll === 1 ? { status: 'running', progress: { done: 1, total: 3 } } : RUN_DONE
        });
      }
    });
    await settle(w);
    await w.vm.onRescanAllPii();
    await settle(w);
    await jest.advanceTimersByTimeAsync(3000);
    await settle(w);

    expect(w.vm.piiRescanTally).toMatchObject({ scanned: 3, clean: 1, hit: 1, error: 1, missing: 0 });
    expect(w.text()).toContain('3 page(s) re-scanned');
    expect(w.vm.piiRescanBusy).toBe(false);

    // Terminal: no further polling once the tally is in.
    const before = dispatched.filter((d) => d.type === 'okf/getRepoPiiScan').length;
    await jest.advanceTimersByTimeAsync(9000);
    await settle(w);
    expect(dispatched.filter((d) => d.type === 'okf/getRepoPiiScan').length).toBe(before);
  });

  it('names the concepts still blocking, with their reason', async () => {
    const { w } = mountStep([{ concept_id: 'c3', title: 'Three', pii_state: 'error' }], {
      'okf/startRepoPiiScan': () => ({ ok: true, result: { repo_id: 'r1', scan_key: 'sk1', status: 'running' } }),
      'okf/getRepoPiiScan': () => ({ ok: true, result: RUN_DONE })
    });
    await settle(w);
    await w.vm.onRescanAllPii();
    await settle(w);

    expect(w.vm.piiRescanErrors.map((r) => r.concept_id)).toEqual(['c3']);
    expect(w.text()).toContain('c3');
    expect(w.text()).toContain('ECONNREFUSED sidecar');
    expect(w.text()).toContain('Still blocking');
  });

  it('surfaces a concept that VANISHED mid-run (never counted as clean)', async () => {
    const { w } = mountStep([{ concept_id: 'c9', title: 'Nine', pii_state: 'error' }], {
      'okf/startRepoPiiScan': () => ({ ok: true, result: { repo_id: 'r1', scan_key: 'sk1', status: 'running' } }),
      'okf/getRepoPiiScan': () => ({
        ok: true,
        result: {
          ...RUN_DONE,
          missing: 1,
          results: [{ concept_id: 'c9', pii_state: null, skipped: 'CONCEPT_NOT_FOUND' }]
        }
      })
    });
    await settle(w);
    await w.vm.onRescanAllPii();
    await settle(w);

    expect(w.vm.piiRescanTally.missing).toBe(1);
    expect(w.text()).toContain('1 vanished');
    expect(w.vm.piiRescanErrors.map((r) => r.concept_id)).toEqual(['c9']);
  });

  // ── FAIL-LOUD: a refused or broken run is never a silent no-op ──────────
  it('a FAILED run is terminal and re-enables the button', async () => {
    const { w, dispatched } = mountStep([{ concept_id: 'c3', title: 'Three', pii_state: 'error' }], {
      'okf/startRepoPiiScan': () => ({ ok: true, result: { repo_id: 'r1', scan_key: 'sk1', status: 'running' } }),
      'okf/getRepoPiiScan': () => ({
        ok: true,
        result: { status: 'failed', error: { code: 'PII_SCAN_NOTHING_SCANNED', message: 'examined no concepts' } }
      })
    });
    await settle(w);
    await w.vm.onRescanAllPii();
    await settle(w);

    expect(w.vm.piiRescanBusy).toBe(false);
    expect(w.find('.okf-step-validate__pii-rescan-error').text()).toContain('examined no concepts');
    // A failed run must NOT spin forever.
    await jest.advanceTimersByTimeAsync(9000);
    await settle(w);
    expect(dispatched.filter((d) => d.type === 'okf/getRepoPiiScan')).toHaveLength(1);
  });

  it('a refused arm (409 drain freeze) shows a visible error and no tally', async () => {
    const { w } = mountStep([{ concept_id: 'c3', title: 'Three', pii_state: 'error' }], {
      'okf/startRepoPiiScan': () => ({ ok: false, status: 409, code: 'REPO_FROZEN', error: 'REPO_FROZEN' })
    });
    await settle(w);
    await w.vm.onRescanAllPii();
    await settle(w);

    expect(w.vm.piiRescanTally).toBeNull();
    expect(w.vm.piiRescanBusy).toBe(false);
    expect(w.find('.okf-step-validate__pii-rescan-error').exists()).toBe(true);
    expect(w.find('.okf-step-validate__pii-rescan-error').text()).toContain('REPO_FROZEN');
  });

  it('a 404 on the arm shows a visible error — never a silent no-op', async () => {
    const { w } = mountStep([{ concept_id: 'c3', title: 'Three', pii_state: 'error' }], {
      'okf/startRepoPiiScan': () => ({ ok: false, status: 404, code: 'NOT_FOUND', error: 'Route not found' })
    });
    await settle(w);
    await w.vm.onRescanAllPii();
    await settle(w);

    expect(w.vm.piiRescanTally).toBeNull();
    expect(w.find('.okf-step-validate__pii-rescan-error').exists()).toBe(true);
    expect(w.find('.okf-step-validate__pii-rescan-error').text()).toContain('Route not found');
  });

  it('a 404 on the POLL is surfaced rather than leaving the button spinning', async () => {
    const { w } = mountStep([{ concept_id: 'c3', title: 'Three', pii_state: 'error' }], {
      'okf/startRepoPiiScan': () => ({ ok: true, result: { repo_id: 'r1', scan_key: 'sk1', status: 'running' } }),
      'okf/getRepoPiiScan': () => ({ ok: false, status: 404, code: 'PII_SCAN_NOT_FOUND', error: 'run not found' })
    });
    await settle(w);
    await w.vm.onRescanAllPii();
    await settle(w);

    expect(w.vm.piiRescanBusy).toBe(false);
    expect(w.find('.okf-step-validate__pii-rescan-error').text()).toContain('run not found');
  });

  it('an accepted run with NO scan_key is reported, not left spinning', async () => {
    const { w } = mountStep([{ concept_id: 'c3', title: 'Three', pii_state: 'error' }], {
      'okf/startRepoPiiScan': () => ({ ok: true, result: { repo_id: 'r1', status: 'running' } })
    });
    await settle(w);
    await w.vm.onRescanAllPii();
    await settle(w);

    expect(w.vm.piiRescanBusy).toBe(false);
    expect(w.find('.okf-step-validate__pii-rescan-error').text()).toContain('no run id');
  });

  it('refuses a second concurrent re-scan', async () => {
    const { w, dispatched } = mountStep([{ concept_id: 'c3', title: 'Three', pii_state: 'error' }], {
      'okf/startRepoPiiScan': () => ({ ok: true, result: { repo_id: 'r1', scan_key: 'sk1', status: 'running' } }),
      'okf/getRepoPiiScan': () => ({ ok: true, result: { status: 'running', progress: { done: 0, total: 9 } } })
    });
    await settle(w);

    await w.vm.onRescanAllPii();
    await settle(w);
    await w.vm.onRescanAllPii(); // curator mashes the button mid-run
    await settle(w);

    expect(dispatched.filter((d) => d.type === 'okf/startRepoPiiScan')).toHaveLength(1);
  });

  it('stops polling when the step is torn down mid-run', async () => {
    const { w, dispatched } = mountStep([{ concept_id: 'c3', title: 'Three', pii_state: 'error' }], {
      'okf/startRepoPiiScan': () => ({ ok: true, result: { repo_id: 'r1', scan_key: 'sk1', status: 'running' } }),
      'okf/getRepoPiiScan': () => ({ ok: true, result: { status: 'running', progress: { done: 1, total: 9 } } })
    });
    await settle(w);
    await w.vm.onRescanAllPii();
    await settle(w);
    const before = dispatched.filter((d) => d.type === 'okf/getRepoPiiScan').length;

    w.unmount();
    await jest.advanceTimersByTimeAsync(9000);
    // A detached poll would keep hitting the API for a panel nobody is watching.
    expect(dispatched.filter((d) => d.type === 'okf/getRepoPiiScan').length).toBe(before);
  });

  it('reports a clean run with no error banner', async () => {
    const { w } = mountStep([{ concept_id: 'c1', title: 'One', pii_state: 'hit' }], {
      'okf/startRepoPiiScan': () => ({ ok: true, result: { repo_id: 'r1', scan_key: 'sk1', status: 'running' } }),
      'okf/getRepoPiiScan': () => ({
        ok: true,
        result: { status: 'done', scanned: 2, clean: 2, hit: 0, error: 0, missing: 0, results: [] }
      })
    });
    await settle(w);
    await w.vm.onRescanAllPii();
    await settle(w);

    expect(w.vm.piiRescanError).toBe('');
    expect(w.vm.piiRescanNote).toContain('2 page(s)');
    expect(w.text()).not.toContain('Still blocking');
  });

  it('coerces a missing counter to 0 rather than rendering "undefined"', async () => {
    const { w } = mountStep([{ concept_id: 'c1', title: 'One', pii_state: 'hit' }], {
      'okf/startRepoPiiScan': () => ({ ok: true, result: { repo_id: 'r1', scan_key: 'sk1', status: 'running' } }),
      'okf/getRepoPiiScan': () => ({ ok: true, result: { status: 'done', scanned: 1, results: [] } })
    });
    await settle(w);
    await w.vm.onRescanAllPii();
    await settle(w);

    expect(w.vm.piiRescanTally).toMatchObject({ scanned: 1, clean: 0, hit: 0, error: 0, missing: 0 });
    expect(w.text()).not.toContain('undefined');
  });
});
