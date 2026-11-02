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
          <span
            ><strong>{{ translate('admin.queryInspector.user', 'User') }}:</strong>
            {{ query.userName || query.userId }}</span
          >
          <span
            ><strong>{{ translate('admin.queryInspector.time', 'Time') }}:</strong>
            {{ formatTime(query.timestamp) }}</span
          >
          <span
            ><strong>{{ translate('admin.queryInspector.responseTime', 'Response Time') }}:</strong>
            {{ query.responseTime || 0 }}ms</span
          >
          <span
            ><strong>{{ translate('admin.queryInspector.mode', 'Mode') }}:</strong>
            {{ query.contextOption || translate('admin.queryInspector.notAvailable', 'N/A') }}</span
          >
        </div>
        <div class="qi-detail__box">{{ query.text }}</div>
      </DsCard>

      <!-- Context -->
      <DsCard variant="outline">
        <template #header>
          <span class="qi-detail__section-title">
            {{ translate('admin.queryInspector.sectionContext', 'Context') }}
          </span>
        </template>
        <div class="qi-detail__box qi-detail__box--context">
          <p data-testid="qi-detail-scope">
            <strong>{{ translate('admin.queryInspector.scopeFiltered', 'Scope that filtered') }}:</strong>
            {{ scopeText() }}
          </p>
          <p>
            <strong>{{ translate('admin.queryInspector.category', 'Requested Category') }}:</strong>
            {{ query.context?.categoryLabel || translate('admin.queryInspector.none', 'None') }}
          </p>
          <p>
            <strong>{{ translate('admin.queryInspector.serviceLabels', 'Requested Service Labels') }}:</strong>
            <span v-if="query.context?.serviceLabels?.length">{{ query.context.serviceLabels.join(', ') }}</span>
            <span v-else class="qi-detail__muted">{{ translate('admin.queryInspector.none', 'None') }}</span>
          </p>
          <p v-if="query.context?.language">
            <strong>{{ translate('admin.queryInspector.language', 'Language') }}:</strong> {{ query.context.language }}
          </p>
        </div>
      </DsCard>

      <!-- Abstention -->
      <DsCard v-if="isAbstained" variant="outline">
        <template #header>
          <span class="qi-detail__section-title">
            {{ translate('admin.queryInspector.sectionAbstention', 'Abstention') }}
          </span>
        </template>
        <div class="qi-detail__abstention">
          <DsPill variant="warning" data-testid="qi-abstention-marker">
            {{ translate('admin.queryInspector.abstained', 'Abstained') }}
          </DsPill>
          <span data-testid="qi-abstention-reason">{{ abstentionReasonText }}</span>
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
          {{ query.response || translate('admin.queryInspector.noResponseRecorded', 'No response recorded') }}
        </div>
        <div class="qi-detail__meta" style="margin-top: var(--space-sm)">
          <span>
            <strong>{{ translate('admin.queryInspector.confidenceScore', 'Confidence Score') }}:</strong>
            <DsPill
              v-if="query.metadata?.confidence_score != null"
              :variant="confidenceVariant(query.metadata.confidence_score)"
            >
              {{ formatConfidence(query.metadata.confidence_score) }}
            </DsPill>
            <span v-else class="qi-detail__muted">{{ translate('admin.queryInspector.notAvailable', 'N/A') }}</span>
          </span>
          <span v-if="query.metadata?.retrieval_confidence_score != null">
            <strong>{{ translate('admin.queryInspector.retrievalConfidenceScore', 'Retrieval Confidence') }}:</strong>
            <DsPill :variant="confidenceVariant(query.metadata.retrieval_confidence_score)">
              {{ formatConfidence(query.metadata.retrieval_confidence_score) }}
            </DsPill>
          </span>
          <span v-if="query.metadata && Object.prototype.hasOwnProperty.call(query.metadata, 'self_confidence')">
            <strong>{{ translate('admin.queryInspector.selfConfidence', 'Self-Confidence (LLM)') }}:</strong>
            <DsPill
              v-if="query.metadata.self_confidence != null"
              :variant="confidenceVariant(query.metadata.self_confidence)"
            >
              {{ formatConfidence(query.metadata.self_confidence) }}
            </DsPill>
            <span v-else class="qi-detail__muted">{{
              translate('admin.queryInspector.notAvailableNoSentinel', 'N/A (no sentinel)')
            }}</span>
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
            <strong>{{ translate('admin.queryInspector.comment', 'Comment') }}:</strong>
            {{ query.userFeedback.comment }}
          </p>
          <p class="qi-detail__muted">
            {{ translate('admin.queryInspector.providedAt', 'Provided at') }}:
            {{ formatTime(query.userFeedback.providedAt) }}
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
import translateMixin from '../../../mixins/translateMixin';
import { isAbstained as queryIsAbstained, scopeDisplayText } from './query-scope';

export default {
  name: 'QueryInspectorDetail',
  components: { DsButton, DsCard, DsPill, DsStateDisplay },
  mixins: [translateMixin],
  props: {
    query: { type: Object, required: true }
  },
  emits: ['back'],
  computed: {
    /**
     * Whether this query abstained. `abstained` is null when the turn never
     * produced an answer to classify, and false when it answered — only a
     * true flag marks an abstention.
     */
    isAbstained() {
      return queryIsAbstained(this.query);
    },
    /**
     * The cause of the abstention, in the operator's words. The machine
     * reason stays the source of truth; this only says what it means. An
     * unknown code keeps the generic sentence and names the code, so a new
     * producer never renders as bare machine tokens.
     */
    abstentionReasonText() {
      const reason = this.query.metadata?.abstention_reason;
      if (reason === 'no_documents_retrieved') {
        return this.translate(
          'admin.queryInspector.abstentionNoDocuments',
          'No document was retrieved for this query. The answer has no document backing.'
        );
      }
      if (reason === 'reranker_selected_nothing') {
        return this.translate(
          'admin.queryInspector.abstentionRerankerSelectedNothing',
          'The retrieval matched documents, but the reranker kept none of them. The scope was fine — the answer has no document backing.'
        );
      }
      if (reason === 'reranker_input_too_long') {
        return this.translate(
          'admin.queryInspector.abstentionRerankerInput',
          'The reranker refused an oversized input (an ingestion-side issue). The answer has no document backing.'
        );
      }
      const generic = this.translate(
        'admin.queryInspector.abstentionUnspecified',
        'The answer has no document backing.'
      );
      return reason ? `${generic} (${reason})` : generic;
    }
  },
  methods: {
    /**
     * The labels the retrieval filtered on, as one string. The pipeline
     * decides them (chatqna sends the applied filter labels in its metadata
     * event). A record saved before that field existed says so instead of
     * claiming the query was unfiltered.
     */
    scopeText() {
      // Absent, null, or malformed — the record does not say — reads as the
      // dedicated label; the rest comes from the shared rendering, so the
      // list and this panel cannot disagree.
      const text = scopeDisplayText(this.query, this.translate('admin.queryInspector.unfiltered', 'Unfiltered'));
      return text === null ? this.translate('admin.queryInspector.scopeNotRecorded', 'Not recorded') : text;
    },
    // translate comes from translateMixin (round 22) — see QueryInspectorList.
    formatTime(ts) {
      return ts ? new Date(ts).toLocaleString() : this.translate('admin.queryInspector.notAvailable', 'N/A');
    },
    formatConfidence(score) {
      return score != null
        ? (score * 100).toFixed(1) + '%'
        : this.translate('admin.queryInspector.notAvailable', 'N/A');
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
      if (rating >= 4) return this.translate('admin.queryInspector.feedbackPositive', 'Positive');
      if (rating >= 3) return this.translate('admin.queryInspector.feedbackNeutral', 'Neutral');
      return this.translate('admin.queryInspector.feedbackNegative', 'Negative');
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

.qi-detail__abstention {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  font-size: var(--text-sm);
  line-height: 1.6;
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
