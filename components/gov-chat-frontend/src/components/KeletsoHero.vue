<template>
  <!-- AgriConnect LSO / Keletso: home-screen hero. Banner art is Adem's
       asset since M.8 (was the ported Keletso SVG landscape); the greeting
       pill design remains Keletso's. Pure markup, no data or API calls. -->
  <section class="kl-hero">
    <div class="kl-hero-banner">
      <img src="/config/welcome-art.webp" alt="" aria-hidden="true" class="kl-hero-art">
    </div>
    <div class="kl-hero-pill">
      <p class="kl-hero-greeting">{{ greeting }}</p>
      <p v-if="subline" class="kl-hero-subline">{{ subline }}</p>
    </div>
  </section>
</template>

<script>
export default {
  name: "KeletsoHero",
  props: {
    greeting: { type: String, default: "" },
    subline: { type: String, default: "" },
  },
};
</script>

<style scoped>
.kl-hero {
  position: relative;
  width: 100%;
  padding-top: 16px; /* M.8: moved up (was 64px) */
  margin-bottom: 20px;
  text-align: left;
}

.kl-hero-banner {
  position: relative;
  overflow: hidden;
  height: 240px;
  border-radius: 28px;
  background: #dcebf5;
  box-shadow: 0 14px 30px -18px rgba(20, 40, 25, 0.45);
}

/* M.8: Adem's welcome art (1024×434 transparent webp) — cover-crops
   cleanly into the banner; the old SVG scene was 35KB of markup */
.kl-hero-art {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/* Mascot removed (Adem, 10-06) — the pill now centers over the landscape */
.kl-hero-pill {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  bottom: 46px;
  z-index: 2;
  max-width: 80%;
  padding: 12px 26px;
  border: 2px solid #d99a1e;
  border-radius: 999px;
  background: #1f4a2b;
  color: #ffffff;
  box-shadow: 0 10px 24px -10px rgba(0, 0, 0, 0.45);
}

.kl-hero-greeting {
  margin: 0;
  font-size: 1.3rem;
  font-weight: 800;
  line-height: 1.15;
  color: #ffffff;
}

.kl-hero-subline {
  margin: 2px 0 0;
  font-size: 0.95rem;
  line-height: 1.3;
  color: #d6e9db;
}

@media (max-width: 640px) {
  .kl-hero { padding-top: 12px; }
  .kl-hero-banner { height: 200px; border-radius: 22px; }
  .kl-hero-pill {
    left: 10px;
    right: 10px;
    transform: none;
    bottom: 18px;
    max-width: none;
    padding: 10px 14px;
    border-radius: 20px;
  }
  .kl-hero-greeting { font-size: 1.05rem; }
  .kl-hero-subline { font-size: 0.8rem; }
}
</style>