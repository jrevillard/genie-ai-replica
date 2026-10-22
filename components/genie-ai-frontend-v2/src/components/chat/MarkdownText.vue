<script setup lang="ts">
import { computed } from 'vue';
import { renderMarkdown } from '../../lib/markdown';

const props = defineProps<{
  text: string;
}>();

const html = computed(() => renderMarkdown(props.text));
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html — sanitized in renderMarkdown -->
  <div class="md-body leading-relaxed" v-html="html" />
</template>

<style scoped>
/* Restores list/heading styling stripped by the Tailwind preflight;
   :deep() reaches into the v-html content. */
.md-body {
  overflow-wrap: anywhere;
}
.md-body :deep(p) {
  margin: 0;
  white-space: pre-wrap;
}
.md-body :deep(p + p),
.md-body :deep(ul + p),
.md-body :deep(ol + p),
.md-body :deep(pre + p) {
  margin-top: 0.625rem;
}
.md-body :deep(ul),
.md-body :deep(ol) {
  margin: 0.375rem 0;
  padding-left: 1.375rem;
}
.md-body :deep(ul) {
  list-style: disc;
}
.md-body :deep(ol) {
  list-style: decimal;
}
.md-body :deep(li) {
  margin: 0.25rem 0;
}
.md-body :deep(li > ul),
.md-body :deep(li > ol) {
  margin: 0.25rem 0;
}
.md-body :deep(strong) {
  font-weight: 600;
}
.md-body :deep(h1),
.md-body :deep(h2),
.md-body :deep(h3),
.md-body :deep(h4) {
  margin: 0.75rem 0 0.375rem;
  font-weight: 600;
  line-height: 1.3;
}
.md-body :deep(h1) {
  font-size: 1.125em;
}
.md-body :deep(h2) {
  font-size: 1.0625em;
}
.md-body :deep(h3),
.md-body :deep(h4) {
  font-size: 1em;
}
.md-body :deep(a) {
  @apply text-accent;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.md-body :deep(code) {
  border-radius: 0.25rem;
  background: rgb(0 0 0 / 0.06);
  padding: 0.125rem 0.3125rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.875em;
}
.md-body :deep(pre) {
  margin: 0.5rem 0;
  overflow-x: auto;
  border-radius: 0.5rem;
  background: rgb(0 0 0 / 0.06);
  padding: 0.625rem 0.75rem;
}
.md-body :deep(pre code) {
  background: none;
  padding: 0;
}
.md-body :deep(blockquote) {
  margin: 0.5rem 0;
  border-left: 3px solid rgb(0 0 0 / 0.15);
  padding-left: 0.75rem;
}
.md-body :deep(hr) {
  margin: 0.75rem 0;
  border: 0;
  border-top: 1px solid rgb(0 0 0 / 0.12);
}
.md-body :deep(table) {
  display: block;
  max-width: 100%;
  overflow-x: auto;
  margin: 0.5rem 0;
  border-collapse: collapse;
  font-size: 0.9375em;
}
.md-body :deep(th),
.md-body :deep(td) {
  border: 1px solid rgb(0 0 0 / 0.12);
  padding: 0.25rem 0.5rem;
  text-align: left;
}
</style>
