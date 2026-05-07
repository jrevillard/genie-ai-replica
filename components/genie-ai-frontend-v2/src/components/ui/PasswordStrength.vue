<script setup lang="ts">
import { computed } from 'vue';
import { useT } from '../../i18n/composables';

const props = defineProps<{
  password: string;
}>();

const { t } = useT();

interface Rule {
  key: 'length' | 'upper' | 'number';
  label: string;
  passed: boolean;
}

const rules = computed<Rule[]>(() => {
  const p = props.password ?? '';
  return [
    {
      key: 'length',
      label: t('auth.password.rules.length', 'At least 8 characters'),
      passed: p.length >= 8,
    },
    {
      key: 'upper',
      label: t('auth.password.rules.upper', 'One uppercase letter'),
      passed: /[A-Z]/.test(p),
    },
    {
      key: 'number',
      label: t('auth.password.rules.number', 'One number or symbol'),
      passed: /[0-9!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(p),
    },
  ];
});

const passedCount = computed(() => rules.value.filter((r) => r.passed).length);

// Hide everything until the user starts typing — avoids a noisy red block on
// first paint.
const show = computed(() => (props.password ?? '').length > 0);

interface Strength {
  label: string;
  /** Tailwind background colour for the active bar segments. */
  barClass: string;
  /** Tailwind text colour for the strength label. */
  textClass: string;
}

const strength = computed<Strength>(() => {
  if (passedCount.value <= 1) {
    return {
      label: t('auth.password.weak', 'Weak'),
      barClass: 'bg-red-500',
      textClass: 'text-red-600',
    };
  }
  if (passedCount.value === 2) {
    return {
      label: t('auth.password.medium', 'Medium'),
      barClass: 'bg-amber-500',
      textClass: 'text-amber-600',
    };
  }
  return {
    label: t('auth.password.strong', 'Strong'),
    barClass: 'bg-emerald-500',
    textClass: 'text-emerald-600',
  };
});
</script>

<template>
  <Transition
    enter-active-class="transition duration-200 ease-out"
    enter-from-class="opacity-0 -translate-y-1"
    enter-to-class="opacity-100 translate-y-0"
    leave-active-class="transition duration-150 ease-in"
    leave-from-class="opacity-100"
    leave-to-class="opacity-0"
  >
    <div v-if="show" class="space-y-2.5">
      <!-- Bar + strength label on one row -->
      <div class="flex items-center gap-3">
        <div class="flex flex-1 gap-1">
          <span
            v-for="i in 3"
            :key="i"
            class="h-1 flex-1 rounded-full transition-colors duration-300 ease-out"
            :class="i <= passedCount ? strength.barClass : 'bg-slate-200'"
          />
        </div>
        <span
          class="shrink-0 text-meta font-semibold transition-colors duration-300"
          :class="strength.textClass"
        >
          {{ strength.label }}
        </span>
      </div>

      <!-- Rule list — tighter, animated tick / dot -->
      <ul class="grid grid-cols-1 gap-1 text-meta sm:grid-cols-2">
        <li
          v-for="rule in rules"
          :key="rule.key"
          class="flex items-center gap-2 transition-colors duration-200"
          :class="rule.passed ? 'text-emerald-600' : 'text-slate-400'"
        >
          <span
            class="grid h-4 w-4 shrink-0 place-items-center rounded-full transition-colors duration-200"
            :class="rule.passed ? 'bg-emerald-500/15' : 'bg-slate-100'"
            aria-hidden="true"
          >
            <svg
              v-if="rule.passed"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              stroke-width="2.4"
              class="h-2.5 w-2.5 text-emerald-600"
            >
              <path stroke-linecap="round" stroke-linejoin="round" d="m4 8 2.5 2.5L12 5" />
            </svg>
            <span v-else class="h-1 w-1 rounded-full bg-slate-400" />
          </span>
          <span>{{ rule.label }}</span>
        </li>
      </ul>
    </div>
  </Transition>
</template>
