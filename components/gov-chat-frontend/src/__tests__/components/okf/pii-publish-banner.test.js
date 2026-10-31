'use strict';

/**
 * PUBLISH-TIME PII VISIBILITY (2026-10-13).
 *
 * The incident: a publish SUCCEEDED carrying 107 flagged concepts while the
 * repository's acknowledgement record read 0. The publish dialog had nothing
 * to say about any of it. These tests pin what the dialog now says, and — the
 * part that matters — what it must NOT say.
 *
 * NON-VACUOUS: each test names the false claim it forbids. Remove the banner
 * from the dialog and "renders inside the dialog" goes red; make the verdict
 * collapse unknown → clean and "never reads as all-clear" goes red; drop the
 * ack freshness check and "stale ack" goes red.
 */

const { mount, enableAutoUnmount } = require('@vue/test-utils');
const Vuex = require('vuex');

enableAutoUnmount(afterEach);

const PiiReviewSummary = require('@/components/okf/editor/PiiReviewSummary.vue').default;
const { PII_CHECKING, PII_UNREVIEWED, PII_UNSCANNED, PII_CLEAN } = require('@/components/okf/piiReview');

const SCANNED = { repo_id: 'r1', pii_scan_status: 'complete', pii_scanned_at: '2026-10-13T00:00:00.000Z' };

const settle = async (w, ticks = 4) => {
  for (let i = 0; i < ticks; i++) {
    await w.vm.$nextTick();
    await Promise.resolve();
  }
};

/**
 * REAL Vuex store with the okf module — mapGetters needs a real store, and the
 * component reads the concept list THROUGH the getter rather than from props,
 * so a plain-object mock would make every case look clean.
 *
 * The module is NAMESPACED, so the seed commit must be 'okf/setConcepts'. An
 * unprefixed commit is a silent no-op that leaves the list empty — which would
 * quietly turn every "flagged" case into a vacuous all-clear pass.
 *
 * `byRepo` models the WORLD: the read answers PER REPOSITORY, the way
 * `conceptService.listForRepo` does. A mock that returned one closed-over list
 * for every repo_id would agree with the component by construction and could
 * not catch a cross-repo answer.
 */
function buildStore(rows, fetchImpl) {
  const okfModule = require('@/store/modules/okf').default;
  const store = new Vuex.Store({
    modules: { okf: { ...okfModule, state: () => JSON.parse(JSON.stringify(okfModule.state())) } }
  });
  store.commit('okf/setConcepts', { repoId: 'r1', concepts: rows });
  expect(store.getters['okf/conceptsByRepo']('r1')).toHaveLength(rows.length); // harness self-check

  // The banner OWNS the read; the default models a completed, per-repo read.
  const defaultImpl = (repoId) => Promise.resolve({ ok: true, concepts: repoId === 'r1' ? rows : [] });
  const fetchConcepts = jest.fn(fetchImpl || defaultImpl);
  store.__fetchConcepts = fetchConcepts;
  const real = store.dispatch.bind(store);
  store.dispatch = (type, payload) => (type === 'okf/fetchConcepts' ? fetchConcepts(payload) : real(type, payload));
  return store;
}

function mountSummary({ repo = SCANNED, rows = [], fetchImpl } = {}) {
  const store = buildStore(rows, fetchImpl);
  const w = mount(PiiReviewSummary, {
    propsData: { repo, repoId: 'r1' },
    global: { plugins: [store] }
  });
  return { w, store, fetchConcepts: store.__fetchConcepts };
}

describe('OkfPiiReviewSummary — unreviewed hits are visible at publish', () => {
  it('shows the hit count and an explicit unreviewed warning, never an all-clear', async () => {
    const rows = [
      ...Array.from({ length: 34 }, (_, i) => ({ concept_id: `c${i}`, pii_state: 'clean' })),
      ...Array.from({ length: 107 }, (_, i) => ({ concept_id: `h${i}`, pii_state: 'hit' }))
    ];
    const { w } = mountSummary({ rows });
    await settle(w);

    expect(w.find('.okf-pii-review--unreviewed').exists()).toBe(true);
    const text = w.text();
    expect(text).toContain('107');
    expect(text).toContain('no one has looked at them');
    // The one thing it must never say.
    expect(text).not.toContain('no personal data was found');
    expect(w.find('.okf-pii-review__banner').exists()).toBe(true);
  });

  it('a STALE ack (recorded against 0) does NOT render as reviewed', async () => {
    const repo = {
      ...SCANNED,
      pii_ack: { by: 'steward@itu', at: '2026-10-13T10:00:00.000Z', flagged_concepts: 0 }
    };
    const rows = Array.from({ length: 107 }, (_, i) => ({ concept_id: `h${i}`, pii_state: 'hit' }));
    const { w } = mountSummary({ repo, rows });
    await settle(w);

    // The incident shape, verbatim.
    expect(w.find('.okf-pii-review--unreviewed').exists()).toBe(true);
    expect(w.find('.okf-pii-review--reviewed').exists()).toBe(false);
    expect(w.text()).not.toContain('a steward acknowledged');
    // It says WHY the record does not apply, rather than silently ignoring it.
    expect(w.find('.okf-pii-review__stale').exists()).toBe(true);
    expect(w.find('.okf-pii-review__stale').text()).toContain('107');
  });

  it('a CURRENT ack renders as reviewed and names who and when', async () => {
    const repo = {
      ...SCANNED,
      pii_ack: { by: 'steward@itu', at: '2026-10-13T11:00:00.000Z', flagged_concepts: 2 }
    };
    const rows = [
      { concept_id: 'h1', pii_state: 'hit' },
      { concept_id: 'h2', pii_state: 'hit' }
    ];
    const { w } = mountSummary({ repo, rows });
    await settle(w);

    expect(w.find('.okf-pii-review--reviewed').exists()).toBe(true);
    expect(w.text()).toContain('steward@itu');
    expect(w.text()).toContain('2026-10-13T11:00:00.000Z');
    expect(w.find('.okf-pii-review__banner').exists()).toBe(false);
  });
});

describe('OkfPiiReviewSummary — a scan error never reads as all-clear', () => {
  it('renders a scan error as its own blocking state', async () => {
    const rows = [
      { concept_id: 'c1', pii_state: 'clean' },
      { concept_id: 'e1', pii_state: 'error' }
    ];
    const { w } = mountSummary({ rows });
    await settle(w);

    expect(w.find('.okf-pii-review--error').exists()).toBe(true);
    expect(w.text()).toContain('could not be scanned');
    expect(w.text()).toContain('UNKNOWN');
    // The exact conflation this closes.
    expect(w.text()).not.toContain('no personal data was found');
    expect(w.text()).not.toContain('nothing found');
  });

  it('renders NEVER-scanned as unknown even when the concept list is empty', async () => {
    const { w } = mountSummary({ repo: { repo_id: 'r1' }, rows: [] });
    await settle(w);

    expect(w.find('.okf-pii-review--unscanned').exists()).toBe(true);
    expect(w.text()).toContain('No completed personal-data scan');
    expect(w.text()).not.toContain('no personal data was found');
  });

  it('a FAILED read leaves the verdict unknown rather than defaulting to clean', async () => {
    const { w } = mountSummary({ rows: [], fetchImpl: () => Promise.resolve({ ok: false, code: 'FETCH_FAILED' }) });
    await settle(w);

    expect(w.find('.okf-pii-review--unreadable').exists()).toBe(true);
    expect(w.text()).toContain('UNKNOWN');
    expect(w.find('.okf-pii-review--clean').exists()).toBe(false);
  });
});

describe('OkfPiiReviewSummary — reads, and never renders a stale answer', () => {
  it('reads the concept list itself, so the publish view is not a cache', async () => {
    // The incident was a stale view; a banner that trusted whatever the screen
    // happened to hold would have rendered the same wrong number.
    const { w, fetchConcepts } = mountSummary({ rows: [] });
    await settle(w);
    expect(fetchConcepts).toHaveBeenCalledWith('r1');
  });

  it('shows UNKNOWN while the read is in flight — never a provisional all-clear', async () => {
    let release;
    const gate = new Promise((res) => (release = res));
    const { w } = mountSummary({ rows: [], fetchImpl: () => gate.then(() => ({ ok: true, concepts: [] })) });
    await settle(w);
    // Mid-flight: the list is empty but nothing has been read yet.
    expect(w.find('.okf-pii-review--checking').exists()).toBe(true);
    expect(w.find('.okf-pii-review--clean').exists()).toBe(false);

    release();
    await settle(w);
    // Scanned + zero rows + zero hits is the ONLY honest route to clean.
    expect(w.find('.okf-pii-review--clean').exists()).toBe(true);
  });

  it('renders clean ONLY for a genuinely scanned, genuinely clear repository', async () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ concept_id: `c${i}`, pii_state: 'clean' }));
    const { w } = mountSummary({ rows });
    await settle(w);

    expect(w.vm.review.verdict).toBe(PII_CLEAN);
    expect(w.find('.okf-pii-review--clean').exists()).toBe(true);
    expect(w.text()).toContain('no personal data was found');
  });

  it('does not paint one repository verdict onto another after a repo switch', async () => {
    const R1 = [{ concept_id: 'h1', pii_state: 'hit' }];
    const R2 = [
      { concept_id: 'r2h1', pii_state: 'hit' },
      { concept_id: 'r2h2', pii_state: 'hit' },
      { concept_id: 'r2c1', pii_state: 'clean' }
    ];
    // Per-repo answers: r1 has ONE flagged page, r2 has TWO. A mock that
    // answered both with r1's list would let a cross-repo mix-up pass.
    const fetchImpl = (repoId) => Promise.resolve({ ok: true, concepts: repoId === 'r1' ? R1 : R2 });
    const { w, store } = mountSummary({ rows: R1, fetchImpl });
    await settle(w);
    expect(w.vm.review.verdict).toBe(PII_UNREVIEWED);
    expect(w.vm.review.hits).toBe(1);

    w.setProps({ repoId: 'r2', repo: { repo_id: 'r2', pii_scan_status: 'complete' } });
    // The real action commits r2's rows into the store; the mock returns them
    // without committing (the component only consumes `ok`), so seed them the
    // way the real action would.
    store.commit('okf/setConcepts', { repoId: 'r2', concepts: R2 });
    await settle(w);

    // The verdict follows r2's numbers, not r1's.
    expect(w.vm.review.hits).toBe(2);
    expect(w.vm.review.clean).toBe(1);
    expect(w.vm.review.verdict).toBe(PII_UNREVIEWED);
    expect(w.text()).toContain('2');
  });

  it('shows UNKNOWN — not the previous repo numbers — while the NEW repo is still being read', async () => {
    let release;
    const gate = new Promise((res) => (release = res));
    const R2_ROWS = [{ concept_id: 'r2h1', pii_state: 'hit' }];
    const { w, store } = mountSummary({
      rows: [],
      fetchImpl: (repoId) => (repoId === 'r1' ? Promise.resolve({ ok: true, concepts: [] }) : gate)
    });
    await settle(w);
    // r1 is genuinely clean — the state we are about to navigate away from.
    expect(w.find('.okf-pii-review--clean').exists()).toBe(true);

    // r2's read is slow. Until it lands the banner must say UNKNOWN: neither
    // "clean" (nothing is known about r2) nor a stale count carried over.
    w.setProps({ repoId: 'r2', repo: { repo_id: 'r2', pii_scan_status: 'complete' } });
    await settle(w, 1);
    expect(w.vm.review.verdict).toBe(PII_CHECKING);
    expect(w.find('.okf-pii-review__banner').exists()).toBe(false);
    expect(w.find('.okf-pii-review--clean').exists()).toBe(false);

    // The real action commits its rows before the component reads `ok`, so the
    // store write is what makes the new verdict appear.
    store.commit('okf/setConcepts', { repoId: 'r2', concepts: R2_ROWS });
    release({ ok: true, concepts: R2_ROWS });
    await settle(w);
    expect(w.vm.review.verdict).toBe(PII_UNREVIEWED);
    expect(w.vm.review.hits).toBe(1);
    expect(w.find('.okf-pii-review__banner').exists()).toBe(true);
  });

  it('exposes the verdict values the dialog assertions rely on', () => {
    // Guards against a rename silently making the assertions above vacuous.
    expect([PII_CHECKING, PII_UNREVIEWED, PII_UNSCANNED, PII_CLEAN]).toEqual([
      'checking',
      'unreviewed',
      'unscanned',
      'clean'
    ]);
  });
});
