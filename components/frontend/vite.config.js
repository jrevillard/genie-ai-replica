import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
//
// Proxy table mirrors the A40 deployment so a local browser can fetch
// /api/v1/... without CORS or absolute-URL workarounds. The frontend
// code defaults `window.AMINA_API = http://localhost:8000` if the var
// isn't set, BUT some bootstrap modules build paths relative to the
// origin (e.g. /api/v1/public/...) - those would otherwise be served
// Vite's index.html and the JSON parse would silently fail, leaving
// the screen blank.
const BACKEND  = 'http://localhost:8000'
const GATEWAY  = 'http://localhost:8443'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
    host: true,
    proxy: {
      // Public gateway routes (jailbreak-defended). MUST be listed
      // before /api so the more-specific prefix wins.
      '/api/v1/public': { target: GATEWAY, changeOrigin: true },
      // Everything else under /api/v1/* goes to the haystack backend.
      '/api':        { target: BACKEND, changeOrigin: true },
      '/agent':      { target: BACKEND, changeOrigin: true },
      '/admin':      { target: BACKEND, changeOrigin: true },
      '/health':     { target: BACKEND, changeOrigin: true },
      '/docs':       { target: BACKEND, changeOrigin: true },
      '/openapi.json': { target: BACKEND, changeOrigin: true },
    },
  },
})
