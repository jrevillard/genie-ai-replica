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
      <!-- Top navigation bar. The collapse control has moved to the
           sidebar's own handle (see SidebarHandle.vue), so the navbar
           no longer toggles the sidebar — it shows only the brand and
           the user-facing controls. -->
      <nav-bar-component :config="$config" @logout="handleLogout" />

      <div class="main-container">
        <!-- Sidebar (collapsible + resizable, only on routes with
             showSidebar meta). The handle on the inner edge handles
             both gestures. -->
        <side-bar-component
          v-if="showSidebar"
          :collapsed="isSidebarOpen === false"
          :width="leftSidebarWidth"
          :max-width="leftSidebarMaxWidth"
          :show-handle="showLeftHandle"
          @update:collapsed="onLeftCollapsedChange"
          @update:width="onLeftWidthChange"
        />

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
    <splash-screen v-if="showSplash" :splash-path="splashImagePath" @splash-complete="showSplash = false" />
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
import {
  SIDEBAR_MIN_WIDTHS,
  SIDEBAR_INFLOW_MIN_WIDTH,
  clampWidth,
  computeMaxFor,
  persistWidth,
  persistOpen,
  readStoredWidth,
  readStoredOpen
} from './composables/sidebarLayout.js';

export default {
  name: 'App',
  components: {
    NavBarComponent,
    SideBarComponent,
    SplashScreen
  },

  data() {
    // The left sidebar is App-owned. The right sidebar lives inside
    // ChatBotComponent (under the router-view, so not a descendant of
    // App.vue in a way that makes a shared reactive object reachable).
    // localStorage is the bus between them: one writer per key, and
    // each side reads the other's stored width to compute its own
    // dynamic maximum. See composables/sidebarLayout.js.
    const viewport = typeof window !== 'undefined' ? window.innerWidth : 1920;
    // `sidebarOpen` stores "open", not "collapsed" — read it in its
    // own polarity so an existing value still means what it meant.
    const storedOpen = readStoredOpen('left', true);
    return {
      isSidebarOpen: storedOpen,
      // The clamp runs on the stored value at construction, not only
      // on drag: a width saved at 1920 px must not be applied blind
      // at 1400 px.
      leftSidebarWidth: clampWidth('left', readStoredWidth('left'), readStoredWidth('right'), viewport),
      // The right sidebar's width, mirrored here so `leftSidebarMaxWidth`
      // has a reactive dependency. The right's writer is
      // ChatBotComponent; it signals through the event bus and
      // persists to localStorage.
      rightWidthSnapshot: readStoredWidth('right'),
      viewportWidth: viewport,
      theme: 'light',
      notification: {
        visible: false,
        message: '',
        type: 'success',
        timer: null
      },
      showSplash: false,
      isLoading: true,
      resizeRaf: 0
    };
  },
  computed: {
    ...mapGetters(['isAuthenticated', 'currentUser']),
    showSidebar() {
      return this.$route.meta.showSidebar !== false;
    },
    splashImagePath() {
      // Prefer runtime config (per-deployment splash asset), fall back to bundled default.
      return this.$config?.app?.splash?.value || '/config/splash.png';
    },
    // The dynamic maximum the left handle clamps against. Reading the
    // right's width is what makes the two clamps compose: without it,
    // a left drag could take more than the centre can spare once the
    // right has already reserved its share.
    leftSidebarMaxWidth() {
      return computeMaxFor('left', this.rightWidthSnapshot, this.viewportWidth);
    },
    // The handle only exists where the sidebar is an in-flow
    // reservation. Below the breakpoint both sidebars slide
    // off-canvas and there is nothing to resize against; the
    // collapse gesture there is the mobile overlay's own tap.
    showLeftHandle() {
      return this.viewportWidth >= SIDEBAR_INFLOW_MIN_WIDTH;
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
  // The right sidebar's in-tab signal, subscribed in `created` rather
  // than at the end of `mounted` on purpose. `mounted` here is async and
  // awaits the store's initialisation before it reaches its
  // subscriptions — and a child's `mounted` fires before its parent's,
  // so the right sidebar announced its in-force width into a bus nobody
  // was listening to yet. The announcement was silently dropped and the
  // two sides never converged: the e2e ladder measured the pair settling
  // from their stored values instead, and the centre fell from 664 px to
  // 496 px as the window widened. `created` runs before any child
  // mounts, which is the earliest a subscription can exist.
  created() {
    // The eventBus calls handlers as bare functions (`handler(payload)`), so
    // a method reference arrives with `this` undefined — every `this.x =`
    // inside it throws, and `$emit` swallows the throw into a console
    // error. Passing the bound wrapper is what makes the subscription
    // work at all; the arrow is kept on the instance so `beforeUnmount`
    // can remove exactly what it added.
    this.onRightWidthChanged = (width) => this.refreshRightWidth(width);
    eventBus.$on('sidebar-right-width-changed', this.onRightWidthChanged);
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

    this.initTheme();
    this.initFontSize();
    this.checkScreenSize();
    window.addEventListener('resize', this.handleResize);
    window.addEventListener('storage', this.handleStorage);
    this.setupSystemThemeListener();
    window.addEventListener('themeChange', this.handleThemeChange);
    eventBus.$on('notification:show', this.showNotification);
  },
  beforeUnmount() {
    window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('storage', this.handleStorage);
    window.removeEventListener('themeChange', this.handleThemeChange);
    eventBus.$off('sidebar-right-width-changed', this.onRightWidthChanged);
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

    onLeftCollapsedChange(collapsed) {
      this.isSidebarOpen = !collapsed;
      persistOpen('left', !collapsed);
    },

    onLeftWidthChange(value) {
      // The handle already clamps to [min, max]. This second pass
      // re-derives the bound against the right sidebar's IN-FORCE
      // width, so a value that arrived while the other side moved
      // cannot slip past the centre's usable minimum.
      const clamped = Math.max(SIDEBAR_MIN_WIDTHS.left, Math.min(this.leftSidebarMaxWidth, value));
      this.leftSidebarWidth = clamped;
      persistWidth('left', clamped);
      // The right sidebar lives in a different subtree (inside the
      // router-view), so it cannot read this component's reactive
      // state. The event bus carries the width actually IN FORCE —
      // not the stored one. That distinction is load-bearing: the
      // right clamps against it, and clamping against the stored
      // value over-reserves and is what made the ladder fall as the
      // window widened.
      eventBus.$emit('sidebar-left-width-changed', clamped);
    },

    handleResize() {
      // Coalesced onto a single animation frame: a window-edge drag
      // fires resize dozens of times per second and neither the
      // re-clamp nor the collapse check needs that cadence.
      if (this.resizeRaf) return;
      this.resizeRaf = requestAnimationFrame(() => {
        this.resizeRaf = 0;
        this.viewportWidth = window.innerWidth;
        this.refreshRightWidth(this.rightWidthSnapshot);
        // Re-clamp against the new viewport. This is the viewport half
        // of "the clamp applies on restore, not only on drag": a width
        // the user set at 1920 px is re-bound when they later narrow
        // the window rather than applied blind at a width that no
        // longer leaves the centre its floor.
        //
        // Storage is deliberately NOT rewritten here. The clamp is a
        // rendering bound; the stored width stays the one the user
        // chose, so widening the window back to 1920 px gives them
        // their panel again instead of the clamped-down value. Only a
        // user-driven change (a drag, a keyboard step, a double-click
        // reset) writes storage.
        if (this.isSidebarOpen) this.rebindLeftWidth();
        this.checkScreenSize();
      });
    },

    handleStorage(e) {
      // A `storage` event only fires in *other* tabs, so this is the
      // cross-tab path. The in-tab path is the event bus below, which
      // carries the in-force width directly.
      if (e.key === 'sidebarWidthRight') {
        this.refreshRightWidth(readStoredWidth('right'));
      }
    },
    refreshRightWidth(inForce) {
      // The right sidebar lives in a different subtree, so its width
      // is mirrored here rather than read inside the computed. Picking
      // the new value up here is what re-runs `leftSidebarMaxWidth`.
      // The argument is the width the right is CURRENTLY painting; the
      // fallback covers the paths that carry no payload — the
      // cross-tab `storage` event, and first paint before the right
      // has spoken.
      this.rightWidthSnapshot = typeof inForce === 'number' ? inForce : readStoredWidth('right');
      // Re-clamp this side against what the other actually painted.
      this.rebindLeftWidth();
    },
    // The rendered width is a PURE FUNCTION of the stored width, the
    // counterpart's in-force width and the viewport — recomputed from
    // the stored value each time, never carried forward from whatever
    // the previous clamp produced.
    //
    // Carrying it forward is what broke the ladder. A clamp only ever
    // shrinks, so a panel already squeezed down to 416 px stayed at
    // 416 px when its counterpart gave the room back, and the pair
    // never re-summed to the budget. The e2e ladder measured the
    // centre at 664 px at 1400 and 496 px at 1600 from one stored pair
    // of 600/480 — it fell as the window widened. Recomputing from the
    // stored value releases the clamp the moment the room returns, and
    // that is what makes the centre monotonic.
    //
    // Storage is not written here. The stored width stays the one the
    // user chose; only a user-driven change writes it.
    rebindLeftWidth() {
      const next = clampWidth('left', readStoredWidth('left'), this.rightWidthSnapshot, this.viewportWidth);
      if (next === this.leftSidebarWidth) return;
      this.leftSidebarWidth = next;
      eventBus.$emit('sidebar-left-width-changed', next);
    },

    checkScreenSize() {
      // The app's default is the left sidebar open (the
      // `isSidebarOpen` flag). Below the in-flow breakpoint the
      // sidebar component's CSS off-canvases it via
      // transform: translateX(-100%), but an open flag would render
      // it as an overlay on top of the chat (the `.side-bar-open`
      // rule overrides the transform to translateX(0)). Auto-close
      // it here so the first view at a narrow viewport shows the
      // chat, not the overlay.
      //
      // One-directional, matching the pre-existing behaviour: it
      // closes below the breakpoint but never re-opens above it, so
      // widening the window does not override a user's collapse.
      // The threshold must match the CSS breakpoint in
      // SideBarComponent — if the two diverge, a resize leaves the
      // app in a state its CSS does not describe.
      if (window.innerWidth < SIDEBAR_INFLOW_MIN_WIDTH && this.isSidebarOpen) {
        this.isSidebarOpen = false;
        persistOpen('left', false);
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

/*
 * No `gap` here. A flex gap sits between the ITEMS, so a collapsed
 * 50 px rail was separated from the content by a full 8 px channel
 * — measured with both panels collapsed at 1920 px: left rail 0..50,
 * a gap 50..58, centre 58..1854, a gap 1854..1862, right rail
 * 1862..1912. The spacing belongs to the PANEL, and a collapsed
 * panel owns none of it, so each panel carries its own margin and
 * drops it when collapsed (see SideBarComponent.vue). Flexbox cannot
 * make a gap conditional per item; a margin can.
 */
.main-container {
  display: flex;
  flex: 1;
  overflow: hidden;
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
