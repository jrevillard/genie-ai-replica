<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import {
  Cancel01Icon,
  CloudUploadIcon,
  File02Icon,
  Globe02Icon,
  Link01Icon,
  Pdf01Icon,
  Upload01Icon,
} from '@hugeicons/core-free-icons';
import BaseButton from '../ui/BaseButton.vue';
import BaseDrawer from '../ui/BaseDrawer.vue';
import BaseInput from '../ui/BaseInput.vue';
import Icon from '../ui/Icon.vue';
import { notify } from '../../lib/notify';
import { useT } from '../../i18n/composables';
import fileService from '../../services/files';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
  (e: 'uploaded', fileIds: string[]): void;
}>();

const { t } = useT();

const tab = ref<'files' | 'url' | 'crawl'>('files');
const drawerFiles = ref<File[]>([]);
const dragOver = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);
const submitting = ref(false);

const linkUrl = ref('');
const linkLanguage = ref('');
const linkLabels = ref('');

const crawlUrl = ref('');
const crawlMaxDepth = ref<number | ''>(2);
const crawlMaxPages = ref<number | ''>(50);
const crawlLanguage = ref('');

const drawerFilesTotalSize = computed(() =>
  drawerFiles.value.reduce((sum, f) => sum + (f.size || 0), 0)
);

watch(
  () => props.open,
  (open) => {
    if (!open) {
      drawerFiles.value = [];
      linkUrl.value = '';
      linkLanguage.value = '';
      linkLabels.value = '';
      crawlUrl.value = '';
      crawlLanguage.value = '';
      tab.value = 'files';
    }
  }
);

function close(): void {
  emit('update:open', false);
}

function fileTypeIcon(name: string) {
  return name.toLowerCase().endsWith('.pdf') ? Pdf01Icon : File02Icon;
}

function appendDrawerFiles(list: FileList | File[] | null | undefined): void {
  if (!list) return;
  const next = [...drawerFiles.value];
  for (const f of Array.from(list)) next.push(f);
  drawerFiles.value = next;
}

function pickFile(): void {
  fileInput.value?.click();
}

function onFileChange(e: Event): void {
  const input = e.target as HTMLInputElement;
  appendDrawerFiles(input.files);
  input.value = '';
}

function removeDrawerFile(index: number): void {
  drawerFiles.value = drawerFiles.value.filter((_, i) => i !== index);
}

function onDrop(e: DragEvent): void {
  e.preventDefault();
  dragOver.value = false;
  appendDrawerFiles(e.dataTransfer?.files);
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let size = bytes;
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024;
    i += 1;
  }
  return `${size.toFixed(size >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function parseLabelList(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function extractServerError(err: unknown, fallback?: string): string | undefined {
  const e = err as {
    response?: { data?: { message?: string; error?: string } };
    message?: string;
  };
  return (
    e?.response?.data?.message ??
    e?.response?.data?.error ??
    e?.message ??
    fallback
  );
}

async function submitDrawerUpload(): Promise<void> {
  if (!drawerFiles.value.length) {
    notify.warning(t('knowledgeSet.drawerNoFiles', 'Add at least one file to upload.'));
    return;
  }
  if (submitting.value) return;
  submitting.value = true;
  try {
    let ids: string[] = [];
    if (drawerFiles.value.length === 1) {
      const rec = await fileService.uploadFile(drawerFiles.value[0]);
      ids = [rec.file_id];
    } else {
      const recs = await fileService.uploadMultipleFiles(drawerFiles.value);
      ids = recs.map((r) => r.file_id);
    }
    notify.success(t('knowledgeSet.toasts.uploadSuccess', 'Upload complete'));
    emit('uploaded', ids);
    close();
  } catch (err) {
    notify.error(
      t('knowledgeSet.toasts.uploadFailed', 'Upload failed'),
      extractServerError(err)
    );
  } finally {
    submitting.value = false;
  }
}

async function submitLinkUpload(): Promise<void> {
  const url = linkUrl.value.trim();
  if (!url) {
    notify.warning(t('knowledgeSet.toasts.urlRequired', 'Enter a URL'));
    return;
  }
  if (submitting.value) return;
  submitting.value = true;
  try {
    const rec = await fileService.uploadLink({
      url,
      language: linkLanguage.value.trim() || undefined,
      labels: parseLabelList(linkLabels.value),
    });
    notify.success(t('knowledgeSet.toasts.linkAdded', 'Link added to repository'));
    emit('uploaded', rec?.file_id ? [rec.file_id] : []);
    close();
  } catch (err) {
    notify.error(
      t('knowledgeSet.toasts.linkFailed', 'Could not add link'),
      extractServerError(err)
    );
  } finally {
    submitting.value = false;
  }
}

async function submitCrawl(): Promise<void> {
  const url = crawlUrl.value.trim();
  if (!url) {
    notify.warning(t('knowledgeSet.toasts.urlRequired', 'Enter a URL'));
    return;
  }
  if (submitting.value) return;
  submitting.value = true;
  try {
    await fileService.scheduleSiteCrawl({
      url,
      maxDepth: typeof crawlMaxDepth.value === 'number' ? crawlMaxDepth.value : undefined,
      maxPages: typeof crawlMaxPages.value === 'number' ? crawlMaxPages.value : undefined,
      language: crawlLanguage.value.trim() || undefined,
    });
    notify.success(t('knowledgeSet.toasts.crawlScheduled', 'Crawl scheduled'));
    // The crawl is asynchronous and does not return file IDs synchronously, so
    // the consumer just learns "something was scheduled". Linking from a twin
    // happens once files appear in the repo.
    emit('uploaded', []);
    close();
  } catch (err) {
    notify.error(
      t('knowledgeSet.toasts.crawlFailed', 'Could not schedule crawl'),
      extractServerError(err)
    );
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <BaseDrawer
    :open="open"
    :title="t('knowledgeSet.drawerTitle', 'Add knowledge')"
    :icon="Upload01Icon"
    width="md"
    @update:open="emit('update:open', $event)"
  >
    <p class="mb-3 text-caption text-text-muted">
      {{ t('knowledgeSet.drawerIntro', 'Upload files to the document repository.') }}
    </p>

    <div
      class="mb-4 inline-flex w-full gap-1 rounded-full bg-surface-muted p-1"
      role="tablist"
      :aria-label="t('knowledgeSet.drawerTabsLabel', 'Upload source')"
    >
      <button
        type="button"
        role="tab"
        :aria-selected="tab === 'files'"
        :class="[
          'flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-caption font-semibold transition',
          tab === 'files' ? 'bg-surface text-text shadow-card' : 'text-text-muted',
        ]"
        @click="tab = 'files'"
      >
        <Icon :icon="Upload01Icon" :size="14" />
        {{ t('knowledgeSet.tabFiles', 'Files') }}
      </button>
      <button
        type="button"
        role="tab"
        :aria-selected="tab === 'url'"
        :class="[
          'flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-caption font-semibold transition',
          tab === 'url' ? 'bg-surface text-text shadow-card' : 'text-text-muted',
        ]"
        @click="tab = 'url'"
      >
        <Icon :icon="Link01Icon" :size="14" />
        {{ t('knowledgeSet.tabUrl', 'URL') }}
      </button>
      <button
        type="button"
        role="tab"
        :aria-selected="tab === 'crawl'"
        :class="[
          'flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-caption font-semibold transition',
          tab === 'crawl' ? 'bg-surface text-text shadow-card' : 'text-text-muted',
        ]"
        @click="tab = 'crawl'"
      >
        <Icon :icon="Globe02Icon" :size="14" />
        {{ t('knowledgeSet.tabCrawl', 'Site crawl') }}
      </button>
    </div>

    <input ref="fileInput" type="file" multiple class="hidden" @change="onFileChange" />

    <!-- Files tab -->
    <div v-if="tab === 'files'">
      <div
        v-if="!drawerFiles.length"
        :class="[
          'flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-10 text-center transition',
          dragOver ? 'border-accent bg-accent-soft' : 'border-border bg-surface-muted',
        ]"
        @dragover.prevent="dragOver = true"
        @dragleave="dragOver = false"
        @drop="onDrop"
      >
        <span class="grid h-12 w-12 place-items-center rounded-full bg-surface text-text-muted shadow-card">
          <Icon :icon="CloudUploadIcon" :size="24" />
        </span>
        <p class="text-body font-medium text-text">{{ t('knowledgeSet.uploadFile', 'Drag & drop files here') }}</p>
        <p class="max-w-xs text-caption text-text-muted">
          {{ t('knowledgeSet.allowedTypes', 'PDF, Word, CSV, TXT, DOCX') }}
        </p>
        <BaseButton variant="soft" size="sm" rounded="full" @click="pickFile">
          {{ t('knowledgeSet.browseFiles', 'Browse files') }}
        </BaseButton>
      </div>

      <div v-else class="flex flex-col gap-3">
        <div class="flex items-center justify-between gap-3">
          <span class="text-caption font-semibold text-text">
            {{
              drawerFiles.length === 1
                ? t('knowledgeSet.fileReadyOne', '1 file ready')
                : t(
                    'knowledgeSet.fileReadyMany',
                    { count: drawerFiles.length },
                    '{count} files ready'
                  )
            }}
            <span class="ml-1 font-normal text-text-muted">· {{ formatFileSize(drawerFilesTotalSize) }}</span>
          </span>
          <button
            type="button"
            class="text-meta font-semibold text-text-muted transition hover:text-danger"
            :disabled="submitting"
            @click="drawerFiles = []"
          >
            {{ t('knowledgeSet.clearAll', 'Clear all') }}
          </button>
        </div>

        <ul class="flex max-h-72 flex-col gap-2 overflow-y-auto pr-0.5" role="list">
          <li
            v-for="(file, index) in drawerFiles"
            :key="`${file.name}-${index}`"
            class="flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2.5"
          >
            <span
              class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-danger-soft text-danger"
              aria-hidden="true"
            >
              <Icon :icon="fileTypeIcon(file.name)" :size="18" />
            </span>
            <div class="flex min-w-0 flex-1 flex-col">
              <span class="truncate text-caption font-medium text-text">{{ file.name }}</span>
              <span class="text-meta text-text-muted">{{ formatFileSize(file.size) }}</span>
            </div>
            <button
              type="button"
              class="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-text-muted transition hover:bg-danger-soft hover:text-danger disabled:cursor-not-allowed disabled:opacity-50"
              :aria-label="t('knowledgeSet.removeFileAria', 'Remove file')"
              :disabled="submitting"
              @click="removeDrawerFile(index)"
            >
              <Icon :icon="Cancel01Icon" :size="16" />
            </button>
          </li>
        </ul>

        <button
          type="button"
          :class="[
            'flex items-center justify-center gap-2 rounded-xl border-2 border-dashed py-3 text-caption font-medium transition',
            dragOver
              ? 'border-accent bg-accent-soft text-accent'
              : 'border-border bg-surface-muted text-text-muted hover:border-border-strong hover:text-text',
          ]"
          :disabled="submitting"
          @click="pickFile"
          @dragover.prevent="dragOver = true"
          @dragleave="dragOver = false"
          @drop="onDrop"
        >
          <Icon :icon="CloudUploadIcon" :size="16" />
          {{ t('knowledgeSet.addMoreFiles', 'Add more files or drop here') }}
        </button>
      </div>
    </div>

    <!-- URL tab -->
    <div v-else-if="tab === 'url'" class="flex flex-col gap-3">
      <label class="flex flex-col gap-1.5">
        <span class="text-caption font-semibold text-text">
          {{ t('knowledgeSet.urlField', 'URL') }}
        </span>
        <BaseInput
          v-model="linkUrl"
          type="url"
          :placeholder="t('knowledgeSet.urlPlaceholder', 'https://example.com/document.pdf')"
          rounded="md"
        />
      </label>
      <div class="grid gap-3 sm:grid-cols-2">
        <label class="flex flex-col gap-1.5">
          <span class="text-caption font-semibold text-text">
            {{ t('knowledgeSet.languageField', 'Language') }}
          </span>
          <BaseInput
            v-model="linkLanguage"
            :placeholder="t('knowledgeSet.languagePlaceholder', 'e.g. en, fr')"
            rounded="md"
          />
        </label>
        <label class="flex flex-col gap-1.5">
          <span class="text-caption font-semibold text-text">
            {{ t('knowledgeSet.labelsField', 'Labels') }}
          </span>
          <BaseInput
            v-model="linkLabels"
            :placeholder="t('knowledgeSet.labelsPlaceholder', 'comma, separated')"
            rounded="md"
          />
        </label>
      </div>
      <p class="text-meta text-text-muted">
        {{ t('knowledgeSet.urlHint', 'We download the page contents and ingest them like a normal upload.') }}
      </p>
    </div>

    <!-- Site crawl tab -->
    <div v-else class="flex flex-col gap-3">
      <label class="flex flex-col gap-1.5">
        <span class="text-caption font-semibold text-text">
          {{ t('knowledgeSet.crawlUrlField', 'Start URL') }}
        </span>
        <BaseInput
          v-model="crawlUrl"
          type="url"
          :placeholder="t('knowledgeSet.crawlUrlPlaceholder', 'https://example.com')"
          rounded="md"
        />
      </label>
      <div class="grid gap-3 sm:grid-cols-2">
        <label class="flex flex-col gap-1.5">
          <span class="text-caption font-semibold text-text">
            {{ t('knowledgeSet.crawlMaxDepth', 'Max depth') }}
          </span>
          <BaseInput v-model.number="crawlMaxDepth" type="number" min="1" max="10" rounded="md" />
        </label>
        <label class="flex flex-col gap-1.5">
          <span class="text-caption font-semibold text-text">
            {{ t('knowledgeSet.crawlMaxPages', 'Max pages') }}
          </span>
          <BaseInput v-model.number="crawlMaxPages" type="number" min="1" max="500" rounded="md" />
        </label>
      </div>
      <label class="flex flex-col gap-1.5">
        <span class="text-caption font-semibold text-text">
          {{ t('knowledgeSet.languageField', 'Language') }}
        </span>
        <BaseInput
          v-model="crawlLanguage"
          :placeholder="t('knowledgeSet.languagePlaceholder', 'e.g. en, fr')"
          rounded="md"
        />
      </label>
      <p class="text-meta text-text-muted">
        {{
          t(
            'knowledgeSet.crawlHint',
            'We schedule a background crawl. Track progress from the file row → Crawl status.'
          )
        }}
      </p>
    </div>

    <template #footer>
      <button
        type="button"
        class="text-body font-semibold text-text-muted transition hover:text-text"
        :disabled="submitting"
        @click="close"
      >
        {{ t('knowledgeSet.cancel', 'Cancel') }}
      </button>
      <BaseButton
        v-if="tab === 'files'"
        variant="primary"
        :loading="submitting"
        :disabled="!drawerFiles.length"
        @click="submitDrawerUpload"
      >
        {{
          drawerFiles.length > 1
            ? t(
                'knowledgeSet.uploadCount',
                { count: drawerFiles.length },
                'Upload {count} files'
              )
            : t('knowledgeSet.addKnowledge', 'Upload')
        }}
      </BaseButton>
      <BaseButton
        v-else-if="tab === 'url'"
        variant="primary"
        :loading="submitting"
        :disabled="!linkUrl.trim()"
        @click="submitLinkUpload"
      >
        <Icon :icon="Link01Icon" :size="14" />
        {{ t('knowledgeSet.urlSubmit', 'Add link') }}
      </BaseButton>
      <BaseButton
        v-else
        variant="primary"
        :loading="submitting"
        :disabled="!crawlUrl.trim()"
        @click="submitCrawl"
      >
        <Icon :icon="Globe02Icon" :size="14" />
        {{ t('knowledgeSet.crawlSubmit', 'Schedule crawl') }}
      </BaseButton>
    </template>
  </BaseDrawer>
</template>
