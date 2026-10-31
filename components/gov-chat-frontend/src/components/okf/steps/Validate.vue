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
        <DsInfoTip
          :text="
            translate(
              'okf.validation.tip.list',
              'This is everything that would weaken answers once the repository serves: frontmatter that misses the spec, pages no other page links to (graph retrieval cannot relate them), near-identical pages (search returns the same material repeatedly), citations that are not linked (they never reach the graph), and pages whose index build failed. Each row says what is wrong and how to fix it.'
            )
          "
        />
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
              <DsInfoTip :text="typeTip(issue.type)" />
            </span>
            <span class="okf-step-validate__issue-title">{{ issue.title }}</span>
          </div>
          <p class="okf-step-validate__issue-message">{{ issue.message }}</p>
          <!-- Merged conformance rows (#1039 density): identical findings
            across many pages collapse into one row of concept chips (shown
            only when merged — single rows name the page in the title). Near-dup
            groups show their member ids the same way. -->
          <div v-if="issue.concepts && issue.concepts.length > 1" class="okf-step-validate__issue-concepts">
            <code v-for="c in issue.concepts" :key="c" class="okf-step-validate__concept-chip">{{ c }}</code>
          </div>
          <p class="okf-step-validate__issue-remedy">
            <strong>{{ translate('okf.validation.howToFix', 'How to fix') }}:</strong>
            {{ issue.remedy }}
          </p>

          <!-- ORPHAN remedy: the ENTRY POINT only. The proposal list itself
            renders at panel level (below the issue list) — see the lifetime
            note there. It used to be nested in here, which meant accepting
            the first proposal cured the orphan, unmounted this row, and took
            every remaining proposal with it. !1075 / Story 10.8. -->
          <div v-if="issue.type === 'orphan' && !frozenAt" class="okf-step-validate__issue-actions">
            <DsButton variant="secondary" small :disabled="suggestBusy" @click="onSuggestLinks(issue.concept_id)">
              {{
                suggestFor === issue.concept_id && suggestBusy
                  ? translate('okf.validation.suggest.working', 'Asking the assistant for link suggestions…')
                  : translate('okf.validation.action.suggestLinks', 'Suggest links')
              }}
            </DsButton>
          </div>

          <!-- NEAR-DUPLICATE remedy: keep one, delete the rest — with the
            content VISIBLE before any deletion (#1039). -->
          <div v-if="issue.type === 'near_duplicate' && !frozenAt" class="okf-step-validate__issue-actions">
            <div class="okf-step-validate__dup-toolbar">
              <p class="okf-step-validate__dup-hint">
                {{ translate('okf.validation.nearDup.keepHint', 'Keep one copy — delete the rest.') }}
              </p>
              <DsButton variant="secondary" small :disabled="!!previewBusy" @click="onTogglePreview(issue)">
                {{
                  previewFor === dupKey(issue)
                    ? translate('okf.validation.action.hidePreview', 'Hide preview')
                    : translate('okf.validation.action.preview', 'Preview duplicates')
                }}
              </DsButton>
            </div>
            <p v-if="previewFor === dupKey(issue) && previewBusy" class="okf-step-validate__dup-hint">
              {{ translate('okf.validation.preview.loading', 'Loading page contents…') }}
            </p>
            <div v-else-if="previewFor === dupKey(issue) && previewMembers" class="okf-step-validate__preview-grid">
              <div v-for="m in previewMembers" :key="m.concept_id" class="okf-step-validate__preview-pane">
                <header>
                  <code>{{ m.concept_id }}</code>
                  <span>{{ m.title }}</span>
                </header>
                <pre>{{ m.text }}</pre>
                <footer>
                  {{
                    translate(
                      'okf.validation.preview.truncated',
                      'First {n} characters — open the editor for the full page.'
                    ).replace('{n}', String(previewChars))
                  }}
                </footer>
              </div>
            </div>
            <ul class="okf-step-validate__dup-list">
              <li v-for="m in issue.members" :key="m" class="okf-step-validate__dup-row">
                <span>{{ conceptTitle(m) }}</span>
                <DsButton variant="ghost" small :disabled="deleting === m" @click="onDeleteConcept(m)">
                  {{ translate('okf.validation.action.delete', 'Delete') }}
                </DsButton>
              </li>
            </ul>
          </div>

          <!-- CITATION remedy: one click creates/wires the Sources page. The
            RESULT note renders at panel level for the same lifetime reason as
            the suggestion list: wiring clears the citation issue, so a note
            nested in here would vanish the moment it had something to say. -->
          <div v-if="issue.type === 'citation' && !frozenAt" class="okf-step-validate__issue-actions">
            <DsButton variant="primary" small :disabled="wireBusy" @click="onWireCitations(issue)">
              {{
                wireBusy && wireFor === wireKey(issue)
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

      <!-- REMEDY PANELS AT PANEL LEVEL (!1075 / Story 10.8).
           These live OUTSIDE the issue v-for on purpose. Every remedy here
           cures the issue it belongs to, and each one calls refresh() — so a
           panel nested inside its issue row is destroyed by its own success,
           one interaction before the curator can see the result. The accepted
           proposal's "Done" state (written at :106 in the old nesting) could
           never be seen for exactly that reason. Their lifetime must depend on
           the panel's own key (suggestFor / wireFor), never on the row's
           existence. -->

      <div v-if="suggestFor && suggestion" class="okf-step-validate__suggestions">
        <!-- Title reuses the existing action key (no new i18n key: the 14 locale
             files must stay deep-key-identical). The page is identified by its
             concept id, which is an identifier rather than prose, so it is
             rendered as a code chip and not translated. -->
        <p class="okf-step-validate__suggestions-title">
          {{ translate('okf.validation.action.suggestLinks', 'Suggest links') }}
          <code class="okf-step-validate__concept-chip">{{ suggestFor }}</code>
        </p>
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
              <DsButton variant="primary" small :disabled="acceptBusy" @click="onAcceptLink(p)">
                {{ translate('okf.validation.action.accept', 'Accept') }}
              </DsButton>
              <DsButton variant="ghost" small @click="p.dismissed = true">
                {{ translate('okf.validation.action.dismiss', 'Dismiss') }}
              </DsButton>
            </template>
          </li>
        </ul>
      </div>

      <p v-if="wireNote" class="okf-step-validate__wire-note">{{ wireNote }}</p>
    </div>

    <!-- WHOLE-CORPUS TOPIC LINKS (Story 1-8g-p): the SAME generic pass the
      wizard runs at import time, re-runnable here on any repository. Graph
      retrieval walks LINKS, so a corpus whose pages never cite each other
      returns isolated hits; this authors the missing edges over the WHOLE
      corpus (no domain assumptions — it works for any subject matter). The
      run is detached server-side (minutes, not seconds), so the button arms it
      and the panel polls until the run reaches a terminal state. -->
    <div v-if="!frozenAt" class="okf-step-validate__topic-links">
      <p class="okf-step-validate__topic-links-title">
        {{ translate('okf.validation.topicLinks.title', 'Cross-link topics') }}
        <DsInfoTip
          :text="
            translate(
              'okf.validation.topicLinks.tip',
              'Reads every page in this repository and writes links between the pages that genuinely belong together — the same processing the import wizard runs. It is safe to re-run: existing links are kept and only new ones are added.'
            )
          "
        />
      </p>
      <p v-if="topicLinksNote" class="okf-step-validate__topic-links-note">{{ topicLinksNote }}</p>
      <DsButton variant="secondary" small :disabled="topicLinksBusy" @click="onStartTopicLinks">
        {{
          topicLinksBusy
            ? translate('okf.validation.action.working', 'Working…')
            : translate('okf.validation.action.topicLinks', 'Cross-link topics')
        }}
      </DsButton>
    </div>

    <!-- PII REMEDIATION (Amendment A decision #3, David 2026-09-27): the
      FULL panel is embedded — pick a flagged concept, redact/replace/remove/
      accept each entity right here (the same OkfPiiOccurrences the editor
      uses). No hop to Curate for personal-data fixes.

      REPO-WIDE RE-SCAN (2026-10-12): a concept whose scan ERRORED cannot be
      cleared by any per-occurrence action — 'Accept all' subtracts
      occurrences and an errored concept has none (and an 'error' is
      deliberately NOT waivable by acknowledgement). The only cure is a real
      scan, so the panel offers one over the whole repository and reports the
      per-concept tally it got back, errors included. -->
    <div v-if="piiConcepts.length || piiRescanError" class="okf-step-validate__pii">
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
      <div class="okf-step-validate__pii-rescan">
        <DsButton v-if="!frozenAt" variant="secondary" small :disabled="piiRescanBusy" @click="onRescanAllPii">
          <DsSpinner v-if="piiRescanBusy" size="sm" />
          {{
            piiRescanBusy
              ? translate('okf.validation.piiRescanWorking', 'Re-scanning every page…')
              : translate('okf.validation.piiRescan', 'Re-scan all pages')
          }}
        </DsButton>
        <p v-if="piiRescanNote" class="okf-step-validate__pii-rescan-note">{{ piiRescanNote }}</p>
        <p v-if="piiRescanError" class="okf-step-validate__pii-rescan-error">{{ piiRescanError }}</p>
        <!-- THE TALLY: the per-concept counts the server actually wrote.
             Error rows are listed individually — they are the concepts the
             publish gate is still refusing, and a bare "1 scan error" does
             not tell the curator which page to open. -->
        <ul v-if="piiRescanTally" class="okf-step-validate__pii-tally">
          <li class="okf-step-validate__pii-tally-row">
            <DsStatusTag :variant="piiRescanTally.error ? 'error' : 'success'" small>
              {{
                translate('okf.validation.piiTally.scanned', '{n} page(s) re-scanned').replace(
                  '{n}',
                  String(piiRescanTally.scanned)
                )
              }}
            </DsStatusTag>
            <span class="okf-step-validate__pii-tally-parts">
              <span class="okf-step-validate__pii-tally-part"
                >{{ piiRescanTally.clean }} {{ translate('okf.validation.piiTally.clean', 'clear') }}</span
              >
              <span class="okf-step-validate__pii-tally-part"
                >{{ piiRescanTally.hit }} {{ translate('okf.validation.piiTally.hit', 'flagged') }}</span
              >
              <span
                class="okf-step-validate__pii-tally-part"
                :class="{ 'okf-step-validate__pii-tally-part--error': piiRescanTally.error }"
              >
                {{ piiRescanTally.error }} {{ translate('okf.validation.piiTally.error', 'scan error') }}
              </span>
              <span
                v-if="piiRescanTally.missing"
                class="okf-step-validate__pii-tally-part"
                :class="{ 'okf-step-validate__pii-tally-part--error': piiRescanTally.missing }"
              >
                {{ piiRescanTally.missing }} {{ translate('okf.validation.piiTally.missing', 'vanished') }}
              </span>
            </span>
          </li>
          <li v-for="r in piiRescanErrors" :key="r.concept_id" class="okf-step-validate__pii-tally-row">
            <DsStatusTag variant="error" small>{{
              translate('okf.validation.piiTally.stillBlocking', 'Still blocking')
            }}</DsStatusTag>
            <code class="okf-step-validate__pii-tally-id">{{ r.concept_id }}</code>
            <span v-if="r.reason" class="okf-step-validate__pii-tally-detail">{{ r.reason }}</span>
          </li>
        </ul>
      </div>
      <div v-if="piiConcepts.length" class="okf-step-validate__pii-cols">
        <ul class="okf-step-validate__pii-list">
          <li v-for="c in piiConcepts" :key="c.concept_id">
            <button
              type="button"
              class="okf-step-validate__pii-row"
              :class="{ 'okf-step-validate__pii-row--active': selectedPiiConcept === c.concept_id }"
              @click="selectedPiiConcept = c.concept_id"
            >
              <!-- A concept whose scan ERRORED is a different kind of problem
                   from one that FOUND something, and the curator must be able
                   to tell them apart in the list itself. -->
              <DsStatusTag v-if="c.pii_state === 'error'" variant="error" small>
                {{ translate('okf.validation.piiStateError', 'Scan error') }}
              </DsStatusTag>
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
            @rescanned="onPiiRescanned"
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
import DsSpinner from '../../ds/Spinner.vue';
import OkfPiiOccurrences from '../editor/PiiOccurrences.vue';
import translateMixin from '../../../mixins/translateMixin';

// #1039 near-duplicate preview: how much of each member's body to render.
const PREVIEW_CHARS = 1500;

// The repo-wide concept rescan is DETACHED server-side (one Presidio
// round-trip per concept), so the panel polls. Same cadence as the topic-link
// run: fast enough that the bar moves, slow enough not to hammer the API.
const PII_RESCAN_POLL_MS = 3000;
// CEILING (round 19, #80774): a run wedged at status 'running' (worker
// crash without reaping) re-arms the 3s timer forever otherwise — the same
// dead-end class the store's pollJob ceilings exist to remove. Same 15-min
// horizon as the editor's rescan control and pollJob's PII actions.
const PII_RESCAN_MAX_MS = 15 * 60 * 1000;

// Per-type explanation tips (#1039): what the check looks at and why it
// matters for RAG accuracy — one sentence a steward can act on.
const TYPE_TIPS = {
  conformance:
    'The page frontmatter misses the OKF spec (type, freshness date, sources…). Autocorrect in Step 8 fixes these mechanically; nothing in your written content changes.',
  orphan:
    'No page links here and this page links nowhere. Graph retrieval walks LINKS to relate content, so an unlinked page only surfaces on an exact topic match. Fix: accept link suggestions or add links in the editor.',
  near_duplicate:
    'These pages carry near-identical text. At ingest each becomes its own chunks, so a question can return the same material several times. Fix: preview, keep the best copy, delete the rest.',
  citation:
    'Pages cite documents in their metadata but nothing links them to the Sources page — so citations never reach the graph and cannot be walked or cited at answer time. Fix: one click wires every citing page.',
  index_failed:
    'The page was imported but its search-index build failed — it cannot be retrieved until it re-indexes. Saving the page in the editor retries the build.'
};

export default {
  name: 'OkfStepValidate',
  components: { DsHealthRing, DsInfoTip, DsButton, DsStatusTag, DsSpinner, OkfPiiOccurrences },
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
      // REPO-WIDE PII RE-SCAN (2026-10-12): the action that clears a concept
      // whose scan errored. Per-occurrence actions cannot reach that state
      // (an 'error' has no occurrences to subtract and is not waivable by
      // acknowledgement), so without this the block is permanent.
      piiRescanBusy: false,
      piiRescanNote: '',
      piiRescanError: '',
      piiRescanTally: null,
      piiRescanKey: null,
      // STALE-ANSWER GUARD: a tally describes THIS repo at THIS moment. If a
      // refresh (or a concept re-scan) supersedes it, rendering the older
      // numbers would misreport the gate. Same idiom as TestingLabDialog's
      // suiteEpoch / queryEpoch.
      piiRescanEpoch: 0,
      loading: false,
      loadError: null,
      // action states
      wireBusy: false,
      wireNote: '',
      // Which citation issue the busy flag and the note belong to (!1075). The
      // note used to live inside every citation row, so wiring one issue
      // printed its result on ALL of them — and wiring clears the issue, so the
      // row carrying the message unmounted immediately after.
      wireFor: null,
      suggestFor: null,
      suggestBusy: false,
      suggestion: null,
      acceptBusy: false,
      deleting: null,
      // whole-corpus topic-link run (Story 1-8g-p) — detached server-side, so
      // the panel polls until the run reports a terminal state.
      topicLinksBusy: false,
      topicLinksNote: '',
      // near-duplicate preview (#1039)
      previewFor: null,
      previewBusy: null,
      previewMembers: null,
      previewChars: PREVIEW_CHARS
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
    // of the server report's conformance families). #1039: conformance rows
    // that share code+message merge into ONE row carrying concepts[] — the
    // NCD bundle surfaced the same MISSING_STALE_AFTER 40× as 40 identical
    // rows; the merged row says "40 pages" once.
    validationIssues() {
      const raw = (this.report && Array.isArray(this.report.issues) ? this.report.issues : []).slice();
      for (const cid of this.indexFailed) {
        raw.push({
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
      // Merge same-code+message rows (conformance shares the remedy anyway).
      const issues = [];
      const byKey = new Map();
      const mergedTitle = (n) => this.translate('okf.validation.mergedPages', '{n} pages').replace('{n}', String(n));
      for (const iss of raw) {
        const mergeable = iss.type === 'conformance' && iss.code;
        const key = mergeable ? `${iss.type}::${iss.code}::${iss.message}` : null;
        if (mergeable && byKey.has(key)) {
          const g = byKey.get(key);
          g.concepts.push(iss.concept_id);
          g.title = mergedTitle(g.concepts.length);
          continue;
        }
        const row = mergeable
          ? { ...iss, concepts: [iss.concept_id] } // title set once merged (n>1); single rows keep the concept title
          : { ...iss, concepts: iss.concept_id ? [iss.concept_id] : iss.members || [] };
        if (mergeable) byKey.set(key, row);
        issues.push(row);
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
      // Translated (round 18, #80492) — aria labels are user-facing text.
      return this.translate('okf.validation.healthAria', 'Health: {pct} percent, {n} issue(s)')
        .replace('{pct}', String(this.healthScore))
        .replace('{n}', String(this.validationIssues.length));
    },
    headline() {
      const blockers = this.validationIssues.filter((i) => i.severity === 'blocker').length;
      const warnings = this.validationIssues.length - blockers;
      if (blockers > 0)
        return this.translate(
          'okf.validation.headline.blockers',
          '{n} blocking issue(s) — fix before you hand the repository off'
        ).replace('{n}', String(blockers));
      if (warnings > 0)
        return this.translate('okf.validation.headline.warnings', '{n} thing(s) need your review').replace(
          '{n}',
          String(warnings)
        );
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
    },
    // The error rows from the last repo-wide re-scan — the concepts that are
    // STILL refusing the hand-off after it. Server-side pii_scan_error rides
    // along so the curator sees WHY, not just that it failed again.
    piiRescanErrors() {
      const results =
        this.piiRescanTally && Array.isArray(this.piiRescanTally.results) ? this.piiRescanTally.results : [];
      return results
        .filter((r) => r && (r.pii_state === 'error' || r.skipped))
        .map((r) => ({
          concept_id: r.concept_id,
          reason: r.error || r.skipped || null,
          title: this.conceptTitle(r.concept_id)
        }));
    }
  },
  mounted() {
    this.refresh();
  },
  beforeUnmount() {
    this._stopTopicLinkPolling();
    // A detached poll must not outlive the panel — nobody is watching it.
    this.piiRescanEpoch += 1;
    this._stopPiiRescanPolling();
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
      // #1038: the PII vocabulary is 'clean' | 'hit' | 'unknown' — the panel
      // filtered 'flagged', a value that never occurs, so flagged pages were
      // invisible in Step 7.
      // 2026-10-12: 'error' joins the list. A concept whose scan ERRORED is
      // the one blocking publish, and it was invisible here — the list held
      // only 'hit' rows, so the page the gate refuses had no entry to select
      // and no way to be reached.
      this.piiConcepts = rows.filter((row) => row.pii_state === 'hit' || row.pii_state === 'error');
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
    // Accept one proposal. Reads suggestFor rather than taking a conceptId, so the
    // target page can never disagree with the panel that rendered the button.
    async onAcceptLink(proposal) {
      if (this.acceptBusy) return;
      const conceptId = this.suggestFor;
      if (!conceptId) return;
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
        // The orphan issue clears once the page is linked, so the report is
        // refetched — but the proposal panel is keyed on suggestFor and lives
        // OUTSIDE the issue list, so the remaining proposals and this one's
        // "Done" state both survive. That is the !1075 fix.
        this.refresh();
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
    // #1039 info tips: per-type explanation. TYPE_TIPS doubles as the EN
    // default inside translate(), so missing locale keys degrade to English
    // (same carrier pattern as the rest of the step) instead of rendering ''.
    typeTip(type) {
      return this.translate(`okf.validation.tip.${type}`, TYPE_TIPS[type] || '');
    },
    // Stable identity of a near-duplicate group (title strings can collide).
    dupKey(issue) {
      return (issue.members || []).join('|');
    },
    // Stable identity of a citation issue (!1075). The server emits exactly ONE
    // citation issue per report and it is repo-level — `concept_id: null`
    // (validation-service.js:220-232) — so the hub is the only thing that can
    // vary. Keyed on the hub so this stays correct if the server ever splits
    // the issue per hub.
    wireKey(issue) {
      return `citation:${issue.hub_concept_id || 'none'}`;
    },
    // #1039 near-duplicate preview: fetch each member's body before the
    // steward decides what to delete. Capped at 5 members / PREVIEW_CHARS.
    async onTogglePreview(issue) {
      if (this.previewBusy) return;
      const key = this.dupKey(issue);
      if (this.previewFor === key) {
        this.previewFor = null;
        this.previewMembers = null;
        return;
      }
      this.previewFor = key;
      this.previewMembers = null;
      this.previewBusy = key;
      const members = (issue.members || []).slice(0, 5);
      const loaded = await Promise.all(
        members.map(async (cid) => {
          const res = await this.$store.dispatch('okf/getConcept', { repoId: this.repoId, conceptId: cid });
          const c = (res && res.ok && res.concept) || null;
          return {
            concept_id: cid,
            title: (c && (c.title || cid)) || cid,
            text: String((c && c.body) || '').slice(0, PREVIEW_CHARS)
          };
        })
      );
      this.previewMembers = loaded;
      this.previewBusy = null;
    },
    // CITATION remedy (#1036 Option 2): one click creates (when missing) and
    // wires the Sources page.
    async onWireCitations(issue) {
      if (this.wireBusy) return;
      this.wireBusy = true;
      this.wireNote = '';
      this.wireFor = this.wireKey(issue);
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
    },
    // ── REPO-WIDE PII RE-SCAN (2026-10-12) ──────────────────────────────────
    // The action that unblocks publish when a concept's scan ERRORED. The
    // per-occurrence panel cannot reach that state (an 'error' has no
    // occurrences to redact and is not waivable by acknowledgement), so the
    // only cure is a real scan over the whole repository.
    //
    // ASYNC (202 + poll): one Presidio round-trip per concept cannot finish
    // inside a gateway timeout, so the server arms the run and returns a
    // scan_key. We poll until a TERMINAL state — 'done' or 'failed'. A poll
    // that stopped on 'running' would leave the curator staring at a
    // permanently spinning button, which is the same class of dead end this
    // whole change exists to remove.
    async onRescanAllPii() {
      if (this.piiRescanBusy) return;
      const epoch = ++this.piiRescanEpoch;
      const repoId = this.repoId;
      this.piiRescanBusy = true;
      this.piiRescanNote = '';
      this.piiRescanError = '';
      this.piiRescanTally = null;
      const res = await this.$store.dispatch('okf/startRepoPiiScan', { repoId });
      // STALE-ANSWER GUARD: the repo changed (or the step was torn down) while
      // the arm request was in flight.
      if (epoch !== this.piiRescanEpoch || repoId !== this.repoId) return;
      if (!res || !res.ok) {
        this.piiRescanBusy = false;
        this.piiRescanError = this.piiRescanErrorMessage(res);
        return;
      }
      const scanKey = res.result && res.result.scan_key;
      if (!scanKey) {
        // A 200/202 with no scan_key is not a run we can follow — say so
        // rather than showing an enabled button that will never finish.
        this.piiRescanBusy = false;
        this.piiRescanError = this.translate(
          'okf.validation.piiRescanNoKey',
          'The server accepted the re-scan but returned no run id, so its progress cannot be followed. Nothing was reported.'
        );
        return;
      }
      this.piiRescanKey = scanKey;
      this._piiRescanDeadline = Date.now() + PII_RESCAN_MAX_MS;
      this._pollPiiRescan(epoch, repoId, scanKey);
    },
    _stopPiiRescanPolling() {
      if (this._piiRescanTimer) {
        clearTimeout(this._piiRescanTimer);
        this._piiRescanTimer = null;
      }
    },
    async _pollPiiRescan(epoch, repoId, scanKey) {
      const res = await this.$store.dispatch('okf/getRepoPiiScan', { repoId, scanKey });
      if (epoch !== this.piiRescanEpoch || repoId !== this.repoId) return;
      if (!res || !res.ok) {
        this.piiRescanBusy = false;
        this.piiRescanError = this.piiRescanErrorMessage(res);
        return;
      }
      const run = res.result || {};
      if (run.status === 'running') {
        // Horizon (#80774 — see PII_RESCAN_MAX_MS): stop following a wedged
        // run with a readable timeout; the server-side run is untouched.
        if (this._piiRescanDeadline && Date.now() > this._piiRescanDeadline) {
          this.piiRescanBusy = false;
          this._piiRescanTimer = null;
          this.piiRescanError = this.translate(
            'okf.validation.piiRescanTimeout',
            'The re-scan is still running after 15 minutes — it keeps going server-side. Nothing was lost; check back in a minute.'
          );
          return;
        }
        const p = run.progress || {};
        const done = Number(p.done || 0);
        const total = Number(p.total || 0);
        this.piiRescanNote = total
          ? this.translate('okf.validation.piiRescanProgress', 'Re-scanning… {done} of {total} pages')
              .replace('{done}', String(done))
              .replace('{total}', String(total))
          : this.translate('okf.validation.piiRescanProgressIdle', 'Re-scanning… reading the repository');
        this._piiRescanTimer = setTimeout(() => this._pollPiiRescan(epoch, repoId, scanKey), PII_RESCAN_POLL_MS);
        return;
      }
      // Terminal from here: 'failed' is as final as 'done' (the server reaps
      // orphaned runs), so neither may leave the button spinning.
      this.piiRescanBusy = false;
      this._piiRescanTimer = null;
      if (run.status === 'failed') {
        const err = run.error || {};
        this.piiRescanError =
          err.message ||
          this.translate(
            'okf.validation.piiRescanFailed',
            'Re-scan failed. Nothing was changed — the pages that failed their scan are still blocking publishing.'
          );
        // A failed run may still carry a partial tally — showing it is more
        // honest than hiding the concepts it did reach.
        if (run.tally) this.piiRescanTally = this.normalisePiiTally(run.tally);
        return;
      }
      this.piiRescanTally = this.normalisePiiTally(run);
      // Re-read the concept list: a concept that just came back clean must
      // leave the flagged list, and the gate's own view must be reflected.
      await this.refresh();
      if (epoch !== this.piiRescanEpoch) return;
      const t = this.piiRescanTally;
      this.piiRescanNote =
        t.error || t.missing
          ? this.translate(
              'okf.validation.piiRescanPartial',
              'Re-scanned {n} page(s). {e} still failed — their scan verdict did not change, so publishing stays blocked for them.'
            )
              .replace('{n}', String(t.scanned))
              .replace('{e}', String(t.error + t.missing))
          : this.translate('okf.validation.piiRescanDone', 'Re-scanned {n} page(s).').replace('{n}', String(t.scanned));
    },
    // The run document's tally, with every count coerced to a number — a
    // missing counter must render 0, never "undefined".
    normalisePiiTally(run) {
      const results = Array.isArray(run.results) ? run.results : [];
      const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
      return {
        scanned: num(run.scanned),
        clean: num(run.clean),
        hit: num(run.hit),
        error: num(run.error),
        missing: num(run.missing),
        results
      };
    },
    // Why a repo-wide re-scan did not run. Never swallowed — a 404 here means
    // this server build has no re-scan route, which is exactly the silent
    // no-op the curator is being spared.
    piiRescanErrorMessage(res) {
      const status = res && res.status;
      const serverMessage = res && res.error;
      const code = res && res.code;
      const explain = (c) => (code && code !== c ? ` (${code})` : '');
      if (status === 404) {
        return (
          serverMessage ||
          this.translate(
            'okf.validation.piiRescanMissing',
            'Re-scan is not available on this server (404). Nothing was changed — the pages that failed their scan are still blocking publishing.'
          ) + explain('NOT_FOUND')
        );
      }
      if (status === 409) {
        return (
          serverMessage ||
          this.translate(
            'okf.validation.piiRescanFrozen',
            'Re-scan refused: the repository is being published (409). Nothing was changed.'
          ) + explain('REPO_DRAINING')
        );
      }
      return (
        serverMessage ||
        this.translate(
          'okf.validation.piiRescanFailed',
          'Re-scan failed. Nothing was changed — the pages that failed their scan are still blocking publishing.'
        )
      );
    },
    // A single concept finished a PERSISTING re-scan — its verdict is now
    // written, so the concept list (and the gate's view of it) is stale.
    onPiiRescanned() {
      this.piiRevision += 1;
      this.refresh();
    },
    // ── WHOLE-CORPUS TOPIC LINKS (Story 1-8g-p) ─────────────────────────────
    // The server runs the pass detached (a large repository costs minutes of
    // assistant time), so we arm it, then poll until the run reports done or
    // failed. Re-running is safe: existing links are kept, only new ones added.
    _stopTopicLinkPolling() {
      // Invalidate any in-flight poll (see the epoch check in _pollTopicLinks).
      this._topicLinkEpoch = (this._topicLinkEpoch || 0) + 1;
      if (this._topicLinkTimer) {
        clearTimeout(this._topicLinkTimer);
        this._topicLinkTimer = null;
      }
    },
    async onStartTopicLinks() {
      if (this.topicLinksBusy) return;
      this.topicLinksBusy = true;
      this.topicLinksNote = '';
      const res = await this.$store.dispatch('okf/startTopicLinks', { repoId: this.repoId });
      if (!res || !res.ok) {
        this.topicLinksBusy = false;
        this.topicLinksNote = (res && res.error) || '';
        return;
      }
      this._pollTopicLinks();
    },
    async _pollTopicLinks() {
      // Epoch guard (review !622 round 10, #78746 — mirrors the PII-rescan
      // poll's fix): an in-flight poll resolving after beforeUnmount must not
      // re-arm the 3s tick or refresh() the dead component.
      this._topicLinkEpoch = (this._topicLinkEpoch || 0) + 1;
      const epoch = this._topicLinkEpoch;
      const res = await this.$store.dispatch('okf/getTopicLinkRun', { repoId: this.repoId });
      if (epoch !== this._topicLinkEpoch) return;
      const run = res && res.ok ? res.result : null;
      if (!run) {
        this.topicLinksBusy = false;
        return;
      }
      if (run.status === 'running') {
        const done = Number(run.batches_done || 0);
        const total = Number(run.batches_total || 0);
        this.topicLinksNote = total
          ? this.translate('okf.validation.topicLinks.progress', 'Cross-linking… {done} of {total} batches')
              .replace('{done}', String(done))
              .replace('{total}', String(total))
          : this.translate('okf.validation.topicLinks.progressIdle', 'Cross-linking… reading the repository');
        this._topicLinkTimer = setTimeout(() => this._pollTopicLinks(), 3000);
        return;
      }
      this.topicLinksBusy = false;
      if (run.status === 'failed') {
        this.topicLinksNote = this.translate('okf.validation.topicLinks.failed', 'Cross-linking failed: {msg}').replace(
          '{msg}',
          run.error || 'unknown error'
        );
        return;
      }
      this.topicLinksNote = this.translate('okf.validation.topicLinks.done', 'Added {n} link(s) across {c} page(s).')
        .replace('{n}', String(run.written != null ? run.written : 0))
        .replace('{c}', String(run.concepts_linked != null ? run.concepts_linked : 0));
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
/* The proposal panel is no longer nested inside an issue row (!1075), so it
   reads as its own block with a heading, the same way the whole-corpus
   topic-link remedy below does. */
.okf-step-validate__suggestions {
  margin-top: var(--space-sm);
  padding: var(--space-sm);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg-tertiary);
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}
.okf-step-validate__suggestions-title {
  margin: 0;
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  font-weight: 600;
  font-size: var(--text-sm);
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
/* Story 1-8g-p: the whole-corpus topic-link run — a repo-wide remedy, so it
   reads as its own block rather than another row on one issue. */
.okf-step-validate__topic-links {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-xs);
  padding: var(--space-sm) var(--space-md);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}
.okf-step-validate__topic-links-title {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  margin: 0;
  font-weight: 600;
  font-size: var(--text-sm);
}
.okf-step-validate__topic-links-note {
  margin: 0;
  color: var(--muted);
  font-size: var(--text-sm);
}
/* #1039 density: merged conformance rows + near-dup groups show their page
   ids as a wrapped chip row instead of one row per page. */
.okf-step-validate__issue-concepts {
  display: flex;
  flex-wrap: wrap;
  gap: calc(var(--space-xs) / 2);
  margin-top: var(--space-xs);
}
.okf-step-validate__concept-chip {
  font-size: var(--text-xs);
  padding: 1px var(--space-xs);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* #1039 near-duplicate preview: side-by-side panes so the steward compares
   the copies before deleting any. */
.okf-step-validate__dup-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  width: 100%;
}
.okf-step-validate__preview-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: var(--space-sm);
  width: 100%;
}
.okf-step-validate__preview-pane {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--bg);
  padding: var(--space-xs) var(--space-sm);
  min-width: 0;
}
.okf-step-validate__preview-pane header {
  display: flex;
  align-items: baseline;
  gap: var(--space-sm);
  min-width: 0;
}
.okf-step-validate__preview-pane header span {
  font-size: var(--text-sm);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.okf-step-validate__preview-pane pre {
  margin: 0;
  max-height: 260px;
  overflow: auto;
  font-size: var(--text-xs);
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--fg);
}
.okf-step-validate__preview-pane footer {
  color: var(--muted);
  font-size: var(--text-xs);
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
/* Repo-wide PII re-scan (2026-10-12): the action that clears a concept whose
   scan ERRORED. Sits above the per-concept list — it applies to the whole
   repository, so it reads as its own block rather than a control on one row. */
.okf-step-validate__pii-rescan {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--space-xs);
  padding-bottom: var(--space-sm);
  border-bottom: 1px dashed var(--border);
  width: 100%;
}
.okf-step-validate__pii-rescan-note {
  margin: 0;
  color: var(--muted);
  font-size: var(--text-sm);
}
.okf-step-validate__pii-rescan-error {
  margin: 0;
  color: var(--danger);
  font-size: var(--text-sm);
}
.okf-step-validate__pii-tally {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  width: 100%;
}
.okf-step-validate__pii-tally-row {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  flex-wrap: wrap;
  font-size: var(--text-sm);
}
.okf-step-validate__pii-tally-parts {
  display: flex;
  gap: var(--space-sm);
  flex-wrap: wrap;
  color: var(--muted);
}
.okf-step-validate__pii-tally-part--error {
  color: var(--danger);
  font-weight: 600;
}
.okf-step-validate__pii-tally-id {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
}
.okf-step-validate__pii-tally-detail {
  color: var(--muted);
  font-size: var(--text-xs);
  overflow-wrap: anywhere;
}
/* An errored concept is a different kind of problem from a flagged one —
   the row is a selection button, so the tag rides inline with its title. */
.okf-step-validate__pii-row .ds-status-tag {
  margin-right: var(--space-xs);
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
