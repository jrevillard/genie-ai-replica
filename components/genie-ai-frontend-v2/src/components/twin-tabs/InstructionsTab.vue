<script setup lang="ts">
import { ref } from 'vue';
import { PlusSignIcon, Tag01Icon } from '@hugeicons/core-free-icons';
import BaseButton from '../ui/BaseButton.vue';
import BaseInput from '../ui/BaseInput.vue';
import EmptyState from '../ui/EmptyState.vue';
import Icon from '../ui/Icon.vue';
import { useT } from '../../i18n/composables';

const { t } = useT();

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
      <h2 class="text-title text-text">{{ t('twins.instructions.title', 'Instructions') }}</h2>
      <p class="text-caption text-text-muted">{{ t('twins.instructions.subtitle', "Add specific dos and don'ts for your AI Twin to follow.") }}</p>
    </header>

    <div class="space-y-3 rounded-2xl border border-border bg-surface p-4 shadow-card">
      <BaseInput v-model="draftTitle" :placeholder="t('twins.instructions.titlePlaceholder', 'Title (e.g. Tone of voice)')" />
      <BaseInput v-model="draftBody" :placeholder="t('twins.instructions.bodyPlaceholder', 'Detail the instruction…')" />
      <div class="flex justify-end">
        <BaseButton variant="primary" size="sm" rounded="full" :disabled="!draftTitle.trim()" @click="add">
          <Icon :icon="PlusSignIcon" :size="14" /> {{ t('twins.instructions.add', 'Add instruction') }}
        </BaseButton>
      </div>
    </div>

    <ul v-if="items.length" class="space-y-2">
      <li v-for="i in items" :key="i.id" class="rounded-2xl border border-border bg-surface p-4 shadow-card">
        <p class="text-body font-semibold text-text">{{ i.title }}</p>
        <p v-if="i.body" class="mt-1 text-caption text-text-muted">{{ i.body }}</p>
      </li>
    </ul>
    <EmptyState
      v-else
      :icon="Tag01Icon"
      :title="t('twins.instructions.emptyTitle', 'No instructions yet')"
      :description="t('twins.instructions.emptyBody', 'Each instruction is a rule the AI Twin will follow during conversations.')"
    />
  </div>
</template>
