<!--
  DsInfoTip.vue — the ⓘ information icon (David, 2026-09-06): every domain
  term in the UI gets one, with a one-paragraph plain-language explanation
  fed from the i18n glossary (never a docs link as the first resort).
  Hover OR keyboard-focus reveals the tip; pure CSS positioning, DS tokens.
-->
<template>
  <span class="ds-infotip">
    <button
      type="button"
      class="ds-infotip__icon"
      :aria-label="label"
      @click.stop.prevent
      @focus="open = true"
      @blur="open = false"
      @mouseenter="open = true"
      @mouseleave="open = false"
    >
      ⓘ
    </button>
    <span v-if="open" class="ds-infotip__bubble" role="tooltip">{{ text }}</span>
  </span>
</template>

<script>
export default {
  name: 'DsInfoTip',
  props: {
    /** The plain-language explanation (from the i18n glossary). */
    text: { type: String, required: true },
    /** Accessible label for the icon itself (e.g. "What is Frontmatter?"). */
    label: { type: String, default: 'More information' }
  },
  data() {
    return { open: false };
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
</style>
