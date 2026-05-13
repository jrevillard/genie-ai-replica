<template>
  <div class="callback-view">
    <p>Completing authentication...</p>
  </div>
</template>

<script>
export default {
  name: 'CallbackView',
  async mounted() {
    try {
      const user = await this.$store.dispatch('handleCallback');
      const returnUrl = user?.state?.returnUrl || '/dashboard';
      this.$router.replace(returnUrl);
    } catch (error) {
      console.error('[CallbackView] Authentication callback failed:', error.message);
      this.$router.replace('/');
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
</style>
