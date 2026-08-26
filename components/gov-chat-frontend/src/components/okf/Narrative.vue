<!--
  OkfNarrative.vue — first-encounter narrative card for a given concept key.
  Interspersed throughout the wizard + entry points to teach OKF intent.
  Collapses to [What is this?] after first dismissal per (admin, kind).
  Renders the narrative text from okf.narrative.* i18n keys.
-->
<template>
  <aside class="okf-narrative" role="note" v-if="visible">
    <p class="okf-narrative__text">{{ translated }}</p>
    <button type="button" class="okf-narrative__hide" @click="dismiss">{{ hideLabel }}</button>
  </aside>
  <button
    v-else-if="canShowCollapsed"
    type="button"
    class="okf-narrative__collapsed"
    @click="reopen"
  >{{ whatIsThisLabel }}</button>
</template>

<script>
const STORAGE_KEY = 'okf.studio.seenNarratives';

export default {
  name: 'OkfNarrative',
  props: {
    kind: { type: String, required: true },
    text: { type: String, default: null }
  },
  data() {
    return { dismissed: this.readSeen().indexOf(this.kind) !== -1 };
  },
  computed: {
    visible() {
      return !this.dismissed;
    },
    translated() {
      if (this.text) return this.text;
      return this.$t ? this.$t(`okf.narrative.${this.kind}`, '') : '';
    },
    hideLabel() {
      return this.$t ? this.$t('okf.narrative.hide', 'Hide') : 'Hide';
    },
    whatIsThisLabel() {
      return this.$t ? this.$t('okf.narrative.whatIsThis', 'What is this?') : 'What is this?';
    },
    canShowCollapsed() {
      // Only offer the reopen if we have narrative text to show.
      return !!this.translated;
    }
  },
  methods: {
    readSeen() {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr : [];
      } catch {
        return [];
      }
    },
    writeSeen(arr) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
      } catch {
        /* private mode — ignore */
      }
    },
    dismiss() {
      const arr = this.readSeen();
      if (arr.indexOf(this.kind) === -1) arr.push(this.kind);
      this.writeSeen(arr);
      this.dismissed = true;
    },
    reopen() {
      const arr = this.readSeen().filter((k) => k !== this.kind);
      this.writeSeen(arr);
      this.dismissed = false;
    }
  }
};
</script>

<style scoped>
.okf-narrative {
  background: color-mix(in srgb, var(--accent-muted) 70%, var(--surface));
  border-left: 3px solid var(--accent);
  border-radius: var(--radius-sm);
  padding: var(--space-md);
  margin: 0 0 var(--space-md) 0;
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: var(--space-md);
  font-family: var(--font-body);
}
.okf-narrative__text {
  margin: 0;
  color: var(--fg);
  font-size: var(--text-sm);
  line-height: 1.5;
}
.okf-narrative__hide {
  border: 0;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  font-size: var(--text-xs);
  flex-shrink: 0;
  text-decoration: underline;
}
.okf-narrative__hide:hover { color: var(--fg); }

.okf-narrative__collapsed {
  border: 0;
  background: transparent;
  color: var(--muted);
  font: inherit;
  font-size: var(--text-xs);
  text-decoration: underline;
  cursor: pointer;
  margin-bottom: var(--space-md);
  display: inline-block;
}
.okf-narrative__collapsed:hover { color: var(--accent); }
</style>
