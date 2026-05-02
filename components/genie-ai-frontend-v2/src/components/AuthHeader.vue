<script setup lang="ts">
withDefaults(
  defineProps<{
    /** Hide the language selector (e.g. on the verify-email page). */
    showLanguage?: boolean;
    /** Anchor the logo to the left vs centered. */
    align?: 'left' | 'center';
  }>(),
  { showLanguage: true, align: 'center' }
);
</script>

<template>
  <header
    class="mb-10 flex items-center"
    :class="align === 'center' ? 'justify-center' : 'justify-between'"
  >
    <img src="/images/logo.svg" alt="IEEE" class="h-7" />

    <button
      v-if="showLanguage"
      type="button"
      class="ml-auto inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="h-4 w-4" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
      </svg>
      EN
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-3 w-3" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" d="m6 9 6 6 6-6" />
      </svg>
    </button>
  </header>
</template>
