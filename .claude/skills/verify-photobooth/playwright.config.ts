import { resolve } from 'node:path';

import { defineConfig } from '@playwright/test';

const ROOT = resolve(__dirname, '../../..');

process.env.VERIFY_OUT ??= resolve(
  ROOT,
  'artifacts/verify',
  new Date().toISOString().replace(/[:.]/g, '-'),
);

export default defineConfig({
  testDir: './journeys',
  globalTeardown: './journeys/teardown.ts',
  timeout: 180_000,
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  reporter: [['list']],
  outputDir: resolve(process.env.VERIFY_OUT, 'playwright-output'),
  expect: { timeout: 10_000 },
  use: {
    actionTimeout: 10_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'kiosk',
      testMatch: /kiosk-.*\.spec\.ts/,
    },
    {
      name: 'screen2',
      testMatch: /screen2\.spec\.ts/,
      use: {
        baseURL: 'http://127.0.0.1:4174',
        browserName: 'chromium',
        viewport: { width: 1366, height: 768 },
      },
    },
    {
      name: 'public',
      testMatch: /public\.spec\.ts/,
      use: {
        baseURL: 'http://127.0.0.1:4173',
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter @grace-booth/public dev --mode test',
      cwd: ROOT,
      url: 'http://127.0.0.1:4173/photo',
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: 'pnpm --filter @grace-booth/kiosk dev:renderer',
      cwd: ROOT,
      url: 'http://127.0.0.1:4174/?visual=attract',
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
