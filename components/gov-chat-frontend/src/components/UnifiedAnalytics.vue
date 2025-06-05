<!-- UnifiedAnalytics.vue - Updated version with proper date range handling for all charts -->
<template>
  <div class="analytics-modal" @click.self="close">
    <div class="analytics-content" :key="'analytics-content-' + currentLocale">
      <div class="analytics-header">
        <h2 style="color: var(--text-primary) !important">
          {{ $t("analytics.title") }}
        </h2>
        <button class="close-btn" @click="close" aria-label="Close">×</button>
      </div>

      <div class="analytics-body">
        <!-- Period selector (for dynamic mode) -->
        <div v-if="useDynamicData" class="period-selector">
          <label style="color: var(--text-primary) !important">{{
            translate("analytics.period")
          }}</label>
          <select
            v-model="selectedPeriod"
            @change="loadAnalytics"
            style="background-color: var(--bg-dialog) !important"
          >
            <option value="daily">
              {{ translate("analytics.periods.daily") }}
            </option>
            <option value="weekly">
              {{ translate("analytics.periods.weekly") }}
            </option>
            <option value="monthly">
              {{ translate("analytics.periods.monthly") }}
            </option>
            <option value="all-time">
              {{ translate("analytics.periods.allTime") }}
            </option>
          </select>

          <!-- Date picker (hidden for all-time) -->
          <div v-if="selectedPeriod !== 'all-time'" class="date-picker">
            <input
              type="date"
              v-model="selectedDate"
              @change="loadAnalytics"
              :max="todayStr"
              style="background-color: var(--bg-dialog) !important"
            />
          </div>
        </div>

        <!-- Loading state -->
        <div v-if="isLoading" class="loading-container">
          <div class="spinner"></div>
          <p>{{ translate("analytics.loading") }}</p>
        </div>

        <!-- Error state -->
        <div v-else-if="error" class="error-container">
          <p class="error-message">{{ error }}</p>
          <button @click="loadAnalytics" class="retry-button">
            {{ translate("analytics.retry") }}
          </button>
        </div>

        <!-- Dashboard content -->
        <div v-else class="dashboard-content">
          <!-- Usage Trend Chart -->
          <div class="analytics-section">
            <usage-trend-chart
              ref="usageTrendChart"
              :data="timeSeriesData"
              :externalData="true"
              :showPeriodSelector="true"
              :showDualChart="true"
              @period-change="onPeriodChange"
            />
          </div>

          <!-- Key metrics summary -->
          <div class="metrics-summary">
            <div class="metric-card">
              <h3>{{ translate("analytics.metrics.totalQueries") }}</h3>
              <div class="metric-value">
                {{ formatValue(analytics.totalQueries) }}
              </div>
              <div
                v-if="comparison.totalQueries"
                class="trend"
                :class="getTrendClass(comparison.totalQueries)"
              >
                {{ formatTrend(comparison.totalQueries) }}
              </div>
            </div>

            <div class="metric-card">
              <h3>{{ translate("analytics.metrics.uniqueUsers") }}</h3>
              <div class="metric-value">
                {{ formatValue(analytics.uniqueUsers) }}
              </div>
              <div
                v-if="comparison.uniqueUsers"
                class="trend"
                :class="getTrendClass(comparison.uniqueUsers)"
              >
                {{ formatTrend(comparison.uniqueUsers) }}
              </div>
            </div>

            <div class="metric-card">
              <h3>{{ translate("analytics.metrics.avgResponseTime") }}</h3>
              <div class="metric-value">
                {{ formatValue(analytics.averageResponseTime, "time") }}
              </div>
              <div
                v-if="comparison.averageResponseTime"
                class="trend"
                :class="getTrendClass(comparison.averageResponseTime, true)"
              >
                {{ formatTrend(comparison.averageResponseTime, true) }}
              </div>
            </div>

            <div class="metric-card">
              <h3>{{ translate("analytics.metrics.satisfaction") }}</h3>
              <div class="metric-value">
                {{ formatValue(analytics.satisfactionRate, "percent") }}
              </div>
              <div
                v-if="comparison.satisfactionRate"
                class="trend"
                :class="getTrendClass(comparison.satisfactionRate)"
              >
                {{ formatTrend(comparison.satisfactionRate) }}
              </div>
            </div>
          </div>

          <!-- Satisfaction charts section -->
          <div class="satisfaction-charts">
            <h3 class="satisfaction-title">
              {{
                translate(
                  "analytics.satisfactionAnalysis",
                  "User Satisfaction Analysis"
                )
              }}
            </h3>
            <div class="satisfaction-container">
              <!-- Satisfaction Gauge Chart -->
              <div class="analytics-section half-width">
                <satisfaction-gauge
                  :value="analytics.satisfactionGaugeData?.currentValue || 0"
                  :historical-data="
                    analytics.satisfactionGaugeData?.historicalData || []
                  "
                  :change-percentage="
                    analytics.satisfactionGaugeData?.changePercentage || 0
                  "
                  :target="analytics.satisfactionGaugeData?.target || 85"
                  :external-data="true"
                  :render-key="currentLocale"
                />
              </div>

              <!-- Satisfaction Heatmap Chart -->
              <div class="analytics-section half-width">
                <satisfaction-heatmap
                  :data="analytics.satisfactionHeatmapData"
                  :external-data="true"
                  :period="selectedPeriod"
                  :selected-date="selectedDate"
                  :render-key="currentLocale"
                />
              </div>
            </div>
          </div>

          <div class="charts-container">
            <!-- Top Queries Section -->
            <div class="analytics-section half-width">
              <h3>{{ translate("analytics.topQueries") }}</h3>
              <top-queries-chart
                v-if="analytics.topQueries && analytics.topQueries.length > 0"
                :data="analytics.topQueries"
                :external-data="true"
              />
              <div v-else class="no-data">
                {{ translate("analytics.noData") }}
              </div>
            </div>

            <!-- Service Categories Usage -->
            <div class="analytics-section half-width">
              <h3>{{ translate("analytics.serviceUsage") }}</h3>
              <category-distribution-chart
                v-if="
                  analytics.queryDistribution &&
                  analytics.queryDistribution.length > 0
                "
                :data="analytics.queryDistribution"
                :external-data="true"
                :render-key="currentLocale"
              />
              <div v-else class="category-chart-container">
                <div v-if="categoryLoading" class="chart-loading">
                  {{ translate("analytics.loading") }}
                </div>
                <div v-else class="no-data">
                  {{ translate("analytics.noData") }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import UsageTrendChart from "./charts/UsageTrendChart.vue";
import TopQueriesChart from "./charts/TopQueriesChart.vue";
import CategoryDistributionChart from "./charts/CategoryDistributionChart.vue";
import SatisfactionGauge from "./charts/SatisfactionGauge.vue";
import SatisfactionHeatmap from "./charts/SatisfactionHeatmap.vue";
import analyticsService from "../services/analyticsService";

export default {
  name: "UnifiedAnalytics",
  components: {
    UsageTrendChart,
    TopQueriesChart,
    CategoryDistributionChart,
    SatisfactionGauge,
    SatisfactionHeatmap,
  },

  emits: ["close"],

  data() {
    return {
      // CONFIGURE HERE: Set to false for static sample data, true for API calls
      useDynamicData: true, // false = static data, true = dynamic data

      isLoading: false,
      categoryLoading: false,
      error: null,
      selectedPeriod: "monthly",
      selectedDate: new Date().toISOString().split("T")[0], // Today's date in YYYY-MM-DD format
      currentLocale: this.$i18n ? this.$i18n.locale : "en",

      // Analytics data
      analytics: {
        totalQueries: 0,
        uniqueUsers: 0,
        averageResponseTime: 0,
        satisfactionRate: 0,
        queryDistribution: [],
        topQueries: [],
        satisfactionGaugeData: null, // Store gauge data
        satisfactionHeatmapData: [], // Store heatmap data
      },
      comparison: {
        totalQueries: null,
        uniqueUsers: null,
        averageResponseTime: null,
        satisfactionRate: null,
      },
      timeSeriesData: [],

      // Translation data
      translatedTopQueries: [],
      translatedCategories: [],

      // Static sample data for non-dynamic mode
      staticData: {
        totalQueries: 12452,
        uniqueUsers: 3847,
        averageResponseTime: 2.3,
        satisfactionRate: 87.5,
        queryDistribution: [
          {
            categoryId: "cat1",
            name: "Business & Economy",
            count: 2347,
            value: 24,
          },
          {
            categoryId: "cat2",
            name: "Transportation",
            count: 1782,
            value: 18,
          },
          {
            categoryId: "cat3",
            name: "Taxes & Revenue",
            count: 1645,
            value: 16,
          },
          {
            categoryId: "cat4",
            name: "Immigration & Citizenship",
            count: 1245,
            value: 12,
          },
          {
            categoryId: "cat5",
            name: "Education & Learning",
            count: 980,
            value: 10,
          },
          {
            categoryId: "cat6",
            name: "Housing & Properties",
            count: 850,
            value: 8,
          },
          {
            categoryId: "cat7",
            name: "Health & Healthcare",
            count: 720,
            value: 6,
          },
          { categoryId: "cat8", name: "Others", count: 650, value: 6 },
        ],
        topQueries: [],
      },
    };
  },

  computed: {
    /**
     * Today's date in YYYY-MM-DD format
     */
    todayStr() {
      return new Date().toISOString().split("T")[0];
    },
  },

  created() {
    // Initialize analytics service with i18n instance
    analyticsService.setI18n(this.$i18n);

    // Initialize translations
    this.translateQueries();
    this.translateCategories();

    // Initialize static top queries with translated queries
    this.staticData.topQueries = [...this.translatedTopQueries];

    if (this.useDynamicData) {
      this.loadAnalytics();
    } else {
      this.loadStaticData();
    }

    // Listen for locale changes
    if (this.$i18n) {
      this.currentLocale = this.$i18n.locale;
      this.$watch("$i18n.locale", (newLocale) => {
        console.log("Locale changed in UnifiedAnalytics:", newLocale);

        // Update current locale
        this.currentLocale = newLocale;

        // Update i18n in analytics service
        analyticsService.setI18n(this.$i18n);

        // Update translations
        this.translateQueries();
        this.translateCategories();

        // Reload analytics with new locale
        if (this.useDynamicData) {
          this.loadAnalytics();
        }

        // Also tell the usage chart to update
        if (this.$refs.usageTrendChart) {
          this.$refs.usageTrendChart.updateTranslations();
        }
      });
    }
  },

  mounted() {
    // Add resize listener
    window.addEventListener("resize", this.handleResize);
    console.log("UnifiedAnalytics mounted with locale:", this.currentLocale);
  },

  beforeUnmount() {
    window.removeEventListener("resize", this.handleResize);
  },

  methods: {
    /**
     * Custom translation method to ensure correct locale is used
     */
    translate(key, fallback = "") {
      if (!this.$i18n) return fallback;

      try {
        // Force the correct locale
        const translation = this.$i18n.t(key, { locale: this.currentLocale });
        if (translation === key) {
          return fallback || key;
        }
        return translation;
      } catch (e) {
        console.error("Translation error:", e);
        return fallback || key;
      }
    },

    /**
     * Handle period change from usage trend chart
     */
    onPeriodChange(period) {
      this.selectedPeriod = period;
      if (this.useDynamicData) {
        this.loadAnalytics();
      }
    },

    /**
     * Translate top queries based on current locale
     */
    translateQueries() {
      const sampleQueriesPerLanguage = {
        en: [
          {
            text: "How do I apply for a business license?",
            count: 2347,
            avgTime: 2.3,
          },
          { text: "Where can I find tax forms?", count: 1982, avgTime: 1.8 },
          {
            text: "How to renew my driver's license?",
            count: 1645,
            avgTime: 2.1,
          },
          {
            text: "What documents do I need for passport application?",
            count: 1423,
            avgTime: 3.4,
          },
          { text: "When are property taxes due?", count: 1289, avgTime: 1.5 },
        ],
        fr: [
          {
            text: "Comment faire une demande de licence commerciale?",
            count: 2347,
            avgTime: 2.3,
          },
          {
            text: "Où puis-je trouver des formulaires fiscaux?",
            count: 1982,
            avgTime: 1.8,
          },
          {
            text: "Comment renouveler mon permis de conduire?",
            count: 1645,
            avgTime: 2.1,
          },
          {
            text: "Quels documents me faut-il pour une demande de passeport?",
            count: 1423,
            avgTime: 3.4,
          },
          {
            text: "Quand les taxes foncières sont-elles dues?",
            count: 1289,
            avgTime: 1.5,
          },
        ],
        sw: [
          {
            text: "Nawezaje kuomba leseni ya biashara?",
            count: 2347,
            avgTime: 2.3,
          },
          {
            text: "Naweza kupata fomu za kodi wapi?",
            count: 1982,
            avgTime: 1.8,
          },
          {
            text: "Jinsi ya kufanya upya leseni yangu ya udereva?",
            count: 1645,
            avgTime: 2.1,
          },
          {
            text: "Ni nyaraka gani ninahitaji kwa maombi ya pasipoti?",
            count: 1423,
            avgTime: 3.4,
          },
          { text: "Kodi za mali hulipwa lini?", count: 1289, avgTime: 1.5 },
        ],
      };

      // Use current locale or fall back to English
      const locale = this.currentLocale || "en";
      this.translatedTopQueries =
        sampleQueriesPerLanguage[locale] || sampleQueriesPerLanguage["en"];
    },

    /**
     * Translate categories based on current locale
     */
    translateCategories() {
      const categoryDataPerLanguage = {
        en: [
          { category: "Business & Economy", value: 24 },
          { category: "Transportation", value: 18 },
          { category: "Taxes & Revenue", value: 16 },
          { category: "Immigration & Citizenship", value: 12 },
          { category: "Education & Learning", value: 10 },
          { category: "Housing & Properties", value: 8 },
          { category: "Others", value: 12 },
        ],
        fr: [
          { category: "Affaires & Économie", value: 24 },
          { category: "Transport", value: 18 },
          { category: "Impôts & Recettes", value: 16 },
          { category: "Immigration & Citoyenneté", value: 12 },
          { category: "Éducation & Apprentissage", value: 10 },
          { category: "Logement & Propriétés", value: 8 },
          { category: "Autres", value: 12 },
        ],
        sw: [
          { category: "Biashara & Uchumi", value: 24 },
          { category: "Usafiri", value: 18 },
          { category: "Kodi & Mapato", value: 16 },
          { category: "Uhamiaji & Uraia", value: 12 },
          { category: "Elimu & Mafunzo", value: 10 },
          { category: "Makazi & Mali", value: 8 },
          { category: "Nyinginezo", value: 12 },
        ],
      };

      // Use current locale or fall back to English
      const locale = this.currentLocale || "en";
      this.translatedCategories =
        categoryDataPerLanguage[locale] || categoryDataPerLanguage["en"];

      // Update static data with translated categories
      if (this.staticData.queryDistribution) {
        this.translatedCategories.forEach((item, index) => {
          if (index < this.staticData.queryDistribution.length) {
            this.staticData.queryDistribution[index].name = item.category;
          }
        });
      }
    },

    /**
     * Close the analytics modal
     */
    close() {
      this.$emit("close");
    },

    /**
     * Handle window resize
     */
    handleResize() {
      // This will trigger resizing in child components as needed
    },

    /**
     * Load static sample data
     */
    loadStaticData() {
      this.isLoading = true;

      // Simulate loading delay for consistent UX
      setTimeout(() => {
        this.analytics = {
          ...this.staticData,
          satisfactionGaugeData: {
            currentValue: 87.5,
            changePercentage: 1.2,
            historicalData: [
              { label: "Previous Month", value: 86.3 },
              { label: "Two Months Ago", value: 85.0 },
            ],
            target: 85,
          },
          satisfactionHeatmapData: this.staticData.queryDistribution.map(
            (category) => ({
              name: category.name,
              data: [
                { x: "4 Weeks Ago", y: 75 + Math.random() * 10 },
                { x: "3 Weeks Ago", y: 78 + Math.random() * 10 },
                { x: "2 Weeks Ago", y: 80 + Math.random() * 10 },
                { x: "Last Week", y: 82 + Math.random() * 10 },
                { x: "Current", y: 85 + Math.random() * 10 },
              ],
            })
          ),
        };

        // Ensure top queries data is available
        if (
          !this.analytics.topQueries ||
          this.analytics.topQueries.length === 0
        ) {
          this.analytics.topQueries = [...this.translatedTopQueries];
        }

        // Generate static time series data
        this.timeSeriesData = this.getStaticTimeSeriesData();

        // Set some sample comparison data
        this.comparison = {
          totalQueries: 5.2,
          uniqueUsers: 3.8,
          averageResponseTime: -0.3,
          satisfactionRate: 1.2,
        };

        this.isLoading = false;
      }, 500);
    },

    /**
     * Load dynamic analytics data from the API
     */
    async loadAnalytics() {
      if (!this.useDynamicData) {
        this.loadStaticData();
        return;
      }

      this.isLoading = true;
      this.error = null;

      try {
        console.log(`Loading analytics with locale: ${this.currentLocale}`);

        // Get main analytics data
        const analyticsData = await analyticsService.getDashboardAnalytics(
          this.selectedPeriod,
          this.selectedDate,
          this.currentLocale
        );

        // Get satisfaction gauge data
        const gaugeData = await analyticsService.getSatisfactionGauge(
          this.selectedPeriod,
          this.selectedDate,
          this.currentLocale
        );
        console.log(
          "[UnifiedAnalytics] Gauge data received:",
          JSON.stringify(gaugeData, null, 2)
        ); // Detailed debug log

        // Get satisfaction heatmap data
        const heatmapData = await analyticsService.getSatisfactionHeatmap(
          this.selectedPeriod,
          this.selectedDate,
          this.currentLocale
        );

        // Update analytics data with fallback values
        this.analytics = {
          ...analyticsData,
          satisfactionGaugeData: {
            currentValue: gaugeData?.currentValue || 0,
            historicalData: gaugeData?.historicalData || [],
            changePercentage: gaugeData?.changePercentage || 0,
            target: gaugeData?.target || 85,
          },
          satisfactionRate: gaugeData?.currentValue || 0,
          satisfactionHeatmapData: heatmapData || [],
        };

        console.log(
          "[UnifiedAnalytics] Analytics data updated:",
          JSON.stringify(this.analytics.satisfactionGaugeData, null, 2)
        ); // Confirm prop data

        // Get comparison data
        await this.loadComparisonData();

        // Get time series data
        await this.loadTimeSeriesData();
      } catch (error) {
        console.error("Error loading analytics data:", error);
        this.error = this.translate(
          "analytics.errors.loading",
          `Failed to load analytics data: ${error.message}`
        );
      } finally {
        this.isLoading = false;
      }
    },

    /**
     * Generate static time series data
     */
    getStaticTimeSeriesData() {
      const now = new Date();
      const result = [];

      // Generate data based on selected period
      if (this.selectedPeriod === "daily") {
        // Hourly data for today
        for (let hour = 0; hour < 24; hour++) {
          const time = new Date(now);
          time.setHours(hour, 0, 0, 0);

          // More activity during business hours
          const baseValue = hour >= 9 && hour <= 17 ? 50 : 20;
          const value = Math.round(baseValue * (0.8 + Math.random() * 0.4));

          result.push({
            timestamp: time.toISOString(),
            dateLabel: time.toLocaleTimeString(this.currentLocale, {
              hour: "2-digit",
              minute: "2-digit",
            }),
            value: value,
          });
        }
      } else if (this.selectedPeriod === "weekly") {
        // Daily data for the week
        for (let day = 6; day >= 0; day--) {
          const date = new Date(now);
          date.setDate(date.getDate() - day);
          date.setHours(0, 0, 0, 0);

          // Less activity on weekends
          const isWeekend = date.getDay() === 0 || date.getDay() === 6;
          const baseValue = isWeekend ? 200 : 350;
          const value = Math.round(baseValue * (0.8 + Math.random() * 0.4));

          result.push({
            timestamp: date.toISOString(),
            dateLabel: date.toLocaleDateString(this.currentLocale, {
              month: "short",
              day: "numeric",
            }),
            value: value,
          });
        }
      } else {
        // Monthly data (last 30 days)
        for (let day = 29; day >= 0; day--) {
          const date = new Date(now);
          date.setDate(date.getDate() - day);
          date.setHours(0, 0, 0, 0);

          // Weekend pattern (lower on weekends)
          const isWeekend = date.getDay() === 0 || date.getDay() === 6;
          const baseValue = isWeekend ? 200 : 350;

          // Add some random variation
          const value = Math.round(baseValue * (0.8 + Math.random() * 0.4));

          result.push({
            timestamp: date.toISOString(),
            dateLabel: date.toLocaleDateString(this.currentLocale, {
              month: "short",
              day: "numeric",
            }),
            value: value,
          });
        }
      }

      return result;
    },

    /**
     * Load comparison data for trend indicators
     */
    async loadComparisonData() {
      try {
        // Calculate the previous period based on current selection
        const { previousPeriod, previousDate } = this.calculatePreviousPeriod();

        // Get comparison data for all key metrics
        const metrics = [
          "totalQueries",
          "uniqueUsers",
          "averageResponseTime",
          "satisfactionRate",
        ];

        // Process each metric one by one
        for (const metric of metrics) {
          const comparisonData = await analyticsService.getComparisonData(
            metric,
            this.selectedPeriod,
            this.selectedDate,
            previousPeriod,
            previousDate,
            this.currentLocale // Pass the current locale
          );

          // Calculate percentage change
          if (
            comparisonData.previous !== null &&
            comparisonData.previous !== undefined
          ) {
            this.comparison[metric] = this.calculatePercentChange(
              comparisonData.current,
              comparisonData.previous
            );
          } else {
            this.comparison[metric] = null;
          }
        }
      } catch (error) {
        console.error("Error loading comparison data:", error);
        // Non-critical error, continue without comparison data
        this.comparison = {
          totalQueries: null,
          uniqueUsers: null,
          averageResponseTime: null,
          satisfactionRate: null,
        };
      }
    },

    /**
     * Load time series data for charts
     */
    async loadTimeSeriesData() {
      try {
        // Determine the appropriate interval and date range
        const { interval, startDate, endDate } =
          this.calculateTimeSeriesParams();

        this.timeSeriesData = await analyticsService.getTimeSeriesData(
          "queries",
          interval,
          startDate,
          endDate,
          this.currentLocale // Pass the current locale
        );
      } catch (error) {
        console.error("Error loading time series data:", error);
        this.timeSeriesData = this.getStaticTimeSeriesData();
      }
    },

    /**
     * Format numeric values for display
     */
    formatValue(value, format = "number") {
      return analyticsService.formatValue(value, format, this.currentLocale);
    },

    /**
     * Format trend percentage for display
     */
    formatTrend(percentChange, isInverse = false) {
      const prefix = percentChange > 0 ? "+" : "";
      const suffix = isInverse
        ? percentChange > 0
          ? " " + this.translate("analytics.slower")
          : " " + this.translate("analytics.faster")
        : "";

      return `${prefix}${percentChange.toFixed(1)}%${suffix}`;
    },

    /**
     * Get CSS class for trend indicator
     */
    getTrendClass(change, isInverse = false) {
      return analyticsService.getTrendColor(change, isInverse);
    },

    /**
     * Calculate previous period based on current selection
     */
    calculatePreviousPeriod() {
      const currentDate = new Date(this.selectedDate);
      let previousDate, previousPeriod;

      switch (this.selectedPeriod) {
        case "daily":
          // Previous day
          previousDate = new Date(currentDate);
          previousDate.setDate(currentDate.getDate() - 1);
          previousPeriod = "daily";
          break;

        case "weekly":
          // Previous week
          previousDate = new Date(currentDate);
          previousDate.setDate(currentDate.getDate() - 7);
          previousPeriod = "weekly";
          break;

        case "monthly":
          // Previous month
          previousDate = new Date(currentDate);
          previousDate.setMonth(currentDate.getMonth() - 1);
          previousPeriod = "monthly";
          break;

        case "all-time":
          // Compare with previous equivalent time period
          // For all-time, we'll compare with half the total time
          previousPeriod = "all-time";
          previousDate = null; // Not needed for all-time
          break;
      }

      return {
        previousPeriod,
        previousDate: previousDate
          ? previousDate.toISOString().split("T")[0]
          : null,
      };
    },

    /**
     * Calculate time series parameters based on current selection
     */
    calculateTimeSeriesParams() {
      let interval, startDate, endDate;

      // End date is always selected date or today
      endDate = this.selectedDate || new Date().toISOString().split("T")[0];

      switch (this.selectedPeriod) {
        case "daily":
          // For daily view, show hourly data for the selected day
          interval = "hourly";
          startDate = endDate;
          break;

        case "weekly":
          // For weekly view, show daily data for the week
          interval = "daily";
          startDate = new Date(
            new Date(endDate).setDate(new Date(endDate).getDate() - 6)
          )
            .toISOString()
            .split("T")[0];
          break;

        case "monthly":
          // For monthly view, show daily data for the month
          interval = "daily";
          startDate = new Date(
            new Date(endDate).setDate(new Date(endDate).getDate() - 29)
          )
            .toISOString()
            .split("T")[0];
          break;

        case "all-time":
          // For all-time view, show monthly data
          interval = "monthly";
          startDate = "2020-01-01"; // Arbitrary start date in the past
          break;
      }

      return { interval, startDate, endDate };
    },

    /**
     * Calculate percentage change between two values
     */
    calculatePercentChange(current, previous) {
      return analyticsService.calculatePercentChange(current, previous);
    },
  },
};
</script>

<style scoped>
.analytics-modal {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.analytics-content {
  background: var(--bg-dialog, white);
  border-radius: 8px;
  width: 90%;
  max-width: 1200px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-md, 0 5px 20px rgba(0, 0, 0, 0.2));
  overflow: hidden;
}

.analytics-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border-color, #eee);
}

.analytics-header h2 {
  margin: 0;
  font-size: 1.5rem;
  color: var(--text-primary, #333);
}

.close-btn {
  background: none;
  border: none;
  font-size: 24px;
  cursor: pointer;
  color: var(--text-secondary, #666);
}

.analytics-body {
  padding: 20px;
  overflow-y: auto;
  flex: 1;
  background-color: var(--bg-dialog, white);
  color: var(--text-primary, #333);
}

.period-selector {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 20px;
  padding-bottom: 15px;
  border-bottom: 1px solid var(--border-color, #eee);
  color: var(--text-primary, #333);
}

.period-selector label {
  color: var(--text-primary, #333);
  font-weight: 600;
}

.period-selector select,
.period-selector input {
  padding: 8px;
  border: 1px solid var(--border-input, #ddd);
  border-radius: 4px;
  background-color: var(--bg-input, white);
  color: var(--text-primary, #333);
}

.loading-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px;
  text-align: center;
  min-height: 300px;
}

.loading-container p {
  color: var(--text-primary, #333);
  margin-top: 15px;
}

.spinner {
  border: 4px solid rgba(0, 0, 0, 0.1);
  border-radius: 50%;
  border-top: 4px solid var(--accent-color, #4e97d1);
  width: 40px;
  height: 40px;
  animation: spin 1s linear infinite;
  margin-bottom: 20px;
}

@keyframes spin {
  0% {
    transform: rotate(0deg);
  }

  100% {
    transform: rotate(360deg);
  }
}

.error-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px;
  text-align: center;
  min-height: 300px;
}

.error-message {
  color: var(--status-outage, #d32f2f);
  margin-bottom: 20px;
}

.retry-button {
  padding: 8px 16px;
  background-color: var(--bg-button-primary, #4e97d1);
  color: var(--text-button-primary, white);
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

.retry-button:hover {
  background-color: var(--accent-hover, #3a7da0);
}

.dashboard-content {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.analytics-section {
  margin-bottom: 24px;
  background: var(--bg-card, white);
  border-radius: 8px;
  box-shadow: var(--shadow-sm, 0 2px 12px rgba(0, 0, 0, 0.1));
  padding: 16px;
}

.analytics-section h3 {
  margin-top: 0;
  margin-bottom: 16px;
  font-size: 1.2rem;
  color: var(--text-primary, #333);
  font-weight: 600;
}

.metrics-summary {
  display: flex;
  justify-content: space-between;
  width: 100%;
  gap: 15px;
  margin-bottom: 20px;
}

.metric-card {
  flex: 1;
  background-color: var(--bg-card, white);
  border-radius: 8px;
  padding: 16px;
  box-shadow: var(--shadow-sm, 0 2px 4px rgba(0, 0, 0, 0.1));
  text-align: center;
}

.metric-card h3 {
  margin-top: 0;
  margin-bottom: 10px;
  font-size: 14px;
  color: var(--text-primary, #333);
  font-weight: 600;
}

.metric-value {
  font-size: 24px;
  font-weight: bold;
  margin-bottom: 5px;
  color: var(--text-primary, #333);
  text-shadow: 0 0 1px var(--text-primary, rgba(51, 51, 51, 0.2));
}

.trend {
  font-size: 12px;
}

.trend.positive {
  color: var(--status-operational, #4caf50);
}

.trend.negative {
  color: var(--status-outage, #f44336);
}

.trend.neutral {
  color: var(--text-secondary, #757575);
}

/* Make sure the neutral trend is visible in dark mode */
[data-theme="dark"] .trend.neutral {
  color: var(--text-primary, #f0f0f0);
}

.charts-container {
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
}

.half-width {
  flex: 1;
  min-width: calc(50% - 10px);
}

.category-chart-container {
  position: relative;
  width: 100%;
  height: 320px;
}

.category-usage {
  width: 100%;
  height: 100%;
}

.chart-loading {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: var(--bg-card, rgba(255, 255, 255, 0.8));
  opacity: 0.8;
  font-size: 1rem;
  color: var(--text-primary, #666);
}

.no-data {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 200px;
  color: var(--text-tertiary, #757575);
  font-style: italic;
}

/* Fix dark mode spinner */
[data-theme="dark"] .spinner {
  border-color: rgba(255, 255, 255, 0.1);
  border-top-color: var(--accent-color, #4e97d1);
}

/* Fix chart background in dark mode */
[data-theme="dark"] .chart-container {
  background-color: #d9d9d9 !important; /* Light gray for chart area in dark mode */
}

/* Metric cards background - conditional for dark mode */
[data-theme="dark"] .metric-card,
.dark-theme .metric-card,
.dark-mode .metric-card {
  background-color: #414141 !important; /* Match main background for dark mode */
}

/* Analytics sections - conditional for dark mode */
[data-theme="dark"] .analytics-section,
.dark-theme .analytics-section,
.dark-mode .analytics-section {
  background-color: #414141 !important; /* Match main background for dark mode */
}

/* Top queries and knowledge area containers - conditional for dark mode */
[data-theme="dark"] .half-width,
.dark-theme .half-width,
.dark-mode .half-width {
  background-color: #414141 !important; /* Match main background for dark mode */
}

.satisfaction-charts {
  margin-bottom: 20px;
}

.satisfaction-title {
  margin-top: 0;
  margin-bottom: 16px;
  font-size: 1.2rem;
  color: var(--text-primary, #333);
  font-weight: 600;
}

.satisfaction-container {
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
  margin-bottom: 10px;
}

/* Add this to the existing media query for mobile screens */
@media (max-width: 768px) {
  .analytics-content {
    width: 95%;
    max-height: 95vh;
  }

  .analytics-header h2 {
    font-size: 1.3rem;
  }

  .charts-container {
    flex-direction: column;
  }

  .half-width {
    width: 100%;
  }

  .metrics-summary {
    flex-wrap: wrap;
  }

  .metric-card {
    min-width: calc(50% - 10px);
  }

  /* Force white text for metric titles and values in dark mode */
  [data-theme="dark"] .metric-card h3,
  [data-theme="dark"] .metric-value {
    color: #ffffff !important;
  }

  /* Force white text for section titles in dark mode */
  [data-theme="dark"] .analytics-section h3 {
    color: #ffffff !important;
  }

  /* Force white text for "Total Queries", "Unique Users", etc. */
  [data-theme="dark"] h3 {
    color: #ffffff !important;
  }

  .satisfaction-container {
    flex-direction: column;
  }

  /* Force white text for satisfaction title in dark mode */
  [data-theme="dark"] .satisfaction-title {
    color: #ffffff !important;
  }
}

/* Add this to the existing dark mode overrides */
[data-theme="dark"] .satisfaction-title,
.dark-theme .satisfaction-title,
.dark-mode .satisfaction-title {
  color: white !important;
  -webkit-text-fill-color: white !important;
  text-shadow: 0 0 1px rgba(255, 255, 255, 0.5) !important;
}

[data-theme="dark"] .analytics-modal {
  --bg-dialog: #414141 !important; /* Set the variable at the modal level */
}

/* Ensure it propagates to the content and body */
[data-theme="dark"] .analytics-content,
[data-theme="dark"] .analytics-body {
  background-color: var(--bg-dialog) !important; /* Use the variable */
}

/* Ensure text is visible in dark mode for analytics */
[data-theme="dark"] .metric-card h3,
[data-theme="dark"] .metrics-summary h3,
[data-theme="dark"] .metric-value,
[data-theme="dark"] .analytics-section h3,
[data-theme="dark"] .metrics-summary .metric-value,
[data-theme="dark"] .dashboard-content h3 {
  color: white !important;
  -webkit-text-fill-color: white !important;
  text-shadow: 0 0 1px rgba(255, 255, 255, 0.5) !important;
}

/* Direct fix for the dashboard text */
[data-theme="dark"] .dashboard-content .metric-value,
[data-theme="dark"] .metrics-summary .metric-value,
[data-theme="dark"] .metrics-summary h3 {
  color: white !important;
  -webkit-text-fill-color: white !important;
  font-weight: bold !important;
}

/* Ensure section titles are visible */
[data-theme="dark"] .analytics-section h3,
[data-theme="dark"] .half-width h3 {
  color: white !important;
  -webkit-text-fill-color: white !important;
}

/* Extremely specific selectors for metrics values */
[data-theme="dark"] .metric-card > .metric-value,
[data-theme="dark"] .metric-card > div[class*="value"],
[data-theme="dark"] div.metric-value {
  color: white !important;
  -webkit-text-fill-color: white !important;
  text-shadow: 0 0 1px rgba(255, 255, 255, 0.5) !important;
}

/* Dark mode background changes only */
[data-theme="dark"] .analytics-content,
.dark-theme .analytics-content,
.dark-mode .analytics-content {
  background-color: #414141 !important; /* Slightly lighter gray background for dark mode */
}

[data-theme="dark"] .analytics-body,
.dark-theme .analytics-body,
.dark-mode .analytics-body {
  background-color: #414141 !important; /* Match content background for dark mode */
}

/* Chart background only - conditional for dark mode */
[data-theme="dark"] .chart-container,
.dark-theme .chart-container,
.dark-mode .chart-container {
  background-color: #d9d9d9 !important; /* Light gray for chart area in dark mode */
}
</style>