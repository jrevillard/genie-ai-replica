<template>
  <div class="market-price-chart">
    <DsSpinner v-if="loading" overlay>
      <span>{{ $t('charts.loading', 'Loading data...') }}</span>
    </DsSpinner>

    <DsStateDisplay v-else-if="error" type="error" :message="error" />

    <DsStateDisplay v-else-if="!chartData || !chartData.data || chartData.data.length === 0" type="empty">
      {{ $t('charts.market.noData', 'No data available') }}
    </DsStateDisplay>

    <div v-else class="chart-content">
      <!-- Summary Cards -->
      <div class="summary-grid">
        <DsCard variant="elevated">
          <div class="summary-item">
            <span class="summary-label">{{ $t('charts.market.latest', 'Latest') }}</span>
            <strong class="summary-value">{{ latestValue }}</strong>
            <span v-if="unit" class="summary-unit">{{ unit }}</span>
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

      <!-- Source Badge -->
      <span v-if="chartData.dataSource" class="source-badge">{{ chartData.dataSource }}</span>

      <!-- Get Predictions Button -->
      <DsButton variant="primary" class="predict-btn" @click="getPredictions">
        {{ $t('charts.market.getPredictions', 'Get AI Predictions') }}
      </DsButton>

      <!-- Price History Chart -->
      <h3 class="section-title">{{ $t('charts.market.priceHistory', 'Price History') }}</h3>
      <DsCard variant="elevated" padding="lg">
        <apexchart type="line" height="300" :options="chartOptions" :series="chartSeries" />
      </DsCard>

      <!-- Data Table -->
      <h3 class="section-title">{{ $t('charts.market.dataTable', 'Data Table') }}</h3>
      <DsCard variant="flat" padding="none">
        <table class="data-table">
          <thead>
            <tr>
              <th>{{ $t('charts.market.year', 'Year') }}</th>
              <th>{{ $t('charts.market.value', 'Value') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(item, index) in timeSeries" :key="index">
              <td>{{ item.year }}</td>
              <td class="value-cell">{{ formatValue(item.value) }}</td>
            </tr>
          </tbody>
        </table>
      </DsCard>

      <p class="last-updated">
        {{ $t('charts.market.lastUpdated', 'Last updated') }}: {{ formatDate(lastUpdated) }}
      </p>
    </div>

    <!-- Prediction Input Dialog -->
    <DsModal :visible="showPredictionDialog" :title="$t('charts.market.getPredictions', 'Get AI Predictions')" size="lg" @close="closePredictionDialog">
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
        </DsFormGroup>

        <DsFormGroup :label="$t('charts.market.localNewsFactors', 'El Salvador News Factors (Optional)')">
          <DsInput
            v-model="localNewsInput"
            type="textarea"
            :rows="3"
            :placeholder="$t('charts.market.localNewsHint', 'E.g., Local regulations, weather events...')"
          />
        </DsFormGroup>
      </div>

      <template #footer>
        <DsButton variant="secondary" @click="closePredictionDialog">{{ $t('common.cancel', 'Cancel') }}</DsButton>
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
    <DsModal :visible="showResponseDialog" :title="`${$t('charts.market.predictionsFor', 'AI Predictions')}: ${commodityName}`" size="lg" @close="closeResponseDialog">
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
import worldBankService from '../../services/worldBankService.js';
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

const VALID_CATEGORIES = ['maize', 'cropProtection', 'vegetables', 'livestock', 'fertilizer', 'apiary', 'aquaculture', 'harvestStorage'];

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
      chartData: null,
      loading: true,
      error: null,
      refreshTimer: null,
      showPredictionDialog: false,
      showResponseDialog: false,
      showPredictionLoading: false,
      isSubmittingPrediction: false,
      selectedTimeFrame: '6 months',
      worldNewsInput: '',
      localNewsInput: '',
      predictionResponse: null
    };
  },
  computed: {
    renderedPrediction() {
      if (!this.predictionResponse) return '';
      return DOMPurify.sanitize(marked.parse(this.predictionResponse));
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
    commodityName() {
      return this.categoryConfig.i18nKey ? this.$t(this.categoryConfig.i18nKey) : this.category;
    },
    timeSeries() {
      return this.chartData?.data || [];
    },
    trend() {
      return this.chartData?.trend || 'unknown';
    },
    unit() {
      return this.chartData?.unit || '';
    },
    lastUpdated() {
      return this.chartData?.lastUpdated || new Date().toISOString();
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
    timeFrameOptions() {
      return [
        { value: '3 months', label: this.$t('charts.market.timeFrame3Months', '3 months') },
        { value: '6 months', label: this.$t('charts.market.timeFrame6Months', '6 months') },
        { value: '1 year', label: this.$t('charts.market.timeFrame1Year', '1 year') },
        { value: '2 years', label: this.$t('charts.market.timeFrame2Years', '2 years') }
      ];
    },
    chartOptions() {
      const years = this.timeSeries.map((d) => d.year);
      const values = this.timeSeries.map((d) => d.value);
      const minVal = Math.min(...values);
      const maxVal = Math.max(...values);
      const range = maxVal - minVal || 1;
      const cssVars = this.getCssVarStrings();

      return {
        chart: { type: 'line', toolbar: { show: false }, animations: { enabled: true, easing: 'easeinout', speed: 800 }, background: 'transparent' },
        xaxis: {
          categories: years,
          labels: { rotate: -45, style: { fontSize: '11px', colors: cssVars.mutedColor } },
          axisBorder: { show: false },
          axisTicks: { show: false }
        },
        yaxis: {
          min: Math.floor((minVal - range * 0.05) / 10) * 10,
          max: Math.ceil((maxVal + range * 0.05) / 10) * 10,
          labels: { style: { colors: cssVars.mutedColor }, formatter: (v) => this.formatAxisValue(v) }
        },
        colors: [this.categoryConfig.color || cssVars.accentColor],
        stroke: { curve: 'smooth', width: 3 },
        fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.5, opacityTo: 0.1, stops: [0, 90, 100] } },
        markers: { size: 6, colors: [this.categoryConfig.color || cssVars.accentColor], strokeColors: cssVars.backgroundColor, strokeWidth: 2 },
        tooltip: { y: { formatter: (v) => this.formatValue(v) }, theme: this.isDarkMode ? 'dark' : 'light' },
        grid: { borderColor: cssVars.gridColor, strokeDashArray: 4, strokeOpacity: 0.5 }
      };
    },
    chartSeries() {
      return [{ name: this.commodityName, data: this.timeSeries.map((d) => d.value) }];
    }
  },
  mounted() {
    this.loadChartData();
    if (this.autoRefresh) {
      this.refreshTimer = setInterval(this.loadChartData, this.refreshInterval);
    }
  },
  beforeUnmount() {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
  },
  methods: {
    formatValue(value) {
      if (value === null || value === undefined) return '--';
      if (this.category === 'aquaculture') return value >= 1000 ? `${(value / 1000).toFixed(1)}K` : value.toFixed(0);
      if (this.category === 'fertilizer') return value.toFixed(0);
      if (['harvestStorage', 'cropProtection'].includes(this.category)) return `${value.toFixed(1)}%`;
      return value.toFixed(0);
    },
    formatAxisValue(value) {
      if (this.category === 'aquaculture' && value >= 1000) return `${(value / 1000).toFixed(0)}K`;
      return value.toFixed(0);
    },
    formatDate(dateStr) {
      return new Date(dateStr).toLocaleDateString();
    },
    async loadChartData() {
      this.loading = true;
      this.error = null;
      try {
        const loaders = {
          maize: () => worldBankService.getMaizePrices(),
          cropProtection: () => worldBankService.getCropProtectionCosts(),
          vegetables: () => worldBankService.getVegetablePrices(),
          livestock: () => worldBankService.getPoultryPorkFeedCosts(),
          fertilizer: () => worldBankService.getFertilizerPrices(),
          apiary: () => worldBankService.getHoneyMarketData(),
          aquaculture: () => worldBankService.getTilapiaMarketData(),
          harvestStorage: () => worldBankService.getHarvestStorageData()
        };
        const loader = loaders[this.category];
        if (loader) this.chartData = await loader();
      } catch (err) {
        this.error = this.$t('charts.loadDataError', 'Failed to load data');
        console.error('Error loading market price data:', err);
      } finally {
        this.loading = false;
      }
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
        const historyData = this.timeSeries.map((item) => `  ${item.year}: ${this.formatValue(item.value)}`).join('\n');
        const currentLanguage = localStorage.getItem('preferredLanguage') || 'en';
        const currentDate = new Date();

        const prompt = currentLanguage === 'es'
          ? `Solicitud de Predicción de Precios de Mercado para El Salvador\n\nFecha: ${currentDate.getDate()}/${currentDate.getMonth() + 1}/${currentDate.getFullYear()}\n\nProducto: ${this.commodityName}\nMarco Temporal: ${this.selectedTimeFrame}\n\nDatos Actuales:\n• Último Valor: ${this.latestValue} ${this.unit}\n• Tendencia: ${this.trendLabel}\n\nDatos Históricos:\n${historyData}\n\n${this.worldNewsInput ? `Factores Mundiales:\n${this.worldNewsInput}\n` : ''}${this.localNewsInput ? `Factores Locales:\n${this.localNewsInput}\n` : ''}\nProporcione análisis y predicción para ${this.selectedTimeFrame}.`
          : `Market Price Prediction Request for El Salvador\n\nDate: ${currentDate.getDate()}/${currentDate.getMonth() + 1}/${currentDate.getFullYear()}\n\nCommodity: ${this.commodityName}\nTime Frame: ${this.selectedTimeFrame}\n\nCurrent Data:\n• Latest: ${this.latestValue} ${this.unit}\n• Trend: ${this.trendLabel}\n\nHistorical Data:\n${historyData}\n\n${this.worldNewsInput ? `World Factors:\n${this.worldNewsInput}\n` : ''}${this.localNewsInput ? `Local Factors:\n${this.localNewsInput}\n` : ''}\nProvide price forecast and analysis for ${this.selectedTimeFrame}.`;

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
  position: relative;
  width: 100%;
}

.summary-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-md);
  margin-bottom: var(--space-md);
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
}

.summary-unit {
  font-size: var(--text-xs);
  color: var(--muted);
}

.source-badge {
  display: inline-block;
  font-size: var(--text-xs);
  color: var(--muted);
  background: var(--accent-muted);
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-sm);
  margin-bottom: var(--space-md);
}

.predict-btn {
  display: block;
  width: 100%;
  margin-bottom: var(--space-lg);
}

.section-title {
  margin: var(--space-lg) 0 var(--space-md);
  font-size: var(--text-md);
  color: var(--fg);
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
}

.data-table th {
  text-align: left;
  padding: var(--space-sm) var(--space-md);
  color: var(--muted);
  border-bottom: 1px solid var(--border);
  font-weight: 600;
}

.data-table td {
  padding: var(--space-sm) var(--space-md);
  border-bottom: 1px solid var(--border-light);
}

.value-cell {
  font-weight: 600;
}

.last-updated {
  margin-top: var(--space-md);
  font-size: var(--text-xs);
  color: var(--muted);
}

.prediction-form {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

.prediction-response {
  line-height: 1.6;
  color: var(--fg);
}

.prediction-response :deep(h1),
.prediction-response :deep(h2),
.prediction-response :deep(h3) {
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
}
</style>
