'use strict';

/**
 * Story #978 - Studio editor component tests (ConceptList / ConceptEditor /
 * ResplitModal / RepoEditorShell default sub-tab).
 */

const { mount, flushPromises } = require('@vue/test-utils');
const { gateStoreDispatch } = require('../../helpers/gatedStore');

// The split done-toast goes through the event bus — mocked so the wiring
// pin can assert the SUBSTITUTED string (no literal placeholders).
jest.mock('@/services/notificationService', () => ({
  __esModule: true,
  default: {
    show: jest.fn(),
    success: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warning: jest.fn()
  }
}));

// Subject Areas load from the Knowledge Hierarchy via okfRepoOps — the
// dashboard's domain-filter regression test pins that contract with a
// canned tree (no network in jsdom). isBuilding mirrors the real semantics
// (conversion non-terminal) so the dashboard's building-poll test can drive it.
jest.mock('@/services/okfRepoOps', () => {
  // BOTH spellings: components import .default; others use the named exports.
  const impl = {
    loadSubjectAreaOptions: jest.fn().mockResolvedValue([
      { value: 'Water Supply', label: 'Water Supply' },
      { value: 'Health Services', label: 'Health Services' },
      { value: 'transport', label: 'transport (legacy)' }
    ]),
    isBuilding: jest.fn((r) => !!(r && r.conversion && !['done', 'failed'].includes(r.conversion.status))),
    // P0-UI: publish-state drains are REBUILDS, never building — the
    // dashboard poll keys on this plus the drain flags.
    isRedraining: jest.fn(
      (r) =>
        !!r &&
        r.lifecycle_state === 'publish' &&
        (r.rag_drain_active === true || !!(r.rag_ingestion && r.rag_ingestion.status === 'draining'))
    ),
    friendlyLifecycleError: (code, message) => message || String(code),
    // The REAL pure predicate — FrontmatterPanel's #932 marker computes from
    // it, and a stub would decide the pill on nothing.
    isLabelsStale: jest.requireActual('@/services/okfRepoOps').isLabelsStale
  };
  return { __esModule: true, default: impl, ...impl };
});

function fakeStore() {
  const dispatched = [];
  const store = {
    dispatched,
    getters: {
      'okf/editorSubTab': 'editor',
      'okf/repoById': () => ({ repo_id: 'r-1', name: 'Repo One', lifecycle_state: 'draft' })
    },
    commit(type, payload) {
      store.dispatched.push({ type, payload });
    },
    dispatch(type, payload) {
      store.dispatched.push({ type, payload });
      if (type === 'okf/getConcept') {
        return Promise.resolve({
          ok: true,
          concept: { concept_id: 'c-1', frontmatter: { type: 'topic', title: 'C1' }, body: '# C1 body' }
        });
      }
      if (type === 'okf/patchConcept') {
        return Promise.resolve({ ok: true, content_hash: 'H2', index_status: 'parsed' });
      }
      return Promise.resolve({ ok: true });
    }
  };
  return store;
}

function mountWith(component, store, props, stubs) {
  return mount(component, {
    global: { mocks: { $store: store }, stubs: stubs || {} },
    props
  });
}

const OkfConceptList = require('@/components/okf/editor/ConceptList.vue').default;

describe('OkfConceptList', () => {
  const base = [
    { concept_id: 'c-1', title: 'Page one', index_status: 'indexed', sources: [{ resource: 'https://x/1' }] },
    { concept_id: 'c-2', title: 'Page two', index_status: 'failed', is_index: true, labels: ['Health'] }
  ];

  it('renders rows with selection highlight, index badge and label', () => {
    const wrapper = mountWith(OkfConceptList, fakeStore(), { concepts: base, selectedId: 'c-1' });
    expect(wrapper.findAll('.okf-cl__row')).toHaveLength(2);
    expect(wrapper.find('.okf-cl__row--selected').exists()).toBe(true);
    expect(wrapper.text()).toContain('Page one');
    expect(wrapper.text()).toContain('index');
    expect(wrapper.text()).toContain('Health');
  });

  it('filters rows by title text', async () => {
    const wrapper = mountWith(OkfConceptList, fakeStore(), { concepts: base });
    await wrapper.find('input').setValue('two');
    expect(wrapper.findAll('.okf-cl__row')).toHaveLength(1);
  });

  it('renders a TREE (index root + children) and emits select from both', async () => {
    const wrapper = mountWith(OkfConceptList, fakeStore(), { concepts: base });
    const rows = wrapper.findAll('.okf-cl__row');
    expect(rows).toHaveLength(2); // root + one child
    await rows[0].trigger('click'); // root = the index concept (c-2)
    expect(wrapper.emitted('select')).toEqual([['c-2']]);
    await rows[1].trigger('click'); // child = c-1
    expect(wrapper.emitted('select')[1]).toEqual(['c-1']);
  });

  it('floats the ingest-failure card on hover of a RED row — exact error + fix (David, 2026-09-14)', async () => {
    const rows = [
      { concept_id: 'c-1', title: 'Healthy', index_status: 'indexed' },
      {
        concept_id: 'c-2',
        title: 'Bona vacantia',
        index_status: 'failed',
        last_error:
          'ingest drain stuck — no terminal callback within the grace window (reaper dead-letter; recovery = re-ingest)',
        ingest_attempts: 3,
        updated_at: '2026-09-12T19:55:00.000Z'
      }
    ];
    const wrapper = mountWith(OkfConceptList, fakeStore(), { concepts: rows });
    expect(wrapper.find('.okf-cl__failcard').exists()).toBe(false); // nothing hovered yet
    // Hover the HEALTHY row → no card (only RED rows speak).
    await wrapper.findAll('.okf-cl__row')[0].trigger('mouseenter');
    expect(wrapper.find('.okf-cl__failcard').exists()).toBe(false);
    // Hover the RED row → the card floats with the VERBATIM error + the fix.
    await wrapper.findAll('.okf-cl__row')[1].trigger('mouseenter');
    const card = wrapper.find('.okf-cl__failcard');
    expect(card.exists()).toBe(true);
    expect(card.text()).toContain('reaper dead-letter; recovery = re-ingest'); // the exact error
    expect(card.text()).toContain('grace window'); // the mapped recovery
    expect(card.text()).toContain('Attempts: 3');
    // Leaving the row hides it again.
    await wrapper.findAll('.okf-cl__row')[1].trigger('mouseleave');
    expect(wrapper.find('.okf-cl__failcard').exists()).toBe(false);
  });

  it('emits add from the footer and delete per row action', async () => {
    const wrapper = mountWith(OkfConceptList, fakeStore(), { concepts: base });
    const addBtn = wrapper.findAll('button').find((b) => b.text().includes('Add concept'));
    await addBtn.trigger('click');
    expect(wrapper.emitted('add')).toHaveLength(1);
    const delBtn = wrapper.find('.okf-cl__action--danger');
    await delBtn.trigger('click');
    expect(wrapper.emitted('delete')).toHaveLength(1);
    expect(wrapper.emitted('delete')[0][0].concept_id).toBe('c-2');
  });

  it('emits label with the picked Knowledge-Hierarchy value', async () => {
    const wrapper = mountWith(OkfConceptList, fakeStore(), {
      concepts: base,
      labelOptions: [{ value: 'Health', label: 'Health' }]
    });
    const labelBtn = wrapper.find('.okf-cl__action--label');
    await labelBtn.trigger('click'); // opens the inline picker
    const select = wrapper.find('.okf-cl__label-edit select');
    expect(select.exists()).toBe(true);
    await select.setValue('Health');
    expect(wrapper.emitted('label')).toEqual([[{ conceptId: 'c-2', label: 'Health' }]]);
  });

  // NON-BLOCKING LOAD (David, 2026-09-12): while a chunked fetch streams the
  // list in, the rail shows a REAL-count progress bar; without it, none.
  it('renders the load progress bar with real counts while streaming', () => {
    const wrapper = mountWith(OkfConceptList, fakeStore(), {
      concepts: base,
      loadProgress: { repoId: 'r-1', done: 450, total: 997 }
    });
    expect(wrapper.find('.okf-cl__load').exists()).toBe(true);
    expect(wrapper.find('.okf-cl__load-label').text()).toContain('450/997');
    expect(wrapper.find('.ds-progress').exists()).toBe(true);
  });

  it('renders no load progress bar once the fetch settles', () => {
    const wrapper = mountWith(OkfConceptList, fakeStore(), { concepts: base });
    expect(wrapper.find('.okf-cl__load').exists()).toBe(false);
  });
});

const OkfConceptEditor = require('@/components/okf/editor/ConceptEditor.vue').default;

describe('OkfConceptEditor', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  function mountEditor(store) {
    return mountWith(OkfConceptEditor, store || fakeStore(), { repoId: 'r-1', conceptId: 'c-1' });
  }

  it('loads the concept markdown (frontmatter + body composed)', async () => {
    const wrapper = mountEditor();
    await jest.advanceTimersByTimeAsync(0);
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.markdownLoaded).toBe(true);
    expect(wrapper.vm.markdown).toContain('type: topic');
    expect(wrapper.vm.markdown).toContain('# C1 body');
  });

  it('opens in the RENDERED view (#1634 — David, 2026-11-07: every OKF markdown surface defaults rendered)', () => {
    const wrapper = mountEditor();
    expect(wrapper.vm.view).toBe('rendered');
  });

  it('marks dirty on edit and autosaves after the debounce window', async () => {
    const store = fakeStore();
    const wrapper = mountEditor(store);
    await jest.advanceTimersByTimeAsync(0);
    await wrapper.vm.$nextTick();
    wrapper.vm.onEdit('---\ntype: topic\n---\n# edited');
    expect(wrapper.vm.dirty).toBe(true);
    await jest.advanceTimersByTimeAsync(1500);
    const patch = store.dispatched.find((d) => d.type === 'okf/patchConcept');
    expect(patch).toBeDefined();
    expect(patch.payload.markdown).toContain('# edited');
  });

  it('saves BODY-ONLY when the edited frontmatter is unchanged (labels write-through)', async () => {
    const store = fakeStore();
    const wrapper = mountEditor(store);
    await jest.advanceTimersByTimeAsync(0);
    await wrapper.vm.$nextTick();
    // Same frontmatter as loaded ({ type: 'topic', title: 'C1' }) — body edit.
    const matter = require('gray-matter');
    wrapper.vm.onEdit(matter.stringify('# edited body\n', { type: 'topic', title: 'C1' }));
    await jest.advanceTimersByTimeAsync(1500);
    const patch = store.dispatched.find((d) => d.type === 'okf/patchConcept');
    expect(patch).toBeDefined();
    expect(patch.payload.body).toContain('# edited body');
    expect(patch.payload.markdown).toBeUndefined(); // no fm snapshot round-trip
  });

  // Round 21c (#80942): the flush used to resolve IMMEDIATELY when a save
  // was already in flight — the FrontmatterPanel's two-write save then GETs
  // /index.md pre-PATCH and reverts the curator's typed body. The flush
  // must mean "the autosave has COMMITTED".
  it('flushPendingSave awaits an IN-FLIGHT save, not just a pending one (#80942)', async () => {
    // The PATCH hangs on a manual gate (the shared gateStoreDispatch helper,
    // #83615) — the flush may only resolve once it commits.
    const { store, release } = gateStoreDispatch(fakeStore(), 'okf/patchConcept');
    const wrapper = mountEditor(store);
    await jest.advanceTimersByTimeAsync(0);
    await wrapper.vm.$nextTick();
    wrapper.vm.onEdit('---\ntype: topic\n---\n# in-flight body');
    await jest.advanceTimersByTimeAsync(1500); // debounce fires — save NOW in flight
    expect(wrapper.vm.saving).toBe(true);
    let flushed = false;
    const f = wrapper.vm.flushPendingSave().then(() => {
      flushed = true;
    });
    await jest.advanceTimersByTimeAsync(1);
    await Promise.resolve();
    expect(flushed).toBe(false); // NOT resolved while the PATCH is in flight
    release(); // the PATCH commits
    await f;
    expect(flushed).toBe(true); // the flush waited for the commit
    expect(wrapper.vm.saving).toBe(false);
  });

  // ROUND 25 (review 83388): the OTHER flush arm — `dirty && !saving →
  // saveNow()` — had no commit-ordering pin (the :256 switch-concepts test
  // doesn't gate the PATCH). The 81376 fix made saveNow return the HELD
  // promise; reverting to a plain assignment resolves the flush before the
  // PATCH commits and THIS test goes red — fail-on-pre-fix by construction.
  it('flushPendingSave awaits a PENDING (debounce-not-yet-fired) save too', async () => {
    const { store, release } = gateStoreDispatch(fakeStore(), 'okf/patchConcept');
    const wrapper = mountEditor(store);
    await jest.advanceTimersByTimeAsync(0);
    await wrapper.vm.$nextTick();
    wrapper.vm.onEdit('---\ntype: topic\n---\n# dirty body');
    // NO debounce advance: dirty=true, saving=false — the flush itself must
    // trigger saveNow and hold until the PATCH commits.
    expect(wrapper.vm.dirty).toBe(true);
    expect(wrapper.vm.saving).toBe(false);
    let flushed = false;
    const f = wrapper.vm.flushPendingSave().then(() => {
      flushed = true;
    });
    await jest.advanceTimersByTimeAsync(1);
    await Promise.resolve();
    expect(wrapper.vm.saving).toBe(true); // the flush started the save
    expect(flushed).toBe(false); // NOT resolved while the PATCH is in flight
    release(); // the PATCH commits
    await f;
    expect(flushed).toBe(true);
    expect(wrapper.vm.saving).toBe(false);
  });

  it('flushes a pending save when switching concepts', async () => {
    const store = fakeStore();
    const wrapper = mountEditor(store);
    await jest.advanceTimersByTimeAsync(0);
    await wrapper.vm.$nextTick();
    wrapper.vm.onEdit('# changed');
    await wrapper.setProps({ conceptId: 'c-2' });
    const patch = store.dispatched.find((d) => d.type === 'okf/patchConcept');
    expect(patch).toBeDefined();
    expect(patch.payload.conceptId).toBe('c-1');
  });
});

const OkfResplitModal = require('@/components/okf/editor/ResplitModal.vue').default;

describe('OkfResplitModal', () => {
  it('renders three modes with C disabled', () => {
    const wrapper = mountWith(OkfResplitModal, fakeStore(), { visible: true, repoId: 'r-1' }, { teleport: true });
    const radios = wrapper.findAll('input[type="radio"]');
    expect(radios).toHaveLength(3);
    expect(radios[2].attributes('disabled')).toBeDefined();
  });

  it('confirm dispatches okf/resplitRepo with mode + fileId and closes', async () => {
    const store = fakeStore();
    const wrapper = mountWith(
      OkfResplitModal,
      store,
      { visible: true, repoId: 'r-1', fileId: 'f-1' },
      { teleport: true }
    );
    wrapper.vm.onAction('confirm');
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick();
    const resplit = store.dispatched.find((d) => d.type === 'okf/resplitRepo');
    expect(resplit.payload).toMatchObject({ repoId: 'r-1', mode: 'B', fileId: 'f-1' });
    expect(wrapper.emitted('done')).toHaveLength(1);
    expect(wrapper.emitted('close')).toHaveLength(1);
  });
});

// ── #1577 story 2 — the per-concept split affordances ───────────────────────

describe('OkfConceptList — the tree-row split affordance', () => {
  // An index root + one child: the split glyph must exist on BOTH row kinds.
  const rows = [
    { concept_id: 'c-1', title: 'Page one', index_status: 'indexed' },
    { concept_id: 'c-2', title: 'Page two', index_status: 'failed', is_index: true }
  ];

  it('offers the split glyph on both root and child rows and emits the concept_id string', async () => {
    const wrapper = mountWith(OkfConceptList, fakeStore(), { concepts: rows });
    const splitButtons = wrapper.findAll('[data-test-id="okf-concept-split"]');
    expect(splitButtons).toHaveLength(2); // root (index row c-2) + child (c-1)
    await splitButtons[0].trigger('click');
    const emitted = wrapper.emitted('split');
    expect(emitted).toHaveLength(1);
    // The STRING contract (matching ConceptEditor's pane entry) — RepoEditor
    // consumes it directly, no node unwrapping.
    expect(emitted[0][0]).toBe('c-2');
  });

  it('hides the split affordance on a read-only (serving) repo — the same gating as delete', () => {
    const wrapper = mountWith(OkfConceptList, fakeStore(), { concepts: rows, readOnly: true });
    expect(wrapper.findAll('[data-test-id="okf-concept-split"]')).toHaveLength(0);
    expect(wrapper.findAll('.okf-cl__action--danger')).toHaveLength(0); // the gate it shares
  });

  it('showSplit=false hides the glyph (the wizard workbench mounts no split dialog)', () => {
    const wrapper = mountWith(OkfConceptList, fakeStore(), { concepts: rows, showSplit: false });
    expect(wrapper.findAll('[data-test-id="okf-concept-split"]')).toHaveLength(0);
  });
});

const OkfSplitPreviewModal = require('@/components/okf/editor/SplitPreviewModal.vue').default;
const mockSplitPreviewSvc = require('@/services/repoOkfService').default.splitPreview;
const mockSplitConceptSvc = require('@/services/repoOkfService').default.splitConcept;

describe('OkfSplitPreviewModal — CAP-3 legible before', () => {
  const PLAN = {
    ok: true,
    concept_id: 'big',
    ceiling: 250000,
    body_chars: 300000,
    parts: [
      { concept_id: 'big', path: 'docs/big.md', title: 'Big', chars: 250000 },
      { concept_id: 'big-part-2', path: 'docs/big-part-2.md', title: 'Big — part 2', chars: 50000 }
    ]
  };

  function modalStore(dispatchResult) {
    const store = fakeStore();
    const original = store.dispatch;
    store.dispatch = (type, payload) => {
      if (type === 'okf/splitConcept') {
        store.dispatched.push({ type, payload });
        return Promise.resolve(dispatchResult || { ok: true });
      }
      return original(type, payload);
    };
    return store;
  }

  async function mountModal(store, props) {
    const wrapper = mountWith(
      OkfSplitPreviewModal,
      store,
      { visible: true, repoId: 'r-1', conceptId: 'big', ...props },
      { teleport: true }
    );
    await wrapper.vm.$nextTick();
    await flushPromises();
    return wrapper;
  }

  it('renders the seam preview BEFORE any write — plan rows, ceiling, confirm armed, nothing dispatched', async () => {
    mockSplitPreviewSvc.mockResolvedValueOnce(PLAN);
    const store = modalStore();
    const wrapper = await mountModal(store);
    const rows = wrapper.findAll('[data-test-id="okf-split-part-row"]');
    expect(rows).toHaveLength(2);
    expect(rows[0].text()).toContain('big');
    expect(rows[1].text()).toContain('big-part-2');
    expect(wrapper.find('[data-test-id="okf-split-preview"]').text()).toContain('250000'); // the ceiling line
    const confirm = wrapper.find('[data-test-id="okf-split-confirm"]');
    expect(confirm.attributes('disabled')).toBeUndefined(); // armed
    // THE CAP-3 pin: a preview is not a write — the store saw nothing.
    expect(store.dispatched.filter((d) => d.type === 'okf/splitConcept')).toHaveLength(0);
    expect(mockSplitConceptSvc).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('a typed refusal renders the server message verbatim and confirm stays disabled', async () => {
    mockSplitPreviewSvc.mockResolvedValueOnce({
      ok: false,
      code: 'PART_ID_CONFLICT',
      serverRefusal: true, // the service classifies the origin; the dialog renders verbatim
      message: 'splitting concept big would overwrite existing concept(s) big-part-2 — rename or delete them first'
    });
    const store = modalStore();
    const wrapper = await mountModal(store);
    expect(wrapper.find('[data-test-id="okf-split-refusal"]').text()).toContain('big-part-2');
    expect(wrapper.find('[data-test-id="okf-split-preview"]').text()).toContain('rename or delete them first');
    expect(wrapper.find('[data-test-id="okf-split-confirm"]').attributes('disabled')).toBeDefined();
    wrapper.unmount();
  });

  it('a transport failure renders the error line — never a half-informed confirm', async () => {
    mockSplitPreviewSvc.mockResolvedValueOnce({ ok: false, code: 'PREVIEW_FAILED', message: 'Network error' });
    const store = modalStore();
    const wrapper = await mountModal(store);
    expect(wrapper.find('[data-test-id="okf-split-error"]').exists()).toBe(true);
    expect(wrapper.find('[data-test-id="okf-split-confirm"]').attributes('disabled')).toBeDefined();
    wrapper.unmount();
  });

  it('a server refusal with a code this dialog has never heard of STILL renders verbatim — the vocabulary lives in the service, not here', async () => {
    // The drift pin: a NEW server refusal code (added to concept-split-operation.js
    // next quarter) arrives flagged serverRefusal by the service — the dialog must
    // render the server's words, not fall back to the generic transport line.
    mockSplitPreviewSvc.mockResolvedValueOnce({
      ok: false,
      code: 'SOME_FUTURE_REFUSAL_CODE',
      serverRefusal: true,
      message: 'the server explains exactly what went wrong'
    });
    const store = modalStore();
    const wrapper = await mountModal(store);
    expect(wrapper.find('[data-test-id="okf-split-refusal"]').exists()).toBe(true);
    expect(wrapper.find('[data-test-id="okf-split-refusal"]').text()).toContain(
      'the server explains exactly what went wrong'
    );
    expect(wrapper.find('[data-test-id="okf-split-error"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('confirm dispatches okf/splitConcept and emits done + close', async () => {
    mockSplitPreviewSvc.mockResolvedValueOnce(PLAN);
    const store = modalStore({ ok: true, concept_id: 'big', parts: PLAN.parts, created: 1, updated: 1 });
    const wrapper = await mountModal(store);
    await wrapper.find('[data-test-id="okf-split-confirm"]').trigger('click');
    await wrapper.vm.$nextTick();
    const dispatched = store.dispatched.find((d) => d.type === 'okf/splitConcept');
    expect(dispatched).toBeTruthy();
    expect(dispatched.payload).toMatchObject({ repoId: 'r-1', conceptId: 'big' });
    expect(wrapper.emitted('done')).toHaveLength(1);
    expect(wrapper.emitted('close')).toHaveLength(1);
    wrapper.unmount();
  });

  it('a WRITE refusal re-runs the preview — the FRESH state renders, the stale plan never stays armed', async () => {
    mockSplitPreviewSvc.mockResolvedValueOnce(PLAN); // the open preview
    mockSplitPreviewSvc.mockResolvedValueOnce({
      // the re-preview after the refusal: the -part-N row appeared, so the
      // FRESH answer is the conflict — not the stale armed plan
      ok: false,
      code: 'PART_ID_CONFLICT',
      serverRefusal: true,
      message: 'splitting concept big would overwrite existing concept(s) big-part-2 — rename or delete them first'
    });
    const store = modalStore({ ok: false, code: 'PART_ID_CONFLICT', message: 'stale write message' });
    const wrapper = await mountModal(store);
    await wrapper.find('[data-test-id="okf-split-confirm"]').trigger('click');
    await flushPromises();
    // The FRESH preview's refusal renders (not the write's stale message)...
    expect(wrapper.find('[data-test-id="okf-split-refusal"]').text()).toContain('rename or delete them first');
    // ...and the stale plan is gone: confirm is disarmed.
    expect(wrapper.vm.plan).toBeNull();
    expect(wrapper.find('[data-test-id="okf-split-confirm"]').attributes('disabled')).toBeDefined();
    expect(wrapper.emitted('close')).toBeUndefined(); // stays open
    wrapper.unmount();
  });

  it('a stale preview answer never overwrites a newer open (open A → close → open B)', async () => {
    let resolveA;
    mockSplitPreviewSvc.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolveA = () => r(PLAN);
        })
    ); // A: hangs
    mockSplitPreviewSvc.mockResolvedValueOnce({
      ok: true,
      concept_id: 'b',
      ceiling: 250000,
      parts: [{ concept_id: 'b', path: 'docs/b.md', title: 'B', chars: 7 }]
    }); // B: fast
    const store = modalStore();
    const wrapper = mountWith(
      OkfSplitPreviewModal,
      store,
      { visible: false, repoId: 'r-1', conceptId: 'a' },
      { teleport: true }
    );
    await wrapper.setProps({ visible: true }); // open A — the fetch hangs
    await flushPromises();
    expect(wrapper.vm.plan).toBeNull(); // A has not landed
    await wrapper.setProps({ visible: false }); // close
    await wrapper.setProps({ visible: true, conceptId: 'b' }); // open B
    await flushPromises();
    expect(wrapper.vm.plan.parts[0].concept_id).toBe('b');
    resolveA(); // A lands LATE
    await flushPromises();
    // A's stale plan must NOT overwrite B's — confirm stays on B's seams.
    expect(wrapper.vm.plan.parts[0].concept_id).toBe('b');
    wrapper.unmount();
  });

  it('the dirty hint renders before the confirm when threaded', async () => {
    mockSplitPreviewSvc.mockResolvedValueOnce(PLAN);
    const store = modalStore();
    const wrapper = await mountModal(store, { dirtyHint: true });
    const hint = wrapper.find('[data-test-id="okf-split-dirty"]');
    expect(hint.exists()).toBe(true);
    expect(hint.text()).toContain('SAVED body');
    wrapper.unmount();
  });
});

const { shallowMount } = require('@vue/test-utils');
const { createStore } = require('vuex');
const okfModule = require('@/store/modules/okf').default;
// Services mocked at module level — the real Vuex store's actions call them.
jest.mock('@/services/repoOkfService', () => ({
  __esModule: true,
  default: {
    list: jest.fn().mockResolvedValue([]),
    get: jest.fn(),
    getMetrics: jest.fn(),
    // #1577 story 2 — the split dialog's client. Defaults answer a preview
    // failure; each test overrides with mockResolvedValueOnce.
    splitPreview: jest.fn().mockResolvedValue({ ok: false, code: 'PREVIEW_FAILED', message: '' }),
    splitConcept: jest.fn().mockResolvedValue({ ok: true })
  }
}));
jest.mock('@/services/conceptService', () => ({
  __esModule: true,
  default: { listForRepo: jest.fn().mockResolvedValue([]), get: jest.fn(), update: jest.fn() }
}));
jest.mock('@/services/studioService', () => ({
  __esModule: true,
  default: {
    saveDraft: jest.fn().mockRejectedValue({ status: 404 }),
    getDraft: jest.fn().mockRejectedValue({ status: 404 })
  }
}));
jest.mock('@/services/crawlerToOkfService', () => ({
  __esModule: true,
  default: { convertCrawlToOkf: jest.fn() }
}));

const OkfStudioDashboard = require('@/components/okf/StudioDashboard.vue').default;

describe('OkfStudioDashboard — domain filter (DsSelect options regression)', () => {
  it('renders the subject-area options via the DsSelect slot', async () => {
    const realStore = createStore({
      modules: { okf: { ...okfModule, state: () => JSON.parse(JSON.stringify(okfModule.state())) } }
    });
    realStore.commit('okf/setExpertMode', true);
    const wrapper = mount(OkfStudioDashboard, { global: { plugins: [realStore] } });
    await wrapper.vm.$nextTick();
    await wrapper.vm.$nextTick(); // options load asynchronously from the KH tree
    const opts = wrapper.findAll('select option').map((o) => o.text());
    // SUBJECT AREAS follow the Knowledge Hierarchy (David, 2026-09-04):
    // KH categories + legacy repo domains, never a hard-coded list.
    expect(opts).toContain('All subject areas');
    expect(opts).toContain('Water Supply');
    expect(opts).toContain('transport (legacy)');
    wrapper.unmount();
  });
});

describe('OkfStudioDashboard — building poll (the 11-hour ghost fix, 2026-09-05)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  function buildStore() {
    return createStore({
      modules: { okf: { ...okfModule, state: () => JSON.parse(JSON.stringify(okfModule.state())) } }
    });
  }

  it('polls the repo list UNCONDITIONALLY while mounted (P0-UX: no gates — cards project the fresh doc each tick)', async () => {
    const store = buildStore();
    store.commit('okf/upsertRepo', {
      repo_id: 'r-b',
      name: 'Building Repo',
      lifecycle_state: 'register',
      conversion: { status: 'splitting', stage: 'splitting' }
    });
    const wrapper = mount(OkfStudioDashboard, { global: { plugins: [store] } });
    await jest.advanceTimersByTimeAsync(0); // mounted() fetchRepos
    const repoOkfService = require('@/services/repoOkfService').default;
    const afterMount = repoOkfService.list.mock.calls.length;
    expect(afterMount).toBeGreaterThan(0);
    await jest.advanceTimersByTimeAsync(5000); // tick 1
    expect(repoOkfService.list.mock.calls.length).toBe(afterMount + 1);
    await jest.advanceTimersByTimeAsync(5000); // tick 2
    expect(repoOkfService.list.mock.calls.length).toBe(afterMount + 2);
    // NO idle state: the poll never gates (David, 2026-09-08) — every
    // tick fetches, so a transition to done/draining arrives on its own.
    store.commit('okf/upsertRepo', {
      repo_id: 'r-b',
      name: 'Building Repo',
      lifecycle_state: 'register',
      conversion: { status: 'done', stage: 'done' }
    });
    await jest.advanceTimersByTimeAsync(10000); // two more ticks
    expect(repoOkfService.list.mock.calls.length).toBe(afterMount + 4);
    wrapper.unmount();
  });
});
const OkfRepoEditorShell = require('@/components/okf/editor/RepoEditorShell.vue').default;

describe('OkfRepoEditorShell', () => {
  it('defaults to the Editor sub-tab and dispatches on switch', async () => {
    const realStore = createStore({
      modules: { okf: { ...okfModule, state: () => JSON.parse(JSON.stringify(okfModule.state())) } }
    });
    const wrapper = shallowMount(OkfRepoEditorShell, {
      global: { plugins: [realStore] },
      props: { repoId: 'r-1', draft: null }
    });
    expect(wrapper.vm.subTab).toBe('editor');
    wrapper.vm.onSubTab('wizard');
    expect(realStore.getters['okf/editorSubTab']).toBe('wizard');
    wrapper.unmount();
  });

  // BUILDING PREVIEW (David, 2026-09-05): a converting repo shows the live
  // import-progress card INSTEAD of the wizard/editor tabs — no concepts/
  // manifest/links/drafts fetches against a half-built repo — and a failed
  // conversion shows an actionable error instead of an empty editor.
  it('renders the building panel instead of the tabs while the conversion runs', () => {
    const realStore = createStore({
      modules: { okf: { ...okfModule, state: () => JSON.parse(JSON.stringify(okfModule.state())) } }
    });
    realStore.commit('okf/upsertRepo', {
      repo_id: 'r-1',
      name: 'Repo One',
      lifecycle_state: 'register',
      conversion: { status: 'adding', stage: 'adding', pages_done: 5 }
    });
    const wrapper = shallowMount(OkfRepoEditorShell, {
      global: { plugins: [realStore] },
      props: { repoId: 'r-1', draft: null }
    });
    expect(wrapper.findComponent({ name: 'BuildProgressCard' }).exists()).toBe(true);
    expect(wrapper.findComponent({ name: 'DsTabs' }).exists()).toBe(false);
    wrapper.unmount();
  });

  it('renders an actionable failure panel when the conversion failed', () => {
    const realStore = createStore({
      modules: { okf: { ...okfModule, state: () => JSON.parse(JSON.stringify(okfModule.state())) } }
    });
    realStore.commit('okf/upsertRepo', {
      repo_id: 'r-1',
      name: 'Repo One',
      lifecycle_state: 'register',
      conversion: { status: 'failed', stage: 'adding', error: 'source vanished mid-read' }
    });
    const wrapper = shallowMount(OkfRepoEditorShell, {
      global: { plugins: [realStore] },
      props: { repoId: 'r-1', draft: null }
    });
    expect(wrapper.find('.okf-shell__building-failed').exists()).toBe(true);
    expect(wrapper.text()).toContain('source vanished mid-read');
    expect(wrapper.findComponent({ name: 'DsTabs' }).exists()).toBe(false);
    wrapper.unmount();
  });
});

// ── CROSS-REPO STALE-STATE GUARD (David, 2026-09-06) ────────────────────────
// Opening repo B while a concept from repo A is still selected used to fire
// GET /repos/<A>/concepts/<B-concept> (404): the child editor mounts and
// fetches BEFORE the parent's openEditor reset runs. The guard renders the
// editor ONLY for a concept in the CURRENT repo's list — cross-pairing is
// impossible by construction.
const mockListForRepo = require('@/services/conceptService').default.listForRepo;
const mockConceptGetSvc = require('@/services/conceptService').default.get;
const OkfRepoEditorFull = require('@/components/okf/editor/RepoEditor.vue').default;

describe('OkfRepoEditor — cross-repo stale-selection guard', () => {
  function buildStore() {
    return createStore({
      modules: { okf: { ...okfModule, state: () => JSON.parse(JSON.stringify(okfModule.state())) } }
    });
  }

  // ONE scaffold for the full editor mount: the stub list lives HERE only.
  // Stubbing MORE children is always safe (silence, not behavior change);
  // pass { store } to share a store you pre-seeded, { extraStubs } to add.
  function mountEditorFor(repoId, { store, extraStubs = {} } = {}) {
    return mount(OkfRepoEditorFull, {
      global: {
        plugins: [store || buildStore()],
        stubs: {
          OkfConceptList: true,
          OkfRepoGraphView: true,
          OkfAddConceptModal: true,
          OkfResplitModal: true,
          OkfAutocorrectPanel: true,
          OkfSourceDialog: true,
          OkfTestingLabDialog: true,
          OkfAccessPanel: true,
          OkfPiiRepoRescan: true,
          FrontmatterPanel: true,
          DsDialog: true,
          DsButton: true,
          DsFormGroup: true,
          DsInput: true,
          DsSelect: true,
          DsProgress: true,
          DsInfoTip: true,
          ...extraStubs
        }
      },
      props: { repoId }
    });
  }

  it('never mounts the concept editor with another repo’s selection', async () => {
    mockListForRepo.mockResolvedValue([{ concept_id: 'c-b', title: 'B1', is_index: true }]);
    mockConceptGetSvc.mockResolvedValue({ ok: true, concept: { concept_id: 'c-b', body: '# B1' } });
    const store = buildStore();
    // selection left over from repo A sits in the store BEFORE the switch
    store.commit('okf/setSelectedConcept', 'c-a');
    const wrapper = mountEditorFor('r-b', { store });
    await new Promise((r) => setTimeout(r, 0));
    await wrapper.vm.$nextTick();
    await new Promise((r) => setTimeout(r, 0));
    await wrapper.vm.$nextTick();
    // auto-open picked THIS repo's first concept — never the stale one
    const editor = wrapper.findComponent({ name: 'OkfConceptEditor' });
    expect(editor.exists()).toBe(true);
    expect(editor.props('conceptId')).toBe('c-b');
    expect(mockConceptGetSvc).not.toHaveBeenCalledWith('r-b', 'c-a');
    wrapper.unmount();
  });

  it('renders the placeholder while the selection is not in this repo’s list', async () => {
    mockListForRepo.mockResolvedValue([]); // fresh repo — nothing to select yet
    const wrapper = mountEditorFor('r-b');
    wrapper.vm.$store.commit('okf/setSelectedConcept', 'c-a');
    await new Promise((r) => setTimeout(r, 0));
    await wrapper.vm.$nextTick();
    expect(wrapper.findComponent({ name: 'OkfConceptEditor' }).exists()).toBe(false);
    expect(wrapper.text()).toContain('Select a concept');
    wrapper.unmount();
  });

  // ── #1577 story 2 — the split wiring (review verification gaps) ──────────
  // (1) the pane entry opens the dialog with the emitted concept id;
  // (2) the done handler fires the success toast with the placeholders
  //     SUBSTITUTED and selects part 1 (it kept the original id).

  it('the pane split entry opens the split dialog with the emitted concept id', async () => {
    mockListForRepo.mockResolvedValue([{ concept_id: 'c-b', title: 'B1', is_index: true }]);
    mockConceptGetSvc.mockResolvedValue({ ok: true, concept: { concept_id: 'c-b', body: '# B1' } });
    const wrapper = mountEditorFor('r-1');
    await flushPromises();
    const editor = wrapper.findComponent({ name: 'OkfConceptEditor' });
    expect(editor.exists()).toBe(true);
    // THE pane path: ConceptEditor emits the concept_id STRING, the parent
    // opens the dialog on it.
    editor.vm.$emit('split', 'c-b');
    await wrapper.vm.$nextTick();
    const modal = wrapper.findComponent({ name: 'OkfSplitPreviewModal' });
    expect(modal.exists()).toBe(true);
    expect(modal.props('visible')).toBe(true);
    expect(modal.props('conceptId')).toBe('c-b');
    wrapper.unmount();
  });

  it('the done handler toasts the SUBSTITUTED counts and selects part 1 (the original id)', async () => {
    const notificationService = require('@/services/notificationService').default;
    mockListForRepo.mockResolvedValue([{ concept_id: 'c-b', title: 'B1', is_index: true }]);
    mockConceptGetSvc.mockResolvedValue({ ok: true, concept: { concept_id: 'c-b', body: '# B1' } });
    const wrapper = mountEditorFor('r-1');
    await flushPromises();
    const editor = wrapper.findComponent({ name: 'OkfConceptEditor' });
    editor.vm.$emit('split', 'c-b');
    await wrapper.vm.$nextTick();
    const modal = wrapper.findComponent({ name: 'OkfSplitPreviewModal' });
    modal.vm.$emit('done', {
      concept_id: 'c-b',
      parts: [
        { concept_id: 'c-b', chars: 1 },
        { concept_id: 'c-b-part-2', chars: 1 },
        { concept_id: 'c-b-part-3', chars: 1 }
      ],
      created: 2,
      updated: 1
    });
    await wrapper.vm.$nextTick();
    const toast = notificationService.success.mock.calls[0][0];
    expect(toast).toContain('3'); // {n} — the part count
    expect(toast).toContain('2'); // {created}
    expect(toast).toContain('1'); // {updated}
    expect(toast).not.toContain('{n}');
    expect(toast).not.toContain('{created}');
    expect(toast).not.toContain('{updated}');
    // Part 1 keeps the ORIGINAL id — the selection lands on it.
    expect(wrapper.vm.selectedId).toBe('c-b');
    expect(modal.props('visible')).toBe(false); // the dialog closed
    wrapper.unmount();
  });
});

// ── Baseline F-1 — the crawl-seed render gate (RepoEditorShell) ─────────────
// source_document.url is caller-supplied provenance: it renders as an anchor
// ONLY through the isExternalUrl http(s) allow-list; anything else falls back
// to plain text, so a javascript: scheme can never execute here.
const OkfRepoEditorShellForSeed = require('@/components/okf/editor/RepoEditorShell.vue').default;

describe('OkfRepoEditorShell — the crawl-seed render gate (baseline F-1)', () => {
  function mountShellWithSeed(url) {
    const realStore = createStore({
      modules: { okf: { ...okfModule, state: () => JSON.parse(JSON.stringify(okfModule.state())) } }
    });
    realStore.commit('okf/upsertRepo', {
      repo_id: 'r-1',
      name: 'Repo One',
      lifecycle_state: 'draft',
      source_document: { file_name: 'crawl.md', url }
    });
    return shallowMount(OkfRepoEditorShellForSeed, {
      global: { plugins: [realStore] },
      props: { repoId: 'r-1', draft: null }
    });
  }

  it('a javascript: seed url renders as PLAIN TEXT — never an anchor', () => {
    const wrapper = mountShellWithSeed('javascript:alert(1)');
    const plain = wrapper.find('.expanded-source__url-text');
    expect(plain.exists()).toBe(true);
    expect(plain.text()).toBe('javascript:alert(1)');
    expect(wrapper.find('a[href="javascript:alert(1)"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('an https seed url renders as an anchor', () => {
    const wrapper = mountShellWithSeed('https://ok.example/x');
    expect(wrapper.find('a[href="https://ok.example/x"]').exists()).toBe(true);
    wrapper.unmount();
  });
});
