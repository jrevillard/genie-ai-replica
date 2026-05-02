<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { Eye, EyeOff } from 'lucide-vue-next';
import { useRoute, useRouter } from 'vue-router';
import { sileo } from '../lib/notify';
import AppButton from '../components/AppButton.vue';
import AppInput from '../components/AppInput.vue';
import AuthHeader from '../components/AuthHeader.vue';
import BrandPanel from '../components/BrandPanel.vue';
import BaseCheckbox from '../components/ui/BaseCheckbox.vue';
import { useAuthStore } from '../stores/auth';
import { useZodForm } from '../composables/useZodForm';
import { signInSchema, type SignInInput } from '../lib/validation/schemas';

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
    sileo.warning({ title: 'Your session expired. Please sign in again.' });
  }
});

async function onSubmit() {
  if (!validate(form)) return;
  try {
    await auth.signIn({ loginName: form.loginName.trim(), password: form.password });
    sileo.success({ title: 'Welcome back!' });
    const redirect = (route.query.redirect as string) || '/dashboard';
    router.push(redirect);
  } catch {
    sileo.error({ title: auth.error ?? 'Sign-in failed' });
  }
}
</script>

<template>
  <main class="auth-shell">
    <section class="auth-form-pane">
      <AuthHeader :align="'left'" />

      <div class="flex flex-1 flex-col justify-center">
        <div class="mx-auto w-full max-w-md">
          <h1 class="text-3xl font-semibold text-slate-900">Welcome back!</h1>
          <p class="mt-1 text-sm text-slate-500">Login to access all your data</p>

          <form class="mt-8 space-y-4" novalidate @submit.prevent="onSubmit">
            <AppInput
              id="loginName"
              v-model="form.loginName"
              type="text"
              label="Username or email"
              placeholder="Enter your username or email"
              autocomplete="username"
              required
              :error="errors.loginName"
            />

            <AppInput
              id="password"
              v-model="form.password"
              :type="passwordVisible ? 'text' : 'password'"
              label="Password"
              placeholder="Enter your password"
              autocomplete="current-password"
              required
              :error="errors.password"
            >
              <template #trailing>
                <button
                  type="button"
                  class="grid h-8 w-8 place-items-center rounded-full text-slate-500 transition hover:bg-neutral-100 hover:text-ieee-700"
                  :aria-label="passwordVisible ? 'Hide password' : 'Show password'"
                  @click="passwordVisible = !passwordVisible"
                >
                  <EyeOff v-if="passwordVisible" class="h-4 w-4" />
                  <Eye v-else class="h-4 w-4" />
                </button>
              </template>
            </AppInput>

            <BaseCheckbox v-model="form.remember" label="Remember me" size="sm" />

            <AppButton type="submit" :loading="auth.loading">Login</AppButton>

            <p class="pt-1 text-center text-sm text-slate-500">
              Don't have an account?
              <RouterLink to="/signup" class="font-semibold text-ieee-700 hover:underline">Register</RouterLink>
            </p>
          </form>
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
