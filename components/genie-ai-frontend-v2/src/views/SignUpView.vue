<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import AppButton from '../components/AppButton.vue';
import AppInput from '../components/AppInput.vue';
import AuthHeader from '../components/AuthHeader.vue';
import BrandPanel from '../components/BrandPanel.vue';
import { useAuthStore } from '../stores/auth';

const router = useRouter();
const auth = useAuthStore();

const form = reactive({
  firstName: '',
  lastName: '',
  organization: '',
  email: '',
  password: '',
});

const fieldErrors = reactive<Record<string, string | null>>({
  firstName: null,
  lastName: null,
  email: null,
  password: null,
});

const submitError = ref<string | null>(null);

function validate(): boolean {
  let ok = true;
  fieldErrors.firstName = form.firstName.trim() ? null : 'First name is required';
  fieldErrors.lastName = form.lastName.trim() ? null : 'Last name is required';
  fieldErrors.email = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email) ? null : 'Enter a valid email';
  fieldErrors.password = form.password.length >= 8 ? null : 'Password must be at least 8 characters';
  for (const k of Object.keys(fieldErrors)) {
    if (fieldErrors[k]) ok = false;
  }
  return ok;
}

async function onSubmit() {
  submitError.value = null;
  if (!validate()) return;
  try {
    // Backend register API: { loginName, email, encPassword, fullName? }
    // - `loginName` = email (single identifier per Figma)
    // - `fullName`  = "{first} {last}"
    // - Organization is captured in the UI but not sent yet (backend doesn't accept it)
    await auth.signUp({
      loginName: form.email,
      email: form.email,
      password: form.password,
      fullName: `${form.firstName.trim()} ${form.lastName.trim()}`.trim(),
    });
    router.push({ name: 'verify-email', query: { email: form.email } });
  } catch {
    submitError.value = auth.error ?? 'Registration failed';
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
              :error="fieldErrors.firstName"
            />
            <AppInput
              id="lastName"
              v-model="form.lastName"
              label="Last Name"
              placeholder="Doe"
              autocomplete="family-name"
              required
              :error="fieldErrors.lastName"
            />
            <AppInput
              id="organization"
              v-model="form.organization"
              label="Organization Name"
              placeholder="Doe"
              autocomplete="organization"
            />
            <AppInput
              id="email"
              v-model="form.email"
              type="email"
              label="Email Address"
              placeholder="you@example.com"
              autocomplete="email"
              required
              :error="fieldErrors.email"
            />
            <AppInput
              id="password"
              v-model="form.password"
              type="password"
              label="Password"
              placeholder="At least 8 characters"
              autocomplete="new-password"
              required
              :error="fieldErrors.password"
            />

            <p v-if="submitError" class="rounded-2xl bg-red-50 px-4 py-2 text-sm text-red-700">
              {{ submitError }}
            </p>

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
        <a href="#" class="text-ieee-600 hover:underline">terms of service</a>
        and
        <a href="#" class="text-ieee-600 hover:underline">privacy policy</a>.
      </p>
    </section>

    <BrandPanel />
  </main>
</template>
