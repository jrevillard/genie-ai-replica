<!-- SideBarComponent.vue with improved theme compatibility -->
<template>
  <aside 
    class="side-bar" 
    :class="{ 'side-bar-open': isOpen }"
    :data-theme="$route.meta.theme || 'light'"
  >
    <!-- Overlay that only appears on mobile when sidebar is open -->
    <div class="mobile-sidebar-overlay" v-if="isOpen" @click="closeOverlay"></div>
    
    <div class="sidebar-inner">
      <!-- Tabbed navigation -->
      <div class="sidebar-tabs">
        <button 
          class="tab-button" 
          :class="{ 'tab-button-active': activeTab === 'services' }"
          @click="activeTab = 'services'"
        >
          <i class="fas fa-list"></i>
          {{ $t('sidebar.governmentServices', 'Government Services') }}
        </button>
        <button 
          class="tab-button" 
          :class="{ 'tab-button-active': activeTab === 'history' }"
          @click="activeTab = 'history'"
        >
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

[data-theme="dark"] .sidebar-section-title,
html[data-theme="dark"] .sidebar-section-title,
[data-theme="dark"] .sidebar-header h3,
html[data-theme="dark"] .sidebar-header h3 {
  color: rgba(255, 255, 255, 0.7) !important;
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

[data-theme="dark"] .sidebar-section h3,
[data-theme="dark"] .sidebar-header h3,
html[data-theme="dark"] .sidebar-section h3,
html[data-theme="dark"] .sidebar-header h3 {
  color: rgba(255, 255, 255, 0.7) !important;
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
  background-color: var(--accent-color);
  color: var(--text-button-primary);
}

.tab-button-active i {
  color: var(--text-button-primary);
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

/* Dark mode scrollbar - more aggressive styling */
[data-theme="dark"] *::-webkit-scrollbar {
  width: 8px;
  background-color: #2a2a2a; /* Ensure it matches dark sidebar background */
}

[data-theme="dark"] *::-webkit-scrollbar-track {
  background-color: #2a2a2a;
}

[data-theme="dark"] *::-webkit-scrollbar-thumb {
  background-color: rgba(100, 100, 100, 0.3);
  border-radius: 4px;
}

[data-theme="dark"] *::-webkit-scrollbar-thumb:hover {
  background-color: rgba(150, 150, 150, 0.4);
}

/* Dark mode search input and add button */
[data-theme="dark"] .search-box,
[data-theme="dark"] .search-container input {
  background-color: #333 !important;
  color: var(--text-primary) !important;
  border-color: #444 !important;
}

[data-theme="dark"] .search-container .add-btn,
[data-theme="dark"] .search-container .plus-btn,
[data-theme="dark"] .search-container button.add-btn {
  background-color: #444 !important;
  color: var(--text-primary) !important;
  border: none;
  border-radius: 4px;
}

/* Ensure Firefox scrollbar is consistent */
[data-theme="dark"] * {
  scrollbar-color: rgba(100, 100, 100, 0.3) #2a2a2a;
  scrollbar-width: thin;
}
</style>