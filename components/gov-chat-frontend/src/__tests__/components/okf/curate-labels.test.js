'use strict';

/**
 * Amendment A slice 2 — Curate EMBEDS the full OkfRepoEditor (functional
 * equivalence by composition: concept list, body+frontmatter editing, KH
 * labels, add/delete/resplit/autocorrect). The old labels write-through
 * tests moved WITH the feature into RepoEditor (its meta save surfaces
 * friendlyLifecycleError for REPO_READ_ONLY — editor.test.js covers it).
 * This suite pins the wizard-side contract of the embedding.
 */

jest.mock('@/services/studioService', () => ({
  __esModule: true,
  default: { saveDraft: jest.fn().mockResolvedValue({}), getDraft: jest.fn().mockResolvedValue(null) }
}));
jest.mock('@/services/repoOkfService', () => ({
  __esModule: true,
  default: { list: jest.fn().mockResolvedValue([]), saveStudioStep: jest.fn().mockResolvedValue(true) }
}));
jest.mock('@/services/conceptService', () => ({
  __esModule: true,
  default: { listForRepo: jest.fn().mockResolvedValue([]), update: jest.fn().mockResolvedValue({}) }
}));

const Vuex = require('vuex');
const { mount } = require('@vue/test-utils');
const okfModule = require('@/store/modules/okf').default;
const Curate = require('@/components/okf/steps/Curate.vue').default;

function buildStore() {
  return new Vuex.Store({
    modules: { okf: { ...okfModule, state: () => JSON.parse(JSON.stringify(okfModule.state)) } }
  });
}

function mountCurate(draft, store) {
  return mount(Curate, {
    props: { draft, expert: false },
    global: {
      plugins: [store],
      mocks: { $i18n: { t: (k) => k, locale: 'en' } },
      stubs: {
        // RepoEditor is a tested component of its own — here we pin the
        // CONTRACT of the embedding (props + placement), not its internals.
        OkfRepoEditor: {
          name: 'OkfRepoEditorStub',
          template: '<div class="repo-editor-stub" :data-readonly="readOnly ? \'yes\' : \'no\'">{{ repoId }}</div>',
          props: ['repoId', 'sourceFileId', 'readOnly']
        }
      }
    }
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('OkfStepCurate — the embedded full editor (Amendment A slice 2)', () => {
  it('mounts OkfRepoEditor with the draft repo_id and an open gate', async () => {
    const store = buildStore();
    const wrapper = mountCurate({ repo_id: 'r1', source_file_id: 'f9' }, store);
    await wrapper.vm.$nextTick();
    const editor = wrapper.find('.repo-editor-stub');
    expect(editor.exists()).toBe(true);
    expect(editor.text()).toBe('r1');
    expect(editor.attributes('data-readonly')).toBe('no');
    const gates = wrapper.emitted('gate') || [];
    expect(gates[gates.length - 1]).toEqual([true]); // curation never blocks the flow
    wrapper.unmount();
  });

  it('passes readOnly DOWN when the repo is serving (frozen content)', async () => {
    const store = buildStore();
    store.commit('okf/upsertRepo', { repo_id: 'r1', lifecycle_state: 'publish', ingested_at: '2026-09-27T00:00:00Z' });
    const wrapper = mountCurate({ repo_id: 'r1' }, store);
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.repo-editor-stub').attributes('data-readonly')).toBe('yes');
    wrapper.unmount();
  });

  it('renders the no-repository empty state (dead-end-free) when no repo_id', async () => {
    const store = buildStore();
    const wrapper = mountCurate({ name: 'Fresh Idea' }, store);
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.repo-editor-stub').exists()).toBe(false);
    expect(wrapper.text()).toMatch(/No repository yet/i);
    wrapper.unmount();
  });
});
