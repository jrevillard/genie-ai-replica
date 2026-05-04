<script setup lang="ts">
import { ref } from 'vue';
import BaseRadioCard from '../ui/BaseRadioCard.vue';

const language = ref('slang');
const responseLength = ref('medium');
</script>

<template>
  <div class="space-y-8">
    <h2 class="text-title text-text">Edit Your AI Personality</h2>

    <section>
      <header class="mb-3">
        <h3 class="text-body font-semibold text-text">Language Style</h3>
        <p class="text-caption text-text-muted">Choose how you want your AI Twin to communicate</p>
      </header>
      <div class="space-y-3">
        <BaseRadioCard v-model="language" value="slang" label="Slang Use" />
        <BaseRadioCard v-model="language" value="casual" label="Casual" />
        <BaseRadioCard v-model="language" value="professional" label="Professional" />
      </div>
    </section>

    <section>
      <header class="mb-3">
        <h3 class="text-body font-semibold text-text">Response Length</h3>
        <p class="text-caption text-text-muted">Choose how long your AI Twin responses should be</p>
      </header>
      <div class="space-y-3">
        <BaseRadioCard
          v-model="responseLength"
          value="short"
          label="Short"
          description="i.e. concise, brief statements"
        />
        <BaseRadioCard
          v-model="responseLength"
          value="medium"
          label="Medium"
          description="i.e. moderately lengthy statements"
        />
        <BaseRadioCard
          v-model="responseLength"
          value="long"
          label="Long"
          description="i.e. detailed, thorough explanations"
        />
      </div>
    </section>
  </div>
</template>
