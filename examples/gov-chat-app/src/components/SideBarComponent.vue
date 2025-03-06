<!-- SideBarComponent.vue -->
<template>
  <aside class="side-bar" :class="{ 'side-bar-open': isOpen }">
    <div class="sidebar-inner">
      <!-- Keep your existing child components (service tree, chat history, etc.) -->
      <service-tree-panel-component />
      <chat-history-component />
    </div>
  </aside>
</template>

<script>
import ServiceTreePanelComponent from './ServiceTreePanelComponent.vue'
import ChatHistoryComponent from './ChatHistoryComponent.vue'

export default {
  name: 'SideBarComponent',
  components: {
    ServiceTreePanelComponent,
    ChatHistoryComponent
  },
  props: {
    isOpen: { type: Boolean, default: true }
  }
}
</script>

<style scoped>
.side-bar {
  width: 300px;
  background: #ffffff;
  border-right: 1px solid #ddd;
  height: 100%;
  overflow-y: auto;
  transition: transform 0.3s ease, width 0.3s ease;
}

.sidebar-inner {
  padding: 10px;
}

/* Mobile: offscreen unless side-bar-open is set */
@media screen and (max-width: 768px) {
  .side-bar {
    position: absolute;
    top: 0;
    left: 0;
    transform: translateX(-100%);
    z-index: 10;
  }
  .side-bar.side-bar-open {
    transform: translateX(0);
  }
}

/* Desktop: if not open, set width=0 or transform */
@media screen and (min-width: 769px) {
  .side-bar {
    transform: translateX(0);
    width: 250px;
  }
  .side-bar:not(.side-bar-open) {
    width: 0;
    padding: 0;
    overflow: hidden;
  }
}
</style>

