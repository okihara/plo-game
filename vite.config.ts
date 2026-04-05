import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { execSync } from 'child_process'

const commitHash = process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7)
  ?? (() => {
    try { return execSync('git rev-parse --short HEAD').toString().trim() }
    catch { return 'unknown' }
  })()

export default defineConfig({
  plugins: [react()],
  define: {
    __COMMIT_HASH__: JSON.stringify(commitHash),
  },
  resolve: {
    alias: {
      '@plo/shared': path.resolve(__dirname, 'packages/shared/src'),
    },
  },
})
