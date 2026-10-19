import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: '../app/static',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      // Saat development, API di-proxy ke wrangler dev (worker/ -> `npm run dev`).
      '/api': 'http://127.0.0.1:8787',
    },
  },
})
