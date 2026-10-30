import { expect, test } from '@playwright/test';

import { capture } from './harness';

test('Screen 2 latest-result fixture renders the collage, QR, and timer', async ({ page }) => {
  await page.goto('/?view=qr-station&visual=qr-station-active');
  await expect(page.getByTestId('qr-station-active')).toBeVisible();
  await capture(page, 'screen2', '01-latest-result-1366x768');

  await page.setViewportSize({ width: 1_920, height: 1_080 });
  await capture(page, 'screen2', '02-latest-result-1920x1080');
});
