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
  (e: 'translation-state', state: { isTranslated: boolean; showOriginal: boolean; loading: boolean; canTranslate: boolean }): void;
}>();

const { t } = useT();

const sourceText = computed(() => props.text);
const sourceLang = computed(() => props.lang || 'en');

// Authors read their own input verbatim — never re-translate user messages.
const isUser = computed(() => props.role === 'user');

const { value: translated, loading, isTranslated, showOriginal, canTranslate, toggle } = useTranslated(sourceText, sourceLang);

const value = computed(() => (isUser.value ? sourceText.value : translated.value));

watch(
  [isTranslated, showOriginal, loading, canTranslate, isUser],
  ([nextIsTranslated, nextShowOriginal, nextLoading, nextCanTranslate, nextIsUser]) => {
    emit('translation-state', {
      isTranslated: nextIsUser ? false : nextIsTranslated,
      showOriginal: nextIsUser ? false : nextShowOriginal,
      loading: nextIsUser ? false : nextLoading,
      canTranslate: nextIsUser ? false : nextCanTranslate,
    });
  },
  { immediate: true }
);

function toggleTranslation(): void {
  if (isUser.value) return;
  void toggle();
}

defineExpose({
  toggleTranslation,
});
</script>

<template>
  <p class="whitespace-pre-wrap leading-relaxed">{{ value }}</p>
  <div
    v-if="loading && !isUser"
    :class="['mt-1 inline-flex items-center gap-1 text-[11px]', role === 'user' ? 'text-white/80' : 'text-text-subtle']"
  >
    <span
      class="block h-2 w-2 animate-spin rounded-full border-[1.5px] border-current border-t-transparent"
      aria-hidden="true"
    />
    <span>{{ t('common.loading', 'Loading…') }}</span>
  </div>
</template>
