<script setup lang="ts">
defineProps<{
  /** Optional override of the dark backdrop image. */
  backgroundUrl?: string;
}>();
</script>

<template>
  <aside class="auth-brand-pane" aria-hidden="true">
    <div class="auth-brand-card">
      <!-- Backdrop image (auth.png) fills the rounded card; absolutely positioned
           so the content lays cleanly on top with its own padding. -->
      <img
        :src="backgroundUrl ?? '/images/auth.png'"
        alt=""
        class="absolute inset-0 h-full w-full object-cover"
      />
      <div
        class="absolute inset-0 bg-gradient-to-b from-ieee-950/70 via-ieee-950/40 to-ieee-950/85"
      />

      <div class="relative flex h-full flex-col justify-between p-10">
        <header class="space-y-2">
          <p class="text-xs font-bold uppercase tracking-[0.3em] text-white/70">IEEE</p>
          <h2 class="text-3xl font-semibold leading-tight">Welcome to IEEE</h2>
          <p class="max-w-xs text-sm leading-relaxed text-white/80">
            IEEE helps you create and manage AI Twins, giving you full control over your data while
            seamlessly tracking all your chat and call history.
          </p>
        </header>

        <div class="rounded-2xl border border-white/15 bg-white/10 p-5 backdrop-blur-md">
          <h3 class="text-xl font-semibold text-white">NCDs in Gambia</h3>
          <p class="mt-2 text-sm leading-relaxed text-white/80">
            To empower individuals and communities in The Gambia with accessible, personalized, and
            reliable health information through an AI-driven chatbot that supports the prevention,
            early detection, and management of non-communicable diseases.
          </p>
        </div>
      </div>
    </div>
  </aside>
</template>
