<script setup lang="ts">
import { reactive, ref } from 'vue';
import { Eye, EyeOff } from 'lucide-vue-next';
import { useRouter } from 'vue-router';
import { sileo } from '../lib/notify';
import AuthHeader from '../components/AuthHeader.vue';
import BrandPanel from '../components/BrandPanel.vue';
import BaseButton from '../components/ui/BaseButton.vue';
import BaseInput from '../components/ui/BaseInput.vue';
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

const passwordVisible = ref(false);

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
            <BaseInput
              id="firstName"
              v-model="form.firstName"
              label="First Name"
              placeholder="Enter your first name"
              autocomplete="given-name"
              required
              rounded="full"
              :error="errors.firstName"
            />
            <BaseInput
              id="lastName"
              v-model="form.lastName"
              label="Last Name"
              placeholder="Enter your last name"
              autocomplete="family-name"
              required
              rounded="full"
              :error="errors.lastName"
            />
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
            <BaseInput
              id="password"
              v-model="form.password"
              :type="passwordVisible ? 'text' : 'password'"
              label="Password"
              placeholder="Enter your password"
              autocomplete="new-password"
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

            <BaseButton type="submit" variant="primary" block :loading="auth.loading">Sign up</BaseButton>

            <p class="pt-1 text-center text-body text-text-muted">
              Already have an account?
              <RouterLink to="/signin" class="font-semibold text-accent hover:underline">Sign in</RouterLink>
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
