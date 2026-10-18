<template>
  <div class="okf-ragas">
    <!-- PANE HEAD — the renamed surface (David, 2026-10-17): the ⓘ glosses
         RAGAS in plain language and links to ragas.io for deeper reading;
         the Help toggle expands the every-control reference below it
         (David, 2026-10-18). -->
    <div class="okf-ragas__pane-head">
      <h4 class="okf-headtest__pane-title">
        {{ translate('okf.ragas.paneTitle', 'RAGAS Benchmarks') }}
      </h4>
      <DsInfoTip
        :text="
          translate(
            'okf.ragas.about',
            'RAGAS scores how well the assistant retrieves and answers — faithfulness, context precision and recall, answer relevancy and more. Run a benchmark suite to measure the repository as a knowledge base.'
          )
        "
        :label="translate('okf.ragas.aboutLabel', 'What is RAGAS?')"
        href="https://www.ragas.io/"
        :link-label="translate('okf.ragas.aboutLink', 'Read more at ragas.io')"
      />
      <button type="button" class="okf-ragas__help-toggle" @click="showHelp = !showHelp">
        {{ showHelp ? translate('okf.ragas.help.hide', 'Hide help') : translate('okf.ragas.help.show', 'Help') }}
      </button>
    </div>
    <!-- HELP — every field and control on the screen, in one place. -->
    <div v-if="showHelp" class="okf-ragas__section okf-ragas__help">
      <dl class="okf-ragas__help-list">
        <div v-for="item in helpItems" :key="item.key" class="okf-ragas__help-row">
          <dt>{{ item.title }}</dt>
          <dd>{{ item.text }}</dd>
        </div>
      </dl>
      <a class="okf-ragas__help-more" href="https://www.ragas.io/" target="_blank" rel="noopener noreferrer">{{
        translate('okf.ragas.help.more', 'Read more at ragas.io')
      }}</a>
    </div>
    <!-- GENERATION + INTERCHANGE -->
    <div class="okf-ragas__section">
      <h4 class="okf-headtest__pane-title">
        {{ translate('okf.ragas.generate.title', 'Generate a benchmark suite') }}
      </h4>
      <p class="okf-ragas__hint">
        {{
          translate(
            'okf.ragas.generate.hint',
            'Synthesizes questions with expected outputs from the selected repositories — one or more, the current repo alone or with related repos.'
          )
        }}
      </p>
      <div v-if="!readOnly" class="okf-ragas__repos">
        <label v-for="r in repoChoices" :key="r.repo_id" class="okf-ragas__repo-row">
          <input
            v-model="selectedRepoIds"
            type="checkbox"
            :value="r.repo_id"
            :disabled="r.repo_id === (repo && repo.repo_id) || generateBusy"
          />
          <span>{{ r.name }}</span>
          <DsPill
            v-if="r.repo_id === (repo && repo.repo_id)"
            variant="accent"
            :label="translate('okf.ragas.current', 'current')"
          />
        </label>
      </div>
      <div class="okf-ragas__dims">
        <label class="okf-ragas__dim">
          <span>{{ translate('okf.ragas.generate.size', 'Questions') }}</span>
          <input v-model.number="genSize" type="number" min="1" max="200" :disabled="generateBusy" />
        </label>
        <label class="okf-ragas__dim">
          <span>{{ translate('okf.ragas.generate.single', 'Single-hop %') }}</span>
          <input v-model.number="distSingle" type="number" min="0" max="100" :disabled="generateBusy" />
        </label>
        <label class="okf-ragas__dim">
          <span>{{ translate('okf.ragas.generate.multiAbstract', 'Multi-hop (abstract) %') }}</span>
          <input v-model.number="distAbstract" type="number" min="0" max="100" :disabled="generateBusy" />
        </label>
        <label class="okf-ragas__dim">
          <span>{{ translate('okf.ragas.generate.multiSpecific', 'Multi-hop (specific) %') }}</span>
          <input v-model.number="distSpecific" type="number" min="0" max="100" :disabled="generateBusy" />
        </label>
        <label class="okf-ragas__dim">
          <span>{{ translate('okf.ragas.generate.personas', 'Personas') }}</span>
          <input v-model.number="genPersonas" type="number" min="1" max="10" :disabled="generateBusy" />
        </label>
      </div>
      <div class="okf-ragas__actions">
        <DsButton
          v-if="!readOnly"
          variant="primary"
          small
          :disabled="generateBusy || !selectedRepoIds.length"
          @click="onGenerate"
        >
          {{ translate('okf.ragas.generate.button', 'Generate') }}
        </DsButton>
        <DsSpinner v-if="generateBusy" size="sm">
          {{ translate('okf.ragas.generate.working', 'Generating — this takes minutes…') }}
        </DsSpinner>
        <DsButton
          v-if="generateBusy && generatingKey"
          variant="secondary"
          small
          :disabled="cancelBusy"
          @click="onCancelGenerate"
        >
          {{ translate('okf.ragas.generate.cancel', 'Cancel') }}
        </DsButton>
        <DsSpinner v-if="cancelBusy" size="sm">
          {{ translate('okf.ragas.generate.cancelling', 'Cancelling…') }}
        </DsSpinner>
        <label v-if="!readOnly" class="okf-ragas__file-label">
          <input type="file" accept=".xlsx" :disabled="importBusy" @change="onImportFile" />
          <DsButton variant="secondary" small tag="span" :disabled="importBusy">
            {{ translate('okf.ragas.import.button', 'Import suite (.xlsx)') }}
          </DsButton>
        </label>
        <DsSpinner v-if="importBusy" size="sm">{{ translate('okf.ragas.import.working', 'Importing…') }}</DsSpinner>
      </div>
    </div>

    <p v-if="error" class="okf-headtest__error">{{ error }}</p>

    <!-- CURRENT SUITE -->
    <div v-if="suite" class="okf-ragas__section">
      <div class="okf-ragas__suite-head">
        <input
          class="okf-headtest__name-input okf-headtest__name-input--compact"
          type="text"
          :value="suite.name || ''"
          :placeholder="translate('okf.ragas.suite.namePlaceholder', 'Benchmark name (optional)')"
          :maxlength="80"
          :disabled="readOnly || busy !== null"
          @change="onRename($event.target.value)"
        />
        <code>{{ suite.suite_key }}</code>
        <DsPill variant="accent" label="RAGAS" />
        <span v-if="suite.payload && suite.payload.generator" class="okf-ragas__muted">{{
          suite.payload.generator
        }}</span>
      </div>

      <!-- metrics selection -->
      <div class="okf-ragas__metrics">
        <span class="okf-ragas__muted">{{ translate('okf.ragas.metrics.label', 'Metrics:') }}</span>
        <label v-for="m in metricChoices" :key="m.key" class="okf-ragas__metric">
          <input
            v-model="selectedMetrics"
            type="checkbox"
            :value="m.key"
            :disabled="m.default || readOnly || runBusy"
          />
          <span>{{ m.label }}</span>
        </label>
      </div>

      <div class="okf-ragas__actions">
        <DsButton v-if="!readOnly" variant="primary" small :disabled="runBusy" @click="onRun">
          {{ translate('okf.ragas.run.button', 'Run benchmark') }}
        </DsButton>
        <DsButton variant="secondary" small :disabled="exportBusy" @click="onExportSuite">
          {{ translate('okf.ragas.export.suite', 'Export suite (.xlsx)') }}
        </DsButton>
        <DsButton v-if="!readOnly" variant="secondary" small :disabled="runBusy" @click="onAddQuery">
          {{ translate('okf.ragas.suite.add', 'Add question') }}
        </DsButton>
        <DsSpinner v-if="runBusy" size="sm">
          {{ runProgressLabel }}
        </DsSpinner>
      </div>
      <div v-if="runProgress" class="okf-ragas__progress">
        <DsProgress :value="progressPct" />
      </div>

      <!-- ENTRIES TABLE (management parity) -->
      <table class="okf-headtest__scores okf-ragas__entries">
        <thead>
          <tr>
            <th>#</th>
            <th>{{ translate('okf.ragas.col.query', 'Question') }}</th>
            <th>{{ translate('okf.ragas.col.reference', 'Expected answer') }}</th>
            <th>{{ translate('okf.ragas.col.passages', 'Passages') }}</th>
            <th>{{ translate('okf.ragas.col.scope', 'Scope') }}</th>
            <th v-if="!readOnly"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in entries" :key="e.id">
            <td>
              <code>{{ e.id }}</code>
            </td>
            <td>
              <textarea
                class="okf-ragas__query-input"
                rows="2"
                :value="e.query"
                :disabled="readOnly || busy !== null"
                @change="onEditEntry(e, 'query', $event.target.value)"
              ></textarea>
            </td>
            <td>
              <textarea
                class="okf-ragas__query-input"
                rows="2"
                :value="e.reference_answer"
                :disabled="readOnly || busy !== null"
                @change="onEditEntry(e, 'reference_answer', $event.target.value)"
              ></textarea>
            </td>
            <td>{{ (e.reference_passages || []).length }}</td>
            <td>
              <DsPill
                :variant="e.oos ? 'warning' : 'success'"
                :label="e.oos ? translate('okf.ragas.oos', 'out-of-scope') : translate('okf.ragas.inscope', 'in scope')"
              />
            </td>
            <td v-if="!readOnly" class="okf-ragas__row-actions">
              <button
                type="button"
                class="okf-headtest__row-btn"
                :disabled="busy !== null"
                :title="translate('okf.ragas.suite.flipTip', 'Flip in-scope / out-of-scope')"
                @click="onFlipEntry(e)"
              >
                ⇄
              </button>
              <button
                type="button"
                class="okf-headtest__row-btn"
                :disabled="busy !== null || probeBusy === e.id"
                :title="translate('okf.ragas.suite.probeTip', 'Probe this question against the live corpus')"
                @click="onProbe(e)"
              >
                ▶
              </button>
              <span v-if="e.lastProbe" class="okf-ragas__muted" :title="(e.lastProbe && e.lastProbe.note) || ''">
                {{ e.lastProbe.verdict }}
              </span>
              <button
                type="button"
                class="okf-headtest__row-btn okf-headtest__row-btn--danger"
                :disabled="busy !== null"
                :title="translate('okf.ragas.suite.removeTip', 'Remove this question')"
                @click="onRemoveEntry(e)"
              >
                ×
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- RUN RESULTS -->
    <div v-if="runDoc && runDoc.payload" class="okf-ragas__section">
      <div class="okf-ragas__suite-head">
        <h4 class="okf-headtest__pane-title">
          {{ translate('okf.ragas.results.title', 'Benchmark results') }}
        </h4>
        <DsPill
          v-if="runDoc.payload.summary"
          :variant="runDoc.payload.summary.failing_count ? 'warning' : 'success'"
          :label="
            runDoc.payload.summary.failing_count
              ? translate('okf.ragas.results.failing', '{n} failing').replace(
                  '{n}',
                  String(runDoc.payload.summary.failing_count)
                )
              : translate('okf.ragas.results.allPass', 'all passing')
          "
        />
        <DsButton variant="secondary" small :disabled="pdfBusy" @click="downloadPdf">
          {{ translate('okf.ragas.results.pdf', 'Export PDF report') }}
        </DsButton>
        <DsButton variant="secondary" small :disabled="exportBusy" @click="onExportResults">
          {{ translate('okf.ragas.export.results', 'Export results (.xlsx)') }}
        </DsButton>
        <DsButton v-if="!readOnly" variant="secondary" small :disabled="explainBusy" @click="onExplain">
          {{ translate('okf.ragas.explain.button', 'Explain failures') }}
        </DsButton>
      </div>

      <!-- aggregate gauges -->
      <div v-if="aggregateRows.length" class="okf-ragas__gauges">
        <div v-for="g in aggregateRows" :key="g.key" class="okf-ragas__gauge">
          <apexchart
            :ref="'gauge-' + g.key"
            type="radialBar"
            height="160"
            :options="gaugeOptions(g)"
            :series="g.series"
          ></apexchart>
          <span class="okf-ragas__gauge-label">{{ g.label }}</span>
        </div>
      </div>

      <!-- trend across runs -->
      <div v-if="trendSeries.length" class="okf-ragas__trend">
        <apexchart ref="trendChart" type="line" height="200" :options="trendOptions" :series="trendSeries"></apexchart>
      </div>

      <!-- status stacked bar -->
      <div v-if="statusSeries.length" class="okf-ragas__status">
        <apexchart type="bar" height="120" :options="statusOptions" :series="statusSeries"></apexchart>
      </div>

      <!-- per-query table -->
      <table class="okf-headtest__scores">
        <thead>
          <tr>
            <th>#</th>
            <th>{{ translate('okf.ragas.col.query', 'Question') }}</th>
            <th v-for="m in runMetricKeys" :key="m">{{ metricLabel(m) }}</th>
            <th>{{ translate('okf.ragas.results.answer', 'Answer') }}</th>
            <th>{{ translate('okf.ragas.results.state', 'State') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in runRows" :key="r.id" :class="{ 'okf-ragas__row--fail': rowFails(r) }">
            <td>
              <code>{{ r.id }}</code>
            </td>
            <td class="okf-ragas__cell-query" :title="r.query">{{ r.query }}</td>
            <td v-for="m in runMetricKeys" :key="m">
              <span class="okf-headtest__bar"
                ><span :style="{ width: barWidth(r.metrics && r.metrics[m]) }"></span
              ></span>
              <span class="okf-ragas__score">{{ scoreText(r.metrics && r.metrics[m]) }}</span>
            </td>
            <td class="okf-ragas__cell-answer" :title="r.answer">{{ shortAnswer(r.answer) }}</td>
            <td>
              <DsPill v-if="r.error" variant="danger" :label="translate('okf.ragas.results.error', 'error')" />
              <DsPill
                v-else-if="r.abstained"
                variant="warning"
                :label="translate('okf.ragas.results.abstained', 'abstained')"
              />
              <DsPill v-else variant="neutral" :label="translate('okf.ragas.results.answered', 'answered')" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- EXPLAIN / ADVISE -->
    <div v-if="explainDoc" class="okf-ragas__section">
      <h4 class="okf-headtest__pane-title">
        {{ translate('okf.ragas.explain.title', 'Failure attribution and advice') }}
      </h4>
      <table v-if="explainDoc.attributions && explainDoc.attributions.length" class="okf-headtest__scores">
        <thead>
          <tr>
            <th>#</th>
            <th>{{ translate('okf.ragas.explain.stage', 'Stage') }}</th>
            <th>{{ translate('okf.ragas.explain.fails', 'Failing metrics') }}</th>
            <th>{{ translate('okf.ragas.explain.recommendation', 'Recommendation') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="a in explainDoc.attributions" :key="a.id">
            <td>
              <code>{{ a.id }}</code>
            </td>
            <td><DsPill variant="warning" :label="a.stage" /></td>
            <td>{{ (a.fails || []).join(', ') }}</td>
            <td>{{ a.recommendation }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="okf-ragas__muted">{{ translate('okf.ragas.explain.none', 'No failing rows to attribute.') }}</p>
      <div v-if="adviceChips.length" class="okf-headtest__suggestion">
        <div v-for="(chip, i) in adviceChips" :key="i" class="okf-ragas__advice-chip" :title="chip.title">
          <span class="okf-ragas__advice-kind">{{ chip.kind }}</span> {{ chip.text }}
        </div>
        <p v-if="explainDoc.advice && explainDoc.advice.note" class="okf-ragas__muted">{{ explainDoc.advice.note }}</p>
      </div>
    </div>

    <!-- RUN HISTORY -->
    <div v-if="runHistory.length" class="okf-ragas__section">
      <h4 class="okf-headtest__pane-title">{{ translate('okf.ragas.history.title', 'Run history') }}</h4>
      <table class="okf-headtest__scores">
        <thead>
          <tr>
            <th>{{ translate('okf.ragas.history.run', 'Run') }}</th>
            <th>{{ translate('okf.ragas.history.when', 'When') }}</th>
            <th>{{ translate('okf.ragas.history.status', 'Status') }}</th>
            <th v-for="m in historyMetricKeys" :key="m">{{ metricLabel(m) }}</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="h in runHistory"
            :key="h._key"
            :class="{ 'okf-ragas__row--selected': runDoc && h._key === runDoc._key }"
          >
            <td>
              <code>{{ h._key }}</code>
            </td>
            <td>{{ shortDate(h.created_at) }}</td>
            <td>
              <DsPill
                :variant="h.status === 'done' ? 'success' : h.status === 'failed' ? 'danger' : 'warning'"
                :label="h.status"
              />
            </td>
            <td v-for="m in historyMetricKeys" :key="m">
              {{ scoreText(h.summary && h.summary.metrics && h.summary.metrics[m]) }}
            </td>
            <td>
              <DsButton variant="secondary" small :disabled="runBusy" @click="onLoadRun(h._key, h.suite_key)">
                {{ translate('okf.ragas.history.load', 'View') }}
              </DsButton>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<script>
import DsButton from '../../ds/Button.vue';
import DsPill from '../../ds/Pill.vue';
import DsSpinner from '../../ds/Spinner.vue';
import DsProgress from '../../ds/Progress.vue';
import DsInfoTip from '../../ds/InfoTip.vue';
import translateMixin from '../../../mixins/translateMixin';
import { useChartTheme } from '@/composables/useChartTheme';

const DEFAULT_METRICS = ['faithfulness', 'context_precision', 'context_recall', 'answer_relevancy'];
const ALL_METRICS = [
  ...DEFAULT_METRICS,
  'context_utilization',
  'context_entities_recall',
  'factual_correctness',
  'answer_correctness',
  'answer_similarity',
  'noise_sensitivity'
];

export default {
  name: 'OkfRagasPanel',
  components: { DsButton, DsPill, DsSpinner, DsProgress, DsInfoTip },
  mixins: [translateMixin],
  props: {
    repo: { type: Object, default: null },
    readOnly: { type: Boolean, default: false },
    initialSuiteKey: { type: String, default: '' }
  },
  emits: ['changed'],
  data() {
    return {
      showHelp: false,
      repoChoices: [],
      selectedRepoIds: [],
      genSize: 20,
      distSingle: 50,
      distAbstract: 25,
      distSpecific: 25,
      genPersonas: 3,
      selectedMetrics: [...DEFAULT_METRICS],
      suite: null,
      runDoc: null,
      runHistory: [],
      explainDoc: null,
      error: '',
      busy: null, // shared write lock (the dialog's discipline)
      generateBusy: false,
      generatingKey: null, // suite_key of the in-flight generation (Cancel target)
      cancelBusy: false,
      runBusy: false,
      explainBusy: false,
      importBusy: false,
      exportBusy: false,
      pdfBusy: false,
      probeBusy: '',
      runProgress: null,
      suiteEpoch: 0
    };
  },
  computed: {
    /** The every-control reference rendered by the Help panel — titles and
     *  text straight from i18n so every locale carries the full glossary. */
    helpItems() {
      const keys = [
        'repositories',
        'questions',
        'singleHop',
        'multiAbstract',
        'multiSpecific',
        'personas',
        'generate',
        'importSuite',
        'entries',
        'metrics',
        'run',
        'results',
        'explain',
        'exports'
      ];
      return keys.map((k) => ({
        key: k,
        title: this.translate(`okf.ragas.help.${k}.title`, k),
        text: this.translate(`okf.ragas.help.${k}.text`, '')
      }));
    },
    entries() {
      return (this.suite && this.suite.payload && this.suite.payload.entries) || [];
    },
    metricChoices() {
      return ALL_METRICS.map((m) => ({ key: m, label: this.metricLabel(m), default: DEFAULT_METRICS.includes(m) }));
    },
    runMetricKeys() {
      return (this.runDoc && this.runDoc.metrics) || DEFAULT_METRICS;
    },
    historyMetricKeys() {
      const first = this.runHistory.find((h) => h.summary && h.summary.metrics);
      return (first && Object.keys(first.summary.metrics)) || DEFAULT_METRICS;
    },
    runRows() {
      return (this.runDoc && this.runDoc.payload && this.runDoc.payload.results) || [];
    },
    aggregateRows() {
      const metrics =
        (this.runDoc && this.runDoc.payload && this.runDoc.payload.summary && this.runDoc.payload.summary.metrics) ||
        {};
      return Object.entries(metrics)
        .filter(([, v]) => typeof v === 'number')
        .map(([key, v]) => ({ key, label: this.metricLabel(key), series: [Math.round(v * 100)] }));
    },
    trendSeries() {
      const history = [...this.runHistory].filter((h) => h.summary && h.summary.metrics).reverse();
      if (history.length < 1) return [];
      const keys = this.historyMetricKeys;
      return keys
        .map((m) => ({
          name: this.metricLabel(m),
          data: history.map((h) =>
            typeof h.summary.metrics[m] === 'number' ? Number(h.summary.metrics[m].toFixed(3)) : null
          )
        }))
        .filter((s) => s.data.some((v) => v !== null));
    },
    statusSeries() {
      const s = this.runDoc && this.runDoc.payload && this.runDoc.payload.summary;
      if (!s) return [];
      return [
        {
          name: this.translate('okf.ragas.results.answered', 'answered'),
          data: [(s.n_evaluable || 0) - (s.n_abstained || 0) - (s.failing_count || 0)]
        },
        { name: this.translate('okf.ragas.results.abstained', 'abstained'), data: [s.n_abstained || 0] },
        { name: this.translate('okf.ragas.results.failingShort', 'failing'), data: [s.failing_count || 0] },
        { name: this.translate('okf.ragas.results.error', 'error'), data: [s.n_errors || 0] }
      ];
    },
    progressPct() {
      const p = this.runProgress;
      if (!p || !p.total) return 0;
      return Math.min(100, Math.round((p.done / p.total) * 100));
    },
    runProgressLabel() {
      const p = this.runProgress;
      const phase = p && p.phase ? this.translate(`okf.ragas.run.phase.${p.phase}`, p.phase) : '';
      const counts = p ? ` ${p.done}/${p.total}` : '';
      return this.translate('okf.ragas.run.working', 'Running…') + (phase ? ` — ${phase}` : '') + counts;
    },
    adviceChips() {
      const advice = this.explainDoc && this.explainDoc.advice;
      if (!advice) return [];
      const chips = [];
      for (const k of advice.knob_changes || [])
        chips.push({ kind: this.translate('okf.ragas.advice.knob', 'knob'), text: k, title: k });
      for (const t of advice.repo_tag_changes || [])
        chips.push({ kind: this.translate('okf.ragas.advice.tag', 'repo tag'), text: t, title: t });
      for (const c of advice.content_curation || [])
        chips.push({
          kind: this.translate('okf.ragas.advice.content', 'content'),
          text: `${c.concept}: ${c.gap}`,
          title: c.gap
        });
      for (const p of advice.prompt_tweaks || [])
        chips.push({ kind: this.translate('okf.ragas.advice.prompt', 'prompt'), text: p, title: p });
      return chips;
    },
    trendOptions() {
      const t = useChartTheme().getCssVarStrings();
      return {
        chart: { toolbar: { show: false }, animations: { enabled: false } },
        theme: { mode: 'dark' },
        colors: t.chartColors,
        xaxis: {
          categories: [...this.runHistory]
            .filter((h) => h.summary && h.summary.metrics)
            .reverse()
            .map((h) => String(h.created_at || '').slice(5, 16)),
          labels: { style: { colors: t.fg } }
        },
        yaxis: { min: 0, max: 1, labels: { style: { colors: t.fg } } },
        stroke: { curve: 'straight', width: 2 }
      };
    },
    statusOptions() {
      const t = useChartTheme().getCssVarStrings();
      return {
        chart: { type: 'bar', stacked: true, toolbar: { show: false } },
        colors: t.chartColors,
        xaxis: { categories: [''], labels: { style: { colors: t.fg } } },
        legend: { labels: { colors: t.fg } },
        plotOptions: { bar: { horizontal: true } }
      };
    }
  },
  mounted() {
    this.selectedRepoIds = this.repo && this.repo.repo_id ? [this.repo.repo_id] : [];
    this.loadRepoChoices();
    if (this.initialSuiteKey) this.loadSuite(this.initialSuiteKey);
    else this.loadLatest();
  },
  methods: {
    metricLabel(m) {
      return this.translate(`okf.ragas.metric.${m}`, m.replace(/_/g, ' '));
    },
    barWidth(v) {
      return typeof v === 'number' && v === v ? `${Math.max(2, Math.min(100, Math.round(v * 100)))}%` : '0%';
    },
    scoreText(v) {
      return typeof v === 'number' && v === v ? v.toFixed(2) : '—';
    },
    shortAnswer(a) {
      const s = String(a || '');
      return s.length > 60 ? `${s.slice(0, 60)}…` : s;
    },
    shortDate(iso) {
      return String(iso || '')
        .slice(0, 16)
        .replace('T', ' ');
    },
    rowFails(r) {
      const s = this.runDoc && this.runDoc.payload && this.runDoc.payload.summary;
      if (!s) return false;
      return (s.failing || []).some((f) => f.id === r.id);
    },
    gaugeOptions(g) {
      const t = useChartTheme().getCssVarStrings();
      return {
        chart: { type: 'radialBar', sparkline: { enabled: true } },
        colors: [t.chartColors[Math.abs(g.key.length) % t.chartColors.length]],
        plotOptions: {
          radialBar: {
            hollow: { size: '55%' },
            dataLabels: {
              name: { show: false },
              value: { show: true, formatter: (v) => `${(Number(v) / 100).toFixed(2)}`, color: t.fg }
            }
          }
        }
      };
    },
    async loadRepoChoices() {
      const res = await this.$store.dispatch('okf/fetchRepos', { silent: true }).catch(() => null);
      const repos = (res && res.ok && res.repos) || [];
      this.repoChoices = repos
        .filter((r) => !this.repo || r.repo_id === this.repo.repo_id || r.head)
        .slice(0, 25)
        .map((r) => ({ repo_id: r.repo_id, name: r.name }));
    },
    async loadLatest() {
      const res = await this.$store.dispatch('okf/ragasListRuns', {
        repoId: this.repo && this.repo.repo_id,
        kind: 'all',
        limit: 20
      });
      if (!res.ok) return;
      this.runHistory = res.runs.filter((r) => r.kind === 'ragas_run');
      const latestSuite = res.runs.find((r) => r.kind === 'ragas_suite');
      if (latestSuite) this.loadSuite(latestSuite.suite_key || latestSuite._key);
      const latestRun = this.runHistory.find((r) => r.status === 'done');
      if (latestRun) this.onLoadRun(latestRun._key, latestRun.suite_key, { silent: true });
    },
    async loadSuite(suiteKey) {
      const epoch = ++this.suiteEpoch;
      const res = await this.$store.dispatch('okf/ragasGetSuite', {
        repoId: this.repo && this.repo.repo_id,
        suiteKey
      });
      if (epoch !== this.suiteEpoch) return;
      if (res.ok && res.result && res.result.kind === 'ragas_suite') {
        this.suite = res.result;
        this.selectedMetrics = [
          ...new Set([...DEFAULT_METRICS, ...((this.suite.payload && this.suite.payload.metrics_config) || [])])
        ];
        this.$emit('changed');
      }
    },
    async onGenerate() {
      this.error = '';
      this.generateBusy = true;
      try {
        const dist = [
          { synthesizer: 'single_hop_specific', weight: Number(this.distSingle) || 0 },
          { synthesizer: 'multi_hop_abstract', weight: Number(this.distAbstract) || 0 },
          { synthesizer: 'multi_hop_specific', weight: Number(this.distSpecific) || 0 }
        ].filter((d) => d.weight > 0);
        const res = await this.$store.dispatch('okf/ragasGenerate', {
          repoId: this.repo && this.repo.repo_id,
          options: {
            repo_ids: this.selectedRepoIds,
            testset_size: this.genSize,
            query_distribution: dist,
            num_personas: this.genPersonas
          },
          onStarted: (suiteKey) => {
            this.generatingKey = suiteKey;
          }
        });
        if (res.ok) {
          this.suite = res.result;
          this.$emit('changed');
        } else {
          this.error = res.message;
        }
      } finally {
        this.generateBusy = false;
        this.generatingKey = null;
        this.cancelBusy = false;
      }
    },
    async onCancelGenerate() {
      if (!this.generatingKey) return;
      this.cancelBusy = true;
      const res = await this.$store.dispatch('okf/ragasCancelGeneration', {
        repoId: this.repo && this.repo.repo_id,
        suiteKey: this.generatingKey
      });
      if (!res.ok) this.error = res.message;
      // On ok: nothing to do here — the ragasGenerate poll exits on its next
      // tick with RAGAS_JOB_CANCELLED and clears the busy state.
    },
    async onRename(name) {
      if (!this.suite || !name || !name.trim() || name === this.suite.name) return;
      const res = await this.$store.dispatch('okf/ragasRename', {
        repoId: this.repo && this.repo.repo_id,
        suiteKey: this.suite.suite_key,
        name: name.trim()
      });
      if (res.ok) this.suite = res.result;
      else this.error = res.message;
    },
    async onEditEntry(entry, field, value) {
      if (value === entry[field]) return;
      const res = await this.$store.dispatch('okf/ragasUpdateRows', {
        repoId: this.repo && this.repo.repo_id,
        suiteKey: this.suite.suite_key,
        payload: { modifications: [{ id: entry.id, [field]: value }] }
      });
      if (res.ok) this.suite = res.result;
      else this.error = res.message;
    },
    async onFlipEntry(entry) {
      const res = await this.$store.dispatch('okf/ragasUpdateRows', {
        repoId: this.repo && this.repo.repo_id,
        suiteKey: this.suite.suite_key,
        payload: { modifications: [{ id: entry.id, flip_oos: !entry.oos }] }
      });
      if (res.ok) this.suite = res.result;
      else this.error = res.message;
    },
    async onRemoveEntry(entry) {
      const res = await this.$store.dispatch('okf/ragasUpdateRows', {
        repoId: this.repo && this.repo.repo_id,
        suiteKey: this.suite.suite_key,
        payload: { remove_ids: [entry.id] }
      });
      if (res.ok) this.suite = res.result;
      else this.error = res.message;
    },
    async onAddQuery() {
      const query = window.prompt(this.translate('okf.ragas.suite.addPrompt', 'Question to add:'));
      if (!query || !query.trim()) return;
      const reference =
        window.prompt(this.translate('okf.ragas.suite.addReference', 'Expected answer (optional):')) || '';
      const res = await this.$store.dispatch('okf/ragasAddQueries', {
        repoId: this.repo && this.repo.repo_id,
        suiteKey: this.suite.suite_key,
        queries: [{ query: query.trim(), reference_answer: reference }]
      });
      if (res.ok) this.suite = res.result && res.result.suite ? res.result.suite : this.suite;
      else this.error = res.message;
    },
    async onProbe(entry) {
      this.probeBusy = entry.id;
      try {
        const res = await this.$store.dispatch('okf/ragasProbe', {
          repoId: this.repo && this.repo.repo_id,
          suiteKey: this.suite.suite_key,
          id: entry.id
        });
        if (res.ok) {
          const e = this.entries.find((x) => x.id === entry.id);
          if (e) e.lastProbe = res.result;
        } else {
          this.error = res.message;
        }
      } finally {
        this.probeBusy = '';
      }
    },
    async onRun() {
      this.error = '';
      this.runBusy = true;
      this.runProgress = { phase: 'retrieval', done: 0, total: this.entries.length };
      try {
        const res = await this.$store.dispatch('okf/ragasRun', {
          repoId: this.repo && this.repo.repo_id,
          suiteKey: this.suite.suite_key,
          metrics: this.selectedMetrics,
          onProgress: (p) => {
            this.runProgress = p;
          }
        });
        if (res.ok) {
          this.runDoc = res.result;
          await this.refreshHistory();
          this.$emit('changed');
        } else {
          this.error = res.message;
        }
      } finally {
        this.runBusy = false;
        this.runProgress = null;
      }
    },
    async refreshHistory() {
      const res = await this.$store.dispatch('okf/ragasListRuns', {
        repoId: this.repo && this.repo.repo_id,
        kind: 'all',
        limit: 20
      });
      if (res.ok) this.runHistory = res.runs.filter((r) => r.kind === 'ragas_run');
    },
    async onLoadRun(runKey, suiteKey, opts = {}) {
      if (suiteKey && (!this.suite || this.suite.suite_key !== suiteKey)) await this.loadSuite(suiteKey);
      const res = await this.$store
        .dispatch('okf/ragasGetRunQuiet', {
          repoId: this.repo && this.repo.repo_id,
          suiteKey: suiteKey || (this.suite && this.suite.suite_key),
          runKey
        })
        .catch(() => null);
      if (res && res.ok) this.runDoc = res.result;
      else if (!opts.silent && res) this.error = res.message;
    },
    async onExplain() {
      this.error = '';
      this.explainBusy = true;
      try {
        const res = await this.$store.dispatch('okf/ragasExplain', {
          repoId: this.repo && this.repo.repo_id,
          suiteKey: this.suite.suite_key,
          runKey: this.runDoc && this.runDoc._key
        });
        if (res.ok) this.explainDoc = res.result;
        else this.error = res.message;
      } finally {
        this.explainBusy = false;
      }
    },
    async onExportSuite() {
      this.exportBusy = true;
      try {
        const res = await this.$store.dispatch('okf/ragasExportSuite', {
          repoId: this.repo && this.repo.repo_id,
          suiteKey: this.suite.suite_key
        });
        if (res.ok) this.downloadBlob(res.data, `${this.suite.name || 'benchmark-suite'}.xlsx`);
        else this.error = res.message;
      } finally {
        this.exportBusy = false;
      }
    },
    async onExportResults() {
      this.exportBusy = true;
      try {
        const res = await this.$store.dispatch('okf/ragasExportResults', {
          repoId: this.repo && this.repo.repo_id,
          suiteKey: this.suite.suite_key,
          runKeys: this.runDoc && this.runDoc._key ? [this.runDoc._key] : this.runHistory.slice(0, 5).map((h) => h._key)
        });
        if (res.ok) this.downloadBlob(res.data, `benchmark-results-${this.suite.suite_key}.xlsx`);
        else this.error = res.message;
      } finally {
        this.exportBusy = false;
      }
    },
    async onImportFile(ev) {
      const file = ev.target.files && ev.target.files[0];
      ev.target.value = '';
      if (!file) return;
      this.importBusy = true;
      try {
        const buf = await file.arrayBuffer();
        const res = await this.$store.dispatch('okf/ragasImportSuite', {
          repoId: this.repo && this.repo.repo_id,
          arrayBuffer: buf
        });
        if (res.ok) {
          this.suite = res.result;
          this.$emit('changed');
        } else {
          this.error = res.message;
        }
      } finally {
        this.importBusy = false;
      }
    },
    downloadBlob(data, filename) {
      const blob = new Blob([data], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    },
    /** The PDF report: tables + gauge images, built client-side (jsPDF is
     * an existing dependency — no server-side rendering, per the spec). */
    async downloadPdf() {
      this.pdfBusy = true;
      try {
        const { jsPDF } = await import('jspdf');
        const doc = new jsPDF({ unit: 'pt', format: 'a4' });
        let y = 40;
        doc.setFontSize(16);
        doc.text(this.translate('okf.ragas.pdf.title', 'RAGAS benchmark report'), 40, y);
        y += 18;
        doc.setFontSize(9);
        doc.text(
          `${this.translate('okf.ragas.pdf.suite', 'Suite')}: ${this.suite ? this.suite.name || this.suite.suite_key : '—'}`,
          40,
          y
        );
        y += 12;
        doc.text(
          `${this.translate('okf.ragas.pdf.run', 'Run')}: ${this.runDoc ? this.runDoc._key : '—'}   ${this.runDoc ? this.shortDate(this.runDoc.created_at) : ''}`,
          40,
          y
        );
        y += 20;
        // summary
        const summary = (this.runDoc && this.runDoc.payload && this.runDoc.payload.summary) || {};
        doc.setFontSize(11);
        doc.text(this.translate('okf.ragas.pdf.summary', 'Summary'), 40, y);
        y += 14;
        doc.setFontSize(9);
        for (const [k, v] of Object.entries(summary.metrics || {})) {
          doc.text(`${this.metricLabel(k)}: ${this.scoreText(v)}`, 40, y);
          y += 12;
        }
        y += 6;
        // gauges as images
        for (const g of this.aggregateRows.slice(0, 4)) {
          const chart = this.$refs[`gauge-${g.key}`];
          const inst = chart && chart[0] && chart[0].chart;
          if (!inst) continue;
          try {
            const img = await inst.dataURI();
            doc.addImage(img.imgURI, 'PNG', 40, y, 110, 80);
            y += 88;
          } catch (e) {
            void e;
          }
          if (y > doc.internal.pageSize.getHeight() - 60) {
            doc.addPage();
            y = 40;
          }
        }
        // per-query table (text)
        doc.addPage();
        y = 40;
        doc.setFontSize(11);
        doc.text(this.translate('okf.ragas.pdf.perQuery', 'Per-question scores'), 40, y);
        y += 14;
        doc.setFontSize(8);
        const keys = this.runMetricKeys;
        doc.text(('# ' + keys.map((m) => this.metricLabel(m).slice(0, 10)).join('  ')).slice(0, 110), 40, y);
        y += 10;
        for (const r of this.runRows) {
          const line = `${r.id}  ${keys.map((m) => this.scoreText(r.metrics && r.metrics[m])).join('   ')}`;
          doc.text(line.slice(0, 110), 40, y);
          y += 10;
          if (y > doc.internal.pageSize.getHeight() - 40) {
            doc.addPage();
            y = 40;
          }
        }
        doc.save(`ragas-report-${(this.runDoc && this.runDoc._key) || 'suite'}.pdf`);
      } finally {
        this.pdfBusy = false;
      }
    }
  }
};
</script>

<style scoped>
.okf-ragas {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.okf-ragas__pane-head {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}

.okf-ragas__help-toggle {
  margin-left: auto;
  border: 0;
  background: transparent;
  color: var(--muted);
  font: inherit;
  font-size: var(--text-sm);
  text-decoration: underline;
  cursor: pointer;
  padding: 0 var(--space-xs);
}
.okf-ragas__help-toggle:hover,
.okf-ragas__help-toggle:focus {
  color: var(--accent);
}

.okf-ragas__help-list {
  margin: 0;
}
.okf-ragas__help-row {
  display: grid;
  grid-template-columns: 200px 1fr;
  gap: var(--space-sm);
  padding: var(--space-xs) 0;
  border-bottom: 1px solid var(--border);
}
.okf-ragas__help-row:last-child {
  border-bottom: 0;
}
.okf-ragas__help-row dt {
  font-weight: 600;
  color: var(--fg);
  font-size: var(--text-sm);
}
.okf-ragas__help-row dd {
  margin: 0;
  color: var(--muted);
  font-size: var(--text-sm);
  line-height: 1.5;
}
.okf-ragas__help-more {
  display: inline-block;
  margin-top: var(--space-sm);
  color: var(--accent);
  text-decoration: underline;
  font-size: var(--text-sm);
}
@media (max-width: 720px) {
  .okf-ragas__help-row {
    grid-template-columns: 1fr;
    gap: 2px;
  }
}

.okf-ragas__section {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 14px;
}

.okf-ragas__hint {
  color: var(--muted);
  font-size: 12px;
  margin: 4px 0 10px;
}

.okf-ragas__repos {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 18px;
  margin-bottom: 10px;
}

.okf-ragas__repo-row {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}

.okf-ragas__dims {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 10px;
}

.okf-ragas__dim {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 12px;
  color: var(--muted);
}

.okf-ragas__dim input {
  width: 90px;
}

.okf-ragas__actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.okf-ragas__file-label {
  position: relative;
  overflow: hidden;
  display: inline-flex;
}

.okf-ragas__file-label input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

.okf-ragas__suite-head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}

.okf-ragas__muted {
  color: var(--muted);
  font-size: 12px;
}

.okf-ragas__metrics {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}

.okf-ragas__metric {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
}

.okf-ragas__progress {
  margin: 8px 0;
}

.okf-ragas__entries textarea,
.okf-ragas__query-input {
  width: 100%;
  min-width: 220px;
  font: inherit;
  font-size: 12px;
  resize: vertical;
  background: transparent;
  color: inherit;
  border: 1px solid transparent;
  border-radius: 4px;
  padding: 2px 4px;
}

.okf-ragas__query-input:focus {
  border-color: var(--border);
}

.okf-ragas__row-actions {
  white-space: nowrap;
  display: flex;
  align-items: center;
  gap: 6px;
}

.okf-ragas__gauges {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  margin: 10px 0;
}

.okf-ragas__gauge {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.okf-ragas__gauge-label {
  font-size: 11px;
  color: var(--muted);
}

.okf-ragas__trend,
.okf-ragas__status {
  margin: 10px 0;
}

.okf-ragas__cell-query,
.okf-ragas__cell-answer {
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}

.okf-ragas__score {
  font-size: 11px;
  margin-left: 6px;
}

.okf-ragas__row--fail td {
  background: color-mix(in srgb, var(--danger, #c0392b) 10%, transparent);
}

.okf-ragas__row--selected td {
  background: color-mix(in srgb, var(--accent, #1f6feb) 12%, transparent);
}

.okf-ragas__advice-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 3px 10px;
  font-size: 12px;
  margin: 2px 6px 2px 0;
}

.okf-ragas__advice-kind {
  font-size: 10px;
  text-transform: uppercase;
  color: var(--muted);
}
</style>
