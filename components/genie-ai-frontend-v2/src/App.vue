<script setup lang="ts">
import { RouterView } from 'vue-router';
import { Toaster } from './lib/notify';
</script>

<template>
  <RouterView />
  <Toaster position="top-center" />
</template>
