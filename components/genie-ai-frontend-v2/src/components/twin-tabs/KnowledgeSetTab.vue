<script setup lang="ts">
import { ref } from 'vue';
import { File02Icon, Mortarboard02Icon, PlusSignIcon, Upload01Icon } from '@hugeicons/core-free-icons';
import BaseButton from '../ui/BaseButton.vue';
import BaseDialog from '../ui/BaseDialog.vue';
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
        <h2 class="text-base font-semibold text-slate-900">Knowledge Set</h2>
        <p class="mt-0.5 text-xs text-slate-500">Upload files so your AI Twin can answer with your specific knowledge.</p>
      </div>
      <BaseButton variant="primary" size="sm" rounded="full" @click="dialogOpen = true">
        <Icon :icon="PlusSignIcon" :size="14" /> Add Knowledge
      </BaseButton>
    </header>

    <ul v-if="files.length" class="space-y-2">
      <li
        v-for="f in files"
        :key="f.id"
        class="flex items-center gap-3 rounded-2xl border border-neutral-200 bg-white p-3 shadow-sm"
      >
        <div class="rounded-full bg-ieee-50 p-2 text-ieee-700">
          <Icon :icon="File02Icon" :size="18" />
        </div>
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium text-slate-900">{{ f.name }}</p>
          <p class="text-xs text-slate-500">{{ f.size }}</p>
        </div>
      </li>
    </ul>
    <EmptyState
      v-else
      :icon="Mortarboard02Icon"
      title="No knowledge files yet"
      description="Upload PDFs, Word docs or text files so this AI Twin learns your domain."
    >
      <BaseButton variant="primary" size="md" @click="dialogOpen = true">
        <Icon :icon="PlusSignIcon" :size="16" /> Add Knowledge
      </BaseButton>
    </EmptyState>

    <BaseDialog v-model:open="dialogOpen" size="md" title="Add Upload Knowledge">
      <p class="mb-4 text-xs text-slate-500">
        For further accuracy, you can upload files below to train your Agent to sound more like you.
      </p>
      <div
        :class="[
          'flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-10 text-center transition',
          dragOver ? 'border-ieee-500 bg-ieee-50' : 'border-slate-200 bg-slate-50',
        ]"
        @dragover.prevent="dragOver = true"
        @dragleave="dragOver = false"
        @drop="onDrop"
      >
        <Icon :icon="Upload01Icon" :size="28" class="text-slate-400" />
        <p class="text-sm font-medium text-slate-700">Upload File</p>
        <p class="max-w-xs text-xs text-slate-500">
          File types allowed to be uploaded: PDF, Word, .csv, .doc, .txt, .docx
        </p>
        <input ref="fileInput" type="file" multiple class="hidden" @change="onFileChange" />
        <BaseButton variant="soft" size="sm" rounded="full" @click="pickFile">
          Browse files
        </BaseButton>
      </div>

      <template #footer>
        <BaseButton variant="primary" @click="dialogOpen = false">Add Knowledge</BaseButton>
      </template>
    </BaseDialog>
  </div>
</template>
