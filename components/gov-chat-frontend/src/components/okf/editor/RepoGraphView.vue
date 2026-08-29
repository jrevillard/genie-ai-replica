<!--
  OkfRepoGraphView.vue - Story #978 linked-graph view of an OKF repository.

  The knowledge-graph half of the visualization pair (file tree = structure,
  this = meaning): every concept is a node, every author link (frontmatter
  links[] -> to_concept_id, served by the bundle manifest) is an edge.
  index.md sits at the CENTER; concepts on a ring. Dependency-free SVG -
  OKF concept graphs are small (tens of nodes), so a deterministic circular
  layout beats pulling in a force-layout library.

  Click a node -> emits 'select' (opens that file in the editor).
-->
<template>
  <div class="okf-gv">
    <p v-if="nodes.length === 0" class="okf-gv__empty">
      {{ translate('okf.graph.empty', 'No concepts yet - nothing to graph.') }}
    </p>
    <template v-else>
      <svg
        class="okf-gv__svg"
        :viewBox="`0 0 ${size} ${size}`"
        role="img"
        :aria-label="translate('okf.graph.aria', 'Concept graph')"
      >
        <!-- edges first (under the nodes) -->
        <path
          v-for="e in edges"
          :key="e.key"
          class="okf-gv__edge"
          :class="{ 'okf-gv__edge--hot': e.hot }"
          :d="e.path"
        />
        <g
          v-for="n in nodes"
          :key="n.id"
          class="okf-gv__node"
          :class="[`okf-gv__node--${n.kind}`, { 'okf-gv__node--hot': n.hot }]"
          :transform="`translate(${n.x},${n.y})`"
          @click="$emit('select', n.id)"
        >
          <circle :r="n.is_index ? 26 : 16" />
          <text :y="n.is_index ? 4 : 3">{{ n.short }}</text>
          <title>{{ n.title }} ({{ n.type || 'topic' }}){{ n.label ? ' - ' + n.label : '' }}</title>
        </g>
      </svg>
      <p class="okf-gv__legend">
        {{ translate('okf.graph.legend', 'index') }} = center · {{ nodes.length - 1 }}
        {{ translate('okf.graph.concepts', 'concepts') }} · {{ edges.length }}
        {{ translate('okf.graph.links', 'links') }}
      </p>
    </template>
  </div>
</template>

<script>
import translateMixin from '../../../mixins/translateMixin';
import repoOkfService from '../../../services/repoOkfService';

export default {
  name: 'OkfRepoGraphView',
  mixins: [translateMixin],
  props: {
    repoId: { type: String, required: true },
    concepts: { type: Array, default: () => [] },
    selectedId: { type: String, default: null }
  },
  emits: ['select'],
  data() {
    return {
      size: 640,
      links: {} // concept_id -> [{ to_concept_id, label }]
    };
  },
  computed: {
    nodes() {
      const c = this.size / 2;
      const ring = this.concepts.filter((x) => !x.is_index);
      const radius = this.size * 0.38;
      return this.concepts.map((x, i) => {
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
          const key = `${n.id}->${to}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const a = this.byId.get(n.id);
          const b = this.byId.get(to);
          out.push({ key, hot: n.id === this.selectedId || to === this.selectedId, path: this.arc(a, b) });
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
    }
  },
  methods: {
    shorten(s, max) {
      const t = String(s || '');
      return t.length > max ? t.slice(0, max - 1) + '…' : t;
    },
    arc(a, b) {
      // Slight curvature so reciprocal links don't overlap.
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
      try {
        // The settled bundle manifest carries each concept's links[] (the
        // author-stated structural edges). Tolerates a not-yet-settled bundle.
        const m = await repoOkfService.getManifest(this.repoId);
        if (Array.isArray(m && m.concepts)) {
          const map = {};
          for (const c of m.concepts) {
            if (c && c.concept_id && Array.isArray(c.links)) map[c.concept_id] = c.links;
          }
          this.links = map;
        }
      } catch {
        this.links = {}; // manifest not settled — nodes still render, no edges
      }
    }
  }
};
</script>

<style scoped>
.okf-gv {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-sm);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: var(--space-md);
  min-height: 480px;
}
.okf-gv__svg {
  width: 100%;
  max-width: 720px;
  height: auto;
}
.okf-gv__empty {
  color: var(--muted);
  padding: var(--space-xl) 0;
  margin: 0;
}
.okf-gv__edge {
  fill: none;
  stroke: var(--border);
  stroke-width: 1.5;
}
.okf-gv__edge--hot {
  stroke: var(--accent);
  stroke-width: 2.5;
}
.okf-gv__node {
  cursor: pointer;
}
.okf-gv__node circle {
  fill: var(--accent-muted);
  stroke: var(--accent);
  stroke-width: 1.5;
}
.okf-gv__node--index circle {
  fill: var(--accent);
  stroke: var(--accent-hover);
}
.okf-gv__node--failed circle {
  fill: var(--danger-bg);
  stroke: var(--danger);
}
.okf-gv__node--hot circle {
  stroke-width: 3;
}
.okf-gv__node text {
  text-anchor: middle;
  dominant-baseline: middle;
  font-size: 9px;
  fill: var(--fg);
  pointer-events: none;
}
.okf-gv__node--index text {
  fill: var(--accent-fg);
  font-weight: 700;
}
.okf-gv__legend {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--muted);
}
</style>
