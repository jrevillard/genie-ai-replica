<script setup lang="ts">
import { computed } from 'vue';
import { useTranslated } from '../../composables/useTranslated';
import { useT } from '../../i18n/composables';

const props = defineProps<{
  text: string;
  /** ISO-639-1 source language. Defaults to 'en'. */
  lang?: string;
  role: 'user' | 'assistant';
}>();

const { t } = useT();

const sourceText = computed(() => props.text);
const sourceLang = computed(() => props.lang || 'en');

const { value, loading, isTranslated, showOriginal, toggle } = useTranslated(sourceText, sourceLang);
</script>

<template>
  <p class="whitespace-pre-wrap leading-relaxed">{{ value }}</p>
  <div
    v-if="isTranslated || loading"
    :class="[
      'mt-1 flex items-center gap-1 text-[10px]',
      role === 'user' ? 'text-white/70' : 'text-text-subtle',
    ]"
  >
    <span v-if="loading" class="inline-flex items-center gap-1">
      <span
        class="block h-2 w-2 animate-spin rounded-full border-[1.5px] border-current border-t-transparent"
        aria-hidden="true"
      />
      <span>{{ t('common.loading', 'Loading…') }}</span>
    </span>
    <button
      v-else
      type="button"
      class="rounded px-1 py-0.5 underline-offset-2 transition hover:underline"
      @click="toggle"
    >
      {{
        showOriginal
          ? t('history.showTranslation', 'Show translation')
          : t('history.showOriginal', 'Show original')
      }}
    </button>
  </div>
</template>
