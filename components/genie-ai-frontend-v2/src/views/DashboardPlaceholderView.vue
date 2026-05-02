<script setup lang="ts">
import { useRouter } from 'vue-router';
import AppButton from '../components/AppButton.vue';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const router = useRouter();

async function onSignOut() {
  await auth.signOut();
  router.push({ name: 'signin' });
}
</script>

<template>
  <main class="min-h-screen bg-slate-50">
    <header class="border-b border-slate-200 bg-white">
      <div class="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <div class="flex items-center gap-3">
          <div class="rounded-md bg-brand-950 px-3 py-1.5 text-sm font-bold tracking-wider text-white">IEEE</div>
          <span class="text-sm font-medium text-slate-600">GENIE.AI</span>
        </div>
        <div class="flex items-center gap-4">
          <span class="text-sm text-slate-600">{{ auth.displayName }}</span>
          <button class="text-sm font-medium text-slate-600 hover:text-slate-900" @click="onSignOut">
            Sign out
          </button>
        </div>
      </div>
    </header>

    <section class="mx-auto max-w-3xl px-6 py-16">
      <div class="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center">
        <h1 class="text-2xl font-semibold text-slate-900">You are signed in.</h1>
        <p class="mt-2 text-sm text-slate-500">
          AI Twin and Chat &amp; Call History will live here once those backend services are ready.
        </p>
        <div class="mt-6 inline-block">
          <AppButton variant="ghost" @click="onSignOut">Sign out</AppButton>
        </div>
      </div>
    </section>
  </main>
</template>
