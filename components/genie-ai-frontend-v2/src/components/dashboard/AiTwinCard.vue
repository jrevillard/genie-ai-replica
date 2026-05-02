<script setup lang="ts">
import { useRouter } from 'vue-router';
import BaseAvatar from '../ui/BaseAvatar.vue';
import BaseButton from '../ui/BaseButton.vue';
import type { AiTwin } from '../../lib/mockTwins';

const props = defineProps<{
  twin: AiTwin;
}>();

const router = useRouter();

function open() {
  router.push({ name: 'ai-twin-detail', params: { id: props.twin.id } });
}
</script>

<template>
  <article
    class="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-5 transition hover:border-ieee-200 hover:shadow-sm"
  >
    <!-- Header: avatar + name -->
    <header class="flex items-center gap-3">
      <BaseAvatar :src="twin.avatar" :name="twin.name" size="lg" />
      <h3 class="truncate text-base font-semibold text-slate-900">{{ twin.name }}</h3>
    </header>

    <!-- Date Edited row, divided top + bottom from the rest of the card -->
    <div class="flex items-center justify-between border-y border-slate-100 py-3">
      <span class="text-xs font-medium text-slate-500">Date Edited</span>
      <span class="text-xs text-slate-700">{{ twin.dateEdited }}</span>
    </div>

    <!-- Stats panel — its own bordered/rounded subcard -->
    <dl class="grid grid-cols-2 gap-x-6 gap-y-3 rounded-xl border border-slate-200 px-4 py-3 text-xs">
      <div class="flex items-center justify-between gap-3">
        <dt class="text-slate-500">Voice Library</dt>
        <dd class="font-medium text-slate-800">{{ twin.voiceLibrary }}</dd>
      </div>
      <div class="flex items-center justify-between gap-3">
        <dt class="text-slate-500">Number of Chats</dt>
        <dd class="font-medium text-slate-800">{{ twin.numberOfChats }}</dd>
      </div>
      <div class="flex items-center justify-between gap-3">
        <dt class="text-slate-500">Date Created</dt>
        <dd class="font-medium text-slate-800">{{ twin.dateCreated }}</dd>
      </div>
      <div class="flex items-center justify-between gap-3">
        <dt class="text-slate-500">Number of Calls</dt>
        <dd class="font-medium text-slate-800">{{ twin.numberOfCalls }}</dd>
      </div>
    </dl>

    <!-- Action: View AI Twin (soft IEEE blue, bottom-right) -->
    <div class="flex justify-end">
      <BaseButton variant="soft" size="sm" rounded="lg" @click="open">View AI Twin</BaseButton>
    </div>
  </article>
</template>
