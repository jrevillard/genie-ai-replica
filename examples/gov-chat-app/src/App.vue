<!-- App.vue -->
<template>
  <div id="app">
    <!-- Keep your NavBar, hooking the hamburger event -->
    <NavBarComponent
      @toggleSidebar="toggleSidebar"
      @openAnalytics="openAnalytics"
      @openProfile="openProfile"
    />

    <!-- Layout: sidebar + main content side by side -->
    <div class="content-wrapper">
      <SideBarComponent :isOpen="sidebarOpen" />
      <div class="main-area">
        <!-- If you use router-view or chat -->
        <ChatBotComponent />
      </div>
    </div>

    <!-- Possibly user profile or analytics dialogs here if not in separate components -->
  </div>
</template>

<script>
import NavBarComponent from '@/components/NavBarComponent.vue'
import SideBarComponent from '@/components/SideBarComponent.vue'
import ChatBotComponent from '@/components/ChatBotComponent.vue'

export default {
  name: 'App',
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
    },
    openAnalytics() {
      // existing logic for analytics
    },
    openProfile() {
      // existing logic for user profile
    }
  }
}
</script>

<style scoped>
#app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

.content-wrapper {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.main-area {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}
</style>

