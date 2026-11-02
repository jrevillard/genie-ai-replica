<template>
  <div class="query-inspector">
    <!-- Filters -->
    <div class="inspector-filters">
      <div class="filter-row">
        <div class="filter-group">
          <label>Search</label>
          <input
            type="text"
            v-model="filters.searchText"
            placeholder="Search query text..."
            @keyup.enter="loadQueries"
          />
        </div>
        <div class="filter-group">
          <label>Min Confidence</label>
          <input
            type="number"
            v-model="filters.minConfidence"
            min="0"
            max="1"
            step="0.1"
            placeholder="0.0"
          />
        </div>
        <div class="filter-group">
          <label>Max Confidence</label>
          <input
            type="number"
            v-model="filters.maxConfidence"
            min="0"
            max="1"
            step="0.1"
            placeholder="1.0"
          />
        </div>
        <div class="filter-group">
          <label>From</label>
          <input type="date" v-model="filters.startDate" />
        </div>
        <div class="filter-group">
          <label>To</label>
          <input type="date" v-model="filters.endDate" />
        </div>
        <div class="filter-group filter-actions">
          <button class="btn btn-primary" @click="loadQueries">Search</button>
          <button class="btn btn-outline" @click="resetFilters">Reset</button>
        </div>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="inspector-loading">
      <span>Loading queries...</span>
    </div>

    <!-- Query List -->
    <div v-if="!loading && !selectedQuery" class="query-list">
      <div v-if="queries.length === 0" class="empty-state">
        <p>No queries found matching your filters.</p>
      </div>

      <table v-else class="inspector-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>User Question</th>
            <th>Model</th>
            <th>Confidence</th>
            <th>Response Time</th>
            <th>Sources</th>
            <th>Feedback</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="query in queries"
            :key="query._key"
            class="query-row"
            @click="inspectQuery(query._key)"
          >
            <td class="col-time">{{ formatTime(query.timestamp) }}</td>
            <td class="col-question">{{ truncate(query.text, 80) }}</td>
            <td class="col-model">
              <span class="model-badge">{{ query.llmModel || '—' }}</span>
            </td>
            <td class="col-confidence">
              <span
                :class="getConfidenceClass(query.metadata?.confidence_score)"
              >
                {{ formatConfidence(query.metadata?.confidence_score) }}
              </span>
            </td>
            <td class="col-response-time">{{ query.responseTime || 0 }}ms</td>
            <td class="col-sources">
              {{ query.metadata?.source_documents?.length || 0 }}
            </td>
            <td class="col-feedback">
              <span v-if="query.userFeedback" :class="getFeedbackClass(query.userFeedback.rating)">
                {{ getFeedbackIcon(query.userFeedback.rating) }}
              </span>
              <span v-else class="no-feedback">—</span>
            </td>
            <td class="col-actions">
              <button
                class="btn btn-sm btn-outline"
                @click.stop="inspectQuery(query._key)"
              >
                Inspect
              </button>
            </td>
          </tr>
        </tbody>
      </table>

      <!-- Pagination -->
      <div v-if="pagination.pages > 1" class="pagination">
        <button
          class="btn btn-sm"
          :disabled="pagination.currentPage <= 1"
          @click="goToPage(pagination.currentPage - 1)"
        >
          ← Prev
        </button>
        <span class="page-info">
          Page {{ pagination.currentPage }} of {{ pagination.pages }}
          ({{ pagination.total }} total)
        </span>
        <button
          class="btn btn-sm"
          :disabled="pagination.currentPage >= pagination.pages"
          @click="goToPage(pagination.currentPage + 1)"
        >
          Next →
        </button>
      </div>
    </div>

    <!-- Query Detail View -->
    <div v-if="selectedQuery" class="query-detail">
      <div class="detail-header">
        <button class="btn btn-outline" @click="selectedQuery = null">
          ← Back to list
        </button>
        <h3>Query Inspector — {{ selectedQuery._key }}</h3>
      </div>

      <div class="detail-sections">
        <!-- User Question -->
        <div class="detail-section">
          <h4>📝 User Question</h4>
          <div class="detail-content">
            <div class="detail-meta">
              <span><strong>User:</strong> {{ selectedQuery.userName || selectedQuery.userId }}</span>
              <span><strong>Time:</strong> {{ formatTime(selectedQuery.timestamp) }}</span>
              <span><strong>Response Time:</strong> {{ selectedQuery.responseTime || 0 }}ms</span>
              <span><strong>Mode:</strong> {{ selectedQuery.contextOption || 'N/A' }}</span>
              <span><strong>LLM Model:</strong> <span class="model-badge">{{ selectedQuery.llmModel || 'N/A' }}</span></span>
            </div>
            <div class="detail-box">
              <p>{{ selectedQuery.text }}</p>
            </div>
          </div>
        </div>

        <!-- Context Sent -->
        <div class="detail-section">
          <h4>🏷️ Context (Labels sent to RAG)</h4>
          <div class="detail-content">
            <div class="detail-box context-box">
              <p><strong>Category:</strong> {{ selectedQuery.context?.categoryLabel || 'None' }}</p>
              <p><strong>Service Labels:</strong>
                <span v-if="selectedQuery.context?.serviceLabels?.length">
                  {{ selectedQuery.context.serviceLabels.join(', ') }}
                </span>
                <span v-else class="muted">None</span>
              </p>
              <p v-if="selectedQuery.context?.language">
                <strong>Language:</strong> {{ selectedQuery.context.language }}
              </p>
            </div>
          </div>
        </div>

        <!-- RAG Request Payload -->
        <div class="detail-section">
          <h4>📡 RAG Request Payload (Sent to OPEA)</h4>
          <div class="detail-content">
            <div v-if="selectedQuery.ragPayload" class="detail-box rag-payload-box">
              <div class="rag-payload-meta">
                <span><strong>Endpoint:</strong> /v1/chatqna</span>
                <span><strong>Mode:</strong> {{ selectedQuery.contextOption || 'N/A' }}</span>
                <span v-if="selectedQuery.ragPayload._note" class="muted">
                  ({{ selectedQuery.ragPayload._note }})
                </span>
              </div>
              <details class="rag-payload-details" open>
                <summary>Request Body</summary>
                <pre class="rag-payload-json">{{ formatJson(selectedQuery.ragPayload) }}</pre>
              </details>
            </div>
            <div v-else class="empty-state">
              <p>No RAG payload was recorded for this query (older query or missing data).</p>
            </div>
          </div>
        </div>

        <!-- Messages (full conversation sent) -->
        <div class="detail-section" v-if="selectedQuery.messages?.length">
          <h4>💬 Messages Sent to Pipeline</h4>
          <div class="detail-content">
            <div class="messages-list">
              <div
                v-for="(msg, idx) in selectedQuery.messages"
                :key="idx"
                :class="['message-item', `role-${msg.role}`]"
              >
                <span class="msg-role">{{ msg.role }}:</span>
                <span class="msg-content">{{ msg.content }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Retrieved Documents / Source Documents -->
        <div class="detail-section">
          <h4>📚 Retrieved Documents (Vector DB Results)</h4>
          <div class="detail-content">
            <div
              v-if="selectedQuery.metadata?.source_documents?.length"
              class="source-docs"
            >
              <div
                v-for="(doc, idx) in selectedQuery.metadata.source_documents"
                :key="idx"
                class="source-doc-card"
              >
                <div class="doc-header">
                  <span class="doc-name">{{ doc.document_name || doc.document_id }}</span>
                  <span :class="getConfidenceClass(doc.score)" class="doc-score">
                    Score: {{ formatConfidence(doc.score) }}
                  </span>
                </div>
                <div class="doc-meta">
                  <span v-if="doc.categoryLabel">
                    <strong>Labels:</strong>
                    {{ Array.isArray(doc.categoryLabel) ? doc.categoryLabel.join(', ') : doc.categoryLabel }}
                  </span>
                  <span v-if="doc.url && doc.url !== 'error'">
                    <a :href="doc.url" target="_blank" rel="noopener">View Document</a>
                  </span>
                </div>
              </div>
            </div>
            <div v-else class="empty-state">
              <p>No source documents were retrieved for this query.</p>
            </div>
          </div>
        </div>

        <!-- LLM Response -->
        <div class="detail-section">
          <h4>🤖 LLM Response</h4>
          <div class="detail-content">
            <div class="detail-box response-box">
              <p>{{ selectedQuery.response || 'No response recorded' }}</p>
            </div>
            <div class="detail-meta">
              <span>
                <strong>Confidence Score:</strong>
                <span :class="getConfidenceClass(selectedQuery.metadata?.confidence_score)">
                  {{ formatConfidence(selectedQuery.metadata?.confidence_score) }}
                </span>
              </span>
              <span>
                <strong>Model:</strong>
                <span class="model-badge">{{ selectedQuery.llmModel || 'N/A' }}</span>
              </span>
            </div>
          </div>
        </div>

        <!-- User Feedback -->
        <div class="detail-section" v-if="selectedQuery.userFeedback">
          <h4>⭐ User Feedback</h4>
          <div class="detail-content">
            <div class="detail-box feedback-box">
              <p>
                <strong>Rating:</strong>
                {{ getFeedbackIcon(selectedQuery.userFeedback.rating) }}
                ({{ selectedQuery.userFeedback.rating }})
              </p>
              <p v-if="selectedQuery.userFeedback.comment">
                <strong>Comment:</strong> {{ selectedQuery.userFeedback.comment }}
              </p>
              <p class="muted">
                Provided at: {{ formatTime(selectedQuery.userFeedback.providedAt) }}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import adminDashboardService from "../services/adminDashboardService";
import "./QueryInspector.css";

export default {
  name: "QueryInspector",
  data() {
    return {
      queries: [],
      selectedQuery: null,
      loading: false,
      pagination: {
        total: 0,
        limit: 25,
        offset: 0,
        pages: 0,
        currentPage: 1,
      },
      filters: {
        searchText: "",
        minConfidence: "",
        maxConfidence: "",
        startDate: "",
        endDate: "",
        userId: "",
      },
    };
  },
  mounted() {
    this.loadQueries();
  },
  methods: {
    async loadQueries() {
      this.loading = true;
      try {
        const params = { ...this.filters, limit: this.pagination.limit, offset: this.pagination.offset };
        // Remove empty params
        Object.keys(params).forEach((key) => {
          if (params[key] === "" || params[key] === null || params[key] === undefined) {
            delete params[key];
          }
        });

        const result = await adminDashboardService.getQueriesForInspector(params);
        if (result.success) {
          this.queries = result.data.queries;
          this.pagination = result.data.pagination;
        }
      } catch (error) {
        console.error("Failed to load queries:", error);
      } finally {
        this.loading = false;
      }
    },

    async inspectQuery(queryId) {
      this.loading = true;
      try {
        const result = await adminDashboardService.getQueryInspectorDetails(queryId);
        if (result.success) {
          this.selectedQuery = result.data;
        }
      } catch (error) {
        console.error("Failed to load query details:", error);
      } finally {
        this.loading = false;
      }
    },

    goToPage(page) {
      this.pagination.offset = (page - 1) * this.pagination.limit;
      this.loadQueries();
    },

    resetFilters() {
      this.filters = {
        searchText: "",
        minConfidence: "",
        maxConfidence: "",
        startDate: "",
        endDate: "",
        userId: "",
      };
      this.pagination.offset = 0;
      this.loadQueries();
    },

    formatTime(timestamp) {
      if (!timestamp) return "N/A";
      return new Date(timestamp).toLocaleString();
    },

    formatConfidence(score) {
      if (score === undefined || score === null) return "N/A";
      return (score * 100).toFixed(1) + "%";
    },

    truncate(text, maxLen) {
      if (!text) return "";
      return text.length > maxLen ? text.substring(0, maxLen) + "..." : text;
    },

    getConfidenceClass(score) {
      if (score === undefined || score === null) return "confidence-na";
      if (score >= 0.8) return "confidence-high";
      if (score >= 0.5) return "confidence-medium";
      return "confidence-low";
    },

    getFeedbackClass(rating) {
      if (rating >= 4) return "feedback-positive";
      if (rating >= 3) return "feedback-neutral";
      return "feedback-negative";
    },

    getFeedbackIcon(rating) {
      if (rating >= 4) return "👍";
      if (rating >= 3) return "😐";
      return "👎";
    },

    formatJson(obj) {
      if (!obj) return "null";
      try {
        return JSON.stringify(obj, null, 2);
      } catch (e) {
        return String(obj);
      }
    },
  },
};
</script>
