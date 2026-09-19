<template>
  <DsCard variant="outline" hoverable class="market-price-summary-card" @click="openChart">
    <div class="card-content">
      <div class="card-main">
        <!-- Sparkline Chart -->
        <div class="sparkline-container">
          <div v-if="loading" class="sparkline-loading">
            <DsSpinner size="sm" />
          </div>
          <div v-else-if="timeSeries.length >= 2" class="sparkline-chart">
            <apexchart type="line" :height="40" :options="chartOptions" :series="chartSeries" />
          </div>
          <div v-else class="sparkline-empty">
            {{ $t('charts.market.noData', 'No data') }}
          </div>
        </div>

        <!-- Card Info -->
        <div class="card-info">
          <div class="card-label">{{ cardTitle }}</div>
          <div class="card-value-row">
            <div class="card-value" :title="latestTooltip" tabindex="0" :aria-label="latestTooltip">
              {{ latestValue }}
            </div>
            <DsPill :variant="trendVariant" size="sm" class="trend-pill">
              {{ trendText }}
            </DsPill>
          </div>
        </div>
      </div>

      <!-- Commodity chips: left-aligned UNDER the sparkline on every card
           (user req 2026-09-19); 3-column grid when numerous (grains) so
           the card stays short. Includes the primary series — Livestock
           must show chicken AND beef. -->
      <div v-if="codeChips.length > 0" class="card-codes" :class="{ 'card-codes--grid': codeChips.length > 4 }">
        <span
          v-for="item in codeChips"
          :key="item.code"
          class="card-code"
          :class="{ 'card-code--primary': item.isPrimary }"
          :title="item.tip"
          tabindex="0"
          :aria-label="item.tip"
        >
          <span class="card-code__dot" :style="{ background: item.color }" aria-hidden="true"></span>
          {{ item.code }}
        </span>
      </div>
    </div>
  </DsCard>
</template>

<script>
import DsCard from '../ds/Card.vue';
import DsSpinner from '../ds/Spinner.vue';
import DsPill from '../ds/Pill.vue';
import agriApiService from '../../services/agriApiService.js';
import { agriDateLocale, localizeFullName } from '../../utils/agri-i18n.js';

export default {
  name: 'MarketPriceSummaryCard',

  components: {
    DsCard,
    DsSpinner,
    DsPill
  },

  props: {
    category: {
      type: String,
      required: true,
      validator: (value) =>
        [
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
    region: {
      type: String,
      default: 'El Salvador'
    }
  },
  emits: ['open-chart'],

  setup() {
    return {};
  },
  data() {
    return {
      priceData: null,
      loading: true,
      timeSeries: [],
      allSeries: []
    };
  },

  computed: {
    cardTitle() {
      const i18nMap = {
        maize: 'charts.market.maizeGrains',
        cropProtection: 'charts.market.cropProtection',
        vegetables: 'charts.market.fruitsVeggies',
        livestock: 'charts.market.livestock',
        fertilizer: 'charts.market.fertilizer',
        apiary: 'charts.market.apiary',
        aquaculture: 'charts.market.aquaculture',
        harvestStorage: 'charts.market.harvestStorage'
      };
      return this.$t(i18nMap[this.category] || 'charts.market.unknown', 'Unknown');
    },

    latestValue() {
      if (!this.timeSeries || this.timeSeries.length === 0) {
        return this.$t('charts.market.noData', 'N/A');
      }
      const latest = this.timeSeries[this.timeSeries.length - 1];
      return latest.value ? latest.value.toFixed(2) : this.$t('charts.market.noData', 'N/A');
    },

    /** Explains what the headline number IS (user req 2026-09-19): the
     *  primary commodity's latest month-end observation, not an average,
     *  sum or index. Localized (i18n req 2026-09-19). */
    latestTooltip() {
      const primary = this.allSeries[0];
      if (!primary) return '';
      const points = (primary.data || []).filter((p) => Number.isFinite(p.value));
      const last = points[points.length - 1];
      const value = last ? last.value.toFixed(2) : '--';
      const unit = this.unit ? ` ${this.unit}` : '';
      return this.$t('charts.market.latestTip', 'Latest month-end price of {name} — {value}{unit}', {
        name: localizeFullName(primary.name, this.uiLocale()),
        value,
        unit
      });
    },

    /**
     * Acronym chips for the NON-primary commodities on multi-commodity
     * cards — "CAB-GT", "DAP-US", "TIL-HN"… Tooltip carries the full
     * description + latest price. Codes: first word (≤3 letters) + country
     * tag when the series name names one; same-base collisions get a
     * second-word initial (apiary honey producer vs export).
     */
    codeChips() {
      const palette = [this.resolvedCategoryColor, 'var(--warning)', 'var(--muted)', 'var(--info)', 'var(--danger)'];
      // ALL series incl. the primary (user req: Livestock must show chicken
      // AND beef) — the headline number stays the primary's.
      const items = this.allSeries.slice(0, 24);
      const codes = items.map((s) => this.commodityCode(s.name));
      const counts = new Map();
      codes.forEach((c) => counts.set(c, (counts.get(c) || 0) + 1));
      return items.map((s, i) => {
        let code = codes[i];
        if ((counts.get(code) || 0) > 1) {
          const second = (this.baseSeriesName(s.name).split(/\s+/)[1] || '?')[0].toUpperCase();
          code = `${code}-${second}`;
        }
        const points = (s.data || []).filter((p) => Number.isFinite(p.value));
        const last = points[points.length - 1];
        const value = last ? last.value.toFixed(2) : '--';
        const unit = this.unit || '';
        return {
          code,
          isPrimary: i === 0,
          tip: this.$t('charts.market.latestTip', 'Latest month-end price of {name} — {value}{unit}', {
            name: localizeFullName(s.name, this.uiLocale()),
            value,
            unit: unit ? ` ${unit}` : ''
          }),
          color: palette[i % palette.length]
        };
      });
    },

    unit() {
      return this.priceData?.unit || '';
    },

    trend() {
      return this.priceData?.trend || 'unknown';
    },

    trendVariant() {
      const variantMap = {
        up: 'success',
        down: 'danger',
        stable: 'accent',
        unknown: 'info'
      };
      return variantMap[this.trend] || 'info';
    },

    trendText() {
      const textMap = {
        up: '↑',
        down: '↓',
        stable: '→',
        unknown: '?'
      };
      return textMap[this.trend] || '?';
    },

    chartSeries() {
      if (!this.timeSeries || this.timeSeries.length === 0) {
        return [{ data: [] }];
      }
      return [
        {
          data: this.timeSeries.map((d) => d.value)
        }
      ];
    },

    chartOptions() {
      return {
        chart: {
          type: 'line',
          sparkline: {
            enabled: true
          },
          animations: {
            enabled: false
          },
          background: 'transparent'
        },
        stroke: {
          curve: 'smooth',
          width: 4
        },
        // Resolved at render time (see resolvedCategoryColor). Falls back to
        // the raw var() string if getComputedStyle returns empty.
        colors: [this.resolvedCategoryColor],
        // Solid fill (light opacity) instead of gradient — the gradient
        // version made the line stroke appear to fade because ApexCharts
        // applies the fill opacity to the line border as well.
        fill: {
          type: 'solid',
          opacity: 0.2
        },
        xaxis: {
          categories: this.timeSeries.map((d) => d.year),
          labels: {
            show: false
          },
          axisBorder: {
            show: false
          },
          axisTicks: {
            show: false
          }
        },
        yaxis: {
          show: false
        },
        grid: {
          show: false
        },
        tooltip: {
          // Mouse-overs show date + value everywhere (user requirement) —
          // including the sparkline. Theme/colors come from the global
          // apexcharts DS-token CSS in theme-components.css.
          enabled: true,
          x: {
            formatter: (val) => {
              const point = this.timeSeries.find((d) => String(d.year) === String(val));
              return this.formatSparkTooltipDate(point ? point.year : val);
            }
          },
          y: {
            formatter: (v) => {
              const unit = (this.priceData && this.priceData.unit) || '';
              return `${v}${unit ? ` ${unit}` : ''}`;
            }
          }
        },
        dataLabels: {
          enabled: false
        }
      };
    },

    categoryColor() {
      const colorMap = {
        maize: 'var(--success)',
        cropProtection: 'var(--warning)',
        vegetables: 'var(--brand)',
        livestock: 'var(--accent)',
        fertilizer: 'var(--info)',
        apiary: 'var(--warning)',
        aquaculture: 'var(--brand)',
        harvestStorage: 'var(--muted)'
      };
      return colorMap[this.category] || 'var(--muted)';
    },

    // Resolve CSS var() to actual hex value. ApexCharts builds SVG internally
    // and does not always inherit CSS custom properties from the host element,
    // so we resolve to hex at render time. Re-resolved on theme change via the
    // themeKey watcher below.
    //
    // Use --fg (text color) directly: it gives guaranteed contrast against
    // --bg in both light and dark modes without introducing new DS tokens.
    // Per-category colors were too pale on dark bg; --fg (dark text in light
    // mode, warm off-white in dark mode) reads cleanly in both.
    resolvedCategoryColor() {
      const value = getComputedStyle(document.documentElement).getPropertyValue('--fg').trim();
      return value || this.categoryColor;
    },

    // Bump on theme change to force ApexCharts to re-render with new colors.
    themeKey() {
      return document.documentElement.getAttribute('data-theme') || 'light';
    }
  },

  watch: {
    themeKey() {
      // Watching themeKey causes chartOptions to re-compute (resolvedCategoryColor
      // depends on document.documentElement), which triggers ApexCharts re-render.
    }
  },

  async mounted() {
    // Listen for theme changes so the sparkline color updates without a route
    // change. Without this, toggling dark mode leaves the curve the old color.
    this.themeObserver = new MutationObserver(() => {
      // Trigger chartOptions re-computation by reading the attr (already in
      // themeKey getter). Forcing a no-op update via $forceUpdate is needed
      // because Vue's reactivity does not track DOM attribute reads.
      this.$forceUpdate();
    });
    this.themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme']
    });

    await this.loadPriceData();
  },

  beforeUnmount() {
    if (this.themeObserver) {
      this.themeObserver.disconnect();
      this.themeObserver = null;
    }
  },

  methods: {
    /** UI language ('en'|'es') — drives the data-layer localization.
     *  Method, NOT computed (a computed cannot be invoked as a function). */
    uiLocale() {
      return (this.$i18n && this.$i18n.locale) || localStorage.getItem('userLocale') || 'en';
    },
    /** Compact commodity name — SAME algorithm as the chart's
     *  baseSeriesName (MarketPriceChart.vue) so codes and legends agree.
     *  Method, NOT computed. */
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
    /** ≤3-letter commodity code + country tag, e.g. "CAB-GT", "DAP-US". */
    commodityCode(name) {
      const raw = typeof name === 'string' ? name : '';
      const short = this.baseSeriesName(raw);
      const base = ((short.split(/\s+/)[0] || '?').slice(0, 3).toUpperCase() || '???').slice(0, 3);
      const countryMap = [
        ['EL SALVADOR', 'SV'],
        ['HONDURAS', 'HN'],
        ['GUATEMALA', 'GT'],
        ['COSTA RICA', 'CR'],
        ['NICARAGUA', 'NI'],
        ['BRAZIL', 'BR'],
        ['US GULF', 'US'],
        ['UNITED STATES', 'US'],
        ['MIDDLE EAST', 'ME'],
        ['WORLD', 'INT']
      ];
      const hit = countryMap.find(([needle]) => raw.toUpperCase().includes(needle));
      return hit ? `${base}-${hit[1]}` : base;
    },
    /** Sparkline tooltip date — handles daily, monthly and annual keys;
     *  rendered in the UI language, not the browser's. */
    formatSparkTooltipDate(value) {
      if (value === null || value === undefined) return '';
      const s = String(value);
      const locale = agriDateLocale(this.uiLocale());
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        return new Date(`${s}T00:00:00`).toLocaleDateString(locale, {
          year: 'numeric',
          month: 'short',
          day: 'numeric'
        });
      }
      if (/^\d{4}-\d{2}$/.test(s)) {
        return new Date(`${s}-01T00:00:00`).toLocaleDateString(locale, { year: 'numeric', month: 'long' });
      }
      if (/^\d{4}$/.test(s)) return s;
      return s;
    },
    async loadPriceData() {
      this.loading = true;
      try {
        const envelope = await agriApiService.getMarketPrices(this.category);
        const series = (envelope.data && envelope.data.series) || [];
        this.allSeries = series;
        const primary = series[0];
        if (primary && primary.data && primary.data.length > 0) {
          // Legacy shape: {title, unit, data:[{year, value}], trend, dataSource}
          this.priceData = {
            ...envelope.data,
            dataSource: envelope.meta.source,
            data: primary.data.map((p) => ({ year: p.date, value: p.value }))
          };
          this.timeSeries = this.priceData.data;
        }
      } catch (error) {
        console.error(`Error loading price data for ${this.category}:`, error);
      } finally {
        this.loading = false;
      }
    },

    openChart() {
      this.$emit('open-chart', this.category);
    }
  }
};
</script>

<style scoped>
.market-price-summary-card {
  cursor: pointer;
  transition: transform var(--transition-fast);
}

.card-content {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
}

.card-main {
  display: flex;
  gap: var(--space-sm);
  width: 100%;
}

.sparkline-container {
  width: 60px;
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.sparkline-loading,
.sparkline-empty {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: var(--text-xs);
  color: var(--muted);
}

.sparkline-chart {
  width: 100%;
  height: 100%;
}

.card-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  min-width: 0;
}

.card-label {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--fg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-value-row {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}

.card-value {
  font-size: var(--text-md);
  font-weight: 700;
  color: var(--fg);
}

.trend-pill {
  font-size: var(--text-xs);
  flex-shrink: 0;
}

/* Commodity acronym chips — left-aligned under the sparkline; grid of 3
   columns when numerous (grains) so the card never gets tall */
.card-codes {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  overflow: hidden;
}

.card-codes--grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  justify-items: start;
}

.card-code {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.65rem;
  line-height: 1.1;
  font-weight: 600;
  color: var(--muted);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm, 6px);
  padding: 2px 5px;
  white-space: nowrap;
  cursor: help;
  max-width: 100%;
  overflow: hidden;
}

.card-code--primary {
  border-color: var(--accent);
  color: var(--fg);
}

.card-code__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex: 0 0 auto;
}

@media (max-width: 768px) {
  .sparkline-container {
    width: 50px;
    height: 50px;
  }

  .card-label {
    font-size: var(--text-xs);
  }

  .card-value {
    font-size: var(--text-sm);
  }
}
</style>
