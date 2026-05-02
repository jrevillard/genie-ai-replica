<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import CodeInput from '../components/CodeInput.vue';
import { useAuthStore } from '../stores/auth';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const code = ref('');
const status = ref<'idle' | 'verifying' | 'success' | 'error'>('idle');
const message = ref<string | null>(null);
const email = ref<string>((route.query.email as string) ?? '');

// 60-second countdown for the Resend button. Starts on mount (the user has just
// arrived from sign-up) and restarts whenever they tap Resend.
const RESEND_SECONDS = 60;
const cooldown = ref(RESEND_SECONDS);
let timer: ReturnType<typeof setInterval> | null = null;

function startCountdown() {
  cooldown.value = RESEND_SECONDS;
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    cooldown.value -= 1;
    if (cooldown.value <= 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  }, 1000);
}

onMounted(() => {
  startCountdown();
  const tokenFromUrl = route.query.token as string | undefined;
  if (tokenFromUrl) runVerify(tokenFromUrl);
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
});

const canResend = computed(() => cooldown.value <= 0 && !!email.value);
const resendLabel = computed(() =>
  cooldown.value > 0 ? `Resend Code in ${cooldown.value}s` : 'Resend Code'
);

async function runVerify(token: string) {
  status.value = 'verifying';
  message.value = null;
  try {
    await auth.verifyEmail(token);
    status.value = 'success';
    setTimeout(() => router.push({ name: 'signin' }), 1500);
  } catch {
    status.value = 'error';
    message.value = auth.error ?? 'Verification failed. Check the code and try again.';
  }
}

async function onResend() {
  if (!canResend.value) return;
  try {
    await auth.resendVerification(email.value);
    message.value = 'A new verification message has been sent if the email exists in our system.';
    startCountdown();
  } catch {
    message.value = 'Could not resend right now. Please try again later.';
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
          We've sent you a verification code. If you can't find it, check your spam folder too!
        </p>

        <div class="mt-8 w-full">
          <CodeInput
            v-model="code"
            :length="6"
            :disabled="status === 'verifying' || status === 'success'"
            @complete="runVerify"
          />
        </div>

        <p
          v-if="message"
          class="mt-4 max-w-md rounded-2xl px-4 py-2 text-sm"
          :class="status === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'"
        >
          {{ message }}
        </p>
        <p v-if="status === 'success'" class="mt-2 text-sm text-green-700">
          Email verified — redirecting to sign in…
        </p>

        <button
          type="button"
          class="btn-soft mt-8 max-w-md"
          :disabled="!canResend"
          @click="onResend"
        >
          {{ resendLabel }}
        </button>

        <p v-if="cooldown > 0" class="mt-3 text-xs text-slate-400">
          Wait for {{ cooldown }} Second{{ cooldown === 1 ? '' : 's' }} to receive email
        </p>

        <RouterLink to="/signup" class="mt-4 text-sm font-semibold text-ieee-700 hover:underline">
          Back to signup
        </RouterLink>
      </div>

      <footer class="mt-10 flex justify-end text-xs text-slate-400">
        <a href="mailto:Support@gmail.com" class="hover:text-slate-600">Support@gmail.com</a>
      </footer>
    </section>
  </main>
</template>
