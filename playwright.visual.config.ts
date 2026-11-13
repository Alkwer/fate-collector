import { defineConfig } from '@playwright/test'
import base from './playwright.config'

// Canonical Windows Chromium images, produced by the Windows CI job.
export default defineConfig({
  ...base, testMatch: 'audit-visual.spec.ts', testIgnore: [], outputDir: 'test-results-visual',
  snapshotPathTemplate: '{testDir}/screenshots/{arg}{ext}',
  use: { ...base.use, locale: 'en-GB', timezoneId: 'UTC', colorScheme: 'dark', reducedMotion: 'reduce' },
  expect: { toHaveScreenshot: { animations: 'disabled', caret: 'hide', threshold: .15, maxDiffPixelRatio: .002 } },
})
