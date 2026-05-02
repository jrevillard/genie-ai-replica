<script setup lang="ts">
import { reactive } from 'vue';
import { useRouter } from 'vue-router';
import { sileo } from '../lib/notify';
import AppButton from '../components/AppButton.vue';
import AppInput from '../components/AppInput.vue';
import AuthHeader from '../components/AuthHeader.vue';
import BrandPanel from '../components/BrandPanel.vue';
import { useAuthStore } from '../stores/auth';
import { useZodForm } from '../composables/useZodForm';
import { signUpSchema, type SignUpInput } from '../lib/validation/schemas';

const router = useRouter();
const auth = useAuthStore();

const form = reactive<SignUpInput>({
  firstName: '',
  lastName: '',
  email: '',
  password: '',
});

const { errors, validate } = useZodForm(signUpSchema, [
  'firstName',
  'lastName',
  'email',
  'password',
]);

async function onSubmit() {
  if (!validate(form)) return;
  try {
    await auth.signUp({
      loginName: form.email,
      email: form.email,
      password: form.password,
      fullName: `${form.firstName.trim()} ${form.lastName.trim()}`.trim(),
    });
    sileo.success({ title: 'Account created. Check your email to verify.' });
    router.push({ name: 'verify-email', query: { email: form.email } });
  } catch {
    sileo.error({ title: auth.error ?? 'Registration failed' });
  }
}
</script>

<template>
  <main class="auth-shell">
    <section class="auth-form-pane">
      <AuthHeader :align="'left'" />

      <div class="flex flex-1 flex-col justify-center">
        <div class="mx-auto w-full max-w-md">
          <h1 class="text-3xl font-semibold text-slate-900">Create your AI Twins Today</h1>
          <p class="mt-1 text-sm text-slate-500">Enter your email to sign up</p>

          <form class="mt-8 space-y-4" novalidate @submit.prevent="onSubmit">
            <AppInput
              id="firstName"
              v-model="form.firstName"
              label="First Name"
              placeholder="John"
              autocomplete="given-name"
              required
              :error="errors.firstName"
            />
            <AppInput
              id="lastName"
              v-model="form.lastName"
              label="Last Name"
              placeholder="Doe"
              autocomplete="family-name"
              required
              :error="errors.lastName"
            />
            <AppInput
              id="email"
              v-model="form.email"
              type="email"
              label="Email Address"
              placeholder="you@example.com"
              autocomplete="email"
              required
              :error="errors.email"
            />
            <AppInput
              id="password"
              v-model="form.password"
              type="password"
              label="Password"
              placeholder="At least 8 characters"
              autocomplete="new-password"
              required
              :error="errors.password"
            />

            <AppButton type="submit" :loading="auth.loading">Sign up</AppButton>

            <p class="pt-1 text-center text-sm text-slate-500">
              Already have an account?
              <RouterLink to="/signin" class="font-semibold text-ieee-700 hover:underline">Sign in</RouterLink>
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
