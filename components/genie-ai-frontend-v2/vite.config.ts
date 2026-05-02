import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// Served at root by the gateway. Vue Router's createWebHistory must use the
// matching base so deep links resolve correctly.
export default defineConfig({
  base: '/',
  plugins: [vue()],
  server: {
    port: 8090,
    host: true,
    proxy: {
      '/api': {
        target: 'https://genie.innov8ai.com',
        changeOrigin: true,
        secure: true,
        headers: {
          Origin: 'https://genie.innov8ai.com',
          Referer: 'https://genie.innov8ai.com/',
        },
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
