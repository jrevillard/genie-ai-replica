'use strict';

/**
 * 3.10 T4 + T5:
 *  - T4: the Auto-correct step is REAL — it embeds the editor's
 *    AutocorrectPanel (the full stack always existed; the step shipped
 *    placeholder text instead). Gate stays open (never a dead end).
 *  - T5 (D4): step 9 is the HANDOFF — the ritual statement is explicit,
 *    there is NO publish affordance, and the dashboard hand-off button
 *    emits 'dashboard'.
 */

const { mount } = require('@vue/test-utils');
const Vuex = require('vuex');
const OkfStepAutocorrect = require('@/components/okf/steps/Autocorrect.vue').default;
const OkfStepPublish = require('@/components/okf/steps/Publish.vue').default;
const OkfAutocorrectPanel = require('@/components/okf/editor/AutocorrectPanel.vue').default;
const DsDialog = require('@/components/ds/Dialog.vue').default;

const mockAutocorrectRepo = jest.fn();
const mockFetchRepoMetrics = jest.fn();
const mockGetFrontmatter = jest.fn();

// Story 1.6 (2026-10-07): Publish.vue requires a SECOND parallel gate
// (frontmatterOk) alongside the existing topicsOk. The previous assertions
// ('gate opens with topics') need the frontmatter service mocked with the
// post-1.6 happy-path payload to keep their meaning. Tests that target
// the new "no frontmatter" state override the mock to return [].
jest.mock('@/services/frontmatterService', () => ({
  getFrontmatter: (...args) => mockGetFrontmatter(...args),
  getFrontmatterSummary: jest.fn(),
  suggestFrontmatter: jest.fn(),
  patchFrontmatter: jest.fn(),
  isFrontmatterPublishReady: (rows) => {
    if (!Array.isArray(rows) || !rows.length) return false;
    let topicCount = 0;
    let forbiddenCount = 0;
    for (const row of rows) {
      if (!row.approved_at) return false;
      if (row.field === 'topic') topicCount += 1;
      else if (row.field === 'forbidden') forbiddenCount += 1;
    }
    return topicCount >= 3 && forbiddenCount >= 1;
  }
}));

function store() {
  return new Vuex.Store({
    modules: {
      okf: {
        namespaced: true,
        getters: { repoById: () => (id) => (id === 'r1' ? { repo_id: 'r1', name: 'R1' } : null) },
        actions: {
          // A10: the action returns the ENVELOPE { ok, metrics } — the old
          // mock returned a bare {concept_count}, hiding that Publish read
          // concept_count off the envelope and left the finish button
          // permanently disabled ("Open the Editor does nothing").
          fetchRepoMetrics: (...a) => mockFetchRepoMetrics(...a),
          autocorrectRepo: (...a) => mockAutocorrectRepo(...a)
        }
      }
    }
  });
}

function mountStep(cmp, draft) {
  return mount(cmp, {
    props: { draft: draft || { repo_id: 'r1', name: 'R1' }, expert: false },
    global: { stubs: { DsInfoTip: true }, plugins: [store()] }
  });
}

async function drained(wrapper) {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
  await wrapper.vm.$nextTick();
}

beforeEach(() => {
  mockAutocorrectRepo.mockReset();
  mockAutocorrectRepo.mockResolvedValue({ ok: true, changes: [], warnings: [] });
  mockFetchRepoMetrics.mockReset();
  mockFetchRepoMetrics.mockResolvedValue({ ok: true, metrics: { concept_count: 3 } });
  // Story 1.6 default: a curated repo with 3 topics + 1 forbidden, all
  // approved — the post-1.6 happy-path that satisfies canPublish
  // (topicsOk && frontmatterOk).
  mockGetFrontmatter.mockReset();
  mockGetFrontmatter.mockResolvedValue({
    repo_id: 'r1',
    frontmatter: [
      { _key: 't1', field: 'topic', value: 'topic-1', approved_at: '2026-10-07T12:00:00Z' },
      { _key: 't2', field: 'topic', value: 'topic-2', approved_at: '2026-10-07T12:00:00Z' },
      { _key: 't3', field: 'topic', value: 'topic-3', approved_at: '2026-10-07T12:00:00Z' },
      { _key: 'f1', field: 'forbidden', value: 'travel', approved_at: '2026-10-07T12:00:00Z' }
    ]
  });
});

describe('T4 — autocorrect step', () => {
  it('A10: the finish gate OPENS — the metrics envelope is unwrapped (the disabled-footer bug)', async () => {
    const wrapper = mountStep(OkfStepPublish);
    await drained(wrapper);
    // loadCount unwrapped { ok, metrics } → liveConceptCount 3 → topicsOk
    // → canPublish true. The old envelope-blind code left the gate shut.
    const gates = wrapper.emitted('gate') || [];
    expect(gates.length).toBeGreaterThan(0);
    expect(gates[gates.length - 1][0]).toBe(true);
  });

  it('A10: with metrics UNAVAILABLE the workbench count still opens the gate (no dead hand-off)', async () => {
    mockFetchRepoMetrics.mockResolvedValue({ ok: true, metrics: null });
    const wrapper = mountStep(OkfStepPublish, {
      repo_id: 'r1',
      name: 'R1',
      input: { concepts_added: 2 }
    });
    await drained(wrapper);
    const gates = wrapper.emitted('gate') || [];
    expect(gates[gates.length - 1][0]).toBe(true);
  });

  it('embeds the REAL AutocorrectPanel, open, scoped to the repo', () => {
    const wrapper = mountStep(OkfStepAutocorrect);
    const panel = wrapper.findComponent(OkfAutocorrectPanel);
    expect(panel.exists()).toBe(true);
    expect(panel.props('visible')).toBe(true);
    expect(panel.props('repoId')).toBe('r1');
    expect(wrapper.emitted('gate')[0][0]).toBe(true); // never a dead end
  });

  it('A1: the dry-run scan FIRES on step mount (the dead-scan regression — a non-immediate visible watcher never ran it, so the panel showed a false "Nothing to fix")', async () => {
    const wrapper = mountStep(OkfStepAutocorrect);
    await drained(wrapper);
    // Vuex actions receive (context, payload) — assert the payload.
    expect(mockAutocorrectRepo).toHaveBeenCalledTimes(1);
    expect(mockAutocorrectRepo.mock.calls[0][1]).toEqual(
      expect.objectContaining({ repoId: 'r1', dryRun: true, mode: 'heuristics' })
    );
  });

  it('A9: the panel renders INLINE — no uncancellable modal walls off the step', async () => {
    // Field freeze 2026-09-29: the step mounted the panel as a MODAL with no
    // @close listener — Cancel/✕ were dead and the overlay blocked the whole
    // wizard at step 8.
    const wrapper = mountStep(OkfStepAutocorrect);
    await drained(wrapper);
    const panel = wrapper.findComponent(OkfAutocorrectPanel);
    expect(panel.props('inline')).toBe(true);
    // no DsDialog anywhere in the step — nothing to get stuck behind
    expect(wrapper.findComponent(DsDialog).exists()).toBe(false);
    // the Apply control lives IN the step body
    const btns = wrapper
      .findAll('button')
      .map((b) => b.text())
      .join(' ');
    expect(btns).toContain('Apply fixes');
  });

  it('applying surfaces the review-in-Curate note', async () => {
    const wrapper = mountStep(OkfStepAutocorrect);
    const panel = wrapper.findComponent(OkfAutocorrectPanel);
    await panel.vm.$emit('applied');
    await wrapper.vm.$nextTick();
    expect(wrapper.text()).toContain('Fixes applied');
  });

  it('no repo: the panel stays shut and the note says why', () => {
    const wrapper = mountStep(OkfStepAutocorrect, { name: 'X' });
    expect(wrapper.findComponent(OkfAutocorrectPanel).props('visible')).toBe(false);
    expect(wrapper.text()).toContain('No repository yet');
  });
});

describe('T5 — handoff step (D4)', () => {
  it('names the ritual explicitly and never publishes from the wizard', () => {
    const wrapper = mountStep(OkfStepPublish);
    expect(wrapper.text()).toContain('submit it for approval on the dashboard');
    expect(wrapper.text()).toContain('The wizard stops here by design');
    // no publish affordance anywhere
    const buttons = wrapper
      .findAll('button')
      .map((b) => b.text())
      .join(' ');
    expect(buttons.toLowerCase()).not.toContain('publish');
  });

  it('the dashboard hand-off button emits dashboard (D4)', async () => {
    const wrapper = mountStep(OkfStepPublish);
    const btn = wrapper.findAll('button').find((b) => b.text().includes('Open the Dashboard'));
    expect(btn).toBeTruthy();
    await btn.trigger('click');
    expect(wrapper.emitted('dashboard')).toBeTruthy();
  });

  it('a zero-topic repo stays gated with the pending hint (F7 unchanged)', async () => {
    const wrapper = mount(OkfStepPublish, {
      props: { draft: { repo_id: 'r1', name: 'R1' }, expert: false },
      global: {
        stubs: { DsInfoTip: true },
        plugins: [
          new Vuex.Store({
            modules: {
              okf: {
                namespaced: true,
                getters: { repoById: () => () => null },
                actions: { fetchRepoMetrics: () => ({ concept_count: 0 }) }
              }
            }
          })
        ]
      }
    });
    await wrapper.vm.$nextTick();
    expect(wrapper.emitted('gate')[0][0]).toBe(false);
  });
});
