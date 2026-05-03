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
      <h2 class="text-title text-text">Edit Your System Prompt</h2>
      <p class="text-caption text-text-muted">Choose a preset or write your own.</p>
    </header>

    <fieldset class="space-y-3">
      <legend class="sr-only">System prompt</legend>

      <label
        v-for="p in prompts"
        :key="p.id"
        :class="[
          'flex cursor-pointer gap-3 rounded-2xl border bg-surface p-4 shadow-card transition',
          selected === p.id ? 'border-accent bg-accent-soft/40 ring-1 ring-accent/30' : 'border-border hover:bg-surface-muted',
        ]"
      >
        <p class="flex-1 text-caption leading-relaxed text-text-muted">{{ p.body }}</p>
        <input
          type="radio"
          name="system-prompt"
          :value="p.id"
          :checked="selected === p.id"
          class="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-accent"
          @change="selected = p.id"
        />
      </label>

      <label
        :class="[
          'flex cursor-pointer gap-3 rounded-2xl border bg-surface p-4 shadow-card transition',
          selected === 'custom' ? 'border-accent bg-accent-soft/40 ring-1 ring-accent/30' : 'border-border hover:bg-surface-muted',
        ]"
      >
        <div class="flex-1">
          <p class="mb-2 text-caption font-medium text-text">Write Your Prompt Here</p>
          <BaseTextarea
            v-model="customPrompt"
            :rows="4"
            placeholder="Describe how the AI Twin should behave…"
            @focus="selected = 'custom'"
          />
        </div>
        <input
          type="radio"
          name="system-prompt"
          value="custom"
          :checked="selected === 'custom'"
          class="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-accent"
          @change="selected = 'custom'"
        />
      </label>
    </fieldset>
  </div>
</template>
