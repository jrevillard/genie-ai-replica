<template>
  <div class="sidebar" :class="{ collapsed: sidebarCollapsed }" :style="{ '--sidebar-width': `${width}px` }">
    <!-- The handle comes FIRST in the flex row. On the right panel
         the seam with the centre is the panel's LEFT edge, so a handle
         placed after the content lands on the far edge — against the
         viewport, nowhere near the boundary a user aims at. The left
         panel is the mirror image and therefore the reverse order. -->
    <SidebarHandle
      v-if="showHandle"
      side="right"
      :value="width"
      :min="minWidth"
      :max="maxWidth"
      :collapsed="sidebarCollapsed"
      :aria-label="$t('sidebar.resizeRight')"
      :expand-label="$t('sidebar.expandRight')"
      :collapse-label="$t('sidebar.collapseRight')"
      @input="$emit('update:width', $event)"
      @collapse="toggleSidebar"
      @reset="$emit('update:width', defaultWidth)"
    />

    <div class="sidebar-inner-wrap">
      <div class="sidebar-header">
        <h3 v-if="!sidebarCollapsed">{{ $t('sidebar.title') }}</h3>
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
            <!-- D16: the empty panel explains itself; the FAQs stay below. -->
            <DsStateDisplay v-if="relatedDocuments.length === 0" type="empty" data-testid="documents-empty">
              <template #icon>
                <Files :size="28" aria-hidden="true" />
              </template>
              {{ $t('sidebar.noDocuments') }}
              <template #hint>{{ $t('sidebar.documentsWillAppear') }}</template>
            </DsStateDisplay>
          </div>
        </div>
        <div class="sidebar-section" data-testid="faq-section">
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
  </div>
</template>

<script>
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { formatFileSize } from '../utils/fileUtils.js';
import DsStateDisplay from './ds/StateDisplay.vue';
import { Files, FileText, HelpCircle, ChevronUp, ChevronDown, Globe, FileSpreadsheet, FileImage } from '@lucide/vue';
import DsCard from './ds/Card.vue';
import SidebarHandle from './SidebarHandle.vue';
import { SIDEBAR_DEFAULTS, SIDEBAR_MIN_WIDTHS, SIDEBAR_MAX_WIDTHS } from '../composables/sidebarLayout.js';

export default {
  name: 'RightSideBarComponent',

  components: {
    DsCard,
    SidebarHandle,
    FileText,
    HelpCircle,
    ChevronUp,
    ChevronDown,
    Globe,
    FileSpreadsheet,
    FileImage,
    Files,
    DsStateDisplay
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
    },
    // The panel's current width in pixels. Driven by the parent (the
    // chatbot component owns both sidebars' clamp).
    width: {
      type: Number,
      default: SIDEBAR_DEFAULTS.right
    },
    // The dynamic max the handle should enforce. The parent
    // recomputes it on every viewport change and every resize of
    // the other sidebar.
    maxWidth: {
      type: Number,
      default: SIDEBAR_MAX_WIDTHS.right
    },
    // Whether the resize handle should render. Off below the
    // breakpoint where the sidebar slides off-canvas.
    showHandle: {
      type: Boolean,
      default: true
    },
    // Whether the panel is currently collapsed. Replaces the prior
    // internal-only `sidebarCollapsed` so the state lives outside
    // the component and survives a route change.
    collapsed: {
      type: Boolean,
      default: false
    }
  },
  emits: ['open-document', 'update:width', 'update:collapsed'],

  data() {
    return {
      expandedFaqs: [],
      frequentlyAskedQuestions: []
    };
  },
  computed: {
    // The collapsed state is owned by the parent (it is persisted, and
    // the two sidebars' clamps have to agree). This writable alias
    // lets the existing `sidebarCollapsed` reads in the template stay.
    sidebarCollapsed: {
      get() {
        return this.collapsed;
      },
      set(v) {
        this.$emit('update:collapsed', v);
      }
    },
    defaultWidth() {
      return SIDEBAR_DEFAULTS.right;
    },
    minWidth() {
      return SIDEBAR_MIN_WIDTHS.right;
    }
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
      // The setter emits `update:collapsed`, which the parent owns —
      // the panel no longer keeps this state to itself, so it survives
      // a route change and the two sidebars' clamps stay in agreement.
      this.sidebarCollapsed = !this.sidebarCollapsed;
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
/* Sidebar Styles. The width arrives as the `--sidebar-width` custom
   property, bound inline on the root .sidebar div. A custom property
   rather than a direct `width` binding on purpose: an inline `width`
   outranks every stylesheet rule, so it would also outrank the
   off-canvas rule below — a 320 px panel would keep that width on a
   414 px phone. Binding the variable and letting each rule decide
   keeps the responsive policy in CSS, where it belongs. */
.sidebar {
  width: var(--sidebar-width, 320px);
  /* The handle's width, declared here so the panel and the handle it
     contains agree on one number: a collapsed panel is exactly as wide
     as the control it carries. */
  --sidebar-handle-width: 24px;
  background: var(--surface);
  border-left: 1px solid var(--border);
  display: flex;
  flex-direction: row;
  align-items: stretch;
  flex: 0 0 auto;
  overflow: hidden;
  /* No gap between the panel and the content beside it. The panel's
     own border is the separation; a margin drew a second line, and
     the user read that band as a stray strip around the chat. */
  transition:
    width 0.3s ease,
    transform 0.3s ease;
}

/* Collapsed is exactly the handle's width, and the handle lives
   inside the panel — which is why the panel is never collapsed to
   zero. Zero would clip the one control that brings it back.
   A wider rail than the handle leaves a band of empty panel beside
   the control, and the user read that band as a stray strip. */
.sidebar.collapsed {
  width: var(--sidebar-collapsed-width, var(--sidebar-handle-width));
}

.sidebar-inner-wrap {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
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

@media (max-width: 1399px) {
  /* Off-canvas until made visible. The boundary is (max-width: 1399px)
     — both sidebars step aside together at this width: the left
     sidebar's CSS in SideBarComponent sets the same breakpoint so
     the layout has a single, monotonic threshold. The right stays
     in flow at every width ≥ 1400 px, where the layout reserves
     the two users' chosen widths for the sidebars; below 1400 px
     the chat column never has to reserve space for both, so the
     centre never narrows as the user widens the window. The Living
     Intelligence layer's corner-network rule in
     genie-visual-effects.css is bounded to @media screen and
     (min-width: 1400px), so it does not compete for position
     below 1400 px. */
  .sidebar {
    position: fixed;
    right: 0;
    top: 0;
    bottom: 0;
    /* Off-canvas, so the user's width no longer applies — a 480 px
       panel has no business reserving width it is translated out of.
       The width is restated here rather than inherited from the base
       rule, so the off-canvas panel is as wide as the sheet it is. */
    width: min(100%, 480px);
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
