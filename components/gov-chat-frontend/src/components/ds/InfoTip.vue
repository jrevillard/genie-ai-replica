<!--
  DsInfoTip.vue — the ⓘ information icon (David, 2026-09-06): every domain
  term in the UI gets one, with a one-paragraph plain-language explanation
  fed from the i18n glossary (never a docs link as the first resort). An
  optional href adds a "read more" link INSIDE the bubble — after the
  explanation, never instead of it.
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
    <span v-if="open" class="ds-infotip__bubble" role="tooltip">
      {{ text }}
      <a v-if="href" class="ds-infotip__link" :href="href" target="_blank" rel="noopener noreferrer" @click.stop>{{
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
.ds-infotip__link {
  display: block;
  margin-top: var(--space-xs);
  color: var(--accent);
  text-decoration: underline;
}
</style>
