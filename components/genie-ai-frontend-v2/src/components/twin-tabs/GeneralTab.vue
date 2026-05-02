<script setup lang="ts">
import { reactive } from 'vue';
import { PlusSignIcon } from '@hugeicons/core-free-icons';
import BaseButton from '../ui/BaseButton.vue';
import BaseInput from '../ui/BaseInput.vue';
import BaseTextarea from '../ui/BaseTextarea.vue';
import Icon from '../ui/Icon.vue';
import type { AiTwin } from '../../lib/mockTwins';

defineProps<{ twin: AiTwin }>();

const form = reactive({
  fullName: '',
  agentDescription:
    'It is a long established fact that a reader will be distracted by the readable content of a page when looking at its layout.',
  pageGreeting: '',
  chatGreeting: '',
});
const numbers = reactive<string[]>([]);
</script>

<template>
  <div class="space-y-8">
    <section>
      <h2 class="text-base font-semibold text-slate-900">Change Your General Information</h2>
      <div class="mt-4 space-y-5">
        <BaseInput v-model="form.fullName" label="Enter Your Full Name" placeholder="Enter Your Name" />
        <BaseTextarea v-model="form.agentDescription" label="Agent Description" :rows="6" />
      </div>
    </section>

    <section>
      <header class="flex items-center justify-between">
        <h2 class="text-base font-semibold text-slate-900">AI Twin Number</h2>
        <BaseButton variant="primary" size="sm" rounded="full" @click="numbers.push('')">
          <Icon :icon="PlusSignIcon" :size="14" /> Add Number
        </BaseButton>
      </header>

      <div v-if="numbers.length" class="mt-4 space-y-2">
        <BaseInput
          v-for="(_, idx) in numbers"
          :key="idx"
          v-model="numbers[idx]"
          placeholder="+1 234 567 8900"
        />
      </div>
      <p v-else class="mt-3 rounded-xl border border-dashed border-slate-200 bg-slate-50 p-4 text-center text-xs text-slate-500">
        No phone numbers added yet. Click "Add Number" to attach one.
      </p>
    </section>

    <section>
      <h2 class="text-base font-semibold text-slate-900">Page Greeting</h2>
      <div class="mt-3">
        <BaseTextarea v-model="form.pageGreeting" :rows="5" placeholder="Welcome message shown on the page…" />
      </div>
    </section>

    <section>
      <h2 class="text-base font-semibold text-slate-900">Chat Greeting</h2>
      <div class="mt-3">
        <BaseTextarea v-model="form.chatGreeting" :rows="5" placeholder="First message the AI sends in chat…" />
      </div>
    </section>

    <div class="flex justify-end gap-2">
      <BaseButton variant="outline">Discard</BaseButton>
      <BaseButton variant="primary">Save Changes</BaseButton>
    </div>
  </div>
</template>
