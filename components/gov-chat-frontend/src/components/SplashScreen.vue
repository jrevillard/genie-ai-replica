// src/components/SplashScreen.vue
<template>
  <div class="splash-screen" :class="{ 'fade-out': isFadingOut }">
    <div class="splash-content">
      <img
        src="/config/splash.png"
        alt="Splash Screen"
        class="splash-image"
        @error="handleImageError"
        @load="handleImageLoad"
      />
      <div v-if="imageError" class="splash-fallback">Splash Screen Fallback</div>
    </div>
  </div>
</template>

<script>
export default {
  name: 'SplashScreen',
  emits: ['splash-complete'],
  data() {
    return {
      isFadingOut: false,
      imageError: false
    };
  },
  mounted() {
    setTimeout(() => {
      this.isFadingOut = true;
      setTimeout(() => {
        this.$emit('splash-complete');
      }, 1000); // 1s fade-out duration
    }, 5000); // 5s display duration
  },
  methods: {
    handleImageLoad() {
      // Image loaded successfully
    },
    handleImageError() {
      this.imageError = true;
    }
  }
};
</script>

<style scoped>
.splash-screen {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 30000; /* Ensure it’s above other elements */
  background-color: var(--overlay-bg);
  animation: splash-fade-in 0.5s ease-in;
}

.splash-content {
  text-align: center;
}

.splash-image {
  max-width: 50%;
  max-height: 50%;
  object-fit: contain;
  border-radius: var(--radius-xl); /* Rounded corners for the box */
  box-shadow: var(--shadow-lg); /* Intentionally large decorative shadow */
}

.splash-fallback {
  color: var(--fg);
  font-size: var(--text-xl);
  margin-top: var(--space-md);
}

.splash-screen.fade-out {
  animation: splash-fade-out 1s ease-out forwards;
}

@keyframes splash-fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes splash-fade-out {
  from {
    opacity: 1;
  }
  to {
    opacity: 0;
  }
}
</style>
