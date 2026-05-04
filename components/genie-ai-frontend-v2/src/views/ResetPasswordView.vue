<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { Eye, EyeOff } from 'lucide-vue-next';
import { useRoute, useRouter } from 'vue-router';
import { sileo } from '../lib/notify';
import AuthHeader from '../components/AuthHeader.vue';
import BrandPanel from '../components/BrandPanel.vue';
import BaseButton from '../components/ui/BaseButton.vue';
import BaseInput from '../components/ui/BaseInput.vue';
import { useAuthStore, type ResetTokenStatus } from '../stores/auth';
import { useZodForm } from '../composables/useZodForm';
import { confirmPasswordResetSchema, type ConfirmPasswordResetInput } from '../lib/validation/schemas';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const token = computed(() => {
  const raw = route.query.token;
  return Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '');
});

const validating = ref(true);
const tokenStatus = ref<ResetTokenStatus>({ status: 'invalid', message: 'Reset link is missing.' });

const form = reactive<ConfirmPasswordResetInput>({
  token: '',
  newPassword: '',
  confirmPassword: '',
});
const { errors, validate } = useZodForm(confirmPasswordResetSchema, [
  'newPassword',
  'confirmPassword',
]);

const passwordVisible = ref(false);
const confirmVisible = ref(false);

onMounted(async () => {
  if (!token.value) {
    validating.value = false;
    return;
  }
  form.token = token.value;
  tokenStatus.value = await auth.validateResetToken(token.value);
  validating.value = false;
});

async function onSubmit() {
  if (!validate(form)) return;
  try {
    await auth.confirmPasswordReset(token.value, form.newPassword);
    sileo.success({ title: 'Password updated. Please sign in with your new password.' });
    router.push({ name: 'signin', query: { reset: 'success' } });
  } catch {
    sileo.error({ title: auth.error ?? 'Failed to reset password' });
  }
}

function requestNewLink() {
  router.push({ name: 'forgot-password' });
}
</script>

<template>
  <main class="auth-shell">
    <section class="auth-form-pane">
      <AuthHeader :align="'left'" />

      <div class="flex flex-1 flex-col justify-center">
        <div class="mx-auto w-full max-w-md">
          <template v-if="validating">
            <h1 class="text-3xl font-semibold text-slate-900">Checking your link…</h1>
            <p class="mt-1 text-sm text-slate-500">One moment while we verify your reset link.</p>
          </template>

          <template v-else-if="tokenStatus.status === 'valid'">
            <h1 class="text-3xl font-semibold text-slate-900">Set a new password</h1>
            <p class="mt-1 text-sm text-slate-500">
              Choose a strong password you haven't used before.
            </p>

            <form class="mt-8 space-y-4" novalidate @submit.prevent="onSubmit">
              <BaseInput
                id="newPassword"
                v-model="form.newPassword"
                :type="passwordVisible ? 'text' : 'password'"
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
                    :aria-label="passwordVisible ? 'Hide password' : 'Show password'"
                    @click="passwordVisible = !passwordVisible"
                  >
                    <EyeOff v-if="passwordVisible" class="h-4 w-4" />
                    <Eye v-else class="h-4 w-4" />
                  </button>
                </template>
              </BaseInput>

              <BaseInput
                id="confirmPassword"
                v-model="form.confirmPassword"
                :type="confirmVisible ? 'text' : 'password'"
                label="Confirm password"
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

              <BaseButton type="submit" variant="primary" block :loading="auth.loading">
                Reset password
              </BaseButton>
            </form>
          </template>

          <template v-else>
            <h1 class="text-3xl font-semibold text-slate-900">Link no longer valid</h1>
            <p class="mt-1 text-sm text-slate-500">{{ tokenStatus.message }}</p>

            <div class="mt-8 space-y-3">
              <BaseButton variant="primary" block @click="requestNewLink">
                Request a new link
              </BaseButton>
              <RouterLink
                to="/signin"
                class="block text-center text-body font-semibold text-accent hover:underline"
              >
                Back to sign in
              </RouterLink>
            </div>
          </template>
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
