<script setup lang="ts">
import { ref } from 'vue';
import BaseRadioCard from '../ui/BaseRadioCard.vue';
import { useT } from '../../i18n/composables';

const { t } = useT();

const language = ref('slang');
const responseLength = ref('medium');
</script>

<template>
  <div class="space-y-8">
    <h2 class="text-title text-text">{{ t('twins.personality.title', 'Edit Your AI Personality') }}</h2>

    <section>
      <header class="mb-3">
        <h3 class="text-body font-semibold text-text">{{ t('twins.personality.languageStyleTitle', 'Language Style') }}</h3>
        <p class="text-caption text-text-muted">{{ t('twins.personality.languageStyleSubtitle', 'Choose how you want your AI Twin to communicate') }}</p>
      </header>
      <div class="space-y-3">
        <BaseRadioCard v-model="language" value="slang" :label="t('twins.personality.slang', 'Slang Use')" />
        <BaseRadioCard v-model="language" value="casual" :label="t('twins.personality.casual', 'Casual')" />
        <BaseRadioCard v-model="language" value="professional" :label="t('twins.personality.professional', 'Professional')" />
      </div>
    </section>

    <section>
      <header class="mb-3">
        <h3 class="text-body font-semibold text-text">{{ t('twins.personality.lengthTitle', 'Response Length') }}</h3>
        <p class="text-caption text-text-muted">{{ t('twins.personality.lengthSubtitle', 'Choose how long your AI Twin responses should be') }}</p>
      </header>
      <div class="space-y-3">
        <BaseRadioCard
          v-model="responseLength"
          value="short"
          :label="t('twins.personality.short', 'Short')"
          :description="t('twins.personality.shortDesc', 'i.e. concise, brief statements')"
        />
        <BaseRadioCard
          v-model="responseLength"
          value="medium"
          :label="t('twins.personality.medium', 'Medium')"
          :description="t('twins.personality.mediumDesc', 'i.e. moderately lengthy statements')"
        />
        <BaseRadioCard
          v-model="responseLength"
          value="long"
          :label="t('twins.personality.long', 'Long')"
          :description="t('twins.personality.longDesc', 'i.e. detailed, thorough explanations')"
        />
      </div>
    </section>
  </div>
</template>
