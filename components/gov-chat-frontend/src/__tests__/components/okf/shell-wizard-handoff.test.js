'use strict';

/**
 * WIZARD HANDOFF WIRING (field bugs #1028 + #1032, David 2026-09-30): the
 * RepoEditorShell embeds its OWN OkfStudioWizard instance — and that
 * instance never wired @finish/@dashboard, so step 10's "Open the Editor"
 * and "Open the Dashboard" buttons emitted into the void. Jest stayed green
 * because the standalone StudioTab wizard always had both wired; only the
 * card-opened shell path was dead. These tests mount the SHELL (not the
 * step) and emit on the embedded wizard — asserting the wiring, not the
 * handlers in isolation.
 */

const { mount } = require('@vue/test-utils');
const Vuex = require('vuex');

jest.mock('@/components/okf/editor/RepoEditor.vue', () => ({
  name: 'OkfRepoEditor',
  props: ['repoId', 'readOnly', 'sourceFileId'],
  template: '<div class="repo-editor-stub" />'
}));
jest.mock('@/components/okf/editor/VersionsDialog.vue', () => ({
  name: 'OkfVersionsDialog',
  props: ['visible', 'repo'],
  template: '<div class="versions-stub" />'
}));
jest.mock('@/components/okf/editor/LogsDialog.vue', () => ({
  name: 'OkfLogsDialog',
  props: ['visible', 'repo'],
  template: '<div class="logs-stub" />'
}));
jest.mock('@/components/okf/editor/BuildProgressCard.vue', () => ({
  name: 'BuildProgressCard',
  props: ['repo'],
  template: '<div class="build-stub" />'
}));
jest.mock('@/services/okfRepoOps', () => ({
  __esModule: true,
  default: {
    isBuilding: () => false,
    isRedraining: () => false,
    loadSubjectAreaOptions: jest.fn().mockResolvedValue([])
  }
}));

const OkfRepoEditorShell = require('@/components/okf/editor/RepoEditorShell.vue').default;

function mountShell() {
  const dispatch = jest.fn();
  const store = new Vuex.Store({
    modules: {
      okf: {
        namespaced: true,
        getters: {
          editorSubTab: () => 'wizard',
          repoById: () => () => ({ repo_id: 'r1', name: 'R1', lifecycle_state: 'draft' }),
          conceptsByRepo: () => () => []
        },
        actions: {}
      }
    }
  });
  store.dispatch = dispatch;
  const w = mount(OkfRepoEditorShell, {
    props: { repoId: 'r1', draft: { repo_id: 'r1', name: 'R1', studio_step: 9 }, sourceFileId: null },
    global: { plugins: [store] }
  });
  return { w, dispatch };
}

describe('RepoEditorShell — embedded wizard hand-off wiring', () => {
  it('wizard finish switches to the EDITOR sub-tab (step 10 "Open the Editor")', async () => {
    const { w, dispatch } = mountShell();
    const wiz = w.findComponent({ name: 'OkfStudioWizard' });
    expect(wiz.exists()).toBe(true);
    wiz.vm.$emit('finish', { repo_id: 'r1' });
    await w.vm.$nextTick();
    expect(dispatch).toHaveBeenCalledWith('okf/setEditorSubTab', 'editor');
  });

  it('wizard dashboard goes back to the studio dashboard (step 10 "Open the Dashboard")', async () => {
    const { w } = mountShell();
    const wiz = w.findComponent({ name: 'OkfStudioWizard' });
    wiz.vm.$emit('dashboard');
    await w.vm.$nextTick();
    expect(w.emitted('back')).toBeTruthy();
  });

  it('wizard reset (footer "Back to dashboard") still goes back — regression guard', async () => {
    const { w } = mountShell();
    const wiz = w.findComponent({ name: 'OkfStudioWizard' });
    wiz.vm.$emit('reset');
    await w.vm.$nextTick();
    expect(w.emitted('back')).toBeTruthy();
  });
});
