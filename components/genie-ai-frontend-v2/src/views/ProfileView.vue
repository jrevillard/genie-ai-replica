<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
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
import BaseDropdown from '../components/ui/BaseDropdown.vue';
import BaseInput from '../components/ui/BaseInput.vue';
import ProfileHeaderSkeleton from '../components/ui/skeletons/ProfileHeaderSkeleton.vue';
import Icon from '../components/ui/Icon.vue';
import DashboardLayout from '../layouts/DashboardLayout.vue';
import { useAuthStore } from '../stores/auth';
import { useZodForm } from '../composables/useZodForm';
import { changePasswordSchema, type ChangePasswordInput } from '../lib/validation/schemas';
import type { PersonalIdentification } from '../services/auth';
import { useT } from '../i18n/composables';

const { t } = useT();

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
  const dash = t('common.notProvided', '—');
  return [
    { label: t('auth.profile.fields.fullName', 'Full name'), value: pid.fullName || dash },
    { label: t('auth.profile.fields.dob', 'Date of birth'), value: formatDob(pid.dob) },
    { label: t('auth.profile.fields.gender', 'Gender'), value: genderLabel(pid.gender) },
    { label: t('auth.profile.fields.nationality', 'Nationality'), value: pid.nationality || dash },
    { label: t('auth.profile.fields.marital', 'Marital status'), value: maritalLabel(pid.maritalStatus) },
  ];
});

// ---------- Personal information edit ----------

type PidForm = Required<Pick<PersonalIdentification, 'fullName' | 'dob' | 'gender' | 'nationality' | 'maritalStatus'>>;

const editing = ref(false);
const saving = ref(false);
const pidForm = reactive<PidForm>({
  fullName: '',
  dob: '',
  gender: '',
  nationality: '',
  maritalStatus: '',
});

const genderOptions = computed(() => [
  { value: 'male', label: t('auth.profile.gender.male', 'Male') },
  { value: 'female', label: t('auth.profile.gender.female', 'Female') },
  { value: 'other', label: t('auth.profile.gender.other', 'Other') },
  { value: 'unspecified', label: t('auth.profile.gender.unspecified', 'Prefer not to say') },
]);

const maritalOptions = computed(() => [
  { value: 'single', label: t('auth.profile.marital.single', 'Single') },
  { value: 'married', label: t('auth.profile.marital.married', 'Married') },
  { value: 'divorced', label: t('auth.profile.marital.divorced', 'Divorced') },
  { value: 'widowed', label: t('auth.profile.marital.widowed', 'Widowed') },
  { value: 'unspecified', label: t('auth.profile.marital.unspecified', 'Prefer not to say') },
]);

function genderLabel(value?: string): string {
  if (!value) return t('common.notProvided', '—');
  return genderOptions.value.find(o => o.value === value)?.label ?? value;
}

function maritalLabel(value?: string): string {
  if (!value) return t('common.notProvided', '—');
  return maritalOptions.value.find(o => o.value === value)?.label ?? value;
}

function hydrateForm() {
  const pid = user.value?.personalIdentification ?? {};
  pidForm.fullName = pid.fullName ?? '';
  // <input type="date"> wants YYYY-MM-DD; the stored DOB is already that shape.
  pidForm.dob = pid.dob ? pid.dob.slice(0, 10) : '';
  pidForm.gender = pid.gender ?? '';
  pidForm.nationality = pid.nationality ?? '';
  pidForm.maritalStatus = pid.maritalStatus ?? '';
}

watch(user, hydrateForm, { immediate: true });

function startEdit() {
  hydrateForm();
  editing.value = true;
}

function cancelEdit() {
  hydrateForm();
  editing.value = false;
}

async function saveProfile() {
  saving.value = true;
  try {
    // Send only fields that actually changed so we never overwrite untouched
    // server data with empty strings.
    const current = user.value?.personalIdentification ?? {};
    const diff: PersonalIdentification = {};
    (Object.keys(pidForm) as Array<keyof PidForm>).forEach(k => {
      const next = pidForm[k].trim();
      const prev = (current[k] ?? '').toString();
      if (next !== prev) diff[k] = next;
    });
    if (Object.keys(diff).length === 0) {
      editing.value = false;
      return;
    }
    await auth.updateProfile(diff);
    sileo.success({ title: t('auth.profile.saved', 'Profile updated successfully.') });
    editing.value = false;
  } catch {
    sileo.error({ title: auth.error ?? t('auth.profile.saveFailed', 'Failed to update profile') });
  } finally {
    saving.value = false;
  }
}

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
    sileo.success({ title: t('auth.profile.successToast', 'Password updated successfully.') });
    clearForm();
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status === 401) {
      currentPasswordError.value = t('auth.profile.currentIncorrect', 'Current password is incorrect.');
    } else {
      sileo.error({ title: auth.error ?? t('auth.profile.failedToast', 'Failed to change password') });
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
        :aria-label="t('common.goBack', 'Go back')"
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
            <ProfileHeaderSkeleton v-if="refreshing && !user" />
            <template v-else>
              <h1 class="truncate text-2xl font-semibold text-slate-900">{{ displayName }}</h1>
              <p class="mt-1 flex items-center gap-2 text-sm text-slate-500">
                <Icon :icon="Mail02Icon" :size="14" />
                <span class="truncate">{{ user?.email ?? t('common.notProvided', '—') }}</span>
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
                  {{ t('auth.profile.emailVerified', 'Email verified') }}
                </span>
                <span
                  v-else-if="user"
                  class="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700"
                >
                  {{ t('auth.profile.emailNotVerified', 'Email not verified') }}
                </span>
              </div>
            </template>
          </div>
        </div>
      </article>

      <div class="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <article class="rounded-2xl border border-border bg-surface p-6 shadow-card">
          <header class="mb-5 flex items-start justify-between gap-3">
            <div>
              <h2 class="text-lg font-semibold text-slate-900">{{ t('auth.profile.personalTitle', 'Personal information') }}</h2>
              <p class="mt-1 text-sm text-slate-500">{{ t('auth.profile.personalSubtitle', 'Details associated with your account.') }}</p>
            </div>
            <BaseButton v-if="!editing" variant="ghost" rounded="full" @click="startEdit">
              {{ t('auth.profile.edit', 'Edit') }}
            </BaseButton>
          </header>

          <dl v-if="!editing" class="grid grid-cols-1 gap-4 sm:grid-cols-2">
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

          <form v-else class="space-y-4" novalidate @submit.prevent="saveProfile">
            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <BaseInput
                id="pid-fullName"
                v-model="pidForm.fullName"
                :label="t('auth.profile.fields.fullName', 'Full name')"
                :placeholder="t('auth.profile.placeholders.fullName', 'Your full name')"
                rounded="full"
              />
              <BaseInput
                id="pid-dob"
                v-model="pidForm.dob"
                type="date"
                :label="t('auth.profile.fields.dob', 'Date of birth')"
                rounded="full"
              />
              <div>
                <label for="pid-gender" class="mb-1.5 block text-body font-medium text-text">
                  {{ t('auth.profile.fields.gender', 'Gender') }}
                </label>
                <BaseDropdown
                  id="pid-gender"
                  v-model="pidForm.gender"
                  :options="genderOptions"
                  :placeholder="t('common.notProvided', '—')"
                  width="w-full"
                />
              </div>
              <BaseInput
                id="pid-nationality"
                v-model="pidForm.nationality"
                :label="t('auth.profile.fields.nationality', 'Nationality')"
                :placeholder="t('auth.profile.placeholders.nationality', 'e.g. Kenyan')"
                rounded="full"
              />
              <div>
                <label for="pid-marital" class="mb-1.5 block text-body font-medium text-text">
                  {{ t('auth.profile.fields.marital', 'Marital status') }}
                </label>
                <BaseDropdown
                  id="pid-marital"
                  v-model="pidForm.maritalStatus"
                  :options="maritalOptions"
                  :placeholder="t('common.notProvided', '—')"
                  width="w-full"
                />
              </div>
            </div>

            <div class="flex justify-end gap-3 pt-1">
              <BaseButton type="button" variant="ghost" rounded="full" :disabled="saving" @click="cancelEdit">
                {{ t('auth.profile.cancel', 'Cancel') }}
              </BaseButton>
              <BaseButton type="submit" variant="primary" rounded="full" :loading="saving">
                {{ t('auth.profile.save', 'Save changes') }}
              </BaseButton>
            </div>
          </form>
        </article>

        <article class="rounded-2xl border border-border bg-surface p-6 shadow-card">
          <header class="mb-5">
            <h2 class="text-lg font-semibold text-slate-900">{{ t('auth.profile.securityTitle', 'Security') }}</h2>
            <p class="mt-1 text-sm text-slate-500">
              {{ t('auth.profile.securitySubtitle', 'Change the password used to sign in to your account.') }}
            </p>
          </header>

          <form class="space-y-4" novalidate @submit.prevent="onSubmit">
            <BaseInput
              id="currentPassword"
              v-model="form.currentPassword"
              :type="currentVisible ? 'text' : 'password'"
              :label="t('auth.profile.currentPasswordLabel', 'Current password')"
              :placeholder="t('auth.profile.currentPasswordPlaceholder', 'Enter your current password')"
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
              :label="t('auth.profile.newPasswordLabel', 'New password')"
              :placeholder="t('auth.profile.newPasswordPlaceholder', 'At least 8 characters')"
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
              :label="t('auth.profile.confirmLabel', 'Confirm new password')"
              :placeholder="t('auth.profile.confirmPlaceholder', 'Re-enter your new password')"
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
              <BaseButton variant="ghost" rounded="full" @click="clearForm">{{ t('common.cancel', 'Cancel') }}</BaseButton>
              <BaseButton type="submit" variant="primary" rounded="full" :loading="auth.loading">
                {{ t('auth.profile.updateBtn', 'Update password') }}
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
