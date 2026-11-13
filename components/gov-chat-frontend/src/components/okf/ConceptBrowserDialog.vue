<!-- ConceptBrowserDialog.vue — W9 (concept tree browse, chat-source
  resolution, 2026-11-08); REDESIGNED per David's order 2026-11-14 (issue
  #1836): the left pane is the SAME tree view the OKF editor and the wizard
  use (the shared OkfConceptList — index root + children, read-only), the
  browser gained back/forward history over visited concepts, and the
  content pane NEVER unmounts while the tree is clicked or scrolled (the
  old v-if vanish is the defect this fixes). The okf store's browser slice
  assembles the paginated tree index progressively (≤ 200 rows per payload,
  never the full corpus in one response); every concept's markdown is
  fetched on demand through the CAP-2 concept route (fetchOkfConcept's
  honest unavailable mapping) and rendered client-side with the MarkdownIt
  + DOMPurify pipeline. Read-only: browse + hops + download, no steward
  tooling.
  IA history: the D8 pass chose a progressive ALPHABETICAL LIST; REVERSED
  by David 2026-11-14 (recorded in the W9 spec's change log + issue #1836).
  Two panes on desktop, stacked with Back-to-list on narrow viewports. -->
<template>
  <DsDialog
    class="genie-living-intelligence"
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
      <p v-if="error" class="okf-browser__error" data-testid="okf-browser-error">{{ error }}</p>

      <div class="okf-browser__panes">
        <!-- THE TREE — the editor's and wizard's own OkfConceptList,
             read-only (no steward verbs; the footer's disabled buttons and
             the ingest failcard are hidden consumer-side, no shared-file
             change). Row click = a FORWARD navigation: the visit joins the
             history. -->
        <div class="okf-browser__list" data-testid="okf-browser-tree">
          <OkfConceptList
            :concepts="concepts"
            :selected-id="selectedConceptId"
            :loading="treeLoading && concepts.length === 0"
            read-only
            @select="visitConcept"
          />
          <!-- David, 2026-11-08: lazy loading — the dialog never waits for
               the whole repository. Each Show more fetches the NEXT page
               (browserExtendConceptTree); it disappears once the tree is
               complete. The tree renders every loaded row (the editor's own
               behaviour); pages accumulate only as the citizen asks. -->
          <DsButton
            v-if="showMoreVisible"
            variant="secondary"
            class="okf-browser__show-more"
            data-testid="okf-browser-show-more"
            @click="extend"
          >
            {{ translate('chatbot.okfBrowser.showMore', 'Show more') }}
          </DsButton>
        </div>

        <!-- THE CONTENT PANE — always rendered (issue #1836: the markdown
             stays in view while the tree is clicked and scrolled). Its four
             arms live INSIDE the pane; nothing here unmounts the pane or
             reflows the tree. -->
        <div ref="detailPane" class="okf-browser__detail" data-testid="okf-browser-detail">
          <div class="okf-browser__detail-head">
            <DsButton
              variant="ghost"
              class="okf-browser__back-to-list"
              data-testid="okf-browser-back-to-list"
              @click="backToList"
            >
              {{ translate('chatbot.okfBrowser.backToList', 'Back to list') }}
            </DsButton>
            <div class="okf-browser__history" role="navigation">
              <DsButton
                variant="ghost"
                small
                class="okf-browser__history-btn"
                :disabled="!canGoBack"
                data-testid="okf-browser-back"
                :aria-label="translate('chatbot.okfBrowser.back', 'Back')"
                @click="goBack"
              >
                ◀
              </DsButton>
              <DsButton
                variant="ghost"
                small
                class="okf-browser__history-btn"
                :disabled="!canGoForward"
                data-testid="okf-browser-forward"
                :aria-label="translate('chatbot.okfBrowser.forward', 'Forward')"
                @click="goForward"
              >
                ▶
              </DsButton>
            </div>
            <h3 class="okf-browser__detail-title" data-testid="okf-browser-detail-title">{{ selectedTitle }}</h3>
          </div>
          <!-- Empty arm: nothing selected yet — the tree is the invitation. -->
          <div v-if="!selectedConceptId" class="okf-browser__empty" data-testid="okf-browser-select-hint">
            {{ translate('chatbot.okfBrowser.selectHint', 'Select a concept from the tree to read it here.') }}
          </div>
          <div v-else-if="selectedLoading" class="okf-browser__detail-loading" data-testid="okf-browser-detail-loading">
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
          <div
            v-else
            ref="markdownEl"
            class="okf-browser__markdown"
            data-testid="okf-browser-markdown"
            v-html="renderedHtml"
          ></div>
          <div v-if="selectedConceptId && relatedConcepts.length" class="okf-browser__related">
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
                @click="visitConcept(r)"
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
import DsButton from '../ds/Button.vue';
import DsSpinner from '../ds/Spinner.vue';
import OkfConceptList from './editor/ConceptList.vue';
import { downloadOkfConcept } from '../../utils/document-opener';
import notificationService from '../../services/notificationService';

export default {
  name: 'ConceptBrowserDialog',
  components: { DsDialog, DsButton, DsSpinner, OkfConceptList },
  mixins: [translateMixin],
  props: {
    visible: { type: Boolean, default: false }
  },
  emits: ['close'],
  data() {
    return {
      // Per-concept scroll memory (#1836): leaving a concept stores the
      // markdown pane's scrollTop; returning to it (back/forward) restores
      // where the reader was. DOM state stays in the component — the store
      // never learns the pane's geometry.
      scrollMemory: {}
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
    /** Lazy loading (David, 2026-11-08): the loaded edge vs the true total. */
    treeComplete() {
      return !!this.browser.treeComplete;
    },
    morePages() {
      return !this.treeComplete && this.concepts.length < (this.browser.total || 0);
    },
    showMoreVisible() {
      return this.morePages;
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
    // #1836 history affordances: enabled strictly inside the visited range.
    canGoBack() {
      const i = this.browser.historyIndex;
      return typeof i === 'number' && i > 0;
    },
    canGoForward() {
      const h = this.browser.history || [];
      const i = this.browser.historyIndex;
      return typeof i === 'number' && i >= 0 && i < h.length - 1;
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
    }
  },
  watch: {
    // Leaving a concept: remember where the reader was in it (#1836).
    selectedConceptId(next, prev) {
      if (prev && this.$refs.markdownEl) {
        this.scrollMemory[prev] = this.$refs.markdownEl.scrollTop;
      }
      if (!next) return;
      // Returning to a concept whose content is already shown restores the
      // remembered scroll after the DOM settles; a fresh concept starts at
      // the top.
      this.$nextTick(() => {
        const el = this.$refs.markdownEl;
        if (!el) return;
        const saved = this.scrollMemory[next];
        el.scrollTop = typeof saved === 'number' && this.selectedConceptId === next ? saved : 0;
      });
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
    /** The on-demand affordance: fetch the NEXT page (David, 2026-11-08 —
     * the dialog never waits for the whole repository; the rest loads as
     * the citizen asks for it). The tree renders every loaded row. */
    async extend() {
      if (!this.morePages || !this.browser.repoId) return;
      await this.$store.dispatch('okf/browserExtendConceptTree', { repoId: this.browser.repoId });
    },
    /** FORWARD navigation (tree rows + related hops): the visit joins the
     * history, truncating any forward tail (the store owns that semantic),
     * and the content loads through the guarded hop loader. OkfConceptList
     * emits the bare concept_id string; the hop chips pass a row object. */
    visitConcept(rowOrId) {
      const id = typeof rowOrId === 'string' ? rowOrId : rowOrId && rowOrId.concept_id;
      if (!id || !this.browser.repoId) return;
      this.$store.dispatch('okf/browserVisitConcept', { repoId: this.browser.repoId, conceptId: id });
    },
    goBack() {
      if (!this.browser.repoId) return;
      this.$store.dispatch('okf/browserBack');
    },
    goForward() {
      if (!this.browser.repoId) return;
      this.$store.dispatch('okf/browserForward');
    },
    backToList() {
      // Mobile: leave the detail pane (the list is the home pane when the
      // panes stack). The selection clears; the HISTORY SURVIVES — a fresh
      // click continues the same session (issue #1836).
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
  grid-template-columns: minmax(260px, 1fr) minmax(0, 1.4fr);
  gap: var(--space-md);
  align-items: stretch;
}
.okf-browser__list {
  /* The tree pane scrolls on its own — the content pane stays put while
     the citizen walks the tree (issue #1836). */
  min-height: 0;
  max-height: 60vh;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: var(--space-sm);
  background: var(--surface);
}
/* The steward chrome OkfConceptList carries for the editor is noise in the
   citizen browser: the footer's disabled Add/Re-split buttons and the
   ingest failcard hide consumer-side — the shared component is unchanged
   (additive-first, no shared-file edit). */
.okf-browser__list :deep(.okf-cl__footer) {
  display: none;
}
.okf-browser__list :deep(.okf-cl__failcard) {
  display: none;
}
.okf-browser__detail {
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: var(--space-md);
  background: var(--surface);
  min-height: 0;
  max-height: 60vh;
  overflow-y: auto;
}
.okf-browser__detail-head {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  margin-bottom: var(--space-sm);
}
.okf-browser__history {
  display: flex;
  gap: var(--space-xs);
}
.okf-browser__detail-title {
  margin: 0;
  font-size: var(--text-md);
  font-weight: 600;
  color: var(--fg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.okf-browser__back-to-list {
  display: none; /* desktop: both panes visible, no back needed */
}
.okf-browser__empty {
  color: var(--muted);
  font-size: var(--text-sm);
  padding: var(--space-lg) 0;
  text-align: center;
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
  .okf-browser__back-to-list {
    display: inline-flex;
  }
}
</style>
