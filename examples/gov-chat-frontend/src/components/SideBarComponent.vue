<!-- SideBarComponent.vue with improved theme compatibility -->
<!-- SideBarComponent.vue with improved mobile keyboard handling (corrected styles) -->
<!-- SideBarComponent.vue with Android keyboard fix -->
<template>
  <aside class="side-bar" 
         :class="{ 
           'side-bar-open': isOpen, 
           'keyboard-active': isKeyboardActive,
           'android-device': isAndroid
         }" 
         :data-theme="$route.meta.theme || 'light'"
         ref="sideBar">
    
    <!-- Overlay that only appears on mobile when sidebar is open -->
    <div class="mobile-sidebar-overlay" v-if="isOpen" @click="closeOverlay"></div>

    <div class="sidebar-inner">
      <!-- Tabbed navigation -->
      <div class="sidebar-tabs">
        <button class="tab-button" 
                :class="{ 'tab-button-active': activeTab === 'services' }"
                @click="activeTab = 'services'">
          <i class="fas fa-list"></i>
          {{ $t('sidebar.governmentServices', 'Government Services') }}
        </button>
        <button class="tab-button" 
                :class="{ 'tab-button-active': activeTab === 'history' }"
                @click="activeTab = 'history'">
          <i class="fas fa-history"></i>
          {{ $t('sidebar.chatHistory', 'Chat History') }}
        </button>
      </div>

      <!-- Main flex container for content -->
      <div class="sidebar-content-wrapper">
        <!-- Scrollable content area -->
        <div class="sidebar-content" ref="sidebarContent">
          <!-- Government Services Tab -->
          <div v-if="activeTab === 'services'" class="services-list">
            <!-- Service Tree Panel -->
            <service-tree-panel-component 
              ref="serviceTree" 
              @keyboard-focus="handleKeyboardFocus" 
              @keyboard-blur="handleKeyboardBlur" 
            />
          </div>

          <!-- Chat History Tab -->
          <div v-else-if="activeTab === 'history'" class="chat-history">
            <chat-folders @open-chat="openChat" />
          </div>
        </div>

        <!-- Weather Panel in its own container, not part of the scroll area -->
        <div class="weather-container" 
             :class="{ 'hide-on-keyboard': isKeyboardActive }"
             v-show="!isKeyboardActive">
          <weather-panel class="weather-panel-fixed" />
        </div>
      </div>
    </div>
  </aside>
</template>

<script>
import ServiceTreePanelComponent from './ServiceTreePanelComponent.vue'
import ChatFolders from './ChatFolders.vue'
import WeatherPanel from './WeatherPanel.vue'

export default {
  name: 'SideBarComponent',
  components: {
    ServiceTreePanelComponent,
    ChatFolders,
    WeatherPanel
  },
  props: {
    isOpen: { 
      type: Boolean, 
      default: true 
    }
  },
  data() {
    return {
      activeTab: 'services',
      isKeyboardActive: false,
      initialHeight: 0,
      isMobileDevice: false,
      isAndroid: false,
      sidebarHeight: 0
    }
  },
  mounted() {
    // Store initial window height
    this.initialHeight = window.innerHeight;
    this.sidebarHeight = this.$refs.sideBar ? this.$refs.sideBar.offsetHeight : 0;
    
    // Check if mobile device and if Android
    this.checkDevice();
    
    // Add resize event listener
    window.addEventListener('resize', this.handleResize);
    
    // For iOS devices, use VisualViewport API if available
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', this.handleVisualViewportResize);
    }
    
    // Add a class to document body for global styling
    if (this.isAndroid) {
      document.body.classList.add('android-device');
    }
  },
  beforeUnmount() {
    window.removeEventListener('resize', this.handleResize);
    
    if (window.visualViewport) {
      window.visualViewport.removeEventListener('resize', this.handleVisualViewportResize);
    }
    
    // Remove body class
    if (this.isAndroid) {
      document.body.classList.remove('android-device');
    }
  },
  methods: {
    checkDevice() {
      this.isMobileDevice = window.innerWidth <= 768 || 
                             /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      
      // Specifically check for Android
      this.isAndroid = /Android/i.test(navigator.userAgent);
    },
    
    handleResize() {
      this.checkDevice();
      
      // Only run keyboard detection on mobile devices
      if (this.isMobileDevice) {
        // If we're on Android and keyboard is active, handle specially
        if (this.isAndroid && this.isKeyboardActive) {
          this.handleAndroidKeyboard();
        } else {
          // General mobile check (mostly for Android)
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
    
    // Special Android keyboard handler
    handleAndroidKeyboard() {
      if (!this.$refs.sideBar || !this.$refs.sidebarContent) return;
      
      // Calculate keyboard height (approximate)
      const keyboardHeight = this.initialHeight - window.innerHeight;
      
      if (keyboardHeight > 150) {
        // Adjust the sidebar content to remain visible above keyboard
        const viewportHeight = window.innerHeight;
        const headerHeight = 60; // Height of the header (approximate)
        const tabsHeight = 40;   // Height of the tabs (approximate)
        
        // Calculate available height for content
        const availableHeight = viewportHeight - headerHeight - tabsHeight;
        
        // Set a minimum content height to keep tree visible
        const minContentHeight = Math.max(250, availableHeight * 0.7);
        
        // Apply content height directly
        this.$refs.sidebarContent.style.maxHeight = `${minContentHeight}px`;
        this.$refs.sidebarContent.style.height = `${minContentHeight}px`;
      }
    },
    
    // Handle visual viewport resize (better for iOS)
    handleVisualViewportResize() {
      if (window.visualViewport && this.isMobileDevice) {
        // If the viewport height is significantly reduced, keyboard is probably open
        const viewportHeight = window.visualViewport.height;
        const windowHeight = window.innerHeight;
        
        // If viewport height is less than 75% of window height, keyboard is probably open
        this.isKeyboardActive = viewportHeight < (windowHeight * 0.75);
      }
    },
    
    // Handle keyboard focus event from child component
    handleKeyboardFocus() {
      this.isKeyboardActive = true;
      
      // Add class to body
      document.body.classList.add('keyboard-open');
      
      // Special handling for Android
      if (this.isAndroid) {
        this.handleAndroidKeyboard();
        
        // Make sure the search box is visible
        this.$nextTick(() => {
          if (this.$refs.sidebarContent) {
            this.$refs.sidebarContent.scrollTop = 0;
          }
        });
      }
    },
    
    // Handle keyboard blur event from child component
    handleKeyboardBlur() {
      // Small delay to ensure keyboard has fully closed
      setTimeout(() => {
        this.isKeyboardActive = false;
        
        // Remove class from body
        document.body.classList.remove('keyboard-open');
        
        // Reset styles for Android
        if (this.isAndroid && this.$refs.sidebarContent) {
          this.$refs.sidebarContent.style.maxHeight = '';
          this.$refs.sidebarContent.style.height = '';
        }
      }, 300);
    },
    
    openChat(chatId) {
      // Emit the event to parent component
      this.$emit('open-chat', chatId);
    },
    
    closeOverlay() {
      // Just emit a close event that parent can listen to
      this.$emit('close-sidebar');
    }
  }
}
</script>

<style scoped>
/* Base styles - applied to all themes */
.side-bar {
  width: 300px;
  background: var(--bg-sidebar);
  border-right: 1px solid var(--border-color);
  height: 100%;
  color: var(--text-primary);
  overflow: hidden !important;
  transition: transform 0.3s ease, width 0.3s ease;
}

.sidebar-inner {
  height: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
  z-index: 1001;
  background: var(--bg-sidebar);
  color: var(--text-primary);
  overflow: hidden !important;
}

.sidebar-section-title,
.sidebar-header h3 {
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.sidebar-section h3,
.sidebar-header h3 {
  margin: 0;
  font-size: 0.8rem;
  font-weight: 500;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 10px 16px;
}

/* Mobile overlay */
.mobile-sidebar-overlay {
  display: none;
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(0, 0, 0, 0.5);
  z-index: 1000;
}

/* Tabs styling */
.sidebar-tabs {
  display: flex;
  border-bottom: 1px solid var(--border-light);
  background-color: var(--bg-tertiary);
  padding: 0;
  flex-shrink: 0;
}

.tab-button {
  flex: 1;
  padding: 10px 0;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 0.9rem;
  color: var(--text-tertiary);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  transition: background-color 0.2s, color 0.2s;
}

.tab-button i {
  font-size: 1rem;
  color: var(--text-tertiary);
}

.tab-button:hover {
  background-color: var(--bg-secondary);
  color: var(--text-primary);
}

.tab-button-active {
  background-color: #4E97D1; /* Match navbar primary blue */
  color: white;
}

.tab-button-active i {
  color: white;
}

/* New wrapper to control the layout of content + weather */
.sidebar-content-wrapper {
  display: flex;
  flex-direction: column;
  flex-grow: 1;
  height: 0;
  overflow: hidden;
}

/* Scrollable container */
.sidebar-content {
  flex-grow: 1;
  overflow-y: auto !important;
  display: flex;
  flex-direction: column;
  padding: 10px;
  padding-bottom: 0;
  margin-bottom: 0;
  background: var(--bg-sidebar);
  color: var(--text-primary);
}

.services-list,
.chat-history {
  flex-grow: 1;
  overflow: visible !important;
  display: flex;
  flex-direction: column;
}

/* Container for weather panel */
.weather-container {
  flex-shrink: 0;
  background: var(--bg-sidebar);
  border-top: 1px solid var(--border-light);
  padding: 10px;
  margin-top: 5px;
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
  /* Give more space to content when keyboard is open */
  height: 100%;
  flex-grow: 1;
}

/* Android-specific styles */
.side-bar.android-device.keyboard-active {
  /* Fixed positioning when keyboard is active */
  position: fixed !important;
  height: auto !important;
  /* Ensure the sidebar doesn't extend under the keyboard */
  bottom: auto !important;
}

/* Mobile: offscreen unless side-bar-open is set */
@media screen and (max-width: 768px) {
  .side-bar {
    position: fixed;
    top: 60px;
    left: 0;
    height: calc(100vh - 60px);
    width: 85%;
    max-width: 320px;
    transform: translateX(-100%);
    z-index: 15;
    box-shadow: none;
  }
  
  .side-bar.side-bar-open {
    transform: translateX(0);
    box-shadow: 0 0 15px rgba(0, 0, 0, 0.3);
  }
  
  /* Special treatment for Android keyboard issues */
  .side-bar.side-bar-open.keyboard-active.android-device {
    /* Override any height constraints when keyboard is active */
    height: auto !important;
    bottom: auto !important; /* Don't extend below keyboard */
    /* Ensure search remains at the top */
    transform: translateX(0) !important;
  }
  
  .mobile-sidebar-overlay {
    display: block;
  }
  
  .tab-button {
    padding: 12px 0;
  }
  
  /* Make sure search is always visible when keyboard is active */
  .side-bar.keyboard-active .sidebar-content {
    padding-bottom: 50px;
  }
  
  /* Android-specific mobile adjustments */
  .side-bar.android-device.keyboard-active .sidebar-content {
    height: auto !important;
    /* Ensure a minimum height for content visibility */
    min-height: 200px;
    max-height: 70vh;
  }
}

/* Desktop: if not open, set width=0 or transform */
@media screen and (min-width: 769px) {
  .side-bar {
    position: relative;
    transform: translateX(0);
    width: 250px;
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

/* Theme Styles - Dark and System Mode */
/* Dark mode tab styling to match navbar */
[data-theme="dark"] .tab-button-active {
  background-color: #1e3a58; /* Match navbar dark blue */
  color: white;
}

[data-theme="dark"] .tab-button:hover:not(.tab-button-active) {
  background-color: rgba(78, 151, 209, 0.15); /* Darker blue hover for dark mode */
  color: rgba(255, 255, 255, 0.9);
}

[data-theme="dark"] .tab-button {
  color: rgba(255, 255, 255, 0.7);
}

[data-theme="dark"] .tab-button i {
  color: rgba(255, 255, 255, 0.7);
}

[data-theme="dark"] .tab-button-active i {
  color: white;
}

/* Ensure tab bottom border is visible in both modes */
[data-theme="dark"] .sidebar-tabs {
  border-bottom-color: rgba(255, 255, 255, 0.1);
}

/* Section title styling in dark mode */
[data-theme="dark"] .sidebar-section-title,
[data-theme="dark"] .sidebar-header h3 {
  color: rgba(255, 255, 255, 0.7);
}

/* Dark mode scrollbar styling */
[data-theme="dark"] .sidebar-content::-webkit-scrollbar {
  width: 8px;
  background-color: #2a2a2a;
}

[data-theme="dark"] .sidebar-content::-webkit-scrollbar-track {
  background-color: #2a2a2a;
}

[data-theme="dark"] .sidebar-content::-webkit-scrollbar-thumb {
  background-color: rgba(100, 100, 100, 0.3);
  border-radius: 4px;
}

[data-theme="dark"] .sidebar-content::-webkit-scrollbar-thumb:hover {
  background-color: rgba(150, 150, 150, 0.4);
}

/* Firefox scrollbar consistency */
[data-theme="dark"] .sidebar-content {
  scrollbar-color: rgba(100, 100, 100, 0.3) #2a2a2a;
  scrollbar-width: thin;
}

/* Dark mode search input and add button */
[data-theme="dark"] .search-box,
[data-theme="dark"] .search-container input {
  background-color: #333;
  color: var(--text-primary);
  border-color: #444;
}

[data-theme="dark"] .search-container .add-btn,
[data-theme="dark"] .search-container .plus-btn,
[data-theme="dark"] .search-container button.add-btn {
  background-color: #444;
  color: var(--text-primary);
  border: none;
  border-radius: 4px;
}
</style>