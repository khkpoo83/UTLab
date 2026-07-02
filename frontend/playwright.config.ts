import { defineConfig, devices } from '@playwright/test'

// E2E config for the mobile smoke suite (roadmap Phase 3, P3-6).
// Runs against an already-serving app (default the live nginx on :7432).
// Auth-gated routes need a JWT in AUDIT_TOKEN — the suite skips them if absent.
//
//   E2E_BASE_URL   app origin (default http://localhost:7432)
//   AUDIT_TOKEN    signed JWT stored to localStorage['token'] before each page
//
// Browsers install off the tight root disk:
//   PLAYWRIGHT_BROWSERS_PATH=/data/playwright-browsers npx playwright install chromium
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:7432',
    trace: 'off',
  },
  projects: [
    {
      name: 'mobile-chromium',
      // iPhone 13 viewport/touch metrics, but on Chromium (the only engine we
      // install — see e2e/README.md).
      use: { ...devices['iPhone 13'], browserName: 'chromium' },
    },
  ],
})
