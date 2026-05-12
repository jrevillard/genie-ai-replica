<script setup lang="ts">
import {
  File02Icon,
  Image01Icon,
  Note01Icon,
  Pdf01Icon,
  PresentationOnlineIcon,
} from '@hugeicons/core-free-icons';
import BaseBadge from '../ui/BaseBadge.vue';
import Icon from '../ui/Icon.vue';
import { useT } from '../../i18n/composables';

// Row component for the AI Twin → Knowledge Set tab. Used by both the
// "Assigned" and "Not assigned" sections so the visual treatment stays in
// one place. The shape mirrors what the parent's `displayFiles` computed
// produces; we keep it inline (instead of importing) to avoid coupling the
// child to the parent's private type alias.

export interface KnowledgeFileRowProps {
  file: {
    fileId: string;
    fileName: string;
    extension: string | null;
    sizeLabel: string | null;
    language: string | null;
    chunkCount: number | null;
    statusRaw: string;
    statusLabel: string;
    uploadedLabel: string | null;
    labels: string[];
    author: string | null;
    sourceUrl: string | null;
    linked: boolean;
  };
  editing: boolean;
}

const props = defineProps<KnowledgeFileRowProps>();
const emit = defineEmits<{ (e: 'toggle', file: KnowledgeFileRowProps['file']): void }>();

const { t, locale } = useT();

function fileIcon(ext: string | null) {
  switch (ext) {
    case 'pdf':
      return Pdf01Icon;
    case 'doc':
    case 'docx':
    case 'txt':
    case 'md':
    case 'rtf':
      return Note01Icon;
    case 'ppt':
    case 'pptx':
      return PresentationOnlineIcon;
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
    case 'svg':
    case 'img':
      return Image01Icon;
    default:
      return File02Icon;
  }
}

function fileIconClasses(ext: string | null): string {
  switch (ext) {
    case 'pdf':
      return 'bg-rose-50 text-rose-600';
    case 'md':
    case 'markdown':
      return 'bg-sky-50 text-sky-600';
    case 'doc':
    case 'docx':
      return 'bg-indigo-50 text-indigo-600';
    case 'xls':
    case 'xlsx':
    case 'csv':
      return 'bg-emerald-50 text-emerald-600';
    case 'ppt':
    case 'pptx':
      return 'bg-orange-50 text-orange-600';
    case 'html':
    case 'htm':
      return 'bg-amber-50 text-amber-600';
    case 'txt':
      return 'bg-slate-100 text-slate-600';
    case 'json':
    case 'yaml':
    case 'yml':
      return 'bg-violet-50 text-violet-600';
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
    case 'svg':
    case 'img':
      return 'bg-fuchsia-50 text-fuchsia-600';
    default:
      return 'bg-slate-100 text-slate-600';
  }
}

function statusTone(
  statusRaw: string
): 'neutral' | 'accent' | 'success' | 'warning' | 'danger' {
  const n = (statusRaw || '').toLowerCase();
  if (n.includes('error')) return 'danger';
  if (n.includes('killed')) return 'danger';
  if (n.includes('warning')) return 'warning';
  if (n.includes('pending')) return 'warning';
  if (n.includes('ingesting')) return 'accent';
  if (n.includes('ingested')) return 'success';
  return 'neutral';
}

function languageLabel(code: string | null): string | null {
  if (!code) return null;
  try {
    const display = new Intl.DisplayNames([locale.value], { type: 'language' });
    return display.of(code) || code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
}

function onActivate() {
  if (!props.editing) return;
  emit('toggle', props.file);
}
</script>

<template>
  <li
    :class="[
      'group flex items-start gap-3 rounded-2xl border p-3 shadow-card transition hover:border-accent/40 hover:shadow-md',
      file.linked
        ? 'border-accent/30 bg-accent-soft/15'
        : 'border-border bg-surface',
      editing ? 'cursor-pointer' : '',
    ]"
    :role="editing ? 'checkbox' : undefined"
    :aria-checked="editing ? file.linked : undefined"
    :tabindex="editing ? 0 : undefined"
    @click="onActivate"
    @keydown.enter.prevent="onActivate"
    @keydown.space.prevent="onActivate"
  >
    <div
      :class="[
        'grid h-10 w-10 shrink-0 place-items-center rounded-xl',
        fileIconClasses(file.extension),
      ]"
    >
      <Icon :icon="fileIcon(file.extension)" :size="20" />
    </div>
    <div class="min-w-0 flex-1">
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
        <p class="truncate text-body font-medium text-text" :title="file.fileName">
          {{ file.fileName }}
        </p>
        <span
          v-if="file.extension"
          class="shrink-0 rounded-md bg-sky-50 px-1.5 py-0.5 text-meta font-semibold uppercase tracking-wide text-sky-700"
        >
          {{ file.extension }}
        </span>
        <BaseBadge :tone="statusTone(file.statusRaw)" dot class="shrink-0">
          {{ file.statusLabel }}
        </BaseBadge>
      </div>
      <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-text-muted">
        <span v-if="file.language" class="inline-flex items-center gap-1 rounded-full bg-surface-muted px-2 py-0.5 text-meta font-semibold uppercase tracking-wide text-text-muted">
          {{ languageLabel(file.language) }}
        </span>
        <template v-if="file.language && (file.sizeLabel || file.uploadedLabel || file.chunkCount !== null)">
          <span aria-hidden="true">·</span>
        </template>
        <span v-if="file.sizeLabel">{{ file.sizeLabel }}</span>
        <template v-if="file.sizeLabel && (file.uploadedLabel || file.chunkCount !== null)">
          <span aria-hidden="true">·</span>
        </template>
        <span v-if="file.uploadedLabel">{{ file.uploadedLabel }}</span>
        <template v-if="file.uploadedLabel && file.chunkCount !== null">
          <span aria-hidden="true">·</span>
        </template>
        <span v-if="file.chunkCount !== null">
          {{
            t(
              'twins.knowledge.chunks',
              { count: file.chunkCount },
              '{count} chunks'
            )
          }}
        </span>
      </div>
      <div
        v-if="file.author || file.sourceUrl || file.labels.length"
        class="mt-1.5 flex flex-wrap items-center gap-1.5"
      >
        <span
          v-if="file.author"
          class="inline-flex items-center rounded-full bg-surface-muted px-2 py-0.5 text-meta text-text-muted"
        >
          {{ file.author }}
        </span>
        <a
          v-if="file.sourceUrl"
          :href="file.sourceUrl"
          target="_blank"
          rel="noopener"
          class="inline-flex max-w-[18rem] items-center gap-1 truncate rounded-full bg-accent-soft px-2 py-0.5 text-meta font-medium text-accent hover:underline"
          :title="file.sourceUrl"
          @click.stop
        >
          {{ file.sourceUrl }}
        </a>
        <span
          v-for="label in file.labels"
          :key="label"
          class="inline-flex items-center rounded-full bg-accent-soft/60 px-2 py-0.5 text-meta font-medium text-accent"
        >
          {{ label }}
        </span>
      </div>
    </div>
    <!-- Checkbox marker. Filled=assigned, empty=available. -->
    <span
      v-if="editing"
      :class="[
        'mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md border transition',
        file.linked
          ? 'border-accent bg-accent text-text-inverse shadow-sm'
          : 'border-border bg-surface text-transparent group-hover:border-accent/60',
      ]"
      aria-hidden="true"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="3"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="h-3.5 w-3.5"
      >
        <polyline points="20 6 9 17 4 12" />
      </svg>
    </span>
  </li>
</template>
