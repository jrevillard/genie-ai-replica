<script setup lang="ts">
import BaseSkeleton from './BaseSkeleton.vue';
</script>

<template>
  <div class="space-y-6" aria-hidden="true">
    <!-- Back button -->
    <BaseSkeleton variant="circle" width="2.25rem" height="2.25rem" />

    <!-- Header: avatar + name/email/verified pill/last-active badge + Delete user pill -->
    <header class="flex flex-wrap items-center justify-between gap-4">
      <div class="flex items-center gap-4">
        <BaseSkeleton variant="circle" width="5rem" height="5rem" />
        <div class="flex flex-col gap-2">
          <BaseSkeleton height="1.5rem" width="11rem" rounded="md" />
          <div class="flex items-center gap-2">
            <BaseSkeleton height="0.875rem" width="13rem" rounded="md" />
            <BaseSkeleton height="1.125rem" width="4.25rem" rounded="full" />
          </div>
          <BaseSkeleton height="1.25rem" width="11rem" rounded="full" />
        </div>
      </div>
      <BaseSkeleton height="2.5rem" width="9rem" rounded="full" />
    </header>

    <!-- Stats grid: 4 cards (Chats / WhatsApp / Calls / Sessions) -->
    <section class="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <article
        v-for="n in 4"
        :key="n"
        class="rounded-2xl border border-border-subtle bg-surface p-4"
      >
        <div class="flex items-center gap-3">
          <BaseSkeleton variant="circle" width="2.5rem" height="2.5rem" />
          <div class="min-w-0 flex-1 space-y-2">
            <BaseSkeleton height="0.6875rem" width="3.5rem" rounded="md" />
            <BaseSkeleton height="1.5rem" width="3rem" rounded="md" />
          </div>
        </div>
        <BaseSkeleton height="0.6875rem" width="80%" rounded="md" class="mt-2" />
      </article>
    </section>

    <!-- Tabs row + Update button -->
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex gap-2 rounded-full bg-surface-muted p-1">
        <BaseSkeleton height="2.25rem" width="6rem" rounded="full" />
        <BaseSkeleton height="2.25rem" width="9rem" rounded="full" />
      </div>
      <BaseSkeleton height="2.5rem" width="6.5rem" rounded="full" />
    </div>

    <!-- General-tab content (the default tab when the page first loads) -->
    <div class="rounded-2xl border border-border bg-surface p-6 shadow-card">
      <!-- Section title + subtitle -->
      <div class="mb-6 space-y-2">
        <BaseSkeleton height="1.25rem" width="11rem" rounded="md" />
        <BaseSkeleton height="0.75rem" width="20rem" rounded="md" />
      </div>

      <div class="space-y-5">
        <!-- First Name / Last Name -->
        <div class="grid gap-4 sm:grid-cols-2">
          <div class="space-y-1.5">
            <BaseSkeleton height="0.875rem" width="5rem" rounded="md" />
            <BaseSkeleton height="2.5rem" width="100%" rounded="lg" />
          </div>
          <div class="space-y-1.5">
            <BaseSkeleton height="0.875rem" width="5rem" rounded="md" />
            <BaseSkeleton height="2.5rem" width="100%" rounded="lg" />
          </div>
        </div>

        <!-- Email -->
        <div class="space-y-1.5">
          <BaseSkeleton height="0.875rem" width="3.5rem" rounded="md" />
          <BaseSkeleton height="2.5rem" width="100%" rounded="lg" />
        </div>

        <!-- Date of Birth -->
        <div class="space-y-1.5">
          <BaseSkeleton height="0.875rem" width="7rem" rounded="md" />
          <BaseSkeleton height="2.5rem" width="100%" rounded="lg" />
        </div>

        <!-- Notes textarea -->
        <div class="space-y-1.5">
          <BaseSkeleton height="0.875rem" width="3.5rem" rounded="md" />
          <BaseSkeleton height="6rem" width="100%" rounded="lg" />
        </div>

        <!-- Change-password panel (collapsed shape) -->
        <div class="flex items-center justify-between gap-3 rounded-2xl border border-accent/15 bg-accent-soft/40 p-4">
          <div class="flex items-center gap-3">
            <BaseSkeleton width="2.25rem" height="2.25rem" rounded="xl" />
            <div class="space-y-1.5">
              <BaseSkeleton height="0.875rem" width="9rem" rounded="md" />
              <BaseSkeleton height="0.75rem" width="14rem" rounded="md" />
            </div>
          </div>
          <BaseSkeleton width="1.25rem" height="1.25rem" rounded="md" />
        </div>
      </div>
    </div>
  </div>
</template>
