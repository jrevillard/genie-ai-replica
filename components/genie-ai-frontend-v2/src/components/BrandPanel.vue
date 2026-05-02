<script setup lang="ts">
defineProps<{
  title?: string;
  body?: string;
  tagline?: string;
}>();
</script>

<template>
  <aside
    class="relative hidden flex-col justify-between bg-brand-950 p-10 text-white md:flex"
    aria-hidden="true"
  >
    <div class="flex items-center gap-2">
      <div class="rounded-md bg-white/10 px-3 py-1.5 text-sm font-bold tracking-wider">IEEE</div>
    </div>

    <div class="space-y-4">
      <h2 class="text-2xl font-semibold leading-tight">
        {{ title ?? 'Welcome to IEEE' }}
      </h2>
      <p class="text-sm leading-relaxed text-white/70">
        {{
          body ??
          'Build and chat with your AI Twin. A sovereign generative-AI platform tailored for the public sector.'
        }}
      </p>
    </div>

    <div class="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-xs uppercase tracking-wider text-white/60">
      {{ tagline ?? 'NCDs in Gambia' }}
    </div>

    <div
      class="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full bg-brand-600/30 blur-3xl"
    />
    <div
      class="pointer-events-none absolute -bottom-32 -left-32 h-96 w-96 rounded-full bg-brand-700/20 blur-3xl"
    />
  </aside>
</template>
