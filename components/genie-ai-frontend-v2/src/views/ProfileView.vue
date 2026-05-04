<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { Eye, EyeOff } from 'lucide-vue-next';
import {
  ArrowLeft01Icon,
  CheckmarkCircle02Icon,
  Mail02Icon,
  ShieldUserIcon,
} from '@hugeicons/core-free-icons';
import { useRouter } from 'vue-router';
import { storeToRefs } from 'pinia';
import { sileo } from '../lib/notify';
import BaseAvatar from '../components/ui/BaseAvatar.vue';
import BaseButton from '../components/ui/BaseButton.vue';
import BaseInput from '../components/ui/BaseInput.vue';
import BaseSkeleton from '../components/ui/BaseSkeleton.vue';
import Icon from '../components/ui/Icon.vue';
import DashboardLayout from '../layouts/DashboardLayout.vue';
import { useAuthStore } from '../stores/auth';
import { useZodForm } from '../composables/useZodForm';
import { changePasswordSchema, type ChangePasswordInput } from '../lib/validation/schemas';

const router = useRouter();
const auth = useAuthStore();
const { user } = storeToRefs(auth);
const refreshing = ref(false);

onMounted(async () => {
  if (!user.value) {
    refreshing.value = true;
    try {
      await auth.fetchCurrentUser();
    } finally {
      refreshing.value = false;
    }
  }
});

const displayName = computed(
  () =>
    user.value?.personalIdentification?.fullName ||
    user.value?.loginName ||
    user.value?.email ||
    '—'
);

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'long',
  day: 'numeric',
});

function formatDob(value?: string): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : dateFormatter.format(d);
}

const profileFields = computed(() => {
  const pid = user.value?.personalIdentification ?? {};
  return [
    { label: 'Full name', value: pid.fullName || '—' },
    { label: 'Date of birth', value: formatDob(pid.dob) },
    { label: 'Gender', value: pid.gender || '—' },
    { label: 'Nationality', value: pid.nationality || '—' },
    { label: 'Marital status', value: pid.maritalStatus || '—' },
  ];
});

// ---------- Password section ----------

const form = reactive<ChangePasswordInput>({
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
});
const { errors, validate, reset: resetErrors } = useZodForm(changePasswordSchema, [
  'currentPassword',
  'newPassword',
  'confirmPassword',
]);
const currentPasswordError = ref<string | null>(null);

const currentVisible = ref(false);
const newVisible = ref(false);
const confirmVisible = ref(false);

function clearForm() {
  form.currentPassword = '';
  form.newPassword = '';
  form.confirmPassword = '';
  currentPasswordError.value = null;
  resetErrors();
}

async function onSubmit() {
  currentPasswordError.value = null;
  if (!validate(form)) return;
  try {
    await auth.changePassword(form.currentPassword, form.newPassword);
    sileo.success({ title: 'Password updated successfully.' });
    clearForm();
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status === 401) {
      currentPasswordError.value = 'Current password is incorrect.';
    } else {
      sileo.error({ title: auth.error ?? 'Failed to change password' });
    }
  }
}
</script>

<template>
  <DashboardLayout>
    <section class="space-y-6 bg-surface p-6">
      <button
        type="button"
        class="inline-flex items-center gap-1 rounded-full bg-surface-muted p-2 text-text-muted transition hover:bg-surface-subtle hover:text-text"
        aria-label="Go back"
        @click="router.back()"
      >
        <Icon :icon="ArrowLeft01Icon" :size="18" />
      </button>

      <article class="profile-hero">
        <div class="profile-hero__band" aria-hidden="true" />
        <div class="profile-hero__body">
          <div class="profile-hero__avatar">
            <BaseAvatar :src="user?.avatar ?? ''" :name="displayName" size="xl" />
          </div>

          <div class="min-w-0 flex-1 pt-2">
            <div v-if="refreshing && !user" class="space-y-2">
              <BaseSkeleton height="1.5rem" width="14rem" />
              <BaseSkeleton height="1rem" width="10rem" />
            </div>
            <template v-else>
              <h1 class="truncate text-2xl font-semibold text-slate-900">{{ displayName }}</h1>
              <p class="mt-1 flex items-center gap-2 text-sm text-slate-500">
                <Icon :icon="Mail02Icon" :size="14" />
                <span class="truncate">{{ user?.email ?? '—' }}</span>
              </p>

              <div class="mt-3 flex flex-wrap items-center gap-2">
                <span
                  v-if="user?.role"
                  class="inline-flex items-center gap-1 rounded-full bg-ieee-50 px-2.5 py-1 text-xs font-semibold text-ieee-800"
                >
                  <Icon :icon="ShieldUserIcon" :size="12" />
                  {{ user.role }}
                </span>
                <span
                  v-if="user?.emailVerified"
                  class="inline-flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-1 text-xs font-semibold text-green-700"
                >
                  <Icon :icon="CheckmarkCircle02Icon" :size="12" />
                  Email verified
                </span>
                <span
                  v-else-if="user"
                  class="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700"
                >
                  Email not verified
                </span>
              </div>
            </template>
          </div>
        </div>
      </article>

      <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <article class="rounded-2xl border border-border bg-surface p-6 shadow-card">
          <header class="mb-5">
            <h2 class="text-lg font-semibold text-slate-900">Personal information</h2>
            <p class="mt-1 text-sm text-slate-500">Details associated with your account.</p>
          </header>

          <dl class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div
              v-for="field in profileFields"
              :key="field.label"
              class="rounded-xl bg-neutral-50 px-4 py-3"
            >
              <dt class="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                {{ field.label }}
              </dt>
              <dd class="mt-1 truncate text-sm font-medium text-slate-800">
                {{ field.value }}
              </dd>
            </div>
          </dl>

          <p class="mt-5 text-xs text-slate-400">
            Need to update these? Reach out to your administrator.
          </p>
        </article>

        <article class="rounded-2xl border border-border bg-surface p-6 shadow-card">
          <header class="mb-5">
            <h2 class="text-lg font-semibold text-slate-900">Security</h2>
            <p class="mt-1 text-sm text-slate-500">
              Change the password used to sign in to your account.
            </p>
          </header>

          <form class="space-y-4" novalidate @submit.prevent="onSubmit">
            <BaseInput
              id="currentPassword"
              v-model="form.currentPassword"
              :type="currentVisible ? 'text' : 'password'"
              label="Current password"
              placeholder="Enter your current password"
              autocomplete="current-password"
              required
              rounded="full"
              :error="currentPasswordError ?? errors.currentPassword"
            >
              <template #trailing>
                <button
                  type="button"
                  class="-my-1.5 grid h-8 w-8 place-items-center rounded-full text-text-muted transition hover:bg-surface-subtle hover:text-accent"
                  :aria-label="currentVisible ? 'Hide password' : 'Show password'"
                  @click="currentVisible = !currentVisible"
                >
                  <EyeOff v-if="currentVisible" class="h-4 w-4" />
                  <Eye v-else class="h-4 w-4" />
                </button>
              </template>
            </BaseInput>

            <BaseInput
              id="newPassword"
              v-model="form.newPassword"
              :type="newVisible ? 'text' : 'password'"
              label="New password"
              placeholder="At least 8 characters"
              autocomplete="new-password"
              required
              rounded="full"
              :error="errors.newPassword"
            >
              <template #trailing>
                <button
                  type="button"
                  class="-my-1.5 grid h-8 w-8 place-items-center rounded-full text-text-muted transition hover:bg-surface-subtle hover:text-accent"
                  :aria-label="newVisible ? 'Hide password' : 'Show password'"
                  @click="newVisible = !newVisible"
                >
                  <EyeOff v-if="newVisible" class="h-4 w-4" />
                  <Eye v-else class="h-4 w-4" />
                </button>
              </template>
            </BaseInput>

            <BaseInput
              id="confirmPassword"
              v-model="form.confirmPassword"
              :type="confirmVisible ? 'text' : 'password'"
              label="Confirm new password"
              placeholder="Re-enter your new password"
              autocomplete="new-password"
              required
              rounded="full"
              :error="errors.confirmPassword"
            >
              <template #trailing>
                <button
                  type="button"
                  class="-my-1.5 grid h-8 w-8 place-items-center rounded-full text-text-muted transition hover:bg-surface-subtle hover:text-accent"
                  :aria-label="confirmVisible ? 'Hide password' : 'Show password'"
                  @click="confirmVisible = !confirmVisible"
                >
                  <EyeOff v-if="confirmVisible" class="h-4 w-4" />
                  <Eye v-else class="h-4 w-4" />
                </button>
              </template>
            </BaseInput>

            <div class="flex justify-end gap-3 pt-1">
              <BaseButton variant="ghost" rounded="full" @click="clearForm">Cancel</BaseButton>
              <BaseButton type="submit" variant="primary" rounded="full" :loading="auth.loading">
                Update password
              </BaseButton>
            </div>
          </form>
        </article>
      </div>
    </section>
  </DashboardLayout>
</template>

<style scoped>
.profile-hero {
  position: relative;
  overflow: hidden;
  border-radius: 1.25rem;
  border: 1px solid #e2e8f0;
  background: #ffffff;
  box-shadow: 0 4px 14px -8px rgba(15, 23, 42, 0.08);
}

.profile-hero__band {
  height: 96px;
  background:
    radial-gradient(800px 240px at 0% 0%, rgba(0, 115, 185, 0.55), transparent 60%),
    radial-gradient(600px 200px at 100% 100%, rgba(0, 41, 75, 0.55), transparent 60%),
    linear-gradient(120deg, #0073b9 0%, #003e62 100%);
}

.profile-hero__body {
  display: flex;
  align-items: flex-start;
  gap: 1.25rem;
  padding: 0 1.5rem 1.5rem 1.5rem;
}

.profile-hero__avatar {
  margin-top: -2.5rem;
  display: inline-flex;
  border-radius: 9999px;
  padding: 4px;
  background: #ffffff;
  box-shadow: 0 6px 16px -8px rgba(15, 23, 42, 0.18);
}
</style>
