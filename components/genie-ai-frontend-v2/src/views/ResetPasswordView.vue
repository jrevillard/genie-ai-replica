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
import { useT } from '../i18n/composables';

const { t } = useT();
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const token = computed(() => {
  const raw = route.query.token;
  return Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '');
});

const validating = ref(true);
const tokenStatus = ref<ResetTokenStatus>({ status: 'invalid', message: t('auth.reset.missingMessage', 'Reset link is missing.') });

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

const statusMessage = computed(() => {
  if (tokenStatus.value.status === 'valid') return '';
  switch (tokenStatus.value.status) {
    case 'expired': return t('auth.reset.expiredMessage', 'This reset link has expired.');
    case 'used': return t('auth.reset.usedMessage', 'This reset link has already been used.');
    default: return t('auth.reset.invalidMessage', 'This reset link is not valid.');
  }
});

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
    sileo.success({ title: t('auth.reset.success', 'Password updated. Please sign in with your new password.') });
    router.push({ name: 'signin', query: { reset: 'success' } });
  } catch {
    sileo.error({ title: auth.error ?? t('auth.reset.failed', 'Failed to reset password') });
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
            <h1 class="text-3xl font-semibold text-slate-900">{{ t('auth.reset.checkingTitle', 'Checking your link…') }}</h1>
            <p class="mt-1 text-sm text-slate-500">{{ t('auth.reset.checkingSubtitle', 'One moment while we verify your reset link.') }}</p>
          </template>

          <template v-else-if="tokenStatus.status === 'valid'">
            <h1 class="text-3xl font-semibold text-slate-900">{{ t('auth.reset.validTitle', 'Set a new password') }}</h1>
            <p class="mt-1 text-sm text-slate-500">
              {{ t('auth.reset.validSubtitle', "Choose a strong password you haven't used before.") }}
            </p>

            <form class="mt-8 space-y-4" novalidate @submit.prevent="onSubmit">
              <BaseInput
                id="newPassword"
                v-model="form.newPassword"
                :type="passwordVisible ? 'text' : 'password'"
                :label="t('auth.reset.newPasswordLabel', 'New password')"
                :placeholder="t('auth.reset.newPasswordPlaceholder', 'At least 8 characters')"
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
                :label="t('auth.reset.confirmLabel', 'Confirm password')"
                :placeholder="t('auth.reset.confirmPlaceholder', 'Re-enter your new password')"
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
                {{ t('auth.reset.submit', 'Reset password') }}
              </BaseButton>
            </form>
          </template>

          <template v-else>
            <h1 class="text-3xl font-semibold text-slate-900">{{ t('auth.reset.invalidTitle', 'Link no longer valid') }}</h1>
            <p class="mt-1 text-sm text-slate-500">{{ statusMessage }}</p>

            <div class="mt-8 space-y-3">
              <BaseButton variant="primary" block @click="requestNewLink">
                {{ t('auth.reset.requestNewLink', 'Request a new link') }}
              </BaseButton>
              <RouterLink
                to="/signin"
                class="block text-center text-body font-semibold text-accent hover:underline"
              >
                {{ t('common.backToSignIn', 'Back to sign in') }}
              </RouterLink>
            </div>
          </template>
        </div>
      </div>

      <p class="mt-8 text-center text-xs leading-relaxed text-slate-400">
        {{ t('auth.legal.prefix', 'By signing up, you agree to our') }}
        <a href="#" class="text-ieee-700 hover:underline">{{ t('auth.legal.terms', 'terms of service') }}</a>
        {{ t('auth.legal.and', 'and') }}
        <a href="#" class="text-ieee-700 hover:underline">{{ t('auth.legal.privacy', 'privacy policy') }}</a>.
      </p>
    </section>

    <BrandPanel />
  </main>
</template>
