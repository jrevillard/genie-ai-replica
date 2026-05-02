<script setup lang="ts">
import { useRoute } from 'vue-router';
import AppButton from '../components/AppButton.vue';

const route = useRoute();
const email = (route.query.email as string) ?? '';
</script>

<template>
  <main class="flex min-h-screen items-center justify-center bg-slate-100 p-4 sm:p-8">
    <section class="w-full max-w-md rounded-2xl bg-white p-8 text-center shadow-xl sm:p-10">
      <div class="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-green-50">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="h-8 w-8 text-green-600" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" />
        </svg>
      </div>

      <h1 class="text-2xl font-semibold text-slate-900">Account created</h1>
      <p class="mt-2 text-sm text-slate-500">
        We sent a verification message to
        <span v-if="email" class="font-medium text-slate-700">{{ email }}</span>
        <span v-else>your email</span>. Click the link inside, or enter the code on the next screen.
      </p>

      <div class="mt-8 space-y-3">
        <RouterLink :to="{ name: 'verify-email', query: { email } }" class="block">
          <AppButton>Enter verification code</AppButton>
        </RouterLink>
        <RouterLink to="/signin" class="block text-sm text-brand-700 hover:underline">
          Back to sign in
        </RouterLink>
      </div>
    </section>
  </main>
</template>
