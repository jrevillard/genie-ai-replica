'use strict';

/**
 * Amendment A (max-review F1 + F7, 2026-09-27): the Finish step's gate.
 * concept_count lives on the METRICS payload — never on the repo doc — so
 * the step fetches it live; and a SERVING (frozen) repo is a read-only
 * summary whose gate OPENS onto the Editor hand-off (never a dead button).
 *
 * Story 1.6 (2026-10-07): a SEPARATE frontmatter gate joins topicsOk. The
 * gate opens only when ≥3 topic tags AND ≥1 forbidden tag are approved
 * (see frontmatterService.isFrontmatterPublishReady). Pre-1.6 repos and
 * serving/frozen repos are exempt (the operator migration workflow
 * re-tags them via scripts/republish-with-tags.js without re-ingesting).
 */

const { mount } = require('@vue/test-utils');
const Vuex = require('vuex');
const OkfStepPublish = require('@/components/okf/steps/Publish.vue').default;

const mockFetchMetrics = jest.fn();
const mockGetFrontmatter = jest.fn();

// Story 1.6 (2026-10-07): the gate now requires BOTH topics AND
// frontmatter for non-frozen repos. Tests that target the "fresh
// draft repo" gate-open-on-topics assertion mock the frontmatter
// service with a tagged payload so the test stays meaningful.
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
  // Default: a curated repo with 3 topics + 1 forbidden, all approved —
  // represents the post-1.6 happy path (gate opens when both signals are
  // present). Tests that target the UN-gated states override this.
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

it('a fresh draft repo: gate closed until the live metric shows topics', async () => {
  const w = mountPublish({ repo_id: 'r1', name: 'R' }); // repo doc WITHOUT concept_count (F1)
  expect(w.emitted('gate')[0][0]).toBe(false);
  await new Promise((r) => setTimeout(r, 0)); // the dispatch chain settles
  await w.vm.$nextTick();
  expect(mockFetchMetrics).toHaveBeenCalled();
  // The gate is now AND of topicsOk + frontmatterOk. With the default
  // curated frontmatter payload + concept_count=4, the gate opens to true.
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

it('a non-frozen repo without approved frontmatter stays gated (Story 1.6)', async () => {
  // Curated topics + 0 frontmatter → gate stays closed
  mockGetFrontmatter.mockResolvedValue({ repo_id: 'r1', frontmatter: [] });
  const w = mountPublish({ repo_id: 'r1', name: 'R' });
  await w.vm.$nextTick();
  await w.vm.$nextTick();
  expect(w.emitted('gate').pop()[0]).toBe(false);
  expect(w.text()).toContain('Frontmatter tags not approved');
});
