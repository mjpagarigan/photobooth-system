import { expect, test } from '@playwright/test';

import { PASSCODE, bootstrap, capture, closeKiosk, launchKiosk, type Kiosk } from './harness';

test('operator surfaces: recent photos, camera setup, passcode, admin views', async () => {
  let kiosk: Kiosk | null = null;
  try {
    kiosk = await launchKiosk();
    const { page } = kiosk;
    await bootstrap(page);

    await page.getByRole('button', { name: 'Recent Photos' }).first().click();
    await expect(page.getByTestId('recent-gallery')).toBeVisible();
    await capture(page, 'operator', '01-recent-photos');
    await page.getByRole('button', { name: 'Close recent photos' }).click();
    await expect(page.getByTestId('recent-gallery')).toHaveCount(0);

    await page.getByRole('button', { name: 'Camera Setup' }).click();
    await expect(page.getByRole('dialog')).toContainText('Camera configuration');
    await capture(page, 'operator', '02-camera-setup');
    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    await page.getByRole('button', { name: 'Admin' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await capture(page, 'operator', '03-passcode');
    await page.locator('#operator-passcode').fill(PASSCODE);
    await page.getByRole('button', { name: 'Unlock' }).click();
    await expect(page.getByTestId('admin-shell')).toBeVisible({ timeout: 45_000 });

    await page.getByRole('button', { name: 'Frame editor' }).click();
    await expect(page.getByTestId('frame-editor')).toBeVisible();
    await capture(page, 'operator', '04-frame-editor');

    await page.getByRole('button', { name: 'Recent photos' }).click();
    await capture(page, 'operator', '05-admin-recent-photos');

    await page.getByRole('button', { name: 'Settings & health' }).click();
    await expect(page.getByTestId('admin-settings')).toBeVisible();
    await capture(page, 'operator', '06-settings-health');

    await page.getByRole('button', { name: 'Back to booth' }).click();
    await expect(page.getByTestId('attract-screen')).toBeVisible();
    await capture(page, 'operator', '07-back-to-booth');
  } finally {
    await closeKiosk(kiosk);
  }
});
