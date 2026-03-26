<template>
  <div
    class="market-price-summary-card"
    :class="{ 'dark-mode': isDarkMode }"
    :style="{ borderColor: `${categoryColor}80` }"
    @click="openChart"
  >
    <div class="card-content">
      <!-- Sparkline Chart -->
      <div class="sparkline-container">
        <svg viewBox="0 0 100 100" class="sparkline">
          <!-- Background Circle -->
          <circle
            cx="50"
            cy="50"
            r="44"
            :stroke="backgroundColor"
            stroke-width="6"
            fill="none"
          />
          <!-- Data Line and Fill (if data available) -->
          <g v-if="!loading && timeSeries.length >= 2">
            <defs>
              <linearGradient :id="gradientId" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" :stop-color="categoryColor" stop-opacity="0.2" />
                <stop offset="100%" :stop-color="categoryColor" stop-opacity="0.05" />
              </linearGradient>
            </defs>
            <!-- Fill Path -->
            <path
              :d="fillPath"
              :fill="`url(#${gradientId})`"
              stroke="none"
            />
            <!-- Line Path -->
            <path
              :d="linePath"
              :stroke="categoryColor"
              stroke-width="4"
              fill="none"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <!-- End Dot -->
            <circle
              :cx="endPoint.x"
              :cy="endPoint.y"
              r="6"
              :fill="categoryColor"
            />
          </g>
          <!-- Category Icon -->
          <g v-if="svgPath" :fill="categoryColor" transform="translate(30, 30) scale(0.04)">
            <path :d="svgPath" />
          </g>
        </svg>
        <!-- Loading Spinner -->
        <div v-if="loading" class="sparkline-loading">
          <i class="fas fa-spinner fa-spin"></i>
        </div>
      </div>

      <!-- Card Info -->
      <div class="card-info">
        <div class="card-label">{{ cardTitle }}</div>
        <div class="card-value-row">
          <div class="card-value" :style="{ color: categoryColor }">
            {{ latestValue }}
          </div>
          <i
            :class="trendIcon"
            class="trend-icon"
            :style="{ color: trendColor }"
          ></i>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import worldBankService from "../../services/worldBankService";

export default {
  name: "MarketPriceSummaryCard",
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
    }
  },
  data() {
    return {
      priceData: null,
      loading: true,
    };
  },
  computed: {
    isDarkMode() {
      return document.documentElement.getAttribute("data-theme") === "dark";
    },
    backgroundColor() {
      return this.isDarkMode ? "#374151" : "#d1d5db";
    },
    gradientId() {
      return `gradient-${this.category}`;
    },
    // Category configuration - using exact Material Design Icons SVG paths to match Flutter app
    categoryConfig() {
      const configs = {
        maize: {
          i18nKey: 'market.maizeGrains',
          svgPath: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z',
          color: '#2E7D32'
        },
        cropProtection: {
          i18nKey: 'market.cropProtection',
          svgPath: 'M20 8h-2V6c0-1.1-.9-2-2-2h-2V2c0-.55-.45-1-1-1s-1 .45-1 1v2h-2V2c0-.55-.45-1-1-1s-1 .45-1 1v2H6c-1.1 0-2 .9-2 2v2H2c-.55 0-1 .45-1 1s.45 1 1 1h2v2H2c-.55 0-1 .45-1 1s.45 1 1 1h2v2H2c-.55 0-1 .45-1 1s.45 1 1 1h2v2c0 1.1.9 2 2 2h2v2c0 .55.45 1 1 1s1-.45 1-1v-2h2v2c0 .55.45 1 1 1s1-.45 1-1v-2h2v2c0 .55.45 1 1 1s1-.45 1-1v-2h2c1.1 0 2-.9 2-2v-2h2c.55 0 1-.45 1-1s-.45-1-1-1h-2v-2h2c.55 0 1-.45 1-1s-.45-1-1-1h-2v-2h2c.55 0 1-.45 1-1s-.45-1-1-1h-2v-2h2c.55 0 1-.45 1-1s-.45-1-1-1zm-4 10H8V8h8v10z',
          color: '#D84315'
        },
        vegetables: {
          i18nKey: 'market.fruitsVeggies',
          svgPath: 'M17 15.2c0 .9-.6 1.7-1.3 2.2-.3.2-.5.4-.6.7-.1.3-.1.6-.1.9v.2c0 .4-.3.8-.8.8H17c.4 0 .8-.3.8-.8v-.2c0-.3 0-.6-.1-.9-.1-.3-.3-.5-.6-.7-.7-.5-1.3-1.3-1.3-2.2 0-1.5 1.2-2.7 2.7-2.7s2.7 1.2 2.7 2.7c0 .9-.6 1.7-1.3 2.2-.3.2-.5.4-.6.7-.1.3-.1.6-.1.9v.2c0 .4-.3.8-.8.8h2.2c.4 0 .8-.3.8-.8v-.2c0-.3 0-.6-.1-.9-.1-.3-.3-.5-.6-.7-.7-.5-1.3-1.3-1.3-2.2 0-1.5 1.2-2.7 2.7-2.7s2.7 1.2 2.7 2.7zM12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm0 18c-4.4 0-8-3.6-8-8s3.6-8 8-8 8 3.6 8 8-3.6 8-8 8z M12 6c-.55 0-1 .45-1 1v5c0 .55.45 1 1 1s1-.45 1-1V7c0-.55-.45-1-1-1z',
          color: '#558B2F'
        },
        livestock: {
          i18nKey: 'market.livestock',
          svgPath: 'M4.5 11.5c0 1 .6 1.9 1.5 2.2v2.3c0 3.5 2.9 6.4 6.4 6.4h.3c3.5 0 6.4-2.9 6.4-6.4v-2.3c.9-.3 1.5-1.2 1.5-2.2 0-1.4-1.1-2.5-2.5-2.5S15.6 10.1 15.6 11.5v1h-7.2v-1c0-1.4-1.1-2.5-2.5-2.5s-2.5 1.1-2.5 2.5zM12 4c1.1 0 2 .9 2 2v2h-4V6c0-1.1.9-2 2-2zm-6 8.5c0-.6.4-1 1-1s1 .4 1 1v3.5c0 1.4 1.1 2.5 2.5 2.5h3c1.4 0 2.5-1.1 2.5-2.5V12.5c0-.6.4-1 1-1s1 .4 1 1v3.5c0 2.5-2 4.5-4.5 4.5h-3c-2.5 0-4.5-2-4.5-4.5v-3.5z',
          color: '#8D6E63'
        },
        fertilizer: {
          i18nKey: 'market.fertilizer',
          svgPath: 'M19 8h-2V6c0-1.1-.9-2-2-2h-2V2c0-.55-.45-1-1-1s-1 .45-1 1v2h-2V2c0-.55-.45-1-1-1s-1 .45-1 1v2H6c-1.1 0-2 .9-2 2v2H2c-.55 0-1 .45-1 1s.45 1 1 1h2v2H2c-.55 0-1 .45-1 1s.45 1 1 1h2v2H2c-.55 0-1 .45-1 1s.45 1 1 1h2v2c0 1.1.9 2 2 2h2v2c0 .55.45 1 1 1s1-.45 1-1v-2h2v2c0 .55.45 1 1 1s1-.45 1-1v-2h2v2c0 .55.45 1 1 1s1-.45 1-1v-2h2c1.1 0 2-.9 2-2v-2h2c.55 0 1-.45 1-1s-.45-1-1-1h-2v-2h2c.55 0 1-.45 1-1s-.45-1-1-1h-2v-2h2c.55 0 1-.45 1-1s-.45-1-1-1h-2v-2h2c.55 0 1-.45 1-1s-.45-1-1-1zm-4 10H8V8h8v10z',
          color: '#F9A825'
        },
        apiary: {
          i18nKey: 'market.apiary',
          svgPath: 'M12 2L2 22h20L12 2zm0 3.5L18.5 20H5.5L12 5.5z',
          color: '#F57F17'
        },
        aquaculture: {
          i18nKey: 'market.aquaculture',
          svgPath: 'M21 5c-1.11-.35-2.33-.5-3.5-.5-1.95 0-4.05.4-5.5 1.5-1.45-1.1-3.55-1.5-5.5-1.5S2.45 4.9 1 6v14.65c0 .25.25.5.5.5.1 0 .15-.05.25-.05C3.1 20.45 5.05 20 6.5 20c1.95 0 4.05.4 5.5 1.5 1.35-.85 3.8-1.5 5.5-1.5 1.65 0 3.35.3 4.75 1.05.41.21.75-.19.6-.6-.33-.89-.55-1.92-.55-2.95 0-2.05 1.05-3.95 2.6-5.35.1-.1.15-.25.1-.4-.05-.15-.2-.2-.35-.25-.6-.15-1.25-.25-1.9-.25-1.95 0-4.05.4-5.5 1.5-1.45-1.1-3.55-1.5-5.5-1.5S2.45 11.9 1 13v-7c1.45-1.1 3.55-1.5 5.5-1.5 1.65 0 3.35.3 4.75 1.05.41.21.75-.19.6-.6-.33-.89-.55-1.92-.55-2.95 0-1.45.5-2.8 1.35-3.9.1-.15.05-.35-.1-.45-.1-.05-.25-.05-.35 0-.65.35-1.35.55-2.05.55-1.95 0-4.05-.4-5.5-1.5z',
          color: '#0288D1'
        },
        harvestStorage: {
          i18nKey: 'market.harvestStorage',
          svgPath: 'M19 2H5c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 18H5V4h14v16z M7 10h2v7H7zm4-3h2v10h-2zm4 6h2v4h-2z',
          color: '#00838F'
        }
      };
      return configs[this.category] || {};
    },
    cardTitle() {
      return this.categoryConfig.i18nKey ? this.t(this.categoryConfig.i18nKey) : this.category;
    },
    categoryColor() {
      return this.categoryConfig.color || '#3B82F6';
    },
    svgPath() {
      return this.categoryConfig.svgPath || '';
    },
    timeSeries() {
      if (!this.priceData?.data) return [];
      return this.priceData.data;
    },
    trend() {
      if (!this.priceData) return 'unknown';
      return this.priceData.trend || 'unknown';
    },
    trendIcon() {
      const icons = {
        up: 'fa-arrow-trend-up',
        down: 'fa-arrow-trend-down',
        stable: 'fa-arrow-trend-right',
        unknown: 'fa-minus'
      };
      return `fas ${icons[this.trend] || icons.unknown}`;
    },
    trendColor() {
      const colors = {
        up: '#4CAF50',
        down: '#F44336',
        stable: '#FFC107',
        unknown: '#9E9E9E'
      };
      return colors[this.trend] || colors.unknown;
    },
    latestValue() {
      if (this.timeSeries.length === 0) return '--';
      const latest = this.timeSeries[this.timeSeries.length - 1];
      const value = latest.value;

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
    // Sparkline SVG paths
    linePath() {
      if (this.timeSeries.length < 2) return '';

      const values = this.timeSeries.map(d => d.value);
      const minVal = Math.min(...values);
      const maxVal = Math.max(...values);
      const range = maxVal - minVal || 1;

      const points = values.map((val, i) => {
        const x = 10 + (i / (values.length - 1)) * 80;
        const normalizedValue = (val - minVal) / range;
        const y = 90 - (normalizedValue * 80);
        return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
      });

      return points.join(' ');
    },
    fillPath() {
      if (this.timeSeries.length < 2) return '';

      const values = this.timeSeries.map(d => d.value);
      const minVal = Math.min(...values);
      const maxVal = Math.max(...values);
      const range = maxVal - minVal || 1;

      const points = values.map((val, i) => {
        const x = 10 + (i / (values.length - 1)) * 80;
        const normalizedValue = (val - minVal) / range;
        const y = 90 - (normalizedValue * 80);
        return `${x},${y}`;
      });

      return `M ${points[0]} L ${points.join(' L ')} L 90,90 L 10,90 Z`;
    },
    endPoint() {
      if (this.timeSeries.length < 2) return { x: 50, y: 50 };

      const values = this.timeSeries.map(d => d.value);
      const minVal = Math.min(...values);
      const maxVal = Math.max(...values);
      const range = maxVal - minVal || 1;
      const lastValue = values[values.length - 1];

      const x = 90;
      const normalizedValue = (lastValue - minVal) / range;
      const y = 90 - (normalizedValue * 80);

      return { x, y };
    }
  },
  methods: {
    t(key) {
      return this.$t(key);
    },
    async loadPriceData() {
      this.loading = true;
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

        this.priceData = data;
      } catch (error) {
        console.error(`[MarketPriceSummaryCard] Error loading data for ${this.category}:`, error);
      } finally {
        this.loading = false;
      }
    },
    openChart() {
      this.$emit('open-chart', 'market-price', this.category);
    }
  },
  mounted() {
    this.loadPriceData();
  }
};
</script>

<style scoped>
.market-price-summary-card {
  padding: 8px;
  background: #f5f5f5;
  border-radius: 8px;
  border: 2px solid rgba(0, 0, 0, 0.12);
  cursor: pointer;
  transition: all 0.2s;
  height: 100px;
  display: flex;
  align-items: center;
}

.market-price-summary-card:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  transform: translateY(-1px);
}

.dark-mode.market-price-summary-card {
  background: #424242;
  border-color: rgba(255, 255, 255, 0.1);
}

.card-content {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
}

/* Sparkline */
.sparkline-container {
  width: 36px;
  height: 36px;
  position: relative;
  flex-shrink: 0;
}

.sparkline {
  width: 100%;
  height: 100%;
}

.sparkline-loading {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: 12px;
  color: var(--text-secondary);
}

/* Card Info */
.card-info {
  flex: 1;
  min-width: 0;
}

.card-label {
  font-size: 9px;
  color: var(--text-secondary);
  margin-bottom: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  opacity: 0.7;
}

.card-value-row {
  display: flex;
  align-items: center;
  gap: 2px;
}

.card-value {
  font-size: 10px;
  font-weight: bold;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.trend-icon {
  font-size: 9px;
  flex-shrink: 0;
}

/* Arrow - REMOVED to match Flutter */
.card-arrow {
  display: none;
}

/* Responsive */
@media (max-width: 768px) {
  .market-price-summary-card {
    padding: 8px;
    height: 100px;
  }

  .sparkline-container {
    width: 36px;
    height: 36px;
  }

  .card-label {
    font-size: 9px;
  }

  .card-value {
    font-size: 10px;
  }

  .trend-icon {
    font-size: 9px;
  }
}
</style>
