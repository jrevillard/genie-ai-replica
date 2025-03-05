<!-- SideBarComponent.vue -->
<template>
  <!-- 
    We add :class="{ 'side-bar-open': isOpen }" 
    so the sidebar can expand/collapse based on the isOpen prop 
  -->
  <aside class="side-bar" :class="{ 'side-bar-open': isOpen }">
    <div class="sidebar-inner">
      <!-- 
        Preserve all your existing child components/features here 
        (e.g., the service tree, chat history, etc.). 
        For example:
      -->
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
    // The boolean prop that toggles open/closed 
    isOpen: {
      type: Boolean,
      default: true
    }
  }
}
</script>

<style scoped>
/* 
  Your existing CSS, plus 
  the .side-bar-open class for toggling 
*/
.side-bar {
  width: 300px;
  background: #ffffff;
  border-right: 1px solid #ddd;
  height: 100%;
  overflow-y: auto;
  transition: transform 0.3s ease, width 0.3s ease;
}

/* The inner container for your components */
.sidebar-inner {
  padding: 10px;
}

/* 
  For mobile: position absolute, 
  transform to hide it if !isOpen
*/
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

/* 
  For desktop: 
  either transform(0) or set width=0 if not open 
*/
@media screen and (min-width: 769px) {
  .side-bar {
    transform: translateX(0);
    width: 250px; /* or 300px, if you prefer */
  }
  .side-bar:not(.side-bar-open) {
    width: 0;
    padding: 0;
    overflow: hidden;
  }
}
</style>

