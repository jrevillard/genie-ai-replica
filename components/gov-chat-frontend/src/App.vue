// src/App.vue
<template>
  <div
    id="app"
    :class="{ 'sidebar-collapsed': !isSidebarOpen }"
    :data-theme="theme"
  >
    <!-- Fallback loading state -->
    <div v-if="isLoading" class="loading-screen">
      Loading...
    </div>

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
        @toggleSidebar="toggleSidebar"
        @openAnalytics="showAnalytics = true"
        @openProfile="showProfileDialog = true"
        @openSettings="showSettings = true"
        @logout="handleLogout"
        @open-admin="showAdminDashboard = true"
        @go-home="handleGoHome"
        :config="$config"
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
      <!-- M1.5/CAP-3: one tabbed profile dialog (Account + Farm). The tab
           bar floats ABOVE the child modals — both are fixed z-9999
           overlays, so a wrapping modal's chrome would end up underneath
           them. Farm pane is v-if-lazy: FarmerProfileComponent (Leaflet)
           mounts only when its tab is first opened, never in a hidden
           container (the M.2 grey-map trap). -->
      <div v-if="showProfileDialog" class="profile-dialog-tabs" role="tablist" aria-label="Profile">
        <button
          class="profile-tab"
          role="tab"
          :aria-selected="activeProfileTab === 'account'"
          :class="{ active: activeProfileTab === 'account' }"
          @click="activeProfileTab = 'account'"
        >
          {{ $t("nav.profileAccount", "Account") }}
        </button>
        <button
          class="profile-tab"
          role="tab"
          :aria-selected="activeProfileTab === 'farm'"
          :class="{ active: activeProfileTab === 'farm' }"
          @click="activeProfileTab = 'farm'"
        >
          {{ $t("nav.profileFarm", "Farm") }}
        </button>
      </div>
      <user-profile-component
        v-if="showProfileDialog && activeProfileTab === 'account'"
        @cancel="closeProfileDialog"
      />
      <farmer-profile-component
        v-if="showProfileDialog && activeProfileTab === 'farm'"
        @close="closeProfileDialog"
      />
      <settings-component
        v-if="showSettings"
        @close="showSettings = false"
        @themeChanged="handleThemeChange"
      />
      <AdminDashboard
        v-if="showAdminDashboard"
        @close="showAdminDashboard = false"
      />
    </template>

    <!-- Global notification component -->
    <div
      v-if="notification.visible"
      class="notification"
      :class="notification.type"
      @click="hideNotification"
    >
      {{ notification.message }}
    </div>

  </div>
</template>

<script>
import NavBarComponent from "./components/NavBarComponent.vue";
import SideBarComponent from "./components/SideBarComponent.vue";
import UnifiedAnalyticsComponent from "./components/UnifiedAnalytics.vue";
import UserProfileComponent from "./components/UserProfileComponent.vue";
import FarmerProfileComponent from "./components/FarmerProfileComponent.vue";
import SettingsComponent from "./components/SettingsComponent.vue";
import AdminDashboard from "./components/AdminDashboard.vue";
import { mapGetters } from "vuex";
import { eventBus } from "./eventBus.js";
import chatHistoryService from "./services/chatHistoryService";

export default {
  name: "App",
  components: {
    NavBarComponent,
    SideBarComponent,
    UnifiedAnalyticsComponent,
    UserProfileComponent,
    FarmerProfileComponent,
    SettingsComponent,
    AdminDashboard,
  },

  data() {
    return {
      isSidebarOpen: true,
      showAnalytics: false,
      // M1.5/CAP-3: merged profile dialog — one button, two tabs
      showProfileDialog: false,
      activeProfileTab: "account",
      showSettings: false,
      showAdminDashboard: false,
      theme: "light",
      notification: {
        visible: false,
        message: "",
        type: "success",
        timer: null,
      },
      isLoading: true,
    };
  },
  computed: {
    // --- ADDED THIS GETTER ---
    ...mapGetters(["isAuthenticated", "currentUser", "isRegularUser"]),
  },
  watch: {
    isAuthenticated(newVal) {
      if (newVal) {
        console.log("isAuthenticated changed to true, loading folders");
        // M.1/CAP-5: sidebar collapsed by default for regular users. Runs
        // here, NOT in data(): App mounts before the router guard finishes
        // auth init (main.js mounts immediately, no router.isReady), so the
        // role isn't known until this watcher fires — pre-render, before
        // the authenticated block first paints. Saved preferences win over
        // the role default; elevated users get today's default (open).
        if (localStorage.getItem("sidebarOpen") === null) {
          this.isSidebarOpen = !this.isRegularUser;
        }
        this.loadFoldersOnAuth();
      }
    },
  },
  // --- REPLACED YOUR MOUNTED HOOK WITH THIS ---
  async mounted() {
    console.log("App.vue mounted");

    // Auth initialization is owned by the router guard (store 'initialize'
    // dispatch) — App.vue no longer double-boots it. If the session was
    // already rehydrated before mount, load folders directly; otherwise the
    // isAuthenticated watcher below fires when the guard completes.
    try {
      if (this.isAuthenticated) {
        console.log("User is authenticated, now loading folders...");
        await this.loadFoldersOnAuth();
        console.log("Folders loaded.");
      }

      // Only set loading to false AFTER all essential data is ready
      this.isLoading = false;

    } catch (error) {
      console.error("Critical loadFolders failed:", error);
      this.isLoading = false; // Still stop loading on error
      this.showNotification({
        message: "Failed to initialize application",
        type: "error",
        duration: 5000,
      });
    }

    // The rest of your original mounted hook
    const savedSidebarState = localStorage.getItem("sidebarOpen");
    if (savedSidebarState !== null) {
      this.isSidebarOpen = savedSidebarState === "true";
    }

    this.initTheme();
    this.initFontSize();
    this.checkScreenSize();
    window.addEventListener("resize", this.checkScreenSize);
    this.setupSystemThemeListener();
    eventBus.$on("notification:show", this.showNotification);
  },
  beforeUnmount() {
    window.removeEventListener("resize", this.checkScreenSize);
    if (this.systemThemeListener) {
      window
        .matchMedia("(prefers-color-scheme: dark)")
        .removeEventListener("change", this.systemThemeListener);
    }
    eventBus.$off("notification:show", this.showNotification);
  },
  methods: {
    showNotification(payload) {
      if (this.notification.timer) {
        clearTimeout(this.notification.timer);
      }
      this.notification = {
        visible: true,
        message: payload.message,
        type: payload.type || "success",
        timer: null,
      };
      console.log("Showing notification:", payload);
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
      console.log("Notification hidden");
    },

    initTheme() {
      const currentTheme =
        document.documentElement.getAttribute("data-theme") || "light";
      this.theme = currentTheme;
      console.log("App component synchronized theme to:", this.theme);
    },

    initFontSize() {
      try {
        const fontSize = localStorage.getItem("fontSize");
        if (fontSize) {
          document.documentElement.style.fontSize = `${
            parseInt(fontSize) / 50
          }rem`;
        }
      } catch (e) {
        console.warn("Unable to get font size preference:", e);
      }
    },

    setupSystemThemeListener() {
      if (this.theme === "system" && window.matchMedia) {
        this.systemThemeListener = (e) => {
          document.documentElement.setAttribute("data-theme", "system");
          document.body.setAttribute("data-theme", "system");
          console.log("System theme changed");
        };
        window
          .matchMedia("(prefers-color-scheme: dark)")
          .addEventListener("change", this.systemThemeListener);
      }
    },

    handleThemeChange(newTheme) {
      console.log("Theme changed to:", newTheme);
      this.theme = newTheme;
      document.documentElement.setAttribute("data-theme", newTheme);
      document.body.setAttribute("data-theme", newTheme);
      try {
        localStorage.setItem("theme", newTheme);
      } catch (e) {
        console.warn("Unable to save theme preference:", e);
      }
      if (newTheme === "system") {
        this.setupSystemThemeListener();
      } else if (this.systemThemeListener) {
        window
          .matchMedia("(prefers-color-scheme: dark)")
          .removeEventListener("change", this.systemThemeListener);
        this.systemThemeListener = null;
      }
    },

    // --- REPLACED YOUR loadFoldersOnAuth METHOD WITH THIS ---
    async loadFoldersOnAuth() {
      try {
        // This will now correctly get the user from Vuex
        const user = this.currentUser; 
        console.log("loadFoldersOnAuth: Current user from store:", user);

        const userId = user?._key || user?.id;
        if (!userId) {
          // This should no longer happen because of the mounted hook's await
          console.warn("loadFoldersOnAuth called, but user not ready.");
          return; 
        }

        const response = await chatHistoryService.getUserFolders(userId);
        console.log("loadFoldersOnAuth: getUserFolders response:", response);
        let foldersArray = Array.isArray(response)
          ? response
          : response?.folders || [];
        const processedFolders = foldersArray
          .filter((folder) => folder && (folder._key || folder.id))
          .map((folder) => ({
            id: folder._key || folder.id,
            name: folder.name || "Unnamed Folder",
            description: folder.description || "",
            isDefault: folder.isDefault || false,
            createdAt: folder.createdAt || new Date().toISOString(),
          }));
        const defaultFolder = {
          id: "default",
          name: "All Chats",
          isDefault: true,
          createdAt: new Date().toISOString(),
        };
        const allFolders = [defaultFolder, ...processedFolders];
        await this.$store.dispatch("chatHistory/setFolders", allFolders);
        console.log(
          "loadFoldersOnAuth: Dispatched setFolders with:",
          allFolders
        );
        const vuexFolders = this.$store.getters["chatHistory/getAllFolders"];
        console.log(
          "loadFoldersOnAuth: Vuex folders after dispatch:",
          vuexFolders
        );
      } catch (error) {
        console.error("loadFoldersOnAuth: Error loading folders:", error);
        const defaultFolder = {
          id: "default",
          name: "All Chats",
          isDefault: true,
          createdAt: new Date().toISOString(),
        };
        await this.$store.dispatch("chatHistory/setFolders", [defaultFolder]);
        console.log(
          "loadFoldersOnAuth: Fallback to default folder:",
          defaultFolder
        );
        this.showNotification({
          message: "Failed to load folders. Using default folder.",
          type: "error",
          duration: 5000,
        });
      }
    },

    async handleLogout() {
      try {
        await this.$store.dispatch("logout");
        await this.$store.dispatch("chatHistory/clearFolders");
        console.log("handleLogout: Folders cleared from Vuex store");
        try {
          localStorage.removeItem("chatHistory");
          console.log("handleLogout: Cleared chatHistory from localStorage");
        } catch (e) {
          console.error(
            "handleLogout: Error clearing chatHistory from localStorage:",
            e
          );
        }
      } catch (error) {
        console.error("handleLogout: Error during logout:", error);
        try {
          localStorage.removeItem("chatHistory");
          console.log(
            "handleLogout: Cleared chatHistory from localStorage on error"
          );
        } catch (e) {
          console.error(
            "handleLogout: Error clearing chatHistory from localStorage:",
            e
          );
        }
      }
    },

    // M1.5/CAP-3: close + reset so every open lands on the Account tab
    closeProfileDialog() {
      this.showProfileDialog = false;
      this.activeProfileTab = "account";
    },

    toggleSidebar() {
      this.isSidebarOpen = !this.isSidebarOpen;
      try {
        localStorage.setItem("sidebarOpen", this.isSidebarOpen.toString());
      } catch (e) {
        console.warn("Unable to save sidebar state:", e);
      }
    },

    checkScreenSize() {
      if (window.innerWidth < 768 && this.isSidebarOpen) {
        this.isSidebarOpen = false;
      }
    },

    openAdminDashboard() {
      this.showAdminDashboard = true;
    },

    handleGoHome() {
      // Close any open modals
      this.showAnalytics = false;
      this.closeProfileDialog();
      this.showSettings = false;
      this.showAdminDashboard = false;
      // Navigate to dashboard if not already there
      if (this.$route.path !== '/dashboard') {
        this.$router.push('/dashboard');
      }
      // Emit event for ChatBotComponent to reset to initial state
      eventBus.$emit('go-home');
    },
  },
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
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen,
    Ubuntu, Cantarell, "Open Sans", "Helvetica Neue", sans-serif;
  line-height: 1.6;
  color: var(--text-primary, #333);
  background-color: var(--bg-primary, #f5f7fa);
}

/* App layout */
#app {
  display: flex;
  flex-direction: column;
  height: 100vh; /* fallback */
  height: 100dvh; /* M.12: dynamic viewport — tracks toolbars; keyboard
                     handled by the keyboard-open → --window-height rule */
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

/* Loading screen */
.loading-screen {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100vh;
  background-color: var(--bg-primary, #f5f7fa);
  color: var(--text-primary, #333);
  font-size: 1.5rem;
}

/* M1.5/CAP-3: floating tab bar for the merged profile dialog — must sit
   above the child modals' fixed z-9999 layer */
.profile-dialog-tabs {
  position: fixed;
  top: 24px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  gap: 4px;
  z-index: 10000;
  background: var(--bg-dialog, #ffffff);
  border: 1px solid var(--border-color, #ddd);
  border-radius: 8px;
  padding: 4px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
}

.profile-tab {
  padding: 6px 18px;
  border: none;
  background: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.9rem;
  color: var(--text-primary, #333);
  transition: background-color 0.2s, color 0.2s;
}

.profile-tab.active {
  background: var(--bg-button-primary, #2a9d8f);
  color: var(--text-button-primary, #ffffff);
  font-weight: 500;
}

/* Notification styles (fallback for eventBus-based notifications) */
.notification {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  width: 100%;
  padding: 16px 20px;
  color: white;
  font-weight: 500;
  line-height: 1.8;
  z-index: 9000; /* Lower than NotificationSystem.vue and SplashScreen.vue */
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  animation: notification-fadeIn 0.3s ease;
  cursor: pointer;
  text-align: center;
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
