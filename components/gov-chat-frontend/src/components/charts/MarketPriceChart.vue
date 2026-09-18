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
          <div class="summary-item">
            <span class="summary-label">{{ $t('charts.market.latest', 'Latest') }}</span>
            <strong class="summary-value">{{ latestValue }}</strong>
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

      <!-- Price History Chart (dense series scroll horizontally — every
           data point stays neatly spaced instead of crowding) -->
      <h3 class="section-title">{{ $t('charts.market.priceHistory', 'Price History') }}</h3>
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
        <table class="data-table">
          <thead>
            <tr>
              <th>{{ $t('charts.market.period', 'Period') }}</th>
              <th>{{ $t('charts.market.value', 'Value') }}</th>
              <th>{{ $t('charts.caveats.quality', 'Quality') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(item, index) in timeSeries" :key="index">
              <td>{{ item.date }}</td>
              <td class="value-cell">{{ formatValue(item.value) }}</td>
              <td>
                <span v-if="item.quality === 'estimated'" class="quality-estimated">
                  {{ $t('charts.caveats.estimated', 'Estimated') }}
                </span>
                <span v-else class="quality-actual">{{ $t('charts.caveats.actual', 'Actual') }}</span>
              </td>
            </tr>
          </tbody>
        </table>
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
      return (this.envelope && this.envelope.meta) || {};
    },
    hasData() {
      return this.series.length > 0;
    },
    series() {
      return (this.envelope && this.envelope.data && this.envelope.data.series) || [];
    },
    primarySeries() {
      return this.series[0] || { data: [], name: '', unit: '' };
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
      return (this.meta.caveats || []).map((c) => ({
        label: this.caveatLabel(c),
        severity: c.code === 'ESTIMATED_CPI' || c.code === 'PROXY_INDEX' ? 'warning' : 'info'
      }));
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
      const seriesColor = this.resolvedCategoryColor || cssVars.accentColor;
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
          type: 'datetime',
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
        // Primary line uses the resolved --fg token (guaranteed contrast in
        // both themes); the remaining entries color the estimated overlay
        // and the secondary regional/benchmark series.
        colors: [
          seriesColor,
          cssVars.warningColor || 'var(--warning)',
          cssVars.mutedColor,
          cssVars.infoColor || 'var(--info)',
          cssVars.dangerColor || 'var(--danger)'
        ],
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
        legend: { show: this.series.length > 1, labels: { colors: cssVars.mutedColor } }
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
        { name: primary.name || this.commodityName, data: actual, unit: primary.unit || this.unit },
        {
          name: this.$t('charts.caveats.estimatedSeries', '{name} (estimated)', {
            name: primary.name || this.commodityName
          }),
          data: estimated,
          unit: primary.unit || this.unit
        }
      ];
      // Skip empty estimated overlay when everything is actual
      if (!estimated.some((p) => p[1] !== null)) out.splice(1, 1);
      for (const extra of this.series.slice(1, 4)) {
        out.push({
          name: extra.name,
          data: extra.data.map((d) => [ts(d.date), d.value]).filter((p) => p[0] !== null),
          unit: extra.unit || this.unit
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
      if (!this.timeSeries.length) return;
      const unit = this.unit ? ` (${this.unit})` : '';
      const esc = (v) => {
        const s = v === null || v === undefined ? '' : String(v);
        return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const header = [
        this.$t('charts.market.period', 'Period'),
        ...this.series.map((s) => `${s.name || this.commodityName}${unit}`),
        this.$t('charts.caveats.quality', 'Quality')
      ];
      const lines = [header.map(esc).join(',')];
      for (let i = 0; i < this.timeSeries.length; i += 1) {
        lines.push(
          [
            this.timeSeries[i].date,
            ...this.series.map((s) => (s.data[i] ? s.data[i].value : '')),
            this.timeSeries[i].quality === 'estimated'
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
    formatDate(dateStr) {
      if (!dateStr) return '--';
      return new Date(dateStr).toLocaleDateString();
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
        const historyData = this.timeSeries
          .map((item) => {
            const quality = item.quality === 'estimated' ? ' (est.)' : '';
            return `  ${item.date}: ${this.formatValue(item.value)}${quality}`;
          })
          .join('\n');
        const currentLanguage = this.$i18n ? this.$i18n.locale : localStorage.getItem('userLocale') || 'en';
        const currentDate = new Date();

        const prompt =
          currentLanguage === 'es'
            ? `Solicitud de Predicción de Precios de Mercado para El Salvador\n\nFecha: ${currentDate.getDate()}/${currentDate.getMonth() + 1}/${currentDate.getFullYear()}\n\nProducto: ${this.commodityName}\nMarco Temporal: ${this.selectedTimeFrame}\n\nDatos Actuales:\n• Último Valor: ${this.latestValue} ${this.unit}\n• Tendencia: ${this.trendLabel}\n\n${disclosure ? `Transparencia de Datos:\n${disclosure}\n\n` : ''}Datos Históricos:\n${historyData}\n\n${this.worldNewsInput ? `Factores Mundiales:\n${this.worldNewsInput}\n` : ''}${this.localNewsInput ? `Factores Locales:\n${this.localNewsInput}\n` : ''}Proporcione análisis y predicción para ${this.selectedTimeFrame}. Trate los valores marcados "est." como estimaciones, no observaciones de mercado.`
            : `Market Price Prediction Request for El Salvador\n\nDate: ${currentDate.getDate()}/${currentDate.getMonth() + 1}/${currentDate.getFullYear()}\n\nCommodity: ${this.commodityName}\nTime Frame: ${this.selectedTimeFrame}\n\nCurrent Data:\n• Latest: ${this.latestValue} ${this.unit}\n• Trend: ${this.trendLabel}\n\n${disclosure ? `Data Transparency:\n${disclosure}\n\n` : ''}Historical Data:\n${historyData}\n\n${this.worldNewsInput ? `World Factors:\n${this.worldNewsInput}\n` : ''}${this.localNewsInput ? `Local Factors:\n${this.localNewsInput}\n` : ''}Provide price forecast and analysis for ${this.selectedTimeFrame}. Treat values marked "(est.)" as estimates, not market observations.`;

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
  max-height: 50vh;
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
