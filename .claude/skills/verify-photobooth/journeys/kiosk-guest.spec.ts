import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { expect, test } from '@playwright/test';

import { bootstrap, capture, closeKiosk, evidenceDir, launchKiosk, type Kiosk } from './harness';

test('guest flow from first launch through Done', async () => {
  let kiosk: Kiosk | null = null;
  try {
    kiosk = await launchKiosk({
      GRACE_BOOTH_E2E_COUNTDOWN_MS: 1_500,
      GRACE_BOOTH_E2E_CONFIRM_DELAY_MS: 3_000,
    });
    const { page } = kiosk;

    await expect(page.getByRole('dialog')).toContainText('Create operator passcode');
    await capture(page, 'guest-flow', '01-operator-bootstrap');
    await bootstrap(page);
    await capture(page, 'guest-flow', '02-attract');

    await page.getByRole('button', { name: 'Start photo session' }).click();
    await expect(page.getByTestId('capture-screen')).toBeVisible();
    await capture(page, 'guest-flow', '03-countdown');

    await expect(page.getByTestId('review-screen')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('[data-testid="collage-option-1"] .photo-slot img')).toHaveCount(3);
    await capture(page, 'guest-flow', '04-review');

    await page.getByRole('button', { name: 'Retake all photos' }).click();
    await expect(page.getByTestId('capture-screen')).toBeVisible();
    await capture(page, 'guest-flow', '05-retake-countdown');
    await expect(page.getByTestId('review-screen')).toBeVisible({ timeout: 30_000 });

    await page.getByTestId('collage-option-2').click();
    await expect(page.getByTestId('collage-option-2')).toHaveAttribute('aria-checked', 'true');
    await capture(page, 'guest-flow', '06-review-layout-2');

    await page.getByRole('button', { name: 'Use these photos' }).click();
    await expect(page.getByTestId('processing-screen')).toBeVisible();
    await capture(page, 'guest-flow', '07-processing');

    await expect(page.getByTestId('final-screen')).toBeVisible({ timeout: 45_000 });
    await expect(
      page.getByRole('img', { name: 'QR code for your private photo download' }),
    ).toBeVisible();
    const collage = page
      .getByRole('region', { name: 'Your finished photo' })
      .locator('img')
      .first();
    await expect
      .poll(() =>
        collage.evaluate((image: HTMLImageElement) => (image.complete ? image.naturalWidth : 0)),
      )
      .toBeGreaterThan(0);
    const size = await collage.evaluate((image: HTMLImageElement) => ({
      width: image.naturalWidth,
      height: image.naturalHeight,
    }));
    await capture(page, 'guest-flow', '08-final-qr');
    await writeFile(
      resolve(evidenceDir(), 'guest-flow', '08-final-collage-size.json'),
      JSON.stringify(size),
    );

    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('button', { name: 'Start photo session' })).toBeFocused();
    await capture(page, 'guest-flow', '09-attract-after-done');
  } finally {
    await closeKiosk(kiosk);
  }
});
