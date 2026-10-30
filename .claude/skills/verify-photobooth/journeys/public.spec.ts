import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { expect, test, type Page } from '@playwright/test';

import { capture } from './harness';

const TOKEN = 'A'.repeat(43);
const API_ORIGIN = 'https://api.example.test';
const PHOTO = resolve(__dirname, '../../../../apps/kiosk/resources/mock/photo-1.jpg');

async function blockOtherHosts(page: Page): Promise<void> {
  await page.route('https://**/*', async (route) => {
    if (new URL(route.request().url()).origin === API_ORIGIN) return route.fallback();
    return route.abort('blockedbyclient');
  });
}

test('ready photo resolves, displays, and downloads', async ({ page }) => {
  const jpeg = await readFile(PHOTO);
  const routes: string[] = [];
  await blockOtherHosts(page);
  await page.route(`${API_ORIGIN}/**`, async (route) => {
    const name = new URL(route.request().url()).pathname.split('/').at(-1) ?? '';
    routes.push(name);
    if (name === 'resolve') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'ready',
          expiresAt: '2026-11-29T12:00:00.000Z',
          googleFormsUrl: null,
        }),
      });
    }
    return route.fulfill({ status: 200, contentType: 'image/jpeg', body: jpeg });
  });

  await page.goto(`/photo#${TOKEN}`);
  await expect(page.getByAltText('M.A.T. Photobooth finished event collage')).toBeVisible();
  await capture(page, 'public', '01-ready');

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download photo' }).click();
  expect((await download).suggestedFilename()).toMatch(/\.jpg$/);
  expect(routes).toEqual(['resolve', 'image', 'download']);
  await capture(page, 'public', '02-after-download');
});

test('expired link shows the unavailable state', async ({ page }) => {
  await blockOtherHosts(page);
  await page.route(`${API_ORIGIN}/**`, (route) =>
    route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'not_found',
          message: 'This photo is unavailable or has expired.',
          retryable: false,
        },
      }),
    }),
  );
  await page.goto(`/photo#${TOKEN}`);
  await expect(page.getByText('This photo is unavailable or has expired.')).toBeVisible();
  await capture(page, 'public', '03-expired');
});
