<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { Cancel01Icon, PlusSignIcon, Search01Icon, UserMultipleIcon } from '@hugeicons/core-free-icons';
import { storeToRefs } from 'pinia';
import { notify } from '../lib/notify';
import PatientCard from '../components/dashboard/PatientCard.vue';
import CreatePatientDialog from '../components/dashboard/CreatePatientDialog.vue';
import BaseButton from '../components/ui/BaseButton.vue';
import BaseInput from '../components/ui/BaseInput.vue';
import PatientCardSkeleton from '../components/ui/skeletons/PatientCardSkeleton.vue';
import EmptyState from '../components/ui/EmptyState.vue';
import Icon from '../components/ui/Icon.vue';
import DashboardLayout from '../layouts/DashboardLayout.vue';
import { usePatientsStore } from '../stores/patients';
import type { CreatePatientPayload } from '../services/patients';
import { useT } from '../i18n/composables';

const { t } = useT();
const store = usePatientsStore();
const { patients, loading } = storeToRefs(store);

const search = ref('');
const dialogOpen = ref(false);
const creating = ref(false);

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase();
  if (!q) return patients.value;
  return patients.value.filter((p) => {
    const name = p.personalIdentification?.fullName?.toLowerCase() ?? '';
    const email = p.email?.toLowerCase() ?? '';
    const login = p.loginName?.toLowerCase() ?? '';
    return name.includes(q) || email.includes(q) || login.includes(q);
  });
});

function loadPatients() {
  store.fetchAll().catch(() => {
    notify.error(store.error ?? t('patients.list.loadFailedToast', 'Failed to load users'));
  });
}

onMounted(loadPatients);

async function onCreated(payload: CreatePatientPayload) {
  if (creating.value) return;
  creating.value = true;
  try {
    await store.create(payload);
    notify.success(t('patients.list.createdToast', 'User created'));
    dialogOpen.value = false;
  } catch {
    notify.error(store.error ?? t('patients.list.createFailedToast', 'Failed to create user'));
  } finally {
    creating.value = false;
  }
}
</script>

<template>
  <DashboardLayout>
    <section class="space-y-6 bg-surface p-6">
      <header class="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
          <h1 class="text-headline text-text">{{ t('patients.list.title', 'Users') }}</h1>
          <div class="w-full sm:w-[360px]">
            <BaseInput
              v-model="search"
              :placeholder="t('patients.list.searchPlaceholder', 'Search by name or email')"
              size="md"
              rounded="full"
            >
              <template #leading><Icon :icon="Search01Icon" :size="18" /></template>
              <template v-if="search" #trailing>
                <button
                  type="button"
                  class="-my-1.5 grid h-7 w-7 place-items-center rounded-full text-text-muted transition hover:bg-surface-subtle hover:text-text"
                  :aria-label="t('patients.list.clearSearch', 'Clear search')"
                  @click="search = ''"
                >
                  <Icon :icon="Cancel01Icon" :size="14" />
                </button>
              </template>
            </BaseInput>
          </div>
        </div>
        <BaseButton variant="primary" size="md" rounded="full" @click="dialogOpen = true">
          <Icon :icon="PlusSignIcon" :size="16" />
          {{ t('patients.list.create', 'Add User') }}
        </BaseButton>
      </header>

      <div v-if="loading && !filtered.length" class="grid gap-4 lg:grid-cols-2">
        <PatientCardSkeleton v-for="n in 4" :key="n" />
      </div>

      <div v-else-if="filtered.length" class="grid gap-4 lg:grid-cols-2">
        <PatientCard v-for="patient in filtered" :key="patient._key" :patient="patient" />
      </div>

      <EmptyState
        v-else-if="store.error && !search.trim()"
        full-height
        :icon="UserMultipleIcon"
        :title="t('patients.list.loadFailedTitle', `Couldn't load users`)"
        :description="store.error"
      >
        <BaseButton variant="primary" size="md" @click="loadPatients">{{ t('common.retry', 'Retry') }}</BaseButton>
      </EmptyState>

      <EmptyState
        v-else-if="search.trim()"
        full-height
        :icon="Search01Icon"
        :title="t('patients.list.noMatchesTitle', 'No matches')"
        :description="t('patients.list.noMatchesBody', 'No users match your search. Try a different keyword or clear the filter.')"
      >
        <BaseButton variant="outline" size="md" @click="search = ''">{{ t('patients.list.clearSearch', 'Clear search') }}</BaseButton>
      </EmptyState>

      <EmptyState
        v-else
        full-height
        :icon="UserMultipleIcon"
        :title="t('patients.list.emptyTitle', 'No users yet')"
        :description="t('patients.list.emptyBody', `Add your first user to start managing their AI Twin access.`)"
      />
    </section>

    <CreatePatientDialog v-model:open="dialogOpen" :submitting="creating" @created="onCreated" />
  </DashboardLayout>
</template>
