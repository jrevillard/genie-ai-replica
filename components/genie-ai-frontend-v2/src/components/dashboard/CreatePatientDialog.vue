<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import { UserAdd01Icon } from '@hugeicons/core-free-icons';
import { Eye, EyeOff } from 'lucide-vue-next';
import BaseButton from '../ui/BaseButton.vue';
import BaseDatePicker from '../ui/BaseDatePicker.vue';
import BaseDrawer from '../ui/BaseDrawer.vue';
import BaseInput from '../ui/BaseInput.vue';
import BaseTextarea from '../ui/BaseTextarea.vue';
import { useZodForm } from '../../composables/useZodForm';
import { createPatientSchema, type CreatePatientInput } from '../../lib/validation/schemas';
import type { CreatePatientPayload } from '../../services/patients';
import { useT } from '../../i18n/composables';

const { t } = useT();

const props = defineProps<{ open: boolean; submitting?: boolean }>();
const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
  (e: 'created', payload: CreatePatientPayload): void;
}>();

const blank: CreatePatientInput = {
  firstName: '',
  lastName: '',
  email: '',
  password: '',
  confirmPassword: '',
  phone: '',
  dateOfBirth: '',
  notes: '',
};

const form = reactive<CreatePatientInput>({ ...blank });
const passwordVisible = ref(false);
const confirmVisible = ref(false);

const { errors, validate, reset } = useZodForm(createPatientSchema, [
  'firstName',
  'lastName',
  'email',
  'password',
  'confirmPassword',
  'dateOfBirth',
  'notes',
]);

function close() {
  if (props.submitting) return;
  emit('update:open', false);
}

function onSubmit() {
  if (props.submitting) return;
  if (!validate(form)) return;
  // Send only fields the API actually consumes; collapse empty optional
  // strings to undefined so the backend stores `null` consistently.
  const payload: CreatePatientPayload = {
    firstName: form.firstName.trim(),
    lastName: form.lastName.trim(),
    email: form.email.trim(),
    password: form.password,
    dateOfBirth: form.dateOfBirth?.trim() || undefined,
    notes: form.notes?.trim() || undefined,
  };
  emit('created', payload);
}

watch(
  () => props.open,
  (open) => {
    if (!open) {
      Object.assign(form, blank);
      passwordVisible.value = false;
      confirmVisible.value = false;
      reset();
    }
  }
);
</script>

<template>
  <BaseDrawer
    :open="open"
    :title="t('patients.create.title', 'Add User')"
    :icon="UserAdd01Icon"
    width="md"
    :close-on-backdrop="!submitting"
    @update:open="(v) => !submitting && emit('update:open', v)"
  >
    <section class="space-y-4">
      <header>
        <p class="text-caption text-text-muted">
          {{ t('patients.create.subtitle', 'Create a new user account. They will use this email and password to sign in.') }}
        </p>
      </header>

      <div class="grid gap-4 sm:grid-cols-2">
        <BaseInput
          id="patient-first-name"
          v-model="form.firstName"
          rounded="full"
          :label="t('patients.create.firstNameLabel', 'First Name')"
          :placeholder="t('patients.create.firstNamePlaceholder', 'John')"
          :error="errors.firstName"
          data-autofocus
        />
        <BaseInput
          id="patient-last-name"
          v-model="form.lastName"
          rounded="full"
          :label="t('patients.create.lastNameLabel', 'Last Name')"
          :placeholder="t('patients.create.lastNamePlaceholder', 'Doe')"
          :error="errors.lastName"
        />
      </div>

      <BaseInput
        id="patient-email"
        v-model="form.email"
        type="email"
        rounded="full"
        :label="t('patients.create.emailLabel', 'Email')"
        :placeholder="t('patients.create.emailPlaceholder', 'user@example.com')"
        :error="errors.email"
        autocomplete="off"
      />

      <BaseInput
        id="patient-password"
        v-model="form.password"
        :type="passwordVisible ? 'text' : 'password'"
        rounded="full"
        :label="t('patients.create.passwordLabel', 'Password')"
        :placeholder="t('patients.create.passwordPlaceholder', 'At least 8 characters')"
        :error="errors.password"
        autocomplete="new-password"
      >
        <template #trailing>
          <button
            type="button"
            class="-my-1.5 grid h-8 w-8 place-items-center rounded-full text-text-muted transition hover:bg-surface-subtle hover:text-accent"
            :aria-label="passwordVisible ? t('common.hidePassword', 'Hide password') : t('common.showPassword', 'Show password')"
            @click="passwordVisible = !passwordVisible"
          >
            <EyeOff v-if="passwordVisible" class="h-4 w-4" />
            <Eye v-else class="h-4 w-4" />
          </button>
        </template>
      </BaseInput>

      <BaseInput
        id="patient-confirm-password"
        v-model="form.confirmPassword"
        :type="confirmVisible ? 'text' : 'password'"
        rounded="full"
        :label="t('patients.create.confirmPasswordLabel', 'Confirm Password')"
        :placeholder="t('patients.create.confirmPasswordPlaceholder', 'Re-enter the password')"
        :error="errors.confirmPassword"
        autocomplete="new-password"
      >
        <template #trailing>
          <button
            type="button"
            class="-my-1.5 grid h-8 w-8 place-items-center rounded-full text-text-muted transition hover:bg-surface-subtle hover:text-accent"
            :aria-label="confirmVisible ? t('common.hidePassword', 'Hide password') : t('common.showPassword', 'Show password')"
            @click="confirmVisible = !confirmVisible"
          >
            <EyeOff v-if="confirmVisible" class="h-4 w-4" />
            <Eye v-else class="h-4 w-4" />
          </button>
        </template>
      </BaseInput>

      <BaseDatePicker
        id="patient-dob"
        v-model="form.dateOfBirth"
        :label="t('patients.create.dobLabel', 'Date of Birth (optional)')"
        :error="errors.dateOfBirth"
      />

      <BaseTextarea
        id="patient-notes"
        v-model="form.notes"
        :label="t('patients.create.notesLabel', 'Notes (optional)')"
        :rows="4"
        :placeholder="t('patients.create.notesPlaceholder', 'Any relevant background…')"
        :error="errors.notes"
      />
    </section>

    <template #footer>
      <button
        type="button"
        class="text-body font-semibold text-text-muted transition hover:text-text disabled:cursor-not-allowed disabled:opacity-60"
        :disabled="submitting"
        @click="close"
      >
        {{ t('common.cancel', 'Cancel') }}
      </button>
      <BaseButton variant="primary" size="md" :loading="submitting" @click="onSubmit">
        {{ t('patients.create.submit', 'Create User') }}
      </BaseButton>
    </template>
  </BaseDrawer>
</template>
