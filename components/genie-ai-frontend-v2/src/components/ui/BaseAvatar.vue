<script setup lang="ts">
import { computed, ref, watch } from 'vue';

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

const loaded = ref(false);
const errored = ref(false);
watch(
  () => props.src,
  () => {
    loaded.value = false;
    errored.value = false;
  }
);
</script>

<template>
  <span class="relative inline-flex shrink-0">
    <span
      :class="[
        'relative inline-flex items-center justify-center overflow-hidden rounded-full bg-slate-200 font-semibold text-slate-600',
        sizeClass,
      ]"
    >
      <template v-if="src && !errored">
        <span
          v-if="!loaded"
          class="absolute inset-0 avatar-shimmer"
          aria-hidden="true"
        />
        <img
          :src="src"
          :alt="name ?? ''"
          class="h-full w-full object-cover transition-opacity duration-200"
          :class="loaded ? 'opacity-100' : 'opacity-0'"
          @load="loaded = true"
          @error="errored = true"
        />
      </template>
      <template v-else>{{ initials || '?' }}</template>
    </span>
    <span
      v-if="badge"
      class="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full ring-2 ring-white"
      :class="badge === 'online' ? 'bg-ieee-700' : 'bg-slate-400'"
    />
  </span>
</template>

<style scoped>
.avatar-shimmer {
  background: linear-gradient(
    90deg,
    rgba(226, 232, 240, 0.6) 0%,
    rgba(241, 245, 249, 0.95) 50%,
    rgba(226, 232, 240, 0.6) 100%
  );
  background-size: 200% 100%;
  animation: avatar-shimmer 1.2s linear infinite;
}
@keyframes avatar-shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
</style>
