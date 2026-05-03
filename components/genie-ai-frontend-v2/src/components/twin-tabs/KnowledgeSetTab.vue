<script setup lang="ts">
import { ref } from 'vue';
import { AiBrain01Icon, File02Icon, PlusSignIcon, Upload01Icon } from '@hugeicons/core-free-icons';
import BaseButton from '../ui/BaseButton.vue';
import BaseDrawer from '../ui/BaseDrawer.vue';
import EmptyState from '../ui/EmptyState.vue';
import Icon from '../ui/Icon.vue';

interface KnowledgeFile {
  id: string;
  name: string;
  size: string;
}

const files = ref<KnowledgeFile[]>([]);
const dialogOpen = ref(false);
const dragOver = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

function pickFile() {
  fileInput.value?.click();
}

function addFile(file: File) {
  files.value.push({
    id: `f-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: file.name,
    size: formatBytes(file.size),
  });
}

function onFileChange(e: Event) {
  const list = (e.target as HTMLInputElement).files;
  if (!list) return;
  for (const f of Array.from(list)) addFile(f);
}

function onDrop(e: DragEvent) {
  e.preventDefault();
  dragOver.value = false;
  const list = e.dataTransfer?.files;
  if (!list) return;
  for (const f of Array.from(list)) addFile(f);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}
</script>

<template>
  <div class="space-y-5">
    <header class="flex items-center justify-between">
      <div>
        <h2 class="text-title text-text">Knowledge Set</h2>
        <p class="mt-0.5 text-caption text-text-muted">
          Upload files so your AI Twin can answer with your specific knowledge.
        </p>
      </div>
      <BaseButton variant="primary" size="sm" rounded="full" @click="dialogOpen = true">
        <Icon :icon="PlusSignIcon" :size="14" /> Add Knowledge
      </BaseButton>
    </header>

    <ul v-if="files.length" class="space-y-2">
      <li
        v-for="f in files"
        :key="f.id"
        class="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3 shadow-card"
      >
        <div class="rounded-full bg-accent-soft p-2 text-accent">
          <Icon :icon="File02Icon" :size="18" />
        </div>
        <div class="min-w-0 flex-1">
          <p class="truncate text-body font-medium text-text">{{ f.name }}</p>
          <p class="text-caption text-text-muted">{{ f.size }}</p>
        </div>
      </li>
    </ul>
    <EmptyState
      v-else
      :icon="AiBrain01Icon"
      title="No knowledge files yet"
      description="Upload PDFs, Word docs or text files so this AI Twin learns your domain."
    >
      <BaseButton variant="primary" size="md" @click="dialogOpen = true">
        <Icon :icon="PlusSignIcon" :size="16" /> Add Knowledge
      </BaseButton>
    </EmptyState>

    <BaseDrawer
      v-model:open="dialogOpen"
      title="Add Upload Knowledge"
      badge="UPLOAD"
      :icon="Upload01Icon"
      width="md"
    >
      <p class="mb-4 text-caption text-text-muted">
        For further accuracy, you can upload files below to train your Agent to sound more like you.
      </p>
      <div
        :class="[
          'flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-10 text-center transition',
          dragOver ? 'border-accent bg-accent-soft' : 'border-border bg-surface-muted',
        ]"
        @dragover.prevent="dragOver = true"
        @dragleave="dragOver = false"
        @drop="onDrop"
      >
        <Icon :icon="Upload01Icon" :size="28" class="text-text-subtle" />
        <p class="text-body font-medium text-text">Upload File</p>
        <p class="max-w-xs text-caption text-text-muted">
          File types allowed: PDF, Word, .csv, .doc, .txt, .docx
        </p>
        <input ref="fileInput" type="file" multiple class="hidden" @change="onFileChange" />
        <BaseButton variant="soft" size="sm" rounded="full" @click="pickFile">
          Browse files
        </BaseButton>
      </div>

      <template #footer>
        <button
          type="button"
          class="text-body font-semibold text-text-muted transition hover:text-text"
          @click="dialogOpen = false"
        >
          Cancel
        </button>
        <BaseButton variant="primary" @click="dialogOpen = false">Add Knowledge</BaseButton>
      </template>
    </BaseDrawer>
  </div>
</template>
