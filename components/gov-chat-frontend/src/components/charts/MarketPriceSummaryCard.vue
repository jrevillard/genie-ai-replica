<template>
  <div
    class="market-price-summary-card"
    :class="{ 'dark-mode': isDarkMode }"
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
            r="45"
            :stroke="backgroundColor"
            stroke-width="8"
            fill="none"
          />
          <!-- Data Line and Fill (if data available) -->
          <g v-if="!loading && timeSeries.length >= 2">
            <defs>
              <linearGradient :id="gradientId" x1="0%" y1="0%" x2="0%" y2="100%">
                <stop offset="0%" :stop-color="categoryColor" stop-opacity="0.3" />
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
              stroke-width="3"
              fill="none"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
            <!-- End Dot -->
            <circle
              :cx="endPoint.x"
              :cy="endPoint.y"
              r="4"
              :fill="categoryColor"
              :stroke="isDarkMode ? '#1f2937' : '#ffffff'"
              stroke-width="2"
            />
          </g>
          <!-- Category Icon -->
          <foreignObject x="20" y="20" width="60" height="60">
            <div class="icon-container" :style="{ color: categoryColor }">
              <i :class="categoryIcon" class="category-icon"></i>
            </div>
          </foreignObject>
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

      <!-- Arrow -->
      <div class="card-arrow">
        <i class="fas fa-chevron-right"></i>
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
    // Category configuration
    categoryConfig() {
      const configs = {
        maize: {
          i18nKey: 'market.maizeGrains',
          icon: 'fa-seedling',
          color: '#2E7D32'
        },
        cropProtection: {
          i18nKey: 'market.cropProtection',
          icon: 'fa-bug',
          color: '#D84315'
        },
        vegetables: {
          i18nKey: 'market.fruitsVeggies',
          icon: 'fa-carrot',
          color: '#558B2F'
        },
        livestock: {
          i18nKey: 'market.livestock',
          icon: 'fa-drumstick-bite',
          color: '#8D6E63'
        },
        fertilizer: {
          i18nKey: 'market.fertilizer',
          icon: 'fa-flask',
          color: '#F9A825'
        },
        apiary: {
          i18nKey: 'market.apiary',
          icon: 'fa-hexagon-nodes',
          color: '#F57F17'
        },
        aquaculture: {
          i18nKey: 'market.aquaculture',
          icon: 'fa-fish',
          color: '#0288D1'
        },
        harvestStorage: {
          i18nKey: 'market.harvestStorage',
          icon: 'fa-warehouse',
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
    categoryIcon() {
      return `fas ${this.categoryConfig.icon || 'fa-chart-line'}`;
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
  padding: 12px;
  background: var(--bg-card);
  border-radius: 8px;
  border: 2px solid transparent;
  cursor: pointer;
  transition: all 0.2s;
  height: 70px;
}

.market-price-summary-card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  transform: translateY(-2px);
}

.card-content {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 100%;
}

/* Sparkline */
.sparkline-container {
  width: 45px;
  height: 45px;
  position: relative;
  flex-shrink: 0;
}

.sparkline {
  width: 100%;
  height: 100%;
}

.icon-container {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
}

.category-icon {
  opacity: 0.8;
}

.sparkline-loading {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  font-size: 14px;
  color: var(--text-secondary);
}

/* Card Info */
.card-info {
  flex: 1;
  min-width: 0;
}

.card-label {
  font-size: 10px;
  color: var(--text-secondary);
  margin-bottom: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card-value-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.card-value {
  font-size: 14px;
  font-weight: bold;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.trend-icon {
  font-size: 11px;
  flex-shrink: 0;
}

/* Arrow */
.card-arrow {
  color: var(--text-secondary);
  font-size: 14px;
  opacity: 0.5;
  flex-shrink: 0;
}

/* Dark Mode */
.dark-mode.market-price-summary-card {
  border-color: rgba(255, 255, 255, 0.1);
}

/* Responsive */
@media (max-width: 768px) {
  .market-price-summary-card {
    padding: 10px;
    height: 65px;
  }

  .sparkline-container {
    width: 40px;
    height: 40px;
  }

  .icon-container {
    font-size: 14px;
  }

  .card-value {
    font-size: 13px;
  }

  .trend-icon {
    font-size: 10px;
  }
}
</style>
