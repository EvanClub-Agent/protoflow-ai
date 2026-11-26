import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => ({
  base: mode === 'viewer' ? '/' : './',
  ...(mode === 'website-demo' ? { publicDir: false as const } : {}),
  plugins: [react(), tailwindcss()],
  server: {
    watch: {
      // Desktop autosave replaces the archive via .<name>.pflow.<uuid>.tmp.
      // Neither file should reload the editor when the project lives under the Vite root.
      ignored: [/\.pflow$/i, /\.pflow\.[\da-f-]+\.tmp$/i],
    },
  },
  build:
    mode === 'viewer'
      ? { outDir: 'dist-viewer', reportCompressedSize: false, rollupOptions: { input: 'viewer.html' } }
      : mode === 'website-demo'
        ? { outDir: 'website/demo', emptyOutDir: true, reportCompressedSize: false, rollupOptions: { input: 'demo.html' } }
        : { reportCompressedSize: false, rollupOptions: { input: ['index.html', 'capture.html'] } },
}))
