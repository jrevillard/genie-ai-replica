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
      class="relative z-10 flex h-full min-h-0 flex-1 flex-col justify-end gap-6 px-8 py-10 text-white sm:gap-8 sm:px-10 sm:py-12 lg:px-12 lg:py-14"
    >
      <header class="max-w-xl shrink-0">
        <p class="text-[11px] font-bold uppercase tracking-[0.2em] text-white/90">IEEE</p>
        <h2
          class="mt-3 text-2xl font-bold leading-[1.15] tracking-tight sm:text-3xl lg:text-[2.25rem] lg:leading-tight xl:text-[2.5rem]"
        >
          Welcome to IEEE
        </h2>
        <p class="mt-3 text-sm leading-relaxed text-white/90 sm:mt-4 sm:text-base sm:leading-relaxed">
          IEEE helps you create and manage AI Twins, giving you full control over your data while
          seamlessly tracking all your chat and call history.
        </p>
      </header>

      <!-- Glass block (responsive, content-driven height) -->
      <div class="brand-panel__glass w-full max-w-xl shrink-0 px-6 py-6 pr-10 text-white sm:px-8 sm:py-8">
        <h3 class="text-lg font-bold leading-snug text-white sm:text-xl">NCDs in Gambia</h3>
        <p class="mt-3 text-sm font-normal leading-relaxed text-white/90 sm:text-[15px]">
          To empower individuals and communities in The Gambia with accessible, personalized, and
          reliable health information through an AI-driven chatbot that supports the prevention, early
          detection, and management of non-communicable diseases.
        </p>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.brand-panel__glass {
  background: rgba(255, 255, 255, 0.14);
  border: 1px solid rgba(255, 255, 255, 0.28);
  border-radius: 1.75rem;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
}
</style>
