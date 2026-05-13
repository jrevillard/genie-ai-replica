<template>
  <div class="ds-combobox" :class="{ 'ds-combobox--sm': size === 'sm', 'ds-combobox--lg': size === 'lg' }">
    <div ref="wrapper" class="ds-combobox__wrapper">
      <DsInput
        v-if="isOpen"
        ref="searchInput"
        v-model="searchTerm"
        :placeholder="searchPlaceholder"
        :size="size"
        @input="filter"
        @blur="handleBlur"
        @keydown.down.prevent="navigate(1)"
        @keydown.up.prevent="navigate(-1)"
        @keydown.enter="selectActive"
        @keydown.esc="close"
      />
      <div
        v-else
        class="ds-combobox__trigger"
        :class="{ 'ds-combobox__trigger--disabled': disabled, 'ds-combobox__trigger--placeholder': !displayText }"
        @click="open"
      >
        <span>{{ displayText || placeholder }}</span>
      </div>
      <div v-if="isOpen" class="ds-combobox__list">
        <div
          v-for="(option, i) in filtered"
          :key="i"
          class="ds-combobox__option"
          :class="{ active: i === activeIndex }"
          @mousedown.prevent="select(option)"
          @mouseenter="activeIndex = i"
        >
          {{ getLabel(option) }}
        </div>
        <div v-if="filtered.length === 0" class="ds-combobox__empty">
          {{ noResultsText }}
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import DsInput from './Input.vue';

export default {
  name: 'DsCombobox',
  components: { DsInput },
  inheritAttrs: false,
  props: {
    modelValue: {
      type: [String, Number],
      default: ''
    },
    options: {
      type: Array,
      default: () => []
    },
    optionLabel: {
      type: String,
      default: 'label'
    },
    optionValue: {
      type: String,
      default: 'value'
    },
    placeholder: {
      type: String,
      default: ''
    },
    searchPlaceholder: {
      type: String,
      default: 'Search...'
    },
    noResultsText: {
      type: String,
      default: 'No results'
    },
    disabled: {
      type: Boolean,
      default: false
    },
    size: {
      type: String,
      default: 'md',
      validator: (v) => ['sm', 'md', 'lg'].includes(v)
    }
  },
  emits: ['update:modelValue', 'focus', 'blur'],
  data() {
    return {
      isOpen: false,
      searchTerm: '',
      activeIndex: -1
    };
  },
  computed: {
    filtered() {
      if (!this.searchTerm) return this.options;
      const term = this.searchTerm.toLowerCase();
      return this.options.filter((o) => this.getLabel(o).toLowerCase().includes(term));
    },
    displayText() {
      if (!this.modelValue && this.modelValue !== 0) return '';
      const match = this.options.find((o) => this.getValue(o) === this.modelValue);
      return match ? this.getLabel(match) : String(this.modelValue);
    }
  },
  methods: {
    getLabel(option) {
      return typeof option === 'string' ? option : option[this.optionLabel] || '';
    },
    getValue(option) {
      return typeof option === 'string' ? option : option[this.optionValue];
    },
    open() {
      if (this.disabled) return;
      this.isOpen = true;
      this.activeIndex = -1;
      this.$nextTick(() => {
        this.$refs.searchInput?.focus();
      });
    },
    close() {
      this.isOpen = false;
      this.searchTerm = '';
      this.activeIndex = -1;
    },
    filter() {
      this.activeIndex = -1;
    },
    navigate(dir) {
      if (this.filtered.length === 0) return;
      this.activeIndex = (this.activeIndex + dir + this.filtered.length) % this.filtered.length;
    },
    selectActive() {
      if (this.activeIndex >= 0 && this.activeIndex < this.filtered.length) {
        this.select(this.filtered[this.activeIndex]);
      }
    },
    select(option) {
      this.$emit('update:modelValue', this.getValue(option));
      this.close();
    },
    handleBlur(e) {
      setTimeout(() => {
        if (this.$refs.wrapper?.contains(document.activeElement)) return;
        this.close();
        this.$emit('blur', e);
      }, 150);
    },
    focus() {
      if (!this.isOpen) this.open();
      else this.$refs.searchInput?.focus();
    }
  }
};
</script>

<style scoped>
.ds-combobox__wrapper {
  position: relative;
  width: 100%;
}

.ds-combobox__trigger {
  font-family: var(--font-body);
  font-size: var(--text-base);
  padding: 8px 12px;
  padding-right: 28px;
  border: 1px solid var(--ds-combobox-border-color, var(--border));
  border-radius: var(--radius-md);
  background-color: var(--ds-combobox-bg, var(--surface));
  color: var(--ds-combobox-color, var(--fg));
  cursor: pointer;
  width: 100%;
  box-sizing: border-box;
  position: relative;
  min-height: 38px;
  display: flex;
  align-items: center;
}

.ds-combobox__trigger::after {
  content: '';
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  width: 0;
  height: 0;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
  border-top: 5px solid currentColor;
  pointer-events: none;
}

.ds-combobox__trigger--placeholder {
  color: var(--muted);
}

.ds-combobox__trigger--disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.ds-combobox__trigger:not(.ds-combobox__trigger--disabled):hover {
  border-color: var(--accent);
}

.ds-combobox__list {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  max-height: var(--ds-combobox-list-max-height, 200px);
  overflow-y: auto;
  background-color: var(--surface);
  border: 1px solid var(--border);
  border-top: none;
  border-radius: 0 0 var(--radius-md) var(--radius-md);
  box-shadow: var(--shadow-md);
  z-index: 1000;
}

.ds-combobox__option {
  padding: var(--space-sm);
  cursor: pointer;
  font-family: var(--font-body);
  font-size: var(--text-base);
  color: var(--fg);
}

.ds-combobox__option:hover,
.ds-combobox__option.active {
  background-color: var(--accent);
  color: var(--accent-fg);
}

.ds-combobox__empty {
  padding: var(--space-sm);
  text-align: center;
  color: var(--muted);
  font-style: italic;
}

.ds-combobox--sm .ds-combobox__trigger {
  font-size: var(--text-sm);
  padding: 4px 8px;
  padding-right: 28px;
  min-height: 30px;
}

.ds-combobox--sm .ds-combobox__option {
  font-size: var(--text-sm);
}

.ds-combobox--lg .ds-combobox__trigger {
  font-size: var(--text-md);
  padding: 12px 16px;
  padding-right: 32px;
  min-height: 46px;
}

.ds-combobox--lg .ds-combobox__option {
  font-size: var(--text-md);
}
</style>
