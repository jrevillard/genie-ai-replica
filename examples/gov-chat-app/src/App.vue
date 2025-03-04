<template>
  <router-view />
</template>

<script>
export default {
  name: 'App'
}
</script>

<style>
/* global styles if needed */
html, body {
  margin: 0;
  padding: 0;
  font-family: 'Segoe UI', Arial, sans-serif;
  height: 100%;
}
#app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
</style>

