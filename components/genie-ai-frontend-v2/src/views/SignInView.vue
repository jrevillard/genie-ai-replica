<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { Eye, EyeOff } from 'lucide-vue-next';
import { useRoute, useRouter } from 'vue-router';
import { sileo } from '../lib/notify';
import AuthHeader from '../components/AuthHeader.vue';
import BrandPanel from '../components/BrandPanel.vue';
import BaseButton from '../components/ui/BaseButton.vue';
import BaseCheckbox from '../components/ui/BaseCheckbox.vue';
import BaseInput from '../components/ui/BaseInput.vue';
import { useAuthStore } from '../stores/auth';
import { useZodForm } from '../composables/useZodForm';
import { signInSchema, type SignInInput } from '../lib/validation/schemas';
import { useT } from '../i18n/composables';

const { t } = useT();
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const form = reactive<SignInInput>({
  loginName: '',
  password: '',
  remember: false,
});

const { errors, validate } = useZodForm(signInSchema, ['loginName', 'password']);

const passwordVisible = ref(false);

onMounted(() => {
  if (route.query.error === 'session_expired') {
    sileo.warning({ title: t('auth.signIn.sessionExpired', 'Your session expired. Please sign in again.') });
  }
});

async function onSubmit() {
  if (!validate(form)) return;
  try {
    await auth.signIn({ loginName: form.loginName.trim(), password: form.password });
    sileo.success({ title: t('auth.signIn.welcomeBack', 'Welcome back!') });
    const redirect = (route.query.redirect as string) || '/dashboard';
    router.push(redirect);
  } catch {
    sileo.error({ title: auth.error ?? t('auth.signIn.failed', 'Sign-in failed') });
  }
}
</script>

<template>
  <main class="auth-shell">
    <section class="auth-form-pane">
      <AuthHeader :align="'left'" />

      <div class="flex flex-1 flex-col justify-center">
        <div class="mx-auto w-full max-w-md">
          <h1 class="text-3xl font-semibold text-slate-900">{{ t('auth.signIn.title', 'Welcome back!') }}</h1>
          <p class="mt-1 text-sm text-slate-500">{{ t('auth.signIn.subtitle', 'Login to access all your data') }}</p>

          <form class="mt-8 space-y-4" novalidate @submit.prevent="onSubmit">
            <BaseInput
              id="loginName"
              v-model="form.loginName"
              type="text"
              :label="t('auth.signIn.usernameLabel', 'Username or email')"
              :placeholder="t('auth.signIn.usernamePlaceholder', 'Enter your username or email')"
              autocomplete="username"
              required
              rounded="full"
              :error="errors.loginName"
            />

            <BaseInput
              id="password"
              v-model="form.password"
              :type="passwordVisible ? 'text' : 'password'"
              :label="t('auth.signIn.passwordLabel', 'Password')"
              :placeholder="t('auth.signIn.passwordPlaceholder', 'Enter your password')"
              autocomplete="current-password"
              required
              rounded="full"
              :error="errors.password"
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

            <div class="flex items-center justify-between">
              <BaseCheckbox v-model="form.remember" :label="t('auth.signIn.remember', 'Remember me')" size="sm" />
              <RouterLink
                to="/forgot-password"
                class="text-meta font-semibold text-accent hover:underline"
              >
                {{ t('auth.signIn.forgot', 'Forgot your password?') }}
              </RouterLink>
            </div>

            <BaseButton type="submit" variant="primary" block :loading="auth.loading">
              {{ t('auth.signIn.submit', 'Login') }}
            </BaseButton>

            <p class="pt-1 text-center text-body text-text-muted">
              {{ t('auth.signIn.noAccount', "Don't have an account?") }}
              <RouterLink to="/signup" class="font-semibold text-accent hover:underline">
                {{ t('auth.signIn.register', 'Register') }}
              </RouterLink>
            </p>
          </form>
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
