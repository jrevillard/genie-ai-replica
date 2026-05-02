<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppButton from '../components/AppButton.vue';
import AppInput from '../components/AppInput.vue';
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
  <main class="flex min-h-screen items-center justify-center bg-slate-100 p-4 sm:p-8">
    <div class="auth-card">
      <section class="px-8 py-10 sm:px-12 sm:py-14">
        <div class="mx-auto w-full max-w-sm">
          <h1 class="text-2xl font-semibold text-slate-900">Welcome back!</h1>
          <p class="mt-1 text-sm text-slate-500">Log in to your account.</p>

          <form class="mt-8 space-y-4" novalidate @submit.prevent="onSubmit">
            <AppInput
              id="loginName"
              v-model="form.loginName"
              type="text"
              label="Email address"
              autocomplete="username"
              required
            />

            <AppInput
              id="password"
              v-model="form.password"
              type="password"
              label="Password"
              autocomplete="current-password"
              required
            />

            <div class="flex items-center justify-between text-sm">
              <label class="flex items-center gap-2 text-slate-600">
                <input v-model="form.remember" type="checkbox" class="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600" />
                Remember me
              </label>
              <a href="#" class="font-medium text-brand-700 hover:underline">Forgot password?</a>
            </div>

            <p v-if="submitError" class="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {{ submitError }}
            </p>

            <AppButton type="submit" :loading="auth.loading">Login</AppButton>

            <p class="text-center text-sm text-slate-500">
              New here?
              <RouterLink to="/signup" class="font-medium text-brand-700 hover:underline">Create an account</RouterLink>
            </p>
          </form>
        </div>
      </section>

      <BrandPanel />
    </div>
  </main>
</template>
