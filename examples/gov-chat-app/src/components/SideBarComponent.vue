<!-- SideBarComponent.vue -->
<template>
  <aside class="side-bar" :class="{ 'side-bar-open': isOpen }">
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
      
      <!-- Content based on active tab -->
      <div class="sidebar-content">
        <!-- Government Services Tab -->
        <div v-if="activeTab === 'services'" class="services-list">
          <!-- Service Tree Panel -->
          <service-tree-panel-component />
          
          <!-- Weather Panel placed at the bottom -->
          <weather-panel />
        </div>
        
        <!-- Chat History Tab -->
        <div v-else-if="activeTab === 'history'" class="chat-history">
          <chat-folders @open-chat="openChat" />
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
  overflow: hidden; /* Changed from overflow-y: auto to handle inner scrolling */
  transition: transform 0.3s ease, width 0.3s ease;
}

.sidebar-inner {
  height: 100%;
  display: flex;
  flex-direction: column;
}

/* Tabs styling */
.sidebar-tabs {
  display: flex;
  border-bottom: 1px solid #e9ecef;
  background-color: #f8f9fa;
  padding: 0;
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

.sidebar-content {
  flex-grow: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  padding: 10px;
}

.services-list,
.chat-history {
  flex-grow: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  height: 100%;
}

/* Mobile: offscreen unless side-bar-open is set */
@media screen and (max-width: 768px) {
  .side-bar {
    position: absolute;
    top: 0;
    left: 0;
    transform: translateX(-100%);
    z-index: 10;
  }
  .side-bar.side-bar-open {
    transform: translateX(0);
  }
}

/* Desktop: if not open, set width=0 or transform */
@media screen and (min-width: 769px) {
  .side-bar {
    transform: translateX(0);
    width: 250px;
  }
  .side-bar:not(.side-bar-open) {
    width: 0;
    padding: 0;
    overflow: hidden;
  }
}
</style>
