<!-- App.vue -->
<template>
  <div id="app">
    <!-- Top Nav Bar -->
    <NavBarComponent />

    <!-- Main content: side by side -->
    <div class="content-wrapper">
      <SideBarComponent :isOpen="sidebarOpen" />

      <!-- The right panel (chat area) -->
      <div class="chat-panel">
        <!-- The ChatBot itself, which may have an internal chat window + input
             or we can define them here. This example keeps it inside ChatBotComponent. -->
        <ChatBotComponent />
      </div>
    </div>
  </div>
</template>

<script>
import NavBarComponent from '@/components/NavBarComponent.vue'
import SideBarComponent from '@/components/SideBarComponent.vue'
import ChatBotComponent from '@/components/ChatBotComponent.vue'

export default {
  name: 'App',
  components: {
    NavBarComponent,
    SideBarComponent,
    ChatBotComponent
  },
  data() {
    return {
      sidebarOpen: true
    }
  }
}
</script>

<style scoped>
/* 
  #app is the vertical container: 
  - NavBar at the top
  - content-wrapper below 
*/
#app {
  display: flex;
  flex-direction: column;
  height: 100vh; /* occupy full browser height */
  overflow: hidden; /* no global scrolling */
}

/* 
  content-wrapper: horizontal flex 
  - sidebar (left)
  - chat-panel (right)
*/
.content-wrapper {
  display: flex;
  flex: 1;         /* fill remaining space below NavBar */
  overflow: hidden;/* no global scroll, each child can scroll individually */
}

/* The left sidebar with a fixed width, can scroll if tall */
.side-bar {
  width: 300px;
  min-width: 240px;
  max-width: 320px;
  overflow-y: auto;
}

/* The main chat panel on the right */
.chat-panel {
  flex: 1;
  display: flex;        /* so the ChatBot can handle its own layout */
  flex-direction: column;
  overflow: hidden;     /* ChatBot handles its own scrolling area inside */
}
</style>

