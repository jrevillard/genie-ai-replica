<script setup lang="ts">
import { computed } from 'vue';
import { useTranslated } from '../../composables/useTranslated';

const props = withDefaults(
  defineProps<{
    /** Source text. */
    text: string;
    /** ISO-639-1 source language tag. Defaults to 'en'. */
    lang?: string;
  }>(),
  { lang: 'en' }
);

const sourceText = computed(() => props.text);
const sourceLang = computed(() => props.lang || 'en');

const { value } = useTranslated(sourceText, sourceLang);
</script>

<template>{{ value }}</template>
