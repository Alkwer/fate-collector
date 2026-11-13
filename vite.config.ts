import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execFileSync } from 'node:child_process'

export default defineConfig({
  plugins: [react()],
  define: { __APP_REVISION__: JSON.stringify(execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()) },
  server: { proxy: { '/api': 'http://127.0.0.1:8787' } },
  build: { sourcemap: true },
})
