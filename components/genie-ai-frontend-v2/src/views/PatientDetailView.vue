<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  ArrowLeft01Icon,
  Cancel01Icon,
  Delete02Icon,
  Edit02Icon,
} from '@hugeicons/core-free-icons';
import { storeToRefs } from 'pinia';
import { notify } from '../lib/notify';
import BaseAvatar from '../components/ui/BaseAvatar.vue';
import BaseBadge from '../components/ui/BaseBadge.vue';
import BaseButton from '../components/ui/BaseButton.vue';
import ConfirmDialog from '../components/ui/ConfirmDialog.vue';
import PatientDetailSkeleton from '../components/ui/skeletons/PatientDetailSkeleton.vue';
import BaseTabs, { type TabItem } from '../components/ui/BaseTabs.vue';
import EmptyState from '../components/ui/EmptyState.vue';
import Icon from '../components/ui/Icon.vue';
import DashboardLayout from '../layouts/DashboardLayout.vue';
import GeneralPatientTab from '../components/patient-tabs/GeneralPatientTab.vue';
import TwinAccessTab from '../components/patient-tabs/TwinAccessTab.vue';
import { usePatientsStore } from '../stores/patients';
import { useT } from '../i18n/composables';

const { t } = useT();

interface EditableTab {
  save?: () => Promise<boolean> | boolean;
  discard?: () => void;
}

const route = useRoute();
const router = useRouter();
const store = usePatientsStore();
const { current: patient, loading, saving } = storeToRefs(store);

type TabValue = 'general' | 'access';
const tab = ref<TabValue>('general');
const deleteDialog = ref(false);
const deleting = ref(false);
const editing = ref(false);
const activeTab = ref<EditableTab | null>(null);
const savingTab = ref(false);

const tabs = computed<TabItem[]>(() => [
  { value: 'general', label: t('patients.tabs.general', 'General') },
  { value: 'access', label: t('patients.tabs.access', 'AI Twin Access') },
]);

const patientId = computed(() => String(route.params.id ?? ''));

const fullName = computed(
  () => patient.value?.personalIdentification?.fullName?.trim() || patient.value?.email || ''
);

async function loadPatient() {
  if (!patientId.value) return;
  try {
    await store.fetchOne(patientId.value);
  } catch {
    // store.error is already set; the empty state below will render.
  }
}

onMounted(loadPatient);
watch(patientId, loadPatient);

watch(tab, () => {
  if (editing.value) {
    activeTab.value?.discard?.();
    editing.value = false;
  }
});

function goBack() {
  router.push({ name: 'patients' });
}

function startEditing() {
  editing.value = true;
}

function cancelEditing() {
  activeTab.value?.discard?.();
  editing.value = false;
}

async function saveChanges() {
  savingTab.value = true;
  try {
    const ok = await Promise.resolve(activeTab.value?.save?.() ?? true);
    if (ok) editing.value = false;
  } finally {
    savingTab.value = false;
  }
}

async function confirmDelete() {
  if (!patient.value) return;
  deleting.value = true;
  try {
    await store.remove(patient.value._key);
    deleteDialog.value = false;
    notify.success(t('patients.detail.toasts.deleted', 'User deleted'));
    router.push({ name: 'patients' });
  } catch {
    notify.error(store.error ?? t('patients.detail.toasts.deleteFailed', 'Failed to delete user'));
  } finally {
    deleting.value = false;
  }
}
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

      <template v-if="patient">
        <header class="flex flex-wrap items-center justify-between gap-4">
          <div class="flex items-center gap-4">
            <BaseAvatar :name="fullName" size="xl" />
            <div class="min-w-0">
              <h1 class="truncate text-headline text-text">{{ fullName }}</h1>
              <p class="truncate text-caption text-text-muted">{{ patient.email }}</p>
            </div>
          </div>

          <button
            type="button"
            class="inline-flex h-10 items-center gap-2 rounded-full border border-danger/30 bg-danger/5 px-4 text-sm font-semibold text-danger transition duration-200 hover:-translate-y-0.5 hover:border-danger/60 hover:bg-danger/10 hover:shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger/50 disabled:cursor-not-allowed disabled:opacity-60"
            :disabled="deleting"
            :aria-label="t('patients.detail.delete', 'Delete user')"
            :title="t('patients.detail.delete', 'Delete user')"
            @click="deleteDialog = true"
          >
            <span
              v-if="deleting"
              class="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
              aria-hidden="true"
            />
            <Icon v-else :icon="Delete02Icon" :size="16" />
            <span class="hidden sm:inline">{{ t('patients.detail.delete', 'Delete user') }}</span>
          </button>
        </header>

        <div class="flex flex-wrap items-center justify-between gap-3">
          <BaseTabs v-model="tab" :tabs="tabs" />

          <Transition name="edit-actions" mode="out-in">
            <div v-if="!editing" key="view" class="flex items-center gap-2">
              <BaseButton
                v-if="tab === 'general'"
                variant="outline"
                size="md"
                rounded="full"
                @click="startEditing"
              >
                <Icon :icon="Edit02Icon" :size="16" />
                {{ t('common.update', 'Update') }}
              </BaseButton>
            </div>
            <div v-else key="edit" class="flex items-center gap-2">
              <BaseBadge tone="warning" dot class="hidden sm:inline-flex">
                {{ t('patients.detail.editing', 'Editing') }}
              </BaseBadge>
              <BaseButton
                variant="ghost"
                size="md"
                rounded="full"
                :disabled="saving || savingTab"
                @click="cancelEditing"
              >
                {{ t('common.cancel', 'Cancel') }}
              </BaseButton>
              <BaseButton
                variant="primary"
                size="md"
                rounded="full"
                :loading="saving || savingTab"
                @click="saveChanges"
              >
                {{ t('common.saveChanges', 'Save Changes') }}
              </BaseButton>
            </div>
          </Transition>
        </div>

        <!-- The General tab disables its own inputs via `:disabled="!editing"`
             rather than the fieldset attribute, so the inline "Change password"
             subsection stays interactive regardless of the edit state. -->
        <div
          :class="[
            'rounded-2xl border bg-surface p-6 shadow-card transition-colors',
            editing && tab === 'general' ? 'border-accent/30 ring-1 ring-accent/10' : 'border-border',
          ]"
        >
          <GeneralPatientTab
            v-if="tab === 'general'"
            ref="activeTab"
            :patient="patient"
            :editing="editing"
          />
          <TwinAccessTab v-else-if="tab === 'access'" ref="activeTab" :patient="patient" />
        </div>
      </template>

      <PatientDetailSkeleton v-else-if="loading" />

      <EmptyState
        v-else-if="store.error"
        full-height
        :icon="Cancel01Icon"
        :title="t('patients.detail.loadFailedTitle', `Couldn't load user`)"
        :description="store.error"
      >
        <BaseButton variant="primary" @click="loadPatient">{{ t('common.retry', 'Retry') }}</BaseButton>
      </EmptyState>

      <EmptyState
        v-else
        full-height
        :icon="Cancel01Icon"
        :title="t('patients.detail.notFoundTitle', 'User not found')"
        :description="t('patients.detail.notFoundBody', `This user doesn't exist or has been deleted.`)"
      >
        <BaseButton variant="primary" @click="router.push({ name: 'patients' })">
          {{ t('patients.detail.backToList', 'Back to list') }}
        </BaseButton>
      </EmptyState>

      <ConfirmDialog
        v-model:open="deleteDialog"
        :title="t('patients.detail.deleteDialog.title', 'Delete user')"
        :description="t('patients.detail.deleteDialog.body', `This action can't be undone. The user's account and chat history will be permanently removed.`)"
        :confirm-label="t('common.delete', 'Delete')"
        :loading="deleting"
        @confirm="confirmDelete"
      />
    </section>
  </DashboardLayout>
</template>

<style scoped>
.edit-actions-enter-active,
.edit-actions-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.edit-actions-enter-from,
.edit-actions-leave-to {
  opacity: 0;
  transform: translateY(-2px);
}
</style>
