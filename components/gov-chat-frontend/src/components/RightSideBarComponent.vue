<template>
  <div class="sidebar" :class="{ collapsed: sidebarCollapsed }">
    <div class="sidebar-header">
      <h3 v-if="!sidebarCollapsed">{{ $t('sidebar.title') }}</h3>
      <DsButton
        variant="ghost"
        :small="true"
        class="sidebar-toggle"
        :aria-label="sidebarCollapsed ? $t('sidebar.expand') : $t('sidebar.collapse')"
        @click="toggleSidebar"
      >
        <ChevronRight v-if="!sidebarCollapsed" :size="20" /><ChevronLeft v-else :size="20" />
      </DsButton>
    </div>

    <div v-if="!sidebarCollapsed">
      <div class="sidebar-section">
        <h4 class="section-title">
          <FileText :size="16" />
          {{ $t('sidebar.relatedDocs') }}
        </h4>
        <div class="related-documents">
          <DsCard v-for="doc in relatedDocuments" :key="doc.id" variant="flat" padding="md" class="document-item">
            <div class="document-header" @click="openDocument(doc)">
              <div class="document-icon">
                <component :is="documentIconClass(doc)" :size="20" />
              </div>
              <div class="document-info">
                <div class="document-title">{{ doc.title }}</div>
                <div class="document-url-link">
                  {{ getDisplayUrl(doc) }}
                </div>
              </div>
            </div>
            <div class="document-details">
              <div v-if="doc.documentName" class="detail-item">
                <span class="detail-label">Document Name:</span>
                <span class="detail-value">{{ doc.documentName }}</span>
              </div>
              <div v-if="doc.fileName" class="detail-item">
                <span class="detail-label">File Name:</span>
                <span class="detail-value">{{ doc.fileName }}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">{{ $t('sidebar.id') }}:</span>
                <span class="detail-value">{{ doc.id }}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">{{ $t('sidebar.labels') }}:</span>
                <span class="detail-value small-text">{{ formatLabels(doc) }}</span>
              </div>
              <div class="detail-item">
                <span class="detail-label">{{ $t('sidebar.confidence') }}:</span>
                <span class="detail-value">{{ formatScore(doc.score) }}</span>
              </div>
            </div>
          </DsCard>
          <DsStateDisplay v-if="relatedDocuments.length === 0" type="empty">
            {{ $t('sidebar.noDocuments') }}
          </DsStateDisplay>
        </div>
      </div>
      <div class="sidebar-section">
        <h4 class="section-title">
          <HelpCircle :size="16" />
          {{ $t('sidebar.faq') }}
        </h4>
        <div class="faq-list">
          <div v-for="(faq, index) in frequentlyAskedQuestions" :key="index" class="faq-item">
            <div class="faq-question" :class="{ active: expandedFaqs.includes(index) }" @click="toggleFaq(index)">
              <!-- eslint-disable-next-line vue/no-v-html -->
              <span v-html="faq.question"></span>
              <ChevronUp v-if="expandedFaqs.includes(index)" :size="14" /><ChevronDown v-else :size="14" />
            </div>
            <!-- eslint-disable-next-line vue/no-v-html -->
            <div v-if="expandedFaqs.includes(index)" class="faq-answer" v-html="faq.answer"></div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { formatFileSize } from '../utils/fileUtils.js';
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  HelpCircle,
  ChevronUp,
  ChevronDown,
  Globe,
  FileSpreadsheet,
  FileImage
} from '@lucide/vue';
import DsCard from './ds/Card.vue';
import DsButton from './ds/Button.vue';
import DsStateDisplay from './ds/StateDisplay.vue';

export default {
  name: 'RightSideBarComponent',

  components: {
    DsButton,
    DsCard,
    DsStateDisplay,
    ChevronLeft,
    ChevronRight,
    FileText,
    HelpCircle,
    ChevronUp,
    ChevronDown,
    Globe,
    FileSpreadsheet,
    FileImage
  },

  props: {
    currentChatId: {
      type: String,
      default: null
    },
    currentLocale: {
      type: String,
      default: 'en'
    },
    relatedDocuments: {
      type: Array,
      default: () => []
    }
  },
  emits: ['sidebar-toggle', 'open-document'],

  data() {
    return {
      sidebarCollapsed: false,
      expandedFaqs: [],
      frequentlyAskedQuestions: []
    };
  },

  watch: {
    currentLocale: {
      handler() {
        this.loadFaqContent();
      },
      immediate: true
    }
  },

  methods: {
    formatFileSize,
    async loadFaqContent() {
      try {
        const response = await fetch('/FAQ.md');
        if (!response.ok) {
          throw new Error('FAQ.md not found');
        }
        let markdown = await response.text();

        if (this.currentLocale !== 'en') {
          markdown = await this.translateMarkdown(markdown);
        }

        const tokens = marked.lexer(markdown);
        const faqs = [];
        let currentQuestion = null;
        let currentAnswer = '';

        tokens.forEach((token) => {
          if (token.type === 'heading' && token.depth === 2) {
            if (currentQuestion) {
              faqs.push({
                question: DOMPurify.sanitize(marked.parseInline(currentQuestion)),
                answer: DOMPurify.sanitize(marked.parse(currentAnswer.trim()))
              });
            }
            currentQuestion = token.text;
            currentAnswer = '';
          } else if (currentQuestion) {
            currentAnswer += token.raw;
          }
        });

        if (currentQuestion) {
          faqs.push({
            question: DOMPurify.sanitize(marked.parseInline(currentQuestion)),
            answer: DOMPurify.sanitize(marked.parse(currentAnswer.trim()))
          });
        }

        this.frequentlyAskedQuestions = faqs;
      } catch (error) {
        console.error('Failed to load or parse FAQ content:', error);
        this.frequentlyAskedQuestions = [{ question: 'Error', answer: 'Could not load FAQ content.' }];
      }
    },

    async translateMarkdown(markdown) {
      const authToken = this.getAuthToken();
      if (!authToken) {
        console.error('No auth token found, cannot translate FAQ.');
        return markdown; // Fallback to English
      }

      try {
        const response = await fetch('/api/translate/markdown', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`
          },
          body: JSON.stringify({
            markdown,
            source_lang: 'en',
            target_lang: this.currentLocale
          })
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        return data.translated_markdown;
      } catch (error) {
        console.error('Translation failed:', error);
        return markdown; // Fallback to English
      }
    },

    toggleSidebar() {
      this.sidebarCollapsed = !this.sidebarCollapsed;
      this.$emit('sidebar-toggle', this.sidebarCollapsed);
    },

    toggleFaq(index) {
      if (this.expandedFaqs.includes(index)) {
        this.expandedFaqs = this.expandedFaqs.filter((i) => i !== index);
      } else {
        this.expandedFaqs.push(index);
      }
    },

    isExternalUrl(url) {
      if (!url) return false;
      const isHttp = url.startsWith('http://') || url.startsWith('https://');
      const isPlaceholder = url.includes('<HOST>') || url.includes('<PORT>');
      // A URL is considered external only if it's a valid HTTP link AND not a placeholder.
      return isHttp && !isPlaceholder;
    },

    // Added missing method to fix runtime error
    documentIconClass(doc) {
      if (!doc) return 'FileText';
      if (this.isExternalUrl(doc.url)) return 'Globe';
      if (doc.fileName) {
        const n = doc.fileName.toLowerCase();
        if (n.endsWith('.pdf')) return 'FileText';
        if (n.endsWith('.doc') || n.endsWith('.docx')) return 'FileText';
        if (n.endsWith('.xls') || n.endsWith('.xlsx')) return 'FileSpreadsheet';
        if (n.endsWith('.ppt') || n.endsWith('.pptx')) return 'FileText';
        if (n.endsWith('.jpg') || n.endsWith('.png') || n.endsWith('.jpeg')) return 'FileImage';
      }
      return 'FileText';
    },

    async openDocument(doc) {
      if (this.isExternalUrl(doc.url)) {
        window.open(doc.url, '_blank');
        this.$emit('open-document', doc);
        return;
      }

      const authToken = this.getAuthToken();
      if (!authToken) {
        console.error('Authentication token not found. Unable to open internal document.');
        return;
      }

      const fileUrl = `${window.location.origin}/api/files/${doc.id}/viewbrowser`;

      try {
        const response = await fetch(fileUrl, {
          headers: {
            Authorization: `Bearer ${authToken}`
          }
        });

        if (!response.ok) {
          throw new Error(`Network response was not ok: ${response.statusText}`);
        }

        const fileBlob = await response.blob();
        const blobUrl = URL.createObjectURL(fileBlob);
        window.open(blobUrl, '_blank');

        setTimeout(() => URL.revokeObjectURL(blobUrl), 100);

        this.$emit('open-document', doc);
      } catch (error) {
        console.error('There was a problem fetching the internal document:', error);
      }
    },

    getAuthToken() {
      return this.$store.getters.accessToken || null;
    },

    getDisplayUrl(doc) {
      if (!doc) return '';
      if (this.isExternalUrl(doc.url)) {
        return doc.url;
      }
      if (doc.id) {
        return `${window.location.origin}/api/files/${doc.id}/viewbrowser`;
      }
      return doc.url || ''; // Fallback to show the original placeholder if no ID
    },

    formatScore(score) {
      if (typeof score !== 'number' || isNaN(score)) return this.$t('sidebar.unknown');
      return (score * 100).toFixed(2) + '%';
    },

    formatLabels(doc) {
      if (!doc.categoryLabel) return this.$t('sidebar.unknown');
      const services = doc.serviceLabels?.join(', ') || '';
      return `${doc.categoryLabel}${services ? ':' + services : ''}`;
    }
  }
};
</script>

<style scoped>
/* Sidebar Styles */
.sidebar {
  width: 320px;
  background: var(--surface);
  border-left: 1px solid var(--border);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  transition: width 0.3s ease;
}

.sidebar.collapsed {
  width: 50px;
  overflow: visible;
}

.sidebar-header {
  padding: var(--space-md);
  border-bottom: 1px solid var(--border);
  display: flex;
  justify-content: space-between;
  align-items: center;
  position: relative;
}

.sidebar.collapsed .sidebar-header {
  padding: var(--space-md) 0;
  justify-content: center;
  border-bottom: none;
}

.sidebar-toggle {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
}

.sidebar-toggle:hover {
  background: var(--bg);
  color: var(--muted);
}

.sidebar-section {
  padding: var(--space-md);
  border-bottom: 1px solid var(--border);
}

.section-title {
  margin: 0 0 var(--space-md) 0;
  font-size: var(--text-base);
  font-weight: 600;
  color: var(--fg);
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

.section-title i {
  font-size: var(--text-base);
  color: var(--muted-soft);
}

.related-documents {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
}

.document-item {
  transition: all 0.2s ease;
}

.document-header {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  cursor: pointer;
  margin-bottom: var(--space-sm);
}

.document-header:hover {
  color: var(--accent);
}

.document-icon {
  font-size: var(--text-lg);
  color: var(--muted-soft);
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.document-info {
  flex: 1;
  overflow: hidden;
}

.document-title {
  font-size: var(--text-base);
  font-weight: 500;
  color: var(--fg);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 2px;
}

.document-url-link {
  font-size: var(--text-sm);
  color: var(--accent);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-decoration: none;
}

.document-header:hover .document-url-link {
  text-decoration: underline;
}

.document-details {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  font-size: var(--text-base);
  color: var(--muted);
  padding-top: var(--space-sm);
  border-top: 1px solid var(--border-light);
}

.detail-item {
  display: flex;
  justify-content: space-between;
  gap: var(--space-sm);
}

.detail-label {
  font-weight: 500;
  color: var(--fg);
  white-space: nowrap;
}

.detail-value {
  text-align: right;
  overflow: hidden;
  text-overflow: ellipsis;
}

.detail-value.small-text {
  font-size: var(--text-sm);
}

.faq-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.faq-item {
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.faq-question {
  padding: var(--space-md);
  background: var(--surface);
  font-size: var(--text-base);
  font-weight: 500;
  color: var(--fg);
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.faq-question:hover,
.faq-question.active {
  background: var(--bg);
}

.faq-question i {
  font-size: var(--text-base);
  color: var(--muted-soft);
  transition: transform 0.2s;
}
.faq-question.active i {
  transform: rotate(180deg);
}

.faq-answer {
  padding: var(--space-md);
  font-size: var(--text-base);
  color: var(--muted);
  background: var(--bg);
  border-top: 1px solid var(--border-light);
  line-height: 1.5;
}

.faq-answer :deep(p:first-child) {
  margin-top: 0;
}
.faq-answer :deep(p:last-child) {
  margin-bottom: 0;
}
.faq-answer :deep(ul),
.faq-answer :deep(ol) {
  padding-left: var(--space-lg);
}

@media (max-width: 768px) {
  .sidebar {
    position: fixed;
    right: 0;
    top: 0;
    bottom: 0;
    z-index: 100;
    transform: translateX(100%);
  }

  .sidebar.visible {
    transform: translateX(0);
  }

  .sidebar.collapsed {
    transform: translateX(calc(100% - 50px));
  }
}
</style>
