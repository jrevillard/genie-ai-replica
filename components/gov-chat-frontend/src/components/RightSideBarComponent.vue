<template>
  <div
    class="sidebar"
    data-testid="sidebar-right"
    :data-collapsed="sidebarCollapsed ? 'true' : 'false'"
    :class="{ collapsed: sidebarCollapsed }"
    :style="{ '--sidebar-width': `${width}px` }"
  >
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
            <DsCard
              v-for="(doc, di) in relatedDocuments"
              :key="doc.id"
              variant="flat"
              padding="md"
              class="document-item"
            >
              <div class="document-header" @click="openDocument(doc)">
                <div class="document-icon">
                  <span class="file-type-badge" :data-tone="documentBadge(doc).tone">{{
                    documentBadge(doc).label
                  }}</span>
                </div>
                <div class="document-info">
                  <div class="document-title">{{ doc.title }}</div>
                  <div class="document-url-link">
                    {{ getDisplayUrl(doc) }}
                  </div>
                </div>
              </div>
              <!-- CAP-4 (W5): a concept card can name the documents it
                   ORIGINATED from — the same secondary origin rows as the
                   answer cards. Never rendered without resolved sources. -->
              <div v-if="isOkfConceptSource(doc) && doc.okfSources && doc.okfSources.length" class="document-origins">
                <!-- #1827: an origin doc-repo answers 404 for is a FACT, not
                     a click — the muted row names it, the working file keeps
                     its link. -->
                <template v-for="(o, oi) in doc.okfSources" :key="`${oi}-${o.file_id || o.resource}`">
                  <span
                    v-if="o.missing"
                    class="document-origin document-origin--missing"
                    :data-testid="`document-origin-missing-${oi}`"
                  >
                    <FileText :size="12" aria-hidden="true" />
                    <span class="document-origin__label">{{ originLabel(o) }}</span>
                    <span class="document-origin__missing-note">
                      {{ $t('chatbot.okfOriginMissing') }}
                    </span>
                  </span>
                  <button
                    v-else
                    type="button"
                    class="document-origin"
                    :data-testid="`document-origin-${oi}`"
                    @click.stop="openOriginDocument(o)"
                  >
                    <FileText :size="12" aria-hidden="true" />
                    <span class="document-origin__label">{{ originLabel(o) }}</span>
                    <ExternalLink :size="12" aria-hidden="true" />
                  </button>
                </template>
              </div>
              <!-- W9 (concept tree browse): the browse affordance on a
                   WORKING okf-concept card — one dialog (owned by the parent)
                   opens from either surface, so the sidebar's citations get
                   the same browse path the answer cards have. Emits to the
                   parent; no repo identity (pre-CAP-1 row) → no affordance. -->
              <div v-if="canBrowseSource(doc)" class="document-browse">
                <button
                  type="button"
                  class="document-browse-btn"
                  :data-testid="`document-browse-${di}`"
                  @click.stop="browseSource(doc)"
                >
                  <Library :size="12" aria-hidden="true" />
                  <span>{{ $t('chatbot.okfBrowseRepo') }}</span>
                </button>
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
          <DsStateDisplay v-if="faqLoadFailed" type="error" data-testid="faq-error">
            {{ $t('sidebar.faqError') }}
          </DsStateDisplay>
          <template v-else>
            <!-- The FAQ is written in English. When it could not be translated,
                 what is shown below is the original: saying so is what keeps an
                 English FAQ from being read as a translated one. -->
            <div v-if="faqTranslationFailed" class="faq-translation-notice" data-testid="faq-translation-notice">
              <Languages :size="14" />
              <span>{{ $t('sidebar.faqTranslationUnavailable') }}</span>
            </div>
            <div class="faq-list">
              <div v-for="(faq, index) in frequentlyAskedQuestions" :key="index" class="faq-item">
                <div
                  class="faq-question"
                  :class="{ active: expandedFaqs.includes(index) }"
                  data-testid="faq-question"
                  @click="toggleFaq(index)"
                >
                  <!-- eslint-disable-next-line vue/no-v-html -->
                  <span v-html="faq.question"></span>
                  <ChevronUp v-if="expandedFaqs.includes(index)" :size="14" /><ChevronDown v-else :size="14" />
                </div>
                <!-- eslint-disable-next-line vue/no-v-html -->
                <div v-if="expandedFaqs.includes(index)" class="faq-answer" v-html="faq.answer"></div>
              </div>
            </div>
          </template>
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
  isExternalUrl as isExternalHref,
  openRepositoryDocument,
  openOkfConcept,
  openOkfSource,
  fileTypeBadge
} from '../utils/document-opener.js';
import { isOkfConceptSource, okfConceptBadge, canBrowseSource } from '../utils/okfCitation.js';
import notificationService from '../services/notificationService';
import DsStateDisplay from './ds/StateDisplay.vue';
import { Files, FileText, HelpCircle, ChevronUp, ChevronDown, Languages, ExternalLink, Library } from '@lucide/vue';
import DsCard from './ds/Card.vue';
import SidebarHandle from './SidebarHandle.vue';
import { SIDEBAR_DEFAULTS, SIDEBAR_MIN_WIDTHS, SIDEBAR_MAX_WIDTHS } from '../composables/sidebarLayout.js';

export default {
  name: 'RightSideBarComponent',

  components: {
    DsCard,
    SidebarHandle,
    FileText,
    ExternalLink,
    HelpCircle,
    ChevronUp,
    ChevronDown,
    Files,
    DsStateDisplay,
    Languages,
    Library
  },

  props: {
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
  emits: ['open-document', 'browse-document', 'update:width', 'update:collapsed'],

  data() {
    return {
      expandedFaqs: [],
      frequentlyAskedQuestions: [],
      faqLoadFailed: false,
      faqTranslationFailed: false
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
    // Template-facing alias for the shared predicate (review fix 2026-11-07:
    // one predicate for fetch guard, badge AND card branches — no raw
    // `doc.source` string checks left to drift).
    isOkfConceptSource,

    formatFileSize,
    async loadFaqContent() {
      this.faqLoadFailed = false;
      this.faqTranslationFailed = false;

      try {
        const response = await fetch('/FAQ.md');
        if (!response.ok) {
          throw new Error('FAQ.md not found');
        }
        let markdown = await response.text();

        if (this.currentLocale !== 'en') {
          const translated = await this.translateMarkdown(markdown);
          if (translated === null) {
            // The English original is kept — it is still worth showing — but
            // the user is told that it was not translated.
            this.faqTranslationFailed = true;
          } else {
            markdown = translated;
          }
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
        this.frequentlyAskedQuestions = [];
        this.faqLoadFailed = true;
      }
    },

    /**
     * Translate the FAQ into the interface language.
     *
     * @returns {Promise<string|null>} the translated markdown, or null when the
     *   translation could not be produced. null is not an error to swallow:
     *   the caller shows the English original and says so.
     */
    async translateMarkdown(markdown) {
      const authToken = this.getAuthToken();
      if (!authToken) {
        console.error('No auth token found, cannot translate FAQ.');
        return null;
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
        // A translation is a non-empty string. A response that carries
        // nothing usable is not a translation: it would leave the FAQ empty
        // (or unreadable) and the user would see an English FAQ they were
        // told was translated. The caller keeps the English original and
        // says so.
        if (typeof data.translated_markdown !== 'string' || data.translated_markdown.length === 0) {
          console.error('Translation response carried no translated markdown.');
          return null;
        }
        return data.translated_markdown;
      } catch (error) {
        console.error('Translation failed:', error);
        return null;
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
      return isExternalHref(url);
    },

    documentBadge(doc) {
      // An OKF concept is not a file: it has no extension, so the extension
      // fallback would render the first four characters of its name. The
      // sidebar lists the SAME citations as the answer card — the badge must
      // say the same thing in both places.
      if (isOkfConceptSource(doc)) return okfConceptBadge();
      return fileTypeBadge(doc.fileName || doc.title);
    },

    async openDocument(doc) {
      if (isExternalHref(doc.url)) {
        window.open(doc.url, '_blank');
        this.$emit('open-document', doc);
        return;
      }

      // CAP-3 (chat-source resolution): an OKF concept has no doc-repository
      // file — it opens as rendered markdown through okf-server under the
      // caller's own scope. No repo identity (persisted pre-CAP-1 row) or an
      // unavailable concept degrades to an honest notice, never a dead link.
      if (isOkfConceptSource(doc)) {
        if (!doc.repoId || !doc.id) {
          notificationService.info(this.$t('chatbot.okfSourceUnavailable'));
          return;
        }
        try {
          await openOkfConcept(doc.repoId, doc.id);
          this.$emit('open-document', doc);
        } catch (error) {
          if (error && error.code === 'OKF_CONCEPT_UNAVAILABLE') {
            notificationService.info(this.$t('chatbot.okfSourceUnavailable'));
          } else {
            // Review fix (2026-11-07): a generic open failure was
            // console-only here while ChatBotComponent surfaces the same
            // failure as a toast — the sidebar must not be the silent one.
            console.error('There was a problem opening the OKF concept:', error);
            notificationService.error(this.$t('chatbot.documentOpenError'));
          }
        }
        return;
      }

      try {
        await openRepositoryDocument(doc.id, this.getAuthToken());
        this.$emit('open-document', doc);
      } catch (error) {
        console.error('There was a problem fetching the internal document:', error);
      }
    },

    // CAP-4 (W5): original-source rows under a concept card.
    originLabel(origin) {
      const name = (origin && (origin.file_name || origin.resource)) || '';
      if (name)
        return String(name)
          .replace(/^https?:\/\//, '')
          .slice(0, 60);
      return this.$t('chatbot.okfOriginalSource');
    },

    async openOriginDocument(origin) {
      if (!origin || !origin.file_id) {
        notificationService.info(this.$t('chatbot.okfSourceUnavailable'));
        return;
      }
      try {
        await openOkfSource(origin.file_id, this.getAuthToken());
        this.$emit('open-document', origin);
      } catch (error) {
        if (error && error.code === 'OKF_SOURCE_UNAVAILABLE') {
          notificationService.info(this.$t('chatbot.okfSourceUnavailable'));
        } else {
          console.error('There was a problem opening the original source:', error);
        }
      }
    },

    // ── W9 (concept tree browse) ─────────────────────────────────────────
    // canBrowseSource is the SHARED predicate (utils/okfCitation.js — one
    // definition for both surfaces, review r0); the sidebar only names the
    // cited concept — the dialog itself is owned by the parent.
    canBrowseSource,

    // The dialog is owned by the parent (one instance for both surfaces);
    // the sidebar only names the cited concept.
    browseSource(doc) {
      if (!this.canBrowseSource(doc)) return;
      this.$emit('browse-document', doc);
    },

    getAuthToken() {
      return this.$store.getters.accessToken || null;
    },

    getDisplayUrl(doc) {
      if (!doc) return '';
      if (this.isExternalUrl(doc.url)) {
        return doc.url;
      }
      // CAP-3: a concept row never shows a doc-repository URL — the family
      // cannot resolve it (the old placeholder viewbrowser link was one of
      // the dead-link generators).
      if (isOkfConceptSource(doc)) {
        return '';
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

/* CAP-4 (W5): the original-source rows under a concept card. */
.document-origins {
  display: flex;
  flex-direction: column;
  gap: calc(var(--space-xs) / 2);
  margin-bottom: var(--space-sm);
}

.document-origin {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  padding: 2px var(--space-xs);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  text-align: left;
  font-size: var(--text-xs);
}

.document-origin:hover {
  color: var(--accent);
  background: var(--surface);
}

/* #1827: an origin whose file is gone is a fact, not a click — muted, no
   hover affordance, the missing note rides the label. */
.document-origin--missing {
  cursor: default;
  flex-wrap: wrap;
}

.document-origin--missing:hover {
  color: var(--muted);
  background: transparent;
}

.document-origin__missing-note {
  color: var(--muted);
  font-size: var(--text-xs);
  opacity: 0.85;
  flex: 1 1 100%;
}

.document-origin__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  flex: 1 1 auto;
}

/* W9 (concept tree browse): the browse affordance under a working OKF
   citation card — the same quiet secondary-row pattern as the origins. */
.document-browse {
  display: flex;
  margin-bottom: var(--space-sm);
}

.document-browse-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  padding: 2px var(--space-xs);
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--accent);
  cursor: pointer;
  text-align: left;
  font-size: var(--text-xs);
}

.document-browse-btn:hover {
  background: var(--accent-muted);
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

.faq-translation-notice {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  margin-bottom: var(--space-sm);
  padding: var(--space-xs) var(--space-sm);
  border: 1px solid var(--warning);
  border-radius: var(--radius-sm);
  color: var(--warning);
  font-size: var(--text-xs);
  font-style: italic;
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
