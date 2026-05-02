<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  AddCircleIcon,
  CloudUploadIcon,
  Delete02Icon,
  Download04Icon,
  Pdf01Icon,
} from '@hugeicons/core-free-icons';
import BaseAvatar from '../components/ui/BaseAvatar.vue';
import BaseCheckbox from '../components/ui/BaseCheckbox.vue';
import Icon from '../components/ui/Icon.vue';
import ShadBadge from '../components/ui/shadcn/Badge.vue';
import ShadButton from '../components/ui/shadcn/Button.vue';
import ShadCard from '../components/ui/shadcn/Card.vue';
import ShadDialog from '../components/ui/shadcn/Dialog.vue';
import ShadInput from '../components/ui/shadcn/Input.vue';
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
const documentSearch = ref('');
const twinSearch = ref('');

const allDocumentsSelected = computed({
  get: () => documents.value.length > 0 && documents.value.every((document) => document.selected),
  set: (value: boolean) => {
    documents.value.forEach((document) => {
      document.selected = value;
    });
  },
});

function setDocumentSelected(document: DocumentItem, selected: boolean) {
  document.selected = selected;
}

function selectTwin(twin: Twin) {
  twins.value.forEach((item) => {
    item.selected = item.id === twin.id;
  });
}
</script>

<template>
  <DashboardLayout>
    <section class="h-full min-h-0 bg-white p-4 md:p-6">
      <div class="flex h-full min-h-[700px] flex-col">
        <template v-if="mode === 'documents'">
          <header class="mb-4 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h1 class="text-lg font-bold text-slate-950">Document Management</h1>
            </div>
            <ShadButton
              variant="secondary"
              class="self-start lg:self-auto"
              @click="uploadOpen = true"
            >
              Add Knowledge
            </ShadButton>
          </header>

          <div class="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <label class="block w-full max-w-md">
              <ShadInput
                v-model="documentSearch"
                placeholder="Search by file name"
                class="rounded-full"
              />
            </label>
          </div>

          <div class="mb-5 flex items-center justify-between gap-3">
            <BaseCheckbox v-model="allDocumentsSelected" size="sm" class="min-w-0">
              <span class="truncate text-base font-bold text-slate-800">Select Files To Add Them For The Twins</span>
            </BaseCheckbox>
            <ShadButton variant="secondary" class="hidden shrink-0 sm:inline-flex">
              Ingest Selected
            </ShadButton>
          </div>

          <div class="min-h-0 flex-1 overflow-y-auto pr-1">
            <div class="space-y-4">
              <article
                v-for="document in documents"
                :key="document.id"
                class="grid grid-cols-[24px_minmax(0,1fr)] gap-3"
              >
                <BaseCheckbox
                  :model-value="document.selected"
                  size="sm"
                  class="mt-8 justify-center"
                  @update:model-value="setDocumentSelected(document, $event)"
                />
                <ShadCard class="p-4">
                  <div class="mb-3 flex items-start justify-between gap-4">
                    <div class="flex min-w-0 items-center gap-3">
                      <span class="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-red-700 text-white">
                        <Icon :icon="Pdf01Icon" :size="22" />
                      </span>
                      <div class="min-w-0">
                        <div class="flex flex-wrap items-center gap-2">
                          <h2 class="truncate text-sm font-bold text-slate-900">{{ document.name }}</h2>
                          <ShadBadge
                            :class="[
                              document.status === 'Pending' && 'bg-white text-neutral-600',
                              document.status === 'Ingesting' && 'bg-ieee-100 text-ieee-800',
                              document.status === 'Ingested' && 'bg-ieee-700 text-white',
                            ]"
                          >
                            {{ document.status }}
                          </ShadBadge>
                        </div>
                        <p class="text-xs text-slate-500">{{ document.date }}</p>
                      </div>
                    </div>
                    <div class="flex shrink-0 items-center gap-2">
                      <button type="button" class="text-red-500 transition hover:text-red-600" aria-label="Delete document">
                        <Icon :icon="Delete02Icon" :size="18" />
                      </button>
                      <button type="button" class="text-neutral-400 transition hover:text-ieee-800" aria-label="Download document">
                        <Icon :icon="Download04Icon" :size="18" />
                      </button>
                    </div>
                  </div>
                  <p class="text-xs leading-relaxed text-slate-500">
                    AI humor can be a delightful mix of clever algorithms and unexpected punchlines. It's like having a virtual comedian in your device, ready to crack a joke at the tap of a button. From witty wordplay to quirky observations, AI's humor is a unique blend of human creativity and machine logic.
                  </p>
                </ShadCard>
              </article>
            </div>
          </div>

          <footer class="mt-5 flex items-center justify-between">
            <ShadButton variant="outline">
              Cancel
            </ShadButton>
            <ShadButton
              variant="secondary"
              @click="mode = 'twins'"
            >
              Select
            </ShadButton>
          </footer>
        </template>

        <template v-else>
          <header class="mb-4 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <h1 class="text-lg font-bold text-slate-950">Select AI Twins to Add files for them</h1>
            <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
              <label class="block w-full sm:w-80 lg:w-[460px]">
                <ShadInput
                  v-model="twinSearch"
                  placeholder="Search"
                  class="rounded-full"
                />
              </label>
              <ShadButton variant="secondary">
                <Icon :icon="AddCircleIcon" :size="17" />
                Create Ai Twin
              </ShadButton>
            </div>
          </header>

          <div class="min-h-0 flex-1 overflow-y-auto pr-1">
            <div class="grid gap-4 xl:grid-cols-2">
              <ShadCard
                v-for="twin in twins"
                :key="twin.id"
                :class="[
                  'p-4 transition',
                  twin.selected ? 'border-ieee-700 ring-1 ring-ieee-700' : 'hover:border-neutral-300',
                ]"
              >
                <div class="mb-5 flex items-start justify-between gap-4">
                  <div class="flex min-w-0 items-center gap-4">
                    <BaseAvatar :src="`https://i.pravatar.cc/96?img=${20 + twin.id}`" :name="twin.name" size="lg" />
                    <h2 class="truncate text-lg font-bold text-slate-950">{{ twin.name }}</h2>
                  </div>
                  <button
                    type="button"
                    :class="[
                      'mt-3 grid h-4 w-4 place-items-center rounded-full border',
                      twin.selected ? 'border-ieee-700 ring-4 ring-ieee-50' : 'border-slate-400',
                    ]"
                    aria-label="Select AI Twin"
                    @click="selectTwin(twin)"
                  >
                    <span v-if="twin.selected" class="h-2 w-2 rounded-full bg-ieee-700" />
                  </button>
                </div>

                <div class="mb-4 flex items-center justify-between gap-4 text-xs">
                  <span class="font-bold text-slate-900">Date Edited</span>
                  <span class="text-slate-700">{{ twin.dateEdited }}</span>
                </div>

                <dl class="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-slate-100 text-xs">
                  <div class="grid grid-cols-2 gap-2 bg-slate-50 px-3 py-3">
                    <dt class="font-bold text-slate-900">Voice Library</dt>
                    <dd class="text-slate-600">{{ twin.voice }}</dd>
                  </div>
                  <div class="grid grid-cols-2 gap-2 bg-slate-50 px-3 py-3">
                    <dt class="font-bold text-slate-900">Number of Chats</dt>
                    <dd class="text-right text-slate-700">{{ twin.chats }}</dd>
                  </div>
                  <div class="grid grid-cols-2 gap-2 bg-slate-50 px-3 py-3">
                    <dt class="font-bold text-slate-900">Date Created</dt>
                    <dd class="text-slate-600">{{ twin.dateCreated }}</dd>
                  </div>
                  <div class="grid grid-cols-2 gap-2 bg-slate-50 px-3 py-3">
                    <dt class="font-bold text-slate-900">Number of Calls</dt>
                    <dd class="text-right text-slate-700">{{ twin.calls }}</dd>
                  </div>
                </dl>
              </ShadCard>
            </div>
          </div>

          <footer class="mt-5 flex items-center justify-between">
            <ShadButton
              variant="outline"
              @click="mode = 'documents'"
            >
              Cancel
            </ShadButton>
            <ShadButton variant="secondary">
              Select Twin
            </ShadButton>
          </footer>
        </template>
      </div>

      <ShadDialog v-model:open="uploadOpen" content-class="flex max-h-[88vh] max-w-3xl flex-col p-6 md:p-7">
            <header class="mb-6">
              <h2 class="text-2xl font-bold text-slate-950">Add Upload Knowledge</h2>
              <p class="mt-4 text-base text-slate-600">
                For further accuracy, you can upload file below to train your Agent to sound more like you.
              </p>
            </header>

            <label class="grid min-h-[260px] flex-1 cursor-pointer place-items-center rounded-2xl border border-neutral-200 bg-neutral-50 p-8 transition hover:border-ieee-700 hover:bg-ieee-50/40 md:min-h-[320px]">
              <input type="file" class="sr-only" multiple />
              <span class="flex flex-col items-center text-center">
                <Icon :icon="CloudUploadIcon" :size="58" color="#cfd4dc" />
                <span class="mt-5 text-2xl font-semibold text-slate-300">Upload File</span>
                <span class="mt-4 max-w-2xl text-sm text-slate-400">
                  File types allowed to be uploaded: Pdf, word doc, excel, csv, txt, mov, and mp4.
                </span>
              </span>
            </label>

            <footer class="mt-6 flex justify-end gap-3">
              <ShadButton variant="secondary" size="lg" @click="uploadOpen = false">
                Add Knowledge
              </ShadButton>
            </footer>
      </ShadDialog>
    </section>
  </DashboardLayout>
</template>
