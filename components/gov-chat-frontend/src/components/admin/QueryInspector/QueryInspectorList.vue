<template>
  <div class="qi-list">
    <!-- Filters -->
    <div class="qi-list__filters">
      <div class="qi-list__filter-row">
        <DsFormGroup :label="translate('admin.queryInspector.search', 'Search')">
          <DsInput
            v-model="filters.searchText"
            type="search"
            :placeholder="translate('admin.queryInspector.searchPlaceholder', 'Search query text...')"
            @keyup.enter="$emit('search', filters)"
          />
        </DsFormGroup>
        <DsFormGroup :label="translate('admin.queryInspector.minConfidence', 'Min Confidence')">
          <DsInput v-model="filters.minConfidence" type="number" placeholder="0.0" min="0" max="1" step="0.1" />
        </DsFormGroup>
        <DsFormGroup :label="translate('admin.queryInspector.maxConfidence', 'Max Confidence')">
          <DsInput v-model="filters.maxConfidence" type="number" placeholder="1.0" min="0" max="1" step="0.1" />
        </DsFormGroup>
        <DsFormGroup :label="translate('admin.queryInspector.from', 'From')">
          <DsInput v-model="filters.startDate" type="date" />
        </DsFormGroup>
        <DsFormGroup :label="translate('admin.queryInspector.to', 'To')">
          <DsInput v-model="filters.endDate" type="date" />
        </DsFormGroup>
        <div class="qi-list__filter-actions">
          <DsButton variant="primary" @click="$emit('search', filters)">
            {{ translate('admin.queryInspector.search', 'Search') }}
          </DsButton>
          <DsButton variant="ghost" @click="resetFilters">
            {{ translate('admin.queryInspector.reset', 'Reset') }}
          </DsButton>
        </div>
      </div>
    </div>

    <!-- Table -->
    <table v-if="queries.length" class="qi-list__table">
      <thead>
        <tr>
          <th>{{ translate('admin.queryInspector.colTime', 'Time') }}</th>
          <th>{{ translate('admin.queryInspector.colQuestion', 'User Question') }}</th>
          <th>{{ translate('admin.queryInspector.colConfidence', 'Confidence') }}</th>
          <th>{{ translate('admin.queryInspector.colResponseTime', 'Response Time') }}</th>
          <th>{{ translate('admin.queryInspector.colSources', 'Sources') }}</th>
          <th>{{ translate('admin.queryInspector.colFeedback', 'Feedback') }}</th>
          <th>{{ translate('admin.queryInspector.colActions', 'Actions') }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="query in queries" :key="query._key" class="qi-list__row" @click="$emit('inspect', query._key)">
          <td class="qi-list__cell--time">{{ formatTime(query.timestamp) }}</td>
          <td class="qi-list__cell--question">{{ truncate(query.text, 80) }}</td>
          <td class="qi-list__cell--center">
            <DsPill
              v-if="query.metadata?.confidence_score != null"
              :variant="confidenceVariant(query.metadata.confidence_score)"
            >
              {{ formatConfidence(query.metadata.confidence_score) }}
            </DsPill>
            <span v-else class="qi-list__muted">N/A</span>
          </td>
          <td class="qi-list__cell--center">{{ query.responseTime || 0 }}ms</td>
          <td class="qi-list__cell--center">{{ query.metadata?.source_documents?.length || 0 }}</td>
          <td class="qi-list__cell--center">
            <DsPill v-if="query.userFeedback" :variant="feedbackVariant(query.userFeedback.rating)">
              {{ feedbackLabel(query.userFeedback.rating) }}
            </DsPill>
            <span v-else class="qi-list__muted">—</span>
          </td>
          <td class="qi-list__cell--center">
            <DsButton variant="ghost" small @click.stop="$emit('inspect', query._key)">
              {{ translate('admin.queryInspector.inspect', 'Inspect') }}
            </DsButton>
          </td>
        </tr>
      </tbody>
    </table>

    <DsStateDisplay
      v-else
      type="empty"
      :message="translate('admin.queryInspector.noResults', 'No queries found matching your filters.')"
    />

    <!-- Pagination -->
    <div v-if="pagination.pages > 1" class="qi-list__pagination">
      <DsButton
        variant="ghost"
        :disabled="pagination.currentPage <= 1"
        @click="$emit('page', pagination.currentPage - 1)"
      >
        {{ translate('admin.queryInspector.prev', 'Prev') }}
      </DsButton>
      <span class="qi-list__page-info">
        {{
          translate('admin.queryInspector.pageInfo', 'Page {current} of {total} ({count} total)')
            .replace('{current}', pagination.currentPage)
            .replace('{total}', pagination.pages)
            .replace('{count}', pagination.total)
        }}
      </span>
      <DsButton
        variant="ghost"
        :disabled="pagination.currentPage >= pagination.pages"
        @click="$emit('page', pagination.currentPage + 1)"
      >
        {{ translate('admin.queryInspector.next', 'Next') }}
      </DsButton>
    </div>
  </div>
</template>

<script>
import DsButton from '../../ds/Button.vue';
import DsInput from '../../ds/Input.vue';
import DsFormGroup from '../../ds/FormGroup.vue';
import DsPill from '../../ds/Pill.vue';
import DsStateDisplay from '../../ds/StateDisplay.vue';

export default {
  name: 'QueryInspectorList',
  components: { DsButton, DsInput, DsFormGroup, DsPill, DsStateDisplay },
  props: {
    queries: { type: Array, default: () => [] },
    pagination: {
      type: Object,
      default: () => ({ total: 0, limit: 25, offset: 0, pages: 0, currentPage: 1 })
    }
  },
  emits: ['search', 'page', 'inspect'],
  data() {
    return {
      filters: {
        searchText: '',
        minConfidence: '',
        maxConfidence: '',
        startDate: '',
        endDate: ''
      }
    };
  },
  methods: {
    translate(key, fallback) {
      return this.$parent?.translate?.(key, fallback) ?? fallback;
    },
    resetFilters() {
      this.filters = { searchText: '', minConfidence: '', maxConfidence: '', startDate: '', endDate: '' };
      this.$emit('search', this.filters);
    },
    formatTime(ts) {
      return ts ? new Date(ts).toLocaleString() : 'N/A';
    },
    formatConfidence(score) {
      return score != null ? (score * 100).toFixed(1) + '%' : 'N/A';
    },
    truncate(text, max) {
      return text?.length > max ? text.substring(0, max) + '...' : text || '';
    },
    confidenceVariant(score) {
      if (score >= 0.8) return 'success';
      if (score >= 0.5) return 'warning';
      return 'danger';
    },
    feedbackVariant(rating) {
      if (rating >= 4) return 'success';
      if (rating >= 3) return 'warning';
      return 'danger';
    },
    feedbackLabel(rating) {
      if (rating >= 4) return 'Positive';
      if (rating >= 3) return 'Neutral';
      return 'Negative';
    }
  }
};
</script>

<style scoped>
.qi-list__filters {
  background: var(--surface);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  padding: var(--space-md);
  margin-bottom: var(--space-md);
}

.qi-list__filter-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-md);
  align-items: flex-end;
}

.qi-list__filter-row .ds-form-group {
  margin-bottom: 0;
  min-width: 120px;
}

.qi-list__filter-actions {
  display: flex;
  gap: var(--space-sm);
  align-items: flex-end;
}

.qi-list__table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
}

.qi-list__table th {
  text-align: left;
  padding: var(--space-sm) var(--space-md);
  background: var(--surface);
  border-bottom: 2px solid var(--border);
  font-weight: 600;
  color: var(--muted);
  font-size: var(--text-xs);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.qi-list__table td {
  padding: var(--space-sm) var(--space-md);
  border-bottom: 1px solid var(--border-light);
  vertical-align: middle;
}

.qi-list__row {
  cursor: pointer;
  transition: background 0.15s;
}

.qi-list__row:hover {
  background: var(--accent-muted);
}

.qi-list__cell--time {
  white-space: nowrap;
  color: var(--muted);
}

.qi-list__cell--question {
  max-width: 300px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.qi-list__cell--center {
  text-align: center;
}

.qi-list__muted {
  color: var(--muted-soft);
}

.qi-list__pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-md);
  padding: var(--space-md) 0;
}

.qi-list__page-info {
  font-size: var(--text-sm);
  color: var(--muted);
}
</style>
