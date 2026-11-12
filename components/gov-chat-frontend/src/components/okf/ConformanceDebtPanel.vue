<!--
  ConformanceDebtPanel.vue — #948 (David's 2026-11-05 disposition — the
  narrowed Story 10.4): the cross-repo conformance-debt card in the OKF
  Studio tab.

  WHAT IT SHOWS: for every repository the caller can read (the SAME
  default-deny ACL composition the repo list uses — a steward sees their
  repos, a caller with no grant sees none), one row of outstanding curation
  debt: conformance issues, stale concepts, unresolved PII hits. The field
  names and discriminators mirror the per-repo /metrics block exactly, so
  the numbers here agree with the wizard's — one vocabulary, two surfaces.
  The panel lives in the Studio dashboard (an admin surface) — the
  read-family "open mode" verdict used by the concept routes does NOT
  apply here; the authz is the repo list's, deliberately.

  WHAT IT DOES NOT DO: nothing mutates. The disposition capped this story
  at READ-ONLY aggregation — the per-repo popups stay the remediation
  surface. A row click OPENS that repo (the Studio dashboard's resume
  path); it never acts on the debt.
-->
<template>
  <section class="okf-debt" :data-test-id="testId">
    <header class="okf-debt__header">
      <h3 class="okf-debt__title">{{ translate('okf.debt.title', 'Conformance debt') }}</h3>
      <span class="okf-debt__pills">
        <DsPill v-if="loading" variant="info">{{ translate('okf.debt.loading', 'Reading…') }}</DsPill>
        <DsPill v-else-if="!error && rows.length" variant="neutral">
          {{ translate('okf.debt.repoCount', '{n} repo(s) with concepts').replace('{n}', String(rows.length)) }}
        </DsPill>
        <DsButton variant="ghost" small :disabled="loading" @click="onRefresh">
          {{ translate('okf.debt.refresh', 'Refresh') }}
        </DsButton>
      </span>
    </header>

    <p v-if="error" class="okf-debt__error" role="alert">{{ error }}</p>

    <!-- Hitting the server's page cap is NAMED, never silent: repos past the
         cap are absent from these rows, and a silent absence reads as a
         clean ledger (review round 1, finding 5). -->
    <p v-if="truncated" class="okf-debt__warn" role="status">
      {{
        translate('okf.debt.truncated', 'The repository catalog exceeds one page — rows past the cap are not shown.')
      }}
    </p>

    <!-- The #80805 lesson: "read, and nothing owes" is a DIFFERENT state
         from "could not read" — never render the former for the latter. -->
    <p v-else-if="!loading && !rows.length" class="okf-debt__empty">
      {{ translate('okf.debt.empty', 'No concepts in any repository you can read — nothing to owe.') }}
    </p>

    <div v-else class="okf-debt__scroll">
      <table class="okf-debt__table">
        <thead>
          <tr>
            <th scope="col">{{ translate('okf.debt.col.repo', 'Repository') }}</th>
            <th scope="col">{{ translate('okf.debt.col.concepts', 'Concepts') }}</th>
            <th scope="col">{{ translate('okf.debt.col.issues', 'Issues') }}</th>
            <th scope="col">{{ translate('okf.debt.col.stale', 'Stale') }}</th>
            <th scope="col">{{ translate('okf.debt.col.pii', 'PII hits') }}</th>
            <th scope="col">{{ translate('okf.debt.col.state', 'State') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in sortedRows"
            :key="row.repo_id"
            class="okf-debt__row"
            :class="{ 'okf-debt__row--clean': debtTotal(row) === 0 }"
            :data-test-id="'debt-row-' + row.repo_id"
            @click="onOpen(row)"
          >
            <td class="okf-debt__name">
              {{ row.name || row.repo_id }}
              <span v-if="row.domain" class="okf-debt__domain">{{ row.domain }}</span>
            </td>
            <td>{{ row.concept_count }}</td>
            <td :class="{ 'okf-debt__bad': row.conformance_issue_count > 0 }">
              <!-- #1650-C: the count is a VIEWER trigger — click to read the
                   repo's actual issue list (the /validation report) without
                   leaving the debt card. @click.stop: the ROW opens the repo;
                   the CELL reads its issues. -->
              <button
                type="button"
                class="okf-debt__issues-btn"
                :data-test-id="'debt-issues-' + row.repo_id"
                @click.stop="onViewIssues(row)"
              >
                {{ row.conformance_issue_count }}
              </button>
            </td>
            <td :class="{ 'okf-debt__warn': row.stale_concept_count > 0 }">{{ row.stale_concept_count }}</td>
            <td :class="{ 'okf-debt__bad': row.pii_hit_count > 0 }">{{ row.pii_hit_count }}</td>
            <td>
              <DsPill :variant="stateVariant(row.lifecycle_state)">{{ row.lifecycle_state || '—' }}</DsPill>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- #1650-C: the per-repo issue viewer. The report is the server's own
         /validation payload (type, severity, concept, message, remedy) —
         the SAME list the wizard's Validate step renders, read in place.
         Read-only: a dialog that only looks. -->
    <DsDialog
      class="genie-living-intelligence"
      :visible="issuesRepo !== null"
      :title="issuesDialogTitle"
      size="md"
      scrollable
      :actions="issuesActions"
      @close="issuesRepo = null"
      @action="issuesRepo = null"
    >
      <p v-if="issuesError" class="okf-debt__error" role="alert">{{ issuesError }}</p>
      <p v-else-if="issuesLoading" class="okf-debt__empty">
        {{ translate('okf.debt.issuesLoading', 'Reading the issue list…') }}
      </p>
      <p v-else-if="!issuesRows.length" class="okf-debt__empty">
        {{ translate('okf.debt.issuesEmpty', 'Nothing to fix — no open issues.') }}
      </p>
      <ul v-else class="okf-debt__issue-list" :data-test-id="'debt-issues-list-' + issuesRepo.repo_id">
        <li v-for="(iss, i) in issuesRows" :key="i" class="okf-debt__issue-item">
          <span class="okf-debt__issue-head">
            <DsPill :variant="iss.severity === 'blocker' || iss.severity === 'error' ? 'danger' : 'warning'">
              {{ translate('okf.debt.sev.' + iss.severity, iss.severity) }}
            </DsPill>
            <code v-if="iss.concept_id" class="okf-debt__issue-concept">{{ iss.concept_id }}</code>
            <span v-if="iss.code" class="okf-debt__issue-code">{{ iss.code }}</span>
          </span>
          <span class="okf-debt__issue-message">{{ iss.message }}</span>
          <span class="okf-debt__issue-remedy">{{ iss.remedy }}</span>
        </li>
      </ul>
    </DsDialog>
  </section>
</template>

<script>
import DsButton from '../ds/Button.vue';
import DsDialog from '../ds/Dialog.vue';
import DsPill from '../ds/Pill.vue';
import translateMixin from '../../mixins/translateMixin';
import repoOkfService from '../../services/repoOkfService';

/**
 * The server's reason, read from the envelope httpService actually rejects
 * with: `{ status, statusText, data, message }` — there is NO `.response` on
 * it (httpService.handleResponseError). The axios shape is accepted as a
 * fallback so a raw axios rejection still reads. (The RetrievalCard rule.)
 */
function refusalMessage(err) {
  const body = (err && err.data) || (err && err.response && err.response.data) || null;
  return (body && body.message) || (err && err.message) || '';
}

export default {
  name: 'OkfConformanceDebtPanel',
  components: { DsButton, DsPill, DsDialog },
  mixins: [translateMixin],
  props: {
    /** The test handle for the Playwright surface. */
    testId: { type: String, default: 'okf-conformance-debt' }
  },
  emits: ['open'],
  data() {
    return {
      loading: false,
      error: '',
      rows: [],
      truncated: false,
      // The per-repo issue viewer (#1650-C): the ROW object of the repo
      // whose issues are open (null = closed), the fetched report, and the
      // read's own error state (distinct from the card's).
      issuesRepo: null,
      issuesLoading: false,
      issuesError: '',
      issuesRows: []
    };
  },
  computed: {
    issuesDialogTitle() {
      if (!this.issuesRepo) return '';
      const name = this.issuesRepo.name || this.issuesRepo.repo_id;
      return this.translate('okf.debt.issuesTitle', 'Issues — {name}').replace('{name}', name);
    },
    issuesActions() {
      return [{ key: 'close', label: this.translate('common.close', 'Close'), variant: 'secondary' }];
    },
    /** Worst first: a lexicographic compare on (issues, stale, pii) — a
     *  positional encoding (issues × 10000 + …) would let 100+ stale outrank
     *  1 issue on a Bali-scale repo (review round 1, finding 4). */
    sortedRows() {
      const count = (v) => v || 0;
      return [...this.rows].sort((a, b) => {
        const d =
          count(b.conformance_issue_count) - count(a.conformance_issue_count) ||
          count(b.stale_concept_count) - count(a.stale_concept_count) ||
          count(b.pii_hit_count) - count(a.pii_hit_count);
        return d;
      });
    }
  },
  mounted() {
    this.onRefresh();
  },
  methods: {
    debtTotal(row) {
      return (row.conformance_issue_count || 0) + (row.stale_concept_count || 0) + (row.pii_hit_count || 0);
    },
    stateVariant(state) {
      if (state === 'publish') return 'success';
      if (state === 'retracted') return 'danger';
      if (state === 'draft' || state === 'submit' || state === 'review' || state === 'approve') return 'accent';
      return 'neutral';
    },
    onOpen(row) {
      if (!row || !row.repo_id) return;
      this.$emit('open', row.repo_id);
    },
    /** #1650-C: open the viewer for ONE repo and read its /validation
     *  report. The dialog is the only surface it feeds; a failed read
     *  shows the error INSIDE the dialog (the card's rows stay untouched). */
    async onViewIssues(row) {
      if (!row || !row.repo_id) return;
      this.issuesRepo = row;
      this.issuesLoading = true;
      this.issuesError = '';
      this.issuesRows = [];
      try {
        const report = await repoOkfService.getRepoValidation(row.repo_id);
        this.issuesRows = report.issues;
      } catch (err) {
        this.issuesError =
          refusalMessage(err) || this.translate('okf.debt.issuesFailed', 'Could not read the issue list.');
      } finally {
        this.issuesLoading = false;
      }
    },
    async onRefresh() {
      this.loading = true;
      this.error = '';
      try {
        const body = await repoOkfService.getConformanceDebt();
        this.rows = body.items;
        this.truncated = body.truncated === true;
      } catch (err) {
        // A failed re-read must not leave the STALE rows on screen next to
        // the error — an operator would read an old count as current (the
        // RetrievalCard rule, same defect class).
        this.rows = [];
        this.truncated = false;
        this.error =
          refusalMessage(err) || this.translate('okf.debt.readFailed', 'Could not read the conformance debt.');
      } finally {
        this.loading = false;
      }
    }
  }
};
</script>

<style scoped>
.okf-debt {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  padding: var(--space-md);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface);
}
.okf-debt__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--space-sm);
}
.okf-debt__title {
  margin: 0;
  font-size: var(--text-md);
  font-weight: 600;
}
.okf-debt__pills {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  flex-wrap: wrap;
}
.okf-debt__error {
  margin: 0;
  color: var(--danger);
  font-size: var(--text-xs);
}
.okf-debt__empty {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--muted);
}
.okf-debt__warn {
  margin: 0;
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-sm);
  background: var(--warning-bg);
  color: var(--warning-ink);
  font-size: var(--text-xs);
}
.okf-debt__scroll {
  overflow-x: auto;
}
.okf-debt__table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-xs);
}
.okf-debt__table th {
  text-align: left;
  padding: var(--space-xs) var(--space-sm);
  color: var(--muted);
  font-weight: 600;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}
.okf-debt__row {
  cursor: pointer;
  border-bottom: 1px solid var(--border-light);
}
.okf-debt__row:hover {
  background: var(--accent-muted);
}
.okf-debt__row--clean .okf-debt__name {
  color: var(--muted);
}
.okf-debt__row td {
  padding: var(--space-xs) var(--space-sm);
  white-space: nowrap;
}
.okf-debt__name {
  font-weight: 600;
}
.okf-debt__domain {
  margin-left: var(--space-xs);
  color: var(--muted);
  font-weight: 400;
}
.okf-debt__bad {
  color: var(--danger);
  font-weight: 700;
}
.okf-debt__warn {
  color: var(--warning);
  font-weight: 700;
}
.okf-debt__issues-btn {
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  color: inherit;
  cursor: pointer;
  text-decoration: underline dotted;
  text-underline-offset: 2px;
}
.okf-debt__issue-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}
.okf-debt__issue-item {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  padding: var(--space-xs) var(--space-sm);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
}
.okf-debt__issue-head {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  flex-wrap: wrap;
}
.okf-debt__issue-concept {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
}
.okf-debt__issue-code {
  color: var(--muted);
}
.okf-debt__issue-message {
  color: var(--fg);
}
.okf-debt__issue-remedy {
  color: var(--muted);
}
</style>
