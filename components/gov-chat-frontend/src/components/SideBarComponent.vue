<template>
  <aside
    ref="sideBar"
    class="side-bar"
    :class="{
      'side-bar-open': isOpen,
      'keyboard-active': isKeyboardActive,
      'android-device': isAndroid
    }"
    :data-theme="$route.meta.theme || 'light'"
  >
    <div v-if="isOpen" class="mobile-sidebar-overlay" @click="closeOverlay"></div>

    <div class="sidebar-inner">
      <DsTabs
        v-model="activeTab"
        fill
        :tabs="[
          { label: $t('sidebar.governmentServices'), value: 'services' },
          { label: $t('sidebar.savedChats'), value: 'history' }
        ]"
      >
        <template #tab="{ tab }">
          <component :is="tab.value === 'services' ? 'List' : 'History'" :size="16" style="margin-right: 4px" />
          {{ tab.label }}
        </template>

        <div class="sidebar-content-wrapper">
          <div ref="sidebarContent" class="sidebar-content">
            <div v-if="activeTab === 'services'" class="services-list">
              <service-tree-panel-component
                ref="serviceTree"
                @keyboard-focus="handleKeyboardFocus"
                @keyboard-blur="handleKeyboardBlur"
              />
            </div>

            <div v-else-if="activeTab === 'history'" class="chat-history">
              <div :key="currentLocale" class="chat-sub-tabs">
                <DsButton
                  variant="ghost"
                  :small="true"
                  class="chat-sub-tab"
                  :class="{ active: activeSubTab === 'all' }"
                  @click="activeSubTab = 'all'"
                >
                  {{ getTabLabel('all') }}
                </DsButton>
                <DsButton
                  variant="ghost"
                  :small="true"
                  class="chat-sub-tab"
                  :class="{ active: activeSubTab === 'folders' }"
                  @click="activeSubTab = 'folders'"
                >
                  {{ getTabLabel('folders') }}
                </DsButton>
                <DsButton
                  variant="ghost"
                  :small="true"
                  class="chat-sub-tab"
                  :class="{ active: activeSubTab === 'starred' }"
                  @click="activeSubTab = 'starred'"
                >
                  {{ getTabLabel('starred') }}
                </DsButton>
                <DsButton
                  variant="ghost"
                  :small="true"
                  class="chat-sub-tab"
                  :class="{ active: activeSubTab === 'archived' }"
                  @click="activeSubTab = 'archived'"
                >
                  {{ getTabLabel('archived') }}
                </DsButton>
              </div>

              <chat-folders :active-tab="activeSubTab" @open-chat="openChat" @locale-changed="handleLocaleChange" />
            </div>
          </div>

          <div v-show="!isKeyboardActive" class="weather-container" :class="{ 'hide-on-keyboard': isKeyboardActive }">
            <weather-panel class="weather-panel-fixed" />
          </div>
        </div>
      </DsTabs>
    </div>
  </aside>
</template>

<script>
import ServiceTreePanelComponent from './ServiceTreePanelComponent.vue';
import ChatFolders from './ChatFolders.vue';
import WeatherPanel from './WeatherPanel.vue';
import { List, History } from 'lucide-vue-next';
import DsButton from './ds/Button.vue';
import DsTabs from './ds/Tabs.vue';

export default {
  name: 'SideBarComponent',
  components: {
    DsButton,
    DsTabs,
    ServiceTreePanelComponent,
    ChatFolders,
    WeatherPanel,
    List,
    History
  },
  props: {
    isOpen: {
      type: Boolean,
      default: true
    }
  },
  emits: ['open-chat', 'close-sidebar'],
  data() {
    return {
      activeTab: 'services',
      activeSubTab: 'all',
      searchQuery: '',
      isKeyboardActive: false,
      initialHeight: 0,
      isMobileDevice: false,
      isAndroid: false,
      sidebarHeight: 0,
      currentLocale: 'en'
    };
  },
  mounted() {
    this.initialHeight = window.innerHeight;
    this.sidebarHeight = this.$refs.sideBar ? this.$refs.sideBar.offsetHeight : 0;
    this.checkDevice();
    window.addEventListener('resize', this.handleResize);
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', this.handleVisualViewportResize);
    }
    if (this.isAndroid) {
      document.body.classList.add('android-device');
    }
    if (this.$i18n) {
      this.currentLocale = this.$i18n.locale;
    }
  },
  beforeUnmount() {
    window.removeEventListener('resize', this.handleResize);
    if (window.visualViewport) {
      window.visualViewport.removeEventListener('resize', this.handleVisualViewportResize);
    }
    if (this.isAndroid) {
      document.body.classList.remove('android-device');
    }
  },
  methods: {
    handleLocaleChange(newLocale) {
      this.currentLocale = newLocale;
      this.$forceUpdate();
    },
    checkDevice() {
      this.isMobileDevice =
        window.innerWidth <= 768 ||
        /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      this.isAndroid = /Android/i.test(navigator.userAgent);
    },
    handleResize() {
      this.checkDevice();
      if (this.isMobileDevice) {
        if (this.isAndroid && this.isKeyboardActive) {
          this.handleAndroidKeyboard();
        } else {
          const heightDifference = this.initialHeight - window.innerHeight;
          const isKeyboardLikelyOpen = heightDifference > 150;
          if (isKeyboardLikelyOpen !== this.isKeyboardActive) {
            this.isKeyboardActive = isKeyboardLikelyOpen;
            if (isKeyboardLikelyOpen && this.isAndroid) {
              this.handleAndroidKeyboard();
            }
          }
        }
      }
    },
    handleAndroidKeyboard() {
      if (!this.$refs.sideBar || !this.$refs.sidebarContent) return;
      const keyboardHeight = this.initialHeight - window.innerHeight;
      if (keyboardHeight > 150) {
        const viewportHeight = window.innerHeight;
        const headerHeight = 60;
        const tabsHeight = 40;
        const availableHeight = viewportHeight - headerHeight - tabsHeight;
        const minContentHeight = Math.max(250, availableHeight * 0.7);
        this.$refs.sidebarContent.style.maxHeight = `${minContentHeight}px`;
        this.$refs.sidebarContent.style.height = `${minContentHeight}px`;
      }
    },
    handleVisualViewportResize() {
      if (window.visualViewport && this.isMobileDevice) {
        const viewportHeight = window.visualViewport.height;
        const windowHeight = window.innerHeight;
        this.isKeyboardActive = viewportHeight < windowHeight * 0.75;
      }
    },
    handleKeyboardFocus() {
      this.isKeyboardActive = true;
      document.body.classList.add('keyboard-open');
      if (this.isAndroid) {
        this.handleAndroidKeyboard();
        this.$nextTick(() => {
          if (this.$refs.sidebarContent) {
            this.$refs.sidebarContent.scrollTop = 0;
          }
        });
      }
    },
    handleKeyboardBlur() {
      setTimeout(() => {
        this.isKeyboardActive = false;
        document.body.classList.remove('keyboard-open');
        if (this.isAndroid && this.$refs.sidebarContent) {
          this.$refs.sidebarContent.style.maxHeight = '';
          this.$refs.sidebarContent.style.height = '';
        }
      }, 300);
    },
    getTabLabel(tabKey) {
      if (this.$t && typeof this.$t === 'function') {
        try {
          const i18nKey = `sidebar.tab.${tabKey}`;
          const translation = this.$t(i18nKey);
          if (translation && translation !== i18nKey) {
            return translation;
          }
        } catch {
          // Translation error, fall back to default
        }
      }
      return tabKey.charAt(0).toUpperCase() + tabKey.slice(1);
    },
    openChat(chatId) {
      this.$emit('open-chat', chatId);
    },
    closeOverlay() {
      this.$emit('close-sidebar');
    }
  }
};
</script>

<style scoped>
/* Base styles - applied to all themes */
.side-bar {
  width: 450px;
  background: var(--bg-sidebar);
  border-right: 1px solid var(--border);
  height: 100%;
  color: var(--fg);
  transition:
    transform 0.3s ease,
    width 0.3s ease;
}

.sidebar-inner {
  height: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
  z-index: 1001;
  background: var(--bg-sidebar);
  color: var(--fg);
  width: 100%;
}

.sidebar-section-title,
.sidebar-header h3 {
  font-size: var(--text-base);
  font-weight: 500;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.sidebar-section h3,
.sidebar-header h3 {
  margin: 0;
  font-size: var(--text-base);
  font-weight: 500;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: var(--space-sm) var(--space-md);
}

/* Mobile overlay */
.mobile-sidebar-overlay {
  display: none;
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: var(--overlay-bg);
  z-index: 1000;
}

/* DsTabs overrides for sidebar context */
.sidebar-inner :deep(.ds-tabs) {
  flex-grow: 1;
}

.sidebar-inner :deep(.ds-tabs__btn) {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-sm);
}

.sidebar-inner :deep(.ds-tabs__btn svg) {
  color: var(--muted);
}

.sidebar-inner :deep(.ds-tabs__btn--active svg) {
  color: var(--accent);
}

/* New wrapper to control the layout of content + weather */
.sidebar-content-wrapper {
  display: flex;
  flex-direction: column;
  flex-grow: 1;
  height: 0;
  overflow: clip;
  width: 100%;
}

/* Scrollable container */
.sidebar-content {
  flex-grow: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  padding: var(--space-sm);
  padding-bottom: 0;
  margin-bottom: 0;
  background: var(--bg-sidebar);
  color: var(--fg);
  width: 100%;
}

.services-list,
.chat-history {
  flex-grow: 1;
  overflow: visible;
  display: flex;
  flex-direction: column;
  width: 100%;
}

/* Container for weather panel */
.weather-container {
  flex-shrink: 0;
  background: var(--bg-sidebar);
  border-top: 1px solid var(--border);
  padding: var(--space-sm);
  margin-top: var(--space-xs);
  width: 100%;
}

/* Hide weather panel when keyboard is active on mobile */
.weather-container.hide-on-keyboard {
  display: none;
}

.weather-panel-fixed {
  width: 100%;
}

/* Special styles for when keyboard is active */
.side-bar.keyboard-active .sidebar-content {
  height: 100%;
  flex-grow: 1;
}

/* Chat sub-tabs styling */
.chat-sub-tabs {
  display: flex;
  border-bottom: 1px solid var(--border);
  margin-bottom: var(--space-sm);
  background-color: var(--bg-sidebar);
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
  width: 100%;
}

.chat-sub-tabs::-webkit-scrollbar {
  display: none;
}

.chat-sub-tab {
  flex: 1;
  min-width: 75px;
  text-align: center;
  white-space: nowrap;
  border-bottom: 2px solid transparent;
}

.chat-sub-tab.active {
  border-bottom: 2px solid var(--accent);
  font-weight: 600;
}

/* Search box styling */
.search-container {
  display: flex;
  margin-bottom: var(--space-md);
  padding: var(--space-xs);
  width: 100%;
}

.search-box {
  flex: 1;
  font-family: var(--font-body);
  font-size: var(--text-base);
  padding: var(--space-sm) var(--space-md);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--surface);
  color: var(--fg);
  outline: none;
  transition: border-color 0.15s;
}

.search-box:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px var(--accent-muted);
}

.search-box::placeholder {
  color: var(--muted);
  opacity: 0.6;
}

/* Empty state styling */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--space-2xl) var(--space-lg);
  color: var(--muted-soft);
  text-align: center;
  width: 100%;
}

.empty-icon {
  font-size: var(--text-2xl);
  margin-bottom: var(--space-sm);
  opacity: 0.5;
}

.empty-state p {
  margin: var(--space-xs) 0;
  font-size: var(--text-base);
}

/* All chats and folders content styling */
.all-chats-content,
.folders-content {
  padding: 0;
  width: 100%;
}

/* Mobile: offscreen unless side-bar-open is set */
@media screen and (max-width: 768px) {
  .side-bar {
    position: fixed;
    top: 60px;
    left: 0;
    height: calc(100vh - 60px);
    width: 90%;
    max-width: 480px;
    transform: translateX(-100%);
    z-index: 15;
    box-shadow: none;
  }

  .side-bar.side-bar-open {
    transform: translateX(0);
    box-shadow: var(--shadow-lg);
  }

  .mobile-sidebar-overlay {
    display: block;
  }

  .sidebar-inner :deep(.ds-tabs__btn) {
    padding: var(--space-md) 0;
  }

  .chat-sub-tab {
    padding: var(--space-sm) var(--space-md);
    font-size: var(--text-base);
  }
}

/* Desktop: if not open, set width=0 or transform */
@media screen and (min-width: 768px) {
  .side-bar {
    position: relative;
    transform: translateX(0);
    width: 450px;
    z-index: 5;
  }

  .side-bar:not(.side-bar-open) {
    width: 0;
    padding: 0;
    overflow: hidden;
  }

  .mobile-sidebar-overlay {
    display: none;
  }
}
</style>
