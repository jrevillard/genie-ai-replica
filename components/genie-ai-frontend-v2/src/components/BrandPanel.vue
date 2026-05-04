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
        <p class="text-[11px] font-bold uppercase tracking-[0.2em] text-white/90">IEEE</p>
        <h2
          class="mt-3 text-3xl font-bold leading-[1.15] tracking-tight sm:text-4xl lg:text-[2.5rem] lg:leading-tight"
        >
          Welcome to IEEE
        </h2>
        <p class="mt-4 text-sm leading-relaxed text-white/90 sm:text-base sm:leading-relaxed">
          IEEE helps you create and manage AI Twins, giving you full control over your data while
          seamlessly tracking all your chat and call history.
        </p>
      </header>

      <!--
        Glass block — shape is driven by /images/auth-card.svg (rounded body
        with a concave inner corner connecting a smaller top-left tab to a
        wider bottom). The SVG renders the fill + stroke; content layers on top.
      -->
      <div class="brand-panel__glass relative w-full max-w-xl">
        <svg
          class="block h-auto w-full"
          viewBox="0 0 600.438 232.254"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path
            d="M460.606 0H30C13.4315 0 0 13.4315 0 30V202.254C0 218.822 13.4315 232.254 30 232.254H570.438C587.006 232.254 600.438 218.822 600.438 202.254V113.308C600.438 96.7398 587.006 83.3084 570.438 83.3084H520.606C504.038 83.3084 490.606 69.8769 490.606 53.3084V30C490.606 13.4315 477.175 0 460.606 0Z"
            fill="rgba(255,255,255,0.14)"
            stroke="rgba(255,255,255,0.28)"
            stroke-width="1"
            vector-effect="non-scaling-stroke"
          />
        </svg>
        <div
          class="absolute inset-0 flex flex-col justify-center px-6 py-6 pr-24 text-white sm:px-8 sm:py-8 sm:pr-32"
        >
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
.brand-panel__glass {
  filter: drop-shadow(0 12px 32px rgba(0, 0, 0, 0.35));
}
</style>
