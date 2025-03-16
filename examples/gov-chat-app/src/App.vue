<!-- App.vue -->
<template>
  <div id="app" :class="{ 'sidebar-collapsed': !isSidebarOpen }" :data-theme="theme">
    <!-- Show login screen when not authenticated -->
    <login-screen 
      v-if="!isAuthenticated" 
      @login-success="handleLoginSuccess"
      :theme="theme"
    />
    
    <!-- Only show main app when authenticated -->
    <template v-else>
      <!-- Top navigation bar -->
      <nav-bar-component
        :is-sidebar-open="isSidebarOpen"
        @toggleSidebar="toggleSidebar"
        @openAnalytics="showAnalytics = true"
        @openProfile="showUserProfile = true"
        @openSettings="showSettings = true"
        @logout="handleLogout"
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
      <unified-analytics-component 
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
        @themeChanged="handleThemeChange"
      />
    </template>
  </div>
</template>

<script>
import NavBarComponent from './components/NavBarComponent.vue'
import SideBarComponent from './components/SideBarComponent.vue'
import UnifiedAnalyticsComponent from './components/UnifiedAnalytics.vue'
import UserProfileComponent from './components/UserProfileComponent.vue'
import SettingsComponent from './components/SettingsComponent.vue'
import LoginScreen from './components/LoginScreen.vue'
import { mapGetters } from 'vuex'

export default {
  name: 'App',
  components: {
    NavBarComponent,
    SideBarComponent,
    UnifiedAnalyticsComponent,
    UserProfileComponent,
    SettingsComponent,
    LoginScreen
  },
  data() {
    return {
      isSidebarOpen: true,
      showAnalytics: false,
      showUserProfile: false,
      showSettings: false,
      theme: 'light' // Default to light theme
    }
  },
  computed: {
    ...mapGetters(['isAuthenticated'])
  },
  mounted() {
    // Initialize auth state
    this.$store.dispatch('initAuth')
    
    // Check if sidebar state is saved in localStorage
    const savedSidebarState = localStorage.getItem('sidebarOpen')
    if (savedSidebarState !== null) {
      this.isSidebarOpen = savedSidebarState === 'true'
    }
    
    // Load saved theme preference
    this.initTheme()
    
    // Adjust sidebar for mobile devices
    this.checkScreenSize()
    window.addEventListener('resize', this.checkScreenSize)
  },
  beforeDestroy() {
    window.removeEventListener('resize', this.checkScreenSize)
  },
  methods: {
    // Initialize theme from localStorage or system preference
    initTheme() {
      try {
        // First try to get from localStorage
        const savedTheme = localStorage.getItem('theme')
        if (savedTheme) {
          this.theme = savedTheme
        } else {
          // If no saved preference, check system preference
          if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            this.theme = 'dark'
          } else {
            this.theme = 'light' // Default to light theme
          }
        }
        
        // Apply theme to document
        document.documentElement.setAttribute('data-theme', this.theme)
      } catch (e) {
        console.warn('Unable to get theme preference:', e)
        this.theme = 'light' // Fallback to light theme
        document.documentElement.setAttribute('data-theme', 'light')
      }
    },
    
    // Handle theme changes from settings
    handleThemeChange(newTheme) {
      this.theme = newTheme
      document.documentElement.setAttribute('data-theme', newTheme)
      try {
        localStorage.setItem('theme', newTheme)
      } catch (e) {
        console.warn('Unable to save theme preference:', e)
      }
    },
    
    handleLoginSuccess(userData) {
      // Handle successful login
      console.log('Login successful for:', userData.name)
      
      // Ensure theme is applied after login
      document.documentElement.setAttribute('data-theme', this.theme)
    },
    
    handleLogout() {
      // Handle logout
      this.$store.dispatch('logout')
    },
    
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

/* Direct HTML element theme override for immediate effect */
html[data-theme="dark"] {
  background-color: #1e1e1e;
  color: #f0f0f0;
}

html[data-theme="light"] {
  background-color: #f5f7fa;
  color: #333;
}
</style>