import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: './e2e', fullyParallel: false, workers: 1, retries: 0,
  reporter: [['list']],
  use: { baseURL: 'http://127.0.0.1:8790', browserName: 'chromium', trace: 'retain-on-failure' },
  webServer: {
    command: 'node scripts/e2e-server.mjs', url: 'http://127.0.0.1:8790/api/status',
    reuseExistingServer: false, timeout: 60000,
  },
})
