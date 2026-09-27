'use strict';

/**
 * Amendment A (max-review F1 + F7, 2026-09-27): the Finish step's gate.
 * concept_count lives on the METRICS payload — never on the repo doc — so
 * the step fetches it live; and a SERVING (frozen) repo is a read-only
 * summary whose gate OPENS onto the Editor hand-off (never a dead button).
 */

const { mount } = require('@vue/test-utils');
const Vuex = require('vuex');
const OkfStepPublish = require('@/components/okf/steps/Publish.vue').default;

const mockFetchMetrics = jest.fn();

function mountPublish(repo) {
  return mount(OkfStepPublish, {
    props: { draft: { repo_id: 'r1', name: 'R' }, expert: false },
    global: {
      stubs: { DsStatusTag: true },
      plugins: [
        new Vuex.Store({
          modules: {
            okf: {
              namespaced: true,
              getters: { repoById: () => () => repo || null },
              actions: { fetchRepoMetrics: () => mockFetchMetrics() }
            }
          }
        })
      ]
    }
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFetchMetrics.mockResolvedValue({ concept_count: 4 });
});

it('a fresh draft repo: gate closed until the live metric shows topics', async () => {
  const w = mountPublish({ repo_id: 'r1', name: 'R' }); // repo doc WITHOUT concept_count (F1)
  expect(w.emitted('gate')[0][0]).toBe(false);
  await new Promise((r) => setTimeout(r, 0)); // the dispatch chain settles
  await w.vm.$nextTick();
  expect(mockFetchMetrics).toHaveBeenCalled();
  expect(w.emitted('gate').pop()[0]).toBe(true);
});

it('a zero-topic repo stays gated with the pending hint', async () => {
  mockFetchMetrics.mockResolvedValue({ concept_count: 0 });
  const w = mountPublish({ repo_id: 'r1', name: 'R' });
  await w.vm.$nextTick();
  await w.vm.$nextTick();
  expect(w.emitted('gate').pop()[0]).toBe(false);
  expect(w.text()).toContain('No topics yet');
});

it('a serving repo opens the gate — read-only summary, never a dead end (F7)', () => {
  const w = mountPublish({ repo_id: 'r1', name: 'R', ingested_at: 't' });
  expect(w.emitted('gate')[0][0]).toBe(true);
  expect(w.text()).toContain('read-only summary');
});
