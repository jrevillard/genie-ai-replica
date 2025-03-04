<!-- src/views/DashboardView.vue -->
<template>
  <div class="dashboard-layout">
    <nav-bar-component @toggleSidebar="toggleSidebar" />

    <div class="main-section">
      <side-bar-component :isOpen="sidebarOpen" />
      <chat-bot-component />
    </div>
  </div>
</template>

<script>
import NavBarComponent from '@/components/NavBarComponent.vue'
import SideBarComponent from '@/components/SideBarComponent.vue'
import ChatBotComponent from '@/components/ChatBotComponent.vue'

export default {
  name: 'DashboardView',
  components: {
    NavBarComponent,
    SideBarComponent,
    ChatBotComponent
  },
  data() {
    return {
      sidebarOpen: true
    }
  },
  methods: {
    toggleSidebar() {
      this.sidebarOpen = !this.sidebarOpen
    }
  }
}
</script>

<style scoped>
.dashboard-layout {
  display: flex;
  flex-direction: column;
  height: 100vh; 
  overflow: hidden;
}

.main-section {
  display: flex;
  flex: 1;
  overflow: hidden;
}
</style>

