<!-- src/components/SideBarComponent.vue -->
<template>
  <aside class="side-bar" :class="{ 'side-bar-open': isOpen }">
    <div class="sidebar-inner">
      <service-tree-panel-component />

      <h3>{{ $t('sidebar.chatHistory') }}</h3>
      <ul>
        <li>Tax Inquiry 2025-02-27</li>
        <li>Fire Safety 2025-02-26</li>
      </ul>
    </div>
  </aside>
</template>

<script>
import ServiceTreePanelComponent from './ServiceTreePanelComponent.vue'

export default {
  name: 'SideBarComponent',
  components: {
    ServiceTreePanelComponent
  },
  props: {
    isOpen: { type: Boolean, default: true }
  }
}
</script>

<style scoped>
.side-bar {
  width: 300px;
  background: #fff;
  border-right: 1px solid #ddd;
  height: 100%;
  overflow-y: auto;
  transition: transform 0.3s ease, width 0.3s ease;
}

.sidebar-inner {
  padding: 10px;
}

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

