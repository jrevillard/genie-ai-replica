<!--
  DsInfoTip.vue — the ⓘ information icon (David, 2026-09-06): every domain
  term in the UI gets one, with a one-paragraph plain-language explanation
  fed from the i18n glossary (never a docs link as the first resort). An
  optional href adds a "read more" link INSIDE the bubble — after the
  explanation, never instead of it.
  Hover OR keyboard-focus reveals the tip. The hover region is the WHOLE
  component (icon + bubble), so a link inside the bubble is reachable — the
  original button-only hover closed the bubble the moment the pointer moved
  toward the link (live finding, 2026-10-18). Click toggles a pinned state
  for touch/pointer-free use; a mousedown anywhere else unpins.
-->
<template>
  <span class="ds-infotip" @mouseenter="hovered = true" @mouseleave="hovered = false">
    <button
      type="button"
      class="ds-infotip__icon"
      :aria-label="label"
      :aria-expanded="open ? 'true' : 'false'"
      @click.stop.prevent="toggle"
      @focus="focused = true"
      @blur="focused = false"
      @keydown.escape="pinned = false"
    >
      ⓘ
    </button>
    <span v-if="open" class="ds-infotip__bubble" role="tooltip" @mousedown.stop @click.stop>
      {{ text }}
      <a v-if="href" class="ds-infotip__link" :href="href" target="_blank" rel="noopener noreferrer">{{
        linkLabel || href
      }}</a>
    </span>
  </span>
</template>

<script>
export default {
  name: 'DsInfoTip',
  props: {
    /** The plain-language explanation (from the i18n glossary). */
    text: { type: String, required: true },
    /** Accessible label for the icon itself (e.g. "What is Frontmatter?"). */
    label: { type: String, default: 'More information' },
    /** Optional "read more" link rendered inside the bubble, after the text. */
    href: { type: String, default: '' },
    /** Anchor text for the href link (defaults to the raw URL). */
    linkLabel: { type: String, default: '' }
  },
  data() {
    return { hovered: false, focused: false, pinned: false };
  },
  computed: {
    open() {
      return this.hovered || this.focused || this.pinned;
    }
  },
  mounted() {
    this._onDocMouseDown = (e) => {
      if (this.pinned && !this.$el.contains(e.target)) this.pinned = false;
    };
    document.addEventListener('mousedown', this._onDocMouseDown);
  },
  beforeUnmount() {
    document.removeEventListener('mousedown', this._onDocMouseDown);
  },
  methods: {
    toggle() {
      this.pinned = !this.pinned;
    }
  }
};
</script>

<style scoped>
.ds-infotip {
  position: relative;
  display: inline-flex;
  align-items: center;
}
.ds-infotip__icon {
  border: 0;
  background: transparent;
  color: var(--muted);
  cursor: help;
  font: inherit;
  font-size: var(--text-sm);
  padding: 0 var(--space-xs);
  line-height: 1;
}
.ds-infotip__icon:hover,
.ds-infotip__icon:focus {
  color: var(--accent);
}
.ds-infotip__bubble {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  width: 300px;
  padding: var(--space-sm);
  background: var(--surface);
  color: var(--fg);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  font-size: var(--text-xs);
  font-weight: 400;
  line-height: 1.5;
  z-index: 30;
  white-space: normal;
  text-align: left;
}
.ds-infotip__link {
  display: block;
  margin-top: var(--space-xs);
  color: var(--accent);
  text-decoration: underline;
}
</style>
