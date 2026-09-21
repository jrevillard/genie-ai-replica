<template>
  <div class="market-price-chart">
    <DsSpinner v-if="loading" overlay>
      <span>{{ $t('charts.loading', 'Loading data...') }}</span>
    </DsSpinner>

    <DsStateDisplay v-else-if="error" type="error" :message="error" />

    <DsStateDisplay v-else-if="!hasData" type="empty">
      {{ $t('charts.market.noData', 'No data available') }}
    </DsStateDisplay>

    <div v-else class="chart-content">
      <!-- Data caveats (visible, not buried — user requirement) -->
      <div v-if="caveatChips.length > 0 || freshnessLabel" class="caveat-row">
        <DsPill v-for="(chip, i) in caveatChips" :key="'caveat-' + i" :variant="chip.severity" class="caveat-chip">
          {{ chip.label }}
        </DsPill>
        <DsPill v-if="freshnessLabel" :variant="freshnessVariant" class="caveat-chip">
          {{ freshnessLabel }}
        </DsPill>
        <DsButton variant="ghost" small class="about-toggle" @click="showAbout = !showAbout">
          {{ $t('charts.caveats.aboutData', 'About this data') }}
        </DsButton>
      </div>

      <!-- About this data panel -->
      <DsCard v-if="showAbout" variant="flat" padding="md" class="about-panel">
        <div v-if="meta.source" class="about-row">
          <span class="about-label">{{ $t('charts.caveats.source', 'Source') }}:</span> {{ meta.source }}
        </div>
        <div v-if="meta.coverage" class="about-row">
          <span class="about-label">{{ $t('charts.caveats.coverage', 'Coverage') }}:</span> {{ meta.coverage }}
        </div>
        <div v-if="meta.estimation" class="about-row">
          <span class="about-label">{{ $t('charts.caveats.estimation', 'Estimates') }}:</span> {{ meta.estimation }}
        </div>
        <div v-if="meta.attribution" class="about-row about-attribution">{{ meta.attribution }}</div>
      </DsCard>

      <!-- Summary Cards -->
      <div class="summary-grid">
        <DsCard variant="elevated">
          <!-- Single commodity: one figure. Multi-commodity charts: the
               Latest card lists every plotted commodity with its own figure,
               color-matched to its line. -->
          <div v-if="activeSeries.length <= 1" class="summary-item">
            <span class="summary-label">{{ $t('charts.market.latest', 'Latest') }}</span>
            <strong class="summary-value" :title="primaryLatestTooltip" tabindex="0">{{ latestValue }}</strong>
            <span v-if="unit" class="summary-unit summary-unit--info" tabindex="0" :title="unitExplanation"
              >{{ unit }}
              <i class="fas fa-circle-info unit-info-icon" aria-hidden="true"></i>
            </span>
          </div>
          <div v-else class="summary-item summary-item--multi">
            <span class="summary-label">{{ $t('charts.market.latest', 'Latest') }}</span>
            <ul class="latest-list">
              <li v-for="item in latestBySeries" :key="item.name" class="latest-list__item">
                <span class="latest-list__dot" :style="{ background: item.color }" aria-hidden="true"></span>
                <span class="latest-list__name" :title="item.tip">{{ item.shortName }}</span>
                <strong class="latest-list__value" :title="item.tip">{{ item.value }}</strong>
              </li>
            </ul>
            <span v-if="unit" class="summary-unit summary-unit--info" tabindex="0" :title="unitExplanation"
              >{{ unit }}
              <i class="fas fa-circle-info unit-info-icon" aria-hidden="true"></i>
            </span>
          </div>
        </DsCard>

        <DsCard variant="elevated">
          <div class="summary-item">
            <span class="summary-label">{{ $t('charts.market.trend', 'Trend') }}</span>
            <strong class="summary-value">{{ trendLabel }}</strong>
            <DsPill :variant="trend === 'up' ? 'success' : trend === 'down' ? 'danger' : 'accent'">
              {{ trendLabel }}
            </DsPill>
          </div>
        </DsCard>
      </div>

      <!-- Get Predictions Button -->
      <DsButton variant="primary" class="predict-btn" @click="getPredictions">
        {{ $t('charts.market.getPredictions', 'Get AI Predictions') }}
      </DsButton>

      <!-- Series toggles: GLOBAL — one switch per commodity drives the
           chart, the data table and the CSV export together (user req
           2026-09-19). The last active series cannot be switched off. -->
      <div
        v-if="series.length > 1 && groupItems.length > 0"
        class="series-toggles series-toggles--groups"
        role="group"
        :aria-label="$t('charts.market.series', 'Series')"
      >
        <label v-for="g in groupItems" :key="g.word" class="series-group" :title="g.tip">
          <input
            type="checkbox"
            :checked="g.allOn"
            :indeterminate="g.someOn && !g.allOn"
            :disabled="g.disabled"
            @change="toggleGroup(g)"
          />
          {{ g.label }}
        </label>
      </div>
      <div
        v-if="series.length > 1"
        class="series-toggles"
        role="group"
        :aria-label="$t('charts.market.series', 'Series')"
      >
        <label v-for="item in toggleItems" :key="item.name" class="series-toggle" :title="item.tip">
          <input
            type="checkbox"
            :checked="!item.hidden"
            :disabled="item.lastActive"
            @change="toggleSeries(item.name)"
          />
          <span class="series-toggle__dot" :style="{ background: item.color }" aria-hidden="true"></span>
          <span class="series-toggle__name">{{ item.shortName }}</span>
        </label>
      </div>

      <!-- Price History Chart (dense series scroll horizontally — every
           data point stays neatly spaced instead of crowding). The start-year
           filter re-renders chart, table and CSV from the chosen year. -->
      <div class="section-header">
        <h3 class="section-title">{{ $t('charts.market.priceHistory', 'Price History') }}</h3>
        <div class="history-controls">
          <label class="history-controls__label" for="start-year-select">{{
            $t('charts.market.startYear', 'From')
          }}</label>
          <DsSelect id="start-year-select" v-model="startYear" class="history-controls__select">
            <option v-for="year in startYearOptions" :key="year" :value="year">{{ year }}</option>
          </DsSelect>
        </div>
      </div>
      <DsCard variant="elevated" padding="lg">
        <div ref="chartScroll" class="chart-scroll">
          <apexchart
            type="line"
            :height="chartHeight"
            :width="chartPixelWidth"
            :options="chartOptions"
            :series="chartSeries"
          />
        </div>
      </DsCard>

      <!-- Data Table (exportable — CSV opens in Excel/Sheets/LibreOffice) -->
      <div class="section-header">
        <h3 class="section-title">{{ $t('charts.market.dataTable', 'Data Table') }}</h3>
        <DsButton variant="secondary" small @click="exportCsv">
          <i class="fas fa-file-csv" aria-hidden="true"></i>
          {{ $t('charts.market.exportCsv', 'Export CSV') }}
        </DsButton>
      </div>
      <DsCard variant="flat" padding="none">
        <div class="table-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th>{{ $t('charts.market.period', 'Period') }}</th>
                <th v-for="s in visibleSeries" :key="s.name" :title="seriesHeaderTip(s)">
                  {{ dispName(s.name) }}
                </th>
                <th>{{ $t('charts.caveats.quality', 'Quality') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in tableRows" :key="row.date">
                <td>{{ row.date }}</td>
                <td v-for="(v, i) in row.values" :key="i" class="value-cell">{{ v === null ? '' : formatValue(v) }}</td>
                <td>
                  <span v-if="row.quality === 'estimated'" class="quality-estimated">
                    {{ $t('charts.caveats.estimated', 'Estimated') }}
                  </span>
                  <span v-else class="quality-actual">{{ $t('charts.caveats.actual', 'Actual') }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </DsCard>

      <p class="last-updated">{{ $t('charts.market.lastUpdated', 'Last updated') }}: {{ formatDate(lastUpdated) }}</p>
    </div>

    <!-- Prediction Input Dialog -->
    <DsModal
      :visible="showPredictionDialog"
      :title="$t('charts.market.getPredictions', 'Get AI Predictions')"
      size="lg"
      @close="closePredictionDialog"
    >
      <div class="prediction-form">
        <DsFormGroup :label="$t('charts.market.commodity', 'Commodity')">
          <strong>{{ commodityName }}</strong>
        </DsFormGroup>

        <DsFormGroup :label="$t('charts.market.selectTimeFrame', 'Select Prediction Time Frame')">
          <DsSelect v-model="selectedTimeFrame" input-id="timeframe-select">
            <option v-for="opt in timeFrameOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
          </DsSelect>
        </DsFormGroup>

        <DsFormGroup :label="$t('charts.market.worldNewsFactors', 'World News Factors (Optional)')">
          <DsInput
            v-model="worldNewsInput"
            type="textarea"
            :rows="3"
            :placeholder="$t('charts.market.worldNewsHint', 'E.g., Global supply chain issues, trade policies...')"
          />
          <div class="news-picker">
            <button type="button" class="news-picker__toggle" @click="toggleNewsPicker('global')">
              {{ $t('charts.news.addFromNews', 'Add from recent news') }}
              <span class="news-picker__count" v-if="newsGlobal.length">({{ newsGlobal.length }})</span>
            </button>
            <div v-if="newsPickerOpen === 'global'" class="news-picker__list">
              <DsSpinner v-if="newsLoading" size="sm" />
              <p v-else-if="newsGlobal.length === 0" class="news-picker__empty">
                {{ $t('charts.news.noItems', 'No recent items') }}
              </p>
              <label v-for="item in newsGlobal" :key="item.id || item.url" class="news-picker__item">
                <input v-model="selectedNewsGlobal" type="checkbox" :value="item" />
                <span class="news-picker__text">
                  <span class="news-picker__title">{{ item.title }}</span>
                  <span class="news-picker__meta">{{ item.source }} · {{ formatDate(item.publishedAt) }}</span>
                </span>
              </label>
              <DsButton v-if="selectedNewsGlobal.length > 0" variant="secondary" small @click="insertNews('global')">
                {{ $t('charts.news.insert', 'Insert selected') }}
              </DsButton>
            </div>
          </div>
        </DsFormGroup>

        <DsFormGroup :label="$t('charts.market.localNewsFactors', 'El Salvador News Factors (Optional)')">
          <DsInput
            v-model="localNewsInput"
            type="textarea"
            :rows="3"
            :placeholder="$t('charts.market.localNewsHint', 'E.g., Local regulations, weather events...')"
          />
          <div class="news-picker">
            <button type="button" class="news-picker__toggle" @click="toggleNewsPicker('local')">
              {{ $t('charts.news.addFromNews', 'Add from recent news') }}
              <span class="news-picker__count" v-if="newsLocal.length">({{ newsLocal.length }})</span>
            </button>
            <div v-if="newsPickerOpen === 'local'" class="news-picker__list">
              <DsSpinner v-if="newsLoading" size="sm" />
              <p v-else-if="newsLocal.length === 0" class="news-picker__empty">
                {{ $t('charts.news.noItems', 'No recent items') }}
              </p>
              <label v-for="item in newsLocal" :key="item.id || item.url" class="news-picker__item">
                <input v-model="selectedNewsLocal" type="checkbox" :value="item" />
                <span class="news-picker__text">
                  <span class="news-picker__title">{{ item.title }}</span>
                  <span class="news-picker__meta">{{ item.source }} · {{ formatDate(item.publishedAt) }}</span>
                </span>
              </label>
              <DsButton v-if="selectedNewsLocal.length > 0" variant="secondary" small @click="insertNews('local')">
                {{ $t('charts.news.insert', 'Insert selected') }}
              </DsButton>
            </div>
          </div>
        </DsFormGroup>
      </div>

      <template #footer>
        <DsButton variant="secondary" @click="closePredictionDialog">{{ $t('common.cancel', 'Cancel') }}</DsButton>
        <DsButton variant="secondary" @click="exportCsv">
          <i class="fas fa-file-csv" aria-hidden="true"></i>
          {{ $t('charts.market.exportCsv', 'Export CSV') }}
        </DsButton>
        <DsButton variant="primary" :disabled="isSubmittingPrediction" @click="submitPrediction">
          {{ $t('common.submit', 'Submit') }}
        </DsButton>
      </template>
    </DsModal>

    <!-- Prediction Loading Overlay -->
    <DsSpinner v-if="showPredictionLoading" overlay fixed size="lg">
      <span>{{ $t('charts.market.analyzing', 'Analyzing market data...') }}</span>
    </DsSpinner>

    <!-- Prediction Response Dialog -->
    <DsModal
      :visible="showResponseDialog"
      :title="`${$t('charts.market.predictionsFor', 'AI Predictions')}: ${commodityName}`"
      size="lg"
      @close="closeResponseDialog"
    >
      <div v-if="predictionResponse" class="prediction-response" v-html="renderedPrediction"></div>
      <span v-else>{{ $t('charts.market.noResponse', 'No response received') }}</span>

      <template #footer>
        <DsButton variant="secondary" @click="copyResponse">{{ $t('charts.market.copy', 'Copy') }}</DsButton>
        <DsButton variant="secondary" @click="shareViaEmail">{{ $t('charts.market.shareViaEmail', 'Email') }}</DsButton>
        <DsButton variant="primary" @click="closeResponseDialog">{{ $t('charts.market.close', 'Close') }}</DsButton>
      </template>
    </DsModal>
  </div>
</template>

<script>
import agriApiService from '../../services/agriApiService.js';
import { agriDateLocale, localizeFullName, localizeMeta, localizeSeriesName } from '../../utils/agri-i18n.js';
import chatbotService from '../../services/chatbotService.js';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { useChartTheme } from '../../composables/useChartTheme.js';
import DsButton from '../ds/Button.vue';
import DsCard from '../ds/Card.vue';
import DsFormGroup from '../ds/FormGroup.vue';
import DsInput from '../ds/Input.vue';
import DsModal from '../ds/Modal.vue';
import DsPill from '../ds/Pill.vue';
import DsSelect from '../ds/Select.vue';
import DsSpinner from '../ds/Spinner.vue';
import DsStateDisplay from '../ds/StateDisplay.vue';

const VALID_CATEGORIES = [
  'maize',
  'cropProtection',
  'vegetables',
  'livestock',
  'fertilizer',
  'apiary',
  'aquaculture',
  'harvestStorage'
];

export default {
  name: 'MarketPriceChart',
  components: { DsButton, DsCard, DsFormGroup, DsInput, DsModal, DsPill, DsSelect, DsSpinner, DsStateDisplay },
  props: {
    category: {
      type: String,
      required: true,
      validator: (v) => VALID_CATEGORIES.includes(v)
    },
    autoRefresh: { type: Boolean, default: false },
    refreshInterval: { type: Number, default: 300000 },
    userId: { type: String, default: 'anonymous' },
    sessionId: { type: String, default: 'market-price-session' }
  },
  setup() {
    const { theme, isDarkMode, getCssVarStrings } = useChartTheme({});
    return { theme, isDarkMode, getCssVarStrings };
  },
  data() {
    return {
      envelope: null,
      loading: true,
      error: null,
      refreshTimer: null,
      scrollWidth: 760, // measured from the chart container on mount/resize
      startYear: 2015, // history filter (user req 2026-09-19); clamped to data
      hiddenSeries: [], // series switched off by the global toggles
      showAbout: false,
      showPredictionDialog: false,
      showResponseDialog: false,
      showPredictionLoading: false,
      isSubmittingPrediction: false,
      selectedTimeFrame: '6 months',
      worldNewsInput: '',
      localNewsInput: '',
      predictionResponse: null,
      newsPickerOpen: null,
      newsLoading: false,
      newsGlobal: [],
      newsLocal: [],
      selectedNewsGlobal: [],
      selectedNewsLocal: []
    };
  },
  computed: {
    renderedPrediction() {
      if (!this.predictionResponse) return '';
      return DOMPurify.sanitize(marked.parse(this.predictionResponse));
    },
    meta() {
      const raw = (this.envelope && this.envelope.meta) || {};
      return localizeMeta(raw, this.uiLocale());
    },
    hasData() {
      return this.series.length > 0;
    },
    series() {
      return (this.envelope && this.envelope.data && this.envelope.data.series) || [];
    },
    primarySeries() {
      return this.visibleSeries[0] || { data: [], name: '', unit: '' };
    },
    /**
     * Series NOT switched off by the global toggles. Colors are keyed to a
     * series' ORIGINAL index so toggling never re-colors the survivors.
     */
    activeSeries() {
      return this.series.filter((s) => !this.hiddenSeries.includes(s.name));
    },
    /**
     * Short display names per series (legend, toggles, table headers) —
     * country-tagged only on base-name collisions, keeping 15-series
     * legends readable and non-overlapping.
     */
    seriesDisplayNames() {
      const bases = this.series.map((s) => localizeSeriesName(this.baseSeriesName(s.name), this.uiLocale()));
      const counts = bases.reduce((m, b) => m.set(b, (m.get(b) || 0) + 1), new Map());
      const out = {};
      this.series.forEach((s, i) => {
        let n = bases[i];
        if ((counts.get(bases[i]) || 0) > 1) {
          const tag = this.countryTag(s.name);
          if (tag) n += ` (${tag})`;
        }
        out[s.name] = n;
      });
      return out;
    },
    toggleItems() {
      const palette = this.seriesPalette;
      const activeCount = this.activeSeries.length;
      return this.series.map((s, i) => ({
        name: s.name,
        shortName: this.dispName(s.name),
        tip: `${localizeFullName(s.name, this.uiLocale())}${s.unit ? ` (${s.unit})` : ''}`,
        color: palette[i % palette.length],
        hidden: this.hiddenSeries.includes(s.name),
        lastActive: !this.hiddenSeries.includes(s.name) && activeCount === 1
      }));
    },
    /**
     * Commodity-TYPE master switches (user req 2026-09-19): one checkbox
     * per family — Beans, Maize, Rice, Sorghum, Wheat, Tomatoes… — toggling
     * every variety of that commodity at once. Only families with ≥2
     * series get one. States: checked = all on, unchecked = all off,
     * indeterminate = mixed.
     */
    groupItems() {
      const groups = new Map();
      for (const s of this.series) {
        // Family word comes from the LOCALIZED base so type-master labels
        // render "Frijol (5)" under es — grouping is 1:1 with the English
        // words because the name dictionary is injective.
        const word = (
          localizeSeriesName(this.baseSeriesName(s.name), this.uiLocale()).split(/\s+/)[0] || ''
        ).toLowerCase();
        if (!word) continue;
        if (!groups.has(word)) groups.set(word, []);
        groups.get(word).push(s.name);
      }
      const activeCount = this.activeSeries.length;
      const out = [];
      for (const [word, names] of groups.entries()) {
        if (names.length < 2) continue;
        const on = names.filter((n) => !this.hiddenSeries.includes(n));
        const allOn = on.length === names.length;
        // Turning the group off must not empty the chart
        const disabled = allOn && activeCount - on.length === 0;
        out.push({
          word,
          label: `${word[0].toUpperCase()}${word.slice(1)} (${names.length})`,
          names,
          tip: names.map((n) => localizeFullName(n, this.uiLocale())).join(', '),
          allOn,
          someOn: on.length > 0,
          disabled
        });
      }
      return out;
    },
    /**
     * Start-year filter (user req 2026-09-19): everything rendered — chart,
     * table, CSV — flows through visibleSeries. Options span the data set's
     * earliest year through (current year − 5); default 2015, clamped when
     * the data starts later.
     */
    earliestDataYear() {
      let min = null;
      for (const s of this.series) {
        for (const p of s.data || []) {
          const y = Number(String(p.date || '').slice(0, 4));
          if (Number.isFinite(y) && (min === null || y < min)) min = y;
        }
      }
      return min || new Date().getFullYear() - 5;
    },
    startYearOptions() {
      const first = this.earliestDataYear;
      const last = new Date().getFullYear() - 5;
      const years = [];
      for (let y = Math.max(first, last); y >= first; y -= 1) years.push(y);
      if (years.length === 0) years.push(first);
      return years;
    },
    visibleSeries() {
      const cutoff = `${this.startYear}-01-01`;
      // `idx` = the series' original slot in this.series — the spread COPY
      // would break indexOf()-based color lookup (found live 2026-09-19:
      // indexOf on copies returned -1 → undefined color → black markers).
      return this.activeSeries.map((s, idx) => ({ ...s, idx, data: (s.data || []).filter((p) => p.date >= cutoff) }));
    },
    categoryConfig() {
      const configs = {
        maize: { i18nKey: 'charts.market.maizeGrains', color: 'var(--success)' },
        cropProtection: { i18nKey: 'charts.market.cropProtection', color: 'var(--danger)' },
        vegetables: { i18nKey: 'charts.market.fruitsVeggies', color: 'var(--success)' },
        livestock: { i18nKey: 'charts.market.livestock', color: 'var(--muted)' },
        fertilizer: { i18nKey: 'charts.market.fertilizer', color: 'var(--warning)' },
        apiary: { i18nKey: 'charts.market.apiary', color: 'var(--warning)' },
        aquaculture: { i18nKey: 'charts.market.aquaculture', color: 'var(--info)' },
        harvestStorage: { i18nKey: 'charts.market.harvestStorage', color: 'var(--accent)' }
      };
      return configs[this.category] || {};
    },

    // Resolve var(--xxx) in cssVars to actual hex at render time. ApexCharts
    // builds SVG internally and does not always inherit CSS custom properties
    // from the host element. Re-resolved on theme change via useChartTheme.
    //
    // Use --fg (text color) directly for the series line: it gives guaranteed
    // contrast against --bg in both light and dark modes without introducing
    // new DS tokens. Per-category colors were too pale on dark bg.
    resolvedCssVars() {
      const raw = this.getCssVarStrings();
      const resolve = (val) => {
        if (typeof val !== 'string') return val;
        const match = val.match(/var\((--[a-z0-9-]+)\)/i);
        if (!match) return val;
        const v = getComputedStyle(document.documentElement).getPropertyValue(match[1]).trim();
        return v || val;
      };
      const resolved = {};
      for (const [k, val] of Object.entries(raw)) {
        if (Array.isArray(val)) {
          resolved[k] = val.map(resolve);
        } else {
          resolved[k] = resolve(val);
        }
      }
      return resolved;
    },

    resolvedCategoryColor() {
      // Override per-category color with --fg for guaranteed contrast in
      // both themes. Removes the pale-green-on-dark-bg issue.
      const v = getComputedStyle(document.documentElement).getPropertyValue('--fg').trim();
      return v || null;
    },
    commodityName() {
      return this.categoryConfig.i18nKey ? this.$t(this.categoryConfig.i18nKey) : this.category;
    },
    /** Localized category title for the prediction prompt header. */
    categoryTitle() {
      const key = this.categoryConfig && this.categoryConfig.i18nKey;
      return key ? this.$t(`charts.market.${String(key).split('.').pop()}`, key) : this.category;
    },
    timeSeries() {
      return this.primarySeries.data || [];
    },
    trend() {
      return (this.envelope && this.envelope.data && this.envelope.data.trend) || 'unknown';
    },
    unit() {
      // Prefer the primary series' unit; fall back to the envelope unit
      return this.primarySeries.unit || (this.envelope && this.envelope.data && this.envelope.data.unit) || '';
    },
    /** Calibration explanation for the Latest-card unit (mouse-over). */
    unitExplanation() {
      const u = this.unit.toLowerCase();
      if (u.includes('quintal')) {
        return this.$t(
          'charts.market.unitQuintal',
          'Prices are US dollars per quintal, the Central American farm-gate measure. 1 quintal = 46 kg; source data in USD/kg is converted at 45.97 kg per quintal.'
        );
      }
      if (u.includes('ppi')) {
        return this.$t(
          'charts.market.unitPpi',
          'US Producer Price Index for pesticide and agricultural chemical manufacturing (BLS). Index values are relative to a base period, not absolute prices — the trend shows input-cost direction, not a price level.'
        );
      }
      if (u.includes('index')) {
        return this.$t(
          'charts.market.unitIndex',
          'Index values are relative to a base period (for example 2016 = 100), not absolute prices — the trend shows direction and magnitude of change.'
        );
      }
      if (u.includes('%')) {
        return this.$t(
          'charts.market.unitPercent',
          'Percentage of production — a modeled regional statistic (FAO SDG 12.3.1), not an observed price.'
        );
      }
      if (u.includes('usd/kg')) {
        return this.$t('charts.market.unitUsdKg', 'US dollars per kilogram.');
      }
      if (u.includes('usd/mt')) {
        return this.$t(
          'charts.market.unitUsdMt',
          'US dollars per metric tonne (1,000 kg) — international benchmark markets.'
        );
      }
      if (u.includes('short ton')) {
        return this.$t('charts.market.unitShortTon', 'US dollars per short ton (907.18 kg) — US market convention.');
      }
      if (u.includes('usd/lb')) {
        return this.$t('charts.market.unitUsdLb', 'US dollars per pound (0.4536 kg).');
      }
      if (u.includes('usd/dozen')) {
        return this.$t('charts.market.unitDozen', 'US dollars per dozen.');
      }
      return this.$t('charts.market.unitGeneric', 'Unit of measurement for this series.');
    },
    lastUpdated() {
      return this.meta.fetchedAt || new Date().toISOString();
    },
    latestValue() {
      if (this.timeSeries.length === 0) return '--';
      const latest = this.timeSeries[this.timeSeries.length - 1];
      if (latest.value === null || latest.value === undefined) return '--';
      return this.formatValue(latest.value);
    },
    /** Chart line palette (index-matched to series order). */
    seriesPalette() {
      const cssVars = this.resolvedCssVars;
      return [
        this.resolvedCategoryColor || cssVars.accentColor,
        cssVars.warningColor || 'var(--warning)',
        cssVars.mutedColor,
        cssVars.infoColor || 'var(--info)',
        cssVars.dangerColor || 'var(--danger)'
      ];
    },
    /**
     * Per-commodity Latest figures for multi-commodity charts — each row
     * color-matched to its line so the card reads straight off the chart.
     */
    latestBySeries() {
      const palette = this.seriesPalette;
      const unitSuffix = this.unit ? ` ${this.unit}` : '';
      return this.activeSeries.map((s) => {
        const points = (s.data || []).filter((p) => Number.isFinite(p.value));
        const last = points[points.length - 1];
        const value = last ? this.formatValue(last.value) : '--';
        const origIdx = this.series.indexOf(s);
        return {
          name: s.name,
          shortName: this.dispName(s.name),
          value,
          color: palette[origIdx % palette.length],
          tip: this.$t('charts.market.latestTip', 'Latest month-end price of {name} — {value}{unit}', {
            name: localizeFullName(s.name, this.uiLocale()),
            value,
            unit: unitSuffix
          })
        };
      });
    },
    /** Explains the single-commodity Latest figure (user req 2026-09-19). */
    primaryLatestTooltip() {
      const primary = this.series[0];
      if (!primary) return '';
      return this.$t('charts.market.latestTip', 'Latest month-end price of {name} — {value}{unit}', {
        name: localizeFullName(primary.name, this.uiLocale()),
        value: this.latestValue,
        unit: this.unit ? ` ${this.unit}` : ''
      });
    },
    /**
     * Date-aligned table rows: the UNION of every visible series' dates.
     * Index alignment (old CSV) mislabels values once histories differ —
     * a 1960-start benchmark shifted against a 2005-start local series.
     */
    tableRows() {
      const maps = this.visibleSeries.map((s) => new Map((s.data || []).map((p) => [p.date, p])));
      const dates = new Set();
      for (const m of maps) for (const d of m.keys()) dates.add(d);
      const sorted = [...dates].sort();
      const primaryMap = maps[0] || new Map();
      return sorted.map((date) => ({
        date,
        values: maps.map((m) => {
          const p = m.get(date);
          return p && Number.isFinite(p.value) ? p.value : null;
        }),
        quality: (primaryMap.get(date) || {}).quality || 'actual'
      }));
    },
    trendLabel() {
      const map = {
        up: this.$t('charts.market.trendUp', 'Rising'),
        down: this.$t('charts.market.trendDown', 'Falling'),
        stable: this.$t('charts.market.trendStable', 'Stable'),
        unknown: this.$t('charts.market.trendUnknown', 'Unknown')
      };
      return map[this.trend] || map.unknown;
    },
    caveatChips() {
      const seen = new Set();
      const chips = [];
      for (const c of this.meta.caveats || []) {
        const label = this.caveatLabel(c);
        // Skip exact duplicates AND any caveat whose label collides with the
        // freshness pill (e.g. "Bundled snapshot" appears in both lists).
        if (this.freshnessLabel && label === this.freshnessLabel) continue;
        if (seen.has(label)) continue;
        seen.add(label);
        chips.push({
          label,
          severity: c.code === 'ESTIMATED_CPI' || c.code === 'PROXY_INDEX' ? 'warning' : 'info'
        });
      }
      return chips;
    },
    freshnessLabel() {
      if (!this.meta.fetchedAt) return '';
      const ageHours = (Date.now() - new Date(this.meta.fetchedAt).getTime()) / 3600000;
      if (this.meta.seeded) return this.$t('charts.caveats.bundledSnapshot', 'Bundled snapshot');
      if (this.meta.stale) {
        return this.$t('charts.caveats.savedDataAge', 'Saved data — {age} old', {
          age: this.humanizeAge(ageHours)
        });
      }
      return this.$t('charts.caveats.updatedAgo', 'Updated {age} ago', { age: this.humanizeAge(ageHours) });
    },
    freshnessVariant() {
      if (this.meta.stale || this.meta.seeded) return 'warning';
      return 'success';
    },
    timeFrameOptions() {
      return [
        { value: '3 months', label: this.$t('charts.market.timeFrame3Months', '3 months') },
        { value: '6 months', label: this.$t('charts.market.timeFrame6Months', '6 months') },
        { value: '1 year', label: this.$t('charts.market.timeFrame1Year', '1 year') },
        { value: '2 years', label: this.$t('charts.market.timeFrame2Years', '2 years') }
      ];
    },
    /** Points in the primary series — drives density behavior. */
    pointCount() {
      return this.timeSeries.length;
    },
    /** Dense charts (many points) render wide and scroll horizontally. */
    chartPixelWidth() {
      const minSpacing = 14; // px per data point — keeps markers readable
      return Math.max(this.scrollWidth, this.pointCount * minSpacing);
    },
    /** The panel sizes itself to the series count — fixed 320 px cropped
     *  multi-series charts (vegetables/fertilizer) at the top (user req
     *  2026-09-18). */
    chartHeight() {
      return Math.max(320, 240 + 45 * this.chartSeries.length);
    },
    chartOptions() {
      const cssVars = this.resolvedCssVars;
      const dense = this.pointCount > 300;

      // Group visible series by unit. Series stay in chartSeries order and
      // each group's series are contiguous (primary's group is built first),
      // so ApexCharts' INDEX mapping assigns yaxis[i] to the right series —
      // the `seriesName` array form is not supported by this ApexCharts
      // build and silently hid every array-bound series (vegetables showed
      // only Tomato after that mistake).
      const groups = [];
      for (const [idx, s] of this.chartSeries.entries()) {
        const unit = (s.unit || this.unit || '').toString();
        let g = groups.find((x) => x.unit === unit);
        if (!g) {
          g = { unit, seriesIdx: [], values: [] };
          groups.push(g);
        }
        g.seriesIdx.push(idx);
        for (const point of s.data) {
          if (point && point[1] !== null && point[1] !== undefined && Number.isFinite(point[1]))
            g.values.push(point[1]);
        }
      }
      const axisFor = (g) => {
        const minVal = g.values.length > 0 ? Math.min(...g.values) : 0;
        const maxVal = g.values.length > 0 ? Math.max(...g.values) : 1;
        const range = maxVal - minVal || 1;
        const step = Math.pow(10, Math.floor(Math.log10(range / 4))) || 1;
        const floor = Math.floor((minVal - range * 0.05) / step) * step;
        // USD axes get the $ marker on every tick (all price series are
        // USD-denominated — also El Salvador's own currency since 2001);
        // non-currency axes (index, %) stay bare
        const isUsd = /USD/i.test(g.unit || '');
        return {
          min: minVal >= 0 ? Math.max(0, floor) : floor,
          max: Math.round(maxVal * 1.5 * 100) / 100,
          labels: {
            style: { colors: cssVars.mutedColor },
            formatter: (v) => (isUsd && Number.isFinite(v) ? `$${this.formatAxisValue(v)}` : this.formatAxisValue(v))
          },
          // title must ALWAYS be a real object — `title: undefined` crashed
          // ApexCharts' getyAxisTitleCoords and blanked every single-unit
          // chart (found live 2026-09-18). Empty text renders nothing.
          title: {
            text: groups.length > 1 && g.unit ? g.unit : '',
            style: { color: cssVars.mutedColor, fontSize: '11px', fontWeight: 500 }
          }
        };
      };
      const yaxis = groups.map((g, i) => ({ ...axisFor(g), opposite: i > 0 }));
      // Tooltip lookup: series index → its unit group
      const groupOfSeries = new Map();
      groups.forEach((g, gi) => g.seriesIdx.forEach((i) => groupOfSeries.set(i, gi)));
      console.debug(
        `[MarketPriceChart:${this.category}] series=${this.chartSeries.length} groups=${groups.length}`,
        groups.map((g, i) => ({
          axis: i,
          unit: g.unit,
          series: g.seriesIdx.length,
          yMin: yaxis[i].min,
          yMax: yaxis[i].max
        }))
      );

      return {
        chart: {
          type: 'line',
          // Axis month/day names follow the UI language — ApexCharts ships
          // EN-only by default (i18n req 2026-09-19).
          locales: [
            {
              name: 'en',
              options: {
                months: [
                  'January',
                  'February',
                  'March',
                  'April',
                  'May',
                  'June',
                  'July',
                  'August',
                  'September',
                  'October',
                  'November',
                  'December'
                ],
                monthsShort: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
                days: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
                daysShort: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
              }
            },
            {
              name: 'es',
              options: {
                months: [
                  'Enero',
                  'Febrero',
                  'Marzo',
                  'Abril',
                  'Mayo',
                  'Junio',
                  'Julio',
                  'Agosto',
                  'Septiembre',
                  'Octubre',
                  'Noviembre',
                  'Diciembre'
                ],
                monthsShort: ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'],
                days: ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'],
                daysShort: ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
              }
            }
          ],
          defaultLocale: this.uiLocale() === 'es' ? 'es' : 'en',
          // Wheel-zoom + pan + native +/−/reset toolbar (user req 2026-09-18:
          // wheel users zoom, everyone needs buttons; pan is auto-selected so
          // drag scrolls the zoomed surface). autoScaleYaxis keeps each zoom
          // level reading true against the data in view.
          zoom: { enabled: true, type: 'x', autoScaleYaxis: true, allowMouseWheelZoom: true },
          toolbar: {
            show: true,
            tools: { zoom: false, zoomin: true, zoomout: true, pan: true, reset: true, download: false },
            autoSelected: 'pan'
          },
          // Dense charts animate 2000+ points through 30k px of scroll width —
          // the main-thread cost showed up as '[Violation] setTimeout' in the
          // browser log; animate only the light ones
          animations: dense ? { enabled: false } : { enabled: true, easing: 'easeinout', speed: 800 },
          background: 'transparent'
        },
        xaxis: {
          // True datetime axis: every series carries its own timestamps, so
          // mixed cadences (daily WFP + monthly benchmarks + annual trade
          // values) align by DATE instead of by array index — index mapping
          // made longer series overflow the primary's categories.
          // min pins the axis to the start-year filter (no leading padding,
          // no pre-filter history — user req 2026-09-19).
          type: 'datetime',
          min: new Date(`${this.startYear}-01-01T00:00:00Z`).getTime(),
          // Cap tick count to the scrollable pixel width so labels never crowd
          tickAmount: Math.max(4, Math.min(this.pointCount, Math.floor(this.chartPixelWidth / 90))),
          labels: {
            style: { fontSize: '11px', colors: cssVars.mutedColor },
            datetimeUTC: false,
            hideOverlappingLabels: true
          },
          axisBorder: { show: false },
          axisTicks: { show: false }
        },
        yaxis,
        // Palette is shared with the multi-commodity Latest card so chips
        // and lines stay color-matched. Per-series colorIdx keeps a series'
        // color STABLE when siblings are toggled off; the dashed estimated
        // overlay keeps the warning color. Index is normalized defensively —
        // a single undefined entry blanks every marker to black.
        colors: this.chartSeries.map((s) => {
          if (s.isEstimate) return cssVars.warningColor || 'var(--warning)';
          const i = Number.isInteger(s.colorIdx) && s.colorIdx >= 0 ? s.colorIdx : 0;
          return this.seriesPalette[i % this.seriesPalette.length];
        }),
        // Solid fill (light opacity) instead of gradient — the gradient
        // version made the line stroke appear to fade because ApexCharts
        // applies the fill opacity to the line border as well.
        fill: {
          type: 'solid',
          opacity: 0.15
        },
        // Width 4 for visibility; series 2 (estimated overlay) renders dashed
        stroke: { curve: 'smooth', width: 4, dashArray: [0, 6, 0, 0, 0] },
        markers: {
          // Dense series shrink markers to points; hover still enlarges
          size: dense ? 2 : 6,
          strokeColors: cssVars.backgroundColor,
          strokeWidth: dense ? 1 : 2,
          hover: { size: 7 }
        },
        // ApexCharts 'dark' theme uses hardcoded dark colors that don't contrast
        // well with our --bg in dark mode. Use 'light' (high contrast always)
        // and let the global DS-token CSS in theme-components.css override the
        // tooltip bg/text so it stays readable and theme-consistent.
        // Mouse-over shows BOTH the formatted date and the value (user req).
        tooltip: {
          x: {
            formatter: (val) =>
              this.formatTooltipDate(typeof val === 'number' ? new Date(val).toISOString().slice(0, 10) : val)
          },
          y: {
            formatter: (v, opts) => {
              const gi = groupOfSeries.get(opts && opts.seriesIndex !== undefined ? opts.seriesIndex : 0) || 0;
              const g = groups[gi];
              const unit = (g && g.unit) || this.unit || '';
              return `${this.formatValue(v)}${unit ? ` ${unit}` : ''}`;
            }
          }
        },
        grid: { borderColor: cssVars.gridColor, strokeDashArray: 4, strokeOpacity: 0.5 },
        legend: {
          show: this.series.length > 1,
          // Top-left, compact: 15-series bottom legends wrapped into an
          // overlapping mess (found live 2026-09-19)
          position: 'top',
          horizontalAlign: 'left',
          fontSize: '11px',
          markers: { size: 4, strokeWidth: 0 },
          itemMargin: { horizontal: 6, vertical: 2 },
          labels: { colors: cssVars.mutedColor }
        }
      };
    },
    chartSeries() {
      // [timestamp, value] pairs for the datetime axis — each series carries
      // its OWN dates so daily/monthly/annual cadences align by time, not by
      // array index. `unit` rides along for per-unit y-axes.
      const ts = (date) => {
        const s = String(date || '');
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T00:00:00Z`).getTime();
        if (/^\d{4}-\d{2}$/.test(s)) return new Date(`${s}-01T00:00:00Z`).getTime();
        if (/^\d{4}$/.test(s)) return new Date(`${s}-01-01T00:00:00Z`).getTime();
        const parsed = Date.parse(s);
        return Number.isFinite(parsed) ? parsed : null;
      };
      const primary = this.primarySeries;
      const actual = primary.data
        .map((d) => [ts(d.date), d.quality === 'estimated' ? null : d.value])
        .filter((p) => p[0] !== null);
      const estimated = primary.data
        .map((d) => [ts(d.date), d.quality === 'estimated' ? d.value : null])
        .filter((p) => p[0] !== null);

      const out = [
        {
          name: this.dispName(primary.name) || this.commodityName,
          data: actual,
          unit: primary.unit || this.unit,
          colorIdx: primary.idx ?? 0
        },
        {
          name: this.$t('charts.caveats.estimatedSeries', '{name} (estimated)', {
            name: this.dispName(primary.name) || this.commodityName
          }),
          data: estimated,
          unit: primary.unit || this.unit,
          isEstimate: true
        }
      ];
      // Skip empty estimated overlay when everything is actual
      if (!estimated.some((p) => p[1] !== null)) out.splice(1, 1);
      // Extras MUST flow through visibleSeries too — the unfiltered benchmark
      // (1960+) dragged the datetime axis back decades past the start-year
      // filter (found live 2026-09-19). No cap: grains carries 16 series
      // (every commodity the sources publish, user req 2026-09-19).
      for (const extra of this.visibleSeries.slice(1, 24)) {
        out.push({
          name: this.dispName(extra.name),
          data: extra.data.map((d) => [ts(d.date), d.value]).filter((p) => p[0] !== null),
          unit: extra.unit || this.unit,
          colorIdx: extra.idx ?? 0
        });
      }
      return out;
    }
  },
  watch: {
    // News language follows the selected UI locale — drop the cached lists
    // so the next picker open refetches in the new language (user req
    // 2026-09-18), reloading immediately when the picker is open.
    '$i18n.locale'() {
      this.newsGlobal = [];
      this.newsLocal = [];
      if (this.newsPickerOpen) this.loadNews();
    },
    // Keep the history filter inside the data set's real range once the
    // envelope loads (e.g. cropProtection starts 2024 — default 2015 clamps).
    earliestDataYear(year) {
      if (this.startYear < year) this.startYear = year;
    }
  },
  mounted() {
    this.measureScrollWidth();
    this.resizeHandler = () => this.measureScrollWidth();
    window.addEventListener('resize', this.resizeHandler);
    this.loadChartData();
    if (this.autoRefresh) {
      this.refreshTimer = setInterval(this.loadChartData, this.refreshInterval);
    }
  },
  beforeUnmount() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    if (this.resizeHandler) window.removeEventListener('resize', this.resizeHandler);
  },
  methods: {
    measureScrollWidth() {
      const el = this.$refs.chartScroll;
      if (el && el.clientWidth > 0) this.scrollWidth = el.clientWidth;
    },
    /** Global series switch (user req 2026-09-19): drives chart, table and
     *  CSV together. The last active series cannot be switched off. */
    toggleSeries(name) {
      if (this.hiddenSeries.includes(name)) {
        this.hiddenSeries = this.hiddenSeries.filter((n) => n !== name);
      } else if (this.activeSeries.length > 1) {
        this.hiddenSeries = [...this.hiddenSeries, name];
      }
    },
    /** Commodity-type master switch: if the whole family is on, switch it
     *  off; otherwise switch every member on. */
    toggleGroup(group) {
      if (group.allOn) {
        // guarded by :disabled when this would empty the chart
        this.hiddenSeries = [...new Set([...this.hiddenSeries, ...group.names])];
      } else {
        this.hiddenSeries = this.hiddenSeries.filter((n) => !group.names.includes(n));
      }
    },
    /** Compact commodity name: strips the [regional]/[converted] tags,
     *  benchmark parentheticals and the market qualifier after the first
     *  comma; repairs an unbalanced paren left by the comma cut. MUST live
     *  in methods — as a computed it broke rendering under this app's Vue
     *  compat mode (found live 2026-09-19). */
    baseSeriesName(name) {
      const raw = typeof name === 'string' ? name : '';
      let s = raw.replace(/\s*\[(regional|converted[^\]]*)\]/gi, '');
      s = s.replace(/\s*\([^)]*(?:intl|international|benchmark|fob|cif)[^)]*\)/gi, '');
      s = s.split(',')[0].trim();
      const opens = (s.match(/\(/g) || []).length;
      const closes = (s.match(/\)/g) || []).length;
      if (opens > closes) s = s.replace(/\s*\([^)]*$/, '').trim();
      return s || raw;
    },
    /** Short origin tag for disambiguating duplicate commodity names. */
    countryTag(fullName) {
      const f = String(fullName || '');
      if (/intl benchmark|US Gulf/i.test(f)) return 'intl';
      if (/San Salvador|El Salvador/i.test(f)) return 'SV';
      if (/Guatemala/i.test(f)) return 'GT';
      if (/Nicaragua/i.test(f)) return 'NIC';
      if (/Honduras/i.test(f)) return 'HN';
      if (/Costa Rica/i.test(f)) return 'CR';
      if (/Brazil/i.test(f)) return 'BR';
      if (/Middle East/i.test(f)) return 'ME';
      return '';
    },
    /** Display name for legend/toggles/table headers: short base, and a
     *  country tag ONLY when two series share a base ("Beans (red) (SV)"
     *  vs "Beans (red) (NIC)"). Full name stays on hover/title. */
    dispName(name) {
      return this.seriesDisplayNames[name] || this.baseSeriesName(name);
    },
    /** Human date for tooltips: daily, month-keyed and year-keyed periods. */
    formatTooltipDate(value) {
      if (value === null || value === undefined) return '';
      const s = String(value);
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        return new Date(`${s}T00:00:00`).toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'short',
          day: 'numeric'
        });
      }
      if (/^\d{4}-\d{2}$/.test(s)) {
        return new Date(`${s}-01T00:00:00`).toLocaleDateString(undefined, { year: 'numeric', month: 'long' });
      }
      return s;
    },
    toggleNewsPicker(scope) {
      this.newsPickerOpen = this.newsPickerOpen === scope ? null : scope;
      if (this.newsPickerOpen && !this.newsLoading && this.newsGlobal.length === 0 && this.newsLocal.length === 0) {
        this.loadNews();
      }
    },
    async loadNews() {
      this.newsLoading = true;
      try {
        // News language follows the selected UI locale (user req 2026-09-18)
        const locale = this.$i18n ? this.$i18n.locale : null;
        const [globalRes, localRes] = await Promise.all([
          agriApiService.getNews('global', locale),
          agriApiService.getNews('local', locale)
        ]);
        this.newsGlobal = (globalRes.data && globalRes.data.items) || [];
        this.newsLocal = (localRes.data && localRes.data.items) || [];
      } catch {
        // News is optional context — silent failure keeps the dialog usable
        this.newsGlobal = [];
        this.newsLocal = [];
      } finally {
        this.newsLoading = false;
      }
    },
    insertNews(scope) {
      const selected = scope === 'global' ? this.selectedNewsGlobal : this.selectedNewsLocal;
      if (selected.length === 0) return;
      const lines = selected.map((item) => {
        const date = item.publishedAt ? new Date(item.publishedAt).toLocaleDateString() : '';
        const snippet = item.snippet ? ` — ${item.snippet}` : '';
        return `[${item.title} — ${item.source}${date ? `, ${date}` : ''}]${snippet}`;
      });
      const target = scope === 'global' ? 'worldNewsInput' : 'localNewsInput';
      this[target] = this[target] ? `${this[target]}\n${lines.join('\n')}` : lines.join('\n');
      if (scope === 'global') {
        this.selectedNewsGlobal = [];
      } else {
        this.selectedNewsLocal = [];
      }
      this.newsPickerOpen = null;
    },
    /**
     * Download the table (and every plotted series) as CSV for spreadsheets.
     * One column per series — index-aligned exactly like the chart — plus a
     * Quality column for the primary series. UTF-8 BOM so Excel renders
     * accents; CRLF line endings for widest spreadsheet compatibility.
     */
    exportCsv() {
      if (!this.tableRows.length) return;
      const unit = this.unit ? ` (${this.unit})` : '';
      const esc = (v) => {
        const s = v === null || v === undefined ? '' : String(v);
        return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const header = [
        this.$t('charts.market.period', 'Period'),
        ...this.visibleSeries.map((s) => `${s.name || this.commodityName}${unit}`),
        this.$t('charts.caveats.quality', 'Quality')
      ];
      const lines = [header.map(esc).join(',')];
      // DATE-aligned rows (union of every visible series' dates) — index
      // alignment mislabeled values when histories start in different years.
      for (const row of this.tableRows) {
        lines.push(
          [
            row.date,
            ...row.values.map((v) => (v === null ? '' : v)),
            row.quality === 'estimated'
              ? this.$t('charts.caveats.estimated', 'Estimated')
              : this.$t('charts.caveats.actual', 'Actual')
          ]
            .map(esc)
            .join(',')
        );
      }
      const blob = new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `market-prices-${this.category}-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    },
    caveatLabel(c) {
      const key = `charts.caveats.codes.${c.code}`;
      const fallbacks = {
        REGIONAL_DATA: 'Regional data',
        ESTIMATED_CPI: 'Inflation-adjusted estimate',
        GAP_YEARS: 'Missing years',
        ANNUAL_ONLY: 'Annual data',
        SINGLE_MARKET: 'Single market',
        COMMUNITY_DATA: 'Community data',
        CURATED_STAT: 'Curated statistic',
        PROXY_INDEX: 'Proxy index',
        STALE_CACHE: 'Cached data'
      };
      const fallback = fallbacks[c.code] || c.code;
      const params = c.params || {};
      const label = this.$t(key, fallback);
      if (c.code === 'REGIONAL_DATA' && params.country) {
        return this.$t('charts.caveats.regionalWith', '{label}: {country}', {
          label: this.$t(key, fallback),
          country: params.country
        });
      }
      if (c.code === 'ESTIMATED_CPI' && params.years) {
        return this.$t('charts.caveats.estimatedWith', '{label} ({years})', {
          label: this.$t(key, fallback),
          years: params.years
        });
      }
      if (c.code === 'ANNUAL_ONLY' && params.lastYear) {
        return this.$t('charts.caveats.annualWith', '{label} (through {year})', {
          label: this.$t(key, fallback),
          year: params.lastYear
        });
      }
      return label;
    },
    humanizeAge(hours) {
      if (hours < 1) return this.$t('charts.caveats.ageMinutes', '{n} min', { n: Math.max(1, Math.round(hours * 60)) });
      if (hours < 48) return this.$t('charts.caveats.ageHours', '{n} h', { n: Math.round(hours) });
      return this.$t('charts.caveats.ageDays', '{n} d', { n: Math.round(hours / 24) });
    },
    formatValue(value) {
      if (value === null || value === undefined) return '--';
      if (this.category === 'aquaculture' && value >= 1000) return `${(value / 1000).toFixed(1)}K`;
      if (this.category === 'fertilizer' && value >= 100) return value.toFixed(0);
      if (['harvestStorage', 'cropProtection'].includes(this.category)) {
        return value >= 10 ? value.toFixed(1) : value.toFixed(2);
      }
      return value >= 100 ? value.toFixed(0) : value.toFixed(2);
    },
    formatAxisValue(value) {
      if (this.category === 'aquaculture' && value >= 1000) return `${(value / 1000).toFixed(0)}K`;
      return value >= 100 ? value.toFixed(0) : value.toFixed(1);
    },
    /** UI language ('en'|'es') — drives the data-layer localization. */
    uiLocale() {
      return (this.$i18n && this.$i18n.locale) || localStorage.getItem('userLocale') || 'en';
    },
    /** Table-header hover: full localized series name + unit. */
    seriesHeaderTip(s) {
      return `${localizeFullName(s.name, this.uiLocale())} (${s.unit || this.unit || 'n/a'})`;
    },
    formatDate(dateStr) {
      if (!dateStr) return '--';
      return new Date(dateStr).toLocaleDateString(agriDateLocale(this.uiLocale()));
    },
    async loadChartData() {
      this.loading = true;
      this.error = null;
      try {
        this.envelope = await agriApiService.getMarketPrices(this.category);
        // Debuggability: one line per load — what the backend actually sent
        const series = (this.envelope && this.envelope.data && this.envelope.data.series) || [];
        console.debug(
          `[MarketPriceChart:${this.category}] loaded ${series.length} series, ${series.reduce(
            (n, s) => n + (s.data || []).length,
            0
          )} points, unit=${this.unit}, stale=${!!(this.envelope.meta && this.envelope.meta.stale)}`,
          series.map((s) => ({ name: s.name, unit: s.unit, n: (s.data || []).length }))
        );
      } catch (err) {
        this.error = this.$t('charts.loadDataError', 'Failed to load data');
        console.error(`[MarketPriceChart:${this.category}] load failed:`, err);
      } finally {
        this.loading = false;
      }
    },
    /** The same caveats the user sees are injected into the AI prompt. */
    dataDisclosureText() {
      const lines = [];
      if (this.meta.coverage) lines.push(`Data coverage: ${this.meta.coverage}`);
      if (this.meta.estimation) lines.push(`Estimation note: ${this.meta.estimation}`);
      for (const chip of this.caveatChips) lines.push(`Caveat: ${chip.label}`);
      if (this.series.length > 1) {
        lines.push(`Series shown: ${this.series.map((s) => `${s.name} (${s.unit || 'n/a'})`).join('; ')}`);
      }
      return lines.join('\n');
    },
    getPredictions() {
      this.showPredictionDialog = true;
      this.worldNewsInput = '';
      this.localNewsInput = '';
      this.selectedTimeFrame = '6 months';
    },
    closePredictionDialog() {
      this.showPredictionDialog = false;
    },
    closeResponseDialog() {
      this.showResponseDialog = false;
      this.predictionResponse = null;
    },
    async submitPrediction() {
      this.isSubmittingPrediction = true;
      this.showPredictionDialog = false;
      this.showPredictionLoading = true;

      try {
        const disclosure = this.dataDisclosureText();
        // The prompt covers EXACTLY the commodities the user left selected
        // (series toggles + start-year filter), each with its own recent
        // month-end history — the AI must forecast per commodity, never a
        // category aggregate (user req 2026-09-19).
        const RECENT = 24; // month-end points per commodity (~2 years)
        const blocks = this.visibleSeries.map((s) => {
          const pts = (s.data || []).filter((p) => Number.isFinite(p.value)).slice(-RECENT);
          const hist = pts
            .map(
              (item) =>
                `  ${item.date}: ${this.formatValue(item.value)}${item.quality === 'estimated' ? ' (est.)' : ''}`
            )
            .join('\n');
          const last = pts[pts.length - 1];
          return {
            disp: this.dispName(s.name),
            full: s.name,
            unit: s.unit || this.unit,
            latest: last ? this.formatValue(last.value) : '--',
            hist
          };
        });
        const scopeList = blocks.map((b) => `${b.disp} — ${b.full}`).join('\n  ');
        const historySections = blocks
          .map((b) => `${b.disp} (unit: ${b.unit}; latest: ${b.latest}):\n${b.hist}`)
          .join('\n\n');
        const currentLanguage = this.$i18n ? this.$i18n.locale : localStorage.getItem('userLocale') || 'en';
        const currentDate = new Date();

        // News the user selected is MANDATORY context: the instructions
        // must tell the model to weave it into every commodity forecast.
        // (Regression: an earlier "ONLY on that commodity's own data"
        // instruction made the model discard the news and disclaim it.)
        const newsSections = [
          this.worldNewsInput
            ? `SELECTED WORLD NEWS FACTORS (recent events — you MUST reflect these in every commodity forecast):\n${this.worldNewsInput}`
            : '',
          this.localNewsInput
            ? `SELECTED LOCAL NEWS FACTORS (recent events — you MUST reflect these in every commodity forecast):\n${this.localNewsInput}`
            : ''
        ]
          .filter(Boolean)
          .join('\n\n');
        const hasNews = Boolean(newsSections);

        const prompt =
          currentLanguage === 'es'
            ? `Solicitud de Predicción de Precios de Mercado para El Salvador\n\nFecha: ${currentDate.getDate()}/${currentDate.getMonth() + 1}/${currentDate.getFullYear()}\n\nCategoría: ${this.categoryTitle}\nMarco Temporal: ${this.selectedTimeFrame}\n\nProductos en alcance (pronostique CADA UNO por separado):\n  ${scopeList}\n\nSituación actual e historial por producto:\n${historySections}\n\n${disclosure ? `Transparencia de Datos:\n${disclosure}\n\n` : ''}${newsSections ? `${newsSections}\n\n` : ''}Instrucciones:\n- Proporcione un análisis y predicción SEPARADOS para CADA producto del alcance, encabezados por su nombre.\n- NO agregue ni dé una cifra combinada para la categoría (p. ej., para Ganadería: predicciones separadas de RES y POLLO, nunca un número genérico de "ganado").\n- Combine el historial de precios de cada producto con los FACTORES DE NOTICIAS SELECCIONADOS de arriba: explique cómo esos eventos afectan el pronóstico de cada producto (oferta, demanda, precios). NO presente un pronóstico que ignore las noticias proporcionadas.\n- Base cada pronóstico en el historial de ese producto MÁS los factores de noticias seleccionados — nunca solo en el historial.\n- Trate los valores marcados "est." como estimaciones, no observaciones de mercado.
- LÍMITE DE LONGITUD (OBLIGATORIO): el canal de informes impone un límite estricto de tamaño y las respuestas largas se cortan a mitad de frase. Mantenga TODO el informe bajo ~350 palabras. NO reproduzca ni narre el historial proporcionado — como máximo una frase sobre la tendencia pasada. Sin introducción ni resumen final.
- FORMATO POR PRODUCTO: un encabezado de una línea; "Perspectiva:" 2-3 frases que integren las noticias seleccionadas; "Pronóstico:" cuatro proyecciones compactas de cierre de mes (p. ej. "2026-10: ~1,05 USD/quintal ↑"); "Riesgo:" una línea. Cuando haya más de 6 productos en el alcance, reduzca cada uno a un encabezado de una línea, UNA frase de perspectiva y las cuatro proyecciones.`
            : `Market Price Prediction Request for El Salvador\n\nDate: ${currentDate.getDate()}/${currentDate.getMonth() + 1}/${currentDate.getFullYear()}\n\nCategory: ${this.categoryTitle}\nTime Frame: ${this.selectedTimeFrame}\n\nCommodities in scope (forecast EACH separately):\n  ${scopeList}\n\nPer-commodity current status and history:\n${historySections}\n\n${disclosure ? `Data Transparency:\n${disclosure}\n\n` : ''}${newsSections ? `${newsSections}\n\n` : ''}Instructions:\n- Provide a SEPARATE forecast and analysis for EACH commodity in scope, each clearly headed by its name.\n- Do NOT aggregate or give a single combined figure for the category (e.g. for Livestock: separate BEEF and CHICKEN predictions — never one generic "livestock" number).\n- Weave the SELECTED NEWS FACTORS above into your analysis: for each commodity, explain how those events affect its forecast (supply, demand, prices). Do NOT present a forecast that ignores the provided news.\n- Base each commodity's forecast on its own price history PLUS the selected news factors — never on the history alone.\n- Treat values marked "(est.)" as estimates, not market observations.
- OUTPUT LENGTH LIMIT (MANDATORY): the reporting channel enforces a hard size cap and longer answers are truncated mid-sentence. Keep the WHOLE report under ~350 words. Do NOT reproduce or narrate the provided history — at most one sentence on the past trend. No introduction and no closing summary.
- PER-COMMODITY FORMAT: a one-line heading; "Outlook:" 2-3 sentences weaving in the selected news; "Forecast:" four compact month-end projections (e.g. "2026-10: ~1.05 USD/quintal ↑"); "Risk:" one line. When more than 6 commodities are in scope, reduce each commodity to a one-line heading, ONE outlook sentence and the four projections.${hasNews ? '' : '\n- No news factors were selected: state plainly that the forecast relies on price history only.'}`;

        const response = await chatbotService.submitQuery({
          userId: this.userId,
          sessionId: `${this.sessionId}-${this.category}-${Date.now()}`,
          messages: [{ role: 'user', content: prompt }],
          context: { language: currentLanguage.toUpperCase() },
          contextOption: 'simple-query'
        });

        this.predictionResponse = response.response || this.$t('charts.market.noResponse', 'No response received');
        this.showPredictionLoading = false;
        this.showResponseDialog = true;
      } catch (error) {
        this.predictionResponse = this.$t('charts.market.errorOccurred', 'An error occurred') + ': ' + error.message;
        this.showPredictionLoading = false;
        this.showResponseDialog = true;
      } finally {
        this.isSubmittingPrediction = false;
      }
    },
    copyResponse() {
      navigator.clipboard.writeText(this.predictionResponse || '').catch(console.error);
    },
    shareViaEmail() {
      const subject = `${this.commodityName} - ${this.$t('charts.market.predictionsFor', 'AI Predictions')}`;
      const body = encodeURIComponent(this.predictionResponse || '');
      window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${body}`;
    }
  }
};
</script>

<style scoped>
.market-price-chart {
  width: 100%;
}

/* Dense series scroll horizontally — every data point keeps ~14px of
   space instead of crowding into a static view. */
.chart-scroll {
  width: 100%;
  overflow-x: auto;
  overflow-y: hidden;
  -webkit-overflow-scrolling: touch;
}

.chart-content {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

/* Data Table heading row with the CSV export action */
.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
}

/* Start-year filter beside the Price History title */
.history-controls {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}

.history-controls__label {
  font-size: var(--text-xs);
  color: var(--muted);
}

.history-controls__select {
  min-width: 84px;
}

/* Multi-series data table scrolls horizontally when columns exceed width */
.table-scroll {
  width: 100%;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}

.table-scroll .data-table {
  min-width: 100%;
}

/* Global series toggles — one row of chip checkboxes above the chart */
.series-toggles {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: var(--space-sm);
}

/* Commodity-TYPE masters row (Beans/Maize/…) — visually distinct */
.series-toggles--groups {
  padding-bottom: 6px;
  border-bottom: 1px dashed var(--border);
}

.series-group {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--fg);
  cursor: pointer;
  user-select: none;
}

.series-toggle {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 0.72rem;
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm, 6px);
  padding: 3px 8px;
  cursor: pointer;
  user-select: none;
  max-width: 200px;
}

.series-toggle input {
  accent-color: var(--accent);
  margin: 0;
}

.series-toggle__dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex: 0 0 auto;
}

.series-toggle__name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Multi-commodity Latest list — one row per plotted series */
.latest-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 150px;
  overflow-y: auto;
}

.latest-list__item {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.latest-list__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: 0 0 auto;
}

.latest-list__name {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 0.8rem;
  color: var(--fg-muted, var(--muted));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.latest-list__value {
  flex: 0 0 auto;
  font-size: 0.9rem;
}

.caveat-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-xs);
}

.caveat-chip {
  font-size: var(--text-xs);
}

.about-toggle {
  margin-left: auto;
}

.about-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  font-size: var(--text-sm);
  color: var(--muted);
}

.about-row .about-label {
  font-weight: 600;
  color: var(--fg);
}

.about-attribution {
  font-size: var(--text-xs);
  color: var(--muted);
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--space-md);
}

.summary-item {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.summary-label {
  font-size: var(--text-sm);
  color: var(--muted);
}

.summary-value {
  font-size: var(--text-xl);
  color: var(--fg);
}

.summary-unit {
  font-size: var(--text-xs);
  color: var(--muted);
}

/* Unit chip carries a calibration explanation on hover/focus */
.summary-unit--info {
  cursor: help;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.unit-info-icon {
  font-size: 11px;
  opacity: 0.7;
}

.predict-btn {
  align-self: flex-start;
}

.section-title {
  margin: var(--space-sm) 0 0;
  font-size: var(--text-md);
  color: var(--fg);
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
}

.data-table th,
.data-table td {
  padding: var(--space-xs) var(--space-sm);
  text-align: left;
  border-bottom: 1px solid var(--border-light);
}

.data-table th {
  color: var(--muted);
  font-weight: 600;
}

.value-cell {
  font-family: var(--font-mono);
}

.quality-estimated {
  color: var(--warning);
  font-size: var(--text-xs);
}

.quality-actual {
  color: var(--muted);
  font-size: var(--text-xs);
}

.last-updated {
  font-size: var(--text-xs);
  color: var(--muted);
  margin: 0;
}

.news-picker {
  margin-top: var(--space-xs);
}

.news-picker__toggle {
  background: none;
  border: none;
  color: var(--accent);
  font-size: var(--text-xs);
  cursor: pointer;
  padding: 0;
}

.news-picker__toggle:hover {
  text-decoration: underline;
}

.news-picker__count {
  color: var(--muted);
}

.news-picker__list {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  margin-top: var(--space-xs);
  padding: var(--space-sm);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  max-height: 220px;
  overflow-y: auto;
}

.news-picker__item {
  display: flex;
  align-items: flex-start;
  gap: var(--space-xs);
  cursor: pointer;
}

.news-picker__text {
  display: flex;
  flex-direction: column;
}

.news-picker__title {
  font-size: var(--text-sm);
  color: var(--fg);
}

.news-picker__meta {
  font-size: var(--text-xs);
  color: var(--muted);
}

.news-picker__empty {
  font-size: var(--text-xs);
  color: var(--muted);
  margin: 0;
}

.prediction-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

.prediction-response {
  max-height: 70vh;
  overflow-y: auto;
  line-height: 1.6;
}

.prediction-response :deep(h1),
.prediction-response :deep(h2),
.prediction-response :deep(h3) {
  color: var(--fg);
  margin-top: var(--space-md);
}

.prediction-response :deep(ul),
.prediction-response :deep(ol) {
  padding-left: var(--space-lg);
}

@media (max-width: 640px) {
  .summary-grid {
    grid-template-columns: 1fr;
  }

  .about-toggle {
    margin-left: 0;
  }
}
</style>
