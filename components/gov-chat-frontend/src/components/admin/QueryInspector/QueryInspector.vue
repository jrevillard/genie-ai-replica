<template>
  <div class="query-inspector">
    <DsSpinner v-if="loading" />
    <DsStateDisplay
      v-else-if="loadError"
      type="error"
      :message="translate('admin.queryInspector.loadError', 'Failed to load queries.')"
    />
    <template v-else>
      <QueryInspectorList
        v-if="!selectedQuery"
        :queries="queries"
        :pagination="pagination"
        @search="handleSearch"
        @page="goToPage"
        @inspect="inspectQuery"
      />
      <QueryInspectorDetail v-else :query="selectedQuery" @back="selectedQuery = null" />
    </template>
  </div>
</template>

<script>
import adminDashboardService from '../../../services/adminDashboardService';
import DsSpinner from '../../ds/Spinner.vue';
import DsStateDisplay from '../../ds/StateDisplay.vue';
import QueryInspectorList from './QueryInspectorList.vue';
import QueryInspectorDetail from './QueryInspectorDetail.vue';

export default {
  name: 'QueryInspector',
  components: { DsSpinner, DsStateDisplay, QueryInspectorList, QueryInspectorDetail },
  data() {
    return {
      queries: [],
      selectedQuery: null,
      loading: false,
      loadError: false,
      currentFilters: {},
      pagination: {
        total: 0,
        limit: 25,
        offset: 0,
        pages: 0,
        currentPage: 1
      }
    };
  },
  mounted() {
    this.loadQueries();
  },
  methods: {
    translate(key, fallback) {
      return this.$parent?.translate?.(key, fallback) ?? fallback;
    },
    async loadQueries() {
      this.loading = true;
      this.loadError = false;
      try {
        const params = {
          ...this.currentFilters,
          limit: this.pagination.limit,
          offset: this.pagination.offset
        };
        Object.keys(params).forEach((k) => {
          if (params[k] === '' || params[k] == null) delete params[k];
        });

        const result = await adminDashboardService.getQueriesForInspector(params);
        if (result.success) {
          this.queries = result.data.queries;
          this.pagination = result.data.pagination;
        }
      } catch (error) {
        console.error('[QueryInspector] Failed to load queries:', error);
        this.loadError = true;
      } finally {
        this.loading = false;
      }
    },
    handleSearch(filters) {
      this.currentFilters = { ...filters };
      this.pagination.offset = 0;
      this.loadQueries();
    },
    goToPage(page) {
      this.pagination.offset = (page - 1) * this.pagination.limit;
      this.loadQueries();
    },
    async inspectQuery(queryId) {
      this.loading = true;
      this.loadError = false;
      try {
        const result = await adminDashboardService.getQueryInspectorDetails(queryId);
        if (result.success) {
          this.selectedQuery = result.data;
        }
      } catch (error) {
        console.error('[QueryInspector] Failed to load query details:', error);
        this.loadError = true;
      } finally {
        this.loading = false;
      }
    }
  }
};
</script>

<style scoped>
.query-inspector {
  width: 100%;
}
</style>
