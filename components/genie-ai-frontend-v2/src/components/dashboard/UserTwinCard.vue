<script setup lang="ts">
import { useRouter } from 'vue-router';
import BaseAvatar from '../ui/BaseAvatar.vue';
import BaseButton from '../ui/BaseButton.vue';
import type { PublicAiTwin } from '../../services/aiTwins';
import { useT } from '../../i18n/composables';
import { useTranslated } from '../../composables/useTranslated';

const { t } = useT();

const props = defineProps<{
  twin: PublicAiTwin;
}>();

const router = useRouter();

const { value: translatedName } = useTranslated(() => props.twin.name, 'en');
const { value: translatedDescription } = useTranslated(() => props.twin.description ?? '', 'en');

function viewDetails() {
  router.push({ name: 'user-twin-detail', params: { id: props.twin._key } });
}
</script>

<template>
  <article
    class="flex flex-col gap-4 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm transition hover:border-ieee-200 hover:shadow-md"
  >
    <header class="flex items-center gap-3">
      <BaseAvatar :src="''" :name="twin.name" size="lg" />
      <h3 class="truncate text-base font-semibold text-slate-900">{{ translatedName }}</h3>
    </header>

    <p v-if="translatedDescription" class="line-clamp-3 text-sm text-slate-600">
      {{ translatedDescription }}
    </p>

    <div class="mt-auto flex items-center justify-end gap-2">
      <BaseButton variant="soft" size="md" rounded="full" @click="viewDetails">
        {{ t('twins.list.card.view', 'View AI Twin') }}
      </BaseButton>
    </div>
  </article>
</template>
