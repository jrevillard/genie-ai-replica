<script setup lang="ts">
import { ref } from 'vue';
import BaseTextarea from '../ui/BaseTextarea.vue';

const prompts = [
  {
    id: 'p1',
    body: 'It is a long established fact that a reader will be distracted by the readable content of a page when looking at its layout. The point of using Lorem Ipsum is that it has a more-or-less normal distribution of letters.',
  },
  {
    id: 'p2',
    body: 'It is a long established fact that a reader will be distracted by the readable content of a page when looking at its layout. The point of using Lorem Ipsum is that it has a more-or-less normal distribution of letters.',
  },
  {
    id: 'p3',
    body: 'It is a long established fact that a reader will be distracted by the readable content of a page when looking at its layout. The point of using Lorem Ipsum is that it has a more-or-less normal distribution of letters.',
  },
];

const selected = ref('p2');
const customPrompt = ref('');
</script>

<template>
  <div class="space-y-5">
    <header>
      <h2 class="text-base font-semibold text-slate-900">Edit Your System Prompt</h2>
      <p class="text-xs text-slate-500">Choose Prompt Or Custom Your's</p>
    </header>

    <ul class="space-y-3">
      <li
        v-for="p in prompts"
        :key="p.id"
        :class="[
          'flex gap-3 rounded-2xl border bg-white p-4 shadow-sm transition',
          selected === p.id ? 'border-ieee-700 bg-ieee-50/40 ring-1 ring-ieee-200' : 'border-neutral-200',
        ]"
      >
        <p class="flex-1 text-xs leading-relaxed text-slate-600">{{ p.body }}</p>
        <input
          type="radio"
          :value="p.id"
          :checked="selected === p.id"
          class="mt-1 h-4 w-4 shrink-0 text-ieee-700 focus:ring-ieee-700"
          @change="selected = p.id"
        />
      </li>

      <li
        :class="[
          'flex gap-3 rounded-2xl border bg-white p-4 shadow-sm transition',
          selected === 'custom' ? 'border-ieee-700 bg-ieee-50/40 ring-1 ring-ieee-200' : 'border-neutral-200',
        ]"
      >
        <div class="flex-1">
          <p class="mb-2 text-xs font-medium text-slate-700">Write Your Prompt Here</p>
          <BaseTextarea
            v-model="customPrompt"
            :rows="4"
            placeholder="Describe how the AI Twin should behave…"
            @focus="selected = 'custom'"
          />
        </div>
        <input
          type="radio"
          value="custom"
          :checked="selected === 'custom'"
          class="mt-1 h-4 w-4 shrink-0 text-ieee-700 focus:ring-ieee-700"
          @change="selected = 'custom'"
        />
      </li>
    </ul>
  </div>
</template>
