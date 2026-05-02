<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(
  defineProps<{
    src?: string | null;
    name?: string;
    size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
    badge?: 'online' | 'offline' | null;
  }>(),
  { size: 'md' }
);

const sizeClass = computed(
  () =>
    ({
      xs: 'h-6 w-6 text-[10px]',
      sm: 'h-8 w-8 text-xs',
      md: 'h-10 w-10 text-sm',
      lg: 'h-14 w-14 text-base',
      xl: 'h-20 w-20 text-lg',
    })[props.size]
);

const initials = computed(() => {
  if (!props.name) return '';
  return props.name
    .split(' ')
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
});
</script>

<template>
  <span class="relative inline-flex shrink-0">
    <span
      :class="[
        'inline-flex items-center justify-center overflow-hidden rounded-full bg-slate-200 font-semibold text-slate-600',
        sizeClass,
      ]"
    >
      <img v-if="src" :src="src" :alt="name ?? ''" class="h-full w-full object-cover" />
      <template v-else>{{ initials || '?' }}</template>
    </span>
    <span
      v-if="badge"
      class="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full ring-2 ring-white"
      :class="badge === 'online' ? 'bg-emerald-500' : 'bg-slate-400'"
    />
  </span>
</template>
