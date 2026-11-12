import { defineConfig } from '@playwright/test'
import base from './playwright.config'
export default defineConfig({
  ...base,
  testMatch: ['compatibility.spec.ts', 'symbol-reports.spec.ts', 'helper-symbol-reports.spec.ts'],
  outputDir: 'test-results-compat',
  projects: [
    { name: 'Edge', use: { browserName: 'chromium', channel: 'msedge' } },
    { name: 'Firefox', use: { browserName: 'firefox' } },
  ],
})
