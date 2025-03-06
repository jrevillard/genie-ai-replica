<!-- App.vue -->
<template>
  <div id="app" :class="{ 'sidebar-collapsed': !isSidebarOpen }">
    <!-- Top navigation bar -->
    <nav-bar-component
      :is-sidebar-open="isSidebarOpen"
      @toggleSidebar="toggleSidebar"
      @openAnalytics="showAnalytics = true"
      @openProfile="showUserProfile = true"
      @openSettings="showSettings = true"
    />

    <div class="main-container">
      <!-- Sidebar (collapsible) -->
      <side-bar-component :is-open="isSidebarOpen" />

      <!-- Main content area with router view -->
      <main class="content-area">
        <router-view />
      </main>
    </div>

    <!-- Modal Dialogs -->
    <analytics-component 
      v-if="showAnalytics" 
      @close="showAnalytics = false" 
    />
    
    <user-profile-component 
      v-if="showUserProfile"
      @cancel="showUserProfile = false"
      @save="handleProfileSave"
    />
    
    <settings-component
      v-if="showSettings"
      @close="showSettings = false"
    />
  </div>
</template>

<script>
import NavBarComponent from './components/NavBarComponent.vue'
import SideBarComponent from './components/SideBarComponent.vue'
import AnalyticsComponent from './components/AnalyticsComponent.vue'
import UserProfileComponent from './components/UserProfileComponent.vue'
import SettingsComponent from './components/SettingsComponent.vue'

export default {
  name: 'App',
  components: {
    NavBarComponent,
    SideBarComponent,
    AnalyticsComponent,
    UserProfileComponent,
    SettingsComponent
  },
  data() {
    return {
      isSidebarOpen: true,
      showAnalytics: false,
      showUserProfile: false,
      showSettings: false
    }
  },
  mounted() {
    // Check if sidebar state is saved in localStorage
    const savedSidebarState = localStorage.getItem('sidebarOpen')
    if (savedSidebarState !== null) {
      this.isSidebarOpen = savedSidebarState === 'true'
    }
    
    // Adjust sidebar for mobile devices
    this.checkScreenSize()
    window.addEventListener('resize', this.checkScreenSize)
  },
  beforeDestroy() {
    window.removeEventListener('resize', this.checkScreenSize)
  },
  methods: {
    toggleSidebar() {
      this.isSidebarOpen = !this.isSidebarOpen
      
      // Save preference to localStorage
      try {
        localStorage.setItem('sidebarOpen', this.isSidebarOpen.toString())
      } catch (e) {
        console.warn('Unable to save sidebar state:', e)
      }
    },
    checkScreenSize() {
      // Auto-collapse sidebar on mobile
      if (window.innerWidth < 768 && this.isSidebarOpen) {
        this.isSidebarOpen = false
      }
    },
    handleProfileSave(profileData) {
      // Process profile data after save
      console.log('Profile saved:', profileData)
      this.showUserProfile = false
      alert(this.$t('userProfile.saveSuccess') || 'Profile saved successfully')
    }
  }
}
</script>

<style>
/* Global styling */
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen,
    Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
  line-height: 1.6;
  color: #333;
  background-color: #f5f7fa;
}

/* App layout */
#app {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

.main-container {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.content-area {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  transition: margin-left 0.3s ease;
}

/* Responsive adjustments */
@media screen and (min-width: 769px) {
  #app.sidebar-collapsed .content-area {
    margin-left: 0;
  }
}

@media screen and (max-width: 768px) {
  .content-area {
    margin-left: 0 !important;
  }
}

/* Animation transitions */
.fade-enter-active, .fade-leave-active {
  transition: opacity 0.3s;
}
.fade-enter, .fade-leave-to {
  opacity: 0;
}

/* Dark theme support */
[data-theme="dark"] {
  --bg-color: #1e1e1e;
  --text-color: #f0f0f0;
  --border-color: #444;
  --primary-color: #5fa9e0;
  --card-bg: #2a2a2a;
}

[data-theme="light"] {
  --bg-color: #f5f7fa;
  --text-color: #333;
  --border-color: #ddd;
  --primary-color: #4E97D1;
  --card-bg: #fff;
}

/* Apply theme variables */
body {
  background-color: var(--bg-color, #f5f7fa);
  color: var(--text-color, #333);
}
</style>
