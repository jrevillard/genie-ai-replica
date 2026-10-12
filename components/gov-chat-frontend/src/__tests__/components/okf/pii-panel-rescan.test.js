'use strict';

/**
 * PII RE-SCAN HONESTY — the per-concept panel (2026-10-12).
 *
 * The defect this pins: the panel's "Re-scan" button called pii-inspect with
 * {rescan:true} — a route the server documents "Nothing persisted". It
 * refreshed the DISPLAY and left pii_state byte-identical, so a concept stuck
 * on pii_state 'error' looked re-scanned and stayed blocked forever. "Accept
 * all" could not rescue it either (it subtracts occurrences; an 'error' has
 * none, and an 'error' is deliberately not waivable by acknowledgement).
 *
 * What this file pins:
 *   1. Re-scan WRITES (POST /pii-scan {concepts:[…]}) and is not inspect.
 *   2. A concept whose scan ERRORED renders visibly distinct from a clean one.
 *   3. A missing endpoint (404) is a VISIBLE error, never a silent no-op.
 *   4. A late answer for a previously-selected concept is discarded.
 */

const { mount } = require('@vue/test-utils');

const repoOkfService = require('@/services/repoOkfService').default;

jest.mock('@/services/repoOkfService', () => ({
  __esModule: true,
  default: {
    inspectPii: jest.fn(),
    getConcept: jest.fn(),
    scanConceptPii: jest.fn()
  }
}));

const PiiOccurrences = require('@/components/okf/editor/PiiOccurrences.vue').default;

const settle = async (w, ticks = 4) => {
  for (let i = 0; i < ticks; i++) {
    await w.vm.$nextTick();
    await Promise.resolve();
  }
};

// An inspect payload for a concept whose persisted verdict is 'error'.
const INSPECT_ERROR = { ok: false, state: 'error', occurrences: [], resolutions: [] };
// The concept the panel loads before handing its content to the scan.
const CONCEPT = { concept_id: 'c1', frontmatter: { type: 'topic' }, body: '# Solar' };
// The persisting scan's answer: the VERDICT, not the findings list.
const SCAN_CLEAN = { repo_id: 'r1', scanned: 1, results: [{ concept_id: 'c1', pii_state: 'clean' }] };

function mountPanel(props = {}) {
  return mount(PiiOccurrences, {
    props: { repoId: 'r1', conceptId: 'c1', ...props }
  });
}

describe('OkfPiiOccurrences — Re-scan PERSISTS (2026-10-12)', () => {
  beforeEach(() => {
    repoOkfService.inspectPii.mockReset();
    repoOkfService.getConcept.mockReset();
    repoOkfService.scanConceptPii.mockReset();
    repoOkfService.inspectPii.mockResolvedValue({ ok: true, state: 'clean', occurrences: [], resolutions: [] });
    repoOkfService.getConcept.mockResolvedValue(CONCEPT);
    repoOkfService.scanConceptPii.mockResolvedValue(SCAN_CLEAN);
  });

  // ── 1. THE RE-SCAN CALLS THE PERSISTING ENDPOINT ─────────────────────────
  it('Re-scan WRITES via the persisting scan, not the non-persisting inspect', async () => {
    const w = mountPanel();
    await settle(w);

    await w.vm.rescan();
    await settle(w);

    // The concept's own content rides the request — the server scans what it
    // is handed, so an empty body would scan nothing and write a meaningless
    // verdict.
    expect(repoOkfService.scanConceptPii).toHaveBeenCalledWith('r1', 'c1', {
      frontmatter: { type: 'topic' },
      body: '# Solar'
    });
  });

  it('adopts the persisted pii_state from the scan result', async () => {
    repoOkfService.scanConceptPii.mockResolvedValue({
      repo_id: 'r1',
      scanned: 1,
      results: [{ concept_id: 'c1', pii_state: 'hit', pii_hits_summary: { PERSON: 1 } }]
    });
    const w = mountPanel();
    await settle(w);
    await w.vm.rescan();
    await settle(w);

    // pii_state is what the publish gate reads — the panel shows THAT, not a
    // locally derived "has occurrences?" guess.
    expect(w.vm.piiState).toBe('hit');
    expect(w.vm.ok).toBe(true);
  });

  it('re-reads the occurrences after the write, because pii-scan returns only the verdict', async () => {
    repoOkfService.inspectPii.mockResolvedValue({
      ok: true,
      state: 'hit',
      occurrences: [{ where: 'body', type: 'PERSON', start: 0, end: 4, score: 0.9 }],
      resolutions: []
    });
    const w = mountPanel();
    await settle(w);
    await w.vm.rescan();
    await settle(w);

    expect(w.vm.occurrences).toHaveLength(1);
    // The read is the READ-ONLY route — used for what it is good at.
    const lastInspect = repoOkfService.inspectPii.mock.calls[repoOkfService.inspectPii.mock.calls.length - 1];
    expect(lastInspect).toEqual(['r1', 'c1', { rescan: false }]);
  });

  // ── 2. pii_state IS SURFACED HONESTLY ───────────────────────────────────
  it('renders a FAILED scan as blocking, not as "no findings"', async () => {
    repoOkfService.inspectPii.mockResolvedValue(INSPECT_ERROR);
    const w = mountPanel();
    await settle(w);

    expect(w.vm.piiState).toBe('error');
    // The failure must be VISIBLE and must not read like a clean page.
    expect(w.text()).toContain('blocking the hand-off');
    expect(w.text()).not.toContain('this concept is clear');
    expect(w.find('.okf-pii__state-error').exists()).toBe(true);
  });

  it('shows the server-supplied reason a scan failed', async () => {
    repoOkfService.scanConceptPii.mockResolvedValue({
      repo_id: 'r1',
      scanned: 1,
      results: [{ concept_id: 'c1', pii_state: 'error', error: 'ECONNREFUSED 172.18.0.9:5001' }]
    });
    const w = mountPanel();
    await settle(w);
    await w.vm.rescan();
    await settle(w);

    // Fail-closed is honest only if the curator can see WHY it is stuck.
    expect(w.text()).toContain('ECONNREFUSED 172.18.0.9:5001');
    expect(w.vm.piiState).toBe('error');
  });

  it('a failed re-scan stays blocking — a 200 is NOT a clean verdict', async () => {
    // Fail-closed semantics: a sidecar transport failure is not an HTTP error.
    // The server answers 200 with pii_state 'error' written to the row.
    repoOkfService.scanConceptPii.mockResolvedValue({
      repo_id: 'r1',
      scanned: 1,
      results: [{ concept_id: 'c1', pii_state: 'error' }]
    });
    const w = mountPanel();
    await settle(w);
    await w.vm.rescan();
    await settle(w);

    expect(w.vm.piiState).toBe('error');
    expect(w.vm.ok).toBe(false);
    expect(w.find('.okf-pii__state-error').exists()).toBe(true);
  });

  // ── 3. A MISSING ENDPOINT IS VISIBLE, NEVER SILENT ──────────────────────
  it('a 404 from the persisting scan renders a visible error', async () => {
    repoOkfService.scanConceptPii.mockRejectedValue({
      status: 404,
      data: { error: 'NOT_FOUND', message: 'Route POST /pii-scan not found' }
    });
    const w = mountPanel();
    await settle(w);
    await w.vm.rescan();
    await settle(w);

    // httpService rejects with {status, data:{...}} — the message must reach
    // the panel. A swallowed rejection is the exact bug being fixed.
    const err = w.find('.okf-pii__error');
    expect(err.exists()).toBe(true);
    expect(err.text()).toContain('Route POST /pii-scan not found');
  });

  it('a 400 (PII_SCAN_NOTHING_SCANNED) is surfaced, not swallowed', async () => {
    repoOkfService.scanConceptPii.mockRejectedValue({
      status: 400,
      data: { error: 'PII_SCAN_NOTHING_SCANNED', message: 'PII scan examined no content' }
    });
    const w = mountPanel();
    await settle(w);
    await w.vm.rescan();
    await settle(w);

    expect(w.find('.okf-pii__error').text()).toContain('PII scan examined no content');
  });

  it('a 409 (drain freeze) is surfaced, not swallowed', async () => {
    repoOkfService.scanConceptPii.mockRejectedValue({ status: 409, data: { error: 'REPO_FROZEN' } });
    const w = mountPanel();
    await settle(w);
    await w.vm.rescan();
    await settle(w);

    expect(w.find('.okf-pii__error').exists()).toBe(true);
    expect(w.find('.okf-pii__error').text()).toContain('Re-scan refused');
    expect(w.find('.okf-pii__error').text()).toContain('409');
  });

  it('surfaces an unrecognised server error code alongside the explanation', async () => {
    // A code the UI has no canned prose for must still reach the curator.
    repoOkfService.scanConceptPii.mockRejectedValue({ status: 409, data: { error: 'DRAIN_SNAPSHOT_LOST' } });
    const w = mountPanel();
    await settle(w);
    await w.vm.rescan();
    await settle(w);

    expect(w.find('.okf-pii__error').text()).toContain('DRAIN_SNAPSHOT_LOST');
  });

  it('a concept that cannot be loaded fails loudly instead of scanning nothing', async () => {
    repoOkfService.getConcept.mockResolvedValue(null);
    const w = mountPanel();
    await settle(w);
    await w.vm.rescan();
    await settle(w);

    // Scanning an empty body would write a verdict that means nothing — the
    // honest outcome is to refuse and say so.
    expect(repoOkfService.scanConceptPii).not.toHaveBeenCalled();
    expect(w.find('.okf-pii__error').exists()).toBe(true);
    expect(w.find('.okf-pii__error').text()).toContain("Concept 'c1'");
  });

  // ── 4. STALE-ANSWER GUARD ───────────────────────────────────────────────
  it('discards a late answer for a concept the curator already left', async () => {
    // Only the FIRST inspect (c1's open) is held open; c2's resolves at once.
    // A single `release` handle would be overwritten by c2's call — setProps
    // fires the watcher synchronously, before the reconfiguration below.
    let calls = 0;
    let releaseFirst;
    repoOkfService.inspectPii.mockImplementation(() => {
      calls += 1;
      if (calls === 1) {
        return new Promise((resolve) => {
          releaseFirst = () => resolve({ ok: true, state: 'hit', occurrences: [{ type: 'PERSON' }], resolutions: [] });
        });
      }
      return Promise.resolve({ ok: true, state: 'clean', occurrences: [], resolutions: [] });
    });

    const w = mountPanel();
    await w.vm.$nextTick(); // c1's open scan is in flight, unresolved

    await w.setProps({ conceptId: 'c2' }); // curator moves on
    await settle(w);
    expect(w.vm.piiState).toBe('clean');

    // c1's answer lands late. It describes a page no longer on screen.
    releaseFirst();
    await settle(w);

    expect(w.vm.piiState).not.toBe('hit');
    expect(w.vm.occurrences).toHaveLength(0);
  });

  it('discards a late re-scan verdict for a superseded concept', async () => {
    let release;
    repoOkfService.scanConceptPii.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ repo_id: 'r1', scanned: 1, results: [{ concept_id: 'c1', pii_state: 'hit' }] });
        })
    );
    const w = mountPanel();
    await settle(w);
    const pending = w.vm.rescan();
    await w.vm.$nextTick();

    await w.setProps({ conceptId: 'c2' });
    release();
    await pending;
    await settle(w);

    // c1's re-scan came back 'hit' — it must not be painted on c2.
    expect(w.vm.piiState).not.toBe('hit');
  });

  // ── 5. THE PRE-WARMED PATH ALSO HONESTLY REPORTS 'error' ────────────────
  it('adopts an error verdict from the parent pre-warmed state', async () => {
    const w = mountPanel({
      initialState: { key: 'c1', state: 'error', occurrences: [], resolutions: [] }
    });
    await settle(w);

    expect(w.vm.piiState).toBe('error');
    expect(w.find('.okf-pii__state-error').exists()).toBe(true);
  });
});
