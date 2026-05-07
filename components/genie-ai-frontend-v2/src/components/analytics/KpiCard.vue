<script setup lang="ts">
import Icon from '../ui/Icon.vue';

defineProps<{
  label: string;
  value: string;
  hint?: string;
  icon: unknown;
  iconBg: string;
  iconColor: string;
}>();
</script>

<template>
  <article class="rounded-2xl border border-border-subtle bg-surface p-5">
    <div class="flex items-center gap-4">
      <span
        :class="[
          'inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl',
          iconBg,
          iconColor,
        ]"
        aria-hidden="true"
      >
        <Icon :icon="icon" :size="24" />
      </span>
      <div class="min-w-0 flex-1">
        <p class="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-subtle">
          {{ label }}
        </p>
        <p
          class="mt-1 text-3xl font-bold leading-none tabular-nums text-text"
          :title="value"
        >
          {{ value }}
        </p>
        <p v-if="hint" class="mt-1 text-meta text-text-subtle">{{ hint }}</p>
      </div>
    </div>
  </article>
</template>
