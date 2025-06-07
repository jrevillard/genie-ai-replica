<!-- App.vue - FIXED to ensure proper theme handling for configured styling -->
<template>
  <div id="app" :class="{ 'sidebar-collapsed': !isSidebarOpen }" :data-theme="theme">
    <!-- Always show public routes without authentication requirement -->
    <router-view v-if="$route.meta.requiresAuth === false" :theme="theme" />

    <!-- Only show main app when authenticated and route requires auth -->
    <template v-else-if="isAuthenticated">
      <!-- Top navigation bar -->
      <nav-bar-component :is-sidebar-open="isSidebarOpen" @toggleSidebar="toggleSidebar"
        @openAnalytics="showAnalytics = true" @openProfile="showUserProfile = true" @openSettings="showSettings = true"
        @logout="handleLogout" @open-admin="showAdminDashboard = true" :config="$config" />

      <div class="main-container">
        <!-- Sidebar (collapsible) -->
        <side-bar-component :is-open="isSidebarOpen" />

        <!-- Main content area with router view -->
        <main class="content-area">
          <router-view />
        </main>
      </div>

      <!-- Modal Dialogs -->
      <unified-analytics-component v-if="showAnalytics" @close="showAnalytics = false" />

      <user-profile-component v-if="showUserProfile" @cancel="showUserProfile = false" @save="handleProfileSave" />

      <settings-component v-if="showSettings" @close="showSettings = false" @themeChanged="handleThemeChange" />
    </template>

    <!-- Show login screen if not authenticated and route requires auth -->
    <login-screen v-else @login-success="handleLoginSuccess" :theme="theme" />

    <!-- Global notification component -->
    <div v-if="notification.visible" class="notification" :class="notification.type" @click="hideNotification">
      {{ notification.message }}
    </div>
  </div>
  <AdminDashboard v-if="showAdminDashboard" @close="showAdminDashboard = false" />
</template>

<script>
import NavBarComponent from './components/NavBarComponent.vue'
import SideBarComponent from './components/SideBarComponent.vue'
import UnifiedAnalyticsComponent from './components/UnifiedAnalytics.vue'
import UserProfileComponent from './components/UserProfileComponent.vue'
import SettingsComponent from './components/SettingsComponent.vue'
import LoginScreen from './components/LoginScreen.vue'
import AdminDashboard from './components/AdminDashboard.vue'
import { mapGetters } from 'vuex'
import { eventBus } from './eventBus.js'

export default {
  name: 'App',
  components: {
    NavBarComponent,
    SideBarComponent,
    UnifiedAnalyticsComponent,
    UserProfileComponent,
    SettingsComponent,
    LoginScreen,
    AdminDashboard
  },

  data() {
    return {
      isSidebarOpen: true,
      showAnalytics: false,
      showUserProfile: false,
      showSettings: false,
      showAdminDashboard: false,
      theme: 'light', // Default to light theme, will be synced with main.js
      notification: {
        visible: false,
        message: '',
        type: 'success',
        timer: null
      }
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

    // Initialize font size from settings
    this.initFontSize()

    // Adjust sidebar for mobile devices
    this.checkScreenSize()
    window.addEventListener('resize', this.checkScreenSize)

    // Add listener for system theme changes if using system theme
    this.setupSystemThemeListener()

    // Set up notification event listener
    eventBus.$on('notification:show', this.showNotification)
  },
  beforeUnmount() {
    window.removeEventListener('resize', this.checkScreenSize)
    
    // Remove system theme listener if it exists
    if (this.systemThemeListener) {
      window.matchMedia('(prefers-color-scheme: dark)').removeEventListener('change', this.systemThemeListener)
    }

    // Clean up notification event listener
    eventBus.$off('notification:show', this.showNotification)
  },
  methods: {
    // Notification methods
    showNotification(payload) {
      // Clear any existing timer
      if (this.notification.timer) {
        clearTimeout(this.notification.timer)
      }

      // Show the notification
      this.notification = {
        visible: true,
        message: payload.message,
        type: payload.type || 'success',
        timer: null
      }

      // Set timer to auto-hide
      this.notification.timer = setTimeout(() => {
        this.hideNotification()
      }, payload.duration || 3000)
    },

    hideNotification() {
      this.notification.visible = false
      if (this.notification.timer) {
        clearTimeout(this.notification.timer)
        this.notification.timer = null
      }
    },

    // Initialize theme by syncing with main.js
    initTheme() {
      // Theme is now initialized in main.js, so we sync with the current theme
      const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
      this.theme = currentTheme;
      console.log('App component synchronized theme to:', this.theme);
    },

    // Initialize font size from settings
    initFontSize() {
      try {
        const fontSize = localStorage.getItem('fontSize')
        if (fontSize) {
          // Apply font size to root element (base is 16px at 50%)
          document.documentElement.style.fontSize = `${parseInt(fontSize) / 50}rem`
        }
      } catch (e) {
        console.warn('Unable to get font size preference:', e)
      }
    },

    // Setup listener for system theme changes
    setupSystemThemeListener() {
      // Only attach listener if the theme is 'system'
      if (this.theme === 'system' && window.matchMedia) {
        this.systemThemeListener = (e) => {
          // Update UI immediately when system preference changes
          document.documentElement.setAttribute('data-theme', 'system')
          document.body.setAttribute('data-theme', 'system')
          console.log('System theme changed')
        }
        
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', this.systemThemeListener)
      }
    },

    // Handle theme changes from settings
    handleThemeChange(newTheme) {
      console.log('Theme changed to:', newTheme)
      this.theme = newTheme
      
      // Apply theme to both document elements for consistent cascading
      document.documentElement.setAttribute('data-theme', newTheme)
      document.body.setAttribute('data-theme', newTheme)
      
      try {
        localStorage.setItem('theme', newTheme)
      } catch (e) {
        console.warn('Unable to save theme preference:', e)
      }
      
      // Update system theme listener status
      if (newTheme === 'system') {
        this.setupSystemThemeListener()
      } else if (this.systemThemeListener) {
        // Remove listener if not using system theme
        window.matchMedia('(prefers-color-scheme: dark)').removeEventListener('change', this.systemThemeListener)
        this.systemThemeListener = null
      }
    },

    handleLoginSuccess(userData) {
      // Handle successful login
      console.log('Login successful for:', userData.name)

      // Ensure theme is applied after login
      document.documentElement.setAttribute('data-theme', this.theme)
      document.body.setAttribute('data-theme', this.theme)
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
    },
    
    openAdminDashboard() {
      this.showAdminDashboard = true;
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
  color: var(--text-primary, #333);
  background-color: var(--bg-primary, #f5f7fa);
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
  background-color: var(--bg-primary, #f5f7fa);
}

/* Notification styles */
.notification {
  position: fixed;
  top: 0;
  left: 0; /* Start from left edge */
  right: 0; /* Stretch to right edge */
  width: 100%; /* Full width */
  padding: 16px 20px;
  color: white;
  font-weight: 500;
  line-height: 1.8; /* Increased line height */
  z-index: 1000;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  animation: notification-fadeIn 0.3s ease;
  cursor: pointer;
  text-align: center; /* Center the text */
  border-bottom-left-radius: 6px;
  border-bottom-right-radius: 6px;
}

.notification.success {
  background-color: #10b981;
}

.notification.error {
  background-color: #ef4444;
}

.notification.info {
  background-color: #3b82f6; 
}

.notification.warning {
  background-color: #f59e0b;
}

@keyframes notification-fadeIn {
  from { opacity: 0; transform: translateY(-100%); }
  to { opacity: 1; transform: translateY(0); }
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
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s;
}

.fade-enter,
.fade-leave-to {
  opacity: 0;
}
</style>