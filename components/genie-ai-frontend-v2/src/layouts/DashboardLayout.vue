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
      <!-- Inset margin shows gray behind; only the inner card scrolls (sticky chrome). -->
        <div class="dash-main__card scrollbar-thin">
          <slot />
        </div>
    </main>
  </div>
</template>
