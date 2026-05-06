<script setup lang="ts">
import { computed, watch } from 'vue';
import { useTranslated } from '../../composables/useTranslated';
import { useT } from '../../i18n/composables';

const props = defineProps<{
  text: string;
  /** ISO-639-1 source language. Defaults to 'en'. */
  lang?: string;
  role: 'user' | 'assistant';
}>();
const emit = defineEmits<{
  (e: 'translation-state', state: { isTranslated: boolean; showOriginal: boolean; loading: boolean }): void;
}>();

const { t } = useT();

const sourceText = computed(() => props.text);
const sourceLang = computed(() => props.lang || 'en');

const { value, loading, isTranslated, showOriginal, toggle } = useTranslated(sourceText, sourceLang);

watch(
  [isTranslated, showOriginal, loading],
  ([nextIsTranslated, nextShowOriginal, nextLoading]) => {
    emit('translation-state', {
      isTranslated: nextIsTranslated,
      showOriginal: nextShowOriginal,
      loading: nextLoading,
    });
  },
  { immediate: true }
);

function toggleTranslation(): void {
  toggle();
}

defineExpose({
  toggleTranslation,
});
</script>

<template>
  <p class="whitespace-pre-wrap leading-relaxed">{{ value }}</p>
  <div
    v-if="loading"
    :class="['mt-1 inline-flex items-center gap-1 text-[11px]', role === 'user' ? 'text-white/80' : 'text-text-subtle']"
  >
    <span
      class="block h-2 w-2 animate-spin rounded-full border-[1.5px] border-current border-t-transparent"
      aria-hidden="true"
    />
    <span>{{ t('common.loading', 'Loading…') }}</span>
  </div>
</template>
