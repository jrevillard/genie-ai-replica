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

function store() {
  return new Vuex.Store({
    modules: {
      okf: {
        namespaced: true,
        getters: { repoById: () => (id) => (id === 'r1' ? { repo_id: 'r1', name: 'R1' } : null) },
        actions: { fetchRepoMetrics: () => ({ concept_count: 3 }) }
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

describe('T4 — autocorrect step', () => {
  it('embeds the REAL AutocorrectPanel, open, scoped to the repo', () => {
    const wrapper = mountStep(OkfStepAutocorrect);
    const panel = wrapper.findComponent(OkfAutocorrectPanel);
    expect(panel.exists()).toBe(true);
    expect(panel.props('visible')).toBe(true);
    expect(panel.props('repoId')).toBe('r1');
    expect(wrapper.emitted('gate')[0][0]).toBe(true); // never a dead end
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
    const buttons = wrapper.findAll('button').map((b) => b.text()).join(' ');
    expect(buttons.toLowerCase()).not.toContain('publish');
  });

  it('the dashboard hand-off button emits dashboard (D4)', async () => {
    const wrapper = mountStep(OkfStepPublish);
    const btn = wrapper
      .findAll('button')
      .find((b) => b.text().includes('Open the Dashboard'));
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
