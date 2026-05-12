<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Cancel01Icon, SparklesIcon } from '@hugeicons/core-free-icons';
import BaseAvatar from '../ui/BaseAvatar.vue';
import Icon from '../ui/Icon.vue';
import type { AiTwin } from '../../services/aiTwins';
import { useT } from '../../i18n/composables';
import { useTranslated } from '../../composables/useTranslated';

const { t } = useT();

const props = defineProps<{
  twin: AiTwin;
}>();

const { value: translatedName } = useTranslated(() => props.twin.name, 'en');

const router = useRouter();

const dateEdited = computed(() => formatDate(props.twin.updatedAt));
const dateCreated = computed(() => formatDate(props.twin.createdAt));

const dateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

function formatDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return dateTimeFormatter.format(d);
}

function open() {
  router.push({ name: 'ai-twin-detail', params: { id: props.twin._key } });
}

const imagePreviewOpen = ref(false);
const hasAvatar = computed(() => Boolean(props.twin.profilePicUrl));

function openImagePreview() {
  if (!hasAvatar.value) return;
  imagePreviewOpen.value = true;
}

function closeImagePreview() {
  imagePreviewOpen.value = false;
}
</script>

<template>
  <article
    class="flex flex-col gap-4 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm transition hover:border-ieee-200 hover:shadow-md"
  >
    <!-- Header: avatar + name + optional Default pill -->
    <header class="flex items-center gap-3">
      <button
        type="button"
        :class="[
          'block rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ieee-700/40',
          hasAvatar ? 'cursor-zoom-in' : 'cursor-default',
        ]"
        :aria-label="hasAvatar ? t('twins.list.card.previewProfile', { name: twin.name }, `Preview {name}'s profile picture`) : t('common.profilePicture', 'Profile picture')"
        :disabled="!hasAvatar"
        @click="openImagePreview"
      >
        <BaseAvatar :src="twin.profilePicUrl ?? ''" :name="twin.name" size="lg" />
      </button>
      <div class="flex min-w-0 flex-1 items-center gap-2">
        <h3 class="truncate text-base font-semibold text-slate-900">{{ translatedName }}</h3>
        <span
          v-if="twin.isDefault"
          class="inline-flex shrink-0 items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent ring-1 ring-inset ring-accent/15"
          :title="t('twins.list.card.defaultTooltip', 'This is your default AI Twin')"
        >
          <Icon :icon="SparklesIcon" :size="11" />
          {{ t('twins.list.card.default', 'Default') }}
        </span>
      </div>
    </header>

    <div class="grid grid-cols-2 items-center gap-x-6 rounded-2xl bg-neutral-50 px-4 py-3 text-xs">
      <dl class="flex flex-col gap-y-2">
        <div class="flex items-center justify-between gap-3">
          <dt class="text-slate-500">{{ t('twins.list.card.dateCreated', 'Date Created') }}</dt>
          <dd class="font-medium text-slate-800">{{ dateCreated }}</dd>
        </div>
        <div class="flex items-center justify-between gap-3">
          <dt class="text-slate-500">{{ t('twins.list.card.dateEdited', 'Date Edited') }}</dt>
          <dd class="font-medium text-slate-800">{{ dateEdited }}</dd>
        </div>
      </dl>
      <div class="flex flex-col justify-center gap-2 border-l border-slate-200 pl-6">
        <div class="flex items-center justify-between gap-3">
          <span class="text-slate-500">{{ t('twins.list.card.kbFiles', 'KB Files') }}</span>
          <span class="font-medium text-slate-800">{{ twin.linkedKbFileIds.length }}</span>
        </div>
        <div
          v-if="twin.twinNumber && twin.twinNumber.trim()"
          class="flex items-center justify-between gap-3"
        >
          <span class="text-slate-500">{{ t('twins.list.card.twinNumber', 'Twin Number') }}</span>
          <span class="font-medium text-slate-800" :title="twin.twinNumber">{{ twin.twinNumber }}</span>
        </div>
      </div>
    </div>

    <!-- Action: View AI Twin — matches BaseButton primary (ieee-700) so it
         reads as the same accent as "Create AI Twin" in the page header. -->
    <div class="flex justify-end">
      <button
        type="button"
        class="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-ieee-700 px-5 text-sm font-semibold text-white shadow-sm transition-colors duration-200 hover:bg-ieee-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ieee-700"
        @click="open"
      >
        {{ t('twins.list.card.view', 'View AI Twin') }}
      </button>
    </div>

    <Teleport to="body">
      <div
        v-if="imagePreviewOpen && twin.profilePicUrl"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6"
        role="dialog"
        aria-modal="true"
        :aria-label="t('common.profilePicturePreview', 'Profile picture preview')"
        @click.self="closeImagePreview"
        @keydown.esc="closeImagePreview"
      >
        <button
          type="button"
          class="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white transition hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          :aria-label="t('common.closePreview', 'Close preview')"
          @click="closeImagePreview"
        >
          <Icon :icon="Cancel01Icon" :size="20" />
        </button>
        <img
          :src="twin.profilePicUrl"
          :alt="twin.name"
          class="max-h-[85vh] max-w-[85vw] rounded-2xl object-contain shadow-2xl"
          @click.stop
        />
      </div>
    </Teleport>
  </article>
</template>
