<!-- SideBarComponent.vue with improved theme compatibility -->
<template>
  <aside class="side-bar" :class="{ 'side-bar-open': isOpen }" :data-theme="$route.meta.theme || 'light'">
    <!-- Overlay that only appears on mobile when sidebar is open -->
    <div class="mobile-sidebar-overlay" v-if="isOpen" @click="closeOverlay"></div>

    <div class="sidebar-inner">
      <!-- Tabbed navigation -->
      <div class="sidebar-tabs">
        <button class="tab-button" :class="{ 'tab-button-active': activeTab === 'services' }"
          @click="activeTab = 'services'">
          <i class="fas fa-list"></i>
          {{ $t('sidebar.governmentServices', 'Government Services') }}
        </button>
        <button class="tab-button" :class="{ 'tab-button-active': activeTab === 'history' }"
          @click="activeTab = 'history'">
          <i class="fas fa-history"></i>
          {{ $t('sidebar.chatHistory', 'Chat History') }}
        </button>
      </div>

      <!-- Main flex container for content -->
      <div class="sidebar-content-wrapper">
        <!-- Scrollable content area -->
        <div class="sidebar-content">
          <!-- Government Services Tab -->
          <div v-if="activeTab === 'services'" class="services-list">
            <!-- Service Tree Panel -->
            <service-tree-panel-component />
          </div>

          <!-- Chat History Tab -->
          <div v-else-if="activeTab === 'history'" class="chat-history">
            <chat-folders @open-chat="openChat" />
          </div>
        </div>

        <!-- Weather Panel in its own container, not part of the scroll area -->
        <div class="weather-container">
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
    isOpen: { type: Boolean, default: true }
  },
  data() {
    return {
      activeTab: 'services'
    }
  },
  methods: {
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

.weather-panel-fixed {
  width: 100%;
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
  
  .mobile-sidebar-overlay {
    display: block;
  }
  
  .tab-button {
    padding: 12px 0;
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
[data-theme="dark"] .tab-button-active,
html[data-theme="dark"] .tab-button-active,
[data-theme="system"].dark-mode .tab-button-active,
html[data-theme="system"].dark-mode .tab-button-active {
  background-color: #1e3a58; /* Match navbar dark blue */
  color: white;
}

[data-theme="dark"] .tab-button:hover:not(.tab-button-active),
html[data-theme="dark"] .tab-button:hover:not(.tab-button-active),
[data-theme="system"].dark-mode .tab-button:hover:not(.tab-button-active),
html[data-theme="system"].dark-mode .tab-button:hover:not(.tab-button-active) {
  background-color: rgba(78, 151, 209, 0.15); /* Darker blue hover for dark mode */
  color: rgba(255, 255, 255, 0.9);
}

[data-theme="dark"] .tab-button,
html[data-theme="dark"] .tab-button,
[data-theme="system"].dark-mode .tab-button,
html[data-theme="system"].dark-mode .tab-button {
  color: rgba(255, 255, 255, 0.7);
}

[data-theme="dark"] .tab-button i,
html[data-theme="dark"] .tab-button i,
[data-theme="system"].dark-mode .tab-button i,
html[data-theme="system"].dark-mode .tab-button i {
  color: rgba(255, 255, 255, 0.7);
}

[data-theme="dark"] .tab-button-active i,
html[data-theme="dark"] .tab-button-active i,
[data-theme="system"].dark-mode .tab-button-active i,
html[data-theme="system"].dark-mode .tab-button-active i {
  color: white;
}

/* Ensure tab bottom border is visible in both modes */
[data-theme="dark"] .sidebar-tabs,
html[data-theme="dark"] .sidebar-tabs,
[data-theme="system"].dark-mode .sidebar-tabs,
html[data-theme="system"].dark-mode .sidebar-tabs {
  border-bottom-color: rgba(255, 255, 255, 0.1);
}

/* Section title styling in dark mode */
[data-theme="dark"] .sidebar-section-title,
[data-theme="dark"] .sidebar-header h3,
html[data-theme="dark"] .sidebar-section-title,
html[data-theme="dark"] .sidebar-header h3,
[data-theme="system"].dark-mode .sidebar-section-title,
[data-theme="system"].dark-mode .sidebar-header h3,
html[data-theme="system"].dark-mode .sidebar-section-title,
html[data-theme="system"].dark-mode .sidebar-header h3 {
  color: rgba(255, 255, 255, 0.7);
}

/* Dark mode scrollbar styling */
[data-theme="dark"] *::-webkit-scrollbar,
html[data-theme="dark"] *::-webkit-scrollbar,
[data-theme="system"].dark-mode *::-webkit-scrollbar,
html[data-theme="system"].dark-mode *::-webkit-scrollbar {
  width: 8px;
  background-color: #2a2a2a;
}

[data-theme="dark"] *::-webkit-scrollbar-track,
html[data-theme="dark"] *::-webkit-scrollbar-track,
[data-theme="system"].dark-mode *::-webkit-scrollbar-track,
html[data-theme="system"].dark-mode *::-webkit-scrollbar-track {
  background-color: #2a2a2a;
}

[data-theme="dark"] *::-webkit-scrollbar-thumb,
html[data-theme="dark"] *::-webkit-scrollbar-thumb,
[data-theme="system"].dark-mode *::-webkit-scrollbar-thumb,
html[data-theme="system"].dark-mode *::-webkit-scrollbar-thumb {
  background-color: rgba(100, 100, 100, 0.3);
  border-radius: 4px;
}

[data-theme="dark"] *::-webkit-scrollbar-thumb:hover,
html[data-theme="dark"] *::-webkit-scrollbar-thumb:hover,
[data-theme="system"].dark-mode *::-webkit-scrollbar-thumb:hover,
html[data-theme="system"].dark-mode *::-webkit-scrollbar-thumb:hover {
  background-color: rgba(150, 150, 150, 0.4);
}

/* Firefox scrollbar consistency */
[data-theme="dark"] *,
html[data-theme="dark"] *,
[data-theme="system"].dark-mode *,
html[data-theme="system"].dark-mode * {
  scrollbar-color: rgba(100, 100, 100, 0.3) #2a2a2a;
  scrollbar-width: thin;
}

/* Dark mode search input and add button */
[data-theme="dark"] .search-box,
[data-theme="dark"] .search-container input,
html[data-theme="dark"] .search-box,
html[data-theme="dark"] .search-container input,
[data-theme="system"].dark-mode .search-box,
[data-theme="system"].dark-mode .search-container input,
html[data-theme="system"].dark-mode .search-box,
html[data-theme="system"].dark-mode .search-container input {
  background-color: #333;
  color: var(--text-primary);
  border-color: #444;
}

[data-theme="dark"] .search-container .add-btn,
[data-theme="dark"] .search-container .plus-btn,
[data-theme="dark"] .search-container button.add-btn,
html[data-theme="dark"] .search-container .add-btn,
html[data-theme="dark"] .search-container .plus-btn,
html[data-theme="dark"] .search-container button.add-btn,
[data-theme="system"].dark-mode .search-container .add-btn,
[data-theme="system"].dark-mode .search-container .plus-btn,
[data-theme="system"].dark-mode .search-container button.add-btn,
html[data-theme="system"].dark-mode .search-container .add-btn,
html[data-theme="system"].dark-mode .search-container .plus-btn,
html[data-theme="system"].dark-mode .search-container button.add-btn {
  background-color: #444;
  color: var(--text-primary);
  border: none;
  border-radius: 4px;
}
</style>