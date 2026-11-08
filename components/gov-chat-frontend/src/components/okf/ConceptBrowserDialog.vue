<!-- ConceptBrowserDialog.vue — W9 (concept tree browse, chat-source
  resolution, 2026-11-08): the citizen-facing modal viewer opened from a
  working OKF citation card in EITHER chat surface. The okf store's browser
  slice assembles the paginated tree index progressively (the fetchConcepts
  stale-guard pattern; ≤ 200 rows per payload, never the full corpus in one
  response); every concept's markdown is fetched on demand through the CAP-2
  concept route (fetchOkfConcept's honest unavailable mapping) and rendered
  client-side with the MarkdownIt + DOMPurify pipeline — no server rendering
  endpoint exists or is wanted. Read-only: browse + hops + download, no
  steward tooling.
  IA: the D8 design pass (ux-csr-w9-concept-browser.md) — progressive
  ALPHABETICAL LIST (author edges are sparse; a flat list is what makes
  every concept reachable) + related-concept chips as hops; two panes on
  desktop, stacked with a Back-to-list affordance on narrow viewports. -->
<template>
  <DsDialog
    :visible="visible"
    :title="translate('chatbot.okfBrowser.title', 'Browse repository')"
    size="lg"
    :loading="treeLoading && concepts.length === 0"
    :actions="actions"
    @close="$emit('close')"
    @action="onAction"
  >
    <!-- CURRENT-STATE SEMANTICS (frozen spec requirement): browse reflects
         what is indexed NOW, not the version that was cited. -->
    <p v-if="!unavailable" class="okf-browser__notice" data-testid="okf-browser-current-notice">
      {{
        translate(
          'chatbot.okfBrowser.currentNotice',
          'Showing what is indexed now — not necessarily the version that was cited.'
        )
      }}
    </p>

    <div v-if="unavailable" class="okf-browser__unavailable" data-testid="okf-browser-unavailable">
      {{ translate('chatbot.okfBrowser.unavailable', 'This repository cannot be browsed right now.') }}
    </div>

    <template v-else>
      <div class="okf-browser__toolbar">
        <DsInput
          v-model="filter"
          class="okf-browser__filter"
          type="text"
          :placeholder="translate('chatbot.okfBrowser.filter', 'Filter concepts…')"
          :aria-label="translate('chatbot.okfBrowser.filter', 'Filter concepts…')"
          data-testid="okf-browser-filter"
        />
        <span class="okf-browser__count" data-testid="okf-browser-count">{{ countLabel }}</span>
      </div>
      <p v-if="progress" class="okf-browser__progress" data-testid="okf-browser-progress">
        {{
          translate('chatbot.okfBrowser.loading', 'Loading {done} of {total}…')
            .replace('{done}', String(progress.done))
            .replace('{total}', String(progress.total))
        }}
      </p>
      <p v-if="error" class="okf-browser__error" data-testid="okf-browser-error">{{ error }}</p>

      <div class="okf-browser__panes" :class="{ 'okf-browser__panes--list-only': !selectedConceptId }">
        <div class="okf-browser__list">
          <DsTable
            :columns="columns"
            :rows="visibleRows"
            row-key="concept_id"
            :loading="treeLoading && concepts.length === 0"
            :empty-text="translate('chatbot.okfBrowser.empty', 'No concepts found.')"
            data-testid="okf-browser-table"
            @row-click="selectConcept"
          >
            <template #cell-title="{ row }">
              <span class="okf-browser__row-title">{{ row.title || row.concept_id }}</span>
            </template>
          </DsTable>
          <DsButton
            v-if="visibleRows.length < filteredRows.length"
            variant="secondary"
            class="okf-browser__show-more"
            data-testid="okf-browser-show-more"
            @click="extendWindow"
          >
            {{ translate('chatbot.okfBrowser.showMore', 'Show more') }}
          </DsButton>
        </div>
        <div v-if="selectedConceptId" class="okf-browser__detail" data-testid="okf-browser-detail">
          <div class="okf-browser__detail-head">
            <DsButton variant="ghost" class="okf-browser__back" data-testid="okf-browser-back" @click="backToList">
              {{ translate('chatbot.okfBrowser.backToList', 'Back to list') }}
            </DsButton>
            <h3 class="okf-browser__detail-title" data-testid="okf-browser-detail-title">{{ selectedTitle }}</h3>
          </div>
          <div v-if="selectedLoading" class="okf-browser__detail-loading" data-testid="okf-browser-detail-loading">
            <DsSpinner size="md" />
          </div>
          <div
            v-else-if="selectedUnavailable"
            class="okf-browser__detail-unavailable"
            data-testid="okf-browser-concept-unavailable"
          >
            {{ translate('chatbot.okfBrowser.conceptUnavailable', 'This concept is not available.') }}
          </div>
          <!-- Rendered from the CAP-2 body through MarkdownIt + DOMPurify
               (the OkfMarkdownEditor recipe) — sanitized below before it
               lands here. -->
          <!-- eslint-disable-next-line vue/no-v-html -->
          <div v-else class="okf-browser__markdown" data-testid="okf-browser-markdown" v-html="renderedHtml"></div>
          <div v-if="relatedConcepts.length" class="okf-browser__related">
            <h4 class="okf-browser__related-title">
              {{ translate('chatbot.okfBrowser.relatedConcepts', 'Related concepts') }}
            </h4>
            <div class="okf-browser__related-chips">
              <button
                v-for="r in relatedConcepts"
                :key="r.concept_id"
                type="button"
                class="okf-browser__chip"
                :data-testid="`okf-browser-hop-${r.concept_id}`"
                @click="selectConcept(r)"
              >
                {{ r.title || r.concept_id }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </template>
  </DsDialog>
</template>

<script>
import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';
import translateMixin from '../../mixins/translateMixin';
import DsDialog from '../ds/Dialog.vue';
import DsTable from '../ds/Table.vue';
import DsButton from '../ds/Button.vue';
import DsInput from '../ds/Input.vue';
import DsSpinner from '../ds/Spinner.vue';
import { downloadOkfConcept } from '../../utils/document-opener';
import notificationService from '../../services/notificationService';

// The render window: only this many filtered rows hit the DOM at once —
// the 6k-concept index lives in memory, not in elements (D8 §7).
const WINDOW_STEP = 100;

export default {
  name: 'ConceptBrowserDialog',
  components: { DsDialog, DsTable, DsButton, DsInput, DsSpinner },
  mixins: [translateMixin],
  props: {
    visible: { type: Boolean, default: false }
  },
  emits: ['close'],
  data() {
    return {
      filter: '',
      windowSize: WINDOW_STEP,
      columns: [{ key: 'title', label: this.translate('chatbot.okfBrowser.colConcept', 'Concept') }]
    };
  },
  computed: {
    browser() {
      // Defensive: a host store without the okf module (tests, a future
      // surface) must not crash the dialog — every read below degrades to
      // its empty arm.
      const fromGetter = this.$store.getters['okf/browser'];
      if (fromGetter) return fromGetter;
      const okf = this.$store.state && this.$store.state.okf;
      return (okf && okf.browser) || {};
    },
    concepts() {
      return this.browser.concepts || [];
    },
    treeLoading() {
      return !!this.browser.loading;
    },
    progress() {
      return this.browser.progress || null;
    },
    unavailable() {
      return !!this.browser.unavailable;
    },
    error() {
      return this.browser.error || null;
    },
    selectedConceptId() {
      return this.browser.selectedConceptId || null;
    },
    selectedConcept() {
      return this.browser.selectedConcept || null;
    },
    selectedLoading() {
      return !!this.browser.selectedLoading;
    },
    selectedUnavailable() {
      return !!this.browser.selectedUnavailable;
    },
    actions() {
      return [
        {
          key: 'download',
          label: this.translate('chatbot.okfBrowser.download', 'Download'),
          variant: 'secondary',
          disabled: !this.selectedConcept
        },
        { key: 'close', label: this.translate('common.close', 'Close'), variant: 'primary' }
      ];
    },
    filteredRows() {
      const q = this.filter.trim().toLowerCase();
      if (!q) return this.concepts;
      return this.concepts.filter(
        (c) =>
          (c.title && String(c.title).toLowerCase().includes(q)) ||
          (c.concept_id && String(c.concept_id).toLowerCase().includes(q))
      );
    },
    visibleRows() {
      return this.filteredRows.slice(0, this.windowSize);
    },
    selectedTitle() {
      const c = this.selectedConcept;
      const fmTitle = c && c.frontmatter && c.frontmatter.title;
      return (
        (typeof fmTitle === 'string' && fmTitle.trim()) ||
        (c && c.title) ||
        String(this.selectedConceptId || '').replace(/_/g, ' ')
      );
    },
    /** The selected concept's outgoing links (the CAP-2 card carries the
     * stored meta links[]) normalized to hops — the parser-derived structure
     * reached per-concept, never from the index. */
    relatedConcepts() {
      const c = this.selectedConcept;
      const rows = [];
      const seen = new Set();
      for (const l of Array.isArray(c && c.links) ? c.links : []) {
        if (!l) continue;
        const raw = l.to_concept_id || l.target || '';
        const id = String(raw)
          .replace(/\.md$/i, '')
          .replace(/^concepts\//, '')
          .trim();
        if (!id || id === this.selectedConceptId || seen.has(id)) continue;
        seen.add(id);
        rows.push({ concept_id: id, title: (l.label && String(l.label)) || null });
      }
      return rows;
    },
    renderedHtml() {
      const body =
        this.selectedConcept && typeof this.selectedConcept.body === 'string' ? this.selectedConcept.body : '';
      if (!body) return '';
      // The OkfMarkdownEditor pipeline: MarkdownIt render + DOMPurify
      // sanitize (html profile). One-shot on selection — no per-keystroke
      // cadence, so the editor's chunked renderer is not needed here.
      return DOMPurify.sanitize(this.md.render(body), { USE_PROFILES: { html: true } });
    },
    countLabel() {
      // While a filter is active the count names the FILTERED rows (review
      // r0) — an unfiltered total above a zero-match table reads as a
      // contradiction.
      const filtering = this.filter.trim().length > 0;
      const n = filtering ? this.filteredRows.length : this.concepts.length;
      return this.translate('chatbot.okfBrowser.concepts', '{n} concepts').replace('{n}', String(n));
    }
  },
  watch: {
    // A fresh open resets the filter and the render window.
    visible(open) {
      if (open) {
        this.filter = '';
        this.windowSize = WINDOW_STEP;
      }
    }
  },
  created() {
    // Same recipe as DsOkfMarkdownEditor's instance (html + linkify; the
    // sanitizer is what makes html safe).
    this.md = new MarkdownIt({ html: true, linkify: true, typographer: false });
  },
  methods: {
    onAction(key) {
      if (key === 'close') {
        this.$emit('close');
        return;
      }
      if (key === 'download' && this.selectedConceptId && this.browser.repoId) {
        downloadOkfConcept(this.browser.repoId, this.selectedConceptId).catch((err) => {
          if (err && err.code === 'OKF_CONCEPT_UNAVAILABLE') {
            notificationService.info(
              this.translate('chatbot.okfBrowser.conceptUnavailable', 'This concept is not available.')
            );
          } else {
            notificationService.error(this.translate('chatbot.okfBrowser.downloadFailed', 'Download failed.'));
          }
        });
      }
    },
    extendWindow() {
      this.windowSize += WINDOW_STEP;
    },
    selectConcept(row) {
      if (!row || !row.concept_id || !this.browser.repoId) return;
      this.$store.dispatch('okf/browserLoadConcept', { repoId: this.browser.repoId, conceptId: row.concept_id });
    },
    backToList() {
      // Mobile: leave the detail pane (the list is the home pane when the
      // panes stack). The selection clears; nothing is refetched.
      this.$store.commit('okf/setBrowserSelected', { conceptId: null, concept: null });
    }
  }
};
</script>

<style scoped>
.okf-browser__notice {
  margin: 0 0 var(--space-sm);
  font-size: var(--text-xs);
  color: var(--muted);
}
.okf-browser__unavailable {
  margin: var(--space-sm) 0;
  color: var(--fg);
  font-size: var(--text-sm);
}
.okf-browser__toolbar {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  margin-bottom: var(--space-sm);
}
.okf-browser__filter {
  flex: 1 1 auto;
}
.okf-browser__count {
  color: var(--muted);
  font-size: var(--text-sm);
  white-space: nowrap;
}
.okf-browser__progress {
  margin: 0 0 var(--space-sm);
  font-size: var(--text-xs);
  color: var(--muted);
}
.okf-browser__error {
  margin: 0 0 var(--space-sm);
  font-size: var(--text-sm);
  color: var(--danger);
}
.okf-browser__show-more {
  margin-top: var(--space-sm);
}
.okf-browser__panes {
  display: grid;
  grid-template-columns: minmax(240px, 1fr) minmax(0, 1.4fr);
  gap: var(--space-md);
  align-items: start;
}
/* When no concept is open the list owns the full width. */
.okf-browser__panes--list-only {
  grid-template-columns: 1fr;
}
.okf-browser__detail {
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: var(--space-md);
  background: var(--surface);
}
.okf-browser__detail-head {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  margin-bottom: var(--space-sm);
}
.okf-browser__detail-title {
  margin: 0;
  font-size: var(--text-md);
  font-weight: 600;
  color: var(--fg);
}
.okf-browser__back {
  display: none; /* desktop: both panes visible, no back needed */
}
.okf-browser__detail-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-lg) 0;
}
.okf-browser__detail-unavailable {
  color: var(--fg);
  font-size: var(--text-sm);
  padding: var(--space-sm) 0;
}
.okf-browser__markdown {
  font-size: var(--text-sm);
  line-height: 1.55;
  color: var(--fg);
  overflow-wrap: anywhere;
}
.okf-browser__related {
  margin-top: var(--space-md);
  border-top: 1px solid var(--border);
  padding-top: var(--space-sm);
}
.okf-browser__related-title {
  margin: 0 0 var(--space-xs);
  font-size: var(--text-xs);
  font-weight: 600;
  color: var(--muted);
}
.okf-browser__related-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs);
}
.okf-browser__chip {
  font-family: inherit;
  font-size: var(--text-xs);
  padding: 3px 10px;
  border-radius: 100px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--fg);
  cursor: pointer;
}
.okf-browser__chip:hover {
  background: var(--accent-muted);
}

/* Narrow viewports: the panes stack; the detail covers the list and the
   back affordance appears (D8 §2). */
@media (max-width: 720px) {
  .okf-browser__panes {
    grid-template-columns: 1fr;
  }
  .okf-browser__back {
    display: inline-flex;
  }
}
</style>
