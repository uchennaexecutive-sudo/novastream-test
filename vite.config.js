import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return

          if (id.includes('react-player')) return 'player-vendors'
          if (id.includes('hls.js')) return 'hls'
          if (id.includes('framer-motion')) return 'motion'
          if (id.includes('@tauri-apps')) return 'tauri'
          if (id.includes('axios')) return 'network'
          if (id.includes('lucide-react')) return 'icons'
        },
      },
    },
  },
  server: {
    port: 5173,
  },
})
