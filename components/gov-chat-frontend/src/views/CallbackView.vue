<template>
  <div class="callback-view">
    <p v-if="!error">Completing authentication...</p>
    <!-- Local delta vs upstream v2.0.1 (which bounces to '/'): the frozen I/O
         matrix requires "mismatch -> structured error view, no crash" — the
         store already holds the structured {code, message} (CALLBACK_ERROR). -->
    <div v-else class="callback-error" role="alert">
      <p class="callback-error__title">Authentication failed</p>
      <p class="callback-error__message">{{ errorMessage }}</p>
      <button class="callback-error__retry" @click="retry">Try again</button>
    </div>
  </div>
</template>

<script>
// Ported from upstream GenieAI v2.0.1 (components/gov-chat-frontend/src/views/CallbackView.vue).
export default {
  name: 'CallbackView',
  data() {
    return { error: false };
  },
  computed: {
    errorMessage() {
      return this.$store.getters.authError || 'Authentication callback failed. Please try again.';
    }
  },
  async mounted() {
    try {
      const user = await this.$store.dispatch('handleCallback');
      const returnUrl = user?.state?.returnUrl || '/dashboard';
      this.$router.replace(returnUrl);
    } catch (error) {
      console.error('[CallbackView] Authentication callback failed:', error.message);
      this.error = true;
    }
  },
  methods: {
    retry() {
      this.$store.dispatch('login').catch(console.error);
    }
  }
};
</script>

<style scoped>
.callback-view {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100vh;
  font-size: var(--text-lg);
  color: var(--fg);
}

.callback-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  text-align: center;
}

.callback-error__title {
  font-weight: 600;
}

.callback-error__message {
  font-size: var(--text-md);
  opacity: 0.85;
}

.callback-error__retry {
  padding: 0.5rem 1.25rem;
  cursor: pointer;
}
</style>
