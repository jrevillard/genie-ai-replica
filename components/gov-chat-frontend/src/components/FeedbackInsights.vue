<template>
  <div class="feedback-insights">
    <div class="feedback-header">
      <div class="feedback-titles">
        <h2 class="feedback-title">
          {{ translate('admin.feedback.title', 'Feedback insights') }}
        </h2>
        <p class="feedback-subtitle">
          {{
            translate(
              'admin.feedback.subtitle',
              'Review user ratings, comments and unanswered queries to improve the assistant.'
            )
          }}
        </p>
      </div>

      <div class="feedback-controls">
        <div class="period-selector">
          <label for="feedback-period">
            {{ translate('analytics.period', 'Period') }}
          </label>
          <select id="feedback-period" v-model="selectedPeriod" @change="onPeriodChange">
            <option value="daily">{{ translate('analytics.periods.daily', 'Daily') }}</option>
            <option value="weekly">{{ translate('analytics.periods.weekly', 'Weekly') }}</option>
            <option value="monthly">{{ translate('analytics.periods.monthly', 'Monthly') }}</option>
            <option value="all-time">{{ translate('analytics.periods.allTime', 'All time') }}</option>
          </select>
        </div>
        <div v-if="selectedPeriod !== 'all-time'" class="date-picker">
          <input
            v-model="selectedDate"
            type="date"
            :max="todayStr"
            :aria-label="translate('analytics.tooltips.selectDate', 'Select date')"
            @change="loadAll"
          />
        </div>
        <button class="btn-refresh" type="button" :disabled="isLoading" @click="loadAll">
          {{ translate('admin.feedback.refresh', 'Refresh') }}
        </button>
      </div>
    </div>

    <div v-if="errorMessage" class="feedback-error">
      <span>{{ errorMessage }}</span>
      <button class="btn-link" type="button" @click="loadAll">
        {{ translate('admin.feedback.retry', 'Retry') }}
      </button>
    </div>

    <div class="metrics-grid">
      <div class="metric-card metric-card--total">
        <div class="metric-label">
          {{ translate('admin.feedback.metrics.totalFeedback', 'Total feedback') }}
        </div>
        <div class="metric-value">{{ formatNumber(metrics.totalFeedback) }}</div>
        <div class="metric-sub">
          {{ translate('admin.feedback.metrics.avgRating', 'Avg rating') }}:
          {{ metrics.totalFeedback > 0 ? metrics.avgRating.toFixed(1) : '—' }}
        </div>
      </div>

      <div class="metric-card metric-card--positive">
        <div class="metric-label">
          {{ translate('admin.feedback.metrics.positive', 'Positive') }}
        </div>
        <div class="metric-value">{{ formatNumber(metrics.positive) }}</div>
        <div class="metric-sub">{{ formatPercent(metrics.positivePercentage) }}</div>
      </div>

      <div class="metric-card metric-card--negative">
        <div class="metric-label">
          {{ translate('admin.feedback.metrics.negative', 'Negative') }}
        </div>
        <div class="metric-value">{{ formatNumber(metrics.negative) }}</div>
        <div class="metric-sub">{{ formatPercent(metrics.negativePercentage) }}</div>
      </div>

      <div class="metric-card metric-card--neutral">
        <div class="metric-label">
          {{ translate('admin.feedback.metrics.neutral', 'Neutral') }}
        </div>
        <div class="metric-value">{{ formatNumber(metrics.neutral) }}</div>
        <div class="metric-sub">{{ formatPercent(metrics.neutralPercentage) }}</div>
      </div>

      <div class="metric-card metric-card--unanswered">
        <div class="metric-label">
          {{ translate('admin.feedback.metrics.unanswered', "AI couldn't answer") }}
        </div>
        <div class="metric-value">{{ formatNumber(metrics.unanswered) }}</div>
        <div class="metric-sub">
          {{ translate('admin.feedback.metrics.unansweredOf', 'of') }}
          {{ formatNumber(metrics.totalQueries) }}
          {{ translate('admin.feedback.metrics.queries', 'queries') }}
          ({{ formatPercent(metrics.unansweredPercentage) }})
        </div>
      </div>

      <div class="metric-card metric-card--answered">
        <div class="metric-label">
          {{ translate('admin.feedback.metrics.answered', 'Answered rate') }}
        </div>
        <div class="metric-value">{{ formatPercent(metrics.answeredPercentage) }}</div>
        <div class="metric-sub">
          {{ translate('admin.feedback.metrics.totalQueries', 'Total queries') }}:
          {{ formatNumber(metrics.totalQueries) }}
        </div>
      </div>
    </div>

    <div class="feedback-chart-card">
      <div class="feedback-chart-header">
        <h3>{{ translate('admin.feedback.trend.title', 'Trend over time') }}</h3>
        <span class="feedback-chart-hint">
          {{ translate('admin.feedback.trend.hint', 'Counts per ') }}{{ chartIntervalLabel }}
        </span>
      </div>
      <div v-if="isLoading && trendData.length === 0" class="feedback-chart-empty">
        {{ translate('admin.feedback.loading', 'Loading…') }}
      </div>
      <div v-else-if="trendData.length === 0" class="feedback-chart-empty">
        {{ translate('admin.feedback.trend.empty', 'No feedback in this period.') }}
      </div>
      <apexchart v-else type="line" height="320" :options="chartOptions" :series="chartSeries" />
    </div>

    <div class="feedback-list-card">
      <div class="feedback-list-header">
        <h3>{{ translate('admin.feedback.list.title', 'All feedback') }}</h3>
        <div class="filter-chips" role="tablist">
          <button
            v-for="chip in filterChips"
            :key="chip.id"
            type="button"
            class="filter-chip"
            :class="{ active: activeFilter === chip.id }"
            role="tab"
            :aria-selected="activeFilter === chip.id"
            @click="setFilter(chip.id)"
          >
            {{ chip.label }}
          </button>
        </div>
      </div>

      <div v-if="isListLoading && listItems.length === 0" class="feedback-list-empty">
        {{ translate('admin.feedback.loading', 'Loading…') }}
      </div>
      <div v-else-if="listItems.length === 0" class="feedback-list-empty">
        {{ translate('admin.feedback.list.empty', 'No feedback matches this filter.') }}
      </div>

      <ul v-else class="feedback-list">
        <li v-for="item in listItems" :key="item._key" class="feedback-list-item">
          <div class="feedback-row-top">
            <span class="feedback-sentiment" :class="sentimentClass(item)">
              <span class="feedback-sentiment-icon">{{ sentimentIcon(item) }}</span>
              <span class="feedback-sentiment-label">{{ sentimentLabel(item) }}</span>
            </span>
            <span v-if="item.rating" class="feedback-rating">
              {{ translate('admin.feedback.list.rating', 'Rating') }}: <strong>{{ item.rating }}</strong
              >/5
            </span>
            <span class="feedback-when">{{ formatDateTime(item.timestamp) }}</span>
          </div>

          <div v-if="item.queryText" class="feedback-question">
            <span class="feedback-question-label">
              {{ translate('admin.feedback.list.question', 'Question') }}
            </span>
            <p class="feedback-question-text">{{ truncate(item.queryText, 280) }}</p>
          </div>

          <div v-if="item.queryResponse" class="feedback-response">
            <span class="feedback-response-label">
              {{ translate('admin.feedback.list.response', 'AI response') }}
            </span>
            <p class="feedback-response-text" :class="{ expanded: expandedKeys.has(item._key) }">
              {{ expandedKeys.has(item._key) ? item.queryResponse : truncate(item.queryResponse, 220) }}
            </p>
            <button
              v-if="item.queryResponse.length > 220"
              class="btn-link feedback-response-toggle"
              type="button"
              @click="toggleExpanded(item._key)"
            >
              {{
                expandedKeys.has(item._key)
                  ? translate('admin.feedback.list.collapse', 'Show less')
                  : translate('admin.feedback.list.expand', 'Show more')
              }}
            </button>
          </div>

          <div v-if="item.comment" class="feedback-comment">
            <span class="feedback-comment-label">
              {{ translate('admin.feedback.list.comment', 'Comment') }}
            </span>
            <p class="feedback-comment-text">"{{ item.comment }}"</p>
          </div>

          <div class="feedback-meta">
            <span v-if="item.responseTime">
              {{ translate('admin.feedback.list.responseTime', 'Response time') }}:
              {{ formatResponseTime(item.responseTime) }}
            </span>
            <span v-if="item.isAnswered === false" class="feedback-meta-warn">
              {{ translate('admin.feedback.list.unanswered', 'AI could not answer') }}
            </span>
          </div>

          <div v-if="item.expertAnswer && item.expertAnswer.text" class="expert-answer">
            <div class="expert-answer-header">
              <span class="expert-answer-label">
                {{ translate('admin.feedback.expert.label', 'Expert answer') }}
              </span>
              <span class="expert-answer-meta">
                {{ formatDateTime(item.expertAnswer.providedAt) }}
                <span v-if="item.expertAnswer.providedBy"> · {{ item.expertAnswer.providedBy }} </span>
              </span>
            </div>
            <p class="expert-answer-text">{{ item.expertAnswer.text }}</p>
          </div>

          <div class="feedback-actions">
            <button
              v-if="!item.queryId"
              class="btn-link"
              type="button"
              disabled
              :title="translate('admin.feedback.expert.noQuery', 'No query associated with this feedback')"
            >
              {{ translate('admin.feedback.expert.addBtn', 'Add expert comment') }}
            </button>
            <button
              v-else-if="!isExpertEditorOpen(item._key)"
              class="btn-secondary"
              type="button"
              @click="openExpertEditor(item)"
            >
              {{
                item.expertAnswer && item.expertAnswer.text
                  ? translate('admin.feedback.expert.editBtn', 'Edit expert comment')
                  : translate('admin.feedback.expert.addBtn', 'Add expert comment')
              }}
            </button>
          </div>

          <div v-if="isExpertEditorOpen(item._key)" class="expert-editor">
            <label :for="`expert-textarea-${item._key}`" class="expert-editor-label">
              {{ translate('admin.feedback.expert.editorLabel', 'What should the AI have answered?') }}
            </label>
            <textarea
              :id="`expert-textarea-${item._key}`"
              v-model="expertDrafts[item._key]"
              class="expert-textarea"
              rows="4"
              :placeholder="translate('admin.feedback.expert.placeholder', 'Write the correct answer…')"
            ></textarea>
            <div class="expert-editor-actions">
              <button
                type="button"
                class="btn-link"
                :disabled="savingExpertFor === item._key"
                @click="closeExpertEditor(item._key)"
              >
                {{ translate('admin.feedback.expert.cancel', 'Cancel') }}
              </button>
              <button
                type="button"
                class="btn-primary"
                :disabled="
                  savingExpertFor === item._key || !(expertDrafts[item._key] && expertDrafts[item._key].trim())
                "
                @click="saveExpertAnswer(item)"
              >
                {{
                  savingExpertFor === item._key
                    ? translate('admin.feedback.expert.saving', 'Saving…')
                    : translate('admin.feedback.expert.save', 'Save expert answer')
                }}
              </button>
            </div>
          </div>
        </li>
      </ul>

      <div v-if="totalPages > 1" class="feedback-pagination">
        <button
          type="button"
          class="page-btn"
          :disabled="page <= 1 || isListLoading"
          :aria-label="translate('admin.hierarchy.prev', 'Previous')"
          @click="setPage(page - 1)"
        >
          ‹
        </button>
        <span class="page-info">
          {{ translate('admin.hierarchy.page', 'Page') }} {{ page }} {{ translate('admin.hierarchy.of', 'of') }}
          {{ totalPages }}
        </span>
        <button
          type="button"
          class="page-btn"
          :disabled="page >= totalPages || isListLoading"
          :aria-label="translate('admin.hierarchy.next', 'Next')"
          @click="setPage(page + 1)"
        >
          ›
        </button>
      </div>
    </div>
  </div>
</template>

<script>
import analyticsService from '../services/analyticsService';
import chatbotService from '../services/chatbotService';
import notificationService from '../services/notificationService';

const FILTERS = ['all', 'positive', 'negative', 'needsExpert'];
const PAGE_SIZE = 5;

export default {
  name: 'FeedbackInsights',
  data() {
    return {
      selectedPeriod: 'monthly',
      selectedDate: this.localDateStr(new Date()),
      isLoading: false,
      isListLoading: false,
      errorMessage: '',
      metrics: this.emptyMetrics(),
      trendData: [],
      listItems: [],
      totalItems: 0,
      page: 1,
      activeFilter: 'all',
      expandedKeys: new Set(),
      expertEditorOpenFor: null,
      expertDrafts: {},
      savingExpertFor: null
    };
  },
  computed: {
    todayStr() {
      return this.localDateStr(new Date());
    },
    currentLocale() {
      return this.$i18n ? this.$i18n.locale : 'en';
    },
    chartInterval() {
      switch (this.selectedPeriod) {
        case 'daily':
          return 'hourly';
        case 'weekly':
          return 'daily';
        case 'monthly':
          return 'daily';
        case 'all-time':
          return 'monthly';
        default:
          return 'daily';
      }
    },
    chartIntervalLabel() {
      const map = {
        hourly: this.translate('admin.feedback.trend.hour', 'hour'),
        daily: this.translate('admin.feedback.trend.day', 'day'),
        weekly: this.translate('admin.feedback.trend.week', 'week'),
        monthly: this.translate('admin.feedback.trend.month', 'month')
      };
      return map[this.chartInterval] || map.daily;
    },
    chartSeries() {
      return [
        {
          name: this.translate('admin.feedback.trend.positive', 'Positive'),
          data: this.trendData.map((row) => row.positive || 0)
        },
        {
          name: this.translate('admin.feedback.trend.negative', 'Negative'),
          data: this.trendData.map((row) => row.negative || 0)
        },
        {
          name: this.translate('admin.feedback.trend.neutral', 'Neutral'),
          data: this.trendData.map((row) => row.neutral || 0)
        },
        {
          name: this.translate('admin.feedback.trend.unanswered', "Couldn't answer"),
          data: this.trendData.map((row) => row.unanswered || 0)
        }
      ];
    },
    chartOptions() {
      return {
        chart: {
          id: 'feedback-trend',
          toolbar: { show: false },
          fontFamily: 'inherit',
          zoom: { enabled: false }
        },
        stroke: { curve: 'smooth', width: 2 },
        colors: ['#22c55e', '#ef4444', '#9ca3af', '#f59e0b'],
        dataLabels: { enabled: false },
        markers: { size: 3, hover: { size: 5 } },
        grid: { borderColor: 'rgba(0,0,0,0.06)' },
        xaxis: {
          categories: this.trendData.map((row) => row.dateLabel || row.timestamp || ''),
          labels: { rotate: -35, style: { fontSize: '11px' } },
          axisBorder: { show: false },
          axisTicks: { show: false }
        },
        yaxis: {
          min: 0,
          forceNiceScale: true,
          labels: { style: { fontSize: '11px' } }
        },
        legend: { position: 'top', horizontalAlign: 'left' },
        tooltip: { shared: true }
      };
    },
    filterChips() {
      return FILTERS.map((id) => ({
        id,
        label: this.translate(`admin.feedback.list.filter.${id}`, this.defaultFilterLabel(id))
      }));
    },
    totalPages() {
      return Math.max(1, Math.ceil((this.totalItems || 0) / PAGE_SIZE));
    }
  },
  watch: {
    '$i18n.locale': {
      handler() {
        this.loadAll();
      }
    }
  },
  mounted() {
    this.loadAll();
  },
  methods: {
    localDateStr(d) {
      // Return YYYY-MM-DD in the user's local timezone. Avoid toISOString()
      // because it converts to UTC and can shift the date by one day for
      // users east of UTC after local midnight.
      const date = d instanceof Date ? d : new Date(d);
      const y = date.getFullYear();
      const m = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    },
    translate(key, fallback = '') {
      if (!this.$i18n) return fallback;
      try {
        const translation = this.$i18n.t(key, { locale: this.currentLocale });
        return translation === key ? fallback || key : translation;
      } catch {
        return fallback || key;
      }
    },
    emptyMetrics() {
      return {
        totalFeedback: 0,
        positive: 0,
        negative: 0,
        neutral: 0,
        positivePercentage: 0,
        negativePercentage: 0,
        neutralPercentage: 0,
        avgRating: 0,
        totalQueries: 0,
        unanswered: 0,
        unansweredPercentage: 0,
        answeredPercentage: 0
      };
    },
    defaultFilterLabel(id) {
      switch (id) {
        case 'positive':
          return 'Positive';
        case 'negative':
          return 'Negative';
        case 'needsExpert':
          return 'Needs expert answer';
        default:
          return 'All';
      }
    },
    onPeriodChange() {
      this.page = 1;
      this.loadAll();
    },
    setFilter(filter) {
      if (this.activeFilter === filter) return;
      this.activeFilter = filter;
      this.page = 1;
      this.loadList();
    },
    setPage(nextPage) {
      const clamped = Math.min(Math.max(nextPage, 1), this.totalPages);
      if (clamped === this.page) return;
      this.page = clamped;
      this.loadList();
    },
    toggleExpanded(key) {
      const next = new Set(this.expandedKeys);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      this.expandedKeys = next;
    },
    isExpertEditorOpen(key) {
      return this.expertEditorOpenFor === key;
    },
    openExpertEditor(item) {
      this.expertEditorOpenFor = item._key;
      const seed = item.expertAnswer && item.expertAnswer.text ? item.expertAnswer.text : '';
      this.expertDrafts = { ...this.expertDrafts, [item._key]: seed };
    },
    closeExpertEditor(key) {
      if (this.expertEditorOpenFor === key) {
        this.expertEditorOpenFor = null;
      }
      const next = { ...this.expertDrafts };
      delete next[key];
      this.expertDrafts = next;
    },
    async saveExpertAnswer(item) {
      const text = (this.expertDrafts[item._key] || '').trim();
      if (!text) return;
      if (!item.queryId) {
        notificationService.error(
          this.translate('admin.feedback.expert.noQuery', 'No query associated with this feedback')
        );
        return;
      }
      this.savingExpertFor = item._key;
      try {
        const updatedQuery = await chatbotService.submitExpertAnswer(item.queryId, text);
        // Reflect the saved expert answer locally so the UI updates without a
        // refetch round-trip.
        const expertAnswer =
          updatedQuery && updatedQuery.expertAnswer
            ? updatedQuery.expertAnswer
            : {
                text,
                providedAt: new Date().toISOString(),
                providedBy: null
              };
        this.listItems = this.listItems.map((entry) => (entry._key === item._key ? { ...entry, expertAnswer } : entry));
        this.closeExpertEditor(item._key);
        notificationService.success(this.translate('admin.feedback.expert.saved', 'Expert answer saved.'));
      } catch (error) {
        console.error('Error saving expert answer:', error);
        notificationService.error(
          this.translate('admin.feedback.expert.saveError', 'Could not save expert answer. Please try again.')
        );
      } finally {
        this.savingExpertFor = null;
      }
    },
    async loadAll() {
      this.errorMessage = '';
      await Promise.all([this.loadMetricsAndTrend(), this.loadList()]);
    },
    async loadMetricsAndTrend() {
      this.isLoading = true;
      try {
        const [dashboard, trend] = await Promise.all([
          analyticsService.getDashboardAnalytics(this.selectedPeriod, this.selectedDate),
          analyticsService.getFeedbackTimeSeries(this.selectedPeriod, this.selectedDate, this.chartInterval)
        ]);

        // The legacy /analytics/dashboard AQL returns the feedback/queries
        // subqueries as single-element arrays. Unwrap defensively so we work
        // with either shape.
        const unwrap = (value) => (Array.isArray(value) ? value[0] || {} : value || {});
        const fb = unwrap(dashboard?.feedback);
        const queries = unwrap(dashboard?.queries);
        // Prefer the trend totals when the legacy dashboard returns nothing —
        // it filters feedback strictly by numeric rating, which misses older
        // records that were stored with thumb feedback only or string ratings.
        const trendTotals = (Array.isArray(trend) ? trend : []).reduce(
          (acc, row) => {
            acc.positive += row.positive || 0;
            acc.negative += row.negative || 0;
            acc.neutral += row.neutral || 0;
            return acc;
          },
          { positive: 0, negative: 0, neutral: 0 }
        );
        const trendTotal = trendTotals.positive + trendTotals.negative + trendTotals.neutral;
        const positive = fb.positive || trendTotals.positive || 0;
        const negative = fb.negative || trendTotals.negative || 0;
        const neutral = fb.neutral || trendTotals.neutral || 0;
        const total = fb.total || trendTotal || 0;
        const totalQueries = queries.total || dashboard?.totalQueries || 0;
        const unanswered = queries.unanswered || 0;
        const avgRating = this.computeAvgRating(trend, { total, positive, negative, neutral });

        this.metrics = {
          totalFeedback: total,
          positive,
          negative,
          neutral,
          positivePercentage: fb.positivePercentage || (total > 0 ? (positive / total) * 100 : 0),
          negativePercentage: fb.negativePercentage || (total > 0 ? (negative / total) * 100 : 0),
          neutralPercentage: total > 0 ? (neutral / total) * 100 : 0,
          avgRating,
          totalQueries,
          unanswered,
          unansweredPercentage: totalQueries > 0 ? (unanswered / totalQueries) * 100 : 0,
          answeredPercentage:
            queries.answeredPercentage != null
              ? queries.answeredPercentage
              : totalQueries > 0
                ? ((totalQueries - unanswered) / totalQueries) * 100
                : 0
        };
        this.trendData = Array.isArray(trend) ? trend : [];
      } catch (error) {
        console.error('Error loading feedback insights:', error);
        this.errorMessage = this.translate(
          'admin.feedback.errors.loadFailed',
          'Could not load feedback data. Please try again.'
        );
        this.metrics = this.emptyMetrics();
        this.trendData = [];
      } finally {
        this.isLoading = false;
      }
    },
    async loadList() {
      this.isListLoading = true;
      try {
        const { items, total } = await analyticsService.getFeedbackList(this.selectedPeriod, this.selectedDate, {
          filter: this.activeFilter,
          limit: PAGE_SIZE,
          offset: (this.page - 1) * PAGE_SIZE
        });
        this.listItems = items;
        this.totalItems = total;
        // Clamp page after a filter/period change shrinks results.
        if (this.page > this.totalPages) {
          this.page = this.totalPages;
        }
      } catch (error) {
        console.error('Error loading feedback list:', error);
        this.errorMessage = this.translate(
          'admin.feedback.errors.loadFailed',
          'Could not load feedback data. Please try again.'
        );
        this.listItems = [];
        this.totalItems = 0;
      } finally {
        this.isListLoading = false;
      }
    },
    computeAvgRating(trend, fb) {
      // The backend dashboard doesn't ship an avg-rating field today, so derive a
      // sensible proxy from the positive/negative/neutral counts using the same
      // 4 / 2 / 3 buckets the dashboard uses for sentiment classification.
      const total = fb.total || 0;
      if (!total) return 0;
      const positive = fb.positive || 0;
      const negative = fb.negative || 0;
      const neutral = fb.neutral || 0;
      return (positive * 4.5 + neutral * 3 + negative * 1.5) / total;
    },
    formatNumber(value) {
      if (value == null) return '—';
      try {
        return Number(value).toLocaleString(this.currentLocale);
      } catch {
        return String(value);
      }
    },
    formatPercent(value) {
      if (value == null || isNaN(value)) return '0%';
      return `${Number(value).toFixed(1)}%`;
    },
    formatResponseTime(value) {
      if (value == null) return '—';
      if (value >= 1000) return `${(value / 1000).toFixed(1)}s`;
      return `${Math.round(value)}ms`;
    },
    formatDateTime(iso) {
      if (!iso) return '';
      try {
        const date = new Date(iso);
        return date.toLocaleString(this.currentLocale, {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        });
      } catch {
        return iso;
      }
    },
    truncate(value, max) {
      if (!value) return '';
      if (value.length <= max) return value;
      return `${value.slice(0, max).trim()}…`;
    },
    sentimentClass(item) {
      const sentiment = this.sentimentOf(item);
      return {
        'is-positive': sentiment === 'positive',
        'is-negative': sentiment === 'negative',
        'is-neutral': sentiment === 'neutral'
      };
    },
    sentimentIcon(item) {
      const sentiment = this.sentimentOf(item);
      if (sentiment === 'positive') return '▲';
      if (sentiment === 'negative') return '▼';
      return '●';
    },
    sentimentLabel(item) {
      const sentiment = this.sentimentOf(item);
      if (sentiment === 'positive') {
        return this.translate('admin.feedback.list.filter.positive', 'Positive');
      }
      if (sentiment === 'negative') {
        return this.translate('admin.feedback.list.filter.negative', 'Negative');
      }
      return this.translate('admin.feedback.list.neutral', 'Neutral');
    },
    sentimentOf(item) {
      const rating = Number(item.rating);
      if (rating >= 4 || item.thumbFeedback === 'up') return 'positive';
      if ((rating > 0 && rating <= 2) || item.thumbFeedback === 'down') return 'negative';
      return 'neutral';
    }
  }
};
</script>

<style scoped>
.feedback-insights {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.feedback-header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: flex-end;
  gap: 16px;
}

.feedback-title {
  margin: 0;
  font-size: 1.4rem;
  color: var(--text-primary);
}

.feedback-subtitle {
  margin: 4px 0 0;
  color: var(--text-secondary);
  font-size: 0.9rem;
  max-width: 60ch;
}

.feedback-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.feedback-controls label {
  font-size: 0.85rem;
  color: var(--text-secondary);
  margin-right: 6px;
}

.feedback-controls select,
.feedback-controls input[type='date'] {
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--border-color, #d1d5db);
  background: var(--bg-input, #fff);
  color: var(--text-primary);
  font-size: 0.9rem;
}

.btn-refresh {
  padding: 8px 14px;
  border-radius: 8px;
  border: 1px solid var(--border-color, #d1d5db);
  background: var(--bg-button-primary, #2563eb);
  color: var(--text-button-primary, #fff);
  cursor: pointer;
  font-size: 0.9rem;
  transition: opacity 0.2s ease;
}

.btn-refresh:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.feedback-error {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 10px;
  background: rgba(239, 68, 68, 0.08);
  color: #b91c1c;
  border: 1px solid rgba(239, 68, 68, 0.2);
}

.btn-link {
  background: none;
  border: none;
  padding: 0;
  color: var(--bg-button-primary, #2563eb);
  cursor: pointer;
  font-weight: 600;
}

.metrics-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 14px;
}

.metric-card {
  background: var(--bg-card, #fff);
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 14px;
  padding: 16px 18px;
  box-shadow: 0 2px 6px rgba(15, 23, 42, 0.04);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.metric-label {
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-secondary);
}

.metric-value {
  font-size: 1.7rem;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.1;
}

.metric-sub {
  font-size: 0.82rem;
  color: var(--text-secondary);
}

.feedback-chart-card,
.feedback-list-card {
  background: var(--bg-card, #fff);
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 14px;
  padding: 18px;
  box-shadow: 0 2px 6px rgba(15, 23, 42, 0.04);
}

.feedback-chart-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 8px;
}

.feedback-chart-header h3 {
  margin: 0;
  font-size: 1.05rem;
  color: var(--text-primary);
}

.feedback-chart-hint {
  color: var(--text-secondary);
  font-size: 0.82rem;
}

.feedback-chart-empty,
.feedback-list-empty {
  padding: 28px 0;
  text-align: center;
  color: var(--text-secondary);
  font-size: 0.95rem;
}

.feedback-list-header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
  margin-bottom: 12px;
}

.feedback-list-header h3 {
  margin: 0;
  font-size: 1.05rem;
  color: var(--text-primary);
}

.filter-chips {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.filter-chip {
  padding: 6px 12px;
  border-radius: 999px;
  border: 1px solid var(--border-color, #d1d5db);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  font-size: 0.82rem;
  transition: all 0.15s ease;
}

.filter-chip:hover {
  background: rgba(37, 99, 235, 0.06);
}

.filter-chip.active {
  background: var(--bg-button-primary, #2563eb);
  border-color: var(--bg-button-primary, #2563eb);
  color: var(--text-button-primary, #fff);
}

.feedback-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.feedback-list-item {
  border: 1px solid var(--border-color, #e5e7eb);
  border-radius: 12px;
  padding: 12px 14px;
  background: var(--bg-section, #fafbfc);
}

.feedback-row-top {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 6px;
}

.feedback-sentiment {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 0.78rem;
  font-weight: 600;
}

.feedback-sentiment.is-positive {
  background: rgba(34, 197, 94, 0.12);
  color: #15803d;
}

.feedback-sentiment.is-negative {
  background: rgba(239, 68, 68, 0.12);
  color: #b91c1c;
}

.feedback-sentiment.is-neutral {
  background: rgba(148, 163, 184, 0.18);
  color: #475569;
}

.feedback-sentiment-icon {
  font-size: 0.7rem;
}

.feedback-rating {
  font-size: 0.85rem;
  color: var(--text-secondary);
}

.feedback-when {
  margin-left: auto;
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.feedback-question,
.feedback-response,
.feedback-comment {
  margin-top: 6px;
}

.feedback-question-label,
.feedback-response-label,
.feedback-comment-label {
  display: block;
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--text-secondary);
  margin-bottom: 2px;
}

.feedback-question-text,
.feedback-response-text {
  margin: 0;
  color: var(--text-primary);
  font-size: 0.9rem;
  white-space: pre-wrap;
}

.feedback-comment-text {
  margin: 0;
  color: var(--text-primary);
  font-style: italic;
  font-size: 0.9rem;
}

.feedback-response-toggle {
  margin-top: 4px;
  font-size: 0.8rem;
}

.feedback-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 8px;
  font-size: 0.78rem;
  color: var(--text-secondary);
}

.feedback-meta-warn {
  color: #b45309;
  font-weight: 600;
}

.expert-answer {
  margin-top: 10px;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(34, 197, 94, 0.08);
  border: 1px solid rgba(34, 197, 94, 0.25);
}

.expert-answer-header {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 6px;
  margin-bottom: 4px;
}

.expert-answer-label {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #15803d;
  font-weight: 600;
}

.expert-answer-meta {
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.expert-answer-text {
  margin: 0;
  white-space: pre-wrap;
  color: var(--text-primary);
  font-size: 0.9rem;
}

.feedback-actions {
  margin-top: 10px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.btn-secondary {
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid var(--border-color, #d1d5db);
  background: var(--bg-input, #fff);
  color: var(--text-primary);
  cursor: pointer;
  font-size: 0.82rem;
  transition: background 0.15s ease;
}

.btn-secondary:hover {
  background: rgba(37, 99, 235, 0.06);
}

.btn-primary {
  padding: 6px 14px;
  border-radius: 8px;
  border: none;
  background: var(--bg-button-primary, #2563eb);
  color: var(--text-button-primary, #fff);
  cursor: pointer;
  font-size: 0.85rem;
  font-weight: 600;
}

.btn-primary:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.expert-editor {
  margin-top: 10px;
  padding: 12px;
  border-radius: 10px;
  background: var(--bg-input, #fff);
  border: 1px solid var(--border-color, #d1d5db);
}

.expert-editor-label {
  display: block;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 6px;
}

.expert-textarea {
  width: 100%;
  border: 1px solid var(--border-color, #d1d5db);
  border-radius: 8px;
  padding: 8px 10px;
  font-family: inherit;
  font-size: 0.9rem;
  color: var(--text-primary);
  background: var(--bg-input, #fff);
  resize: vertical;
  min-height: 80px;
}

.expert-textarea:focus {
  outline: none;
  border-color: var(--bg-button-primary, #2563eb);
}

.expert-editor-actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 12px;
  margin-top: 8px;
}

.feedback-pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-top: 16px;
}

.page-btn {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: 1px solid var(--border-color, #d1d5db);
  background: var(--bg-input, #fff);
  cursor: pointer;
  font-size: 1rem;
  color: var(--text-primary);
}

.page-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.page-info {
  font-size: 0.85rem;
  color: var(--text-secondary);
}

@media (max-width: 720px) {
  .feedback-header {
    flex-direction: column;
    align-items: stretch;
  }

  .feedback-controls {
    justify-content: flex-start;
  }

  .feedback-when {
    margin-left: 0;
  }
}
</style>
