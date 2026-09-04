import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Route } from '@playwright/test';

const TOKEN = 'A'.repeat(43);
const API_ORIGIN = 'https://api.example.test';
const PHOTO_FIXTURE = resolve('apps/kiosk/resources/mock/photo-1.jpg');

type ApiCall = {
  route: 'resolve' | 'image' | 'download';
  token: string;
  url: string;
};

async function installReadyApi(page: Page): Promise<ApiCall[]> {
  const calls: ApiCall[] = [];
  const jpeg = await readFile(PHOTO_FIXTURE);

  await page.route(`${API_ORIGIN}/**`, async (route: Route) => {
    try {
      const request = route.request();
      const routeName = new URL(request.url()).pathname.split('/').at(-1);
      expect(request.method()).toBe('POST');
      expect(request.url()).not.toContain(TOKEN);
      const body = request.postDataJSON() as { token?: unknown };
      expect(Object.keys(body)).toEqual(['token']);
      expect(body.token).toBe(TOKEN);
      if (typeof body.token !== 'string') {
        throw new TypeError('Public photo request omitted its token body');
      }

      if (routeName !== 'resolve' && routeName !== 'image' && routeName !== 'download') {
        await route.abort();
        return;
      }
      calls.push({ route: routeName, token: body.token, url: request.url() });

      if (routeName === 'resolve') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { 'Cache-Control': 'no-store' },
          body: JSON.stringify({
            status: 'ready',
            expiresAt: '2026-09-16T12:00:00.000Z',
            googleFormsUrl: null,
          }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'image/jpeg',
        headers: {
          'Cache-Control': 'no-store',
          'Content-Disposition':
            routeName === 'download'
              ? 'attachment; filename="grace-booth-photo.jpg"'
              : 'inline; filename="grace-booth-photo.jpg"',
        },
        body: jpeg,
      });
    } catch (err) {
      console.error('ERROR IN ROUTE HANDLER:', err);
      await route.abort();
    }
  });

  await page.route('https://**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === API_ORIGIN) {
      await route.fallback();
      return;
    }
    await route.abort('blockedbyclient');
  });

  return calls;
}

test('resolves, displays, and downloads a private photo without leaking the token in URLs', async ({
  page,
}) => {
  const calls = await installReadyApi(page);
  await page.goto(`/photo#${TOKEN}`);

  await expect(page.getByRole('heading', { name: 'Hold on to this moment.' })).toBeVisible();
  await expect(page.getByAltText('M.A.T. Photobooth finished event collage')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Join a ministry' })).toHaveAttribute(
    'href',
    'https://volunteer-management.ccf.org.ph/recruitment/form',
  );
  expect(calls.map((call) => call.route)).toEqual(['resolve', 'image']);

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download photo' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('mat-photobooth-keepsake.jpg');
  expect(calls.map((call) => call.route)).toEqual(['resolve', 'image', 'download']);
  expect(calls.every((call) => call.token === TOKEN && !call.url.includes(TOKEN))).toBe(true);

  await expect(page).toHaveScreenshot('public-ready-desktop.png', {
    animations: 'disabled',
    fullPage: true,
  });

  const accessibility = await new AxeBuilder({ page }).analyze();
  const seriousOrCritical = accessibility.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );
  expect(seriousOrCritical).toEqual([]);
});

test('shows the same friendly unavailable state for an expired or unknown token', async ({
  page,
}) => {
  await page.route(`${API_ORIGIN}/**`, async (route) => {
    expect(route.request().postDataJSON()).toEqual({ token: TOKEN });
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({
        error: {
          code: 'not_found',
          message: 'This photo is unavailable or has expired.',
          retryable: false,
        },
      }),
    });
  });

  await page.goto(`/photo#${TOKEN}`);
  await expect(page.getByRole('heading', { name: 'We could not open this photo.' })).toBeVisible();
  await expect(page.getByText('This photo is unavailable or has expired.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
});

test('rejects a malformed fragment locally and remains usable on a phone viewport', async ({
  page,
}) => {
  let apiRequests = 0;
  await page.route(`${API_ORIGIN}/**`, async (route) => {
    apiRequests += 1;
    await route.abort();
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/photo#not-a-valid-token');

  await expect(page.getByRole('heading', { name: 'We could not open this photo.' })).toBeVisible();
  expect(apiRequests).toBe(0);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await expect(page).toHaveScreenshot('public-unavailable-mobile-390x844.png', {
    animations: 'disabled',
    fullPage: true,
  });
});
