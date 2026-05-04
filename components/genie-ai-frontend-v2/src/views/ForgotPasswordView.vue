<script setup lang="ts">
import { reactive, ref } from 'vue';
import { sileo } from '../lib/notify';
import AuthHeader from '../components/AuthHeader.vue';
import BrandPanel from '../components/BrandPanel.vue';
import BaseButton from '../components/ui/BaseButton.vue';
import BaseInput from '../components/ui/BaseInput.vue';
import { useAuthStore } from '../stores/auth';
import { useZodForm } from '../composables/useZodForm';
import { requestPasswordResetSchema, type RequestPasswordResetInput } from '../lib/validation/schemas';

const auth = useAuthStore();

const form = reactive<RequestPasswordResetInput>({ email: '' });
const { errors, validate } = useZodForm(requestPasswordResetSchema, ['email']);
const submitted = ref(false);

async function onSubmit() {
  if (!validate(form)) return;
  try {
    await auth.requestPasswordReset(form.email.trim());
  } catch {
    // We still show the neutral success state to avoid leaking which emails
    // are registered. Real errors are surfaced via toast for visibility.
    sileo.error({ title: auth.error ?? 'Could not send reset instructions' });
  } finally {
    submitted.value = true;
  }
}
</script>

<template>
  <main class="auth-shell">
    <section class="auth-form-pane">
      <AuthHeader :align="'left'" />

      <div class="flex flex-1 flex-col justify-center">
        <div class="mx-auto w-full max-w-md">
          <h1 class="text-3xl font-semibold text-slate-900">Forgot your password?</h1>
          <p class="mt-1 text-sm text-slate-500">
            Enter the email tied to your account and we'll send you a reset link.
          </p>

          <div
            v-if="submitted"
            class="mt-8 rounded-2xl border border-green-200 bg-green-50 p-4 text-sm text-green-800"
          >
            <p class="font-semibold">Check your inbox.</p>
            <p class="mt-1">
              If an account exists for
              <span class="font-medium">{{ form.email }}</span
              >, we've sent reset instructions. The link is valid for a short time.
            </p>
          </div>

          <form v-else class="mt-8 space-y-4" novalidate @submit.prevent="onSubmit">
            <BaseInput
              id="email"
              v-model="form.email"
              type="email"
              label="Email Address"
              placeholder="Enter your email address"
              autocomplete="email"
              required
              rounded="full"
              :error="errors.email"
            />
            <BaseButton type="submit" variant="primary" block :loading="auth.loading">
              Send reset link
            </BaseButton>
          </form>

          <p class="pt-6 text-center text-body text-text-muted">
            Remembered it?
            <RouterLink to="/signin" class="font-semibold text-accent hover:underline">
              Back to sign in
            </RouterLink>
          </p>
        </div>
      </div>

      <p class="mt-8 text-center text-xs leading-relaxed text-slate-400">
        By signing up, you agree to our
        <a href="#" class="text-ieee-700 hover:underline">terms of service</a>
        and
        <a href="#" class="text-ieee-700 hover:underline">privacy policy</a>.
      </p>
    </section>

    <BrandPanel />
  </main>
</template>
