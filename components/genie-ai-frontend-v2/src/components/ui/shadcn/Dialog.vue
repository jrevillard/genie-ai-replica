<script setup lang="ts">
import { watch } from 'vue';
import type { ClassValue } from 'clsx';
import { cn } from '../../../lib/classnames';

const props = withDefaults(
  defineProps<{
    open: boolean;
    contentClass?: ClassValue;
  }>(),
  {}
);

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
}>();

watch(
  () => props.open,
  (open) => {
    if (typeof document !== 'undefined') document.body.style.overflow = open ? 'hidden' : '';
  }
);
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/50 p-4">
      <button class="absolute inset-0 cursor-default" aria-label="Close dialog" @click="$emit('update:open', false)" />
      <section :class="cn('relative z-10 w-full rounded-xl border border-neutral-300 bg-neutral-50 text-neutral-950 shadow-2xl', props.contentClass)">
        <button
          type="button"
          class="absolute right-5 top-5 z-10 grid h-9 w-9 place-items-center rounded-full bg-neutral-100 text-neutral-700 transition hover:bg-neutral-200 hover:text-neutral-950"
          aria-label="Close dialog"
          @click="$emit('update:open', false)"
        >
          <span class="text-2xl leading-none">&times;</span>
        </button>
        <slot />
      </section>
    </div>
  </Teleport>
</template>
