<!--
  OkfStepValidate.vue — Step 7 (Validation), rebuilt per #1030 (David,
  2026-09-30: "the issues need to be listed and the process to remedy them
  articulated") + #1036 (orphan / near-duplicate / citation checks).

  The core is THE ISSUE LIST from the server's unified validation report —
  every row shows concept, severity, what is wrong, HOW TO FIX it, and (where
  the fix is one click) the action itself:
    conformance    → remedy text (Autocorrect in Step 8, or edit in editor)
    orphan         → "Suggest links" → accept/reject per LLM proposal
    near_duplicate → member list with per-member Delete (keep one)
    citation       → one click creates/wires the Sources page (#1036 Option 2)
  Plus the embedded PII remediation panel (decision #3) and INDEX_FAILED rows.
-->

<template>
  <div class="okf-step-validate">
    <!-- WIZARD IDEMPOTENCY R-C: a published/ingested repo is read-only —
      say so instead of offering fixes that would 409. -->
    <p v-if="frozenAt" class="okf-step-validate__frozen">
      {{
        translate(
          'okf.validation.frozen',
          'Content frozen at {v} — read-only preview. Retract the serving version to make changes.'
        ).replace('{v}', frozenAt)
      }}
    </p>
    <div class="okf-step-validate__health">
      <DsHealthRing :score="healthScore" :size="'lg'" :show-label="true" :aria-label="healthAria" />
      <p class="okf-step-validate__headline">{{ headline }}</p>
      <p class="okf-step-validate__count">{{ summaryLine }}</p>
    </div>

    <p v-if="loadError" class="okf-step-validate__error">
      {{ translate('okf.validation.loadFailed', 'Could not load the validation report.') }}
      <DsButton variant="secondary" small @click="refresh">
        {{ translate('okf.validation.retry', 'Retry') }}
      </DsButton>
    </p>
    <p v-else-if="loading" class="okf-step-validate__loading">
      {{ translate('okf.validation.loading', 'Checking the repository…') }}
    </p>

    <!-- THE ISSUE LIST (#1030): every issue, its severity, and its remedy. -->
    <div v-else class="okf-step-validate__issues">
      <p class="okf-step-validate__issues-title">
        {{ translate('okf.validation.issuesTitle', 'Issues to review') }}
        <span class="okf-step-validate__issues-count">{{ validationIssues.length }}</span>
      </p>
      <p v-if="validationIssues.length === 0" class="okf-step-validate__all-clear">
        {{ translate('okf.validation.headline.ok', 'Looks good. Nothing to fix.') }}
      </p>
      <ul class="okf-step-validate__issue-list">
        <li v-for="(issue, idx) in validationIssues" :key="idx" class="okf-step-validate__issue">
          <div class="okf-step-validate__issue-head">
            <DsStatusTag :variant="issue.severity === 'blocker' ? 'danger' : 'pending'" small>
              {{ translate('okf.validation.severity.' + issue.severity, issue.severity) }}
            </DsStatusTag>
            <span class="okf-step-validate__issue-type">
              {{ translate('okf.validation.type.' + issue.type, issue.type) }}
            </span>
            <span class="okf-step-validate__issue-title">{{ issue.title }}</span>
          </div>
          <p class="okf-step-validate__issue-message">{{ issue.message }}</p>
          <p class="okf-step-validate__issue-remedy">
            <strong>{{ translate('okf.validation.howToFix', 'How to fix') }}:</strong>
            {{ issue.remedy }}
          </p>

          <!-- ORPHAN remedy: accept/reject LLM link suggestions. -->
          <div v-if="issue.type === 'orphan' && !frozenAt" class="okf-step-validate__issue-actions">
            <DsButton variant="secondary" small :disabled="suggestBusy" @click="onSuggestLinks(issue.concept_id)">
              {{
                suggestFor === issue.concept_id && suggestBusy
                  ? translate('okf.validation.suggest.working', 'Asking the assistant for link suggestions…')
                  : translate('okf.validation.action.suggestLinks', 'Suggest links')
              }}
            </DsButton>
            <div v-if="suggestFor === issue.concept_id && suggestion" class="okf-step-validate__suggestions">
              <p v-if="!suggestion.proposals || suggestion.proposals.length === 0" class="okf-step-validate__sug-empty">
                {{
                  suggestion.error ||
                  translate('okf.validation.suggest.empty', 'No suggestions — link it manually in the editor.')
                }}
              </p>
              <ul v-else class="okf-step-validate__sug-list">
                <li v-for="p in suggestion.proposals" :key="p.to_concept_id" class="okf-step-validate__sug-row">
                  <span class="okf-step-validate__sug-target">
                    {{ p.label }} <span class="okf-step-validate__sug-id">→ {{ p.to_concept_id }}</span>
                  </span>
                  <DsButton v-if="p.accepted" variant="ghost" small disabled>
                    {{ translate('okf.validation.actionDone.done', 'Done') }}
                  </DsButton>
                  <template v-else>
                    <DsButton variant="primary" small :disabled="acceptBusy" @click="onAcceptLink(issue.concept_id, p)">
                      {{ translate('okf.validation.action.accept', 'Accept') }}
                    </DsButton>
                    <DsButton variant="ghost" small @click="p.dismissed = true">
                      {{ translate('okf.validation.action.dismiss', 'Dismiss') }}
                    </DsButton>
                  </template>
                </li>
              </ul>
            </div>
          </div>

          <!-- NEAR-DUPLICATE remedy: keep one, delete the rest. -->
          <div v-if="issue.type === 'near_duplicate' && !frozenAt" class="okf-step-validate__issue-actions">
            <p class="okf-step-validate__dup-hint">
              {{ translate('okf.validation.nearDup.keepHint', 'Keep one copy — delete the rest.') }}
            </p>
            <ul class="okf-step-validate__dup-list">
              <li v-for="m in issue.members" :key="m" class="okf-step-validate__dup-row">
                <span>{{ conceptTitle(m) }}</span>
                <DsButton variant="ghost" small :disabled="deleting === m" @click="onDeleteConcept(m)">
                  {{ translate('okf.validation.action.delete', 'Delete') }}
                </DsButton>
              </li>
            </ul>
          </div>

          <!-- CITATION remedy: one click creates/wires the Sources page. -->
          <div v-if="issue.type === 'citation' && !frozenAt" class="okf-step-validate__issue-actions">
            <p v-if="wireNote" class="okf-step-validate__wire-note">{{ wireNote }}</p>
            <DsButton variant="primary" small :disabled="wireBusy" @click="onWireCitations(issue)">
              {{
                wireBusy
                  ? translate('okf.validation.action.working', 'Working…')
                  : issue.hub_concept_id
                    ? translate('okf.validation.action.wireExisting', 'Link {n} page(s) to "{hub}"')
                        .replace('{n}', String(issue.citing_count || 0))
                        .replace('{hub}', issue.hub_concept_id)
                    : translate(
                        'okf.validation.action.wireCreate',
                        'Create the Sources page and link {n} page(s)'
                      ).replace('{n}', String(issue.citing_count || 0))
              }}
            </DsButton>
          </div>
        </li>
      </ul>
    </div>

    <!-- PII REMEDIATION (Amendment A decision #3, David 2026-09-27): the
      FULL panel is embedded — pick a flagged concept, redact/replace/remove/
      accept each entity right here (the same OkfPiiOccurrences the editor
      uses). No hop to Curate for personal-data fixes. -->
    <div v-if="piiConcepts.length" class="okf-step-validate__pii">
      <p class="okf-step-validate__pii-title">
        {{ translate('okf.validation.piiTitle', 'Personal data — review each flagged concept') }}
        <DsInfoTip
          :text="
            translate(
              'okf.glossary.piiReview',
              'The scanner found possible personal data. For each finding you choose: Redact (replace with a notice), Replace (write your own text), Remove (delete it), or Accept (keep it — the decision is audited). The repository cannot be handed off with unreviewed findings.'
            )
          "
        />
      </p>
      <div class="okf-step-validate__pii-cols">
        <ul class="okf-step-validate__pii-list">
          <li v-for="c in piiConcepts" :key="c.concept_id">
            <button
              type="button"
              class="okf-step-validate__pii-row"
              :class="{ 'okf-step-validate__pii-row--active': selectedPiiConcept === c.concept_id }"
              @click="selectedPiiConcept = c.concept_id"
            >
              {{ c.title || c.concept_id }}
            </button>
          </li>
        </ul>
        <div v-if="selectedPiiConcept" class="okf-step-validate__pii-panel">
          <OkfPiiOccurrences
            :key="selectedPiiConcept"
            :repo-id="repoId"
            :concept-id="selectedPiiConcept"
            :revision="piiRevision"
            :read-only="!!frozenAt"
            @applied="onPiiApplied"
          />
        </div>
      </div>
    </div>

    <p v-if="!expert" class="okf-step-validate__expert-hint">
      {{
        translate(
          'okf.validation.expertHint',
          'Switch to Expert mode to see raw validation JSON, filter by severity, and override checks.'
        )
      }}
    </p>
  </div>
</template>

<script>
import { mapGetters } from 'vuex';
import DsHealthRing from '../../ds/HealthRing.vue';
import DsInfoTip from '../../ds/InfoTip.vue';
import DsButton from '../../ds/Button.vue';
import DsStatusTag from '../../ds/StatusTag.vue';
import OkfPiiOccurrences from '../editor/PiiOccurrences.vue';
import translateMixin from '../../../mixins/translateMixin';

export default {
  name: 'OkfStepValidate',
  components: { DsHealthRing, DsInfoTip, DsButton, DsStatusTag, OkfPiiOccurrences },
  mixins: [translateMixin],
  props: { draft: { type: Object, default: null }, expert: { type: Boolean, default: false } },
  emits: ['gate'],
  data() {
    return {
      report: null,
      indexFailed: [],
      frozenAt: null,
      piiConcepts: [],
      selectedPiiConcept: '',
      piiRevision: 0,
      loading: false,
      loadError: null,
      // action states
      wireBusy: false,
      wireNote: '',
      suggestFor: null,
      suggestBusy: false,
      suggestion: null,
      acceptBusy: false,
      deleting: null
    };
  },
  computed: {
    ...mapGetters('okf', ['isExpert']),
    expertMode() {
      return this.expert;
    },
    repoId() {
      return (this.draft && this.draft.repo_id) || '';
    },
    // THE ISSUE LIST: the server report's issues + INDEX_FAILED rows from the
    // concept list (index failures are per-page operational state, not part
    // of the server report's conformance families).
    validationIssues() {
      const issues = (this.report && Array.isArray(this.report.issues) ? this.report.issues : []).slice();
      for (const cid of this.indexFailed) {
        issues.push({
          type: 'index_failed',
          severity: 'warning',
          concept_id: cid,
          title: this.conceptTitle(cid),
          message: this.translate('okf.validation.indexFailed', 'Re-index failed — edit or re-split the page.'),
          remedy: this.translate(
            'okf.validation.indexFailedRemedy',
            'Open the page in the editor and save it (a save re-indexes), or re-split the repository from its source.'
          )
        });
      }
      const rank = { blocker: 0, warning: 1, info: 2 };
      return issues.sort((a, b) => (rank[a.severity] ?? 1) - (rank[b.severity] ?? 1));
    },
    healthScore() {
      // Prefer server metrics when the fetch succeeded; else derive from issues.
      const m = this._metrics;
      if (m && typeof m.concept_count === 'number' && m.concept_count > 0) {
        const issues = (m.conformance_issue_count || 0) + (m.stale_concept_count || 0);
        return Math.max(0, Math.min(100, Math.round(100 * (1 - issues / Math.max(m.concept_count, 1)))));
      }
      const total = this.validationIssues.length;
      const concepts = (this.draft && this.draft.concept_count) || 1;
      return Math.max(0, Math.min(100, Math.round(100 * (1 - total / Math.max(concepts, 5)))));
    },
    healthAria() {
      return `Health: ${this.healthScore} percent, ${this.validationIssues.length} issue(s)`;
    },
    headline() {
      const blockers = this.validationIssues.filter((i) => i.severity === 'blocker').length;
      const warnings = this.validationIssues.length - blockers;
      if (blockers > 0)
        return this.translate(
          'okf.validation.headline.blockers',
          `${blockers} blocking issue(s) — fix before you hand the repository off`
        );
      if (warnings > 0)
        return this.translate('okf.validation.headline.warnings', `${warnings} thing(s) need your review`);
      return this.translate('okf.validation.headline.ok', 'Looks good. Nothing to fix.');
    },
    summaryLine() {
      const concepts = (this.draft && this.draft.concept_count) || 0;
      const blockers = this.validationIssues.filter((i) => i.severity === 'blocker').length;
      const warnings = this.validationIssues.length - blockers;
      const clean = Math.max(0, concepts - blockers - warnings);
      return this.translate('okf.validation.summary', '{clean} clean · {warnings} needs review · {blockers} blocking')
        .replace('{clean}', clean)
        .replace('{warnings}', warnings)
        .replace('{blockers}', blockers);
    }
  },
  mounted() {
    this.refresh();
  },
  methods: {
    conceptTitle(cid) {
      const row = (this._conceptRows || []).find((r) => r.concept_id === cid);
      return (row && (row.title || row.concept_id)) || cid;
    },
    async refresh() {
      this.loading = true;
      this.loadError = null;
      this._metrics = null;
      const repoId = this.draft && this.draft.repo_id;
      if (!repoId) {
        this.loading = false;
        return;
      }
      // WIZARD IDEMPOTENCY R-C (David, 2026-09-04): a published/ingested repo
      // is CONTENT-FROZEN — render a read-only preview from live data.
      const repo = this.$store.getters['okf/repoById'](repoId);
      const frozen = !!repo && (!!repo.ingested_at || repo.lifecycle_state === 'publish');
      this.frozenAt = frozen ? 'v' + (repo.version || 0) : null;
      const [val, concepts, metrics] = await Promise.allSettled([
        this.$store.dispatch('okf/fetchValidation', repoId),
        this.$store.dispatch('okf/fetchConcepts', repoId),
        this.$store.dispatch('okf/fetchRepoMetrics', repoId)
      ]);
      // 1. The unified report (#1030) — null on failure → the retry box.
      const valVal = val.status === 'fulfilled' ? val.value : null;
      if (valVal && valVal.ok) {
        this.report = valVal.report;
        this.loadError = null;
      } else {
        this.report = null;
        this.loadError = (valVal && valVal.error) || 'unavailable';
      }
      // 2. Concept list: INDEX_FAILED rows + the PII panel + title lookups.
      const cVal = concepts.status === 'fulfilled' ? concepts.value : null;
      const rows = (cVal && cVal.concepts) || [];
      this._conceptRows = rows;
      this.indexFailed = rows.filter((row) => row.index_status === 'failed').map((r) => r.concept_id);
      this.piiConcepts = rows.filter((row) => row.pii_state === 'flagged');
      if (this.piiConcepts.length) {
        if (!this.selectedPiiConcept || !this.piiConcepts.some((c) => c.concept_id === this.selectedPiiConcept)) {
          this.selectedPiiConcept = this.piiConcepts[0].concept_id;
        }
      } else {
        this.selectedPiiConcept = '';
      }
      // 3. Metrics envelope (A10): unwrap tolerantly.
      const mRaw = metrics.status === 'fulfilled' ? metrics.value : null;
      this._metrics = (mRaw && mRaw.metrics) || mRaw || null;
      this.loading = false;
      this.$emit('gate', true); // validation never blocks the hand-off (D4)
    },
    // ORPHAN remedy: fetch (and show) the LLM's link proposals for one page.
    async onSuggestLinks(conceptId) {
      if (this.suggestBusy) return;
      if (this.suggestFor === conceptId) {
        this.suggestFor = null; // toggle closed
        this.suggestion = null;
        return;
      }
      this.suggestFor = conceptId;
      this.suggestion = null;
      this.suggestBusy = true;
      const res = await this.$store.dispatch('okf/suggestLinks', { repoId: this.repoId, conceptId });
      this.suggestBusy = false;
      this.suggestion = (res && res.ok ? res.result : null) || {
        proposals: [],
        error: (res && res.error) || 'unavailable'
      };
    },
    async onAcceptLink(conceptId, proposal) {
      if (this.acceptBusy) return;
      this.acceptBusy = true;
      const res = await this.$store.dispatch('okf/acceptLink', {
        repoId: this.repoId,
        conceptId,
        toConceptId: proposal.to_concept_id,
        label: proposal.label
      });
      this.acceptBusy = false;
      if (res && res.ok) {
        proposal.accepted = true;
        this.refresh(); // the orphan issue clears once the page is linked
      }
    },
    // NEAR-DUPLICATE remedy: delete one member (the steward keeps the rest).
    async onDeleteConcept(conceptId) {
      if (this.deleting) return;
      this.deleting = conceptId;
      try {
        await this.$store.dispatch('okf/deleteConcept', { repoId: this.repoId, conceptId });
      } finally {
        this.deleting = null;
        this.refresh();
      }
    },
    // CITATION remedy (#1036 Option 2): one click creates (when missing) and
    // wires the Sources page.
    async onWireCitations(issue) {
      if (this.wireBusy) return;
      this.wireBusy = true;
      this.wireNote = '';
      const res = await this.$store.dispatch('okf/wireCitations', {
        repoId: this.repoId,
        hubConceptId: issue.hub_concept_id || undefined
      });
      this.wireBusy = false;
      if (res && res.ok && res.result) {
        const r = res.result;
        this.wireNote = this.translate('okf.validation.wireDone', 'Linked {n} page(s) to "{hub}".')
          .replace('{n}', String(r.wired != null ? r.wired : 0))
          .replace('{hub}', r.hub_concept_id || 'sources');
        if (r.hub_created) {
          this.wireNote =
            this.translate('okf.validation.wireCreated', 'Created the Sources page and linked {n} page(s).').replace(
              '{n}',
              String(r.wired != null ? r.wired : 0)
            ) + ' ';
        }
      } else {
        this.wireNote = (res && res.error) || '';
      }
      this.refresh();
    },
    onPiiApplied() {
      // An action already re-scanned server-side — bump the panel revision
      // and refresh; a resolved concept leaves the flagged list.
      this.piiRevision += 1;
      this.refresh();
    }
  }
};
</script>

<style scoped>
.okf-step-validate {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}
.okf-step-validate__frozen {
  margin: 0;
  padding: var(--space-sm) var(--space-md);
  background: var(--warning-bg);
  border: 1px solid var(--warning);
  border-radius: var(--radius-sm);
  color: var(--fg);
  font-size: var(--text-sm);
}
.okf-step-validate__health {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-md);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}
.okf-step-validate__headline {
  margin: 0;
  font-size: var(--text-md);
  font-weight: 600;
}
.okf-step-validate__count {
  margin: 0;
  color: var(--muted);
  font-size: var(--text-sm);
}
.okf-step-validate__error,
.okf-step-validate__loading {
  margin: 0;
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
}
.okf-step-validate__error {
  background: var(--danger-bg, var(--bg));
  border: 1px solid var(--danger);
  color: var(--danger);
  display: flex;
  gap: var(--space-sm);
  align-items: center;
}
.okf-step-validate__issues-title {
  margin: 0;
  font-size: var(--text-sm);
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}
.okf-step-validate__issues-count {
  background: var(--accent-muted);
  color: var(--accent);
  padding: 2px 10px;
  border-radius: 100px;
  font-size: var(--text-xs);
}
.okf-step-validate__all-clear {
  margin: 0;
  color: var(--muted);
  font-size: var(--text-sm);
}
.okf-step-validate__issue-list {
  list-style: none;
  margin: var(--space-xs) 0 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}
.okf-step-validate__issue {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: var(--space-sm) var(--space-md);
}
.okf-step-validate__issue-head {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  flex-wrap: wrap;
}
.okf-step-validate__issue-type {
  color: var(--muted);
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.okf-step-validate__issue-title {
  font-weight: 600;
  font-size: var(--text-sm);
}
.okf-step-validate__issue-message {
  margin: var(--space-xs) 0 0 0;
  font-size: var(--text-sm);
}
.okf-step-validate__issue-remedy {
  margin: var(--space-xs) 0 0 0;
  font-size: var(--text-sm);
  color: var(--fg);
  background: var(--bg);
  border-left: 3px solid var(--accent);
  padding: var(--space-xs) var(--space-sm);
}
.okf-step-validate__issue-actions {
  margin-top: var(--space-sm);
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  align-items: flex-start;
}
.okf-step-validate__suggestions,
.okf-step-validate__dup-list {
  width: 100%;
}
.okf-step-validate__sug-empty {
  margin: 0;
  color: var(--muted);
  font-size: var(--text-sm);
}
.okf-step-validate__sug-list,
.okf-step-validate__dup-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}
.okf-step-validate__sug-row,
.okf-step-validate__dup-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  font-size: var(--text-sm);
  padding: var(--space-xs) var(--space-sm);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}
.okf-step-validate__sug-id {
  color: var(--muted);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
}
.okf-step-validate__dup-hint,
.okf-step-validate__wire-note {
  margin: 0;
  color: var(--muted);
  font-size: var(--text-sm);
}
.okf-step-validate__wire-note {
  color: var(--success, var(--accent));
}
.okf-step-validate__pii {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}
.okf-step-validate__pii-title {
  margin: 0;
  font-size: var(--text-sm);
  font-weight: 600;
}
.okf-step-validate__pii-cols {
  display: grid;
  grid-template-columns: 220px 1fr;
  gap: var(--space-md);
  align-items: start;
}
.okf-step-validate__pii-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}
.okf-step-validate__pii-row {
  display: block;
  width: 100%;
  text-align: left;
  padding: var(--space-xs) var(--space-sm);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  cursor: pointer;
  font: inherit;
  color: var(--fg);
  font-size: var(--text-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.okf-step-validate__pii-row:hover {
  border-color: var(--accent);
  background: var(--accent-muted);
}
.okf-step-validate__pii-row--active {
  border-color: var(--accent);
  background: var(--accent-muted);
}
.okf-step-validate__pii-panel {
  min-width: 0;
}
.okf-step-validate__expert-hint {
  margin: 0;
  padding: var(--space-sm) var(--space-md);
  background: var(--bg);
  border: 1px dashed var(--border);
  border-radius: var(--radius-sm);
  color: var(--muted);
  font-size: var(--text-sm);
}
</style>
