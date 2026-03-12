import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Set base for GitHub Pages deployment under /loyalcore/admin/
  base: process.env.VITE_BASE_URL || '/loyalcore/admin/',
  server: {
    port: 5173,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
})
