<script setup lang="ts">
import { ref } from 'vue';
import { PlusSignIcon, Tag01Icon } from '@hugeicons/core-free-icons';
import BaseButton from '../ui/BaseButton.vue';
import BaseInput from '../ui/BaseInput.vue';
import EmptyState from '../ui/EmptyState.vue';
import Icon from '../ui/Icon.vue';

interface Instruction {
  id: string;
  title: string;
  body: string;
}

const items = ref<Instruction[]>([]);
const draftTitle = ref('');
const draftBody = ref('');

function add() {
  if (!draftTitle.value.trim()) return;
  items.value.push({
    id: `i-${Date.now()}`,
    title: draftTitle.value.trim(),
    body: draftBody.value.trim(),
  });
  draftTitle.value = '';
  draftBody.value = '';
}
</script>

<template>
  <div class="space-y-5">
    <header>
      <h2 class="text-base font-semibold text-slate-900">Instructions</h2>
      <p class="text-xs text-slate-500">Add specific dos and don'ts for your AI Twin to follow.</p>
    </header>

    <div class="space-y-3 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
      <BaseInput v-model="draftTitle" placeholder="Title (e.g. Tone of voice)" />
      <BaseInput v-model="draftBody" placeholder="Detail the instruction…" />
      <div class="flex justify-end">
        <BaseButton variant="primary" size="sm" rounded="full" :disabled="!draftTitle.trim()" @click="add">
          <Icon :icon="PlusSignIcon" :size="14" /> Add instruction
        </BaseButton>
      </div>
    </div>

    <ul v-if="items.length" class="space-y-2">
      <li v-for="i in items" :key="i.id" class="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
        <p class="text-sm font-semibold text-slate-900">{{ i.title }}</p>
        <p v-if="i.body" class="mt-1 text-xs text-slate-600">{{ i.body }}</p>
      </li>
    </ul>
    <EmptyState
      v-else
      :icon="Tag01Icon"
      title="No instructions yet"
      description="Each instruction is a rule the AI Twin will follow during conversations."
    />
  </div>
</template>
