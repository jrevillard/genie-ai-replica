'use strict';

/**
 * Step 9 final visual review (David, 2026-09-29): between the summary block
 * and the handoff note, the step embeds the WHOLE repo as a read-only
 * OkfRepoEditor — the file list, each file's markdown and its labels — as
 * the last look before the handoff. Read-only by definition: the ritual
 * lives outside the wizard (Amendment A).
 */

const { mount } = require('@vue/test-utils');
const Vuex = require('vuex');

jest.mock('@/components/okf/editor/RepoEditor.vue', () => ({
  name: 'OkfRepoEditor',
  props: ['repoId', 'readOnly', 'sourceFileId'],
  template: '<div class="repo-editor-stub" data-testid="repo-editor" />'
}));

const OkfStepReview = require('@/components/okf/steps/Review.vue').default;

function store() {
  return new Vuex.Store({
    modules: {
      okf: {
        namespaced: true,
        getters: {
          repoById: () => (id) => (id === 'r1' ? { repo_id: 'r1', name: 'R1', concept_count: 6 } : null)
        },
        actions: {}
      }
    }
  });
}

function mountStep(draft) {
  return mount(OkfStepReview, {
    props: { draft: draft === undefined ? { repo_id: 'r1', name: 'R1' } : draft, expert: false },
    global: { stubs: { DsInfoTip: true, DsButton: true, OkfVersionsDialog: true, OkfLogsDialog: true, OkfRenameRepoDialog: true }, plugins: [store()] }
  });
}

// repoOkfService.listVersions must never explode in tests
jest.mock('@/services/repoOkfService', () => ({ listVersions: jest.fn(async () => []) }));

describe('OkfStepReview — final visual review browser', () => {
  it('embeds the read-only repo editor for the draft repo', () => {
    const w = mountStep();
    const ed = w.findComponent({ name: 'OkfRepoEditor' });
    expect(ed.exists()).toBe(true);
    expect(ed.props('readOnly')).toBe(true);
    expect(ed.props('repoId')).toBe('r1');
  });

  it('places the browser AFTER the summary and BEFORE the handoff note', () => {
    const w = mountStep();
    const html = w.html();
    const summaryAt = html.indexOf('okf-step__summary');
    const browserAt = html.indexOf('okf-step__browser');
    const handoffAt = html.indexOf('okf-step__handoff');
    expect(summaryAt).toBeGreaterThanOrEqual(0);
    expect(browserAt).toBeGreaterThan(summaryAt);
    expect(handoffAt).toBeGreaterThan(browserAt);
  });

  it('shows the empty note (and no editor) when no repo exists yet', () => {
    const w = mountStep({ name: 'ghost' });
    expect(w.findComponent({ name: 'OkfRepoEditor' }).exists()).toBe(false);
    expect(w.text()).toContain('No repository yet');
  });

  it('never enables a write path — the editor prop is literally true', () => {
    const w = mountStep();
    const ed = w.findComponent({ name: 'OkfRepoEditor' });
    expect(ed.props('readOnly')).toBe(true);
    expect(ed.props('readOnly')).not.toBeFalsy();
  });

  it('keeps the step gate open (review never blocks)', () => {
    const w = mountStep();
    expect(w.emitted('gate')).toBeTruthy();
    expect(w.emitted('gate')[0]).toEqual([true]);
  });
});
