'use strict';

/**
 * EDITOR REPO-WIDE PII RE-SCAN (2026-10-13).
 *
 * The remedy existed only on the Validate step. A curator in the editor with a
 * concept stuck on a scan ERROR — the one pii_state that blocks the hand-off
 * and that no per-occurrence action can clear — had to leave their work to fix
 * it. The remedy was reachable from one screen out of three: the same defect
 * class as the incident.
 *
 * NON-VACUOUS: the load-bearing assertion is the ACTION NAME. The editor
 * control must dispatch `okf/startRepoPiiScan` / `okf/getRepoPiiScan` — the
 * exact actions the Validate step uses. Change it to a bespoke call or a new
 * endpoint and this goes red, which is the point: a second code path is the
 * defect, not an implementation detail.
 */

const { mount, enableAutoUnmount } = require('@vue/test-utils');

enableAutoUnmount(afterEach);

const PiiRepoRescan = require('@/components/okf/editor/PiiRepoRescan.vue').default;

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
    { concept_id: 'c1', pii_state: 'clean' },
    { concept_id: 'c2', pii_state: 'hit', pii_hits_summary: { PERSON: 1 } },
    { concept_id: 'c3', pii_state: 'error', pii_hits_summary: null, error: 'ECONNREFUSED sidecar' }
  ]
};

const settle = async (w, ticks = 5) => {
  for (let i = 0; i < ticks; i++) {
    await w.vm.$nextTick();
    await Promise.resolve();
  }
};

/** Records every dispatch; answers only what the caller asked it to answer. */
function mountRescan(props = {}, handlers = {}) {
  const dispatched = [];
  const store = {
    dispatched,
    commit: () => {},
    dispatch(type, payload) {
      dispatched.push({ type, payload });
      if (handlers[type]) return Promise.resolve(handlers[type](payload));
      return Promise.resolve({ ok: false, code: 'UNHANDLED' });
    }
  };
  const w = mount(PiiRepoRescan, {
    propsData: { repoId: 'r1', ...props },
    global: { mocks: { $store: store } }
  });
  return { w, dispatched };
}

const TYPES = (dispatched) => dispatched.map((d) => d.type);

describe('OkfPiiRepoRescan — the editor uses the SAME code path as Validate', () => {
  it('dispatches the SAME store actions the Validate step dispatches', async () => {
    const { w, dispatched } = mountRescan(
      {},
      {
        'okf/startRepoPiiScan': () => ({ ok: true, result: { repo_id: 'r1', scan_key: 'sk1', status: 'running' } }),
        'okf/getRepoPiiScan': () => ({ ok: true, result: RUN_DONE })
      }
    );
    await settle(w);
    await w.vm.onRescan();
    await settle(w);

    // The action names ARE the contract. A bespoke endpoint or a differently
    // named action is a second code path — the defect this story exists to
    // prevent — and this assertion fails on it.
    expect(TYPES(dispatched)).toContain('okf/startRepoPiiScan');
    expect(TYPES(dispatched)).toContain('okf/getRepoPiiScan');
    expect(TYPES(dispatched)).not.toContain('okf/rescanConceptPii'); // per-concept ≠ repo-wide
    expect(dispatched.find((d) => d.type === 'okf/startRepoPiiScan').payload).toEqual({ repoId: 'r1' });
  });

  it('polls the run to a terminal state and reports the tally', async () => {
    jest.useFakeTimers();
    try {
      const { w, dispatched } = mountRescan(
        {},
        {
          'okf/startRepoPiiScan': () => ({ ok: true, result: { repo_id: 'r1', scan_key: 'sk1', status: 'running' } }),
          'okf/getRepoPiiScan': () => ({ ok: true, result: RUN_DONE })
        }
      );
      await settle(w);
      await w.vm.onRescan();
      await settle(w);

      expect(w.vm.busy).toBe(false);
      expect(w.vm.tally).toMatchObject({ scanned: 3, clean: 1, hit: 1, error: 1 });
      expect(w.find('.okf-pii-rescan__note').text()).toContain('1');
      // The still-blocking concept is NAMED — "1 scan error" does not tell the
      // curator which page to open.
      expect(w.find('.okf-pii-rescan__id').text()).toBe('c3');
      expect(w.find('.okf-pii-rescan__detail').text()).toContain('ECONNREFUSED');
      // The concept list is re-read so the freshly-cleared page leaves the set.
      expect(TYPES(dispatched)).toContain('okf/fetchConcepts');
    } finally {
      jest.useRealTimers();
    }
  });

  it('emits rescanned so the shell can refresh the repository row', async () => {
    const { w } = mountRescan(
      {},
      {
        'okf/startRepoPiiScan': () => ({ ok: true, result: { repo_id: 'r1', scan_key: 'sk1', status: 'running' } }),
        'okf/getRepoPiiScan': () => ({ ok: true, result: RUN_DONE })
      }
    );
    await settle(w);
    await w.vm.onRescan();
    await settle(w);
    expect(w.emitted('rescanned')).toBeTruthy();
    expect(w.emitted('rescanned')[0][0]).toMatchObject({ repoId: 'r1' });
  });
});

describe('OkfPiiRepoRescan — every refusal is visible, never a silent no-op', () => {
  it('a 404 on the arm shows the server message', async () => {
    const { w } = mountRescan(
      {},
      { 'okf/startRepoPiiScan': () => ({ ok: false, status: 404, code: 'NOT_FOUND', error: 'Route not found' }) }
    );
    await settle(w);
    await w.vm.onRescan();
    await settle(w);

    expect(w.vm.busy).toBe(false);
    expect(w.vm.tally).toBeNull();
    expect(w.find('.okf-pii-rescan__error').exists()).toBe(true);
    expect(w.find('.okf-pii-rescan__error').text()).toContain('Route not found');
  });

  it('a 404 with no server message still says the re-scan is unavailable', async () => {
    const { w } = mountRescan({}, { 'okf/startRepoPiiScan': () => ({ ok: false, status: 404 }) });
    await settle(w);
    await w.vm.onRescan();
    await settle(w);
    expect(w.find('.okf-pii-rescan__error').text()).toContain('404');
  });

  it('a 409 (drain freeze) is reported as a refusal, not a failure', async () => {
    const { w } = mountRescan(
      {},
      { 'okf/startRepoPiiScan': () => ({ ok: false, status: 409, code: 'REPO_DRAINING' }) }
    );
    await settle(w);
    await w.vm.onRescan();
    await settle(w);
    const text = w.find('.okf-pii-rescan__error').text();
    // The refusal names its cause and says nothing changed. The code is NOT
    // appended here: it matches the explanation already shown, and repeating it
    // reads as a second, contradictory error.
    expect(text).toContain('409');
    expect(text).toContain('Nothing was changed');
    expect(text).not.toContain('Re-scan failed');
  });

  it('surfaces an UNEXPECTED error code alongside the 409 explanation', async () => {
    // A code the curator has never seen must still reach them — otherwise the
    // message would assert a cause the server did not report.
    const { w } = mountRescan(
      {},
      { 'okf/startRepoPiiScan': () => ({ ok: false, status: 409, code: 'SOMETHING_NEW' }) }
    );
    await settle(w);
    await w.vm.onRescan();
    await settle(w);
    expect(w.find('.okf-pii-rescan__error').text()).toContain('SOMETHING_NEW');
  });

  it('a FAILED run shows an error and does not leave the button spinning', async () => {
    const { w, dispatched } = mountRescan(
      {},
      {
        'okf/startRepoPiiScan': () => ({ ok: true, result: { repo_id: 'r1', scan_key: 'sk1', status: 'running' } }),
        'okf/getRepoPiiScan': () => ({
          ok: true,
          result: { status: 'failed', error: { message: 'sidecar unreachable' } }
        })
      }
    );
    await settle(w);
    await w.vm.onRescan();
    await settle(w);

    expect(w.vm.busy).toBe(false);
    expect(w.find('.okf-pii-rescan__error').text()).toContain('sidecar unreachable');
    // A terminal state — nothing may keep polling behind the visible error.
    expect(TYPES(dispatched).filter((t) => t === 'okf/getRepoPiiScan')).toHaveLength(1);
  });

  it('an accepted run with NO scan_key is reported, not left spinning', async () => {
    const { w } = mountRescan(
      {},
      { 'okf/startRepoPiiScan': () => ({ ok: true, result: { repo_id: 'r1', status: 'running' } }) }
    );
    await settle(w);
    await w.vm.onRescan();
    await settle(w);
    expect(w.vm.busy).toBe(false);
    expect(w.find('.okf-pii-rescan__error').text()).toContain('no run id');
  });

  it('refuses a second concurrent run rather than firing a duplicate write', async () => {
    jest.useFakeTimers();
    try {
      const { w, dispatched } = mountRescan(
        {},
        {
          'okf/startRepoPiiScan': () => ({ ok: true, result: { repo_id: 'r1', scan_key: 'sk1', status: 'running' } }),
          'okf/getRepoPiiScan': () => ({ ok: true, result: { status: 'running', progress: { done: 0, total: 9 } } })
        }
      );
      await settle(w);
      await w.vm.onRescan();
      await settle(w);
      await w.vm.onRescan(); // curator mashes the button mid-run
      await settle(w);

      expect(TYPES(dispatched).filter((t) => t === 'okf/startRepoPiiScan')).toHaveLength(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('hides the control entirely on a read-only (serving) repository', async () => {
    const { w } = mountRescan({ readOnly: true });
    await settle(w);
    // The write would 409 anyway — offering a button that can only fail is the
    // dead control this story keeps out.
    expect(w.find('button').exists()).toBe(false);
  });
});

describe('OkfPiiRepoRescan — a late result can never land on the wrong subject', () => {
  it('discards the run when the curator switches CONCEPT mid-flight', async () => {
    jest.useFakeTimers();
    try {
      let release;
      const gate = new Promise((res) => (release = res));
      const { w } = mountRescan(
        { conceptId: 'c1' },
        {
          'okf/startRepoPiiScan': () => ({ ok: true, result: { repo_id: 'r1', scan_key: 'sk1', status: 'running' } }),
          'okf/getRepoPiiScan': () => gate
        }
      );
      await settle(w);
      await w.vm.onRescan();
      await settle(w, 1); // poll is in flight, still unresolved

      // The curator clicks another page while the run is being polled.
      w.setProps({ conceptId: 'c2' });
      release({ ok: true, result: RUN_DONE });
      await settle(w);

      // The answer describes the state under c1; it must not be painted on the
      // panel now showing c2.
      expect(w.vm.tally).toBeNull();
      expect(w.find('.okf-pii-rescan__tally').exists()).toBe(false);
      expect(w.emitted('rescanned')).toBeFalsy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('discards the run when the curator switches REPOSITORY mid-flight', async () => {
    jest.useFakeTimers();
    try {
      let release;
      const gate = new Promise((res) => (release = res));
      const { w, dispatched } = mountRescan(
        { repoId: 'r1' },
        {
          'okf/startRepoPiiScan': () => ({ ok: true, result: { repo_id: 'r1', scan_key: 'sk1', status: 'running' } }),
          'okf/getRepoPiiScan': () => gate
        }
      );
      await settle(w);
      await w.vm.onRescan();
      await settle(w, 1);

      w.setProps({ repoId: 'r2' });
      release({ ok: true, result: RUN_DONE });
      await settle(w);

      expect(w.vm.tally).toBeNull();
      expect(w.vm.error).toBe('');
      expect(w.vm.note).toBe('');
      // r1's run must not trigger r2's concept re-read either.
      expect(TYPES(dispatched)).not.toContain('okf/fetchConcepts');
    } finally {
      jest.useRealTimers();
    }
  });

  it('stops polling when the component is torn down mid-run', async () => {
    jest.useFakeTimers();
    try {
      const { w, dispatched } = mountRescan(
        {},
        {
          'okf/startRepoPiiScan': () => ({ ok: true, result: { repo_id: 'r1', scan_key: 'sk1', status: 'running' } }),
          'okf/getRepoPiiScan': () => ({ ok: true, result: { status: 'running', progress: { done: 1, total: 3 } } })
        }
      );
      await settle(w);
      await w.vm.onRescan();
      await settle(w);

      w.unmount();
      await jest.advanceTimersByTimeAsync(9000);
      expect(TYPES(dispatched).filter((t) => t === 'okf/getRepoPiiScan')).toHaveLength(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('discards an ARM answer that lands after the subject moved on', async () => {
    let release;
    const gate = new Promise((res) => (release = res));
    const { w, dispatched } = mountRescan({ repoId: 'r1' }, { 'okf/startRepoPiiScan': () => gate });
    await settle(w);
    const inFlight = w.vm.onRescan();
    await settle(w, 1);

    // The repository changes while the ARM request is in flight.
    w.setProps({ repoId: 'r2' });
    release({ ok: true, result: { repo_id: 'r1', scan_key: 'sk1', status: 'running' } });
    await inFlight;
    await settle(w);

    // The arm carried r1's scan key — polling it under r2 would be a
    // cross-repository write. It must never be followed.
    expect(TYPES(dispatched)).not.toContain('okf/getRepoPiiScan');
    expect(w.vm.busy).toBe(false);
  });
});

describe('OkfPiiRepoRescan — progress and partial outcomes', () => {
  it('renders live progress while the detached run is in flight', async () => {
    jest.useFakeTimers();
    try {
      const { w } = mountRescan(
        {},
        {
          'okf/startRepoPiiScan': () => ({ ok: true, result: { repo_id: 'r1', scan_key: 'sk1', status: 'running' } }),
          'okf/getRepoPiiScan': () => ({ ok: true, result: { status: 'running', progress: { done: 4, total: 40 } } })
        }
      );
      await settle(w);
      await w.vm.onRescan();
      await settle(w);

      expect(w.vm.busy).toBe(true);
      expect(w.find('.okf-pii-rescan__note').text()).toContain('4');
      expect(w.find('.okf-pii-rescan__note').text()).toContain('40');
      // The button is disabled mid-run (double-submit guard).
      expect(w.find('button').attributes('disabled')).toBeDefined();
    } finally {
      jest.useRealTimers();
    }
  });

  it('a partial run says what is STILL blocking, not just what was re-scanned', async () => {
    const PARTIAL = { ...RUN_DONE, scanned: 5, clean: 4, hit: 0, error: 1, missing: 0 };
    const { w } = mountRescan(
      {},
      {
        'okf/startRepoPiiScan': () => ({ ok: true, result: { repo_id: 'r1', scan_key: 'sk1', status: 'running' } }),
        'okf/getRepoPiiScan': () => ({ ok: true, result: PARTIAL })
      }
    );
    await settle(w);
    await w.vm.onRescan();
    await settle(w);

    expect(w.find('.okf-pii-rescan__note').text()).toContain('still failed');
    expect(w.find('.okf-pii-rescan__id').exists()).toBe(true);
  });

  it('normalises missing counters to 0, never "undefined"', async () => {
    const SPARSE = { status: 'done', scan_key: 'sk1' };
    const { w } = mountRescan(
      {},
      {
        'okf/startRepoPiiScan': () => ({ ok: true, result: { repo_id: 'r1', scan_key: 'sk1', status: 'running' } }),
        'okf/getRepoPiiScan': () => ({ ok: true, result: SPARSE })
      }
    );
    await settle(w);
    await w.vm.onRescan();
    await settle(w);

    expect(w.vm.tally).toMatchObject({ scanned: 0, clean: 0, hit: 0, error: 0, missing: 0, results: [] });
    expect(w.text()).not.toContain('undefined');
    expect(w.text()).not.toContain('NaN');
  });
});
