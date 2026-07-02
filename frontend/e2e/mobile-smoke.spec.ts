import { test, expect, Page } from '@playwright/test'

// Mobile regression smoke (roadmap Phase 3, P3-6).
// Guards the mobile work (P3-M single-column Home, responsive grids) and the
// god-component refactors (P3-3): every authed route must render at a phone
// width with NO horizontal page overflow and NO console/page errors.
//
// Run against a serving app with a JWT:
//   E2E_BASE_URL=http://localhost:7432 AUDIT_TOKEN=<jwt> \
//     PLAYWRIGHT_BROWSERS_PATH=/data/playwright-browsers npm run test:e2e

const TOKEN = process.env.AUDIT_TOKEN

const ROUTES = [
  '/home', '/portfolio', '/planner', '/news', '/recommend',
  '/analytics', '/watchlist', '/calendar', '/settings', '/blog', '/memo',
]

// Collect console/page errors per page; return a getter.
function trackErrors(page: Page): () => string[] {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`)
  })
  return () => errors
}

test.describe('mobile smoke @ phone width', () => {
  test.skip(!TOKEN, 'AUDIT_TOKEN not set — skipping auth-gated mobile smoke')

  test.beforeEach(async ({ context }) => {
    await context.addInitScript((tok) => {
      try {
        localStorage.setItem('token', tok as string)
      } catch {
        /* ignore */
      }
    }, TOKEN)
  })

  for (const route of ROUTES) {
    test(`no horizontal overflow or errors: ${route}`, async ({ page }) => {
      const getErrors = trackErrors(page)
      await page.goto(route, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(2000)

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      )
      expect(overflow, `${route} has ${overflow}px horizontal overflow`).toBeLessThanOrEqual(1)

      // No console errors surfaced during load.
      expect(getErrors(), `${route} console/page errors`).toEqual([])
    })
  }
})
