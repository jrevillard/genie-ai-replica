<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import AppButton from '../components/AppButton.vue';
import AppInput from '../components/AppInput.vue';
import BrandPanel from '../components/BrandPanel.vue';
import { useAuthStore } from '../stores/auth';

const router = useRouter();
const auth = useAuthStore();

const form = reactive({
  firstName: '',
  lastName: '',
  email: '',
  englishLevel: '',
  password: '',
});

const fieldErrors = reactive<Record<string, string | null>>({
  firstName: null,
  lastName: null,
  email: null,
  password: null,
});

const submitError = ref<string | null>(null);
const englishLevels = ['Beginner', 'Intermediate', 'Advanced', 'Native'];

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
    await auth.signUp({
      // Backend uses `loginName` as both username and identifier; reusing the email
      // keeps onboarding to a single field per the Figma layout.
      loginName: form.email,
      email: form.email,
      password: form.password,
      fullName: `${form.firstName.trim()} ${form.lastName.trim()}`.trim(),
    });
    router.push({
      name: 'registration-success',
      query: { email: form.email },
    });
  } catch (err) {
    submitError.value = auth.error ?? 'Registration failed';
  }
}
</script>

<template>
  <main class="flex min-h-screen items-center justify-center bg-slate-100 p-4 sm:p-8">
    <div class="auth-card">
      <section class="px-8 py-10 sm:px-12 sm:py-14">
        <div class="mx-auto w-full max-w-sm">
          <h1 class="text-2xl font-semibold text-slate-900">Create your AI Twin Today</h1>
          <p class="mt-1 text-sm text-slate-500">Enter your details to register.</p>

          <form class="mt-8 space-y-4" novalidate @submit.prevent="onSubmit">
            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <AppInput
                id="firstName"
                v-model="form.firstName"
                label="First name"
                autocomplete="given-name"
                required
                :error="fieldErrors.firstName"
              />
              <AppInput
                id="lastName"
                v-model="form.lastName"
                label="Last name"
                autocomplete="family-name"
                required
                :error="fieldErrors.lastName"
              />
            </div>

            <AppInput
              id="email"
              v-model="form.email"
              type="email"
              label="Email address"
              autocomplete="email"
              required
              :error="fieldErrors.email"
            />

            <div>
              <label for="englishLevel" class="form-label">English level</label>
              <select id="englishLevel" v-model="form.englishLevel" class="input-base">
                <option value="" disabled>Select your level</option>
                <option v-for="lvl in englishLevels" :key="lvl" :value="lvl">{{ lvl }}</option>
              </select>
            </div>

            <AppInput
              id="password"
              v-model="form.password"
              type="password"
              label="Password"
              autocomplete="new-password"
              required
              :error="fieldErrors.password"
            />

            <p v-if="submitError" class="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {{ submitError }}
            </p>

            <AppButton type="submit" :loading="auth.loading">Sign up</AppButton>

            <p class="text-center text-sm text-slate-500">
              Already have an account?
              <RouterLink to="/signin" class="font-medium text-brand-700 hover:underline">Sign in</RouterLink>
            </p>
          </form>
        </div>
      </section>

      <BrandPanel />
    </div>
  </main>
</template>
