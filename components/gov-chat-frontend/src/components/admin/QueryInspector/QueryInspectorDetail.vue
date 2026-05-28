<template>
  <div class="qi-detail">
    <div class="qi-detail__header">
      <DsButton variant="ghost" @click="$emit('back')">
        {{ translate('admin.queryInspector.backToList', 'Back to list') }}
      </DsButton>
      <h3 class="qi-detail__title">
        {{ translate('admin.queryInspector.detailTitle', 'Query Inspector') }} — {{ query._key }}
      </h3>
    </div>

    <div class="qi-detail__sections">
      <!-- User Question -->
      <DsCard variant="outline">
        <template #header>
          <span class="qi-detail__section-title">
            {{ translate('admin.queryInspector.sectionQuestion', 'User Question') }}
          </span>
        </template>
        <div class="qi-detail__meta">
          <span><strong>{{ translate('admin.queryInspector.user', 'User') }}:</strong> {{ query.userName || query.userId }}</span>
          <span><strong>{{ translate('admin.queryInspector.time', 'Time') }}:</strong> {{ formatTime(query.timestamp) }}</span>
          <span><strong>{{ translate('admin.queryInspector.responseTime', 'Response Time') }}:</strong> {{ query.responseTime || 0 }}ms</span>
          <span><strong>{{ translate('admin.queryInspector.mode', 'Mode') }}:</strong> {{ query.contextOption || 'N/A' }}</span>
        </div>
        <div class="qi-detail__box">{{ query.text }}</div>
      </DsCard>

      <!-- Context -->
      <DsCard variant="outline">
        <template #header>
          <span class="qi-detail__section-title">
            {{ translate('admin.queryInspector.sectionContext', 'Context (Labels sent to RAG)') }}
          </span>
        </template>
        <div class="qi-detail__box qi-detail__box--context">
          <p><strong>{{ translate('admin.queryInspector.category', 'Category') }}:</strong> {{ query.context?.categoryLabel || 'None' }}</p>
          <p>
            <strong>{{ translate('admin.queryInspector.serviceLabels', 'Service Labels') }}:</strong>
            <span v-if="query.context?.serviceLabels?.length">{{ query.context.serviceLabels.join(', ') }}</span>
            <span v-else class="qi-detail__muted">None</span>
          </p>
          <p v-if="query.context?.language">
            <strong>{{ translate('admin.queryInspector.language', 'Language') }}:</strong> {{ query.context.language }}
          </p>
        </div>
      </DsCard>

      <!-- Messages -->
      <DsCard v-if="query.messages?.length" variant="outline">
        <template #header>
          <span class="qi-detail__section-title">
            {{ translate('admin.queryInspector.sectionMessages', 'Messages Sent to Pipeline') }}
          </span>
        </template>
        <div class="qi-detail__messages">
          <div
            v-for="(msg, idx) in query.messages"
            :key="idx"
            :class="['qi-detail__message', `qi-detail__message--${msg.role}`]"
          >
            <span class="qi-detail__msg-role">{{ msg.role }}:</span>
            <span>{{ msg.content }}</span>
          </div>
        </div>
      </DsCard>

      <!-- Retrieved Documents -->
      <DsCard variant="outline">
        <template #header>
          <span class="qi-detail__section-title">
            {{ translate('admin.queryInspector.sectionDocuments', 'Retrieved Documents (Vector DB Results)') }}
          </span>
        </template>
        <div v-if="query.metadata?.source_documents?.length" class="qi-detail__docs">
          <div v-for="(doc, idx) in query.metadata.source_documents" :key="idx" class="qi-detail__doc">
            <div class="qi-detail__doc-header">
              <span class="qi-detail__doc-name">{{ doc.document_name || doc.document_id }}</span>
              <DsPill :variant="confidenceVariant(doc.score)">
                {{ translate('admin.queryInspector.score', 'Score') }}: {{ formatConfidence(doc.score) }}
              </DsPill>
            </div>
            <div class="qi-detail__doc-meta">
              <span v-if="doc.categoryLabel">
                <strong>{{ translate('admin.queryInspector.labels', 'Labels') }}:</strong>
                {{ Array.isArray(doc.categoryLabel) ? doc.categoryLabel.join(', ') : doc.categoryLabel }}
              </span>
              <a v-if="doc.url && doc.url !== 'error'" :href="doc.url" target="_blank" rel="noopener">
                {{ translate('admin.queryInspector.viewDoc', 'View Document') }}
              </a>
            </div>
          </div>
        </div>
        <DsStateDisplay
          v-else
          type="empty"
          :message="translate('admin.queryInspector.noDocuments', 'No source documents were retrieved for this query.')"
        />
      </DsCard>

      <!-- LLM Response -->
      <DsCard variant="outline">
        <template #header>
          <span class="qi-detail__section-title">
            {{ translate('admin.queryInspector.sectionResponse', 'LLM Response') }}
          </span>
        </template>
        <div class="qi-detail__box qi-detail__box--response">
          {{ query.response || 'No response recorded' }}
        </div>
        <div class="qi-detail__meta" style="margin-top: var(--space-sm);">
          <span>
            <strong>{{ translate('admin.queryInspector.confidenceScore', 'Confidence Score') }}:</strong>
            <DsPill v-if="query.metadata?.confidence_score != null" :variant="confidenceVariant(query.metadata.confidence_score)">
              {{ formatConfidence(query.metadata.confidence_score) }}
            </DsPill>
            <span v-else class="qi-detail__muted">N/A</span>
          </span>
        </div>
      </DsCard>

      <!-- User Feedback -->
      <DsCard v-if="query.userFeedback" variant="outline">
        <template #header>
          <span class="qi-detail__section-title">
            {{ translate('admin.queryInspector.sectionFeedback', 'User Feedback') }}
          </span>
        </template>
        <div class="qi-detail__box qi-detail__box--feedback">
          <p>
            <strong>{{ translate('admin.queryInspector.rating', 'Rating') }}:</strong>
            <DsPill :variant="feedbackVariant(query.userFeedback.rating)">
              {{ feedbackLabel(query.userFeedback.rating) }} ({{ query.userFeedback.rating }})
            </DsPill>
          </p>
          <p v-if="query.userFeedback.comment">
            <strong>{{ translate('admin.queryInspector.comment', 'Comment') }}:</strong> {{ query.userFeedback.comment }}
          </p>
          <p class="qi-detail__muted">
            {{ translate('admin.queryInspector.providedAt', 'Provided at') }}: {{ formatTime(query.userFeedback.providedAt) }}
          </p>
        </div>
      </DsCard>
    </div>
  </div>
</template>

<script>
import DsButton from '../../ds/Button.vue';
import DsCard from '../../ds/Card.vue';
import DsPill from '../../ds/Pill.vue';
import DsStateDisplay from '../../ds/StateDisplay.vue';

export default {
  name: 'QueryInspectorDetail',
  components: { DsButton, DsCard, DsPill, DsStateDisplay },
  props: {
    query: { type: Object, required: true }
  },
  emits: ['back'],
  methods: {
    translate(key, fallback) {
      return this.$parent?.translate?.(key, fallback) ?? fallback;
    },
    formatTime(ts) {
      return ts ? new Date(ts).toLocaleString() : 'N/A';
    },
    formatConfidence(score) {
      return score != null ? (score * 100).toFixed(1) + '%' : 'N/A';
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
.qi-detail__header {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  margin-bottom: var(--space-lg);
}

.qi-detail__title {
  margin: 0;
  font-size: var(--text-md);
}

.qi-detail__sections {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

.qi-detail__section-title {
  font-size: var(--text-sm);
  font-weight: 600;
}

.qi-detail__meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-md);
  font-size: var(--text-sm);
  margin-bottom: var(--space-sm);
  color: var(--fg);
}

.qi-detail__meta strong {
  color: var(--muted);
}

.qi-detail__box {
  background: var(--surface);
  border-radius: var(--radius-sm);
  padding: var(--space-sm) var(--space-md);
  font-size: var(--text-sm);
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.qi-detail__box--response {
  border-left: 3px solid var(--info);
}

.qi-detail__box--context {
  border-left: 3px solid var(--warning);
}

.qi-detail__box--feedback {
  border-left: 3px solid var(--success);
}

.qi-detail__muted {
  color: var(--muted-soft);
  font-size: var(--text-xs);
}

/* Messages */
.qi-detail__messages {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.qi-detail__message {
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
}

.qi-detail__message--user {
  background: var(--info-bg);
}

.qi-detail__message--assistant {
  background: var(--surface);
  border: 1px solid var(--border-light);
}

.qi-detail__message--system {
  background: var(--warning-bg);
}

.qi-detail__msg-role {
  font-weight: 600;
  text-transform: capitalize;
  margin-right: var(--space-sm);
}

/* Documents */
.qi-detail__docs {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.qi-detail__doc {
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  padding: var(--space-sm) var(--space-md);
}

.qi-detail__doc-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: var(--space-xs);
}

.qi-detail__doc-name {
  font-weight: 600;
  font-size: var(--text-sm);
}

.qi-detail__doc-meta {
  font-size: var(--text-xs);
  color: var(--muted);
  display: flex;
  gap: var(--space-md);
}

.qi-detail__doc-meta a {
  color: var(--accent);
  text-decoration: none;
}

.qi-detail__doc-meta a:hover {
  text-decoration: underline;
}
</style>
