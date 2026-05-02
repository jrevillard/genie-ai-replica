<script setup lang="ts">
import { ref } from 'vue';
import Sidebar from '../components/dashboard/Sidebar.vue';
import TopBar from '../components/dashboard/TopBar.vue';

const collapsed = ref(false);
</script>

<template>
  <div class="dash-shell">
    <Sidebar :collapsed="collapsed" @toggle="collapsed = !collapsed" />
    <main class="dash-main">
      <TopBar />
      <div class="flex-1 overflow-y-auto">
        <slot />
      </div>
    </main>
  </div>
</template>
