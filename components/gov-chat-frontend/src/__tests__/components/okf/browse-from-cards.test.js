'use strict';

/**
 * BROWSE FROM THE STUDIO CARDS — the dashboard's read verb into the W9
 * concept-tree browser (the same browse a chat citation offers). StudioTab
 * hosts the dialog on the shared store slice; the store action opens
 * REPO-LEVEL (tree only, the select hint is the detail pane until a concept
 * is visited).
 */

// The StudioTab rig (mock battery + store + mount) is shared —
// src/__tests__/helpers/studioTab.js.
const { buildStore, mountTab } = require('../../helpers/studioTab');
const ConceptBrowserDialog = require('@/components/okf/ConceptBrowserDialog.vue').default;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('the okf/openConceptBrowser action gains the repo-level open', () => {
  it('a repo-level open shows the dialog with NO concept seeded', async () => {
    const { store } = buildStore();
    const res = await store.dispatch('okf/openConceptBrowser', { repoId: 'r1' });
    expect(res.ok).toBe(true);
    const b = store.state.okf.browser;
    expect(b.visible).toBe(true);
    expect(b.repoId).toBe('r1');
    // The detail pane's empty state: nothing selected, nothing loading, an
    // empty history until the first visit (the openBrowser mutation's null
    // seed).
    expect(b.selectedConceptId).toBeNull();
    expect(b.selectedLoading).toBe(false);
    expect(b.history).toEqual([]);
    expect(b.historyIndex).toBe(-1);
  });

  it('a repo-level open still fetches the tree — but no concept payload', async () => {
    const { store, dispatch } = buildStore();
    await store.dispatch('okf/openConceptBrowser', { repoId: 'r1' });
    const dispatched = dispatch.mock.calls.map((c) => c[0]);
    expect(dispatched).toContain('okf/fetchConceptTree');
    expect(dispatched).not.toContain('okf/browserLoadConcept');
  });

  it('a citation-level open is unchanged (concept seeded, both fetches run)', async () => {
    const { store, dispatch } = buildStore();
    const res = await store.dispatch('okf/openConceptBrowser', { repoId: 'r1', conceptId: 'c1' });
    expect(res.ok).toBe(true);
    const b = store.state.okf.browser;
    expect(b.visible).toBe(true);
    expect(b.selectedConceptId).toBe('c1');
    expect(b.history).toEqual(['c1']);
    const dispatched = dispatch.mock.calls.map((c) => c[0]);
    expect(dispatched).toContain('okf/browserLoadConcept');
  });

  it('an entry without repo identity is still refused (the honest backstop)', async () => {
    const { store } = buildStore();
    expect((await store.dispatch('okf/openConceptBrowser', {})).code).toBe('VALIDATION_ERROR');
    // An empty-string conceptId is NOT a repo-level open — it is a broken
    // citation, and a broken citation never opens a dead dialog.
    expect((await store.dispatch('okf/openConceptBrowser', { repoId: 'r1', conceptId: '' })).code).toBe(
      'VALIDATION_ERROR'
    );
    expect(store.state.okf.browser.visible).toBe(false);
  });
});

describe('StudioTab hosts the browser for the dashboard cards', () => {
  it('onBrowse dispatches the repo-level open; the hosted dialog turns visible', async () => {
    const { store, dispatch } = buildStore();
    const wrapper = mountTab(store);
    wrapper.vm.onBrowse('r1');
    expect(dispatch).toHaveBeenCalledWith('okf/openConceptBrowser', { repoId: 'r1' });
    const dialog = wrapper.findComponent(ConceptBrowserDialog);
    expect(dialog.exists()).toBe(true);
    expect(dialog.props('visible')).toBe(false);
    await store.dispatch('okf/openConceptBrowser', { repoId: 'r1' });
    expect(wrapper.vm.browserVisible).toBe(true);
    expect(wrapper.findComponent(ConceptBrowserDialog).props('visible')).toBe(true);
  });

  it('closeConceptBrowser closes through the SAME store slice', async () => {
    const { store, dispatch } = buildStore();
    const wrapper = mountTab(store);
    await store.dispatch('okf/openConceptBrowser', { repoId: 'r1' });
    expect(wrapper.vm.browserVisible).toBe(true);
    wrapper.vm.closeConceptBrowser();
    expect(dispatch).toHaveBeenCalledWith('okf/closeConceptBrowser');
    expect(wrapper.vm.browserVisible).toBe(false);
  });
});
