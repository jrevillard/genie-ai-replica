<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import AppButton from '../components/AppButton.vue';
import CodeInput from '../components/CodeInput.vue';
import { useAuthStore } from '../stores/auth';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const code = ref('');
const status = ref<'idle' | 'verifying' | 'success' | 'error'>('idle');
const message = ref<string | null>(null);
const email = ref<string>((route.query.email as string) ?? '');

async function runVerify(token: string) {
  status.value = 'verifying';
  message.value = null;
  try {
    await auth.verifyEmail(token);
    status.value = 'success';
    setTimeout(() => router.push({ name: 'signin' }), 1500);
  } catch (err) {
    status.value = 'error';
    message.value = auth.error ?? 'Verification failed. Check the code and try again.';
  }
}

onMounted(() => {
  // If the user lands here from the email link (?token=...), auto-verify.
  const tokenFromUrl = route.query.token as string | undefined;
  if (tokenFromUrl) {
    runVerify(tokenFromUrl);
  }
});

async function onResend() {
  if (!email.value) {
    message.value = 'Enter your email above so we can resend the code.';
    return;
  }
  try {
    await auth.resendVerification(email.value);
    message.value = 'If the email exists, a new verification message has been sent.';
  } catch {
    message.value = 'Could not resend right now. Please try again later.';
  }
}
</script>

<template>
  <main class="flex min-h-screen items-center justify-center bg-slate-100 p-4 sm:p-8">
    <section class="w-full max-w-md rounded-2xl bg-white p-8 shadow-xl sm:p-10">
      <div class="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-brand-50">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="h-7 w-7 text-brand-600" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="M21 7.5l-9 6-9-6m18 0v9a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 16.5v-9m18 0A2.25 2.25 0 0 0 18.75 5.25H5.25A2.25 2.25 0 0 0 3 7.5" />
        </svg>
      </div>

      <h1 class="text-center text-2xl font-semibold text-slate-900">Verify Your Email</h1>
      <p class="mt-2 text-center text-sm text-slate-500">
        Enter the 6-character code we sent to your inbox{{ email ? `, ${email}` : '' }}.
      </p>

      <div class="mt-8">
        <CodeInput v-model="code" :length="6" :disabled="status === 'verifying' || status === 'success'" @complete="runVerify" />
      </div>

      <p
        v-if="message"
        class="mt-4 rounded-md px-3 py-2 text-center text-sm"
        :class="status === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'"
      >
        {{ message }}
      </p>
      <p v-if="status === 'success'" class="mt-4 text-center text-sm text-green-700">
        Email verified — redirecting to sign in&hellip;
      </p>

      <div class="mt-8 flex flex-col gap-3">
        <AppButton :loading="status === 'verifying'" :disabled="code.length < 6" @click="runVerify(code)">
          Verify
        </AppButton>
        <button type="button" class="text-center text-sm text-brand-700 hover:underline" @click="onResend">
          Resend code
        </button>
      </div>
    </section>
  </main>
</template>
