import { defineConfig } from '@playwright/test'
import base from './playwright.config'

// This separate native-desktop test launches minimized Chromium with no focus
// emulation or timer overrides. It requires an interactive Windows desktop.
export default defineConfig({
  ...base,
  testIgnore: [], testMatch: 'overlay-background.spec.ts',
})
