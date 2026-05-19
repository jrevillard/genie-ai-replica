// src/App.vue
<template>
  <div id="app" :class="{ 'sidebar-collapsed': !isSidebarOpen }" :data-theme="theme">
    <!-- Fallback loading state -->
    <div v-if="isLoading" class="loading-screen">Loading...</div>

    <!-- Public routes (no auth required) -->
    <router-view v-else-if="!isLoading && $route.meta.requiresAuth === false" :theme="theme" />

    <!-- 
      --- THIS IS THE FIX ---
      Authenticated app content
      Added "&& currentUser" to the v-else-if.
      This guarantees no child component will render until the user object is fully loaded.
    -->
    <template v-else-if="!isLoading && isAuthenticated && currentUser">
      <!-- Top navigation bar -->
      <nav-bar-component
        :is-sidebar-open="isSidebarOpen"
        :config="$config"
        @toggle-sidebar="toggleSidebar"
        @logout="handleLogout"
      />

      <div class="main-container">
        <!-- Sidebar (collapsible, only on routes with showSidebar meta) -->
        <side-bar-component v-if="showSidebar" :is-open="isSidebarOpen" />

        <!-- Main content area with router view -->
        <main class="content-area">
          <router-view />
        </main>
      </div>
    </template>

    <!-- Global notification component -->
    <div v-if="notification.visible" class="notification" :class="notification.type" @click="hideNotification">
      {{ notification.message }}
    </div>

    <!-- Splash screen (controlled via auth state) -->
    <splash-screen v-if="showSplash" @splash-complete="showSplash = false" />
  </div>
</template>

<script>
import NavBarComponent from './components/NavBarComponent.vue';
import SideBarComponent from './components/SideBarComponent.vue';
import SplashScreen from './components/SplashScreen.vue';
import { mapGetters } from 'vuex';
import { eventBus } from './eventBus.js';
import chatHistoryService from './services/chatHistoryService';
import { getUserId } from './utils/userUtils';
import { themeManager } from './utils/ThemeManager';

export default {
  name: 'App',
  components: {
    NavBarComponent,
    SideBarComponent,
    SplashScreen
  },

  data() {
    return {
      isSidebarOpen: true,
      theme: 'light',
      notification: {
        visible: false,
        message: '',
        type: 'success',
        timer: null
      },
      showSplash: false,
      isLoading: true
    };
  },
  computed: {
    ...mapGetters(['isAuthenticated', 'currentUser']),
    showSidebar() {
      return this.$route.meta.showSidebar !== false;
    }
  },
  watch: {
    isAuthenticated(newVal) {
      if (newVal) {
        this.loadFoldersOnAuth();
        // Show splash screen only once per session
        if (!sessionStorage.getItem('splashShown')) {
          sessionStorage.setItem('splashShown', 'true');
          setTimeout(() => {
            this.showSplash = true;
            setTimeout(() => {
              this.showSplash = false;
            }, 3000);
          }, 100);
        }
      }
    }
  },
  // --- REPLACED YOUR MOUNTED HOOK WITH THIS ---
  async mounted() {
    try {
      // Wait for the auth state to be determined (OIDC initialization)
      await this.$store.dispatch('initialize');

      // If authenticated, ALSO wait for critical data to load
      // This "await" is critical
      if (this.isAuthenticated) {
        await this.loadFoldersOnAuth();
      }

      // Only set loading to false AFTER all essential data is ready
      this.isLoading = false;
    } catch (error) {
      console.error('Critical initAuth or loadFolders failed:', error);
      this.isLoading = false; // Still stop loading on error
      this.showNotification({
        message: 'Failed to initialize application',
        type: 'error',
        duration: 5000
      });
    }

    // The rest of your original mounted hook
    const savedSidebarState = localStorage.getItem('sidebarOpen');
    if (savedSidebarState !== null) {
      this.isSidebarOpen = savedSidebarState === 'true';
    }

    this.initTheme();
    this.initFontSize();
    this.checkScreenSize();
    window.addEventListener('resize', this.checkScreenSize);
    this.setupSystemThemeListener();
    window.addEventListener('themeChange', this.handleThemeChange);
    eventBus.$on('notification:show', this.showNotification);
  },
  beforeUnmount() {
    window.removeEventListener('resize', this.checkScreenSize);
    window.removeEventListener('themeChange', this.handleThemeChange);
    if (this.systemThemeListener) {
      window.matchMedia('(prefers-color-scheme: dark)').removeEventListener('change', this.systemThemeListener);
    }
    eventBus.$off('notification:show', this.showNotification);
  },
  methods: {
    showNotification(payload) {
      if (this.notification.timer) {
        clearTimeout(this.notification.timer);
      }
      this.notification = {
        visible: true,
        message: payload.message,
        type: payload.type || 'success',
        timer: null
      };
      this.notification.timer = setTimeout(() => {
        this.hideNotification();
      }, payload.duration || 3000);
    },
    hideNotification() {
      this.notification.visible = false;
      if (this.notification.timer) {
        clearTimeout(this.notification.timer);
        this.notification.timer = null;
      }
    },

    initTheme() {
      const savedTheme = localStorage.getItem('theme');
      if (savedTheme === 'dark' || savedTheme === 'light' || savedTheme === 'system') {
        this.theme = savedTheme;
      } else {
        this.theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      }
      // Sync ThemeManager state with the resolved theme
      // (ThemeManager.setTheme handles DOM attributes + dispatches themeChange)
      themeManager.setTheme(this.theme);
    },

    initFontSize() {
      try {
        const fontSize = localStorage.getItem('fontSize');
        if (fontSize) {
          document.documentElement.style.fontSize = `${parseInt(fontSize) / 50}rem`;
        }
      } catch {
        // Silently fail - font size is optional
      }
    },

    setupSystemThemeListener() {
      if (this.theme === 'system' && window.matchMedia) {
        this.systemThemeListener = (e) => {
          // Let ThemeManager handle the actual theme resolution and DOM update
          const resolved = e.matches ? 'dark' : 'light';
          this.theme = resolved;
          themeManager.setTheme('system');
        };
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', this.systemThemeListener);
      }
    },

    handleThemeChange(event) {
      const newTheme = event?.detail?.theme ?? event;
      if (this._isApplyingTheme) return;
      this._isApplyingTheme = true;
      this.theme = newTheme;
      try {
        localStorage.setItem('theme', newTheme);
      } catch {
        // Silently fail - theme preference is optional
      }
      themeManager.setTheme(newTheme);
      if (newTheme === 'system') {
        this.setupSystemThemeListener();
      } else if (this.systemThemeListener) {
        window.matchMedia('(prefers-color-scheme: dark)').removeEventListener('change', this.systemThemeListener);
        this.systemThemeListener = null;
      }
      this._isApplyingTheme = false;
    },

    // --- REPLACED YOUR loadFoldersOnAuth METHOD WITH THIS ---
    async loadFoldersOnAuth() {
      try {
        const user = this.currentUser;
        const userId = getUserId(user);
        if (!userId) {
          return;
        }

        const response = await chatHistoryService.getUserFolders();
        const foldersArray = Array.isArray(response) ? response : response?.folders || [];
        const processedFolders = foldersArray
          .filter((folder) => folder && (folder._key || folder.id))
          .map((folder) => ({
            id: folder._key || folder.id,
            name: folder.name || 'Unnamed Folder',
            description: folder.description || '',
            isDefault: folder.isDefault || false,
            createdAt: folder.createdAt || new Date().toISOString()
          }));
        const defaultFolder = {
          id: 'default',
          name: 'All Chats',
          isDefault: true,
          createdAt: new Date().toISOString()
        };
        const allFolders = [defaultFolder, ...processedFolders];
        await this.$store.dispatch('chatHistory/setFolders', allFolders);
      } catch (error) {
        console.error('loadFoldersOnAuth: Error loading folders:', error);
        const defaultFolder = {
          id: 'default',
          name: 'All Chats',
          isDefault: true,
          createdAt: new Date().toISOString()
        };
        await this.$store.dispatch('chatHistory/setFolders', [defaultFolder]);
        this.showNotification({
          message: 'Failed to load folders. Using default folder.',
          type: 'error',
          duration: 5000
        });
      }
    },

    async handleLogout() {
      try {
        await this.$store.dispatch('logout');
        await this.$store.dispatch('chatHistory/clearFolders');
        localStorage.removeItem('chatHistory');
      } catch (error) {
        console.error('handleLogout: Error during logout:', error);
        localStorage.removeItem('chatHistory');
      } finally {
        window.location.href = '/';
      }
    },

    toggleSidebar() {
      this.isSidebarOpen = !this.isSidebarOpen;
      try {
        localStorage.setItem('sidebarOpen', this.isSidebarOpen.toString());
      } catch {
        // Silently fail - sidebar state is optional
      }
    },

    checkScreenSize() {
      if (window.innerWidth < 768 && this.isSidebarOpen) {
        this.isSidebarOpen = false;
      }
    }
  }
};
</script>

<style>
/* Global styling */
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: var(--font-body);
  line-height: 1.6;
  color: var(--fg);
  background-color: var(--bg);
  overflow: hidden;
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
  gap: var(--space-sm);
}

.content-area {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-sm) var(--space-sm) var(--space-sm) 0;
  transition: margin-left 0.3s ease;
  background-color: var(--bg);
}

/* Loading screen */
.loading-screen {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100vh;
  background-color: var(--bg);
  color: var(--fg);
  font-size: var(--text-xl);
}

/* Notification styles (fallback for eventBus-based notifications) */
.notification {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  width: 100%;
  padding: var(--space-md) var(--space-lg);
  color: var(--accent-fg);
  font-weight: 500;
  line-height: 1.8;
  z-index: 9000; /* Lower than NotificationSystem.vue and SplashScreen.vue */
  box-shadow: var(--shadow-md);
  animation: notification-fadeIn 0.3s ease;
  cursor: pointer;
  text-align: center;
  border-bottom-left-radius: var(--radius-md);
  border-bottom-right-radius: var(--radius-md);
}

.notification.success {
  background-color: var(--success);
}

.notification.error {
  background-color: var(--danger);
}

.notification.info {
  background-color: var(--info);
}

.notification.warning {
  background-color: var(--warning);
}

@keyframes notification-fadeIn {
  from {
    opacity: 0;
    transform: translateY(-100%);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Responsive adjustments */
@media screen and (min-width: 768px) {
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
