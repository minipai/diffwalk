import { expect, test } from '@playwright/test'
import { renderReport } from '../../src/report'
import { reportDocument } from './fixtures'

// The report's presentation used to be asserted as CSS class names and
// stylesheet text in report.test.ts, which could pass even when the rendered
// page looked wrong. These tests render the real report shell in Chromium and
// compare pixels at the desktop, narrow, and phone breakpoints.
//
//   pnpm test:visual          # compare against the committed baselines
//   pnpm test:visual:update   # rewrite baselines after an intentional change
//
// Baselines live in test/visual/__screenshots__ and must be reviewed as images
// before they are committed.

// The diff body mounts asynchronously from the multi-megabyte client bundle and
// is covered by report-dom.test.ts. These snapshots cover the report chrome, so
// a stub client keeps the run fast and the image stable.
const stubClient = '/* report client stub */'

// The report uses system font stacks, which differ per host and would make
// snapshots machine-specific. A single bundled family keeps glyph rasterisation
// identical everywhere; a missing family fails loudly instead of quietly
// matching only one machine.
const DETERMINISTIC_FONT = 'DejaVu Sans'

test.describe('report visuals', () => {
  test.beforeEach(async ({ page }) => {
    const html = renderReport(reportDocument(), stubClient)
    await page.setContent(html, { waitUntil: 'load' })
    await page.addStyleTag({
      content: `* { font-family: "${DETERMINISTIC_FONT}", monospace !important; }`,
    })
    // Confirm the deterministic family is actually available before capturing;
    // otherwise Chromium would silently fall back and the snapshot would only
    // match hosts that happen to share the fallback.
    await page
      .waitForFunction(
        (font) => document.fonts.check(`16px "${font}"`),
        DETERMINISTIC_FONT,
        { timeout: 10_000 },
      )
      .catch(() => {
        throw new Error(
          `The deterministic font "${DETERMINISTIC_FONT}" is not installed, so visual snapshots would vary by host.`,
        )
      })
  })

  // Full-page captures cover cover width, typography, and the overall flow at
  // each breakpoint. The desktop rail, narrow sticky strip, and phone scaling are
  // all visible here.
  test('full report', async ({ page }) => {
    await expect(page).toHaveScreenshot('report.png', { fullPage: true })
  })

  // The review map is the rail on desktop and the sticky strip below 900px.
  test('review map', async ({ page }) => {
    await expect(page.locator('nav')).toHaveScreenshot('review-map.png')
  })

  // Keyboard focus styling was previously asserted as the `.fold-all:focus-visible`
  // stylesheet text. Tab reaches the fold control first, so a keyboard-driven focus
  // captures the real ring instead of the rule that draws it.
  test('keyboard focus ring on the fold control', async ({ page }) => {
    await page.keyboard.press('Tab')
    const focused = await page.evaluate(() => document.activeElement?.className ?? '')
    if (!focused.includes('fold-all')) {
      throw new Error(`Expected the fold control to receive focus, got ${focused}`)
    }
    await expect(page.locator('nav')).toHaveScreenshot('focused-control.png')
  })

  // One section captures the title row, prose measure, and the file fold.
  test('section', async ({ page }) => {
    await expect(page.locator('main .section').first()).toHaveScreenshot('section.png')
  })

  // The anchored targets must clear the sticky strip when the rail collapses,
  // which a screenshot cannot measure. This checks the applied offset instead.
  test('narrow anchor offset clears the sticky strip', async ({ page }) => {
    test.skip((page.viewportSize()?.width ?? 0) > 900, 'only meaningful below the 900px breakpoint')
    const offset = await page
      .locator('main .section')
      .first()
      .evaluate((element) => getComputedStyle(element).scrollMarginTop)
    expect(Number.parseFloat(offset)).toBeGreaterThanOrEqual(64)
  })

  test('print report', async ({ page }) => {
    await page.emulateMedia({ media: 'print' })
    await expect(page).toHaveScreenshot('print.png', { fullPage: true })
  })
})
