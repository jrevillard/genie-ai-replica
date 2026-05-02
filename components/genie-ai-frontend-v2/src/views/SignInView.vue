<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppButton from '../components/AppButton.vue';
import AppInput from '../components/AppInput.vue';
import AuthHeader from '../components/AuthHeader.vue';
import BrandPanel from '../components/BrandPanel.vue';
import { useAuthStore } from '../stores/auth';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const form = reactive({
  loginName: '',
  password: '',
  remember: false,
});

const submitError = ref<string | null>(
  route.query.error === 'session_expired' ? 'Your session expired. Please sign in again.' : null
);

async function onSubmit() {
  submitError.value = null;
  try {
    await auth.signIn({ loginName: form.loginName, password: form.password });
    const redirect = (route.query.redirect as string) || '/dashboard';
    router.push(redirect);
  } catch {
    submitError.value = auth.error ?? 'Sign-in failed';
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
              label="Email Address"
              placeholder="Enter your email address"
              autocomplete="username"
              required
            />

            <AppInput
              id="password"
              v-model="form.password"
              type="password"
              label="Password"
              placeholder="Enter your password"
              autocomplete="current-password"
              required
            />

            <label class="flex items-center gap-2 text-sm text-slate-600">
              <input
                v-model="form.remember"
                type="checkbox"
                class="h-4 w-4 rounded border-slate-300 text-ieee-600 focus:ring-ieee-600"
              />
              Remember me
            </label>

            <p v-if="submitError" class="rounded-2xl bg-red-50 px-4 py-2 text-sm text-red-700">
              {{ submitError }}
            </p>

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
        <a href="#" class="text-ieee-600 hover:underline">terms of service</a>
        and
        <a href="#" class="text-ieee-600 hover:underline">privacy policy</a>.
      </p>
    </section>

    <BrandPanel />
  </main>
</template>
