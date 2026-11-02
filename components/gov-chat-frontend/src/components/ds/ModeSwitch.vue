<!--
  DsModeSwitch.vue — two-button Basic | Expert toggle.
  Per-admin persistence in localStorage; emits update:mode.
  Renders aria-label="Mode" + a small [?] help button → modal.
-->
<template>
  <div class="ds-mode-switch" role="group" aria-label="Mode">
    <button
      type="button"
      class="ds-mode-switch__btn"
      :class="{ 'ds-mode-switch__btn--active': mode === 'basic' }"
      :aria-pressed="mode === 'basic'"
      @click="set('basic')"
    >
      {{ basicLabel }}
    </button>
    <button
      type="button"
      class="ds-mode-switch__btn"
      :class="{ 'ds-mode-switch__btn--active': mode === 'expert' }"
      :aria-pressed="mode === 'expert'"
      @click="set('expert')"
    >
      {{ expertLabel }}
    </button>
    <button type="button" class="ds-mode-switch__help" :aria-label="helpAriaLabel" @click="$emit('help')">?</button>
  </div>
</template>

<script>
const STORAGE_KEY = 'okf.studio.expertMode';

export default {
  name: 'DsModeSwitch',
  props: {
    modelValue: { type: String, default: null, validator: (v) => v === null || ['basic', 'expert'].includes(v) },
    basicLabel: { type: String, default: 'Basic' },
    expertLabel: { type: String, default: 'Expert' },
    helpAriaLabel: { type: String, default: 'What is expert mode?' }
  },
  emits: ['update:modelValue', 'help'],
  data() {
    return { localMode: this.modelValue || this.readStorage() || 'basic' };
  },
  watch: {
    modelValue(v) {
      if (v && v !== this.localMode) this.localMode = v;
    },
    localMode(v) {
      this.writeStorage(v);
    }
  },
  methods: {
    readStorage() {
      try {
        return window.localStorage.getItem(STORAGE_KEY) === 'expert' ? 'expert' : 'basic';
      } catch {
        return null;
      }
    },
    writeStorage(v) {
      try {
        window.localStorage.setItem(STORAGE_KEY, v);
      } catch {
        /* private mode — ignore */
      }
    },
    set(v) {
      if (v === this.localMode) return;
      this.localMode = v;
      this.$emit('update:modelValue', v);
    }
  }
};
</script>

<style scoped>
.ds-mode-switch {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 100px;
  padding: 2px;
  font-family: var(--font-body);
  font-size: var(--text-xs);
}
.ds-mode-switch__btn {
  border: 0;
  background: transparent;
  color: var(--muted);
  padding: 4px 12px;
  border-radius: 100px;
  cursor: pointer;
  font: inherit;
  font-weight: 500;
}
.ds-mode-switch__btn--active {
  background: var(--surface);
  color: var(--accent);
  box-shadow: var(--shadow-sm);
}
.ds-mode-switch__help {
  border: 0;
  background: transparent;
  color: var(--muted);
  cursor: pointer;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  font-weight: 700;
  margin-left: 4px;
}
.ds-mode-switch__help:hover {
  background: var(--accent-muted);
  color: var(--accent);
}
</style>
