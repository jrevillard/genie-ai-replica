<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  AddCircleIcon,
  CloudUploadIcon,
  Delete02Icon,
  Download04Icon,
  Pdf01Icon,
  Search01Icon,
  Upload01Icon,
} from '@hugeicons/core-free-icons';
import BaseAvatar from '../components/ui/BaseAvatar.vue';
import BaseBadge from '../components/ui/BaseBadge.vue';
import BaseButton from '../components/ui/BaseButton.vue';
import BaseCheckbox from '../components/ui/BaseCheckbox.vue';
import BaseDrawer from '../components/ui/BaseDrawer.vue';
import BaseInput from '../components/ui/BaseInput.vue';
import EmptyState from '../components/ui/EmptyState.vue';
import Icon from '../components/ui/Icon.vue';
import DashboardLayout from '../layouts/DashboardLayout.vue';

type DocumentItem = {
  id: number;
  name: string;
  date: string;
  status: 'Pending' | 'Ingesting' | 'Ingested';
  selected?: boolean;
};

type Twin = {
  id: number;
  name: string;
  dateEdited: string;
  dateCreated: string;
  voice: string;
  chats: number;
  calls: number;
  selected?: boolean;
};

const documents = ref<DocumentItem[]>([
  { id: 1, name: 'File Name.doc', date: '10 Feb 2024', status: 'Pending', selected: false },
  { id: 2, name: 'File Name.doc', date: '10 Feb 2024', status: 'Ingesting', selected: false },
  { id: 3, name: 'File Name.doc', date: '10 Feb 2024', status: 'Ingested', selected: false },
  { id: 4, name: 'File Name.doc', date: '10 Feb 2024', status: 'Pending', selected: false },
]);

const twins = ref<Twin[]>([
  { id: 1, name: 'Andrew Ainsley', dateEdited: 'March 18, 2024', dateCreated: 'March 7, 2024', voice: 'Voice Sample 01', chats: 125, calls: 27 },
  { id: 2, name: 'Andrew Ainsley', dateEdited: 'March 18, 2024', dateCreated: 'March 7, 2024', voice: 'Voice Sample 01', chats: 125, calls: 27 },
  { id: 3, name: 'Andrew Ainsley', dateEdited: 'March 18, 2024', dateCreated: 'March 7, 2024', voice: 'Voice Sample 01', chats: 125, calls: 27, selected: true },
  { id: 4, name: 'Andrew Ainsley', dateEdited: 'March 18, 2024', dateCreated: 'March 7, 2024', voice: 'Voice Sample 01', chats: 125, calls: 27 },
  { id: 5, name: 'Andrew Ainsley', dateEdited: 'March 18, 2024', dateCreated: 'March 7, 2024', voice: 'Voice Sample 01', chats: 125, calls: 27 },
  { id: 6, name: 'Andrew Ainsley', dateEdited: 'March 18, 2024', dateCreated: 'March 7, 2024', voice: 'Voice Sample 01', chats: 125, calls: 27 },
]);

const mode = ref<'documents' | 'twins'>('documents');
const uploadOpen = ref(false);
const dragOver = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);
const documentSearch = ref('');
const twinSearch = ref('');

function pickFile() {
  fileInput.value?.click();
}

function onFileChange(_e: Event) {
  // TODO: wire to upload service when endpoint is available
}

function onDrop(e: DragEvent) {
  e.preventDefault();
  dragOver.value = false;
  // TODO: wire to upload service when endpoint is available
}

const filteredDocuments = computed(() => {
  const q = documentSearch.value.trim().toLowerCase();
  if (!q) return documents.value;
  return documents.value.filter((d) => d.name.toLowerCase().includes(q));
});

const filteredTwins = computed(() => {
  const q = twinSearch.value.trim().toLowerCase();
  if (!q) return twins.value;
  return twins.value.filter((t) => t.name.toLowerCase().includes(q));
});

const allDocumentsSelected = computed({
  get: () => documents.value.length > 0 && documents.value.every((d) => d.selected),
  set: (value: boolean) => {
    documents.value.forEach((d) => {
      d.selected = value;
    });
  },
});

const selectedCount = computed(() => documents.value.filter((d) => d.selected).length);

function statusTone(status: DocumentItem['status']) {
  if (status === 'Pending') return 'neutral';
  if (status === 'Ingesting') return 'accent';
  return 'success';
}

function toggleDocument(document: DocumentItem) {
  document.selected = !document.selected;
}

function selectTwin(twin: Twin) {
  twins.value.forEach((item) => {
    item.selected = item.id === twin.id;
  });
}
</script>

<template>
  <DashboardLayout>
    <section class="h-full min-h-0 bg-surface p-4 md:p-6">
      <div class="flex h-full min-h-[700px] flex-col">
        <template v-if="mode === 'documents'">
          <header class="mb-4 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <h1 class="text-headline text-text">Document Management</h1>
            <BaseButton variant="primary" rounded="full" @click="uploadOpen = true">
              <Icon :icon="Upload01Icon" :size="16" />
              Add Knowledge
            </BaseButton>
          </header>

          <div class="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div class="w-full max-w-md">
              <BaseInput
                v-model="documentSearch"
                placeholder="Search by file name"
                rounded="full"
              >
                <template #leading><Icon :icon="Search01Icon" :size="18" /></template>
              </BaseInput>
            </div>
          </div>

          <div class="mb-5 flex items-center justify-between gap-3">
            <BaseCheckbox v-model="allDocumentsSelected" size="sm" class="min-w-0">
              <span class="truncate text-body font-semibold text-text">
                Select Files To Add Them For The Twins
              </span>
            </BaseCheckbox>
            <BaseButton
              variant="primary"
              rounded="full"
              :disabled="selectedCount === 0"
              class="hidden shrink-0 sm:inline-flex"
            >
              Ingest Selected ({{ selectedCount }})
            </BaseButton>
          </div>

          <div class="-mx-2 min-h-0 flex-1 overflow-y-auto px-2 py-1">
            <div v-if="filteredDocuments.length" class="space-y-4">
              <div
                v-for="document in filteredDocuments"
                :key="document.id"
                role="checkbox"
                tabindex="0"
                :aria-checked="!!document.selected"
                :class="[
                  'cursor-pointer rounded-xl border bg-surface p-4 shadow-card transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2',
                  document.selected
                    ? 'border-accent ring-1 ring-accent bg-accent-soft/30'
                    : 'border-border hover:border-border-strong hover:bg-surface-subtle',
                ]"
                @click="toggleDocument(document)"
                @keydown.enter.prevent="toggleDocument(document)"
                @keydown.space.prevent="toggleDocument(document)"
              >
                <div class="mb-3 flex items-start justify-between gap-4">
                  <div class="flex min-w-0 items-center gap-3">
                    <span class="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-danger text-text-inverse">
                      <Icon :icon="Pdf01Icon" :size="22" />
                    </span>
                    <div class="min-w-0">
                      <div class="flex flex-wrap items-center gap-2">
                        <h2 class="truncate text-body font-semibold text-text">{{ document.name }}</h2>
                        <BaseBadge :tone="statusTone(document.status)" dot>
                          {{ document.status }}
                        </BaseBadge>
                      </div>
                      <p class="text-caption text-text-muted">{{ document.date }}</p>
                    </div>
                  </div>
                  <div class="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      class="grid h-8 w-8 place-items-center rounded-lg text-danger transition hover:bg-danger-soft"
                      aria-label="Delete document"
                      @click.stop
                    >
                      <Icon :icon="Delete02Icon" :size="18" />
                    </button>
                    <button
                      type="button"
                      class="grid h-8 w-8 place-items-center rounded-lg text-text-muted transition hover:bg-surface-subtle hover:text-text"
                      aria-label="Download document"
                      @click.stop
                    >
                      <Icon :icon="Download04Icon" :size="18" />
                    </button>
                  </div>
                </div>
                <p class="text-caption leading-relaxed text-text-muted">
                  AI humor can be a delightful mix of clever algorithms and unexpected punchlines. It's like having a virtual comedian in your device, ready to crack a joke at the tap of a button.
                </p>
              </div>
            </div>

            <EmptyState
              v-else-if="documentSearch.trim()"
              :icon="Search01Icon"
              title="No matches"
              description="No documents match your search. Try a different keyword."
            >
              <BaseButton variant="outline" @click="documentSearch = ''">Clear search</BaseButton>
            </EmptyState>

            <EmptyState
              v-else
              :icon="CloudUploadIcon"
              title="No documents yet"
              description="Upload knowledge files to attach them to your AI Twins."
            >
              <BaseButton variant="primary" @click="uploadOpen = true">
                <Icon :icon="Upload01Icon" :size="16" />
                Add Knowledge
              </BaseButton>
            </EmptyState>
          </div>

          <footer class="mt-5 flex items-center justify-between">
            <BaseButton variant="outline" rounded="full">Cancel</BaseButton>
            <BaseButton variant="primary" rounded="full" @click="mode = 'twins'">
              Select
            </BaseButton>
          </footer>
        </template>

        <template v-else>
          <header class="mb-4 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <h1 class="text-headline text-text">Select AI Twins to Add files for them</h1>
            <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div class="w-full sm:w-80 lg:w-[460px]">
                <BaseInput v-model="twinSearch" placeholder="Search" rounded="full">
                  <template #leading><Icon :icon="Search01Icon" :size="18" /></template>
                </BaseInput>
              </div>
              <BaseButton variant="primary" rounded="full">
                <Icon :icon="AddCircleIcon" :size="17" />
                Create AI Twin
              </BaseButton>
            </div>
          </header>

          <div class="min-h-0 flex-1 overflow-y-auto pr-1">
            <div v-if="filteredTwins.length" class="grid gap-4 xl:grid-cols-2">
              <button
                v-for="twin in filteredTwins"
                :key="twin.id"
                type="button"
                :class="[
                  'rounded-xl border bg-surface p-4 text-left shadow-card transition',
                  twin.selected ? 'border-accent ring-1 ring-accent' : 'border-border hover:border-border-strong',
                ]"
                @click="selectTwin(twin)"
              >
                <div class="mb-5 flex items-start justify-between gap-4">
                  <div class="flex min-w-0 items-center gap-4">
                    <BaseAvatar :src="`https://i.pravatar.cc/96?img=${20 + twin.id}`" :name="twin.name" size="lg" />
                    <h2 class="truncate text-title text-text">{{ twin.name }}</h2>
                  </div>
                  <span
                    :class="[
                      'mt-3 grid h-4 w-4 shrink-0 place-items-center rounded-full border',
                      twin.selected ? 'border-accent ring-4 ring-accent-soft' : 'border-text-subtle',
                    ]"
                    aria-hidden="true"
                  >
                    <span v-if="twin.selected" class="h-2 w-2 rounded-full bg-accent" />
                  </span>
                </div>

                <div class="mb-4 flex items-center justify-between gap-4 text-meta">
                  <span class="font-semibold text-text">Date Edited</span>
                  <span class="text-text-muted">{{ twin.dateEdited }}</span>
                </div>

                <dl class="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-border-subtle text-meta">
                  <div class="grid grid-cols-2 gap-2 bg-surface-muted px-3 py-3">
                    <dt class="font-semibold text-text">Voice Library</dt>
                    <dd class="text-text-muted">{{ twin.voice }}</dd>
                  </div>
                  <div class="grid grid-cols-2 gap-2 bg-surface-muted px-3 py-3">
                    <dt class="font-semibold text-text">Number of Chats</dt>
                    <dd class="text-right text-text-muted">{{ twin.chats }}</dd>
                  </div>
                  <div class="grid grid-cols-2 gap-2 bg-surface-muted px-3 py-3">
                    <dt class="font-semibold text-text">Date Created</dt>
                    <dd class="text-text-muted">{{ twin.dateCreated }}</dd>
                  </div>
                  <div class="grid grid-cols-2 gap-2 bg-surface-muted px-3 py-3">
                    <dt class="font-semibold text-text">Number of Calls</dt>
                    <dd class="text-right text-text-muted">{{ twin.calls }}</dd>
                  </div>
                </dl>
              </button>
            </div>

            <EmptyState
              v-else
              :icon="Search01Icon"
              title="No matches"
              description="No AI Twins match your search."
            >
              <BaseButton variant="outline" @click="twinSearch = ''">Clear search</BaseButton>
            </EmptyState>
          </div>

          <footer class="mt-5 flex items-center justify-between">
            <BaseButton variant="outline" rounded="full" @click="mode = 'documents'">
              Cancel
            </BaseButton>
            <BaseButton variant="primary" rounded="full">
              Select Twin
            </BaseButton>
          </footer>
        </template>
      </div>

      <BaseDrawer
        v-model:open="uploadOpen"
        title="Add Upload Knowledge"
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
            @click="uploadOpen = false"
          >
            Cancel
          </button>
          <BaseButton variant="primary" @click="uploadOpen = false">
            Add Knowledge
          </BaseButton>
        </template>
      </BaseDrawer>
    </section>
  </DashboardLayout>
</template>
