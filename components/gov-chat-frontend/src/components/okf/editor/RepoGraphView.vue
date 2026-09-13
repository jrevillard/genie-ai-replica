<!--
  OkfRepoGraphView.vue - Story #978 linked-graph view of an OKF repository,
  v2 INTERACTIVE BROWSER (David, 2026-09-04): the graph browser must be
  TRAVERSABLE and ZOOMABLE "in a meaningful manner so the user can see the
  index link relationships in the data".

  Data contract (David's rule, unchanged): this view is a PROJECTION OF THE
  REPOSITORY'S MARKDOWN LINKS (author-stated frontmatter links, served by the
  bundle manifest today, by GET /:repo_id/links as they land). It NEVER reads
  the ArangoDB serving graph — that materializes only at drain time.

  Rendering: cytoscape.js (open-source graph browser). Force-directed layout
  scales to hundreds of concepts (crawl imports); wheel zoom + drag pan;
  click a node to highlight its link neighborhood (everything else dims);
  click the background to clear. index.md stays visually dominant.

  Click a node -> emits 'select' (opens that file in the editor).
-->

<template>
  <div class="okf-gv">
    <p v-if="nodes.length === 0" class="okf-gv__empty">
      {{ translate('okf.graph.empty', 'No concepts yet - nothing to graph.') }}
    </p>
    <template v-else>
      <div class="okf-gv__toolbar">
        <DsButton variant="ghost" small :title="translate('okf.graph.fit', 'Fit graph')" @click="fit">
          {{ translate('okf.graph.fit', 'Fit') }}
        </DsButton>
        <DsButton variant="ghost" small :title="translate('okf.graph.zoomIn', 'Zoom in')" @click="zoomBy(1.3)">
          +
        </DsButton>
        <DsButton variant="ghost" small :title="translate('okf.graph.zoomOut', 'Zoom out')" @click="zoomBy(1 / 1.3)">
          −
        </DsButton>
        <DsButton
          variant="ghost"
          small
          :class="{ 'okf-gv__tgl': showHub }"
          :title="
            translate('okf.graph.hub', 'Show or hide the index hub (its Contents links are structure, not knowledge)')
          "
          @click="showHub = !showHub"
        >
          {{ translate('okf.graph.hub', 'index hub') }}
        </DsButton>
      </div>
      <!-- The card lives in a WRAPPER, not inside the stage: cytoscape mutates
           the stage div's children directly (canvases added/removed on every
           rebuild), and Vue-managed v-if content in that same container
           desyncs the patcher's anchors — 'insertBefore' of a null container
           on the first card toggle (live-caught 2026-09-12; jsdom runs
           cytoscape headless so tests never see it). The wrapper has the
           same geometry as the stage, so card coordinates are unchanged. -->
      <div class="okf-gv__stage-wrap">
        <div ref="stage" class="okf-gv__stage" role="img" :aria-label="translate('okf.graph.aria', 'Concept graph')">
          <p v-show="layouting" class="okf-gv__layouting">
            {{ translate('okf.graph.layouting', 'Layouting…') }}
          </p>
        </div>
        <!-- ASYNC BUILD OVERLAY (David, 2026-09-13 "Page Unresponsive" fix):
             the graph build + layout no longer block the main thread; while
             they stream in batches this overlay shows real progress. -->
        <div v-show="building" class="okf-gv__building" aria-live="polite">
          <DsSpinner size="md" />
          <p class="okf-gv__building-label">
            {{ translate('okf.graph.building', 'Preparing graph…') }}
            <template v-if="buildPct != null">&#32;{{ buildPct }}%</template>
          </p>
          <DsProgress
            class="okf-gv__building-bar"
            size="sm"
            variant="accent"
            :indeterminate="buildPct == null"
            :value="buildPct || 0"
            :aria-label="translate('okf.graph.building', 'Preparing graph…')"
          />
        </div>
        <!-- HOVER SUMMARY (David, 2026-09-12): floating summary card for the
             SELECTED node — the concept's OKF data at a glance without
             scrolling to the file viewer. Selection sync is untouched: tap
             still emits 'select' (opens the file) and focuses the
             neighborhood; the card is a read-only overlay (pointer-events:
             none) so it never intercepts graph interaction. -->
        <Transition name="okf-gv-card">
          <div
            v-if="card.visible"
            ref="card"
            class="okf-gv__card"
            :class="['okf-gv__card--' + card.kind, { 'okf-gv__card--below': card.below }]"
            role="tooltip"
            :style="{ left: card.x + 'px', top: card.y + 'px' }"
          >
            <p class="okf-gv__card-title"><span class="okf-gv__card-dot" aria-hidden="true"></span>{{ card.title }}</p>
            <p v-if="card.chips.length" class="okf-gv__card-chips">
              <span v-for="chip in card.chips" :key="chip" class="okf-gv__card-chip">{{ chip }}</span>
            </p>
            <p v-if="card.summary" class="okf-gv__card-summary">{{ card.summary }}</p>
            <p v-if="card.meta.length" class="okf-gv__card-meta">
              <template v-for="(m, i) in card.meta" :key="m">
                <span v-if="i" class="okf-gv__card-sep" aria-hidden="true">·</span>
                <span>{{ m }}</span>
              </template>
            </p>
          </div>
        </Transition>
      </div>
      <p class="okf-gv__legend">
        {{ translate('okf.graph.legend', 'index') }} = hub · {{ nodes.length - 1 }}
        {{ translate('okf.graph.concepts', 'concepts') }} · {{ edges.length }}
        {{ translate('okf.graph.links', 'links') }}
      </p>
    </template>
  </div>
</template>

<script>
import translateMixin from '../../../mixins/translateMixin';
import repoOkfService from '../../../services/repoOkfService';
import cytoscape from 'cytoscape';
import fcose from 'cytoscape-fcose';
import DsButton from '../../ds/Button.vue';
import DsProgress from '../../ds/Progress.vue';
import DsSpinner from '../../ds/Spinner.vue';

// fcose registers ONCE per module (cytoscape.use is global) — tests stay
// headless (grid layout, no plugin) regardless.
let fcoseRegistered = false;

export default {
  name: 'OkfRepoGraphView',
  components: { DsButton, DsProgress, DsSpinner },
  mixins: [translateMixin],
  props: {
    repoId: { type: String, required: true },
    concepts: { type: Array, default: () => [] },
    selectedId: { type: String, default: null },
    // LAZY BUILD (2026-09-13): false while the Graph tab is hidden — the
    // (synchronous) force layout then waits for the first reveal instead of
    // freezing repo-open. Default true keeps direct mounts (tests, embeds)
    // building immediately.
    active: { type: Boolean, default: true }
  },
  emits: ['select'],
  data() {
    return {
      size: 640,
      showHub: false, // index hub + TOC edges hidden by default (structure, not knowledge)
      layouting: false, // true while the layout engine settles (large repos)
      // ASYNC BUILD (2026-09-13): true while the chunked graph build runs —
      // the overlay shows the batch progress; buildPct is null (indeterminate)
      // once ingestion is done and only the layout is still settling.
      building: false,
      buildPct: null,
      links: {}, // concept_id -> [{ to_concept_id, label }]
      // Hover summary card state (selected node only — see template).
      // The hover GATE is `this._neighbourIds` (non-reactive, set by
      // focus()/cleared by clearFocus()): the highlighted neighborhood —
      // selected node + immediately adjacent nodes — is exactly the set of
      // hoverable nodes. See the mouseover binding in rebuild().
      card: {
        visible: false,
        below: false, // flip placement when the node sits near the stage top
        x: 0,
        y: 0,
        kind: 'topic', // index | topic | failed — drives the accent color
        title: '',
        chips: [],
        summary: '',
        meta: []
      }
    };
  },
  computed: {
    // The DATA MODEL (kept identical to v1 — tests assert these): nodes and
    // author-stated edges derived from the concepts + markdown links.
    // Rebuild key for the cytoscape watcher (reactive — see watch.modelKey).
    modelKey() {
      return this.nodes.length + ':' + this.edges.length + ':' + this.repoId + ':' + this.showHub;
    },
    nodes() {
      const c = this.size / 2;
      // Index hub excluded by default (David, 2026-09-04): TOC links are
      // structure, not knowledge — the toolbar toggle brings it back.
      const visible = this.showHub ? this.concepts : this.concepts.filter((x) => !x.is_index);
      const ring = visible.filter((x) => !x.is_index);
      const radius = this.size * 0.38;
      return visible.map((x, i) => {
        const isIndex = !!x.is_index;
        const idx = ring.indexOf(x);
        const angle = isIndex ? 0 : (2 * Math.PI * idx) / Math.max(ring.length, 1) - Math.PI / 2;
        return {
          id: x.concept_id,
          title: x.title || x.concept_id,
          short: this.shorten(x.title || x.concept_id, isIndex ? 14 : 10),
          type: x.type,
          label: (x.labels && x.labels[0]) || '',
          is_index: isIndex,
          kind: x.index_status === 'failed' ? 'failed' : isIndex ? 'index' : 'topic',
          hot: x.concept_id === this.selectedId,
          x: isIndex ? c : c + radius * Math.cos(angle),
          y: isIndex ? c : c + radius * Math.sin(angle),
          _i: i
        };
      });
    },
    byId() {
      const m = new Map();
      for (const n of this.nodes) m.set(n.id, n);
      return m;
    },
    edges() {
      const out = [];
      const seen = new Set();
      for (const n of this.nodes) {
        const ls = this.links[n.id] || [];
        for (const l of ls) {
          const to = l && l.to_concept_id;
          if (!to || !this.byId.has(to)) continue; // cross-repo / dangling links are not drawn
          // Index TOC links are STRUCTURE, not knowledge (David, 2026-09-04):
          // the index's Contents list links every concept, so drawing them
          // forces a radial star that hides the real concept→concept graph.
          // Excluded by default; the toolbar toggle brings the hub back.
          if (
            !this.showHub &&
            (n.is_index ||
              to === (this.byId.get('index') || {}).id ||
              (this.concepts.find((c) => c.concept_id === to) || {}).is_index)
          ) {
            continue;
          }
          const key = `${n.id}->${to}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const a = this.byId.get(n.id);
          const b = this.byId.get(to);
          out.push({
            key,
            label: l.label || 'related',
            hot: n.id === this.selectedId || to === this.selectedId,
            path: this.arc(a, b)
          });
        }
      }
      return out;
    }
  },
  watch: {
    repoId: {
      immediate: true,
      handler() {
        this.loadLinks();
      }
    },
    // Concepts settle asynchronously (the worker drains after mount) — the
    // manifest's links land AFTER the first load. Reload when the set changes,
    // or the graph renders nodes with NO edges (live-caught 2026-08-30).
    'concepts.length'() {
      this.loadLinks();
    },
    // Rebuild the cytoscape elements whenever the data model changes.
    // $nextTick FIRST: when concepts arrive AFTER mount (fresh repo open),
    // the stage div is only created by this same update — rebuilding before
    // the DOM patch finds no $refs.stage and the browser never builds
    // (live-broken on Kenya 2026-09-05: zero graph on reopen).
    modelKey() {
      // LAZY BUILD: data changes while the pane is hidden only mark the build
      // pending — never a hidden synchronous layout.
      if (!this.active) {
        this.pendingRebuild = true;
        return;
      }
      this.$nextTick(() => {
        this._buildPromise = this.rebuild(); // tests await this
      });
    },
    // First reveal of the Graph tab: run the pending build (with the stage
    // now actually sized) and arm the resize observer.
    active: {
      handler(v) {
        if (!v || !this.pendingRebuild) return;
        this.pendingRebuild = false;
        this.$nextTick(() => {
          this._buildPromise = this.rebuild(); // tests await this
        });
      }
    },
    selectedId() {
      this.applyFocus(); // re-arms the highlight + the hover neighborhood
      this.hideCard(); // selection moved — the old node's card must not linger
    }
  },
  mounted() {
    // LAZY BUILD (David, 2026-09-13 "Page Unresponsive" fix): the parent
    // mounts this view hidden (v-show) and the cytoscape constructor runs its
    // force layout SYNCHRONOUSLY — on a crawl-sized repo that froze the page
    // at repo open EVEN WITH THE GRAPH TAB NEVER OPENED. When inactive, mark
    // the build pending; it runs the moment the Graph tab is first revealed.
    if (!this.active) {
      this.pendingRebuild = true;
      return;
    }
    this._buildPromise = this.rebuild(); // tests await this
    // The stage has ZERO size at mount (v-show until the Graph tab is
    // chosen), and a canvas sized at 0 stays blank forever (live-caught
    // 2026-09-04 on Kenya). One observer covers tab reveal, panel resize and
    // window resize; attachStageObserver is also re-run from rebuild() for a
    // stage created by a LATER update (concepts arriving after mount — the
    // zero-graph regression).
    this.attachStageObserver();
  },
  beforeUnmount() {
    // Abort any in-flight async build BEFORE destroying cy — the chunked
    // stream checks the seq (and this.cy) at every yield.
    this._buildSeq = (this._buildSeq || 0) + 1;
    if (this._stageObserver) {
      this._stageObserver.disconnect();
      this._stageObserver = null;
    }
    if (this.cy) {
      this.cy.destroy();
      this.cy = null;
    }
    this.card.visible = false;
  },
  methods: {
    shorten(s, max) {
      const t = String(s || '');
      return t.length > max ? t.slice(0, max - 1) + '…' : t;
    },
    arc(a, b) {
      // Kept for the v1 data model/tests (edge hot-path math).
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const cx = mx - dy * 0.08;
      const cy = my + dx * 0.08;
      return `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`;
    },
    async loadLinks() {
      this.links = {};
      if (!this.repoId) return;
      const norm = (id) => String(id || '').replace(/^concepts\//, '');
      // PRIMARY — the LIVE meta projection (GET /:repo_id/links): available
      // from the first import and current through every edit (David's rule:
      // the editor graph is the markdown-link projection, never the ArangoDB
      // graph). FALLBACK — the settled manifest (legacy backends / pre-route
      // repos), which carries the same author-stated edges at settle time.
      try {
        const live = await repoOkfService.getRepoLinks(this.repoId);
        if (live && Array.isArray(live.links)) {
          const map = {};
          for (const e of live.links) {
            const from = norm(e.from_concept_id);
            const to = norm(e.to_concept_id);
            if (!from || !to) continue;
            (map[from] = map[from] || []).push({ to_concept_id: to, label: e.label || '' });
          }
          this.links = map;
          return;
        }
      } catch {
        // legacy backend without the route — fall through to the manifest
      }
      try {
        const m = await repoOkfService.getManifest(this.repoId);
        const map = {};
        for (const l of (m && m.links) || []) {
          const from = norm(l.from_concept_id);
          const to = norm(l.to_concept_id);
          if (!from || !to) continue;
          (map[from] = map[from] || []).push({ to_concept_id: to, label: l.label || '' });
        }
        this.links = map;
      } catch {
        // not settled yet: nodes render, edges arrive at settle.
        this.links = {};
      }
    },
    // ---- cytoscape browser -------------------------------------------------
    token(name, fallback) {
      // DS compliance: resolve design tokens at mount (canvas cannot read CSS vars).
      const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return v || fallback;
    },
    // Resolve ANY CSS color (oklch(), color(), hex, …) to a canvas-safe
    // rgba() string: the browser parses the color into a 1×1 pixel probe
    // and we read the rendered bytes back. jsdom has no canvas → passthrough.
    toCanvasColor(v) {
      try {
        if (!this._colorCtx)
          this._colorCtx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
        const ctx = this._colorCtx;
        if (!ctx) return v;
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = v;
        ctx.fillRect(0, 0, 1, 1);
        const d = ctx.getImageData(0, 0, 1, 1).data; // [r,g,b,a]
        return 'rgba(' + d[0] + ',' + d[1] + ',' + d[2] + ',' + (d[3] / 255).toFixed(3) + ')';
      } catch {
        return v;
      }
    },
    palette() {
      // Tint a token color toward the stage (a lighter top stop) for the
      // gradients. DS tokens are OKLch (hex only in legacy themes), so the
      // tint is an ALPHA stop — valid for both formats. The previous hex
      // parseInt mix produced '#NaN…' for oklch tokens and blanked the
      // canvas (live-broken 2026-09-05). Tokens only — never hardcoded.
      const tint = (c, a) => {
        const s = String(c || '');
        if (s.startsWith('#')) {
          const h = [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
          if (h.some((v) => Number.isNaN(v))) return s;
          return (
            '#' +
            h
              .map((v) =>
                Math.round(v + (255 - v) * a)
                  .toString(16)
                  .padStart(2, '0')
              )
              .join('')
          );
        }
        if (s.includes('(') && s.endsWith(')') && !s.includes('/')) {
          return s.slice(0, -1) + ' / ' + a + ')'; // e.g. oklch(47% 0.14 265 / 0.45)
        }
        return s;
      };
      const brand = this.token('--brand', '#1f6f54');
      const info = this.token('--info', '#2c6fa8');
      const danger = this.token('--danger', '#b3261e');
      return {
        brand: this.toCanvasColor(brand),
        brandHi: this.toCanvasColor(tint(brand, 0.45)),
        info: this.toCanvasColor(info),
        infoHi: this.toCanvasColor(tint(info, 0.45)),
        danger: this.toCanvasColor(danger),
        dangerHi: this.toCanvasColor(tint(danger, 0.4)),
        fg: this.toCanvasColor(this.token('--fg', '#1c2430')),
        muted: this.toCanvasColor(this.token('--muted', '#5c6773')),
        border: this.toCanvasColor(this.token('--border', '#d7dde4')),
        surface: this.toCanvasColor(this.token('--surface', '#ffffff')),
        edge: this.toCanvasColor(this.token('--muted', '#5c6773')),
        edgeHot: this.toCanvasColor(this.token('--brand', '#1f6f54'))
      };
    },
    // One macrotask yield: lets the browser paint (spinner) between build
    // chunks — the primitive the markdown editor's chunked renderer uses.
    _frame() {
      return new Promise((resolve) => setTimeout(resolve, 0));
    },
    async rebuild() {
      if (!this.$refs.stage || this.nodes.length === 0) return;
      // ASYNC BUILD (David, 2026-09-13 "Page Unresponsive" on the Graph tab):
      // the constructor + force layout used to run in ONE synchronous task —
      // on a crawl-sized repo (~1000 nodes / ~5000 edges) that blocked the
      // main thread for seconds and popped the Page Unresponsive dialog. The
      // build is now chunked with yields: the spinner paints first, elements
      // stream in batches with real % progress, and the large-repo layout
      // runs ANIMATED (frames between iterations keep the page responsive).
      // Stale-seq guard (the markdown renderer's _renderSeq pattern): a
      // superseded build aborts at its next yield instead of clobbering the
      // newer one.
      const seq = (this._buildSeq = (this._buildSeq || 0) + 1);
      const stale = () => seq !== this._buildSeq;
      this.building = true;
      this.buildPct = 0;
      await this._frame();
      await this._frame(); // second yield: the overlay must actually PAINT
      if (stale()) return;
      const p = this.palette();
      // jsdom (jest) has no canvas — run headless there and use a layout that
      // does not need renderer dimensions ('cose' measures the viewport).
      const headless = typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent || '');
      const elements = [
        ...this.nodes.map((n) => ({
          group: 'nodes',
          data: {
            id: n.id,
            label: n.short,
            title: n.title + (n.type ? ' (' + n.type + ')' : '') + (n.label ? ' — ' + n.label : ''),
            kind: n.kind
          },
          position: { x: n.x, y: n.y },
          classes: n.kind
        })),
        ...this.edges.map((e) => ({
          group: 'edges',
          data: { id: e.key, source: e.key.split('->')[0], target: e.key.split('->')[1], label: e.label }
        }))
      ];
      if (this.cy) {
        this.cy.destroy();
        this.cy = null;
      }
      // Large repos (~1000 nodes, crawl imports): cose is minutes-slow and the
      // canvas shows the initial grid-line for most of a minute (live-caught on
      // the wikipedia re-import). fcose is sub-second at this scale — use it
      // above a threshold, cose below (small curated repos don't need a plugin).
      const useFcose = !headless && this.nodes.length > 150;
      if (useFcose && !fcoseRegistered) {
        cytoscape.use(fcose);
        fcoseRegistered = true;
      }
      const layoutCfg = useFcose
        ? {
            name: 'fcose',
            // animate:false (REVERTED 2026-09-14): the animated variant never
            // emitted 'layoutstop' here and wedged the overlay at 99%. The
            // sync solve is sub-second at crawl scale (live-verified on the
            // wikipedia re-import), and the element streaming already keeps
            // the page responsive up to this point.
            animate: false,
            padding: 40,
            quality: 'default',
            randomize: true,
            nodeSeparation: 120,
            idealEdgeLength: 90
          }
        : headless
          ? { name: 'grid', animate: false, padding: 40 }
          : { name: 'cose', animate: false, padding: 40, randomize: true, nodeOverlap: 12, idealEdgeLength: 90 };
      this.cy = cytoscape({
        // Headless (jsdom): NO container — a container makes cytoscape measure
        // the element, and jsdom elements have no layout (w/h undefined).
        ...(headless ? { headless: true, styleEnabled: false } : { container: this.$refs.stage }),
        // (the stage div is guaranteed present: rebuild is called after
        // $nextTick from the modelKey watcher and from mounted — see above)
        // EMPTY (2026-09-13): elements stream in batches below — a cold
        // constructor with ~5000 elements was the freeze.
        elements: [],
        // wheelSensitivity: cytoscape DEFAULT — a custom value warns on every
        // rebuild and the default suits mainstream mice (console-log spam fix).
        minZoom: 0.05,
        maxZoom: 3,
        style: [
          {
            selector: 'node',
            style: {
              label: 'data(label)',
              'background-color': p.surface,
              'border-color': p.border,
              'border-width': 1.5,
              color: p.fg,
              'font-size': 10,
              'text-valign': 'bottom',
              'text-margin-y': 4,
              width: 18,
              height: 18
              // NO transition-property here (2026-09-13): focus()/clearFocus()
              // flip classes on ~5000 elements at once — a 120ms opacity
              // transition animated them for 7+ full-canvas repaints per
              // selection (the "selecting nodes" freeze). Instant flip = one
              // repaint; the fade bought nothing.
            }
          },
          {
            selector: 'node.topic',
            style: {
              // DS tokens resolved in palette() (canvas can't read CSS vars);
              // the mix() tints are derived, not hardcoded palette choices.
              'background-gradient-stop-colors': p.infoHi + ' ' + p.info,
              'background-gradient-direction': 'to-bottom',
              'border-color': p.info,
              width: 22,
              height: 22
            }
          },
          {
            // Vertical gradient (brand) keeps the hub dominant without shouting.
            selector: 'node.index',
            style: {
              'background-gradient-stop-colors': p.brandHi + ' ' + p.brand,
              'background-gradient-direction': 'to-bottom',
              'border-color': p.brand,
              color: p.fg,
              'font-size': 12,
              'text-background-color': p.surface,
              'text-background-opacity': 0.8,
              'text-background-shape': 'roundrectangle',
              'text-background-padding': 2,
              'font-weight': 'bold',
              width: 30,
              height: 30
            }
          },
          {
            selector: 'node.failed',
            style: {
              'background-gradient-stop-colors': p.dangerHi + ' ' + p.danger,
              'background-gradient-direction': 'to-bottom',
              'border-color': p.danger,
              color: p.danger
            }
          },
          {
            selector: 'edge',
            style: {
              width: 1.5,
              'line-color': p.edge,
              'curve-style': 'bezier',
              'control-point-step-size': 40,
              opacity: 0.55,
              'target-arrow-shape': 'triangle',
              'target-arrow-color': p.edge,
              'arrow-scale': 0.8,
              label: 'data(label)',
              'font-size': 9,
              color: p.muted,
              'text-background-color': p.surface,
              'text-background-opacity': 0.85,
              'text-background-padding': 2,
              'text-background-shape': 'roundrectangle',
              'text-rotation': 'autorotate'
              // transitions removed with the node style — see above
            }
          },
          { selector: 'node.faded, edge.faded', style: { opacity: 0.12 } },
          { selector: 'node.hot', style: { 'border-width': 3, 'border-color': p.brand } },
          {
            selector: 'edge.hot',
            style: { 'line-color': p.edgeHot, 'target-arrow-color': p.edgeHot, opacity: 1, width: 2.5 }
          }
        ]
        // NO layout option (2026-09-13): elements stream in batches below,
        // then cy.layout(layoutCfg) runs explicitly — a constructor layout
        // would solve against a half-empty graph and block synchronously.
      });
      // Handlers wired NOW — pan/zoom work while the build streams in.
      this.cy.on('tap', 'node', (evt) => {
        const id = evt.target.id();
        this.hideCard(); // a stale card for the previous node must not linger
        this.$emit('select', id);
        this.focus(id); // re-arms the highlight + the hover neighborhood
      });
      this.cy.on('tap', (evt) => {
        if (evt.target === this.cy) this.clearFocus();
      });
      // HOVER SUMMARY (David, 2026-09-12): hovering the SELECTED node — or
      // any node in its highlighted neighborhood (immediately adjacent nodes)
      // — floats the summary card with that concept's OKF data, so the user
      // can inspect, verify and validate the surrounding data visually and
      // walk the graph node by node (tap re-arms the neighborhood; flipping
      // to Files shows whatever was last clicked). Un-highlighted nodes show
      // nothing: the card belongs to the focused neighborhood.
      this.cy.on('mouseover', 'node', (evt) => {
        if (!this._neighbourIds || !this._neighbourIds.has(evt.target.id())) return;
        this.showCard(evt.target);
      });
      this.cy.on('mouseout', 'node', () => this.hideCard());
      // Pan/zoom/drag moves the node out from under the cursor — hide rather
      // than chase it; the card re-appears on the next hover.
      this.cy.on('viewport', () => this.hideCard());
      this.cy.on('grab', 'node', () => this.hideCard());
      // STREAM the elements in batches — each cy.add stays a few ms, and the
      // yield between batches lets the browser paint the progress overlay.
      const nodeEls = elements.filter((el) => el.group === 'nodes');
      const edgeEls = elements.filter((el) => el.group === 'edges');
      const total = elements.length || 1;
      let added = 0;
      const stream = async (items, size) => {
        for (let i = 0; i < items.length; i += size) {
          if (stale() || !this.cy) return false;
          const slice = items.slice(i, i + size);
          this.cy.add(slice);
          added += slice.length;
          this.buildPct = Math.min(99, Math.round((added / total) * 100));
          await this._frame();
        }
        return true;
      };
      if (!(await stream(nodeEls, 400))) return;
      if (!(await stream(edgeEls, 800))) return;
      if (stale() || !this.cy) return;
      // LAYOUT + finish. fcose runs animate:false — the PROVEN sub-second
      // solve (live-verified on the wikipedia re-import). The animated
      // variant (2026-09-13) never emitted 'layoutstop' on this stack and
      // wedged the overlay at 99% (David, 2026-09-14) — REVERTED. With the
      // elements now streamed in batches the solve is the only synchronous
      // stretch left, and it is sub-second at crawl scale.
      //
      // The overlay can NEVER wedge again: finish is idempotent + stale-seq
      // guarded, listened on BOTH the layout and cy, run() is wrapped in
      // try/catch, and a 20s watchdog clears the overlay even if cytoscape
      // never emits.
      this.layouting = useFcose;
      let settled = false;
      let watchdog = null;
      const finish = () => {
        if (settled || stale()) return; // a newer build owns the overlay
        settled = true;
        clearTimeout(watchdog);
        this.layouting = false;
        this.building = false;
        this.buildPct = null;
        if (!this.cy) return;
        this.cy.fit(undefined, 40);
        this.applyFocus(); // arms the hover neighborhood from the preset prop
        // The stage may have been created by THIS update (concepts arriving
        // after mount) — attach the resize observer here too, idempotently.
        this.attachStageObserver();
      };
      watchdog = setTimeout(finish, 20000);
      const layout = this.cy.layout(layoutCfg);
      layout.one('layoutstop', finish);
      this.cy.one('layoutstop', finish);
      try {
        layout.run(); // animate:false → 'layoutstop' fires inside run()
      } catch {
        finish(); // a failed solve must never wedge the overlay
      }
    },
    attachStageObserver() {
      if (typeof ResizeObserver === 'undefined' || this._stageObserver || !this.$refs.stage) return;
      this._stageObserver = new ResizeObserver(() => {
        if (!this.cy) return;
        const r = this.$refs.stage && this.$refs.stage.getBoundingClientRect();
        if (r && r.width > 0 && r.height > 0) {
          this.cy.resize();
          this.cy.fit(undefined, 40);
        }
      });
      this._stageObserver.observe(this.$refs.stage);
    },
    focus(id) {
      if (!this.cy) return;
      const keep = this.cy.getElementById(id).closedNeighborhood();
      // HOVER SET (David, 2026-09-12): the highlighted neighborhood — the
      // selected node plus its immediately adjacent nodes — is exactly the
      // set the hover summary card arms for, so the user can inspect/
      // validate adjacent data without re-selecting each node.
      this._neighbourIds = new Set(keep.nodes().map((n) => n.id()));
      // ONE batched style write (2026-09-13 "selecting nodes" freeze): the
      // five separate add/removeClass calls each invalidated style and
      // repainted the whole canvas — on a crawl repo (~5000 elements) that
      // was seconds of main-thread work per click. One batch = one repaint.
      this.cy.batch(() => {
        this.cy.elements().addClass('faded');
        keep.removeClass('faded');
        this.cy.getElementById(id).addClass('hot');
        // The selected node's edges light up (brand) so its link relationships
        // read at a glance — the whole point of the neighborhood focus.
        this.cy.edges().removeClass('hot');
        keep.filter('edge').addClass('hot');
      });
    },
    clearFocus() {
      if (!this.cy) return;
      this._neighbourIds = null; // nothing highlighted → nothing hoverable
      this.cy.batch(() => {
        this.cy.elements().removeClass('faded');
        this.cy.nodes().removeClass('hot');
        this.cy.edges().removeClass('hot');
      });
    },
    applyFocus() {
      if (!this.cy) return;
      this.clearFocus();
      if (this.selectedId && this.cy.getElementById(this.selectedId).nonempty()) {
        this.focus(this.selectedId);
      }
    },
    fit() {
      if (this.cy) this.cy.fit(undefined, 40);
    },
    zoomBy(f) {
      if (!this.cy) return;
      // Zoom about the CURRENT VIEWPORT centre. The old code passed
      // cy.center() as renderedPosition — but cy.center() PANS the graph and
      // returns the CORE (not a position), so x/y were undefined, the
      // zoom-about-point computed a NaN pan and the viewport silently
      // rejected it: the +/- buttons did nothing (the wheel zoom has its own
      // cytoscape handler and was never affected). Rendered coords = half
      // the stage box; jsdom has no layout → fall back to the model size.
      const stage = this.$refs.stage;
      const w = (stage && stage.clientWidth) || this.size;
      const h = (stage && stage.clientHeight) || this.size;
      this.cy.zoom({ level: this.cy.zoom() * f, renderedPosition: { x: w / 2, y: h / 2 } });
    },
    // ---- hover summary card -------------------------------------------------
    hideCard() {
      if (this.card.visible) this.card.visible = false;
    },
    // Build the summary from the concept meta the graph ALREADY holds (the
    // listing projection carries title/type/labels/summary/trust_tier/
    // chunk_count/index_status/pii_state — no extra API call) plus the link
    // map (out- + in-degree). Placed at the node's rendered position, above
    // by default, flipped below near the stage top, clamped to the stage
    // bounds so the card never overflows its rounded frame.
    showCard(node) {
      const c = this.concepts.find((x) => x && x.concept_id === node.id()) || {};
      const kind = c.is_index ? 'index' : c.index_status === 'failed' ? 'failed' : 'topic';
      const chips = [];
      if (c.type) chips.push(c.type);
      if (c.labels && c.labels[0]) chips.push(c.labels[0]);
      if (c.is_index) chips.push(this.translate('okf.graph.card.hub', 'Index hub'));
      else if (c.trust_tier) chips.push(c.trust_tier);
      const out = (this.links[c.concept_id] || []).length;
      let inc = 0;
      for (const k of Object.keys(this.links)) {
        if (k !== c.concept_id && this.links[k].some((l) => l.to_concept_id === c.concept_id)) inc++;
      }
      const meta = [this.translate('okf.graph.card.links', '{n} links').replace('{n}', String(out + inc))];
      if (c.chunk_count != null) {
        meta.push(this.translate('okf.graph.card.chunks', '{n} chunks').replace('{n}', String(c.chunk_count)));
      }
      if (c.index_status === 'failed') {
        meta.push(this.translate('okf.graph.card.failed', 'indexing failed'));
      } else if (c.index_status !== 'indexed' && !c.is_index) {
        meta.push(this.translate('okf.graph.card.pending', 'not indexed yet'));
      }
      if (c.pii_state === 'hit') {
        meta.push(this.translate('okf.graph.card.flagged', 'flagged entities'));
      }
      this.card.title = c.title || node.id();
      this.card.summary = c.summary || '';
      this.card.chips = chips;
      this.card.meta = meta;
      this.card.kind = kind;
      this.card.visible = true;
      const p = node.renderedPosition();
      const half = (node.renderedOuterWidth() || 24) / 2;
      const stageW = (this.$refs.stage && this.$refs.stage.clientWidth) || this.size;
      // Measure AFTER the card renders, then clamp the anchor point. The CSS
      // transform does the actual above/below placement off (x, y).
      this.$nextTick(() => {
        const el = this.$refs.card;
        const w = (el && el.offsetWidth) || 264;
        const h = (el && el.offsetHeight) || 132;
        this.card.below = p.y - half - 14 - h < 4;
        this.card.x = Math.min(Math.max(p.x, w / 2 + 8), Math.max(stageW - w / 2 - 8, 8));
        this.card.y = this.card.below ? p.y + half + 14 : p.y - half - 14;
      });
    }
  }
};
</script>

<style scoped>
.okf-gv {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  min-height: 0;
}
.okf-gv__empty {
  color: var(--muted);
  font-size: var(--text-sm);
  padding: var(--space-lg);
  text-align: center;
}
.okf-gv__toolbar {
  display: flex;
  gap: var(--space-xs);
  align-items: center;
}
.okf-gv__btn {
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--fg);
  border-radius: var(--radius-sm);
  min-width: 28px;
  height: 26px;
  font-size: var(--text-sm);
  line-height: 1;
  cursor: pointer;
}
.okf-gv__btn:hover {
  border-color: var(--brand);
  color: var(--brand);
}
.okf-gv__stage-wrap {
  position: relative; /* anchor for the hover card overlay */
  min-height: 0;
}
.okf-gv__stage {
  position: relative;
  height: 440px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  background: var(--surface);
}
.okf-gv__layouting {
  position: absolute;
  top: var(--space-sm);
  right: var(--space-sm);
  margin: 0;
  padding: 2px var(--space-sm);
  border-radius: var(--radius-sm);
  background: var(--accent-muted, rgba(0, 0, 0, 0.06));
  color: var(--muted);
  font-size: var(--text-xs);
  pointer-events: none;
}
/* ASYNC BUILD OVERLAY (2026-09-13): spinner + real % while the chunked
   build streams the graph in — the page never blocks, so this is the only
   feedback surface. Tokens only; fallbacks follow the file's pattern. */
.okf-gv__building {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-sm);
  background: var(--surface-muted, rgba(255, 255, 255, 0.85));
  border-radius: var(--radius-md);
  pointer-events: none; /* pure overlay — it must never eat graph clicks */
}
.okf-gv__building-label {
  margin: 0;
  color: var(--muted);
  font-size: var(--text-sm);
  font-variant-numeric: tabular-nums;
}
.okf-gv__building-bar {
  width: min(240px, 60%);
}
.okf-gv__legend {
  color: var(--muted);
  font-size: var(--text-xs);
  margin: 0;
}
/* ---- hover summary card (selected node) -------------------------------- */
.okf-gv__card {
  position: absolute;
  z-index: 3;
  pointer-events: none; /* pure overlay — the canvas keeps every interaction */
  width: 272px;
  max-width: calc(100% - 16px);
  padding: var(--space-sm) var(--space-md);
  border-radius: var(--radius-lg, 12px);
  border: 1px solid var(--border-light);
  border-top: 2px solid var(--info);
  background: var(--surface);
  box-shadow: var(--shadow-lg, 0 12px 32px rgba(9, 14, 20, 0.16));
  transform: translate(-50%, -100%);
  color: var(--fg);
}
.okf-gv__card--below {
  transform: translate(-50%, 0);
}
.okf-gv__card--index {
  border-top-color: var(--brand);
}
.okf-gv__card--failed {
  border-top-color: var(--danger);
}
.okf-gv__card::after {
  /* caret: a rotated square matching border + surface */
  content: '';
  position: absolute;
  left: 50%;
  bottom: -5.5px;
  width: 9px;
  height: 9px;
  background: var(--surface);
  border-right: 1px solid var(--border-light);
  border-bottom: 1px solid var(--border-light);
  transform: translateX(-50%) rotate(45deg);
}
.okf-gv__card--below::after {
  bottom: auto;
  top: -5.5px;
  border: none;
  border-left: 1px solid var(--border-light);
  border-top: 1px solid var(--border-light);
}
.okf-gv__card-title {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  margin: 0 0 var(--space-xs);
  font-size: var(--text-sm);
  font-weight: 600;
  line-height: 1.35;
  overflow: hidden;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}
.okf-gv__card-dot {
  flex: 0 0 auto;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--info);
}
.okf-gv__card--index .okf-gv__card-dot {
  background: var(--brand);
}
.okf-gv__card--failed .okf-gv__card-dot {
  background: var(--danger);
}
.okf-gv__card-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs);
  margin: 0 0 var(--space-xs);
}
.okf-gv__card-chip {
  padding: 1px var(--space-sm);
  border-radius: 999px;
  background: var(--accent-muted, rgba(0, 0, 0, 0.06));
  color: var(--muted);
  font-size: var(--text-xs);
  line-height: 1.5;
}
.okf-gv__card-summary {
  margin: 0 0 var(--space-xs);
  font-size: var(--text-sm);
  line-height: 1.45;
  color: var(--fg);
  overflow: hidden;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}
.okf-gv__card-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-xs);
  margin: 0;
  color: var(--muted);
  font-size: var(--text-xs);
}
.okf-gv__card-sep {
  color: var(--border);
}
.okf-gv-card-enter-active,
.okf-gv-card-leave-active {
  transition: opacity 140ms ease;
}
.okf-gv-card-enter-from,
.okf-gv-card-leave-to {
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  .okf-gv-card-enter-active,
  .okf-gv-card-leave-active {
    transition: none;
  }
}
</style>
