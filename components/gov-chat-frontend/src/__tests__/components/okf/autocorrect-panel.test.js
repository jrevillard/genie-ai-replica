'use strict';

/**
 * AutocorrectPanel — #1037: autocorrectRepo returns warnings NESTED
 * ({concept_id, warnings:[{rule, severity, message}]}) but the panel rendered
 * the FLAT {concept_id, rule, message} shape — bare "id —" rows with no
 * message. The panel now flattens (tolerating both shapes) and renders
 * rule + message, with an info tip for the STALE_AFTER rules.
 */

const { mount } = require('@vue/test-utils');
const Vuex = require('vuex');

jest.mock('@/services/conceptService', () => ({
  update: jest.fn(async () => ({ ok: true }))
}));
const conceptService = require('@/services/conceptService');

const OkfAutocorrectPanel = require('@/components/okf/editor/AutocorrectPanel.vue').default;

function mountPanel(dryRunResult) {
  const store = new Vuex.Store({ modules: {} });
  store.dispatch = (type) => {
    if (type === 'okf/autocorrectRepo') return Promise.resolve(dryRunResult);
    return Promise.resolve({ ok: false });
  };
  // inline mode (the wizard surface): a plain card — the modal wrapper
  // teleports its content, invisible to wrapper.find().
  return mount(OkfAutocorrectPanel, {
    props: { visible: true, repoId: 'r1', inline: true },
    global: { plugins: [store] }
  });
}

const settle = async (w) => {
  await w.vm.$nextTick();
  await new Promise((r) => setTimeout(r, 0));
  await w.vm.$nextTick();
};

describe('OkfAutocorrectPanel — warnings render (#1037)', () => {
  it('flattens the nested warnings envelope into rule + message rows', async () => {
    const w = mountPanel({
      ok: true,
      changes: [],
      warnings: [
        {
          concept_id: 'p7',
          warnings: [{ rule: 'STALE_AFTER_CLEARED', severity: 'warning', message: 'not a parseable date — cleared' }]
        }
      ]
    });
    await settle(w);
    const row = w.find('.okf-ac__warnings li');
    expect(row.exists()).toBe(true);
    expect(row.text()).toContain('p7');
    expect(row.text()).toContain('STALE_AFTER_CLEARED: not a parseable date — cleared');
  });

  it('tolerates already-flat warning rows', async () => {
    const w = mountPanel({
      ok: true,
      changes: [],
      warnings: [{ concept_id: 'p2', rule: 'INVALID_STATUS', severity: 'warning', message: 'status "x" not in enum' }]
    });
    await settle(w);
    const row = w.find('.okf-ac__warnings li');
    expect(row.exists()).toBe(true);
    expect(row.text()).toContain('INVALID_STATUS: status "x" not in enum');
  });

  it('shows the stale_after info tip only for STALE_AFTER rules', async () => {
    const w = mountPanel({
      ok: true,
      changes: [],
      warnings: [
        {
          concept_id: 'p7',
          warnings: [
            { rule: 'STALE_AFTER_CLEARED', severity: 'warning', message: 'not a parseable date — cleared' },
            { rule: 'INVALID_STATUS', severity: 'warning', message: 'bad status' }
          ]
        }
      ]
    });
    await settle(w);
    const rows = w.findAll('.okf-ac__warnings li');
    expect(rows.length).toBe(2);
    expect(rows[0].findComponent({ name: 'DsInfoTip' }).exists()).toBe(true);
    expect(rows[1].findComponent({ name: 'DsInfoTip' }).exists()).toBe(false);
  });

  it('renders no warnings block when the plan is clean', async () => {
    const w = mountPanel({ ok: true, changes: [], warnings: [] });
    await settle(w);
    expect(w.find('.okf-ac__warnings').exists()).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Apply outcome (Quran Core, 2026-11-02): the bulk POST held ONE request open
// for the whole run — minutes on a 6k-concept repo — freezing the modal around
// it ("blocking wait dialog", "Page Unresponsive" on step entry from mounting
// thousands of groups). The apply is now one {frontmatter} PATCH per concept
// with a live progress bar and a Stop; the sheet window caps what renders;
// failures are named, never swallowed.
// ─────────────────────────────────────────────────────────────────────────────
describe('OkfAutocorrectPanel — chunked apply with progress', () => {
  const DRY = (ids) => ({
    ok: true,
    changes: ids.map((id) => ({ concept_id: id, changes: [{ field: 'type', before: null, after: 'topic' }] })),
    warnings: []
  });

  function mountQueue(queue, calls) {
    const store = new Vuex.Store({ modules: {} });
    // ONLY the autocorrect dispatch pops the queue — the panel's other
    // store traffic (the post-apply startRepoPiiScan arm) must not steal
    // the re-scan fixture, or runDryRun reads undefined.
    store.dispatch = (type, payload) => {
      calls.push({ type, payload });
      if (type !== 'okf/autocorrectRepo') return Promise.resolve({ ok: true });
      const next = queue.shift();
      return Promise.resolve(typeof next === 'function' ? next() : next);
    };
    return mount(OkfAutocorrectPanel, {
      props: { visible: true, repoId: 'r1', inline: true },
      global: { plugins: [store] }
    });
  }

  beforeEach(() => {
    conceptService.update.mockClear();
  });

  it('applies one PATCH per concept and shows the progress row while running', async () => {
    const calls = [];
    let resolveFirst;
    const pending = new Promise((r) => {
      resolveFirst = r;
    });
    conceptService.update.mockImplementationOnce(() => pending);
    const w = mountQueue([DRY(['c1', 'c2']), { ok: true, changes: [], warnings: [] }], calls);
    await settle(w);
    await w.find('.okf-ac__inline-actions button').trigger('click');
    // While the first PATCH is in flight: progress row visible, Stop usable,
    // the Apply button hidden.
    expect(w.find('.okf-ac__applying').exists()).toBe(true);
    expect(w.find('.okf-ac__progress').exists()).toBe(true);
    expect(w.text()).toContain('Applying');
    expect(w.find('.okf-ac__inline-actions').exists()).toBe(false);
    resolveFirst({ ok: true });
    await settle(w);
    // One PATCH per concept, frontmatter-merged payload per group:
    expect(conceptService.update).toHaveBeenCalledTimes(2);
    expect(conceptService.update.mock.calls[0]).toEqual(['r1', 'c1', { type: 'topic' }]);
    // Progress row gone, sheet re-scanned to clean, outcome reported.
    expect(w.find('.okf-ac__applying').exists()).toBe(false);
    expect(w.text()).toContain('Applied 2 fix(es)');
    expect(w.text()).toContain('Nothing to fix');
    // The post-apply traffic: the repo-wide PII rescan is ARMED, then the
    // fresh autocorrect scan runs (dryRun true; the bulk dispatch is gone).
    expect(calls.some((c) => c.type === 'okf/startRepoPiiScan')).toBe(true);
    const scans = calls.filter((c) => c.type === 'okf/autocorrectRepo');
    expect(scans.length).toBe(2);
    expect(scans[1].payload.dryRun).toBe(true);
  });

  it('Stop stops before further concepts and reports where it got to', async () => {
    const calls = [];
    let resolveFirst;
    const pending = new Promise((r) => {
      resolveFirst = r;
    });
    // EVERY lane blocks on the SAME pending promise: four PATCHes in flight
    // (the lane cap), none resolved when Stop is clicked.
    conceptService.update.mockImplementation(() => pending);
    // EIGHT concepts, FOUR lanes (review 84586): with only 4 groups every
    // PATCH was already in flight before Stop could click, so deleting the
    // `!this.stopping` loop gate left this test green. With 8 groups the
    // gate IS consulted with queued work left — the assertion pins that a
    // stopped run never exceeds the lanes' in-flight set.
    const w = mountQueue(
      [DRY(['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8']), { ok: true, changes: [], warnings: [] }],
      calls
    );
    await settle(w);
    await w.find('.okf-ac__inline-actions button').trigger('click');
    // All four lanes took a group before the pending first PATCH resolves:
    expect(conceptService.update).toHaveBeenCalledTimes(4);
    await w.find('.okf-ac__applying button').trigger('click'); // Stop
    resolveFirst({ ok: true });
    await settle(w);
    expect(w.text()).toMatch(/Stopped/);
    // The gate held: the four queued groups never started.
    expect(conceptService.update).toHaveBeenCalledTimes(4);
  });

  it('names the concepts whose PATCH failed instead of hiding them', async () => {
    const calls = [];
    conceptService.update.mockImplementation(async (_repo, cid) => {
      if (cid === 'c1') throw new Error('concept row not found');
      return { ok: true };
    });
    const w = mountQueue([DRY(['c1', 'c2']), DRY(['c1'])], calls);
    await settle(w);
    await w.find('.okf-ac__inline-actions button').trigger('click');
    await settle(w);
    expect(w.find('.okf-ac__summary--partial').exists()).toBe(true);
    expect(w.text()).toContain('FAILED');
    expect(w.text()).toContain('c1');
    expect(w.text()).toContain('concept row not found');
    // the sheet is NOT clean — the failed row is still pending
    expect(w.text()).not.toContain('Nothing to fix');
  });

  it('the sheet window caps rendering: 200 groups render 25 with a show-more note', async () => {
    const calls = [];
    const ids = Array.from({ length: 200 }, (_, i) => 'c' + i);
    const w = mountQueue([DRY(ids)], calls);
    await settle(w);
    const groups = w.findAll('.okf-ac__group');
    expect(groups.length).toBe(25);
    expect(w.text()).toContain('Showing 25 of 200 concepts');
    expect(w.text()).toContain('Apply fixes covers all of them');
    // show-more grows the window
    const more = w.findAll('button').find((b) => b.text() === 'Show more');
    await more.trigger('click');
    await settle(w);
    expect(w.findAll('.okf-ac__group').length).toBe(125);
    // the filter narrows the matched set (DsInput's root IS the input)
    const filter = w.find('input.okf-ac__filter');
    await filter.setValue('c199');
    await settle(w);
    expect(w.findAll('.okf-ac__group').length).toBe(1);
    expect(w.text()).not.toContain('Show more');
  });
});
