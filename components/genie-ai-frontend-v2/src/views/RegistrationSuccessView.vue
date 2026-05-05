<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import AuthHeader from '../components/AuthHeader.vue';
import BrandPanel from '../components/BrandPanel.vue';
import { useT } from '../i18n/composables';

const { t } = useT();
const route = useRoute();

const verifyQuery = computed(() => {
  const email = typeof route.query.email === 'string' ? route.query.email : '';
  return email ? ({ email } as Record<string, string>) : {};
});
</script>

<template>
  <main class="auth-shell">
    <section class="auth-form-pane">
      <AuthHeader :align="'left'" />

      <div class="flex flex-1 flex-col justify-center">
        <div class="mx-auto w-full max-w-md text-center">
          <div
            class="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-ieee-50 text-ieee-700"
            aria-hidden="true"
          >
            <svg class="h-9 w-9" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>

          <h1 class="text-3xl font-semibold text-slate-900">{{ t('auth.registrationSuccess.title', "You're almost there") }}</h1>
          <p class="mt-2 text-sm text-slate-500">
            {{ t('auth.registrationSuccess.subtitle', 'Your account has been created. Check your inbox to verify your email, then sign in.') }}
          </p>

          <div class="mt-10 flex flex-col gap-3">
            <RouterLink
              :to="{ name: 'verify-email', query: verifyQuery }"
              class="btn-primary text-center no-underline"
            >
              {{ t('auth.registrationSuccess.enterCode', 'Enter verification code') }}
            </RouterLink>
            <RouterLink
              :to="{ name: 'signin' }"
              class="btn-soft text-center no-underline"
            >
              {{ t('common.backToSignIn', 'Back to sign in') }}
            </RouterLink>
          </div>
        </div>
      </div>

      <p class="mt-8 text-center text-xs leading-relaxed text-slate-400">
        {{ t('auth.legal.prefix', 'By signing up, you agree to our') }}
        <a href="#" class="text-ieee-700 hover:underline">{{ t('auth.legal.terms', 'terms of service') }}</a>
        {{ t('auth.legal.and', 'and') }}
        <a href="#" class="text-ieee-700 hover:underline">{{ t('auth.legal.privacy', 'privacy policy') }}</a>.
      </p>
    </section>

    <BrandPanel />
  </main>
</template>
