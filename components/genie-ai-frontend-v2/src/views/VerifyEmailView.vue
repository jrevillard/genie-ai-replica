<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const status = ref<'idle' | 'verifying' | 'success' | 'error'>('idle');
const message = ref<string | null>(null);

onMounted(() => {
  const tokenFromUrl = route.query.token as string | undefined;
  if (tokenFromUrl) runVerify(tokenFromUrl);
});

async function runVerify(token: string) {
  status.value = 'verifying';
  message.value = null;
  try {
    await auth.verifyEmail(token);
    status.value = 'success';
    setTimeout(() => router.push({ name: 'signin' }), 1500);
  } catch {
    status.value = 'error';
    message.value = auth.error ?? 'Verification failed. The link may have expired.';
  }
}
</script>

<template>
  <main class="flex min-h-screen items-center justify-center px-4 py-8">
    <section
      class="relative mx-auto w-full max-w-2xl overflow-hidden rounded-3xl border border-slate-200 bg-white p-8 shadow-card sm:p-12"
    >
      <header class="mb-6 flex items-center">
        <img src="/images/logo.svg" alt="IEEE" class="h-7" />
      </header>

      <div class="flex flex-col items-center text-center">
        <img src="/images/verify-email.svg" alt="" class="h-40 w-auto" aria-hidden="true" />

        <h1 class="mt-4 text-2xl font-semibold text-slate-900 sm:text-3xl">Verify Your Email</h1>
        <p class="mt-2 max-w-md text-sm text-slate-500">
          We've sent you a verification link. Please open the email and click
          <span class="font-semibold text-slate-700">Verify Email</span> to continue.
          If you can't find it, check your spam folder too!
        </p>

        <p
          v-if="message"
          class="mt-6 max-w-md rounded-2xl px-4 py-2 text-sm"
          :class="status === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'"
        >
          {{ message }}
        </p>
        <p v-if="status === 'verifying'" class="mt-6 text-sm text-slate-500">
          Verifying your email…
        </p>
        <p v-if="status === 'success'" class="mt-2 text-sm text-green-700">
          Email verified — redirecting to sign in…
        </p>

        <RouterLink to="/signup" class="mt-8 text-sm font-semibold text-ieee-700 hover:underline">
          Back to signup
        </RouterLink>
      </div>

      <footer class="mt-10 flex justify-end text-xs text-slate-400">
        <a href="mailto:Support@gmail.com" class="hover:text-slate-600">Support@gmail.com</a>
      </footer>
    </section>
  </main>
</template>
