<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import {
  AlertCircleIcon,
  ArrowLeft01Icon,
  BubbleChatIcon,
  CallIcon,
  Cancel01Icon,
  CheckmarkCircle02Icon,
  Delete02Icon,
  Edit02Icon,
  Pulse02Icon,
  WhatsappIcon,
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
import { formatRelative, type RelativeStrings } from '../lib/analytics';
import { useT } from '../i18n/composables';

const { t } = useT();
const { locale } = useI18n();

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

const relativeStrings = computed<RelativeStrings>(() => ({
  justNow: t('analytics.relative.justNow', 'just now'),
  minutesAgo: (n) => t('analytics.relative.minutesAgo', { n }, '{n} min ago'),
  hoursAgo: (n) => t('analytics.relative.hoursAgo', { n }, '{n} hr ago'),
  daysAgo: (n) => t('analytics.relative.daysAgo', { n }, '{n} days ago'),
  weeksAgo: (n) => t('analytics.relative.weeksAgo', { n }, '{n} weeks ago'),
  monthsAgo: (n) => t('analytics.relative.monthsAgo', { n }, '{n} months ago'),
  yearsAgo: (n) => t('analytics.relative.yearsAgo', { n }, '{n} years ago'),
  never: t('patients.detail.stats.neverActive', 'Never active'),
}));

const lastActiveLabel = computed(() =>
  formatRelative(patient.value?.lastActivityAt, relativeStrings.value)
);

// "Active" = activity within the last 14 days (same threshold as the list).
const isActive = computed(() => {
  const iso = patient.value?.lastActivityAt;
  if (!iso) return false;
  const ts = new Date(iso).getTime();
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts < 14 * 24 * 60 * 60 * 1000;
});

const numberFormatter = computed(() => new Intl.NumberFormat(locale.value));
function fmtNum(n: number | null | undefined): string {
  return numberFormatter.value.format(Number.isFinite(n as number) ? (n as number) : 0);
}

const statCards = computed(() => {
  const p = patient.value;
  if (!p) return [];
  return [
    {
      key: 'chats',
      label: t('patients.detail.stats.chats', 'Chats'),
      sub: t('patients.detail.stats.chatsSub', 'Total chat sessions'),
      value: p.numChats ?? 0,
      icon: BubbleChatIcon,
      iconBg: 'bg-rose-50',
      iconColor: 'text-rose-500',
    },
    {
      key: 'whatsapp',
      label: t('patients.detail.stats.whatsapp', 'WhatsApp'),
      sub: t('patients.detail.stats.whatsappSub', 'WhatsApp conversations'),
      value: p.numWhatsappChats ?? 0,
      icon: WhatsappIcon,
      iconBg: 'bg-emerald-50',
      iconColor: 'text-emerald-500',
    },
    {
      key: 'calls',
      label: t('patients.detail.stats.calls', 'Calls'),
      sub: t('patients.detail.stats.callsSub', 'Voice calls placed'),
      value: p.numCalls ?? 0,
      icon: CallIcon,
      iconBg: 'bg-ieee-50',
      iconColor: 'text-ieee-600',
    },
    {
      key: 'sessions',
      label: t('patients.detail.stats.sessions', 'Sessions'),
      sub: t('patients.detail.stats.sessionsSub', 'Total sign-in sessions'),
      value: p.totalSessions ?? 0,
      icon: Pulse02Icon,
      iconBg: 'bg-amber-50',
      iconColor: 'text-amber-500',
    },
  ];
});

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
              <div class="mt-0.5 flex min-w-0 items-center gap-2">
                <p class="min-w-0 truncate text-caption text-text-muted">{{ patient.email }}</p>
                <span
                  v-if="patient.emailVerified"
                  class="inline-flex shrink-0 items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-medium text-success"
                  :title="t('patients.detail.emailVerifiedTooltip', 'This user has confirmed their email address')"
                >
                  <Icon :icon="CheckmarkCircle02Icon" :size="12" />
                  {{ t('patients.detail.emailVerified', 'Verified') }}
                </span>
                <span
                  v-else
                  class="inline-flex shrink-0 items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-medium text-warning"
                  :title="t('patients.detail.emailUnverifiedTooltip', `This user hasn't confirmed their email yet`)"
                >
                  <Icon :icon="AlertCircleIcon" :size="12" />
                  {{ t('patients.detail.emailUnverified', 'Unverified') }}
                </span>
              </div>
              <div class="mt-1.5 flex flex-wrap items-center gap-2">
                <BaseBadge :tone="isActive ? 'success' : 'neutral'" dot>
                  {{ t('patients.detail.lastActive', 'Last active') }} · {{ lastActiveLabel }}
                </BaseBadge>
              </div>
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

        <!-- Engagement stats — primary surface of the new backend fields. Sits
             between the header and tabs so admins see activity totals before
             diving into edit forms. -->
        <section
          :aria-label="t('patients.detail.stats.ariaLabel', 'User activity overview')"
          class="grid grid-cols-2 gap-3 lg:grid-cols-4"
        >
          <article
            v-for="stat in statCards"
            :key="stat.key"
            class="rounded-2xl border border-border-subtle bg-surface p-4"
          >
            <div class="flex items-center gap-3">
              <span
                :class="['inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl', stat.iconBg, stat.iconColor]"
                aria-hidden="true"
              >
                <Icon :icon="stat.icon" :size="20" />
              </span>
              <div class="min-w-0 flex-1">
                <p class="text-[11px] font-semibold uppercase tracking-[0.08em] text-text-subtle">
                  {{ stat.label }}
                </p>
                <p
                  class="mt-0.5 text-2xl font-bold leading-none tabular-nums text-text"
                  :title="String(stat.value)"
                >
                  {{ fmtNum(stat.value) }}
                </p>
              </div>
            </div>
            <p class="mt-2 truncate text-caption text-text-muted">{{ stat.sub }}</p>
          </article>
        </section>

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
