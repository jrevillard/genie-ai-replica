'use strict';

/**
 * FRONTMATTER PANEL — the Suggest-tags flow (1-8g-m, 2026-10-11).
 *
 * Live failure this pins: on the 999-concept Indonesia repo the suggester
 * sampled the FIRST 20 concepts by auto-key, so four of seven subject areas
 * never reached the LLM — and it then proposed `modern-politics` /
 * `contemporary-culture` as FORBIDDEN for a corpus holding 133 Politics and
 * 99 Culture concepts (a live hard-veto trap). The server now returns
 * `coverage` and `forbidden_rejected`; this test pins that BOTH are shown,
 * so neither the sampling breadth nor a silently-dropped tag is invisible.
 *
 * Also pins the pre-existing behaviour this change must NOT regress: the
 * suggestion still REPLACES the local shape, and forbidden chips still flag
 * which values came from the LLM.
 */

jest.mock('@/services/frontmatterService', () => ({
  getFrontmatter: jest.fn(),
  patchFrontmatter: jest.fn(),
  suggestFrontmatter: jest.fn()
}));

const { mount } = require('@vue/test-utils');
const frontmatterService = require('@/services/frontmatterService');
const OkfFrontmatterPanel = require('@/components/okf/FrontmatterPanel.vue').default;

const REPO = { repo_id: 'r-1', name: 'Indonesia History - LLM' };

function fakeStore() {
  return { getters: {}, commit() {}, dispatch: jest.fn() };
}

function mountPanel(props = {}) {
  return mount(OkfFrontmatterPanel, {
    global: {
      mocks: { $store: fakeStore() },
      stubs: {
        DsButton: { template: '<button><slot /></button>' },
        DsInput: true,
        DsSelect: true,
        DsTag: { template: '<span><slot /></span>' },
        DsSpinner: true,
        DsInfoTip: true
      }
    },
    props: { repoId: REPO.repo_id, ...props }
  });
}

const SUGGESTION = {
  topic: ['indonesian-history', 'religion', 'archaeology'],
  entity: ['borobudur', 'sailendra'],
  scope: 'historical',
  forbidden: ['tourism'],
  summary: 'Indonesian history.',
  keyword: [],
  forbidden_suggestions: [{ value: 'tourism', suggested: true }],
  coverage: {
    concepts_total: 999,
    concepts_sampled: 21,
    label_count: 7,
    labels_represented: 7,
    labels_unrepresented: [],
    histogram: [{ label: 'History', count: 513 }]
  },
  forbidden_rejected: [
    {
      value: 'modern-politics',
      reason: 'the corpus contains 133 "Politics" concepts — forbidding this would veto valid queries',
      corpus_label: 'Politics',
      corpus_label_count: 133
    }
  ]
};

describe('FrontmatterPanel — Suggest tags (1-8g-m)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('the suggestion REPLACES the local shape (curator then edits)', async () => {
    frontmatterService.suggestFrontmatter.mockResolvedValue({ suggested: SUGGESTION });
    const w = mountPanel();
    await w.vm.onSuggestTags();
    expect(w.vm.shape.topic).toEqual(['indonesian-history', 'religion', 'archaeology']);
    expect(w.vm.shape.forbidden).toEqual(['tourism']);
    // forbidden chips still flag which values the LLM proposed
    expect(w.vm.suggestedForbidden).toEqual(['tourism']);
  });

  test('coverage is rendered — the curator sees what the sample was drawn from', async () => {
    frontmatterService.suggestFrontmatter.mockResolvedValue({ suggested: SUGGESTION });
    const w = mountPanel();
    await w.vm.onSuggestTags();
    expect(w.vm.suggestionCoverage).toMatchObject({ concepts_total: 999, concepts_sampled: 21, label_count: 7 });
    const html = w.html();
    expect(html).toContain('999');
    expect(html).toContain('21');
  });

  test('a forbidden tag the server rejected is SHOWN with its reason (never silently dropped)', async () => {
    frontmatterService.suggestFrontmatter.mockResolvedValue({ suggested: SUGGESTION });
    const w = mountPanel();
    await w.vm.onSuggestTags();
    expect(w.vm.suggestionRejected).toHaveLength(1);
    const html = w.html();
    expect(html).toContain('modern-politics');
    expect(html).toContain('Politics');
  });

  test('a legacy server (no coverage / no rejected) renders nothing extra and still applies the set', async () => {
    const legacy = {
      topic: ['a', 'b', 'c'],
      entity: [],
      scope: 's',
      forbidden: ['x'],
      summary: 'sum',
      keyword: []
    };
    frontmatterService.suggestFrontmatter.mockResolvedValue({ suggested: legacy });
    const w = mountPanel();
    await w.vm.onSuggestTags();
    expect(w.vm.shape.topic).toEqual(['a', 'b', 'c']);
    expect(w.vm.suggestionCoverage).toBeNull();
    expect(w.vm.suggestionRejected).toEqual([]);
    // every forbidden value is treated as an LLM proposal (back-compat)
    expect(w.vm.suggestedForbidden).toEqual(['x']);
    expect(w.html()).not.toContain('okf-fmp__rejected');
  });

  test('a re-suggest clears the previous provenance notes', async () => {
    frontmatterService.suggestFrontmatter.mockResolvedValue({ suggested: SUGGESTION });
    const w = mountPanel();
    await w.vm.onSuggestTags();
    expect(w.vm.suggestionCoverage).not.toBeNull();
    frontmatterService.suggestFrontmatter.mockResolvedValue({
      suggested: { topic: ['z'], entity: [], scope: '', forbidden: [], summary: '', keyword: [] }
    });
    await w.vm.onSuggestTags();
    expect(w.vm.suggestionCoverage).toBeNull();
    expect(w.vm.suggestionRejected).toEqual([]);
  });

  test('an empty suggestion surfaces the existing error and clears the provenance notes', async () => {
    frontmatterService.suggestFrontmatter.mockResolvedValue({ suggested: SUGGESTION });
    const w = mountPanel();
    await w.vm.onSuggestTags();
    expect(w.vm.suggestionCoverage).not.toBeNull();
    // the next suggest comes back empty — error shown, stale notes cleared
    frontmatterService.suggestFrontmatter.mockResolvedValue({ suggested: null });
    await w.vm.onSuggestTags();
    expect(w.vm.suggestionError).toBeTruthy();
    expect(w.vm.suggestionCoverage).toBeNull();
    expect(w.vm.suggestionRejected).toEqual([]);
    expect(w.html()).toContain('okf-fmp__error');
  });
});

describe('FrontmatterPanel — pre-save flush (round 18, #80479)', () => {
  beforeEach(() => jest.clearAllMocks());

  // mapActions needs a REAL Vuex store with the okf module (a plain-object
  // mock leaves the namespace map undefined — same reason the lifecycle-ui
  // suite builds a real store).
  const Vuex = require('vuex');
  const okfModule = require('@/store/modules/okf').default;
  function buildStore() {
    return new Vuex.Store({
      modules: { okf: { ...okfModule, state: () => JSON.parse(JSON.stringify(okfModule.state)) } }
    });
  }

  // The data-loss race this pins: the panel's two-write save reads /index.md
  // AFTER dispatching saveFrontmatter — before the fix, the flushed autosave
  // PATCH could still be in flight and the save wrote a STALE body. The
  // flusher prop must be AWAITED: no dispatch until it resolves.
  test('onSave AWAITS the flusher promise before dispatching the save', async () => {
    let releaseFlush;
    const flushGate = new Promise((r) => {
      releaseFlush = r;
    });
    const flusher = jest.fn(() => flushGate);
    const store = buildStore();
    const dispatch = jest.fn(() => Promise.resolve({ ok: true }));
    store.dispatch = dispatch;
    const w = mount(OkfFrontmatterPanel, {
      global: {
        mocks: { $store: store },
        stubs: {
          DsButton: { template: '<button><slot /></button>' },
          DsInput: true,
          DsSelect: true,
          DsTag: { template: '<span><slot /></span>' },
          DsSpinner: true,
          DsInfoTip: true
        }
      },
      props: { repoId: REPO.repo_id, flusher }
    });
    w.vm.shape.topic = ['indonesian-history']; // canSave needs content
    const saving = w.vm.onSave();
    await Promise.resolve(); // a microtask: the flush call itself runs
    expect(flusher).toHaveBeenCalledTimes(1);
    expect(dispatch).not.toHaveBeenCalled(); // still gated on the flush
    releaseFlush();
    await saving;
    expect(dispatch).toHaveBeenCalledWith('okf/saveFrontmatter', expect.objectContaining({ repoId: REPO.repo_id }));
    expect(w.vm.saving).toBe(false);
  });

  // No flusher prop → the legacy notification event still fires (hosts
  // without a concept editor keep the old best-effort contract).
  test('without a flusher the flush-before-save notification still emits', async () => {
    const store = buildStore();
    const dispatch = jest.fn(() => Promise.resolve({ ok: true }));
    store.dispatch = dispatch;
    const w = mount(OkfFrontmatterPanel, {
      global: {
        mocks: { $store: store },
        stubs: {
          DsButton: { template: '<button><slot /></button>' },
          DsInput: true,
          DsSelect: true,
          DsTag: { template: '<span><slot /></span>' },
          DsSpinner: true,
          DsInfoTip: true
        }
      },
      props: { repoId: REPO.repo_id }
    });
    w.vm.shape.topic = ['indonesian-history'];
    await w.vm.onSave();
    expect(w.emitted('flush-before-save')).toHaveLength(1);
    expect(dispatch).toHaveBeenCalledWith('okf/saveFrontmatter', expect.anything());
  });
});
