// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// #948 (the narrowed Story 10.4) — the cross-repo conformance-debt panel.
//
// WHAT THIS SUITE PINS:
//   1. WORST FIRST — the rows render sorted by outstanding debt (issues
//      dominate, then stale, then PII), with per-row test handles, and the
//      order survives positional-encoding ranges (140 stale < 1 issue).
//   2. EMPTY vs FAILURE are different states (the #80805 lesson): a clean
//      catalog renders the empty sentence; a failed read renders the error
//      and DROPS the stale rows (an old count must never read as current).
//   3. READ-ONLY (the disposition's cap): the only affordance is Refresh;
//      a row click emits `open` with the repo_id (the dashboard's resume
//      path) and nothing acts on the debt.
//   4. The TRUNCATION marker renders when the server's page cap was hit
//      (review round 1, finding 5) — a silent absence would read as a
//      clean ledger.

import { mount } from '@vue/test-utils';
import ConformanceDebtPanel from '@/components/okf/ConformanceDebtPanel.vue';
import repoOkfService from '@/services/repoOkfService';

jest.mock('@/services/repoOkfService', () => ({
  __esModule: true,
  default: {
    getConformanceDebt: jest.fn()
  }
}));

function row(over = {}) {
  return {
    repo_id: 'r-a',
    name: 'Alpha',
    domain: 'health',
    lifecycle_state: 'publish',
    concept_count: 12,
    conformance_issue_count: 0,
    stale_concept_count: 0,
    pii_hit_count: 0,
    has_reserved_index: true,
    ...over
  };
}

/** The service method resolves the full envelope: {items, truncated}. */
function envelope(items, truncated = false) {
  return { items, truncated };
}

const DS_STUBS = {
  DsButton: {
    props: ['variant', 'small', 'disabled'],
    template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>'
  },
  DsPill: { props: ['variant'], template: '<span class="pill"><slot /></span>' }
};

function mountPanel(response) {
  if (response !== undefined) repoOkfService.getConformanceDebt.mockResolvedValue(response);
  return mount(ConformanceDebtPanel, {
    global: {
      mocks: { $i18n: { t: (k) => k, locale: 'en' } },
      stubs: DS_STUBS
    }
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

// mounted() fires onRefresh asynchronously — a single $nextTick does not
// flush the promise chain the read rides (the retrieval-card suite's rule).
const flush = () => new Promise((r) => setTimeout(r, 0));

it('renders the rows worst-first with per-row handles', async () => {
  const w = mountPanel(
    envelope([
      row({ repo_id: 'r-clean', name: 'Clean', conformance_issue_count: 0, stale_concept_count: 0, pii_hit_count: 0 }),
      row({ repo_id: 'r-pii', name: 'PiiOnly', conformance_issue_count: 0, stale_concept_count: 0, pii_hit_count: 3 }),
      row({ repo_id: 'r-worst', name: 'Worst', conformance_issue_count: 5, stale_concept_count: 2, pii_hit_count: 1 }),
      row({ repo_id: 'r-stale', name: 'Stale', conformance_issue_count: 0, stale_concept_count: 4, pii_hit_count: 0 })
    ])
  );
  await flush();
  await w.vm.$nextTick();
  const order = w.findAll('[data-test-id^="debt-row-"]').map((n) => n.attributes('data-test-id'));
  // Issues dominate stale dominates PII: 5 issues > 4 stale > 3 pii > 0.
  expect(order).toEqual(['debt-row-r-worst', 'debt-row-r-stale', 'debt-row-r-pii', 'debt-row-r-clean']);
  // The issues cell carries the count on its own handle.
  expect(w.find('[data-test-id="debt-issues-r-worst"]').text()).toBe('5');
  expect(w.vm.truncated).toBe(false);
});

it('issues dominate stale even past positional-encoding ranges (review round 1, finding 4)', async () => {
  const w = mountPanel(
    envelope([
      row({ repo_id: 'r-one-issue', conformance_issue_count: 1, stale_concept_count: 0, pii_hit_count: 0 }),
      row({ repo_id: 'r-many-stale', conformance_issue_count: 0, stale_concept_count: 140, pii_hit_count: 0 })
    ])
  );
  await flush();
  await w.vm.$nextTick();
  // A base-100 positional key (issues*10000 + stale*100) would rank 140
  // stale ABOVE 1 issue; the lexicographic compare never lets it.
  const order = w.findAll('[data-test-id^="debt-row-"]').map((n) => n.attributes('data-test-id'));
  expect(order).toEqual(['debt-row-r-one-issue', 'debt-row-r-many-stale']);
});

it('a clean catalog renders the empty state, not a failure', async () => {
  const w = mountPanel(envelope([]));
  await flush();
  await w.vm.$nextTick();
  expect(w.vm.error).toBe('');
  expect(w.text()).toContain('No concepts in any repository you can read');
  expect(w.find('[role="alert"]').exists()).toBe(false);
});

it('a failed read renders the error and DROPS the stale rows', async () => {
  const w = mountPanel(envelope([row({ repo_id: 'r-stale-data' })]));
  await flush();
  await w.vm.$nextTick();
  expect(w.find('[data-test-id="debt-row-r-stale-data"]').exists()).toBe(true);
  repoOkfService.getConformanceDebt.mockRejectedValueOnce({ message: 'boom' });
  await w.vm.onRefresh();
  await flush();
  await w.vm.$nextTick();
  // The old rows are gone — an operator must not read a stale count as current.
  expect(w.find('[data-test-id="debt-row-r-stale-data"]').exists()).toBe(false);
  expect(w.find('[role="alert"]').exists()).toBe(true);
  expect(w.vm.error).toBe('boom');
});

it('READ-ONLY: a row click emits open(repo_id); no mutation affordance exists', async () => {
  const w = mountPanel(envelope([row({ repo_id: 'r-1' }), row({ repo_id: 'r-2' })]));
  await flush();
  await w.vm.$nextTick();
  await w.find('[data-test-id="debt-row-r-2"]').trigger('click');
  expect(w.emitted('open')).toEqual([['r-2']]);
  // The only button on the panel is the read refresh.
  const buttons = w.findAll('button').map((b) => b.text().trim());
  expect(buttons).toEqual(['Refresh']);
});

it('a truncated catalog names the cap instead of reading as a clean ledger', async () => {
  const w = mountPanel(envelope([row({ repo_id: 'r-in-page' })], true));
  await flush();
  await w.vm.$nextTick();
  expect(w.vm.truncated).toBe(true);
  expect(w.find('[role="status"]').exists()).toBe(true);
  expect(w.text()).toContain('rows past the cap are not shown');
  // The clean response never shows the marker.
  const w2 = mountPanel(envelope([row({ repo_id: 'r-in-page' })], false));
  await flush();
  await w2.vm.$nextTick();
  expect(w2.find('[role="status"]').exists()).toBe(false);
});
