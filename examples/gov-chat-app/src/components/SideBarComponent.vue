<!-- SideBarComponent.vue with fixed layout to prevent scroll overlap -->
<template>
  <aside class="side-bar" :class="{ 'side-bar-open': isOpen }">
    <!-- Overlay that only appears on mobile when sidebar is open -->
    <div class="mobile-sidebar-overlay" v-if="isOpen" @click="closeOverlay"></div>
    
    <div class="sidebar-inner">
      <!-- Tabbed navigation -->
      <div class="sidebar-tabs">
        <button 
          class="tab-button" 
          :class="{ active: activeTab === 'services' }"
          @click="activeTab = 'services'"
        >
          <i class="fas fa-list"></i>
          {{ $t('sidebar.governmentServices', 'Government Services') }}
        </button>
        <button 
          class="tab-button" 
          :class="{ active: activeTab === 'history' }"
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
  background: #ffffff;
  border-right: 1px solid #ddd;
  height: 100%;
  overflow: hidden !important; /* Force no overflow */
  transition: transform 0.3s ease, width 0.3s ease;
}

.sidebar-inner {
  height: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
  z-index: 1001; /* Higher than overlay */
  background: white; /* Ensure background is solid */
  overflow: hidden !important; /* Force no overflow */
}

/* Mobile overlay */
.mobile-sidebar-overlay {
  display: none; /* Hidden by default */
}

/* Tabs styling */
.sidebar-tabs {
  display: flex;
  border-bottom: 1px solid #e9ecef;
  background-color: #f8f9fa;
  padding: 0;
  flex-shrink: 0; /* Prevent tabs from shrinking */
}

.tab-button {
  flex: 1;
  padding: 10px 0;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 0.9rem;
  color: #666;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  transition: background-color 0.2s, color 0.2s;
}

.tab-button i {
  font-size: 1rem;
}

.tab-button:hover {
  background-color: #e9ecef;
  color: #333;
}

.tab-button.active {
  background-color: #4e97d1;
  color: white;
}

/* New wrapper to control the layout of content + weather */
.sidebar-content-wrapper {
  display: flex;
  flex-direction: column;
  flex-grow: 1;
  height: 0; /* Force it to use flex grow */
  overflow: hidden; /* Prevent any overflow here */
}

/* THIS IS THE SCROLLABLE CONTAINER - Modified to work with new layout */
.sidebar-content {
  flex-grow: 1;
  overflow-y: auto !important; /* Force scrolling here */
  display: flex;
  flex-direction: column;
  padding: 10px;
  /* Remove any margin/padding bottom that might be causing issues */
  padding-bottom: 0;
  margin-bottom: 0;
}

.services-list,
.chat-history {
  flex-grow: 1;
  overflow: visible !important; /* Force no scrolling */
  display: flex;
  flex-direction: column;
}

/* Container for weather panel */
.weather-container {
  flex-shrink: 0; /* Don't allow shrinking */
  background: white;
  border-top: 1px solid #eee;
  padding: 10px;
  margin-top: 5px; /* Small gap between content and weather */
}

/* Weather component styling */
.weather-panel-fixed {
  /* No longer needs to be positioned absolutely */
  width: 100%;
}

/* Mobile: offscreen unless side-bar-open is set */
@media screen and (max-width: 768px) {
  .side-bar {
    position: fixed;
    top: 60px; /* Start below the navbar height */
    left: 0;
    height: calc(100vh - 60px); /* Adjust height to account for navbar */
    width: 85%;
    max-width: 320px;
    transform: translateX(-100%);
    z-index: 15; /* Higher than chat component but lower than navbar */
    box-shadow: none;
  }
  
  .side-bar.side-bar-open {
    transform: translateX(0);
    box-shadow: 0 0 15px rgba(0, 0, 0, 0.3);
  }
  
  /* Show overlay on mobile */
  .mobile-sidebar-overlay {
    display: block;
    position: fixed;
    top: 60px; /* Start below navbar */
    left: 0;
    right: 0;
    bottom: 0;
    background-color: rgba(0, 0, 0, 0.5);
    z-index: 14; /* Lower than sidebar but higher than chat */
  }
  
  /* Adjust tab buttons for mobile */
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
    z-index: 5; /* Higher than chat component in desktop view */
  }
  
  .side-bar:not(.side-bar-open) {
    width: 0;
    padding: 0;
    overflow: hidden;
  }
  
  .mobile-sidebar-overlay {
    display: none; /* Always hidden on desktop */
  }
}
</style>
