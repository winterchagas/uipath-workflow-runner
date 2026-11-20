import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // The largest chunk is CodeMirror, which is lazy-loaded (src/panels/lazyCodeEditor.ts).
    chunkSizeWarningLimit: 600,
    rolldownOptions: {
      onLog(level, log, handler) {
        // React Flow ships React Compiler output with a "use no memo" directive; dropping it when bundling is harmless.
        if (log.code === 'MODULE_LEVEL_DIRECTIVE' && log.id?.includes('node_modules')) return
        handler(level, log)
      },
    },
  },
})
