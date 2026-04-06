<template>
  <div class="market-price-chart">
    <!-- Loading State -->
    <div v-if="loading" class="loading-indicator">
      <i class="fas fa-spinner fa-spin"></i>
      <span>{{ translate('charts.loading', 'Loading data...') }}</span>
    </div>

    <!-- Error State -->
    <div v-else-if="error" class="error-message">
      <i class="fas fa-exclamation-triangle"></i>
      <span>{{ error }}</span>
    </div>

    <!-- No Data State -->
    <div v-else-if="!chartData || !chartData.data || chartData.data.length === 0" class="no-data">
      <i class="fas fa-chart-line"></i>
      <span>{{ translate('charts.market.noData', 'No data available') }}</span>
    </div>

    <!-- Chart Content -->
    <div v-else class="chart-content">
      <!-- Summary Cards -->
      <div class="summary-cards">
        <div class="summary-card latest-card">
          <div class="summary-icon" :style="{ background: `${categoryColor}20` }">
            <i class="fas fa-chart-line" :style="{ color: categoryColor }"></i>
          </div>
          <div class="summary-content">
            <div class="summary-label">{{ translate('charts.market.latest', 'Latest') }}</div>
            <div class="summary-value" :style="{ color: categoryColor }">
              {{ latestValue }}
            </div>
            <div v-if="unit" class="summary-unit">{{ unit }}</div>
          </div>
        </div>

        <div class="summary-card trend-card">
          <div class="summary-icon" :class="`trend-${trend}`">
            <i :class="trendIcon"></i>
          </div>
          <div class="summary-content">
            <div class="summary-label">{{ translate('charts.market.trend', 'Trend') }}</div>
            <div class="summary-value" :class="`trend-${trend}`">
              {{ trendLabel }}
            </div>
          </div>
        </div>
      </div>

      <!-- Source Badge -->
      <div v-if="chartData.dataSource" class="source-badge">
        <span>{{ chartData.dataSource }}</span>
      </div>

      <!-- Get Predictions Button -->
      <button
        class="predict-btn"
        :style="{ background: categoryColor }"
        @click="getPredictions"
      >
        <i class="fas fa-brain"></i>
        <span>{{ translate('charts.market.getPredictions', 'Get AI Predictions') }}</span>
      </button>

      <!-- Chart Title -->
      <h3 class="chart-title">{{ translate('charts.market.priceHistory', 'Price History') }}</h3>

      <!-- Line Chart -->
      <div class="line-chart-container">
        <apexchart
          type="line"
          height="300"
          :options="chartOptions"
          :series="chartSeries"
        ></apexchart>
      </div>

      <!-- Data Table -->
      <h3 class="chart-title">{{ translate('charts.market.dataTable', 'Data Table') }}</h3>
      <div class="data-table-container">
        <table class="data-table">
          <thead>
            <tr>
              <th>{{ translate('charts.market.year', 'Year') || 'Year' }}</th>
              <th>{{ translate('charts.market.value', 'Value') || 'Value' }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(item, index) in timeSeries" :key="index">
              <td>{{ item.year }}</td>
              <td class="value-cell" :style="{ color: categoryColor }">
                {{ formatValue(item.value) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Last Updated -->
      <div class="last-updated">
        <i class="fas fa-clock"></i>
        {{ translate('charts.market.lastUpdated', 'Last updated') }}:
        {{ formatDate(lastUpdated) }}
      </div>
    </div>

    <!-- Prediction Input Dialog -->
    <div v-if="showPredictionDialog" class="dialog-overlay" @click.self="closePredictionDialog">
      <div class="dialog-container prediction-dialog" @click.stop>
        <div class="dialog-header">
          <div class="dialog-title">
            <i class="fas fa-brain"></i>
            <span>{{ translate('charts.market.getPredictions', 'Get AI Predictions') }}</span>
          </div>
          <button class="close-btn" @click="closePredictionDialog">
            <i class="fas fa-times"></i>
          </button>
        </div>
        <div class="dialog-body">
          <div class="prediction-section">
            <label class="dialog-label">{{ commodityName }}</label>
          </div>

          <div class="prediction-section">
            <label class="dialog-label">{{ translate('charts.market.selectTimeFrame', 'Select Prediction Time Frame') }}</label>
            <div class="timeframe-options">
              <button
                v-for="option in timeFrameOptions"
                :key="option.value"
                class="timeframe-btn"
                :class="{ active: selectedTimeFrame === option.value }"
                @click="selectedTimeFrame = option.value"
              >
                {{ option.label }}
              </button>
            </div>
          </div>

          <div class="prediction-section">
            <label class="dialog-label">{{ translate('charts.market.worldNewsFactors', 'World News Factors (Optional)') }}</label>
            <textarea
              v-model="worldNewsInput"
              :placeholder="translate('charts.market.worldNewsHint', 'E.g., Global supply chain issues, trade policies, etc.')"
              class="prediction-input"
              rows="3"
            ></textarea>
          </div>

          <div class="prediction-section">
            <label class="dialog-label">{{ translate('charts.market.localNewsFactors', 'El Salvador News Factors (Optional)') }}</label>
            <textarea
              v-model="localNewsInput"
              :placeholder="translate('charts.market.localNewsHint', 'E.g., Local regulations, weather events, policies, etc.')"
              class="prediction-input"
              rows="3"
            ></textarea>
          </div>
        </div>
        <div class="dialog-footer">
          <button class="cancel-btn" @click="closePredictionDialog">
            {{ translate('common.cancel', 'Cancel') }}
          </button>
          <button
            class="submit-btn"
            @click="submitPrediction"
            :disabled="isSubmittingPrediction"
            :style="{ background: categoryColor }"
          >
            <i v-if="isSubmittingPrediction" class="fas fa-spinner fa-spin"></i>
            <i v-else class="fas fa-paper-plane"></i>
            <span>{{ translate('common.submit', 'Submit') }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Prediction Loading Overlay -->
    <div v-if="showPredictionLoading" class="loading-overlay">
      <div class="loading-box">
        <i class="fas fa-spinner fa-spin"></i>
        <span>{{ translate('charts.market.analyzing', 'Analyzing market data...') }}</span>
      </div>
    </div>

    <!-- Prediction Response Dialog -->
    <div v-if="showResponseDialog" class="dialog-overlay" @click.self="closeResponseDialog">
      <div class="dialog-container response-dialog" @click.stop>
        <div class="dialog-header">
          <div class="dialog-title">
            <i class="fas fa-robot"></i>
            <span>{{ translate('charts.market.predictionsFor', 'AI Predictions') }}: {{ commodityName }}</span>
          </div>
          <button class="close-btn" @click="closeResponseDialog">
            <i class="fas fa-times"></i>
          </button>
        </div>
        <div class="dialog-body">
          <div class="response-content">
            <div v-if="predictionResponse" v-html="renderedPrediction"></div>
            <span v-else>{{ translate('charts.market.noResponse', 'No response received') }}</span>
          </div>
        </div>
        <div class="dialog-footer">
          <button class="action-btn" @click="copyResponse">
            <i class="fas fa-copy"></i>
            <span>{{ translate('charts.market.copy', 'Copy') }}</span>
          </button>
          <button class="action-btn" @click="shareViaEmail">
            <i class="fas fa-envelope"></i>
            <span>{{ translate('charts.market.shareViaEmail', 'Email') }}</span>
          </button>
          <button
            class="submit-btn"
            @click="closeResponseDialog"
            :style="{ background: categoryColor }"
          >
            <i class="fas fa-check"></i>
            <span>{{ translate('charts.market.close', 'Close') }}</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import worldBankService from "../../services/worldBankService";
import chatbotService from "../../services/chatbotService";
import { marked } from "marked";
import DOMPurify from "dompurify";

export default {
  name: "MarketPriceChart",
  props: {
    category: {
      type: String,
      required: true,
      validator: (value) => [
        'maize',
        'cropProtection',
        'vegetables',
        'livestock',
        'fertilizer',
        'apiary',
        'aquaculture',
        'harvestStorage'
      ].includes(value)
    },
    autoRefresh: {
      type: Boolean,
      default: false
    },
    refreshInterval: {
      type: Number,
      default: 300000
    },
    userId: {
      type: String,
      default: "anonymous"
    },
    sessionId: {
      type: String,
      default: "market-price-session"
    }
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
    cssVar(name) {
      return (prop) => getComputedStyle(document.documentElement).getPropertyValue(prop).trim();
    },
    categoryConfig() {
      const configs = {
        maize: {
          i18nKey: 'charts.market.maizeGrains',
          color: '#2E7D32'
        },
        cropProtection: {
          i18nKey: 'charts.market.cropProtection',
          color: '#D84315'
        },
        vegetables: {
          i18nKey: 'charts.market.fruitsVeggies',
          color: '#558B2F'
        },
        livestock: {
          i18nKey: 'charts.market.livestock',
          color: '#8D6E63'
        },
        fertilizer: {
          i18nKey: 'charts.market.fertilizer',
          color: '#F9A825'
        },
        apiary: {
          i18nKey: 'charts.market.apiary',
          color: '#F57F17'
        },
        aquaculture: {
          i18nKey: 'charts.market.aquaculture',
          color: '#0288D1'
        },
        harvestStorage: {
          i18nKey: 'charts.market.harvestStorage',
          color: '#00838F'
        }
      };
      return configs[this.category] || {};
    },
    commodityName() {
      return this.categoryConfig.i18nKey ? this.translate(this.categoryConfig.i18nKey) : this.category;
    },
    categoryColor() {
      return this.categoryConfig.color || '#3B82F6';
    },
    categoryColor20() {
      return this.categoryColor + '33'; // 20% opacity
    },
    timeSeries() {
      if (!this.chartData?.data) return [];
      return this.chartData.data;
    },
    trend() {
      if (!this.chartData) return 'unknown';
      return this.chartData.trend || 'unknown';
    },
    unit() {
      if (!this.chartData) return '';
      return this.chartData.unit || '';
    },
    lastUpdated() {
      return this.chartData?.lastUpdated || new Date().toISOString();
    },
    latestValue() {
      if (this.timeSeries.length === 0) return '--';
      const latest = this.timeSeries[this.timeSeries.length - 1];
      const value = latest.value;
      if (value === null || value === undefined) return '--';
      return this.formatValue(value);
    },
    trendLabel() {
      const labels = {
        up: this.translate('charts.market.trendUp', 'Rising'),
        down: this.translate('charts.market.trendDown', 'Falling'),
        stable: this.translate('charts.market.trendStable', 'Stable'),
        unknown: this.translate('charts.market.trendUnknown', 'Unknown')
      };
      return labels[this.trend] || labels.unknown;
    },
    trendIcon() {
      const icons = {
        up: 'fas fa-arrow-trend-up',
        down: 'fas fa-arrow-trend-down',
        stable: 'fas fa-arrow-trend-right',
        unknown: 'fas fa-minus'
      };
      return icons[this.trend] || icons.unknown;
    },
    timeFrameOptions() {
      return [
        { value: '3 months', label: this.translate('charts.market.timeFrame3Months', '3 months') },
        { value: '6 months', label: this.translate('charts.market.timeFrame6Months', '6 months') },
        { value: '1 year', label: this.translate('charts.market.timeFrame1Year', '1 year') },
        { value: '2 years', label: this.translate('charts.market.timeFrame2Years', '2 years') }
      ];
    },
    chartOptions() {
      const years = this.timeSeries.map(d => d.year);
      const values = this.timeSeries.map(d => d.value);

      // Calculate Y-axis range
      const valueArray = this.timeSeries.map(d => d.value);
      const minVal = Math.min(...valueArray);
      const maxVal = Math.max(...valueArray);
      const range = maxVal - minVal || 1;
      const yMin = Math.floor((minVal - range * 0.05) / 10) * 10;
      const yMax = Math.ceil((maxVal + range * 0.05) / 10) * 10;

      return {
        chart: {
          type: 'line',
          toolbar: { show: false },
          animations: {
            enabled: true,
            easing: 'easeinout',
            speed: 800
          },
          background: 'transparent'
        },
        series: [{
          name: this.commodityName,
          data: values
        }],
        xaxis: {
          categories: years,
          labels: {
            rotate: -45,
            style: {
              fontSize: '11px',
              colors: this.cssVar('--text-muted') || '#6b7280'
            }
          },
          axisBorder: { show: false },
          axisTicks: { show: false },
          tooltip: {
            enabled: true
          }
        },
        yaxis: {
          min: yMin,
          max: yMax,
          labels: {
            style: {
              colors: this.cssVar('--text-muted') || '#6b7280'
            },
            formatter: (value) => this.formatAxisValue(value)
          }
        },
        colors: [this.categoryColor],
        stroke: {
          curve: 'smooth',
          width: 3
        },
        fill: {
          type: 'gradient',
          gradient: {
            shadeIntensity: 1,
            opacityFrom: 0.5,
            opacityTo: 0.1,
            stops: [0, 90, 100]
          }
        },
        markers: {
          size: 6,
          colors: [this.categoryColor],
          strokeColors: this.cssVar('--bg-card') || '#ffffff',
          strokeWidth: 2
        },
        tooltip: {
          y: {
            formatter: (value) => this.formatValue(value)
          },
          theme: document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
        },
        grid: {
          borderColor: this.cssVar('--border-light') || '#e5e7eb',
          strokeDashArray: 4,
          strokeOpacity: 0.5
        }
      };
    },
    chartSeries() {
      const values = this.timeSeries.map(d => d.value);
      return [{
        name: this.commodityName,
        data: values
      }];
    }
  },
  methods: {
    translate(key, defaultValue) {
      return this.$t(key, defaultValue);
    },
    formatValue(value) {
      if (value === null || value === undefined) return '--';

      // Format based on category
      if (this.category === 'aquaculture') {
        // Metric tons - show as K for thousands
        if (value >= 1000) {
          return `${(value / 1000).toFixed(1)}K`;
        }
        return value.toFixed(0);
      } else if (this.category === 'fertilizer') {
        // kg per hectare
        return value.toFixed(0);
      } else if (this.category === 'harvestStorage') {
        // Percentage
        return `${value.toFixed(1)}%`;
      } else if (this.category === 'cropProtection') {
        // Percentage
        return `${value.toFixed(1)}%`;
      } else {
        // Index values
        return value.toFixed(0);
      }
    },
    formatAxisValue(value) {
      if (this.category === 'aquaculture') {
        if (value >= 1000) {
          return `${(value / 1000).toFixed(0)}K`;
        }
      }
      return value.toFixed(0);
    },
    formatDate(dateStr) {
      return new Date(dateStr).toLocaleDateString();
    },
    async loadChartData() {
      this.loading = true;
      this.error = null;

      try {
        let data;
        switch (this.category) {
          case 'maize':
            data = await worldBankService.getMaizePrices();
            break;
          case 'cropProtection':
            data = await worldBankService.getCropProtectionCosts();
            break;
          case 'vegetables':
            data = await worldBankService.getVegetablePrices();
            break;
          case 'livestock':
            data = await worldBankService.getPoultryPorkFeedCosts();
            break;
          case 'fertilizer':
            data = await worldBankService.getFertilizerPrices();
            break;
          case 'apiary':
            data = await worldBankService.getHoneyMarketData();
            break;
          case 'aquaculture':
            data = await worldBankService.getTilapiaMarketData();
            break;
          case 'harvestStorage':
            data = await worldBankService.getHarvestStorageData();
            break;
        }

        this.chartData = data;
      } catch (err) {
        this.error = this.translate('charts.loadDataError', 'Failed to load data');
        console.error("Error loading market price data:", err);
      } finally {
        this.loading = false;
      }
    },
    refresh() {
      worldBankService.clearCache();
      this.loadChartData();
    },
    getPredictions() {
      this.showPredictionDialog = true;
      this.worldNewsInput = '';
      this.localNewsInput = '';
      this.selectedTimeFrame = '6 months';
    },
    closePredictionDialog() {
      this.showPredictionDialog = false;
      this.worldNewsInput = '';
      this.localNewsInput = '';
      this.selectedTimeFrame = '6 months';
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
        // Build historical data string
        const historyData = this.timeSeries.map(item => {
          const value = this.formatValue(item.value);
          return `  ${item.year}: ${value}`;
        }).join('\n');

        // Get current language
        const currentLanguage = localStorage.getItem('preferredLanguage') || 'en';

        // Generate prompt (bilingual)
        const currentDate = new Date();
        const prompt = currentLanguage === 'es'
          ? `Solicitud de Predicción de Precios de Mercado para El Salvador

Fecha: ${currentDate.getDate()}/${currentDate.getMonth() + 1}/${currentDate.getFullYear()}

Producto: ${this.commodityName}
Marco Temporal de Predicción: ${this.selectedTimeFrame}

Datos Actuales del Mercado:
• Último Valor: ${this.latestValue} ${this.unit}
• Tendencia: ${this.trendLabel}
• Fuente de Datos: ${this.chartData?.dataSource || ''}

Datos Históricos de Precios:
${historyData}

Contexto del Usuario:
${this.worldNewsInput ? `Factores de Noticias Mundiales:\n${this.worldNewsInput}\n` : ''}${this.localNewsInput ? `Factores de Noticias Locales:\n${this.localNewsInput}\n` : ''}

Por favor, proporcione un análisis y predicción integral de precios de mercado para este producto en El Salvador para el período de ${this.selectedTimeFrame}, tomando en cuenta:

1. Indicadores y tendencias económicas globales que afectan este producto
2. Situación económica actual y entorno regulatorio de El Salvador
3. Eventos y noticias actuales que podrían impactar los precios
4. Patrones estacionales y ciclos de producción específicos de El Salvador
5. Tendencias del mercado regional en Centroamérica
6. Factores de la cadena de suministro y dinámicas de importación/exportación

Proporcione:
• Pronóstico de precios para el marco temporal solicitado
• Factores de riesgo clave que podrían impactar los precios
• Recomendaciones para agricultores/productores
• Cualquier oportunidad o advertencia relevante del mercado`
          : `Market Price Prediction Request for El Salvador

Date: ${currentDate.getDate()}/${currentDate.getMonth() + 1}/${currentDate.getFullYear()}

Commodity: ${this.commodityName}
Prediction Time Frame: ${this.selectedTimeFrame}

Current Market Data:
• Latest Value: ${this.latestValue} ${this.unit}
• Trend: ${this.trendLabel}
• Data Source: ${this.chartData?.dataSource || ''}

Historical Price Data:
${historyData}

User Context:
${this.worldNewsInput ? `World News Factors:\n${this.worldNewsInput}\n` : ''}${this.localNewsInput ? `Local News Factors:\n${this.localNewsInput}\n` : ''}

Please provide a comprehensive market price prediction and analysis for this commodity in El Salvador for the ${this.selectedTimeFrame} period, taking into account:

1. Global economic indicators and trends affecting this commodity
2. El Salvador's current economic situation and regulatory environment
3. Current events and news that could impact prices
4. Seasonal patterns and production cycles specific to El Salvador
5. Regional market trends in Central America
6. Supply chain factors and import/export dynamics

Provide:
• Price forecast for the requested time frame
• Key risk factors that could impact prices
• Recommendations for farmers/producers
• Any relevant market opportunities or warnings`;

        const queryData = {
          userId: this.userId,
          sessionId: `${this.sessionId}-${this.category}-${Date.now()}`,
          messages: [{ role: 'user', content: prompt }],
          context: {
            language: currentLanguage.toUpperCase()
          },
          contextOption: 'simple-query'
        };

        const response = await chatbotService.submitQuery(queryData);
        this.predictionResponse = response.response || this.translate('charts.market.noResponse', 'No response received');
        this.showPredictionLoading = false;
        this.showResponseDialog = true;
      } catch (error) {
        console.error('Error submitting prediction query:', error);
        this.predictionResponse = this.translate('charts.market.errorOccurred', 'An error occurred') + ': ' + error.message;
        this.showPredictionLoading = false;
        this.showResponseDialog = true;
      } finally {
        this.isSubmittingPrediction = false;
      }
    },
    copyResponse() {
      const text = this.predictionResponse || '';
      navigator.clipboard.writeText(text).then(() => {
        console.log('Response copied to clipboard');
      }).catch(err => {
        console.error('Failed to copy:', err);
      });
    },
    shareViaEmail() {
      const currentDate = new Date();
      const shareText = `🤖 ${this.translate('charts.market.predictionsFor', 'AI Predictions')}: ${this.commodityName} 🤖
📅 ${currentDate.getDate()}/${currentDate.getMonth() + 1}/${currentDate.getFullYear()}

━━━━━━━━━━━━━━━

${this.predictionResponse}

━━━━━━━━━━━━━━━

${this.translate('charts.market.sharedVia', 'Shared via AgroGenio AI')}`;

      const subject = `${this.commodityName} - ${this.translate('charts.market.predictionsFor', 'AI Predictions')}`;
      const body = encodeURIComponent(shareText);

      window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${body}`;
    }
  },
  mounted() {
    this.loadChartData();
    if (this.autoRefresh) {
      this.refreshTimer = setInterval(this.loadChartData, this.refreshInterval);
    }
  },
  beforeUnmount() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
    }
  }
};
</script>

<style scoped>
.market-price-chart {
  padding: 24px;
  background: var(--bg-card);
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  min-height: 400px;
}

.loading-indicator,
.error-message,
.no-data {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 60px 20px;
  color: #6b7280;
  font-size: 1rem;
}

.error-message {
  color: #ef4444;
}

.chart-content {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

/* Summary Cards */
.summary-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 16px;
}

.summary-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 20px;
  background: var(--bg-tertiary);
  border-radius: 12px;
  border: 1px solid var(--border-light);
}

.summary-icon {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 12px;
  font-size: 1.5rem;
}

.summary-icon.trend-up {
  background: #4CAF50;
  color: white;
}

.summary-icon.trend-down {
  background: #F44336;
  color: white;
}

.summary-icon.trend-stable {
  background: #FFC107;
  color: white;
}

.summary-icon.trend-unknown {
  background: #9E9E9E;
  color: white;
}

.summary-content {
  flex: 1;
}

.summary-label {
  font-size: 0.85rem;
  color: var(--text-muted);
  margin-bottom: 4px;
}

.summary-value {
  font-size: 1.75rem;
  font-weight: 700;
  color: var(--text-primary);
}

.summary-unit {
  font-size: 0.85rem;
  color: var(--text-muted);
  margin-top: 2px;
}

.summary-value.trend-up {
  color: #4CAF50;
}

.summary-value.trend-down {
  color: #F44336;
}

.summary-value.trend-stable {
  color: #FFC107;
}

.summary-value.trend-unknown {
  color: #9E9E9E;
}

/* Source Badge */
.source-badge {
  align-self: flex-start;
  padding: 6px 12px;
  background: var(--bg-tertiary);
  border-radius: 12px;
  border: 1px solid var(--border-light);
  font-size: 0.8rem;
  color: var(--text-secondary);
}

/* Predict Button */
.predict-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  padding: 14px 20px;
  border: none;
  border-radius: 8px;
  color: white;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.predict-btn:hover {
  opacity: 0.9;
  transform: translateY(-1px);
}

/* Chart Title */
.chart-title {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--text-primary);
}

/* Line Chart */
.line-chart-container {
  margin: 0;
}

/* Data Table */
.data-table-container {
  max-height: 300px;
  overflow-y: auto;
  border: 1px solid var(--border-light);
  border-radius: 8px;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
}

.data-table th,
.data-table td {
  padding: 12px 16px;
  text-align: left;
  border-bottom: 1px solid var(--border-light);
}

.data-table th {
  background: var(--bg-tertiary);
  font-weight: 600;
  font-size: 0.9rem;
  color: var(--text-primary);
}

.data-table td {
  font-size: 0.95rem;
  color: var(--text-muted);
}

.value-cell {
  font-weight: 600;
}

/* Last Updated */
.last-updated {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: auto;
  font-size: 0.85rem;
  color: var(--text-muted);
}

/* Dialogs */
.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
  padding: 16px;
}

.dialog-container {
  background: var(--bg-card);
  border-radius: 12px;
  width: 100%;
  max-width: 600px;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-lg);
}

.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 24px;
  border-bottom: 1px solid var(--border-light);
  flex-shrink: 0;
}

.dialog-title {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--text-primary);
}

.close-btn {
  background: none;
  border: none;
  font-size: 1.25rem;
  color: var(--text-muted);
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  transition: all 0.2s;
}

.close-btn:hover {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.dialog-body {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
}

.dialog-footer {
  display: flex;
  gap: 12px;
  padding: 16px 24px;
  border-top: 1px solid var(--border-light);
  justify-content: flex-end;
  flex-wrap: wrap;
}

/* Prediction Dialog */
.prediction-dialog {
  max-width: 500px;
}

.prediction-section {
  margin-bottom: 20px;
}

.dialog-label {
  display: block;
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 8px;
}

.timeframe-options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.timeframe-btn {
  padding: 8px 16px;
  border: 1px solid var(--border-light);
  border-radius: 20px;
  background: var(--bg-card);
  color: var(--text-primary);
  font-size: 0.9rem;
  cursor: pointer;
  transition: all 0.2s;
}

.timeframe-btn:hover {
  border-color: var(--primary-color, #4CAF50);
}

.timeframe-btn.active {
  background: var(--primary-color, #4CAF50);
  border-color: var(--primary-color, #4CAF50);
  color: white;
}

.prediction-input {
  width: 100%;
  padding: 12px;
  border: 1px solid var(--border-light);
  border-radius: 8px;
  background: var(--bg-card);
  color: var(--text-primary);
  font-family: inherit;
  font-size: 0.95rem;
  resize: vertical;
}

.cancel-btn,
.action-btn {
  padding: 10px 20px;
  border: 1px solid var(--border-light);
  border-radius: 8px;
  background: var(--bg-card);
  color: var(--text-primary);
  font-size: 0.95rem;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  gap: 8px;
}

.cancel-btn:hover,
.action-btn:hover {
  background: var(--bg-tertiary);
}

.submit-btn {
  padding: 10px 20px;
  border: none;
  border-radius: 8px;
  color: white;
  font-size: 0.95rem;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  gap: 8px;
}

.submit-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.submit-btn:hover:not(:disabled) {
  opacity: 0.9;
  transform: translateY(-1px);
}

/* Response Dialog */
.response-dialog {
  max-width: 700px;
}

.response-content {
  white-space: pre-wrap;
  line-height: 1.6;
  color: var(--text-primary);
}

/* Loading Overlay */
.loading-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.8);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 3000;
}

.loading-box {
  background: var(--bg-card);
  padding: 32px 48px;
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  box-shadow: var(--shadow-lg);
}

.loading-box i {
  font-size: 2rem;
  color: var(--primary-color, #4CAF50);
}

.loading-box span {
  font-size: 1rem;
  color: var(--text-muted);
}

/* Responsive */
@media (max-width: 768px) {
  .market-price-chart {
    padding: 16px;
  }

  .summary-cards {
    grid-template-columns: 1fr;
  }

  .dialog-container {
    max-width: 95vw;
    max-height: 90vh;
  }

  .prediction-dialog {
    max-width: 95vw;
  }

  .response-dialog {
    max-width: 95vw;
  }

  .dialog-footer {
    flex-direction: column;
  }

  .dialog-footer button {
    width: 100%;
  }
}
</style>
