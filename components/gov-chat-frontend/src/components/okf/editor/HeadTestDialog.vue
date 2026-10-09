<!-- HeadTestDialog.vue — Story 1-8 (2026-10-08): the OKF Head Tester /
  Routing Lab. One dialog, three tabs (David: "test the tagging/head after
  publishing and before ingesting, then revert to review, modify, publish,
  test again — cycle until the desired accuracy, THEN ingest"):
    Head    — the stored vectorized head: text as per-field tag chips,
              dim/model/version/computed_at + staleness badge, Rebuild
              (admin; hidden in the wizard — no repo mutations there).
    Test    — one query against the two-leg simulation: head scores for
              the repo under test + every sibling, verdict banner, the
              gate breakdown (Floor / Forbidden tags / Margin — 1-8b)
              with its teaching note (veto = fix the tags + republish;
              floor = correct suppression), adversarial expectation
              (expect NOT selected).
    Suites  — LLM-generated suites (+ forbidden-derived negatives +
              curator free-text), run-all, pass-rate/margin history,
              steal pairs ("kenya stole 3 of 8").
  Entry points: StudioDashboard card actions (published + ingested), the
  editor shell actions row, the editor right-rail badge, the wizard
  Publish step (readOnly — view + test only). Lifecycle cycle affordances
  (Unpublish / re-publish note) live in the footer, editor context only.
-->
<template>
  <DsDialog
    :visible="visible"
    :title="translate('okf.headTest.title', 'Routing Lab — head test')"
    size="lg"
    :actions="dialogActions"
    @close="$emit('close')"
    @action="onDialogAction"
  >
    <p v-if="repo" class="okf-headtest__repo-line">
      <strong>{{ repo.name || repo.repo_id }}</strong>
      <span class="okf-headtest__meta-inline">
        <DsPill :variant="serving ? 'success' : 'accent'">
          {{ repo.lifecycle_state }}
        </DsPill>
        <DsPill v-if="headStatus === 'present'" variant="success">
          {{ translate('okf.headTest.badge.present', 'head ready') }}
        </DsPill>
        <DsPill v-else-if="headStatus === 'stale'" variant="warning">
          {{ translate('okf.headTest.badge.stale', 'head stale') }}
        </DsPill>
        <DsPill v-else variant="danger">
          {{ translate('okf.headTest.badge.missing', 'no head') }}
        </DsPill>
      </span>
    </p>

    <DsTabs v-model="tab" :tabs="tabDefs" class="okf-headtest__tabs">
      <!-- ───────────────────────── TAB 1: HEAD ───────────────────────── -->
      <div v-show="tab === 'head'" class="okf-headtest__pane">
        <template v-if="head">
          <div v-for="field in headFields" :key="field.key" class="okf-headtest__field">
            <span class="okf-headtest__field-label">{{ field.label }}</span>
            <span v-if="field.values && field.values.length" class="okf-headtest__chips">
              <DsTag v-for="v in field.values" :key="v">{{ v }}</DsTag>
            </span>
            <span v-else class="okf-headtest__empty">—</span>
          </div>
          <div class="okf-headtest__head-meta">
            <span
              >{{ translate('okf.headTest.head.dim', 'Dimensions') }}: <code>{{ head.dim }}</code></span
            >
            <span
              >{{ translate('okf.headTest.head.model', 'Model') }}: <code>{{ head.model || '—' }}</code></span
            >
            <span
              >{{ translate('okf.headTest.head.version', 'Head version') }}: <code>{{ head.version }}</code></span
            >
            <span>{{ translate('okf.headTest.head.computedAt', 'Computed') }}: {{ shortDate(head.computed_at) }}</span>
            <span v-if="headStatus === 'stale'" class="okf-headtest__stale-note">
              {{
                translate(
                  'okf.headTest.head.staleNote',
                  'Tags changed after this head was built — rebuild before trusting the tests.'
                )
              }}
            </span>
          </div>
        </template>
        <p v-else class="okf-headtest__empty-pane">
          {{
            translate(
              'okf.headTest.head.missingNote',
              'No vectorized head yet. It is built at publish; if the embed service was unavailable then, rebuild it now from the stored tags.'
            )
          }}
        </p>
        <div v-if="!readOnly" class="okf-headtest__pane-actions">
          <DsButton variant="secondary" small :disabled="busy" @click="onRebuild">
            {{ translate('okf.headTest.head.rebuild', 'Rebuild head') }}
          </DsButton>
          <DsInfoTip
            :text="
              translate(
                'okf.headTest.head.rebuildTip',
                'Re-embeds the stored tags into a fresh head vector. One embed call per tag field.'
              )
            "
          />
        </div>
        <DsSpinner v-if="busy === 'rebuild'" size="sm" class="okf-headtest__busy">
          {{ translate('okf.headTest.head.rebuildBusy', 'Rebuilding — embedding the tag fields…') }}
        </DsSpinner>
        <p v-if="error" class="okf-headtest__error">{{ error }}</p>
      </div>

      <!-- ───────────────────────── TAB 2: TEST ───────────────────────── -->
      <div v-show="tab === 'test'" class="okf-headtest__pane">
        <div class="okf-headtest__query-row">
          <DsInput
            v-model="query"
            type="text"
            :placeholder="translate('okf.headTest.test.placeholder', 'e.g. cancer screening guidelines')"
            class="okf-headtest__query-input"
            @keyup.enter="onRunTest"
          />
          <DsButton variant="primary" small :disabled="busy !== null || !query.trim()" @click="onRunTest">
            {{ translate('okf.headTest.test.run', 'Run test') }}
          </DsButton>
        </div>
        <label class="okf-headtest__adversarial">
          <input v-model="adversarial" type="checkbox" />
          {{
            translate(
              'okf.headTest.test.adversarial',
              'Adversarial — this query should NOT select this repository (a forbidden/adjacent topic)'
            )
          }}
        </label>

        <DsSpinner v-if="busy === 'test'" size="sm" class="okf-headtest__busy">
          {{ translate('okf.headTest.test.running', 'Embedding the query and scoring the heads…') }}
        </DsSpinner>

        <template v-if="lastResult">
          <p class="okf-headtest__embedded">
            {{ translate('okf.headTest.test.embeddedWith', 'Embedded with') }}:
            <code>{{ lastResult.embedded_with }}</code>
          </p>
          <div class="okf-headtest__verdict" :class="verdictClass">
            {{ verdictText }}
          </div>
          <table class="okf-headtest__scores">
            <thead>
              <tr>
                <th>{{ translate('okf.headTest.test.col.repo', 'Repository') }}</th>
                <th>{{ translate('okf.headTest.test.col.state', 'State') }}</th>
                <th>{{ translate('okf.headTest.test.col.headScore', 'Head score') }}</th>
                <th>{{ translate('okf.headTest.test.col.rank', 'Rank') }}</th>
                <th>{{ translate('okf.headTest.test.col.claimed', 'Claims query') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in scoreRows"
                :key="row.repo_id"
                :class="{ 'okf-headtest__row-under-test': row.under_test }"
              >
                <td>
                  {{ row.name }}
                  <span v-if="row.under_test" class="okf-headtest__under-mark">◂</span>
                </td>
                <td>{{ row.state }}</td>
                <td>
                  <span class="okf-headtest__bar"><span :style="{ width: barWidth(row.score) }" /></span>
                  <code>{{ (row.score || 0).toFixed(3) }}</code>
                </td>
                <td>{{ row.rank }}</td>
                <td>
                  <!-- 1-8a/1-8b: the gate column — a head only CLAIMS a
                       query when it clears floor + forbidden-veto + margin;
                       when it is suppressed, name the condition that
                       decided (under-test rows carry head_claim). -->
                  <DsPill v-if="row.claimed === true" variant="success">
                    {{ translate('okf.headTest.test.claimed', 'claims') }}
                  </DsPill>
                  <template v-else-if="row.claimed === false">
                    <DsPill variant="warning">
                      {{ translate('okf.headTest.test.suppressed', 'suppressed') }}
                    </DsPill>
                    <span v-if="row.claim" class="okf-headtest__claim-why">{{ claimLabel(row.claim) }}</span>
                  </template>
                  <span v-else class="okf-headtest__empty">—</span>
                </td>
              </tr>
            </tbody>
          </table>
          <!-- 1-8b: the three gate conditions behind head_claimed — Floor
               (off-domain noise), Forbidden tags (the hard veto), Margin
               (centroid clearance). Thresholds come from the response's
               fidelity.knobs so the display never drifts from the config. -->
          <div v-if="gateChecks.length" class="okf-headtest__gate">
            <span class="okf-headtest__gate-title">{{ translate('okf.headTest.gate.title', 'Gate') }}</span>
            <span v-for="check in gateChecks" :key="check.key" class="okf-headtest__gate-check">
              <span class="okf-headtest__gate-name">{{ check.name }}</span>
              <code v-if="check.value">{{ check.value }}</code>
              <DsTag v-if="check.tag">{{ check.tag }}</DsTag>
              <DsPill :variant="check.state === 'pass' ? 'success' : check.state === 'fail' ? 'danger' : 'neutral'">
                {{
                  check.state === 'pass'
                    ? translate('okf.headTest.gate.pass', 'pass')
                    : check.state === 'fail'
                      ? translate('okf.headTest.gate.fail', 'fail')
                      : translate('okf.headTest.gate.na', 'n/a')
                }}
              </DsPill>
            </span>
          </div>
          <!-- 1-8b: the teaching panel — a veto is FIXABLE (remove the tag,
               republish, rebuild the head); a floor suppression is correct
               behavior, not a defect; a plain claim needs no guidance. -->
          <div v-if="teachNote" class="okf-headtest__teach" :class="'okf-headtest__teach--' + teachNote.kind">
            <span class="okf-headtest__teach-title">{{
              translate('okf.headTest.teach.title', 'What this means')
            }}</span>
            <p class="okf-headtest__teach-text">{{ teachNote.text }}</p>
          </div>
          <p v-if="lastResult.verdict && lastResult.verdict.provenance" class="okf-headtest__provenance">
            {{ translate('okf.headTest.test.provenance', 'Routing provenance') }}:
            <code>{{ lastResult.verdict.provenance }}</code>
          </p>
        </template>
        <p v-else-if="busy !== 'test'" class="okf-headtest__empty-pane">
          {{
            translate(
              'okf.headTest.test.empty',
              'Type a query a user would ask and run it — the lab scores every published repository head exactly as the fan-out would.'
            )
          }}
        </p>
        <p v-if="error" class="okf-headtest__error">{{ error }}</p>
      </div>

      <!-- ─────────────────────── TAB 3: SUITES ─────────────────────── -->
      <div v-show="tab === 'suites'" class="okf-headtest__pane">
        <div class="okf-headtest__pane-actions">
          <DsButton variant="primary" small :disabled="busy !== null" @click="onGenerateSuite">
            {{ translate('okf.headTest.suites.generate', 'Generate test suite') }}
          </DsButton>
          <DsInfoTip
            :text="
              translate(
                'okf.headTest.suites.generateTip',
                'The LLM writes should-route-here queries plus confusable near-miss queries from the competing repositories; the forbidden tags add must-NOT-route queries. Takes 5-15 seconds.'
              )
            "
          />
        </div>
        <DsSpinner v-if="busy === 'generate'" size="sm" class="okf-headtest__busy">
          {{ translate('okf.headTest.suites.generating', 'Generating — the LLM is writing the queries…') }}
        </DsSpinner>
        <DsSpinner v-if="busy === 'run'" size="sm" class="okf-headtest__busy">
          {{ translate('okf.headTest.suites.running', 'Running every suite query…') }}
        </DsSpinner>

        <div v-if="suite" class="okf-headtest__suite">
          <h4 class="okf-headtest__suite-title">
            {{ translate('okf.headTest.suites.current', 'Current suite') }}
            <code>{{ suite.suite_key }}</code>
          </h4>
          <div class="okf-headtest__pane-actions">
            <DsButton variant="secondary" small :disabled="busy !== null" @click="onRunSuite">
              {{ translate('okf.headTest.suites.run', 'Run all queries') }}
            </DsButton>
          </div>
          <table class="okf-headtest__scores">
            <thead>
              <tr>
                <th>{{ translate('okf.headTest.suites.col.query', 'Query') }}</th>
                <th>{{ translate('okf.headTest.suites.col.kind', 'Kind') }}</th>
                <th>{{ translate('okf.headTest.suites.col.outcome', 'Outcome') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in suiteResultRows" :key="row.key">
                <td>{{ row.query }}</td>
                <td>
                  <DsPill :variant="row.kind === 'positive' ? 'info' : 'warn'">
                    {{ row.kind }}{{ row.source ? ' · ' + row.source : '' }}
                  </DsPill>
                </td>
                <td>
                  <DsPill v-if="row.error" variant="danger">{{ row.error }}</DsPill>
                  <DsPill v-else-if="row.pass === null" variant="info">
                    {{ translate('okf.headTest.suites.notEvaluatable', 'not evaluatable (no competitors)') }}
                  </DsPill>
                  <DsPill v-else-if="row.pass" variant="success">
                    {{ translate('okf.headTest.suites.pass', 'pass') }}
                  </DsPill>
                  <DsPill v-else variant="danger">
                    {{ row.failLabel }}
                  </DsPill>
                </td>
              </tr>
            </tbody>
          </table>
          <div v-if="lastRunSummary" class="okf-headtest__summary">
            <span>
              {{ translate('okf.headTest.suites.passRate', 'Pass rate') }}:
              <strong>{{ pct(lastRunSummary.pass_rate) }}</strong>
            </span>
            <span>
              {{ translate('okf.headTest.suites.positives', 'Positives') }}:
              <strong>{{ lastRunSummary.positive_passed }}/{{ lastRunSummary.positive_total }}</strong>
            </span>
            <span>
              {{ translate('okf.headTest.suites.negatives', 'Negatives') }}:
              <strong>{{ negLabel }}</strong>
            </span>
            <span v-if="lastRunSummary.avg_margin !== null">
              {{ translate('okf.headTest.suites.avgMargin', 'Avg margin') }}:
              <strong>{{ (lastRunSummary.avg_margin || 0).toFixed(3) }}</strong>
            </span>
            <span v-for="steal in lastRunSummary.steals" :key="steal.by_repo" class="okf-headtest__steal">
              {{
                translate('okf.headTest.suites.steal', '{repo} stole {n} queries')
                  .replace('{repo}', steal.by_repo)
                  .replace('{n}', String(steal.count))
              }}
            </span>
          </div>
        </div>

        <div class="okf-headtest__add-query">
          <DsInput
            v-model="manualQuery"
            type="text"
            :placeholder="translate('okf.headTest.suites.addPlaceholder', 'Your own probe query…')"
            class="okf-headtest__query-input"
          />
          <DsSelect v-model="manualKind" :options="manualKindOptions" class="okf-headtest__kind-select" />
          <DsButton
            variant="secondary"
            small
            :disabled="!suite || busy !== null || !manualQuery.trim()"
            @click="onAddQuery"
          >
            {{ translate('okf.headTest.suites.add', 'Add to suite') }}
          </DsButton>
        </div>

        <h4 class="okf-headtest__suite-title">
          {{ translate('okf.headTest.suites.history', 'Run history') }}
        </h4>
        <table v-if="runs.length" class="okf-headtest__scores">
          <thead>
            <tr>
              <th>{{ translate('okf.headTest.suites.col.run', 'Run') }}</th>
              <th>{{ translate('okf.headTest.suites.col.when', 'When') }}</th>
              <th>{{ translate('okf.headTest.suites.col.passRate', 'Pass rate') }}</th>
              <th>{{ translate('okf.headTest.suites.col.headVersion', 'Head') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in runs" :key="r._key">
              <td>
                <code>{{ r._key }}</code>
              </td>
              <td>{{ shortDate(r.created_at) }}</td>
              <td>{{ pct(r.summary ? r.summary.pass_rate : null) }}</td>
              <td>{{ r.head_version || '—' }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else class="okf-headtest__empty-pane">
          {{ translate('okf.headTest.suites.noRuns', 'No runs yet — generate a suite and run it.') }}
        </p>
        <p v-if="error" class="okf-headtest__error">{{ error }}</p>
      </div>
    </DsTabs>
  </DsDialog>
</template>

<script>
import translateMixin from '../../../mixins/translateMixin';
import DsDialog from '../../ds/Dialog.vue';
import DsTabs from '../../ds/Tabs.vue';
import DsButton from '../../ds/Button.vue';
import DsInput from '../../ds/Input.vue';
import DsSelect from '../../ds/Select.vue';
import DsPill from '../../ds/Pill.vue';
import DsTag from '../../ds/Tag.vue';
import DsSpinner from '../../ds/Spinner.vue';
import DsInfoTip from '../../ds/InfoTip.vue';

// The head text is assembled server-side as "Label: v1, v2. …" lines; the
// panel re-renders each frontmatter field from the STORED frontmatter on
// the repo doc (the head text itself stays verbatim in the tooltip).
const HEAD_FIELDS = [
  { key: 'topic', labelKey: 'okf.frontmatter.field.topic', label: 'Topics' },
  { key: 'entity', labelKey: 'okf.frontmatter.field.entity', label: 'Entities' },
  { key: 'keyword', labelKey: 'okf.frontmatter.field.keyword', label: 'Keywords' },
  { key: 'scope', labelKey: 'okf.frontmatter.field.scope', label: 'Scope' },
  { key: 'forbidden', labelKey: 'okf.frontmatter.field.forbidden', label: 'Not about' }
];

export default {
  name: 'OkfHeadTestDialog',
  components: { DsDialog, DsTabs, DsButton, DsInput, DsSelect, DsPill, DsTag, DsSpinner, DsInfoTip },
  mixins: [translateMixin],
  props: {
    visible: { type: Boolean, default: false },
    repo: { type: Object, default: null },
    /** Wizard Publish step mounts this readOnly: viewing + testing is fine,
     * head REBUILD and the lifecycle footer affordances are not (D4 rule —
     * no repo mutations from the wizard). */
    readOnly: { type: Boolean, default: false },
    initialTab: { type: String, default: 'head' }
  },
  emits: ['close', 'changed', 'request-unpublish'],
  data() {
    return {
      tab: this.initialTab,
      busy: null,
      error: '',
      query: '',
      adversarial: false,
      lastResult: null,
      suite: null,
      lastRunSummary: null,
      manualQuery: '',
      manualKind: 'positive',
      runs: []
    };
  },
  computed: {
    serving() {
      return !!(this.repo && this.repo.ingested_at);
    },
    head() {
      return (this.repo && this.repo.head && this.repo.head.vector && this.repo.head) || null;
    },
    headStatus() {
      if (!this.head) return 'missing';
      const fm = this.repo.frontmatter;
      if (fm && fm.updated_at && this.head.computed_at && fm.updated_at > this.head.computed_at) return 'stale';
      return 'present';
    },
    tabDefs() {
      return [
        { value: 'head', label: this.translate('okf.headTest.tab.head', 'Head') },
        { value: 'test', label: this.translate('okf.headTest.tab.test', 'Test') },
        { value: 'suites', label: this.translate('okf.headTest.tab.suites', 'Suites & analytics') }
      ];
    },
    headFields() {
      const fm = (this.repo && this.repo.frontmatter) || {};
      return HEAD_FIELDS.map((f) => ({
        ...f,
        label: this.translate(f.labelKey, f.label),
        values: Array.isArray(fm[f.key]) ? fm[f.key] : fm[f.key] ? [String(fm[f.key])] : []
      }));
    },
    scoreRows() {
      if (!this.lastResult) return [];
      const ut = this.lastResult.under_test;
      const rows = [
        {
          repo_id: ut.repo_id,
          name: ut.name,
          state: ut.lifecycle_state,
          score: ut.head_score,
          rank: ut.head_rank,
          claimed: ut.head_claimed !== undefined ? ut.head_claimed : null,
          claim: ut.head_claim || null,
          under_test: true
        }
      ];
      for (const s of this.lastResult.siblings || []) {
        rows.push({
          repo_id: s.repo_id,
          name: s.name,
          state: s.lifecycle_state,
          score: s.head_score,
          rank: s.head_rank,
          claimed: s.head_claimed !== undefined ? s.head_claimed : null,
          claim: null, // 1-8b: the deciding condition is under-test telemetry only
          under_test: false
        });
      }
      return rows.sort((a, b) => (b.score || 0) - (a.score || 0));
    },
    verdictClass() {
      if (!this.lastResult) return '';
      const selected = this.headSelected;
      const pass = this.adversarial ? !selected : selected;
      return pass ? 'okf-headtest__verdict--pass' : 'okf-headtest__verdict--fail';
    },
    /** 1-8a: selection = the head CLAIMS the query (top score AND it
     * clears its own forbidden centroid by the margin gate) — the rank
     * alone stops being the verdict, so one-repo universes are honest. */
    headSelected() {
      if (!this.lastResult) return false;
      return !!this.lastResult.verdict.under_test_wins_head;
    },
    headSuppressed() {
      if (!this.lastResult) return false;
      return !!this.lastResult.verdict.head_suppressed;
    },
    /** 1-8b: the three knob values, read from the response's fidelity
     * block so the displayed thresholds always match the server's real
     * config (fallbacks mirror the server defaults). */
    gateKnobs() {
      const k = (this.lastResult && this.lastResult.fidelity && this.lastResult.fidelity.knobs) || {};
      const num = (v, fb) => (typeof v === 'number' ? v : fb);
      return {
        floor: num(k.ROUTE_HEAD_FLOOR, 0.55),
        tagMax: num(k.ROUTE_FORBIDDEN_TAG_MAX, 0.55),
        margin: num(k.ROUTE_HEAD_MARGIN, 0.01)
      };
    },
    /** 1-8b: the three checks of the gate — value string for the code
     * chip, the vetoed tag when present, and pass/fail state ('na' when
     * the head carries no data for that leg: pre-1-8b heads skip the
     * veto, heads without forbidden tags skip the margin). Empty for
     * pre-v2 (1-8a) payloads — they carry no head_claim. */
    gateChecks() {
      const ut = this.lastResult && this.lastResult.under_test;
      if (!ut || !ut.head_claim) return [];
      const has = (v) => v !== null && v !== undefined;
      return [
        {
          key: 'floor',
          name: this.claimLabel('floor'),
          value: has(ut.head_score) ? `${ut.head_score.toFixed(3)} ≥ ${this.gateKnobs.floor.toFixed(2)}` : '',
          tag: '',
          state: has(ut.head_score) ? (ut.floor_pass ? 'pass' : 'fail') : 'na'
        },
        {
          key: 'veto',
          name: this.claimLabel('veto'),
          value: has(ut.max_tag_cosine)
            ? `max ${ut.max_tag_cosine.toFixed(3)} ${ut.tag_veto ? '≥' : '<'} ${this.gateKnobs.tagMax.toFixed(2)}`
            : '',
          tag: ut.tag_veto || '',
          state: has(ut.max_tag_cosine) ? (ut.tag_veto ? 'fail' : 'pass') : 'na'
        },
        {
          key: 'margin',
          name: this.claimLabel('margin'),
          value: has(ut.head_margin) ? `${ut.head_margin.toFixed(3)} > ${this.gateKnobs.margin.toFixed(2)}` : '',
          tag: '',
          state: has(ut.head_margin) ? (ut.head_margin > this.gateKnobs.margin ? 'pass' : 'fail') : 'na'
        }
      ];
    },
    /** 1-8b: the vetoed tag — from the structured field, else parsed out
     * of the provenance string ("head-suppressed (forbidden: <tag>)"). */
    vetoTag() {
      const ut = this.lastResult && this.lastResult.under_test;
      if (ut && ut.tag_veto) return ut.tag_veto;
      const prov = this.lastResult && this.lastResult.verdict && this.lastResult.verdict.provenance;
      const m = typeof prov === 'string' ? prov.match(/^head-suppressed \(forbidden: (.+)\)$/) : null;
      return m ? m[1] : '';
    },
    /** 1-8b teaching note: a veto is actionable (remove the named tag +
     * republish), a floor suppression is correct behavior (no fix), and
     * a claim (or a margin loss, which the breakdown already shows)
     * needs no panel. */
    teachNote() {
      const ut = this.lastResult && this.lastResult.under_test;
      if (!ut) return null;
      if (ut.head_claim === 'veto') {
        return {
          kind: 'veto',
          text: this.translate(
            'okf.headTest.teach.veto',
            'This query strongly matches the forbidden tag "{tag}". If it SHOULD belong to this repository, remove "{tag}" from the forbidden tags in Frontmatter, then republish to rebuild the head.'
          ).replace(/\{tag\}/g, this.vetoTag)
        };
      }
      if (ut.head_claim === 'floor') {
        return {
          kind: 'floor',
          text: this.translate(
            'okf.headTest.teach.floor',
            'The query is unrelated to the subject matter of this repository (score below the domain floor) — no tag change fixes this; it is correct suppression.'
          )
        };
      }
      return null;
    },
    /** 1-8a margin detail, extended by 1-8b with the deciding gate
     * condition (e.g. "… = 0.094 · Forbidden tags: genetics"). */
    gateDetail() {
      const ut = this.lastResult && this.lastResult.under_test;
      if (!ut) return '';
      const bits = [];
      if (typeof ut.head_margin === 'number' && typeof ut.head_score === 'number') {
        bits.push(
          `score ${ut.head_score.toFixed(3)} − forbidden ${ut.forbidden_cosine.toFixed(3)} = ${ut.head_margin.toFixed(3)}`
        );
      }
      if (ut.head_claim) {
        const label = this.claimLabel(ut.head_claim);
        bits.push(ut.head_claim === 'veto' && ut.tag_veto ? `${label}: ${ut.tag_veto}` : label);
      }
      return bits.length ? ` (${bits.join(' · ')})` : '';
    },
    verdictText() {
      if (!this.lastResult) return '';
      const wins = this.lastResult.verdict.under_test_wins_head;
      const winner = this.winnerName(this.lastResult.verdict.head_routing_winner);
      if (this.adversarial) {
        return wins
          ? this.translate(
              'okf.headTest.test.failAdversarial',
              'FAIL — this query routed HERE but it should not: the head claimed it'
            ) + this.gateDetail
          : this.headSuppressed
            ? this.translate(
                'okf.headTest.test.passSuppressed',
                'PASS — suppressed by the forbidden/noise gate: the head does not claim this query'
              ) + this.gateDetail
            : this.translate(
                'okf.headTest.test.passAdversarial',
                'PASS — correctly not selected (winner: {repo}).'
              ).replace('{repo}', winner);
      }
      return wins
        ? this.translate('okf.headTest.test.pass', 'PASS — this repository wins the head routing.') + this.gateDetail
        : this.headSuppressed
          ? this.translate(
              'okf.headTest.test.notSelectedSuppressed',
              'NOT SELECTED — suppressed by the forbidden/noise gate: the query is more like what this repository excludes, or is off-domain noise'
            ) + this.gateDetail
          : this.translate('okf.headTest.test.fail', 'FAIL — {repo} wins the head routing for this query.').replace(
              '{repo}',
              winner
            );
    },
    suiteResultRows() {
      if (!this.lastRunSummary || !this.lastRunSummaryRows) return [];
      return this.lastRunSummaryRows;
    },
    negLabel() {
      const s = this.lastRunSummary;
      if (!s) return '—';
      if (s.negative_evaluatable === 0) {
        return this.translate('okf.headTest.suites.noCompetitors', 'n/a — no competing heads yet');
      }
      return `${s.negative_passed}/${s.negative_evaluatable}`;
    },
    manualKindOptions() {
      return [
        { value: 'positive', label: this.translate('okf.headTest.suites.kindPositive', 'should select') },
        { value: 'negative', label: this.translate('okf.headTest.suites.kindNegative', 'should NOT select') }
      ];
    },
    dialogActions() {
      const actions = [];
      if (!this.readOnly && this.repo && this.repo.lifecycle_state === 'publish' && !this.serving) {
        actions.push({
          key: 'unpublish',
          label: this.translate('okf.headTest.footer.unpublish', 'Unpublish to review'),
          variant: 'secondary',
          disabled: this.busy !== null
        });
      }
      actions.push({ key: 'close', label: this.translate('common.close', 'Close'), variant: 'secondary' });
      return actions;
    }
  },
  watch: {
    visible: {
      immediate: true,
      async handler(open) {
        if (open && this.repo) {
          this.tab = this.initialTab;
          this.error = '';
          this.refreshRuns();
        }
      }
    }
  },
  methods: {
    /** 1-8b: translated label for a head_claim token (floor | veto |
     * margin | claim) — used by the claims column, the banner suffix and
     * the gate breakdown. */
    claimLabel(claim) {
      const keys = {
        floor: ['okf.headTest.gate.floor', 'Floor'],
        veto: ['okf.headTest.gate.veto', 'Forbidden tags'],
        margin: ['okf.headTest.gate.margin', 'Margin'],
        claim: ['okf.headTest.gate.claim', 'Claim']
      };
      const hit = keys[claim];
      return hit ? this.translate(hit[0], hit[1]) : claim;
    },
    winnerName(repoId) {
      if (!this.lastResult) return '';
      if (repoId === this.lastResult.under_test.repo_id) return this.lastResult.under_test.name;
      const s = (this.lastResult.siblings || []).find((x) => x.repo_id === repoId);
      return s ? s.name : repoId;
    },
    barWidth(score) {
      const s = Math.max(0, Math.min(1, score || 0));
      return Math.round(s * 100) + '%';
    },
    pct(v) {
      return v === null || v === undefined ? '—' : Math.round(v * 100) + '%';
    },
    shortDate(iso) {
      try {
        return new Date(iso).toLocaleString();
      } catch {
        return iso || '—';
      }
    },
    async onRebuild() {
      this.busy = 'rebuild';
      this.error = '';
      const res = await this.$store.dispatch('okf/headRebuild', { repoId: this.repo.repo_id });
      this.busy = null;
      if (!res.ok) {
        this.error = res.message || this.translate('okf.headTest.error.rebuild', 'Head rebuild failed');
        return;
      }
      this.$emit('changed', { head: res.result });
    },
    async onRunTest() {
      if (!this.query.trim()) return;
      this.busy = 'test';
      this.error = '';
      this.lastResult = null;
      const res = await this.$store.dispatch('okf/headRoutingTest', {
        repoId: this.repo.repo_id,
        query: this.query.trim()
      });
      this.busy = null;
      if (!res.ok) {
        this.error = res.message || this.translate('okf.headTest.error.test', 'Routing test failed');
        return;
      }
      this.lastResult = res.result;
    },
    async onGenerateSuite() {
      this.busy = 'generate';
      this.error = '';
      const res = await this.$store.dispatch('okf/headSuiteGenerate', { repoId: this.repo.repo_id });
      this.busy = null;
      if (!res.ok) {
        this.error = res.message || this.translate('okf.headTest.error.generate', 'Suite generation failed');
        return;
      }
      this.suite = res.result;
      this.lastRunSummary = null;
      this.refreshRuns();
    },
    async onRunSuite() {
      if (!this.suite) return;
      this.busy = 'run';
      this.error = '';
      const res = await this.$store.dispatch('okf/headSuiteRun', {
        repoId: this.repo.repo_id,
        suiteKey: this.suite.suite_key
      });
      this.busy = null;
      if (!res.ok) {
        this.error = res.message || this.translate('okf.headTest.error.run', 'Suite run failed');
        return;
      }
      this.lastRunSummary = res.result.payload.summary;
      // Map the summary onto the suite's queries for the outcome column.
      const results = (res.result.payload && res.result.payload.results) || [];
      this.lastRunSummaryRows = results.map((r, i) => ({
        key: r.query + ':' + i,
        query: r.query,
        kind: r.kind,
        source: r.source,
        error: r.error || null,
        pass: this.outcomeOf(r),
        failLabel: this.failLabelOf(r)
      }));
      this.refreshRuns();
    },
    /** Pass semantics (server-identical): positive passes when the repo
     * wins the head leg; negative passes when it does NOT — but only if
     * competitors exist (a one-repo race is not a real test → null). */
    outcomeOf(r) {
      if (r.error) return false;
      if (r.kind === 'positive') return !!r.under_test_wins_head;
      // 1-8a: gate-era results know head_claimed — a negative passes when
      // the head does NOT claim the query (works in a one-repo universe).
      // Legacy results (head_claimed null) keep the sibling-gated rank rule.
      if (r.head_claimed !== null && r.head_claimed !== undefined) return r.head_claimed === false;
      if (!r.sibling_count) return null;
      return !r.under_test_wins_head;
    },
    failLabelOf(r) {
      if (r.error) return r.error;
      return this.translate('okf.headTest.suites.fail', 'fail');
    },
    async onAddQuery() {
      if (!this.suite || !this.manualQuery.trim()) return;
      this.busy = 'add';
      this.error = '';
      const res = await this.$store.dispatch('okf/headSuiteAddQueries', {
        repoId: this.repo.repo_id,
        suiteKey: this.suite.suite_key,
        queries: [{ query: this.manualQuery.trim(), kind: this.manualKind, reason: 'curator probe' }]
      });
      this.busy = null;
      if (!res.ok) {
        this.error = res.message || this.translate('okf.headTest.error.add', 'Could not add the query');
        return;
      }
      this.suite = res.result;
      this.manualQuery = '';
    },
    async refreshRuns() {
      const res = await this.$store.dispatch('okf/headSuiteListRuns', { repoId: this.repo.repo_id, kind: 'run' });
      if (res.ok) this.runs = res.runs;
    },
    onDialogAction(key) {
      if (key === 'close') this.$emit('close');
      if (key === 'unpublish') this.$emit('request-unpublish', this.repo);
    }
  }
};
</script>

<style scoped>
.okf-headtest__repo-line {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-sm);
  margin: 0 0 var(--space-md);
}
.okf-headtest__meta-inline {
  display: inline-flex;
  gap: var(--space-xs);
  align-items: center;
}
.okf-headtest__tabs {
  min-height: 320px;
}
.okf-headtest__pane {
  padding-top: var(--space-sm);
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}
.okf-headtest__field {
  display: flex;
  align-items: baseline;
  gap: var(--space-sm);
}
.okf-headtest__field-label {
  min-width: 90px;
  font-weight: 600;
  font-size: var(--text-sm);
  color: var(--muted);
}
.okf-headtest__chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs);
}
.okf-headtest__head-meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-md);
  font-size: var(--text-sm);
  color: var(--muted);
}
.okf-headtest__stale-note {
  width: 100%;
  color: var(--warning);
}
.okf-headtest__pane-actions {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}
.okf-headtest__query-row {
  display: flex;
  gap: var(--space-sm);
}
.okf-headtest__query-input {
  flex: 1;
}
.okf-headtest__adversarial {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  font-size: var(--text-sm);
  color: var(--muted);
}
.okf-headtest__verdict {
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-sm);
  font-weight: 600;
  font-size: var(--text-sm);
}
.okf-headtest__verdict--pass {
  background: color-mix(in oklab, var(--success) 14%, transparent);
  color: var(--success);
}
.okf-headtest__verdict--fail {
  background: color-mix(in oklab, var(--danger) 14%, transparent);
  color: var(--danger);
}
.okf-headtest__scores {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
}
.okf-headtest__scores th {
  text-align: left;
  color: var(--muted);
  font-weight: 600;
  padding: var(--space-xs) var(--space-sm);
  border-bottom: 1px solid var(--border);
}
.okf-headtest__scores td {
  padding: var(--space-xs) var(--space-sm);
  border-bottom: 1px solid var(--border);
}
.okf-headtest__row-under-test {
  background: color-mix(in oklab, var(--accent) 8%, transparent);
}
.okf-headtest__under-mark {
  color: var(--accent);
  margin-left: var(--space-xs);
}
.okf-headtest__bar {
  display: inline-block;
  width: 90px;
  height: 6px;
  border-radius: 3px;
  background: var(--bg);
  margin-right: var(--space-xs);
  vertical-align: middle;
  overflow: hidden;
}
.okf-headtest__bar span {
  display: block;
  height: 100%;
  background: var(--accent);
}
.okf-headtest__embedded,
.okf-headtest__provenance {
  font-size: var(--text-sm);
  color: var(--muted);
  margin: 0;
}
.okf-headtest__claim-why {
  margin-left: var(--space-xs);
  font-size: var(--text-sm);
  color: var(--muted);
}
.okf-headtest__gate {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-xs) var(--space-sm);
  font-size: var(--text-sm);
  background: var(--bg);
  border-radius: var(--radius-sm);
}
.okf-headtest__gate-title {
  font-weight: 600;
  color: var(--muted);
}
.okf-headtest__gate-check {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
}
.okf-headtest__gate-name {
  color: var(--muted);
}
.okf-headtest__teach {
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
}
.okf-headtest__teach-title {
  display: block;
  font-weight: 600;
  margin-bottom: var(--space-xs);
}
.okf-headtest__teach-text {
  margin: 0;
}
.okf-headtest__teach--veto {
  background: color-mix(in oklab, var(--warning) 14%, transparent);
  color: var(--warning);
}
.okf-headtest__teach--floor {
  background: color-mix(in oklab, var(--info) 14%, transparent);
  color: var(--info);
}
.okf-headtest__suite-title {
  margin: var(--space-sm) 0 0;
  font-size: var(--text-sm);
  font-weight: 600;
}
.okf-headtest__summary {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-md);
  font-size: var(--text-sm);
  padding: var(--space-sm);
  background: var(--bg);
  border-radius: var(--radius-sm);
}
.okf-headtest__steal {
  color: var(--danger);
}
.okf-headtest__add-query {
  display: flex;
  gap: var(--space-sm);
  align-items: center;
}
.okf-headtest__kind-select {
  width: 180px;
}
.okf-headtest__empty,
.okf-headtest__empty-pane {
  color: var(--muted);
  font-size: var(--text-sm);
}
.okf-headtest__busy {
  align-self: flex-start;
}
.okf-headtest__error {
  color: var(--danger);
  font-size: var(--text-sm);
  margin: 0;
}
</style>
