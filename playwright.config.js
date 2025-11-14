// Load environment variables before Playwright config is evaluated
require('dotenv').config({ path: process.env.ENV_FILE || '.env' });

function resolveHeadless() {
  if (process.env.HEADLESS) {
    const lowered = process.env.HEADLESS.toLowerCase();
    if (['1', 'true', 'yes'].includes(lowered)) return true;
    if (['0', 'false', 'no'].includes(lowered)) return false;
  }
  return process.env.CI === 'true';
}

/** @type {import('@playwright/test').PlaywrightTestConfig} */
const config = {
  testDir: './tests',
  timeout: 30 * 1000,
  use: {
    channel: 'chrome', // force Google Chrome instead of Chromium build
    headless: resolveHeadless(),
    viewport: { width: 1280, height: 720 },
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  reporter: [['list'], ['html', { open: 'never' }]],
};

module.exports = config;
