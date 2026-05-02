<template>
  <aside
    class="brand-panel relative hidden min-h-0 shrink-0 overflow-hidden lg:my-4 lg:mr-5 lg:flex lg:min-h-[calc(100dvh-2rem)] lg:w-[42%] lg:max-w-[707px] lg:flex-col lg:self-center lg:rounded-[40px] lg:shadow-2xl"
  >
    <!-- Background art (circuit) — keep pattern visible behind glass -->
    <div
      class="pointer-events-none absolute inset-0 bg-[url('/images/auth.png')] bg-cover bg-[position:50%_40%] bg-no-repeat"
      aria-hidden="true"
    />
    <div
      class="pointer-events-none absolute inset-0 bg-gradient-to-b from-[rgb(0_0_0_/_0.55)] via-[rgb(0_0_0_/_0.72)] to-[rgb(0_0_0_/_0.82)]"
      aria-hidden="true"
    />
    <div
      class="pointer-events-none absolute inset-0 bg-[rgb(0_0_0_/_0.15)]"
      aria-hidden="true"
    />

    <div
      class="relative z-10 flex h-full min-h-0 flex-1 flex-col justify-end px-8 py-10 text-white sm:px-10 sm:py-12 lg:px-12 lg:py-14"
    >
      <!-- Spacer so welcome + glass sit in the lower half (reference layout) -->
      <div class="min-h-0 flex-1" aria-hidden="true" />

      <header class="mb-6 max-w-xl lg:mb-8">
        <p class="text-[11px] font-bold uppercase tracking-[0.2em] text-white/90">GENIE.AI</p>
        <h2
          class="mt-3 text-3xl font-bold leading-[1.15] tracking-tight sm:text-4xl lg:text-[2.5rem] lg:leading-tight"
        >
          Welcome to GENIE.AI
        </h2>
        <p class="mt-4 text-sm leading-relaxed text-white/90 sm:text-base sm:leading-relaxed">
          GENIE.AI helps you create and manage AI Twins, giving you full control over your data while
          seamlessly tracking all your chat and call history.
        </p>
      </header>

      <!-- Glass block: notched top-right (Figma-style) -->
      <div class="brand-panel__glass w-full max-w-xl">
        <div class="brand-panel__glass-inner border border-white/25 bg-white/[0.14] p-6 shadow-[0_12px_40px_rgba(0,0,0,0.35)] backdrop-blur-[18px] sm:p-8">
          <h3 class="text-lg font-bold leading-snug text-white sm:text-xl">NCDs in Gambia</h3>
          <p class="mt-3 text-sm font-normal leading-relaxed text-white/90 sm:text-[15px]">
            To empower individuals and communities in The Gambia with accessible, personalized, and
            reliable health information through an AI-driven chatbot that supports the prevention, early
            detection, and management of non-communicable diseases.
          </p>
        </div>
      </div>
    </div>
  </aside>
</template>

<style scoped>
/* Chamfered top-right so the glass reads “notched” like the design */
.brand-panel__glass {
  filter: drop-shadow(0 4px 24px rgba(0, 0, 0, 0.25));
}

.brand-panel__glass-inner {
  clip-path: polygon(0 0, calc(100% - 2.75rem) 0, 100% 2.75rem, 100% 100%, 0 100%);
  border-radius: 0 0 0 1.25rem;
}

@media (min-width: 640px) {
  .brand-panel__glass-inner {
    clip-path: polygon(0 0, calc(100% - 3.25rem) 0, 100% 3.25rem, 100% 100%, 0 100%);
    border-radius: 0 0 0 1.5rem;
  }
}
</style>
