<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { ArrowDown01Icon, LockPasswordIcon } from '@hugeicons/core-free-icons';
import { Eye, EyeOff } from 'lucide-vue-next';
import { notify } from '../../lib/notify';
import BaseButton from '../ui/BaseButton.vue';
import BaseDatePicker from '../ui/BaseDatePicker.vue';
import BaseInput from '../ui/BaseInput.vue';
import BaseTextarea from '../ui/BaseTextarea.vue';
import Icon from '../ui/Icon.vue';
import { usePatientsStore } from '../../stores/patients';
import type { Patient } from '../../services/patients';
import { useZodForm } from '../../composables/useZodForm';
import {
  changePatientPasswordSchema,
  updatePatientSchema,
  type UpdatePatientInput,
} from '../../lib/validation/schemas';
import { useT } from '../../i18n/composables';

const { t } = useT();

const props = withDefaults(
  defineProps<{ patient: Patient; editing?: boolean }>(),
  { editing: false }
);

const store = usePatientsStore();

interface FormState {
  firstName: string;
  lastName: string;
  email: string;
  dateOfBirth: string;
  notes: string;
}

function snapshot(p: Patient): FormState {
  const pid = p.personalIdentification ?? { firstName: '', lastName: '', phone: '', dob: '', fullName: '' };
  return {
    firstName: pid.firstName ?? '',
    lastName: pid.lastName ?? '',
    email: p.email ?? '',
    // Backend stores ISO; <input type="date"> wants yyyy-mm-dd. Slicing is
    // safe for both bare ISO date strings and full datetimes.
    dateOfBirth: pid.dob ? pid.dob.slice(0, 10) : '',
    notes: p.notes ?? '',
  };
}

const form = reactive<FormState>(snapshot(props.patient));
const baseline = ref<FormState>(snapshot(props.patient));

const { errors, validate, reset } = useZodForm(updatePatientSchema, [
  'firstName',
  'lastName',
  'email',
  'dateOfBirth',
  'notes',
]);

watch(
  () => props.patient,
  (p) => {
    Object.assign(form, snapshot(p));
    baseline.value = snapshot(p);
    reset();
    // Switching patients also collapses the password panel so it doesn't
    // carry stale draft text across patients.
    pwOpen.value = false;
    pwReset();
    Object.assign(pwForm, { newPassword: '', confirmPassword: '' });
    newPwVisible.value = false;
    confirmPwVisible.value = false;
  }
);

function isDirty(): boolean {
  return (
    form.firstName !== baseline.value.firstName ||
    form.lastName !== baseline.value.lastName ||
    form.email !== baseline.value.email ||
    form.dateOfBirth !== baseline.value.dateOfBirth ||
    form.notes !== baseline.value.notes
  );
}

function discard(): void {
  Object.assign(form, baseline.value);
  reset();
  pwOpen.value = false;
  pwReset();
  Object.assign(pwForm, { newPassword: '', confirmPassword: '' });
  newPwVisible.value = false;
  confirmPwVisible.value = false;
}

async function save(): Promise<boolean> {
  if (!validate(form)) return false;
  if (!isDirty()) {
    notify.success(t('patients.general.noChangesToast', 'No changes to save'));
    return true;
  }
  const payload: UpdatePatientInput = {
    firstName: form.firstName.trim(),
    lastName: form.lastName.trim(),
    email: form.email.trim(),
    dateOfBirth: form.dateOfBirth?.trim() || '',
    notes: form.notes?.trim() || '',
  };
  try {
    await store.update(props.patient._key, payload);
    baseline.value = { ...form };
    notify.success(t('patients.general.savedToast', 'User updated'));
    return true;
  } catch {
    notify.error(store.error ?? t('patients.general.saveFailedToast', 'Failed to save changes'));
    return false;
  }
}

defineExpose({ save, discard });

// ---------- Change password subsection ----------
//
// Independent of the main edit cycle so the password field can never be
// silently cleared by a profile save. It has its own validation, its own
// submit, and lives outside the parent's `editing` gate (always interactive
// regardless — but visible only in the General tab).

const pwOpen = ref(false);
const pwForm = reactive({ newPassword: '', confirmPassword: '' });
const pwSaving = ref(false);
const newPwVisible = ref(false);
const confirmPwVisible = ref(false);
const {
  errors: pwErrors,
  validate: pwValidate,
  reset: pwReset,
} = useZodForm(changePatientPasswordSchema, ['newPassword', 'confirmPassword']);

const canSubmitPassword = computed(
  () => pwForm.newPassword.length > 0 && pwForm.confirmPassword.length > 0
);

async function changePassword(): Promise<void> {
  if (pwSaving.value) return;
  if (!pwValidate(pwForm)) return;
  pwSaving.value = true;
  try {
    await store.update(props.patient._key, { password: pwForm.newPassword });
    notify.success(t('patients.general.passwordUpdatedToast', 'Password updated'));
    pwOpen.value = false;
    Object.assign(pwForm, { newPassword: '', confirmPassword: '' });
    pwReset();
    newPwVisible.value = false;
    confirmPwVisible.value = false;
  } catch {
    notify.error(
      store.error ?? t('patients.general.passwordUpdateFailedToast', 'Failed to update password')
    );
  } finally {
    pwSaving.value = false;
  }
}
</script>

<template>
  <div class="space-y-6">
    <header>
      <h2 class="text-title text-text">{{ t('patients.general.title', 'User Information') }}</h2>
      <p class="mt-0.5 text-caption text-text-muted">
        {{ t('patients.general.subtitle', 'Personal details and contact info for this user.') }}
      </p>
    </header>

    <div class="grid gap-4 sm:grid-cols-2">
      <BaseInput
        id="patient-edit-first-name"
        v-model="form.firstName"
        rounded="full"
        :label="t('patients.general.firstNameLabel', 'First Name')"
        :placeholder="t('patients.general.firstNamePlaceholder', 'John')"
        :error="errors.firstName"
        :disabled="!editing"
      />
      <BaseInput
        id="patient-edit-last-name"
        v-model="form.lastName"
        rounded="full"
        :label="t('patients.general.lastNameLabel', 'Last Name')"
        :placeholder="t('patients.general.lastNamePlaceholder', 'Doe')"
        :error="errors.lastName"
        :disabled="!editing"
      />
    </div>

    <BaseInput
      id="patient-edit-email"
      v-model="form.email"
      type="email"
      rounded="full"
      :label="t('patients.general.emailLabel', 'Email')"
      :placeholder="t('patients.general.emailPlaceholder', 'user@example.com')"
      :error="errors.email"
      :disabled="!editing"
      autocomplete="off"
    />

    <BaseDatePicker
      id="patient-edit-dob"
      v-model="form.dateOfBirth"
      :label="t('patients.general.dobLabel', 'Date of Birth')"
      :error="errors.dateOfBirth"
      :disabled="!editing"
    />

    <BaseTextarea
      id="patient-edit-notes"
      v-model="form.notes"
      :label="t('patients.general.notesLabel', 'Notes')"
      :rows="4"
      :placeholder="t('patients.general.notesPlaceholder', 'Any relevant background…')"
      :error="errors.notes"
      :disabled="!editing"
    />

    <!-- Password subsection — atomic, independent of the parent's Save flow.
         Sits inside its own container with the accent-soft surface so admins
         understand it's a separate action, not part of "Save Changes". -->
    <section
      class="rounded-2xl border border-accent/15 bg-accent-soft/40 p-4"
    >
      <button
        type="button"
        class="flex w-full items-center justify-between gap-3 rounded-xl text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
        :aria-expanded="pwOpen"
        @click="pwOpen = !pwOpen"
      >
        <div class="flex items-center gap-3">
          <span class="grid h-9 w-9 place-items-center rounded-xl bg-accent text-white">
            <Icon :icon="LockPasswordIcon" :size="18" />
          </span>
          <div>
            <p class="text-body font-semibold text-text">
              {{ t('patients.general.passwordSectionTitle', 'Change password') }}
            </p>
            <p class="text-caption text-text-muted">
              {{ t('patients.general.passwordSectionHelp', `Sets a new sign-in password for this user.`) }}
            </p>
          </div>
        </div>
        <Icon
          :icon="ArrowDown01Icon"
          :size="18"
          class="text-text-muted transition-transform"
          :class="pwOpen && 'rotate-180'"
        />
      </button>

      <Transition name="pw">
        <div v-if="pwOpen" class="mt-4 space-y-3">
          <div class="grid gap-3 sm:grid-cols-2">
            <BaseInput
              id="patient-pw-new"
              v-model="pwForm.newPassword"
              :type="newPwVisible ? 'text' : 'password'"
              rounded="full"
              :label="t('patients.general.newPasswordLabel', 'New Password')"
              :placeholder="t('patients.general.newPasswordPlaceholder', 'At least 8 characters')"
              :error="pwErrors.newPassword"
              autocomplete="new-password"
            >
              <template #trailing>
                <button
                  type="button"
                  class="-my-1.5 grid h-8 w-8 place-items-center rounded-full text-text-muted transition hover:bg-surface-subtle hover:text-accent"
                  :aria-label="newPwVisible ? t('common.hidePassword', 'Hide password') : t('common.showPassword', 'Show password')"
                  @click="newPwVisible = !newPwVisible"
                >
                  <EyeOff v-if="newPwVisible" class="h-4 w-4" />
                  <Eye v-else class="h-4 w-4" />
                </button>
              </template>
            </BaseInput>
            <BaseInput
              id="patient-pw-confirm"
              v-model="pwForm.confirmPassword"
              :type="confirmPwVisible ? 'text' : 'password'"
              rounded="full"
              :label="t('patients.general.confirmPasswordLabel', 'Confirm Password')"
              :placeholder="t('patients.general.confirmPasswordPlaceholder', 'Re-enter the password')"
              :error="pwErrors.confirmPassword"
              autocomplete="new-password"
            >
              <template #trailing>
                <button
                  type="button"
                  class="-my-1.5 grid h-8 w-8 place-items-center rounded-full text-text-muted transition hover:bg-surface-subtle hover:text-accent"
                  :aria-label="confirmPwVisible ? t('common.hidePassword', 'Hide password') : t('common.showPassword', 'Show password')"
                  @click="confirmPwVisible = !confirmPwVisible"
                >
                  <EyeOff v-if="confirmPwVisible" class="h-4 w-4" />
                  <Eye v-else class="h-4 w-4" />
                </button>
              </template>
            </BaseInput>
          </div>
          <div class="flex justify-end">
            <BaseButton
              variant="primary"
              size="sm"
              rounded="full"
              :loading="pwSaving"
              :disabled="!canSubmitPassword"
              @click="changePassword"
            >
              {{ t('patients.general.updatePasswordBtn', 'Update password') }}
            </BaseButton>
          </div>
        </div>
      </Transition>
    </section>
  </div>
</template>

<style scoped>
.pw-enter-active,
.pw-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.pw-enter-from,
.pw-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
