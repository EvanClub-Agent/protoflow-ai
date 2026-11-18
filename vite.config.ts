import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => ({
  base: mode === 'viewer' ? '/' : './',
  plugins: [react(), tailwindcss()],
  build: mode === 'viewer' ? { outDir: 'dist-viewer', rollupOptions: { input: 'viewer.html' } } : undefined,
}))
