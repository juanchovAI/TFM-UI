import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  }
  ,
  // Dev server proxy: forward /predict/* to the local backend (adjust target if needed)
  server: {
    proxy: {
      '/predict': {
        target: 'https://jw00ccw4occ0sggc88884skc.217.216.91.112.sslip.io',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path // keep path as-is
      }
    }
  }
})
