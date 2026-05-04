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

    <div class="grid grid-cols-2 items-center gap-x-6 rounded-2xl bg-neutral-50 px-4 py-3 text-xs">
      <dl class="flex flex-col gap-y-2">
        <div class="flex items-center justify-between gap-3">
          <dt class="text-slate-500">Date Created</dt>
          <dd class="font-medium text-slate-800">{{ dateCreated }}</dd>
        </div>
        <div class="flex items-center justify-between gap-3">
          <dt class="text-slate-500">Date Edited</dt>
          <dd class="font-medium text-slate-800">{{ dateEdited }}</dd>
        </div>
      </dl>
      <div class="flex items-center justify-between gap-3 border-l border-slate-200 pl-6">
        <span class="text-slate-500">KB Files</span>
        <span class="font-medium text-slate-800">{{ twin.linkedKbFileIds.length }}</span>
      </div>
    </div>

    <!-- Action: View AI Twin (soft IEEE blue, bottom-right) -->
    <div class="flex justify-end">
      <BaseButton variant="soft" size="md" rounded="full" @click="open">View AI Twin</BaseButton>
    </div>
  </article>
</template>
