'use strict';

/**
 * Story 1-8g-p — the editor entry point for whole-corpus topic-link authoring.
 *
 * The run is DETACHED server-side (a large repository costs minutes of
 * assistant time), so the panel's whole job is: arm the run, poll until a
 * terminal state, and report the result. These tests pin that contract — a poll
 * that stops on 'running' forever is the exact UX failure this story exists to
 * avoid (the same class of bug as the suite-runner spinner).
 */

const { mount } = require('@vue/test-utils');
const Vuex = require('vuex');

jest.mock('@/components/okf/editor/PiiOccurrences.vue', () => ({
  name: 'OkfPiiOccurrences',
  props: ['repoId', 'conceptId', 'revision', 'readOnly'],
  template: '<div class="pii-stub" />'
}));

const OkfStepValidate = require('@/components/okf/steps/Validate.vue').default;

function mountTopicLinks({ pollStates = [], startResult = { ok: true, result: {} } } = {}) {
  const dispatched = [];
  let pollIndex = 0;
  const store = new Vuex.Store({
    modules: {
      okf: {
        namespaced: true,
        getters: {
          repoById: () => () => ({ repo_id: 'r1', lifecycle_state: 'draft' }),
          isExpert: () => false
        }
      }
    }
  });
  store.dispatch = (type, payload) => {
    dispatched.push({ type, payload });
    if (type === 'okf/startTopicLinks') return Promise.resolve(startResult);
    if (type === 'okf/getTopicLinkRun') {
      const r = pollStates.length ? pollStates[Math.min(pollIndex, pollStates.length - 1)] : null;
      pollIndex += 1;
      return Promise.resolve({ ok: true, result: r });
    }
    if (type === 'okf/fetchConcepts') return Promise.resolve({ ok: true, concepts: [] });
    if (type === 'okf/fetchRepoMetrics') return Promise.resolve({ ok: true, metrics: null });
    if (type === 'okf/fetchValidation')
      return Promise.resolve({ ok: true, report: { issues: [], summary: { total: 0 } } });
    return Promise.resolve({ ok: false });
  };
  const w = mount(OkfStepValidate, {
    props: { draft: { repo_id: 'r1' }, expert: false },
    global: { plugins: [store] }
  });
  return { w, dispatched };
}

// Microtask-only flush: these tests drive FAKE timers (the poll re-arms itself
// with setTimeout), so a real setTimeout(r, 0) would never resolve.
const settle = async (w) => {
  await w.vm.$nextTick();
  await Promise.resolve();
  await w.vm.$nextTick();
  await Promise.resolve();
  await w.vm.$nextTick();
};

const topicButton = (w) => w.findAll('button').find((b) => b.text().includes('Cross-link topics'));

describe('OkfStepValidate — whole-corpus topic-link run (Story 1-8g-p)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('offers the cross-link action for a writable repository', async () => {
    const { w } = mountTopicLinks();
    await settle(w);
    expect(topicButton(w)).toBeTruthy();
  });

  it('arms the run and keeps polling until it reaches a terminal state', async () => {
    const { w, dispatched } = mountTopicLinks({
      pollStates: [
        { status: 'running', batches_done: 2, batches_total: 10 },
        { status: 'done', written: 42, concepts_linked: 30 }
      ]
    });
    await settle(w);
    await topicButton(w).trigger('click');
    await settle(w);
    expect(dispatched.find((d) => d.type === 'okf/startTopicLinks').payload).toEqual({ repoId: 'r1' });

    // First poll fires immediately on arm: still running → the panel says so
    // and re-arms its timer instead of leaving a dead button behind.
    expect(dispatched.filter((d) => d.type === 'okf/getTopicLinkRun').length).toBe(1);
    expect(w.text()).toContain('2 of 10');

    // Second poll: done → the panel reports the real counts and re-enables.
    await jest.advanceTimersByTimeAsync(3000);
    await settle(w);
    expect(dispatched.filter((d) => d.type === 'okf/getTopicLinkRun').length).toBe(2);
    expect(w.text()).toContain('Added 42 link(s) across 30 page(s).');
    expect(w.vm.topicLinksBusy).toBe(false);
  });

  it('surfaces a failed run instead of spinning forever', async () => {
    const { w } = mountTopicLinks({ pollStates: [{ status: 'failed', error: 'vllm unreachable' }] });
    await settle(w);
    await topicButton(w).trigger('click');
    await settle(w);
    await jest.advanceTimersByTimeAsync(3000);
    await settle(w);
    expect(w.text()).toContain('vllm unreachable');
    expect(w.vm.topicLinksBusy).toBe(false);
  });

  it('stops polling when the panel is torn down mid-run', async () => {
    const { w, dispatched } = mountTopicLinks({
      pollStates: [{ status: 'running', batches_done: 1, batches_total: 9 }]
    });
    await settle(w);
    await topicButton(w).trigger('click');
    await settle(w);
    const before = dispatched.filter((d) => d.type === 'okf/getTopicLinkRun').length;
    w.unmount();
    await jest.advanceTimersByTimeAsync(9000);
    // A detached poll would keep hitting the API for a panel nobody is looking at.
    expect(dispatched.filter((d) => d.type === 'okf/getTopicLinkRun').length).toBe(before);
  });

  it('reports a refused start (e.g. a run already in flight) without polling', async () => {
    const { w, dispatched } = mountTopicLinks({
      startResult: { ok: false, error: 'a topic-link run is already executing' }
    });
    await settle(w);
    await topicButton(w).trigger('click');
    await settle(w);
    expect(w.text()).toContain('a topic-link run is already executing');
    expect(dispatched.filter((d) => d.type === 'okf/getTopicLinkRun').length).toBe(0);
    expect(w.vm.topicLinksBusy).toBe(false);
  });
});
