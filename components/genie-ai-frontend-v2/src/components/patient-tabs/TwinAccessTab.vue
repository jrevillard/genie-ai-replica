<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import { storeToRefs } from 'pinia';
import { ShieldEnergyIcon, SparklesIcon } from '@hugeicons/core-free-icons';
import BaseAvatar from '../ui/BaseAvatar.vue';
import BaseButton from '../ui/BaseButton.vue';
import BaseToggle from '../ui/BaseToggle.vue';
import TwinAccessTabSkeleton from '../ui/skeletons/TwinAccessTabSkeleton.vue';
import EmptyState from '../ui/EmptyState.vue';
import Icon from '../ui/Icon.vue';
import { notify } from '../../lib/notify';
import { useAiTwinsStore } from '../../stores/aiTwins';
import { usePatientsStore } from '../../stores/patients';
import type { Patient } from '../../services/patients';
import { useT } from '../../i18n/composables';

const { t } = useT();

const props = defineProps<{ patient: Patient }>();

const router = useRouter();
const twinsStore = useAiTwinsStore();
const patientsStore = usePatientsStore();
const { twins, loading: twinsLoading } = storeToRefs(twinsStore);
const { currentAccess, accessLoading } = storeToRefs(patientsStore);

// `null` allowedTwinIds = no whitelist (unrestricted). Anything else (array) =
// the user is restricted to exactly that list.
const restricted = computed(() => Array.isArray(currentAccess.value?.allowedTwinIds));
const allowedSet = computed<Set<string>>(
  () => new Set(currentAccess.value?.allowedTwinIds ?? [])
);

async function load(): Promise<void> {
  await Promise.all([
    twins.value.length ? Promise.resolve() : twinsStore.fetchAll().catch(() => undefined),
    patientsStore.fetchAccess(props.patient._key).catch(() => {
      notify.error(
        patientsStore.error ?? t('patients.access.loadFailedToast', 'Failed to load twin access')
      );
    }),
  ]);
}

onMounted(load);
watch(() => props.patient._key, load);

async function toggleRestricted(on: boolean): Promise<void> {
  // Restrict ON → start with empty whitelist (block all). Restrict OFF →
  // wipe to null (every twin visible).
  try {
    const result = await patientsStore.setAccess(props.patient._key, on ? [] : null);
    notify.success(
      result.message ??
        (on
          ? t('patients.access.restrictedOnToast', 'Twin access restricted')
          : t('patients.access.restrictedOffToast', 'Twin access unrestricted'))
    );
  } catch {
    notify.error(
      patientsStore.error ?? t('patients.access.setFailedToast', 'Failed to update twin access')
    );
  }
}

async function toggleTwin(twinId: string, on: boolean): Promise<void> {
  try {
    const result = on
      ? await patientsStore.enableTwin(props.patient._key, twinId)
      : await patientsStore.disableTwin(props.patient._key, twinId);
    notify.success(
      result.message ??
        (on
          ? t('patients.access.enabledToast', 'Twin enabled')
          : t('patients.access.disabledToast', 'Twin disabled'))
    );
  } catch {
    notify.error(
      patientsStore.error ??
        (on
          ? t('patients.access.enableFailedToast', 'Failed to enable twin')
          : t('patients.access.disableFailedToast', 'Failed to disable twin'))
    );
  }
}

function goToTwins(): void {
  router.push({ name: 'ai-twins' });
}

const isLoading = computed(() => accessLoading.value || twinsLoading.value);
</script>

<template>
  <!-- Initial-load skeleton: shown only on first render before either store
       has resolved. Subsequent toggles do not flash the skeleton. -->
  <TwinAccessTabSkeleton v-if="isLoading && !currentAccess && !twins.length" />

  <div v-else class="space-y-6">
    <header>
      <h2 class="text-title text-text">{{ t('patients.access.title', 'AI Twin Access') }}</h2>
      <p class="mt-0.5 text-caption text-text-muted">
        {{ t('patients.access.subtitle', 'Control which AI Twins this user can chat or call with. Changes save automatically.') }}
      </p>
    </header>

    <!-- Master toggle: Restrict twin access on/off -->
    <section class="flex items-start justify-between gap-4 rounded-2xl border border-border bg-surface p-4 shadow-card">
      <div class="flex items-start gap-3">
        <span class="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
          <Icon :icon="ShieldEnergyIcon" :size="20" />
        </span>
        <div>
          <p class="text-body font-semibold text-text">
            {{ t('patients.access.restrictLabel', 'Restrict twin access') }}
          </p>
          <p class="mt-0.5 max-w-xl text-caption text-text-muted">
            {{
              restricted
                ? t('patients.access.restrictedHelp', 'This user can only see the AI Twins you enable below.')
                : t('patients.access.unrestrictedHelp', 'This user can access every AI Twin you own.')
            }}
          </p>
        </div>
      </div>
      <BaseToggle
        :model-value="restricted"
        :disabled="isLoading"
        @update:model-value="toggleRestricted"
      />
    </section>

    <!-- Per-twin list (only when restricted = true) -->
    <section v-if="restricted" class="space-y-3">
      <header class="flex items-center justify-between gap-3">
        <h3 class="text-body font-semibold text-text">
          {{ t('patients.access.listTitle', 'Allowed AI Twins') }}
        </h3>
        <span
          v-if="restricted && twins.length"
          class="inline-flex items-center rounded-full bg-accent-soft px-2 py-0.5 text-meta font-semibold text-accent"
        >
          {{ allowedSet.size }} / {{ twins.length }}
        </span>
      </header>

      <ul v-if="twins.length" class="space-y-2">
        <li
          v-for="twin in twins"
          :key="twin._key"
          class="flex items-center gap-3 rounded-2xl border border-border bg-surface px-3 py-2.5 shadow-card transition hover:border-accent/40"
        >
          <BaseAvatar :src="twin.profilePicUrl ?? ''" :name="twin.name" size="md" />
          <div class="min-w-0 flex-1">
            <p class="truncate text-body font-medium text-text">{{ twin.name }}</p>
            <p v-if="twin.description" class="truncate text-caption text-text-muted">
              {{ twin.description }}
            </p>
          </div>
          <BaseToggle
            :model-value="allowedSet.has(twin._key)"
            :disabled="accessLoading"
            @update:model-value="(v: boolean) => toggleTwin(twin._key, v)"
          />
        </li>
      </ul>

      <EmptyState
        v-else
        :icon="SparklesIcon"
        :title="t('patients.access.noTwinsTitle', 'No AI Twins yet')"
        :description="t('patients.access.noTwinsBody', `You haven't created any AI Twins yet. Create one before assigning user access.`)"
      >
        <BaseButton variant="primary" rounded="full" @click="goToTwins">
          {{ t('patients.access.createTwinCta', 'Create your first AI Twin') }}
        </BaseButton>
      </EmptyState>
    </section>
  </div>
</template>
