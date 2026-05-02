<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import BaseAvatar from '../ui/BaseAvatar.vue';
import BaseButton from '../ui/BaseButton.vue';
import type { AiTwin } from '../../services/aiTwins';

const props = defineProps<{
  twin: AiTwin;
}>();

const router = useRouter();

const dateEdited = computed(() => formatDate(props.twin.updatedAt));
const dateCreated = computed(() => formatDate(props.twin.createdAt));

function formatDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function open() {
  router.push({ name: 'ai-twin-detail', params: { id: props.twin._key } });
}
</script>

<template>
  <article
    class="flex flex-col gap-4 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm transition hover:border-ieee-200 hover:shadow-md"
  >
    <!-- Header: avatar + name -->
    <header class="flex items-center gap-3">
      <BaseAvatar :src="twin.profilePicUrl ?? ''" :name="twin.name" size="lg" />
      <h3 class="truncate text-base font-semibold text-slate-900">{{ twin.name }}</h3>
    </header>

    <!-- Date Edited row, divided top + bottom from the rest of the card -->
    <div class="flex items-center justify-between border-y border-slate-100 py-3">
      <span class="text-xs font-medium text-slate-500">Date Edited</span>
      <span class="text-xs text-slate-700">{{ dateEdited }}</span>
    </div>

    <!-- Stats panel — its own bordered/rounded subcard -->
    <dl class="grid grid-cols-2 gap-x-6 gap-y-3 rounded-2xl bg-neutral-50 px-4 py-3 text-xs">
      <div class="flex items-center justify-between gap-3">
        <dt class="text-slate-500">Date Created</dt>
        <dd class="font-medium text-slate-800">{{ dateCreated }}</dd>
      </div>
      <div class="flex items-center justify-between gap-3">
        <dt class="text-slate-500">KB Files</dt>
        <dd class="font-medium text-slate-800">{{ twin.linkedKbFileIds.length }}</dd>
      </div>
    </dl>

    <!-- Action: View AI Twin (soft IEEE blue, bottom-right) -->
    <div class="flex justify-end">
      <BaseButton variant="soft" size="md" rounded="full" @click="open">View AI Twin</BaseButton>
    </div>
  </article>
</template>
