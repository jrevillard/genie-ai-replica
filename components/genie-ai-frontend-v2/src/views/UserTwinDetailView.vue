<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowLeft01Icon, Cancel01Icon, Comment01Icon } from '@hugeicons/core-free-icons';
import { storeToRefs } from 'pinia';
import BaseAvatar from '../components/ui/BaseAvatar.vue';
import BaseButton from '../components/ui/BaseButton.vue';
import AiTwinDetailSkeleton from '../components/ui/skeletons/AiTwinDetailSkeleton.vue';
import EmptyState from '../components/ui/EmptyState.vue';
import Icon from '../components/ui/Icon.vue';
import DashboardLayout from '../layouts/DashboardLayout.vue';
import { useAiTwinsStore } from '../stores/aiTwins';
import { useT } from '../i18n/composables';
import { useTranslated } from '../composables/useTranslated';

const { t } = useT();
const route = useRoute();
const router = useRouter();
const store = useAiTwinsStore();
const { current: twin, loading } = storeToRefs(store);

const twinId = computed(() => String(route.params.id ?? ''));

async function loadTwin() {
  if (!twinId.value) return;
  try {
    await store.fetchOne(twinId.value);
  } catch {
    // store.error is already set; the empty state below will render.
  }
}

onMounted(loadTwin);
watch(twinId, loadTwin);

function goBack() {
  router.push({ name: 'user-home' });
}

function chatWithTwin() {
  if (!twin.value) return;
  router.push({ name: 'chat', params: { twinId: twin.value._key } });
}

const { value: tName } = useTranslated(() => twin.value?.name ?? '', 'en');
const { value: tDescription } = useTranslated(() => twin.value?.description ?? '', 'en');
const { value: tChatGreeting } = useTranslated(() => twin.value?.chatGreeting ?? '', 'en');
</script>

<template>
  <DashboardLayout>
    <section class="min-h-full space-y-6 bg-surface p-6 pb-10">
      <button
        type="button"
        class="inline-flex items-center gap-1 rounded-full bg-surface-muted p-2 text-text-muted transition hover:bg-surface-subtle hover:text-text"
        :aria-label="t('common.goBack', 'Go back')"
        @click="goBack"
      >
        <Icon :icon="ArrowLeft01Icon" :size="18" />
      </button>

      <template v-if="twin">
        <header class="flex flex-wrap items-center justify-between gap-4">
          <div class="flex items-center gap-4">
            <BaseAvatar :src="twin.profilePicUrl ?? ''" :name="twin.name" size="xl" />
            <div class="flex flex-col gap-1">
              <h1 class="text-headline text-text">{{ tName }}</h1>
            </div>
          </div>
          <BaseButton variant="primary" size="md" rounded="xl" @click="chatWithTwin">
            <Icon :icon="Comment01Icon" :size="16" />
            {{ t('user.twins.chat', 'Chat With Twin') }}
          </BaseButton>
        </header>

        <div class="rounded-2xl border border-border bg-surface p-6 shadow-card">
          <h2 class="text-title text-text">{{ t('user.twins.about', 'About') }}</h2>
          <p v-if="tDescription" class="mt-3 whitespace-pre-line text-body text-text">
            {{ tDescription }}
          </p>
          <p v-else class="mt-3 text-body text-text-muted">
            {{ t('user.twins.noDescription', 'No description provided.') }}
          </p>

          <template v-if="tChatGreeting">
            <h2 class="mt-6 text-title text-text">{{ t('user.twins.greeting', 'Greeting') }}</h2>
            <p class="mt-3 whitespace-pre-line text-body text-text">{{ tChatGreeting }}</p>
          </template>
        </div>
      </template>

      <AiTwinDetailSkeleton v-else-if="loading" />

      <EmptyState
        v-else-if="store.error"
        :icon="Cancel01Icon"
        :title="t('twins.detail.loadFailedTitle', `Couldn't load AI Twin`)"
        :description="store.error"
      >
        <BaseButton variant="primary" @click="loadTwin">{{ t('common.retry', 'Retry') }}</BaseButton>
      </EmptyState>

      <EmptyState
        v-else
        :icon="Cancel01Icon"
        :title="t('twins.detail.notFoundTitle', 'Twin not found')"
        :description="t('twins.detail.notFoundBody', `This AI Twin doesn't exist or has been deleted.`)"
      >
        <BaseButton variant="primary" @click="goBack">{{ t('twins.detail.backToList', 'Back to list') }}</BaseButton>
      </EmptyState>
    </section>
  </DashboardLayout>
</template>
