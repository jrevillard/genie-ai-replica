// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// #948 (the narrowed Story 10.4) — the cross-repo conformance-debt panel —
// extended by #1650-C with the per-repo issue viewer.
//
// WHAT THIS SUITE PINS:
//   1. WORST FIRST — the rows render sorted by outstanding debt (issues
//      dominate, then stale, then PII), with per-row test handles, and the
//      order survives positional-encoding ranges (140 stale < 1 issue).
//   2. EMPTY vs FAILURE are different states (the #80805 lesson): a clean
//      catalog renders the empty sentence; a failed read renders the error
//      and DROPS the stale rows (an old count must never read as current).
//   3. READ-ONLY (the disposition's cap): the only affordances are Refresh
//      and the per-row issue viewer (a reader, not a mutator); a row click
//      emits `open` with the repo_id (the dashboard's resume path) and
//      nothing acts on the debt.
//   4. The TRUNCATION marker renders when the server's page cap was hit
//      (review round 1, finding 5) — a silent absence would read as a
//      clean ledger.
//   5. THE ISSUE VIEWER (#1650-C): clicking a row's issues count opens a
//      dialog fed by the repo's /validation report; a failed read shows the
//      error INSIDE the dialog (the card's rows stay untouched); the
//      issues-button click must NOT also open the repo (@click.stop).

import { mount } from '@vue/test-utils';
import ConformanceDebtPanel from '@/components/okf/ConformanceDebtPanel.vue';
import repoOkfService from '@/services/repoOkfService';

jest.mock('@/services/repoOkfService', () => ({
  __esModule: true,
  default: {
    getConformanceDebt: jest.fn(),
    getRepoValidation: jest.fn()
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

/** The /validation report body the viewer reads (getRepoValidation). */
function report(issues) {
  return { issues, summary: { total: issues.length }, generated_at: '2026-11-09T00:00:00Z' };
}

const DS_STUBS = {
  DsButton: {
    props: ['variant', 'small', 'disabled'],
    template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>'
  },
  DsPill: { props: ['variant'], template: '<span class="pill"><slot /></span>' },
  // Faithful-enough stub: renders only when visible, shows the title, the
  // slot, and one button per declared action that emits `action` with the
  // key — the panel closes the viewer through that event.
  DsDialog: {
    props: ['visible', 'title', 'size', 'scrollable', 'actions'],
    emits: ['close', 'action'],
    template: `<div v-if="visible" class="ds-dialog-stub" :data-test-id="'dialog-' + title">
      <h3>{{ title }}</h3>
      <slot />
      <button v-for="a in (actions || [])" :key="a.key" :data-test-id="'dialog-action-' + a.key" @click="$emit('action', a.key)">
        {{ a.label }}
      </button>
    </div>`
  }
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
  // The buttons are the read refresh and the two issue-viewer triggers (one
  // per row, carrying each row's issue count) — readers, never mutators.
  const buttons = w.findAll('button').map((b) => b.text().trim());
  expect(buttons).toEqual(['Refresh', '0', '0']);
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

it('#1650-C: the issues button opens the viewer and renders the /validation report', async () => {
  const w = mountPanel(
    envelope([
      row({ repo_id: 'r-el-sal', name: 'El Salvador', conformance_issue_count: 2 }),
      row({ repo_id: 'r-other', conformance_issue_count: 0 })
    ])
  );
  await flush();
  await w.vm.$nextTick();
  repoOkfService.getRepoValidation.mockResolvedValueOnce(
    report([
      {
        type: 'conformance',
        severity: 'warning',
        concept_id: 'c-1',
        code: 'SOURCE_MISSING_RESOURCE',
        message: 'source resource gone',
        remedy: 're-crawl'
      },
      {
        type: 'conformance',
        severity: 'blocker',
        concept_id: 'c-2',
        code: 'PII_STATE_ERROR',
        message: 'unresolved PII',
        remedy: 'accept or redact'
      }
    ])
  );
  await w.find('[data-test-id="debt-issues-r-el-sal"]').trigger('click');
  await flush();
  await w.vm.$nextTick();
  // The viewer read exactly this repo's report.
  expect(repoOkfService.getRepoValidation).toHaveBeenCalledWith('r-el-sal');
  const dialog = w.find('[data-test-id^="dialog-"]');
  expect(dialog.exists()).toBe(true);
  expect(dialog.find('[data-test-id="debt-issues-list-r-el-sal"]').exists()).toBe(true);
  // Both issues render with their concept, code, message and remedy.
  const items = dialog.findAll('.okf-debt__issue-item');
  expect(items).toHaveLength(2);
  expect(items[0].text()).toContain('c-1');
  expect(items[0].text()).toContain('SOURCE_MISSING_RESOURCE');
  expect(items[0].text()).toContain('re-crawl');
  expect(items[1].text()).toContain('PII_STATE_ERROR');
  // The issues-button click must NOT also open the repo (@click.stop).
  expect(w.emitted('open')).toBeUndefined();
});

it('#1650-C: a failed validation read shows the error INSIDE the dialog; the card rows stay', async () => {
  const w = mountPanel(envelope([row({ repo_id: 'r-x', name: 'X', conformance_issue_count: 1 })]));
  await flush();
  await w.vm.$nextTick();
  repoOkfService.getRepoValidation.mockRejectedValueOnce({ message: 'validation boom' });
  await w.find('[data-test-id="debt-issues-r-x"]').trigger('click');
  await flush();
  await w.vm.$nextTick();
  const dialog = w.find('[data-test-id^="dialog-"]');
  expect(dialog.exists()).toBe(true);
  // The error lives inside the dialog, not on the card.
  expect(dialog.find('[role="alert"]').exists()).toBe(true);
  expect(dialog.text()).toContain('validation boom');
  expect(dialog.find('[data-test-id="debt-issues-list-r-x"]').exists()).toBe(false);
  // The card's rows and its own error state are untouched.
  expect(w.find('[data-test-id="debt-row-r-x"]').exists()).toBe(true);
  expect(w.vm.error).toBe('');
});

it('#1650-C: closing the viewer clears it (the Close action)', async () => {
  const w = mountPanel(envelope([row({ repo_id: 'r-y', conformance_issue_count: 1 })]));
  await flush();
  await w.vm.$nextTick();
  repoOkfService.getRepoValidation.mockResolvedValueOnce(
    report([{ type: 'orphan', severity: 'warning', concept_id: 'c-9', message: 'not linked', remedy: 'link it' }])
  );
  await w.find('[data-test-id="debt-issues-r-y"]').trigger('click');
  await flush();
  await w.vm.$nextTick();
  expect(w.find('[data-test-id^="dialog-"]').exists()).toBe(true);
  await w.find('[data-test-id="dialog-action-close"]').trigger('click');
  await w.vm.$nextTick();
  expect(w.find('[data-test-id^="dialog-"]').exists()).toBe(false);
});

it('#1650-C: a repo whose report is empty renders the nothing-to-fix state', async () => {
  const w = mountPanel(envelope([row({ repo_id: 'r-clean2', conformance_issue_count: 1 })]));
  await flush();
  await w.vm.$nextTick();
  repoOkfService.getRepoValidation.mockResolvedValueOnce(report([]));
  await w.find('[data-test-id="debt-issues-r-clean2"]').trigger('click');
  await flush();
  await w.vm.$nextTick();
  const dialog = w.find('[data-test-id^="dialog-"]');
  expect(dialog.exists()).toBe(true);
  expect(dialog.find('[data-test-id="debt-issues-list-r-clean2"]').exists()).toBe(false);
  expect(dialog.text()).toContain('Nothing to fix');
  expect(dialog.find('[role="alert"]').exists()).toBe(false);
});
