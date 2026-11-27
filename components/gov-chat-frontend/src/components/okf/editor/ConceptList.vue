<!--
  OkfConceptList.vue - Story #978 Studio editor TREE sidebar.

  Tree = index.md (bundle root) + its concept files. Per-file quick actions:
  label chip -> inline Knowledge-Hierarchy select (writes immediately);
  X -> delete (parent confirms). Footer: [+ Add concept] + [Re-split].
-->
<template>
  <div class="okf-cl" role="region" :aria-label="translate('okf.editor.concepts.label', 'Concepts')">
    <header class="okf-cl__header">
      <span class="okf-cl__title">{{ translate('okf.editor.concepts.label', 'Files') }}</span>
      <span class="okf-cl__count">{{ filtered.length }}</span>
      <!-- PII REVIEW: the repo's outstanding flag count, next to the file
           count — the approver sees the correction progress at a glance. -->
      <DsPill v-if="flaggedCount > 0" variant="warning" :title="flaggedTip">
        {{ flaggedCount }} {{ translate('okf.editor.concepts.flagged', 'flagged') }}
      </DsPill>
      <!-- REPO BULK PII (David, 2026-09-12): Redact / Remove / Accept applied
           to EVERY flagged concept in one steward decision. The parent
           confirms (destructive for redact/remove) and refreshes the rows. -->
      <span v-if="flaggedCount > 0 && !readOnly" class="okf-cl__bulk">
        <button
          type="button"
          class="okf-cl__bulk-btn"
          :title="translate('okf.editor.piiBulk.title.redact', 'Redact all flagged content')"
          @click="$emit('pii-bulk', 'redact')"
        >
          {{ translate('okf.editor.concepts.bulkRedact', 'Redact all') }}
        </button>
        <button
          type="button"
          class="okf-cl__bulk-btn"
          :title="translate('okf.editor.piiBulk.title.remove', 'Remove all flagged content')"
          @click="$emit('pii-bulk', 'remove')"
        >
          {{ translate('okf.editor.concepts.bulkRemove', 'Remove all') }}
        </button>
        <button
          type="button"
          class="okf-cl__bulk-btn"
          :title="translate('okf.editor.piiBulk.title.accept', 'Accept all flagged entities')"
          @click="$emit('pii-bulk', 'accept')"
        >
          {{ translate('okf.editor.concepts.bulkAccept', 'Accept all') }}
        </button>
      </span>
    </header>

    <DsInput
      v-model="filter"
      class="okf-cl__filter"
      :placeholder="translate('okf.editor.concepts.filter', 'Filter files')"
      size="sm"
    />

    <!-- NON-BLOCKING LOAD (David, 2026-09-12): a large repository loads in
         pages — this bar reports REAL server counts while rows stream in. -->
    <div v-if="loadProgress" class="okf-cl__load" role="status">
      <DsProgress :value="loadProgress.done" :max="loadProgress.total || loadProgress.done" size="xs" />
      <span class="okf-cl__load-label">{{ loadLabel }}</span>
    </div>

    <p v-if="loading && !loadProgress" class="okf-cl__empty">
      <DsSpinner size="sm" /> {{ translate('okf.editor.concepts.loading', 'Loading…') }}
    </p>
    <p v-else-if="filtered.length === 0" class="okf-cl__empty">
      {{ translate('okf.editor.concepts.empty', 'No files yet - add a concept or re-split from source.') }}
    </p>

    <template v-else>
      <ul ref="listEl" class="okf-cl__list" data-test-id="okf-cl-list" @scroll.passive="onListScroll">
        <li v-for="node in visibleTree" :key="node.key">
          <div
            class="okf-cl__row"
            :class="{ 'okf-cl__row--selected': node.concept_id === selectedId }"
            :data-test-id="`okf-concept-row-${node.concept_id}`"
            role="button"
            tabindex="0"
            @click="$emit('select', node.concept_id)"
            @keydown.enter="$emit('select', node.concept_id)"
            @mouseenter="showFailCard(node, $event)"
            @mouseleave="hideFailCard"
            @focus="showFailCard(node, $event)"
            @blur="hideFailCard"
          >
            <span class="okf-cl__twist" :class="{ 'okf-cl__twist--open': expanded }" @click.stop="expanded = !expanded"
              >▸</span
            >
            <span
              class="okf-cl__status"
              :class="'okf-cl__status--' + (node.index_status || 'parsed')"
              :title="node.index_status"
            ></span>
            <span class="okf-cl__body">
              <span class="okf-cl__row-title">
                {{ node.title || node.concept_id }}
                <DsPill v-if="node.is_index" variant="accent">{{
                  translate('okf.editor.concepts.indexBadge', 'index')
                }}</DsPill>
                <!-- D-G (David, 2026-09-07): the per-concept curation origin
                     (heuristics | llm | authorial) — rendered only when the
                     meta row carries a curation payload (old rows: nothing). -->
                <span v-if="originLabel(node)" class="okf-cl__origin" :title="originTitle">{{
                  originLabel(node)
                }}</span>
                <!-- PII REVIEW (David, 2026-09-09): same badge as child rows. -->
                <DsPill v-if="node.pii_state === 'hit'" variant="warning" :title="piiTip(node)">{{
                  translate('okf.editor.concepts.piiBadge', 'PII')
                }}</DsPill>
              </span>
              <span
                v-if="node.sourceUrl"
                class="okf-cl__row-source"
                role="link"
                tabindex="-1"
                :title="translate('okf.editor.concepts.sourceView', 'Open the source document')"
                @click.stop="openSource(node)"
                >{{ node.sourceUrl }}</span
              >
            </span>
            <span v-if="!readOnly" class="okf-cl__actions" @click.stop>
              <!-- RE-INGEST (David, 2026-10-14): per-concept retry, offered ONLY
                on a row that actually failed. The hover failcard is
                pointer-events:none so it cannot host a button — the actions span
                is the clickable home. -->
              <button
                v-if="node.index_status === 'failed'"
                type="button"
                class="okf-cl__action okf-cl__action--reingest"
                :title="translate('okf.editor.concepts.reingest', 'Re-ingest this concept')"
                @click.stop="$emit('reingest', node)"
              >
                ↻
              </button>
              <!-- #1577 story 2: the SPLIT affordance — the CONCEPT_TOO_LARGE
                   refusal's advice ("split it into smaller concepts") finally
                   has a button behind it. Opens the seam-preview dialog; the
                   readOnly span above already gates it like delete. Hidden
                   entirely on hosts with no split dialog (the wizard's
                   workbench mounts this list without one). -->
              <button
                v-if="showSplit"
                type="button"
                class="okf-cl__action okf-cl__action--split"
                data-test-id="okf-concept-split"
                :title="translate('okf.editor.concepts.split', 'Split this concept')"
                @click.stop="$emit('split', node.concept_id)"
              >
                ÷
              </button>
              <button
                type="button"
                class="okf-cl__action okf-cl__action--label"
                :title="translate('okf.editor.concepts.addLabel', 'Set label')"
                @click.stop="toggleLabelEdit(node.concept_id)"
              >
                <DsPill v-if="firstLabel(node)" variant="info">{{ firstLabel(node) }}</DsPill>
                <span v-else class="okf-cl__action-glyph">+</span>
              </button>
              <button
                type="button"
                class="okf-cl__action okf-cl__action--danger"
                :title="translate('okf.editor.concepts.delete', 'Delete file')"
                @click.stop="$emit('delete', node)"
              >
                ✕
              </button>
            </span>
          </div>
          <div v-if="labelEditing === node.concept_id" class="okf-cl__label-edit" @click.stop>
            <DsSelect :value="firstLabel(node) || ''" size="sm" @update:model-value="onLabelPicked(node, $event)">
              <option value="">{{ translate('okf.editor.meta.noLabel', 'No label') }}</option>
              <option v-for="opt in labelOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
            </DsSelect>
          </div>
          <ul
            v-if="expanded && node.children && node.children.length"
            class="okf-cl__children"
            @scroll.passive="hideFailCard"
          >
            <!-- #2189: the children mounted here are the windowed slice —
                 visibleTree pre-slices them for the index parent. -->
            <li v-for="child in node.children" :key="child.concept_id">
              <div
                class="okf-cl__row okf-cl__row--child"
                :class="{ 'okf-cl__row--selected': child.concept_id === selectedId }"
                :data-test-id="`okf-concept-row-${child.concept_id}`"
                role="button"
                tabindex="0"
                @click="$emit('select', child.concept_id)"
                @keydown.enter="$emit('select', child.concept_id)"
                @mouseenter="showFailCard(child, $event)"
                @mouseleave="hideFailCard"
                @focus="showFailCard(child, $event)"
                @blur="hideFailCard"
              >
                <span
                  class="okf-cl__status"
                  :class="'okf-cl__status--' + (child.index_status || 'parsed')"
                  :title="child.index_status"
                ></span>
                <span class="okf-cl__body">
                  <span class="okf-cl__row-title">
                    {{ child.title || child.concept_id }}
                    <!-- PII REVIEW (David, 2026-09-09): flagged concepts are
                         badged IN the editor file list — open, redact the
                         entity, save (auto re-scan clears the flag), and the
                         badge flips on refresh. Tooltip names the types. -->
                    <DsPill v-if="child.pii_state === 'hit'" variant="warning" :title="piiTip(child)">{{
                      translate('okf.editor.concepts.piiBadge', 'PII')
                    }}</DsPill>
                  </span>
                  <span
                    v-if="child.sourceUrl"
                    class="okf-cl__row-source"
                    role="link"
                    tabindex="-1"
                    :title="translate('okf.editor.concepts.sourceView', 'Open the source document')"
                    @click.stop="openSource(child)"
                    >{{ child.sourceUrl }}</span
                  >
                </span>
                <span v-if="!readOnly" class="okf-cl__actions" @click.stop>
                  <!-- Per-concept re-ingest — failed rows only (David, 2026-10-14). -->
                  <button
                    v-if="child.index_status === 'failed'"
                    type="button"
                    class="okf-cl__action okf-cl__action--reingest"
                    :title="translate('okf.editor.concepts.reingest', 'Re-ingest this concept')"
                    @click.stop="$emit('reingest', child)"
                  >
                    ↻
                  </button>
                  <!-- #1577 story 2: the split affordance, same as the root rows. -->
                  <button
                    v-if="showSplit"
                    type="button"
                    class="okf-cl__action okf-cl__action--split"
                    data-test-id="okf-concept-split"
                    :title="translate('okf.editor.concepts.split', 'Split this concept')"
                    @click.stop="$emit('split', child.concept_id)"
                  >
                    ÷
                  </button>
                  <button
                    type="button"
                    class="okf-cl__action okf-cl__action--label"
                    :title="translate('okf.editor.concepts.addLabel', 'Set label')"
                    @click.stop="toggleLabelEdit(child.concept_id)"
                  >
                    <DsPill v-if="firstLabel(child)" variant="info">{{ firstLabel(child) }}</DsPill>
                    <span v-else class="okf-cl__action-glyph">+</span>
                  </button>
                  <button
                    type="button"
                    class="okf-cl__action okf-cl__action--danger"
                    :title="translate('okf.editor.concepts.delete', 'Delete file')"
                    @click.stop="$emit('delete', child)"
                  >
                    ✕
                  </button>
                </span>
              </div>
              <div v-if="labelEditing === child.concept_id" class="okf-cl__label-edit" @click.stop>
                <DsSelect :value="firstLabel(child) || ''" size="sm" @update:model-value="onLabelPicked(child, $event)">
                  <option value="">{{ translate('okf.editor.meta.noLabel', 'No label') }}</option>
                  <option v-for="opt in labelOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
                </DsSelect>
              </div>
            </li>
          </ul>
        </li>
        <!-- #2189 — the unrendered remainder as spacer height, so the
             scrollbar reflects the whole collection while only O(viewport)
             rows exist in the DOM. -->
        <li
          v-if="truncated"
          ref="tailEl"
          class="okf-cl__tail"
          data-test-id="okf-cl-tail"
          aria-hidden="true"
          :style="{ height: tailHeight + 'px' }"
        ></li>
      </ul>
    </template>

    <footer class="okf-cl__footer">
      <span class="okf-cl__footer-tip">
        <DsInfoTip
          :text="
            translate(
              'okf.glossary.addConcept',
              'Write a new topic by hand (markdown with frontmatter). Each topic becomes one citable unit — focused topics retrieve more precisely than one long document.'
            )
          "
        />
      </span>
      <DsButton variant="secondary" small :disabled="readOnly" @click="$emit('add')"
        >+ {{ translate('okf.editor.concepts.add', 'Add concept') }}</DsButton
      >
      <!-- 3.10 T-editor (D6 editor parity): add MORE sources from the
           document repository (tagged crawl files, uploads — any format)
           into THIS repo at any time. The parent opens the source picker
           and runs the conversions; the tree refreshes on completion. -->
      <DsButton v-if="showAddSource" variant="secondary" small :disabled="readOnly" @click="$emit('add-source')"
        >+ {{ translate('okf.editor.concepts.addSource', 'From documents') }}</DsButton
      >
      <span class="okf-cl__footer-tip">
        <DsInfoTip
          :text="
            translate(
              'okf.glossary.resplit',
              'Re-divide a long source document into topics of the right size. Topics that are too big dilute retrieval precision (the answer hides among filler); topics that are too small lose the context an answer needs.'
            )
          "
        />
      </span>
      <DsButton variant="ghost" small :disabled="readOnly" @click="$emit('resplit')">{{
        translate('okf.editor.concepts.resplit', 'Re-split')
      }}</DsButton>
    </footer>

    <!-- INGEST-FAILURE CARD (David, 2026-09-14): hovering a RED (failed) row
         floats the EXACT error plus the recovery for THIS failure kind — the
         steward sees what went wrong and how to fix it without leaving the
         tree. Read-only overlay (pointer-events: none), fixed-position and
         clamped to the viewport, hidden on leave/scroll/blur. -->
    <div
      v-if="failCard.visible"
      class="okf-cl__failcard"
      :class="{ 'okf-cl__failcard--above': failCard.above }"
      role="tooltip"
      :style="{ left: failCard.x + 'px', top: failCard.y + 'px' }"
    >
      <p class="okf-cl__failcard-head">
        <span class="okf-cl__failcard-title">{{ failCard.row.title || failCard.row.concept_id }}</span>
        <DsPill variant="danger">{{ translate('okf.editor.concepts.failedCard.title', 'Failed to ingest') }}</DsPill>
      </p>
      <p class="okf-cl__failcard-sec">{{ translate('okf.editor.concepts.failedCard.problem', 'The problem') }}</p>
      <p class="okf-cl__failcard-err">
        {{
          failCard.row.last_error ||
          failCard.row.last_worker_error ||
          translate('okf.editor.concepts.failedCard.noError', 'Marked failed without a recorded reason.')
        }}
      </p>
      <p class="okf-cl__failcard-sec">{{ translate('okf.editor.concepts.failedCard.fixLabel', 'How to fix') }}</p>
      <p class="okf-cl__failcard-fix">{{ fixFor(failCard.row) }}</p>
      <template v-if="sourceFiles(failCard.row).length">
        <p class="okf-cl__failcard-sec">{{ translate('okf.editor.concepts.sourceLabel', 'Source document') }}</p>
        <p v-for="s in sourceFiles(failCard.row)" :key="s.file_id" class="okf-cl__failcard-src">
          <span
            role="link"
            tabindex="-1"
            :title="translate('okf.editor.concepts.sourceView', 'Open the source document')"
            @click.stop="openSource(s)"
            >{{ s.file_name || s.file_id }} ↗</span
          >
        </p>
      </template>
      <p v-if="failCard.row.ingest_attempts > 1 || failCard.row.updated_at" class="okf-cl__failcard-meta">
        <template v-if="failCard.row.ingest_attempts > 1">{{
          translate('okf.editor.concepts.failedCard.attempts', 'Attempts: {n}').replace(
            '{n}',
            String(failCard.row.ingest_attempts)
          )
        }}</template>
        <template v-if="failCard.row.ingest_attempts > 1 && failCard.row.updated_at">&#32;·&#32;</template>
        <template v-if="failCard.row.updated_at">{{ shortWhen(failCard.row.updated_at) }}</template>
      </p>
    </div>
  </div>
</template>

<script>
import translateMixin from '../../../mixins/translateMixin';
import DsButton from '../../ds/Button.vue';
import DsInfoTip from '../../ds/InfoTip.vue';
import DsInput from '../../ds/Input.vue';
import DsPill from '../../ds/Pill.vue';
import DsProgress from '../../ds/Progress.vue';
import DsSelect from '../../ds/Select.vue';
import DsSpinner from '../../ds/Spinner.vue';

// #2189 — the concept rail renders a WINDOW, not the collection. #2188 made
// the crawl network-fast (1.1 s for 6,352 concepts) but the measured mount
// stayed ~32-80 s: the rail v-for'd every concept, so the wave commits
// (~7 per load) each re-diffused the full 10k-row list. Constants, module
// scope — they are layout policy, not per-instance state.
const RENDER_CHUNK = 120; // rows added per scroll extension
const FULL_RENDER_LIMIT = 300; // at/below this the list renders fully, DOM unchanged
const DEFAULT_ROW_HEIGHT = 36; // px fallback until a real row is measured
const EXTEND_LEAD = 600; // px above the rendered bottom that triggers extension

export default {
  name: 'OkfConceptList',
  components: { DsButton, DsInfoTip, DsInput, DsPill, DsProgress, DsSelect, DsSpinner },
  mixins: [translateMixin],
  props: {
    concepts: { type: Array, default: () => [] },
    selectedId: { type: String, default: null },
    loading: { type: Boolean, default: false },
    labelOptions: { type: Array, default: () => [] },
    // NON-BLOCKING LOAD: { done, total } while a chunked fetch runs, else null.
    loadProgress: { type: Object, default: null },
    // READ ONLY (serving repo): add/delete/re-split/label writes are hidden.
    readOnly: { type: Boolean, default: false },
    // 3.10 T-editor (D6): show the "+ From documents" feeder (editor parity —
    // the wizard's workbench has its own feeder row and omits this).
    showAddSource: { type: Boolean, default: false },
    // #1577 story 2: the split glyph is only live where a split dialog is
    // wired — the editor mounts one, the wizard's workbench does not, so it
    // hides the glyph instead of rendering a button that emits into the void.
    showSplit: { type: Boolean, default: true }
  },
  emits: ['select', 'resplit', 'add', 'delete', 'label', 'pii-bulk', 'open-source', 'add-source', 'reingest', 'split'],
  data() {
    return {
      filter: '',
      expanded: true,
      labelEditing: null,
      // #2189 — how many rows of a truncated collection are mounted. Full
      // collections (≤ FULL_RENDER_LIMIT) ignore it entirely.
      renderedCount: RENDER_CHUNK,
      // #2189 — the spacer and the extension lead are laid out from the
      // MEASURED row height (one row read after mount); this default only
      // covers the jsdom/no-layout case and the first paint.
      rowHeight: DEFAULT_ROW_HEIGHT,
      // INGEST-FAILURE CARD state: the hovered FAILED row + viewport-anchored
      // placement. Fixed position (viewport coords) so the list's scroll
      // container can never clip it; hidden on leave/scroll/blur.
      failCard: {
        visible: false,
        above: false,
        x: 0,
        y: 0,
        row: null
      }
    };
  },
  computed: {
    // PII REVIEW (David, 2026-09-09): outstanding flagged-entity count for
    // the header chip. Guarded — rows without pii fields contribute nothing.
    flaggedCount() {
      return this.concepts.filter((c) => c && c.pii_state === 'hit').length;
    },
    loadLabel() {
      const p = this.loadProgress || { done: 0, total: 0 };
      return this.translate('okf.editor.concepts.loadProgress', 'Loading files {done}/{total}')
        .replace('{done}', String(p.done))
        .replace('{total}', String(p.total));
    },
    flaggedTip() {
      return this.translate(
        'okf.editor.concepts.flaggedTip',
        'Concepts with flagged entities — open each, remove or alter the entity, save (it re-scans automatically); or acknowledge them at publish.'
      );
    },
    filtered() {
      const s = (this.filter || '').toLowerCase().trim();
      if (!s) return this.concepts;
      return this.concepts.filter((c) => {
        const hay = [c.title, c.concept_id, c.path, this.sourceOf(c)].filter(Boolean).join(' ').toLowerCase();
        return hay.includes(s);
      });
    },
    tree() {
      const list = this.filtered;
      const indexRow = list.find((c) => c.is_index);
      const rest = list.filter((c) => c !== indexRow).map((c) => this.decorate(c));
      if (!indexRow) return rest.map((c) => ({ ...c, children: [] }));
      return [{ ...this.decorate(indexRow), children: rest, key: indexRow.concept_id }];
    },
    // #2189 — windowing mode. 'full' renders the tree untouched (the DOM for
    // the common repo is byte-identical to the pre-#2189 component); above
    // the limit, the window slices either the flat list ('top') or the index
    // parent's children ('children') and a tail spacer stands in for the rest.
    virtualList() {
      if (this.tree.length === 1 && this.tree[0].children.length > FULL_RENDER_LIMIT) return 'children';
      if (this.tree.length > FULL_RENDER_LIMIT) return 'top';
      return 'full';
    },
    totalCount() {
      if (this.virtualList === 'children') return this.tree[0].children.length + 1;
      return this.tree.length;
    },
    truncated() {
      return this.virtualList !== 'full' && this.totalCount > this.renderedCount;
    },
    tailHeight() {
      return Math.max(0, this.totalCount - this.renderedCount) * this.rowHeight;
    },
    visibleTree() {
      if (this.virtualList === 'full') return this.tree;
      if (this.virtualList === 'top') return this.tree.slice(0, this.renderedCount);
      const index = this.tree[0];
      return [{ ...index, children: index.children.slice(0, Math.max(0, this.renderedCount - 1)) }];
    }
  },
  watch: {
    // #2189 — a narrowed filter re-windows: its (small) result renders fully
    // from the first chunk, and the stale deep scroll position goes with it
    // (a kept scroll offset would clamp against the shrunken content and
    // cascade the window back open on the browser's own scroll event).
    filter() {
      this.renderedCount = RENDER_CHUNK;
      const el = this.$refs.listEl;
      if (el) el.scrollTop = 0;
    },
    totalCount: {
      immediate: true,
      handler(n) {
        if (this.virtualList !== 'full' && this._prevListFull && n > this.renderedCount) {
          // #2189 review round — a FULLY-rendered collection grew past the
          // limit (the browser dialog's Show-more page, a re-crawl on a
          // small repo): carry the window over so no row the curator was
          // looking at vanishes, bounded at the limit.
          this.renderedCount = Math.min(n, FULL_RENDER_LIMIT);
        } else if (this.renderedCount > n) {
          // the collection shrank under a wide window (new crawl, filter):
          // clamp so the window never claims rows past the end.
          this.renderedCount = Math.max(RENDER_CHUNK, n);
        }
        this._prevListFull = this.virtualList === 'full';
      }
    }
  },
  mounted() {
    // #2189 review round — the wizard workbench and the concept browser
    // scroll AROUND the rail (the rail's own ul never overflows there), so
    // extension also listens on the capture phase: any ancestor scroll
    // container revealing the spacer extends the window. The ul's own
    // scroll (the editor mount) still drives onListScroll below.
    document.addEventListener('scroll', this.onDocumentScroll, { capture: true, passive: true });
    this.$nextTick(this.measureRowHeight);
  },
  beforeUnmount() {
    // stops any in-flight extension chain (the $nextTick re-checks)
    this._railDead = true;
    document.removeEventListener('scroll', this.onDocumentScroll, true);
  },
  methods: {
    decorate(c) {
      return { ...c, sourceUrl: this.sourceOf(c), key: c.concept_id };
    },
    // D-G: the concept's curation origin as a compact tag. Guarded — old
    // meta rows carry no curation payload and render nothing.
    originLabel(node) {
      const c = node && node.curation;
      if (!c || typeof c !== 'object') return '';
      const m = String(c.method || c.resolved_by || '');
      if (!m) return '';
      if (m.includes('llm')) return 'llm';
      if (m.includes('authorial')) return 'authorial';
      if (m.includes('heuristics')) return 'heur';
      return m;
    },
    sourceOf(c) {
      const s = (c.sources || []).find((x) => x && x.resource);
      return s ? s.resource : '';
    },
    firstLabel(c) {
      return (c.labels && c.labels[0]) || '';
    },
    // The flagged-entity types × counts as compact text: "PERSON×17, DATE_TIME×5".
    piiSummary(c) {
      const s = c && c.pii_hits_summary && typeof c.pii_hits_summary === 'object' ? c.pii_hits_summary : null;
      if (!s) return '';
      return Object.entries(s)
        .map(([t, n]) => t + '×' + n)
        .join(', ');
    },
    piiTip(c) {
      const s = this.piiSummary(c);
      return s
        ? this.translate(
            'okf.editor.concepts.piiTip',
            'Flagged entities: {k}. Open, remove or alter them, then save — it re-scans automatically.'
          ).replace('{k}', s)
        : this.translate('okf.editor.concepts.piiTipBare', 'Flagged entities — open, review, then save to re-scan.');
    },
    originTitle() {
      return this.translate('okf.editor.concepts.originTip', 'How this concept was curated');
    },
    toggleLabelEdit(conceptId) {
      this.labelEditing = this.labelEditing === conceptId ? null : conceptId;
    },
    onLabelPicked(node, value) {
      this.labelEditing = null;
      this.$emit('label', { conceptId: node.concept_id, label: value || '' });
    },
    // ---- ingest-failure card (David, 2026-09-14) ---------------------------
    showFailCard(row, evt) {
      if (!row || row.index_status !== 'failed') return; // only RED rows speak
      const el = evt && evt.currentTarget;
      if (!el || !el.getBoundingClientRect) return;
      const r = el.getBoundingClientRect();
      // Fixed viewport coords, clamped so the card never leaves the screen.
      // Below the row when it fits, flipped above near the viewport bottom.
      const CARD_W = 340;
      const CARD_H = 220; // estimate; refined visually by the clamp below
      const x = Math.max(8, Math.min(r.left, window.innerWidth - CARD_W - 8));
      const below = r.bottom + CARD_H + 12 < window.innerHeight;
      this.failCard = {
        visible: true,
        above: !below,
        row,
        x,
        y: below ? r.bottom + 6 : Math.max(8, r.top - 6)
      };
    },
    hideFailCard() {
      if (this.failCard.visible) this.failCard.visible = false;
    },
    // ---- #2189 — the windowed rail ----------------------------------------
    // Extend the rendered window as the curator scrolls near its bottom.
    // The $nextTick re-check is what makes a deep jump (End key, scrollbar
    // fling) keep filling: extension swaps rendered rows for spacer height,
    // so the container's scrollHeight never changes and the browser emits
    // no follow-up scroll event of its own.
    canGrow() {
      if (this._railDead) return false;
      if (!this.truncated) return false;
      // collapsed children render nothing while every extension shrinks the
      // spacer — extending a collapsed rail churns hidden rows and lurches
      // the scrollbar (review round 1, finding 4). Expansion resumes it.
      if (this.virtualList === 'children' && !this.expanded) return false;
      return true;
    },
    onListScroll(evt) {
      this.hideFailCard();
      const el = evt && evt.currentTarget;
      if (!el || !el.clientHeight) return;
      this.extendWindow(el);
    },
    // The capture-phase path: some ancestor container (the wizard bench's
    // page, the concept browser's 60vh pane) is the real scroller. The ul's
    // own geometry is inert there — key on the spacer's viewport position
    // instead. Skipped when the ul itself overflows (the editor mount),
    // where onListScroll already owns extension.
    onDocumentScroll() {
      this.hideFailCard();
      const el = this.$refs.listEl;
      if (el && el.scrollHeight > el.clientHeight + 1) return;
      this.extendFromAncestor();
    },
    extendFromAncestor() {
      if (!this.canGrow()) return;
      const spacer = this.$refs.tailEl;
      if (!spacer) return;
      const r = spacer.getBoundingClientRect();
      if (r.top > window.innerHeight + EXTEND_LEAD) return; // still below the fold
      this.renderedCount = Math.min(this.totalCount, this.renderedCount + RENDER_CHUNK);
      this.$nextTick(() => this.extendFromAncestor());
    },
    extendWindow(el) {
      if (!this.canGrow()) return;
      if (el.scrollTop + el.clientHeight < this.renderedCount * this.rowHeight - EXTEND_LEAD) return;
      this.renderedCount = Math.min(this.totalCount, this.renderedCount + RENDER_CHUNK);
      this.$nextTick(() => {
        if (!this._railDead) this.extendWindow(el);
      });
    },
    // One real row read after mount: the spacer and the extension lead use
    // the ACTUAL row height instead of a hardcoded estimate, so the
    // scrollbar stays honest when the DS spacing tokens move. No layout in
    // jsdom — the default stands there.
    measureRowHeight() {
      const row = this.$el && this.$el.querySelector('.okf-cl__row');
      if (row && row.offsetHeight > 0) {
        this.rowHeight = Math.max(24, Math.ceil(row.offsetHeight + 2));
      }
    },
    // The recovery for THIS failure kind. The reaper dead-letter is the
    // saturated-drain signature (www-gov-uk: 75 identical messages) — the
    // content is intact, only the indexing callback never arrived.
    fixFor(row) {
      const err = String((row && (row.last_error || row.last_worker_error)) || '');
      if (err.includes('reaper dead-letter')) {
        return this.translate(
          'okf.editor.concepts.failedCard.fix.reaper',
          'The ingest worker stopped waiting inside its grace window — the drain was saturated, so the indexing callback never arrived. Your content is intact. To retry: open this file, make a small edit and save — saving re-queues it for ingest; or retract and re-ingest the repo to retry every failed file at once.'
        );
      }
      if (err.includes('dataprep')) {
        return this.translate(
          'okf.editor.concepts.failedCard.fix.dataprep',
          'The content-preparation service rejected or dropped this ingest. To retry: open this file, make a small edit and save — saving re-queues it. If it fails again, check the dataprep service health before retrying the whole repo.'
        );
      }
      return this.translate(
        'okf.editor.concepts.failedCard.fix.generic',
        'Indexing failed. To retry: open this file, make a small edit to the content and save — saving re-queues it for ingest; or retract and re-ingest the repo to retry every failed file.'
      );
    },
    shortWhen(iso) {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return '';
      return this.translate('okf.editor.concepts.failedCard.when', 'Last attempt {when}').replace(
        '{when}',
        d.toLocaleString()
      );
    },
    // ---- provenance links (Story 7.7): open the doc-repo details dialog ----
    sourceFiles(c) {
      return ((c && Array.isArray(c.sources) && c.sources) || []).filter((s) => s && s.file_id);
    },
    openSource(s) {
      // Accepts a source ({file_id}), a bare id, OR a row/child node (whose
      // file_id rides sources[] — the first document source wins).
      let fileId = null;
      if (typeof s === 'string') fileId = s;
      else if (s && s.file_id) fileId = s.file_id;
      else if (s && Array.isArray(s.sources)) {
        const hit = s.sources.find((x) => x && x.file_id);
        if (hit) fileId = hit.file_id;
      }
      if (!fileId) return;
      // Deep link: AdminDashboard watches $route.query (?tab=documents&file=)
      // and opens the SAME FileDetailsDialog the documents list uses.
      if (this.$router) {
        this.$router.push({ query: { ...(this.$route.query || {}), tab: 'documents', file: fileId } }).catch(() => {});
      } else {
        this.$emit('open-source', fileId);
      }
    }
  }
};
</script>

<style scoped>
.okf-cl {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: var(--space-md);
  min-height: 0;
}
.okf-cl__header {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-sm);
}
.okf-cl__title {
  font-size: var(--text-sm);
  font-weight: 600;
}
.okf-cl__count {
  background: var(--accent-muted);
  color: var(--accent);
  padding: 1px 8px;
  border-radius: 100px;
  font-size: var(--text-xs);
}
/* REPO BULK PII (David, 2026-09-12): header action group — compact, tokened. */
.okf-cl__bulk {
  display: inline-flex;
  gap: var(--space-xs);
  margin-left: auto;
}
.okf-cl__bulk-btn {
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--fg);
  border-radius: var(--radius-sm);
  padding: 2px var(--space-sm);
  font-size: var(--text-xs);
  line-height: 1.5;
  cursor: pointer;
  white-space: nowrap;
}
.okf-cl__bulk-btn:hover {
  border-color: var(--brand);
  color: var(--brand);
}
.okf-cl__filter {
  width: 100%;
}
/* NON-BLOCKING LOAD: slim determinate bar + live counts. */
.okf-cl__load {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}
.okf-cl__load-label {
  flex: 0 0 auto;
  font-size: var(--text-xs);
  color: var(--muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.okf-cl__empty {
  color: var(--muted);
  font-size: var(--text-sm);
  text-align: center;
  padding: var(--space-md) 0;
  margin: 0;
}
.okf-cl__list,
.okf-cl__children {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
}
.okf-cl__list {
  flex: 1;
}
.okf-cl__children {
  padding-left: var(--space-lg);
}
.okf-cl__row {
  display: flex;
  align-items: flex-start;
  gap: var(--space-xs);
  width: 100%;
  text-align: left;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  padding: var(--space-xs) var(--space-sm);
  margin-bottom: 2px;
  font: inherit;
  color: var(--fg);
  cursor: pointer;
}
.okf-cl__row:hover {
  background: var(--accent-muted);
}
.okf-cl__row--selected {
  border-color: var(--accent);
  background: var(--accent-muted);
}
.okf-cl__twist {
  color: var(--muted);
  font-size: var(--text-xs);
  transition: transform 0.15s;
  user-select: none;
}
.okf-cl__twist--open {
  transform: rotate(90deg);
}
.okf-cl__status {
  flex: 0 0 auto;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-top: 6px;
  background: var(--muted);
}
.okf-cl__status--indexed {
  background: var(--success);
}
.okf-cl__status--parsed {
  background: var(--warning);
}
.okf-cl__status--failed {
  background: var(--danger);
}
.okf-cl__body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  flex: 1;
}
.okf-cl__row-title {
  font-size: var(--text-sm);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}
.okf-cl__row-source {
  font-size: var(--text-xs);
  color: var(--muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.okf-cl__origin {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--muted);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 0 var(--space-xs);
}
.okf-cl__actions {
  display: none;
  gap: 2px;
  align-items: center;
}
.okf-cl__row:hover .okf-cl__actions {
  display: inline-flex;
}
.okf-cl__action {
  border: 0;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  font: inherit;
  font-size: var(--text-xs);
  padding: 0 4px;
  border-radius: var(--radius-sm);
}
.okf-cl__action:hover {
  background: var(--surface);
  color: var(--accent);
}
.okf-cl__action--danger:hover {
  color: var(--danger);
}
/* Re-ingest (David, 2026-10-14): a RETRY is neither destructive nor primary —
   it reads as an accent affordance, distinct from the ✕ delete beside it. */
.okf-cl__action--reingest {
  color: var(--accent);
}
.okf-cl__action--reingest:hover {
  color: var(--accent);
  text-decoration: underline;
}
/* #1577 story 2: the split glyph — a preparation, not a destruction; the
   accent colour matches the re-ingest affordance beside it. */
.okf-cl__action--split {
  color: var(--accent);
}
.okf-cl__action-glyph {
  font-size: var(--text-sm);
  line-height: 1;
}
.okf-cl__label-edit {
  padding: 0 var(--space-sm) var(--space-xs) var(--space-lg);
}
.okf-cl__footer {
  display: flex;
  gap: var(--space-sm);
  align-items: center;
  border-top: 1px solid var(--border);
  padding-top: var(--space-sm);
}
/* ⓘ tips ride immediately BEFORE their action button (David, 2026-09-27:
   every complex control explains its RAG purpose in place). */
.okf-cl__footer-tip {
  display: inline-flex;
  align-items: center;
}
/* INGEST-FAILURE CARD (2026-09-14): fixed-position tooltip next to the
   hovered RED row. Tokens only; pointer-events none — pure overlay. */
.okf-cl__failcard {
  position: fixed;
  z-index: 20;
  width: 340px;
  max-width: calc(100vw - 16px);
  padding: var(--space-sm) var(--space-md);
  background: var(--surface);
  border: 1px solid var(--border);
  border-top: 2px solid var(--danger);
  border-radius: var(--radius-lg, 12px);
  box-shadow: var(--shadow-lg, 0 12px 32px rgba(9, 14, 20, 0.16));
  color: var(--fg);
  pointer-events: none;
  transform: translateY(0);
}
.okf-cl__failcard--above {
  transform: translateY(-100%);
}
.okf-cl__failcard-head {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  justify-content: space-between;
  margin: 0 0 var(--space-xs);
}
.okf-cl__failcard-title {
  font-size: var(--text-sm);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.okf-cl__failcard-sec {
  margin: var(--space-xs) 0 2px;
  font-size: var(--text-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--muted);
}
.okf-cl__failcard-err {
  margin: 0;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--danger);
  word-break: break-word;
}
.okf-cl__failcard-fix {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--fg);
}
.okf-cl__failcard-meta {
  margin: var(--space-xs) 0 0;
  font-size: var(--text-xs);
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
</style>
