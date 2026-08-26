<!--
  DsStepper.vue — vertical/horizontal numbered stepper.

  Visual contract:
    - Active step uses --accent
    - Locked step uses --muted (greyed, non-clickable)
    - Complete step uses --success (connector filled + check)
    - Connector line uses --border by default, --accent for completed edges

  Emits update:modelValue only for unlocked indices (back-nav always allowed
  unless allowJumpBack=false).
-->
<template>
  <nav class="ds-stepper" :class="orientationClass" :aria-label="ariaLabel">
    <ol class="ds-stepper__list">
      <li
        v-for="(step, index) in steps"
        :key="stepKey(step, index)"
        class="ds-stepper__item"
        :class="itemClasses(index)"
      >
        <button
          type="button"
          class="ds-stepper__button"
          :disabled="isLocked(index) && !isComplete(index)"
          :aria-current="index === modelValue ? 'step' : null"
          :aria-label="stepAriaLabel(step, index)"
          @click="onClick(index)"
        >
          <span class="ds-stepper__indicator">
            <template v-if="isComplete(index)">
              <span aria-hidden="true">&#10003;</span>
            </template>
            <template v-else>{{ index + 1 }}</template>
          </span>
          <span class="ds-stepper__body">
            <span class="ds-stepper__label">
              <slot name="step-label" :step="step" :index="index" :active="index === modelValue" :locked="isLocked(index)">
                {{ step.label }}
              </slot>
              <DsPill v-if="step.optional" variant="info" class="ds-stepper__optional">optional</DsPill>
            </span>
            <span v-if="step.description" class="ds-stepper__description">{{ step.description }}</span>
          </span>
        </button>
        <span
          v-if="index < steps.length - 1"
          class="ds-stepper__connector"
          :class="{ 'ds-stepper__connector--complete': isComplete(index) && index < modelValue }"
          aria-hidden="true"
        />
      </li>
    </ol>
  </nav>
</template>

<script>
import DsPill from './Pill.vue';

export default {
  name: 'DsStepper',
  components: { DsPill },
  props: {
    steps: {
      type: Array,
      required: true,
      validator: (arr) => Array.isArray(arr) && arr.every((s) => typeof s.value !== 'undefined' && typeof s.label === 'string')
    },
    modelValue: {
      type: Number,
      required: true,
      validator: (v) => Number.isInteger(v) && v >= 0
    },
    orientation: {
      type: String,
      default: 'vertical',
      validator: (v) => ['vertical', 'horizontal'].includes(v)
    },
    locked: {
      type: Array,
      default: () => []
    },
    allowJumpBack: {
      type: Boolean,
      default: true
    },
    size: {
      type: String,
      default: 'md',
      validator: (v) => ['sm', 'md'].includes(v)
    },
    ariaLabel: {
      type: String,
      default: 'Progress steps'
    }
  },
  emits: ['update:modelValue'],
  methods: {
    stepKey(step, index) {
      return step.value != null ? step.value : `step-${index}`;
    },
    itemClasses(index) {
      return {
        'ds-stepper__item--active': index === this.modelValue,
        'ds-stepper__item--complete': this.isComplete(index),
        'ds-stepper__item--locked': this.isLocked(index),
        [`ds-stepper__item--${this.size}`]: true
      };
    },
    isLocked(index) {
      return this.locked.indexOf(index) !== -1;
    },
    isComplete(index) {
      return index < this.modelValue;
    },
    stepAriaLabel(step, index) {
      const state = this.isLocked(index)
        ? 'locked'
        : this.isComplete(index)
          ? 'complete'
          : index === this.modelValue
            ? 'current'
            : 'upcoming';
      return `Step ${index + 1}, ${step.label}, ${state}`;
    },
    onClick(index) {
      if (this.isLocked(index) && !this.isComplete(index)) return;
      if (!this.allowJumpBack && index < this.modelValue) return;
      if (index === this.modelValue) return;
      this.$emit('update:modelValue', index);
    }
  },
  computed: {
    orientationClass() {
      return `ds-stepper--${this.orientation}`;
    }
  }
};
</script>

<style scoped>
.ds-stepper {
  --ds-stepper-connector: 2px;
  --ds-stepper-indicator: 32px;
  font-family: var(--font-body);
  color: var(--fg);
}

.ds-stepper__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}

/* HORIZONTAL */
.ds-stepper--horizontal .ds-stepper__list {
  flex-direction: row;
  align-items: flex-start;
}
.ds-stepper--horizontal .ds-stepper__item {
  flex: 1 1 0;
  min-width: 0;
  position: relative;
}
.ds-stepper--horizontal .ds-stepper__button {
  align-items: center;
  text-align: center;
  flex-direction: column;
  padding: 0 var(--space-sm);
}
.ds-stepper--horizontal .ds-stepper__indicator {
  margin-bottom: var(--space-sm);
}
.ds-stepper--horizontal .ds-stepper__connector {
  position: absolute;
  top: calc(var(--ds-stepper-indicator) / 2);
  left: calc(50% + var(--ds-stepper-indicator));
  right: calc(-50% + var(--ds-stepper-indicator));
  width: auto;
  height: var(--ds-stepper-connector);
}

.ds-stepper__item {
  display: flex;
  align-items: stretch;
  position: relative;
}

.ds-stepper__button {
  display: flex;
  align-items: flex-start;
  background: none;
  border: 0;
  padding: var(--space-sm) var(--space-md);
  text-align: left;
  cursor: pointer;
  font: inherit;
  color: var(--fg);
  border-radius: var(--radius-sm);
  background-color: transparent;
  transition: background-color 0.12s ease;
  width: 100%;
  gap: var(--space-md);
}
.ds-stepper__button:hover:not(:disabled) {
  background-color: var(--accent-muted);
}
.ds-stepper__button:disabled {
  cursor: not-allowed;
}

.ds-stepper__indicator {
  flex: 0 0 var(--ds-stepper-indicator);
  width: var(--ds-stepper-indicator);
  height: var(--ds-stepper-indicator);
  border-radius: 50%;
  background: var(--surface);
  border: 2px solid var(--border);
  color: var(--muted);
  font-weight: 600;
  font-size: var(--text-sm);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.ds-stepper__item--complete .ds-stepper__indicator {
  background: var(--success-bg);
  border-color: var(--success);
  color: var(--success);
}
.ds-stepper__item--active .ds-stepper__indicator {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--accent-fg);
}
.ds-stepper__item--locked .ds-stepper__indicator {
  background: var(--surface);
  border-color: var(--border-light);
  color: var(--muted);
}

.ds-stepper__body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.ds-stepper__label {
  font-size: var(--text-sm);
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
}
.ds-stepper__item--active .ds-stepper__label {
  color: var(--accent);
}
.ds-stepper__item--locked .ds-stepper__label {
  color: var(--muted);
}

.ds-stepper__description {
  font-size: var(--text-xs);
  color: var(--muted);
}
.ds-stepper__item--locked .ds-stepper__description {
  opacity: 0.7;
}

.ds-stepper__connector {
  display: block;
  width: var(--ds-stepper-connector);
  align-self: center;
  margin-left: calc(var(--space-md) + var(--ds-stepper-indicator) / 2 - var(--ds-stepper-connector) / 2);
  background: var(--border);
  flex: 0 0 var(--space-lg);
  height: var(--space-lg);
}
.ds-stepper--horizontal .ds-stepper__connector {
  flex: 0 0 auto;
}

.ds-stepper__connector--complete {
  background: var(--success);
}

.ds-stepper__item--sm .ds-stepper__indicator {
  --ds-stepper-indicator: 24px;
  font-size: var(--text-xs);
}
.ds-stepper__item--sm .ds-stepper__button {
  padding: var(--space-xs) var(--space-sm);
}
</style>
