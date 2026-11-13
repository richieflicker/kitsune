// Config for the bundled mock Storybook. Real projects point `dir` at `storybook-static`.
export default {
  storybook: { dir: './mock-storybook' },
  viewports: [
    { name: 'desktop', width: 1280, height: 720 },
    { name: 'mobile', width: 390, height: 844 },
  ],
  // Add 'firefox' and 'webkit' after `npx playwright install firefox webkit`.
  // Each browser keeps its own baselines.
  browsers: ['chromium'],
  threshold: 0.05,
  maxDiffPixels: 0,
  dataDir: './.kitsune',
  // Uses Playwright's own Chromium (`npx playwright install chromium`).
  // To use an installed Chrome instead, set KITSUNE_BROWSER_PATH=/path/to/chrome before running.
  browser: process.env.KITSUNE_BROWSER_PATH ? { executablePath: process.env.KITSUNE_BROWSER_PATH } : {},
};
