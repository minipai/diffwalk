import { defineConfig } from '@playwright/test'

// Visual regression suite for the report UI. The report's presentation used to
// be asserted as CSS class names and stylesheet text, which passed even when the
// page looked wrong. These tests render real reports in Chromium and compare
// pixels.
//
//   pnpm test:visual          # compare against the committed baselines
//   pnpm test:visual:update   # rewrite baselines after an intentional change
//
// Baselines live in test/visual/__screenshots__/<project> and must be reviewed
// as images before they are committed.
export default defineConfig({
  testDir: 'test/visual',
  testMatch: '**/*.visual.ts',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  expect: {
    // The fixtures and the injected deterministic font make renders byte-for-byte
    // reproductible in CI. The small tolerance absorbs anti-aliasing noise across
    // Chromium builds without hiding real layout or typography regressions.
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.005,
      threshold: 0.2,
      animations: 'disabled',
      caret: 'hide',
    },
  },
  use: {
    deviceScaleFactor: 1,
    colorScheme: 'light',
  },
  snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{arg}{ext}',
  projects: [
    {
      name: 'desktop',
      use: { viewport: { width: 1280, height: 900 } },
    },
    {
      // Between the 900px and 520px breakpoints: the sticky strip without the
      // phone-specific scaling, which the narrow project would otherwise mix in.
      name: 'tablet',
      use: { viewport: { width: 700, height: 900 } },
    },
    {
      name: 'narrow',
      use: { viewport: { width: 480, height: 900 } },
    },
    {
      name: 'phone',
      use: { viewport: { width: 380, height: 800 } },
    },
  ],
})
