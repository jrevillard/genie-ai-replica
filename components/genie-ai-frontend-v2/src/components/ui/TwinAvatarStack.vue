<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useAiTwinsStore } from '../../stores/aiTwins';
import type { AiTwin } from '../../services/aiTwins';

// Overlapping-avatar group for the AI Twins linked to a knowledge file.
// Shows up to `max` (default 3) avatars; any extras roll up into a "+N" chip.
// Twin metadata is resolved from the cached `aiTwinsStore.twins` list — the
// caller is responsible for triggering `aiTwinsStore.fetchAll()` somewhere
// upstream (the Knowledge Set page already does).
//
// Renders avatars inline (rather than wrapping BaseAvatar) so we control
// the exact box dimensions and the border ring sits flush around each
// circle — the previous BaseAvatar-wrapped version produced uneven outlines
// because the ring was drawn on a slightly-different-sized inline span.

const props = withDefaults(
  defineProps<{
    twinIds: string[] | null | undefined;
    max?: number;
  }>(),
  { max: 3 }
);

const aiTwinsStore = useAiTwinsStore();
const { twins } = storeToRefs(aiTwinsStore);

const twinById = computed<Map<string, AiTwin>>(() => {
  const map = new Map<string, AiTwin>();
  for (const t of twins.value) {
    if (t?._key) map.set(t._key, t);
  }
  return map;
});

const ids = computed<string[]>(() => (Array.isArray(props.twinIds) ? props.twinIds : []));

const visible = computed<Array<{ id: string; twin: AiTwin | null }>>(() =>
  ids.value.slice(0, props.max).map((id) => ({ id, twin: twinById.value.get(id) ?? null }))
);

const overflow = computed<number>(() => Math.max(0, ids.value.length - props.max));

function initialsFor(name: string | null | undefined): string {
  if (!name) return '?';
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase() || '?';
}

// Track image load errors per twin id so the fallback initials show when a
// profile picture URL 404s instead of rendering a broken-image glyph.
const erroredIds = ref<Set<string>>(new Set());
watch(visible, () => {
  // Reset error state when the visible set changes so a fresh URL is given a
  // chance to load.
  erroredIds.value = new Set();
});
function onImgError(id: string): void {
  if (!erroredIds.value.has(id)) {
    const next = new Set(erroredIds.value);
    next.add(id);
    erroredIds.value = next;
  }
}
</script>

<template>
  <div v-if="ids.length" class="inline-flex items-center -space-x-1.5">
    <span
      v-for="entry in visible"
      :key="entry.id"
      class="relative inline-flex h-7 w-7 items-center justify-center overflow-hidden rounded-full border-2 border-surface bg-slate-200 text-[10px] font-semibold text-slate-600 shadow-sm"
      :title="entry.twin?.name ?? entry.id"
    >
      <img
        v-if="entry.twin?.profilePicUrl && !erroredIds.has(entry.id)"
        :src="entry.twin.profilePicUrl"
        :alt="entry.twin?.name ?? ''"
        class="h-full w-full object-cover"
        @error="onImgError(entry.id)"
      />
      <span v-else>{{ initialsFor(entry.twin?.name) }}</span>
    </span>
    <span
      v-if="overflow > 0"
      class="inline-flex h-7 min-w-[1.75rem] items-center justify-center rounded-full border-2 border-surface bg-slate-100 px-1.5 text-[10px] font-semibold text-text-muted shadow-sm"
      :title="`+${overflow} more`"
    >
      +{{ overflow }}
    </span>
  </div>
</template>
