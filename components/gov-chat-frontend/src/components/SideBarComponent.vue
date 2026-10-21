<template>
  <aside
    ref="sideBar"
    class="side-bar"
    :class="{
      'side-bar-open': !collapsed,
      'side-bar-collapsed-state': collapsed,
      'keyboard-active': isKeyboardActive,
      'android-device': isAndroid
    }"
    :data-theme="$route.meta.theme || 'light'"
    :style="{ '--side-bar-width': `${width}px` }"
  >
    <div v-if="!collapsed" class="mobile-sidebar-overlay" @click="closeOverlay"></div>

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

    <SidebarHandle
      v-if="showHandle"
      side="left"
      :value="width"
      :min="minWidth"
      :max="maxWidth"
      :collapsed="collapsed"
      :aria-label="$t('sidebar.resizeLeft')"
      :expand-label="$t('sidebar.expandLeft')"
      :collapse-label="$t('sidebar.collapseLeft')"
      @input="$emit('update:width', $event)"
      @collapse="toggleCollapsed"
      @reset="$emit('update:width', defaultWidth)"
    />
  </aside>
</template>

<script>
import ServiceTreePanelComponent from './ServiceTreePanelComponent.vue';
import ChatFolders from './ChatFolders.vue';
import WeatherPanel from './WeatherPanel.vue';
import { List, History } from '@lucide/vue';
import DsButton from './ds/Button.vue';
import DsTabs from './ds/Tabs.vue';
import SidebarHandle from './SidebarHandle.vue';
import { SIDEBAR_DEFAULTS, SIDEBAR_MIN_WIDTHS, SIDEBAR_MAX_WIDTHS } from '../composables/sidebarLayout.js';

const SIDEBAR_MAX_WIDTHS_FALLBACK = SIDEBAR_MAX_WIDTHS.left;

export default {
  name: 'SideBarComponent',
  components: {
    DsButton,
    DsTabs,
    ServiceTreePanelComponent,
    ChatFolders,
    WeatherPanel,
    List,
    History,
    SidebarHandle
  },
  props: {
    // Whether the sidebar is currently expanded. Replaces the prior
    // `isOpen` prop with the same semantics — open vs collapsed —
    // so the layout's CSS class names (`side-bar-open`,
    // `side-bar-collapsed-state`) read the same.
    collapsed: {
      type: Boolean,
      default: false
    },
    // The panel's current width in pixels. The parent owns this so
    // both sidebars can be clamped against each other and against
    // the centre's usable minimum at a single place.
    width: {
      type: Number,
      default: SIDEBAR_DEFAULTS.left
    },
    // The dynamic max the handle should enforce. Recomputed by the
    // parent on every viewport change and every resize of the other
    // sidebar. The handle itself stays free of viewport math.
    maxWidth: {
      type: Number,
      default: SIDEBAR_MAX_WIDTHS_FALLBACK
    },
    // Whether the resize handle should render. Off below the
    // breakpoint where the sidebar slides off-canvas — the handle
    // would anchor to nothing visible.
    showHandle: {
      type: Boolean,
      default: true
    }
  },
  emits: ['open-chat', 'close-sidebar', 'update:width', 'update:collapsed'],
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
  computed: {
    defaultWidth() {
      return SIDEBAR_DEFAULTS.left;
    },
    minWidth() {
      return SIDEBAR_MIN_WIDTHS.left;
    }
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
    },
    toggleCollapsed() {
      this.$emit('update:collapsed', !this.collapsed);
    }
  }
};
</script>

<style scoped>
/* Base styles - applied to all themes. The width arrives as the
   `--side-bar-width` custom property, bound inline on the <aside>.
   A custom property rather than a direct `width` binding on purpose:
   an inline `width` outranks every stylesheet rule, so it would also
   outrank the off-canvas rule below — a 450 px panel would keep that
   width on a 414 px phone. Binding the variable and letting each rule
   decide what to do with it keeps the responsive policy in CSS,
   where it belongs. */
.side-bar {
  width: var(--side-bar-width, 450px);
  /* The handle's width, declared here so the panel and the handle it
     contains agree on one number: a collapsed panel is exactly as wide
     as the control it carries. */
  --sidebar-handle-width: 24px;
  background: var(--bg-sidebar);
  border-right: 1px solid var(--border);
  height: 100%;
  color: var(--fg);
  flex: 0 0 auto;
  display: flex;
  flex-direction: row;
  align-items: stretch;
  /* No gap between the panel and the content beside it. The panel's
     own border is the separation; a margin drew a second line, and
     the user read that band as a stray strip around the chat. */
  transition:
    transform 0.3s ease,
    width 0.3s ease;
}

/*
 * The collapsed state is exactly as wide as the handle it carries —
 * the same on both sides, because the two sides are meant to behave
 * identically.
 *
 * Zero was the width here before the handle existed, and it is the
 * wrong width now: the handle lives inside the panel, so a zero-width
 * panel clips the one control that could bring it back. The strip is
 * the handle's home. Playwright found this — clicking the chevron on
 * a collapsed left reported the CENTRE intercepting pointer events,
 * because the clipped strip's bounding box still reported 24 px while
 * nothing was painted there.
 *
 * It used to be 50 px, which is wider than the 24 px handle: the
 * extra 26 px was a band of empty panel on the outer side of the
 * control, and the user read it as a stray strip rather than as a
 * collapsed panel. A collapsed rail now shows the control and
 * nothing else.
 */
.side-bar.side-bar-collapsed-state {
  width: var(--side-bar-collapsed-width, var(--sidebar-handle-width));
  /* The content is zero-width, so without this the 24 px handle would
     sit at the rail's OUTER edge and leave the rest of the strip
     blank — a collapsed panel whose control moves to the far end of
     the panel. Hugging the end puts the handle on the inner edge in
     both states, which is where the user last saw it. */
  justify-content: flex-end;
}

/*
 * The content collapses to zero width rather than leaving the flow:
 * a zero-width flex item keeps its place in the line, so the handle
 * stays the second child, while `display: none` would drop it to the
 * only child. `overflow: hidden` keeps the collapsed content from
 * painting over the handle.
 */
.side-bar.side-bar-collapsed-state .sidebar-inner {
  flex: 0 0 0;
  min-width: 0;
  overflow: hidden;
}

/* The panel's content. `flex: 1; min-width: 0` rather than
   `width: 100%` because the aside is a flex row: the 24 px handle
   strip is a sibling, and a 100 %-wide content box beside it would
   overflow the panel by exactly the strip's width. `min-width: 0`
   lets the flex line shrink below the content's intrinsic minimum
   when the user drags the panel to its own floor. */
.sidebar-inner {
  height: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
  z-index: 1001;
  background: var(--bg-sidebar);
  color: var(--fg);
  flex: 1 1 auto;
  min-width: 0;
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

/* Off-canvas below 1400 px. Both sidebars step aside together
   (right at the same 1400 px breakpoint, in the right sidebar's
   own CSS), so the chat column never gets squeezed by the 450 px
   left reservation at narrow laptop widths — at 1280 px the
   centre is the full 1280 px (minus a 320 px right sidebar that
   stays in flow under the same policy), and at 1024 px it is the
   full 1024 px. The responsive ladder is monotonic in the
   viewport width; the centre never narrows as the user widens
   the window.

   The boundary at 1400 px is unambiguous: (max-width: 1399px)
   pairs with (min-width: 1400px), only one matches at any width. */
@media screen and (max-width: 1399px) {
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

/* In flow at 1400 px and above. Pairs with the (max-width: 1399px)
   rule above so the boundary at 1400 px is unambiguous. The width is
   the user's, delivered as `--side-bar-width`; this rule only
   restores the in-flow positioning that the narrow-viewport
   transform overrides. The collapsed strip needs no rule here — the
   base rule's `--side-bar-collapsed-width` already carries it. */
@media screen and (min-width: 1400px) {
  .side-bar {
    position: relative;
    transform: translateX(0);
    z-index: 5;
  }

  .mobile-sidebar-overlay {
    display: none;
  }
}
</style>
