<template>
  <div class="pest-alert-chart">
    <div class="chart-header">
      <div class="header-text">
        <h3>{{ chartTitle }}</h3>
        <p class="chart-subtitle">{{ chartSubtitle }}</p>
      </div>
      <div class="summary-chips">
        <div
          v-for="severity in ['high', 'moderate', 'low']"
          :key="severity"
          :class="['summary-chip', severity]"
          @click="selectedSeverity = severity"
        >
          <i :class="getSeverityIcon(severity)"></i>
          <span class="chip-label">{{ translateSeverity(severity) }}</span>
          <span class="chip-count">{{ getSeverityCount(severity) }}</span>
        </div>
        <div
          :class="['summary-chip', 'all', { active: selectedSeverity === 'all' }]"
          @click="selectedSeverity = 'all'"
        >
          <i class="fas fa-list"></i>
          <span class="chip-label">{{ translate("charts.all", "All") }}</span>
          <span class="chip-count">{{ totalAlerts }}</span>
        </div>
      </div>
    </div>

    <div v-if="loading" class="loading-indicator">
      <i class="fas fa-spinner fa-spin"></i>
      <span>{{ translate("charts.loading", "Loading data...") }}</span>
    </div>

    <div v-else class="alerts-container">
      <!-- Alert Summary Chart -->
      <div class="alert-summary-chart" v-if="!showEmptyState">
        <apexchart
          type="donut"
          height="200"
          :options="summaryChartOptions"
          :series="summaryChartSeries"
        ></apexchart>
        <div class="chart-center-text">
          <div class="total-count">{{ totalAlerts }}</div>
          <div class="total-label">
            {{ translate("charts.activeAlerts", "Active Alerts") }}
          </div>
        </div>
      </div>

      <!-- Empty State -->
      <div v-if="showEmptyState" class="empty-state">
        <i class="fas fa-check-circle"></i>
        <h4>{{ translate("charts.noPestAlerts", "No Active Pest Alerts") }}</h4>
        <p>{{ translate("charts.noPestAlertsDesc", "No pest alerts for the selected severity level.") }}</p>
      </div>

      <!-- Alerts List -->
      <div v-else class="alerts-list">
        <transition-group name="alert-fade" tag="div">
          <div
            v-for="alert in filteredAlerts"
            :key="alert.id"
            :class="['alert-card', alert.severity, { expanded: expandedAlert === alert.id }]"
          >
            <div class="alert-header" @click="toggleAlert(alert.id)">
              <div class="alert-title-section">
                <div class="alert-icon">
                  <i :class="getSeverityIcon(alert.severity)"></i>
                </div>
                <div class="alert-title-content">
                  <h4>{{ alert.pest }}</h4>
                  <span class="scientific-name">{{ alert.scientificName }}</span>
                </div>
              </div>
              <div class="alert-meta">
                <span :class="['severity-badge', alert.severity]">
                  {{ translateSeverity(alert.severity) }}
                </span>
                <span class="toggle-icon">
                  <i :class="expandedAlert === alert.id ? 'fas fa-chevron-up' : 'fas fa-chevron-down'"></i>
                </span>
              </div>
            </div>

            <transition name="expand">
              <div v-if="expandedAlert === alert.id" class="alert-body">
                <div class="alert-description">
                  <i class="fas fa-info-circle"></i>
                  <p>{{ alert.description }}</p>
                </div>

                <div class="alert-details-grid">
                  <div class="detail-item">
                    <i class="fas fa-seedling"></i>
                    <div class="detail-content">
                      <span class="detail-label">
                        {{ translate("charts.affectedCrops", "Affected Crops") }}
                      </span>
                      <span class="detail-value">{{ alert.affectedCrops.join(", ") }}</span>
                    </div>
                  </div>

                  <div class="detail-item">
                    <i class="fas fa-map-marker-alt"></i>
                    <div class="detail-content">
                      <span class="detail-label">
                        {{ translate("charts.areas", "Affected Areas") }}
                      </span>
                      <span class="detail-value">{{ alert.departments.join(", ") }}</span>
                    </div>
                  </div>

                  <div class="detail-item">
                    <i class="fas fa-calendar-alt"></i>
                    <div class="detail-content">
                      <span class="detail-label">
                        {{ translate("charts.firstDetected", "First Detected") }}
                      </span>
                      <span class="detail-value">{{ formatDate(alert.firstDetected) }}</span>
                    </div>
                  </div>
                </div>

                <div class="alert-recommendations">
                  <div class="recommendations-header">
                    <i class="fas fa-lightbulb"></i>
                    <strong>
                      {{ translate("charts.recommendations", "Recommendations") }}
                    </strong>
                  </div>
                  <p>{{ alert.recommendations }}</p>
                </div>

                <!-- Quick Action Buttons -->
                <div class="alert-actions">
                  <button class="action-btn" @click.stop="viewOnMap(alert)">
                    <i class="fas fa-map"></i>
                    <span>{{ translate("charts.viewMap", "View on Map") }}</span>
                  </button>
                  <button class="action-btn" @click.stop="shareAlert(alert)">
                    <i class="fas fa-share-alt"></i>
                    <span>{{ translate("charts.share", "Share") }}</span>
                  </button>
                  <button class="action-btn primary" @click.stop="getAssistance(alert)">
                    <i class="fas fa-question-circle"></i>
                    <span>{{ translate("charts.getAssistance", "Get Assistance") }}</span>
                  </button>
                </div>
              </div>
            </transition>
          </div>
        </transition-group>
      </div>
    </div>

    <!-- Last Updated -->
    <div class="last-updated" v-if="!loading && pestData">
      <i class="fas fa-clock"></i>
      {{ translate("charts.lastUpdated", "Last updated") }}:
      {{ formatDate(lastUpdated) }}
    </div>

    <!-- Assistance Dialog -->
    <div class="dialog-overlay" v-if="showAssistanceDialog" @click.self="closeAssistanceDialog">
      <div class="dialog-container" @click.stop>
        <div class="dialog-header">
          <div class="dialog-title">
            <i class="fas fa-help-circle"></i>
            <span>{{ t('charts.getAssistance') }}: {{ assistanceDialog.pest }}</span>
          </div>
          <button class="close-btn" @click="closeAssistanceDialog">
            <i class="fas fa-times"></i>
          </button>
        </div>
        <div class="dialog-body">
          <div class="dialog-section">
            <label class="dialog-label">{{ t('charts.assistancePrompt') }}</label>
            <div class="prompt-display">
              {{ assistanceDialog.basePrompt }}
            </div>
          </div>
          <div class="dialog-section">
            <label class="dialog-label">{{ t('charts.assistanceInstructions') }}</label>
            <textarea
              v-model="assistanceDialog.userInput"
              :placeholder="t('charts.assistanceHint')"
              class="user-input"
              rows="3"
            ></textarea>
          </div>
        </div>
        <div class="dialog-footer">
          <button class="cancel-btn" @click="closeAssistanceDialog">
            {{ t('common.cancel') }}
          </button>
          <button
            class="submit-btn"
            @click="submitAssistanceQuery"
            :disabled="assistanceDialog.isLoading"
          >
            <i v-if="assistanceDialog.isLoading" class="fas fa-spinner fa-spin"></i>
            <i v-else class="fas fa-paper-plane"></i>
            <span>{{ t('charts.submitQuery') }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Response Dialog -->
    <div class="dialog-overlay" v-if="showResponseDialog" @click.self="closeResponseDialog">
      <div class="dialog-container" @click.stop>
        <div class="dialog-header">
          <div class="dialog-title">
            <i class="fas fa-robot"></i>
            <span>{{ t('charts.aiResponse') }}</span>
          </div>
          <button class="close-btn" @click="closeResponseDialog">
            <i class="fas fa-times"></i>
          </button>
        </div>
        <div class="dialog-body">
          <div class="response-content">
            {{ assistanceDialog.response || t('charts.noResponse') }}
          </div>
        </div>
        <div class="dialog-footer">
          <button class="action-btn" @click="copyResponse">
            <i class="fas fa-copy"></i>
            <span>{{ t('charts.copy') }}</span>
          </button>
          <button class="submit-btn" @click="closeResponseDialog">
            <i class="fas fa-check"></i>
            <span>{{ t('charts.close') }}</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import agriculturalService from "../../services/agriculturalService";
import usdaRssService from "../../services/usdaRssService";
import chatbotService from "../../services/chatbotService";

export default {
  name: "PestAlertChart",
  props: {
    region: {
      type: String,
      default: "Central America",
    },
    autoRefresh: {
      type: Boolean,
      default: false,
    },
    refreshInterval: {
      type: Number,
      default: 600000, // 10 minutes
    },
    userId: {
      type: String,
      default: "anonymous",
    },
    sessionId: {
      type: String,
      default: "pest-alert-session",
    },
  },
  data() {
    return {
      loading: false,
      error: null,
      pestData: null,
      selectedSeverity: "all",
      expandedAlert: null,
      refreshTimer: null,
      showAssistanceDialog: false,
      showResponseDialog: false,
      assistanceDialog: {
        pest: '',
        basePrompt: '',
        userInput: '',
        isLoading: false,
        response: null
      }
    };
  },
  computed: {
    cssVar() {
      return (prop) => getComputedStyle(document.documentElement).getPropertyValue(prop).trim();
    },
    chartTitle() {
      return this.translate("charts.pestAlertTitle", "Pest Alerts");
    },
    chartSubtitle() {
      return this.translate(
        "charts.pestAlertSubtitle",
        "Current pest and disease warnings"
      );
    },
    filteredAlerts() {
      if (!this.pestData?.alerts) return [];
      if (this.selectedSeverity === "all") {
        return this.pestData.alerts;
      }
      return this.pestData.alerts.filter((a) => a.severity === this.selectedSeverity);
    },
    totalAlerts() {
      return this.pestData?.summary?.total || 0;
    },
    showEmptyState() {
      return this.filteredAlerts.length === 0;
    },
    lastUpdated() {
      return this.pestData?.lastUpdated || new Date().toISOString();
    },
    summaryChartSeries() {
      const summary = this.pestData?.summary || { high: 0, moderate: 0, low: 0 };
      return [summary.high, summary.moderate, summary.low];
    },
    summaryChartOptions() {
      return {
        chart: {
          type: "donut",
          background: "transparent",
        },
        labels: [
          this.translate("charts.high", "High"),
          this.translate("charts.moderate", "Moderate"),
          this.translate("charts.low", "Low"),
        ],
        colors: ["#F44336", "#FF9800", "#2196F3"],
        plotOptions: {
          pie: {
            donut: {
              size: "70%",
              labels: {
                show: false,
              },
            },
          },
        },
        dataLabels: {
          enabled: false,
        },
        legend: {
          show: false,
        },
        tooltip: {
          theme: "dark",
        },
        stroke: {
          show: false,
        },
      };
    },
  },
  mounted() {
    this.loadPestAlerts();
    if (this.autoRefresh) {
      this.refreshTimer = setInterval(this.loadPestAlerts, this.refreshInterval);
    }
  },
  beforeUnmount() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
    }
  },
  methods: {
    translate(key, defaultValue) {
      return this.$t(key, defaultValue);
    },
    translateSeverity(severity) {
      const translations = {
        high: this.translate("charts.high", "High"),
        moderate: this.translate("charts.moderate", "Moderate"),
        low: this.translate("charts.low", "Low"),
      };
      return translations[severity] || severity;
    },
    getSeverityIcon(severity) {
      const icons = {
        high: "fas fa-exclamation-circle",
        moderate: "fas fa-exclamation-triangle",
        low: "fas fa-info-circle",
      };
      return icons[severity] || "fas fa-info-circle";
    },
    getSeverityColor(severity) {
      const colors = {
        high: "#F44336",
        moderate: "#FF9800",
        low: "#2196F3",
      };
      return colors[severity] || "#9E9E9E";
    },
    getSeverityCount(severity) {
      return this.pestData?.summary?.[severity] || 0;
    },
    async loadPestAlerts() {
      this.loading = true;
      this.error = null;

      try {
        const data = await agriculturalService.getPestAlerts(this.region);
        this.pestData = {
          ...data,
          lastUpdated: new Date().toISOString(),
        };
      } catch (err) {
        this.error = this.translate("charts.loadDataError", "Failed to load data");
        console.error("Error loading pest alerts:", err);
      } finally {
        this.loading = false;
      }
    },
    toggleAlert(alertId) {
      if (this.expandedAlert === alertId) {
        this.expandedAlert = null;
      } else {
        this.expandedAlert = alertId;
      }
    },
    formatDate(dateStr) {
      return new Date(dateStr).toLocaleDateString();
    },
    viewOnMap(alert) {
      const departments = alert.departments || [];
      if (departments.length === 0) {
        console.warn('No location data available for this alert');
        return;
      }

      const firstDept = departments[0];
      const coords = usdaRssService.getDepartmentCoordinates(firstDept);

      const searchQuery = `${firstDept}, El Salvador ${alert.pest}`;
      const encodedQuery = encodeURIComponent(searchQuery);

      let mapsUrl;
      if (coords) {
        mapsUrl = `https://www.google.com/maps/search/?api=1&query=${coords.lat},${coords.lng}`;
      } else {
        mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodedQuery}`;
      }

      window.open(mapsUrl, '_blank');
    },
    shareAlert(alert) {
      const severityLabel = this.translateSeverity(alert.severity);
      const pest = alert.pest;
      const scientific = alert.scientificName;
      const description = alert.description;
      const crops = alert.affectedCrops.join(', ');
      const departments = alert.departments.join(', ');
      const recommendations = alert.recommendations;
      const source = alert.source;

      const shareText = `🚨 ${severityLabel} SEVERITY PEST ALERT 🚨

🐛 ${this.t('charts.pest')}: ${pest}
🔬 ${scientific}

📝 ${this.t('charts.description')}:
${description}

🌾 ${this.t('charts.affectedCrops')}: ${crops}

📍 ${this.t('charts.areas')}: ${departments}

💡 ${this.t('charts.recommendations')}:
${recommendations}

${source ? `📊 ${this.t('charts.source')}: ${source}` : ''}

---
${this.t('charts.sharedVia')}: AgroGenio AI`;

      const subject = `${severityLabel} Pest Alert: ${pest}`;
      const body = encodeURIComponent(shareText);

      window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${body}`;
    },
    async getAssistance(alert) {
      const pest = alert.pest;
      const scientific = alert.scientificName;
      const severity = alert.severity;
      const crops = alert.affectedCrops.join(', ');
      const departments = alert.departments.join(', ');
      const recommendations = alert.recommendations;

      const basePrompt = `Pest: ${pest} (${scientific})
Severity: ${this.translateSeverity(severity)}
Crops: ${crops}
Areas: ${departments}
Recommendations: ${recommendations}`;

      this.showAssistanceDialog = true;
      this.assistanceDialog = {
        pest: pest,
        basePrompt: basePrompt,
        userInput: '',
        isLoading: false,
        response: null
      };
    },
    refresh() {
      this.loadPestAlerts();
    },
    getSeverityEmoji(severity) {
      const emojis = {
        high: '⚠️',
        moderate: '⚡',
        low: '🟢'
      };
      return emojis[severity] || '🟢';
    },
    t(key) {
      return this.$t(key);
    },
    closeAssistanceDialog() {
      this.showAssistanceDialog = false;
      this.assistanceDialog = {
        pest: '',
        basePrompt: '',
        userInput: '',
        isLoading: false,
        response: null
      };
    },
    closeResponseDialog() {
      this.showResponseDialog = false;
    },
    async submitAssistanceQuery() {
      const userInput = this.assistanceDialog.userInput.trim();
      const finalPrompt = userInput
        ? `I need assistance with a pest alert:\n\n${this.assistanceDialog.basePrompt}\n\nMy situation: ${userInput}`
        : `I need assistance with a pest alert:\n\n${this.assistanceDialog.basePrompt}`;

      this.assistanceDialog.isLoading = true;

      try {
        const currentLanguage = localStorage.getItem('preferredLanguage') || 'en';

        const queryData = {
          userId: this.userId,
          sessionId: this.sessionId + '-assist-' + Date.now(),
          messages: [{ role: 'user', content: finalPrompt }],
          context: {
            language: currentLanguage.toUpperCase()
          },
          contextOption: 'simple-query'
        };

        const response = await chatbotService.submitQuery(queryData);

        this.assistanceDialog.response = response.response || this.t('charts.noResponse');
        this.showAssistanceDialog = false;
        this.showResponseDialog = true;
      } catch (error) {
        console.error('Error submitting query:', error);
        this.assistanceDialog.response = this.t('charts.errorOccurred') + ': ' + error.message;
        this.showAssistanceDialog = false;
        this.showResponseDialog = true;
      } finally {
        this.assistanceDialog.isLoading = false;
      }
    },
    copyResponse() {
      const text = this.assistanceDialog.response || '';
      navigator.clipboard.writeText(text).then(() => {
        console.log('Response copied to clipboard');
      }).catch(err => {
        console.error('Failed to copy:', err);
      });
    },
  },
};
</script>

<style scoped>
.pest-alert-chart {
  padding: 24px;
  background: var(--bg-card);
  border-radius: 12px;
  box-shadow: var(--shadow-md);
}

.chart-header {
  margin-bottom: 24px;
}

.header-text h3 {
  margin: 0 0 4px 0;
  font-size: 1.5rem;
  font-weight: 600;
  color: var(--text-primary);
}

.chart-subtitle {
  margin: 0 0 16px 0;
  font-size: 0.9rem;
  color: var(--text-secondary);
}

.summary-chips {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.summary-chip {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 20px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-light);
  cursor: pointer;
  transition: all 0.2s;
  font-size: 0.9rem;
}

.summary-chip:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
}

.summary-chip.active {
  border-color: #4CAF50;
  background: #4CAF50;
  color: white;
}

.summary-chip.high {
  border-left: 3px solid #F44336;
}

.summary-chip.moderate {
  border-left: 3px solid #FF9800;
}

.summary-chip.low {
  border-left: 3px solid #2196F3;
}

.summary-chip i {
  font-size: 0.9rem;
}

.summary-chip.high i {
  color: #F44336;
}

.summary-chip.moderate i {
  color: #FF9800;
}

.summary-chip.low i {
  color: #2196F3;
}

.summary-chip.active i {
  color: white;
}

.chip-label {
  font-weight: 500;
}

.chip-count {
  background: var(--bg-card);
  padding: 2px 8px;
  border-radius: 10px;
  font-weight: 600;
  font-size: 0.85rem;
}

.summary-chip.active .chip-count {
  background: rgba(255, 255, 255, 0.3);
  color: white;
}

.loading-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 60px 20px;
  color: var(--text-muted);
}

.alerts-container {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.alert-summary-chart {
  position: relative;
  height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.chart-center-text {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
  pointer-events: none;
}

.total-count {
  font-size: 2.5rem;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1;
}

.total-label {
  font-size: 0.85rem;
  color: var(--text-muted);
  margin-top: 4px;
}

.empty-state {
  text-align: center;
  padding: 60px 20px;
  color: #4CAF50;
}

.empty-state i {
  font-size: 4rem;
  margin-bottom: 16px;
  display: block;
}

.empty-state h4 {
  margin: 0 0 8px 0;
  font-size: 1.2rem;
}

.empty-state p {
  margin: 0;
  color: var(--text-muted);
}

.alerts-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.alert-card {
  border-radius: 12px;
  overflow: hidden;
  transition: all 0.3s ease;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.alert-card.high {
  border-left: 4px solid #F44336;
}

.alert-card.moderate {
  border-left: 4px solid #FF9800;
}

.alert-card.low {
  border-left: 4px solid #2196F3;
}

.alert-card.high {
  background: linear-gradient(to right, #FFEBEE, var(--bg-card));
}

.alert-card.moderate {
  background: linear-gradient(to right, #FFF3E0, var(--bg-card));
}

.alert-card.low {
  background: linear-gradient(to right, #E3F2FD, var(--bg-card));
}

.alert-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  cursor: pointer;
  user-select: none;
}

.alert-header:hover {
  background: rgba(128, 128, 128, 0.06);
}

.alert-title-section {
  display: flex;
  align-items: center;
  gap: 12px;
}

.alert-icon {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  font-size: 1.2rem;
}

.alert-card.high .alert-icon {
  background: rgba(244, 67, 54, 0.1);
  color: #F44336;
}

.alert-card.moderate .alert-icon {
  background: rgba(255, 152, 0, 0.1);
  color: #FF9800;
}

.alert-card.low .alert-icon {
  background: rgba(33, 150, 243, 0.1);
  color: #2196F3;
}

.alert-title-content h4 {
  margin: 0;
  font-size: 1.1rem;
  color: var(--text-primary);
}

.scientific-name {
  font-style: italic;
  font-size: 0.85rem;
  color: var(--text-muted);
}

.alert-meta {
  display: flex;
  align-items: center;
  gap: 12px;
}

.severity-badge {
  padding: 4px 12px;
  border-radius: 12px;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
}

.severity-badge.high {
  background: #F44336;
  color: white;
}

.severity-badge.moderate {
  background: #FF9800;
  color: white;
}

.severity-badge.low {
  background: #2196F3;
  color: white;
}

.toggle-icon {
  color: var(--text-muted);
  transition: transform 0.3s;
}

.alert-card.expanded .toggle-icon {
  transform: rotate(180deg);
}

.alert-body {
  padding: 0 16px 16px 16px;
  border-top: 1px solid var(--border-light);
}

.alert-description {
  display: flex;
  gap: 12px;
  margin: 16px 0;
  padding: 12px;
  background: var(--bg-tertiary);
  border-radius: 8px;
}

.alert-description i {
  color: #4CAF50;
  flex-shrink: 0;
  margin-top: 2px;
}

.alert-description p {
  margin: 0;
  color: var(--text-primary);
}

.alert-details-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}

.detail-item {
  display: flex;
  gap: 12px;
  padding: 12px;
  background: var(--bg-card);
  border: 1px solid var(--border-light);
  border-radius: 8px;
}

.detail-item i {
  color: #4CAF50;
  font-size: 1.2rem;
  flex-shrink: 0;
}

.detail-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.detail-label {
  font-size: 0.75rem;
  color: var(--text-muted);
  text-transform: uppercase;
}

.detail-value {
  font-size: 0.9rem;
  color: var(--text-primary);
  font-weight: 500;
}

.alert-recommendations {
  margin-bottom: 16px;
  padding: 12px;
  background: rgba(255, 193, 7, 0.1);
  border-radius: 8px;
  border-left: 3px solid #FFC107;
}

.recommendations-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  color: #F57C00;
}

.alert-recommendations p {
  margin: 0;
  font-size: 0.9rem;
  color: var(--text-primary);
}

.alert-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.action-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-card);
  color: var(--text-primary);
  font-size: 0.85rem;
  cursor: pointer;
  transition: all 0.2s;
}

.action-btn:hover {
  background: var(--bg-tertiary);
  border-color: #4CAF50;
}

.action-btn.primary {
  background: #4CAF50;
  color: white;
  border-color: #4CAF50;
}

.action-btn.primary:hover {
  background: #45a049;
}

.last-updated {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 20px;
  font-size: 0.85rem;
  color: var(--text-muted);
}

/* Transitions */
.alert-fade-enter-active,
.alert-fade-leave-active {
  transition: all 0.3s ease;
}

.alert-fade-enter-from {
  opacity: 0;
  transform: translateY(-10px);
}

.alert-fade-leave-to {
  opacity: 0;
  transform: translateX(10px);
}

.expand-enter-active,
.expand-leave-active {
  transition: all 0.3s ease;
  overflow: hidden;
}

.expand-enter-from,
.expand-leave-to {
  max-height: 0;
  opacity: 0;
}

.expand-enter-to,
.expand-leave-from {
  max-height: 1000px;
  opacity: 1;
}

@media (max-width: 768px) {
  .pest-alert-chart {
    padding: 16px;
  }

  .alert-header {
    flex-direction: column;
    gap: 12px;
    align-items: flex-start;
  }

  .alert-meta {
    width: 100%;
    justify-content: space-between;
  }

  .alert-details-grid {
    grid-template-columns: 1fr;
  }

  .alert-actions {
    flex-direction: column;
  }

  .action-btn {
    width: 100%;
    justify-content: center;
  }
}

/* Dialog Styles */
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
  z-index: 1000;
  padding: 16px;
  backdrop-filter: blur(4px);
}

.dialog-container {
  background: var(--bg-dialog, var(--bg-card));
  border-radius: 12px;
  width: 100%;
  max-width: 600px;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
}

.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 24px;
  border-bottom: 1px solid var(--border-light);
}

.dialog-title {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--text-primary);
}

.dialog-title i {
  color: #4CAF50;
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

.dialog-body::-webkit-scrollbar {
  width: 8px;
}

.dialog-body::-webkit-scrollbar-track {
  background: var(--bg-tertiary);
  border-radius: 4px;
}

.dialog-body::-webkit-scrollbar-thumb {
  background: var(--border-color);
  border-radius: 4px;
}

.dialog-section {
  margin-bottom: 20px;
}

.dialog-label {
  display: block;
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 8px;
}

.prompt-display {
  padding: 12px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-light);
  border-radius: 8px;
  font-size: 0.9rem;
  color: var(--text-primary);
  white-space: pre-wrap;
  line-height: 1.5;
}

.user-input {
  width: 100%;
  padding: 12px;
  border: 1px solid var(--border-light);
  border-radius: 8px;
  font-size: 0.95rem;
  font-family: inherit;
  resize: vertical;
  background: var(--bg-input);
  color: var(--text-primary);
}

.user-input:focus {
  outline: none;
  border-color: #4CAF50;
  box-shadow: 0 0 0 3px rgba(76, 175, 80, 0.1);
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 24px;
  border-top: 1px solid var(--border-light);
}

.cancel-btn,
.action-btn,
.submit-btn {
  padding: 10px 20px;
  border-radius: 6px;
  font-size: 0.95rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  border: none;
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.cancel-btn {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.cancel-btn:hover {
  background: var(--border-color);
}

.submit-btn {
  background: #4CAF50;
  color: white;
}

.submit-btn:hover:not(:disabled) {
  background: #45a049;
}

.submit-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.response-content {
  padding: 16px;
  background: var(--bg-tertiary);
  border-radius: 8px;
  font-size: 0.95rem;
  line-height: 1.6;
  color: var(--text-primary);
  white-space: pre-wrap;
}

@media (max-width: 768px) {
  .dialog-overlay {
    padding: 8px;
  }

  .dialog-container {
    max-width: 100%;
    max-height: 90vh;
  }

  .dialog-header {
    padding: 12px 16px;
  }

  .dialog-body {
    padding: 16px;
  }

  .dialog-footer {
    padding: 12px 16px;
    flex-wrap: wrap;
  }

  .cancel-btn,
  .action-btn,
  .submit-btn {
    flex: 1;
    justify-content: center;
  }
}
</style>
