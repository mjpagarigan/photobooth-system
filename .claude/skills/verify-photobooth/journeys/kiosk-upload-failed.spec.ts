import { expect, test } from '@playwright/test';

import { bootstrap, capture, closeKiosk, launchKiosk, type Kiosk } from './harness';

test('upload failure keeps the photo and Finish offline delivers it', async () => {
  let kiosk: Kiosk | null = null;
  try {
    kiosk = await launchKiosk({ GRACE_BOOTH_E2E_UPLOAD_FAILURES: 4 });
    const { page } = kiosk;
    await bootstrap(page);

    await page.getByRole('button', { name: 'Start photo session' }).click();
    await expect(page.getByTestId('review-screen')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Use these photos' }).click();

    await expect(page.getByTestId('processing-screen')).toHaveAttribute(
      'data-state',
      'pending_upload',
      { timeout: 30_000 },
    );
    await capture(page, 'upload-failed', '01-retrying');

    await expect(page.getByTestId('recovery-upload')).toBeVisible({ timeout: 40_000 });
    await expect(page.getByRole('heading', { name: 'Your upload didn’t finish.' })).toBeVisible();
    await capture(page, 'upload-failed', '02-upload-failed');

    const finishOffline = page.getByRole('button', { name: 'Finish offline' });
    await expect(finishOffline).toBeEnabled();
    await finishOffline.click();
    await expect(page.getByTestId('final-screen')).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByRole('img', { name: 'QR code for your private photo download' }),
    ).toBeVisible();
    await capture(page, 'upload-failed', '03-final-offline');
  } finally {
    await closeKiosk(kiosk);
  }
});
