<script setup lang="ts">
import BaseSkeleton from './BaseSkeleton.vue';
</script>

<template>
  <article
    class="relative flex flex-col gap-5 overflow-hidden rounded-3xl border border-slate-200/70 bg-gradient-to-br from-white via-white to-slate-50/40 p-5 shadow-card-soft"
    aria-hidden="true"
  >
    <!-- Matches the always-on hairline accent at the top of the real card. -->
    <span
      class="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-ieee-500/30 to-transparent"
    />

    <!-- Header: avatar + name/email + last-active pill -->
    <header class="flex items-start gap-3">
      <BaseSkeleton variant="circle" width="3.5rem" height="3.5rem" />
      <div class="flex min-w-0 flex-1 flex-col gap-1.5">
        <div class="flex items-center gap-2">
          <BaseSkeleton height="1rem" width="8rem" rounded="md" />
          <BaseSkeleton height="0.875rem" width="3.75rem" rounded="full" />
        </div>
        <BaseSkeleton height="0.75rem" width="11rem" rounded="md" />
      </div>
      <BaseSkeleton height="1.5rem" width="7rem" rounded="full" />
    </header>

    <!-- Stat tiles: 3 columns matching Chats / WhatsApp / Calls -->
    <div class="grid grid-cols-3 gap-2.5">
      <div
        v-for="n in 3"
        :key="n"
        class="flex flex-col gap-2 rounded-2xl bg-slate-50/60 p-3 ring-1 ring-slate-200/60"
      >
        <div class="flex items-center justify-between">
          <BaseSkeleton variant="circle" width="1.75rem" height="1.75rem" />
          <BaseSkeleton height="1.25rem" width="1.5rem" rounded="md" />
        </div>
        <BaseSkeleton height="0.625rem" width="3.5rem" rounded="md" />
      </div>
    </div>

    <!-- Metadata strip (Sessions / Born / Joined) -->
    <div class="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-slate-100 pt-3">
      <BaseSkeleton height="0.75rem" width="5.5rem" rounded="md" />
      <BaseSkeleton height="0.75rem" width="7rem" rounded="md" />
      <BaseSkeleton height="0.75rem" width="6.5rem" rounded="md" />
    </div>

    <!-- Right-aligned CTA -->
    <div class="flex justify-end">
      <BaseSkeleton height="2.75rem" width="9rem" rounded="full" />
    </div>
  </article>
</template>

<style scoped>
.shadow-card-soft {
  box-shadow:
    0 1px 2px rgba(15, 23, 42, 0.04),
    0 4px 16px rgba(15, 23, 42, 0.04);
}
</style>
