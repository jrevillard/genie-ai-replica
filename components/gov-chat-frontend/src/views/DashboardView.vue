<!-- src/views/DashboardView.vue -->
<template>
  <div class="dashboard-content genie-living-intelligence">
    <chat-bot-component />
  </div>
</template>

<script>
import ChatBotComponent from '@/components/ChatBotComponent.vue';

export default {
  name: 'DashboardView',
  components: {
    ChatBotComponent
  },
  inject: ['config']
};
</script>

<style scoped>
.dashboard-content {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
}

.dashboard-banner-wrap {
  padding: var(--space-md) var(--space-md) 0;
  flex-shrink: 0;
}

.dashboard-banner {
  width: 100%;
  max-width: 960px;
  margin: 0 auto;
  aspect-ratio: 2019 / 464;
  background-repeat: no-repeat;
  background-position: center;
  background-size: contain;
  position: relative;
  border-radius: var(--radius-md);
  overflow: hidden;
}
[data-theme='dark'] .dashboard-banner {
  filter: brightness(0.85);
}

.dashboard-banner-leaves {
  position: absolute;
  right: 4%;
  top: -10px;
  width: 14%;
  max-width: 80px;
  height: auto;
  pointer-events: none;
  transform: rotate(-12deg);
  opacity: 0.9;
}
[data-theme='dark'] .dashboard-banner-leaves {
  opacity: 0.78;
}
</style>
