import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { expect, test, type Page } from '@playwright/test';
import { _electron as electron, type ElectronApplication } from 'playwright';

const KIOSK_ROOT = resolve('apps/kiosk');
const PASSCODE = 'grace-e2e-2026';

type TestEnvironment = Record<string, string | number | undefined>;
type RunningKiosk = { app: ElectronApplication; page: Page };

test.describe.configure({ mode: 'serial', timeout: 180_000 });

test('camera zoom crops the captured photo while preserving its aspect ratio', async () => {
  const userData = await createUserDataDirectory();
  let kiosk: RunningKiosk | null = null;
  try {
    kiosk = await launchKiosk(userData, { GRACE_BOOTH_E2E_COUNTDOWN_MS: 2_000 });
    const { page } = kiosk;
    await bootstrap(page);

    await page.evaluate(() => {
      const surface = document.createElement('canvas');
      surface.width = 480;
      surface.height = 270;
      const context = surface.getContext('2d');
      if (!context) throw new Error('Canvas unavailable');
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
        value: () => {
          const stream = surface.captureStream();
          requestAnimationFrame(() => {
            context.fillStyle = 'black';
            context.fillRect(0, 0, surface.width, surface.height);
            context.fillStyle = 'lime';
            context.fillRect(65, 0, 350, surface.height);
          });
          return Promise.resolve(stream);
        },
      });
    });

    const openSetup = page.getByRole('button', { name: 'Camera Setup' });
    const setup = page.getByRole('dialog', { name: 'Camera configuration' });
    const zoom = setup.getByRole('slider', { name: 'Camera zoom' });
    await openSetup.click();
    await expect(setup.getByText('Mock camera emulator')).toBeVisible();
    await setup.getByText('Laptop / USB Webcam', { exact: true }).click();
    await expect(zoom).toHaveValue('100');
    await zoom.press('End');
    await expect(zoom).toHaveValue('160');
    await expect(setup.locator('video')).toHaveCSS('scale', '1.6');
    await setup.getByRole('button', { name: 'Apply & Save' }).click();
    await expect(setup).toBeHidden();

    await openSetup.click();
    await expect(zoom).toHaveValue('160');
    await setup.getByRole('button', { name: 'Close' }).click();
    await page.getByRole('button', { name: 'Start photo session' }).click();
    await expect(page.getByTestId('viewfinder-live')).toHaveCSS('scale', '1.6');

    await waitForReviewScreen(page);
    const review = page.getByTestId('review-screen');
    const photoUrl = await review
      .getByRole('img', { name: 'Photo 1', exact: true })
      .evaluate((image: HTMLImageElement) => image.src);
    const jpeg = await kiosk.app.evaluate(async ({ net }, url) => {
      const response = await net.fetch(url);
      if (!response.ok) throw new Error(`Could not load the captured JPEG (${response.status})`);
      return Array.from(new Uint8Array(await response.arrayBuffer()));
    }, photoUrl);
    const captured = await page.evaluate(async (bytes) => {
      const image = await createImageBitmap(
        new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }),
      );
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas unavailable');
      context.drawImage(image, 0, 0);
      const y = Math.floor(canvas.height / 2);
      return {
        width: canvas.width,
        height: canvas.height,
        leftGreen: context.getImageData(5, y, 1, 1).data[1],
        rightGreen: context.getImageData(canvas.width - 6, y, 1, 1).data[1],
      };
    }, jpeg);
    expect(captured).toMatchObject({ width: 480, height: 270 });
    expect(captured.leftGreen).toBeGreaterThan(200);
    expect(captured.rightGreen).toBeGreaterThan(200);
  } finally {
    await closeKiosk(kiosk?.app);
    await removeUserDataDirectory(userData);
  }
});

test('guest happy path, repeated retakes, final restoration, and Done reset', async () => {
  const userData = await createUserDataDirectory();
  let kiosk: RunningKiosk | null = null;
  try {
    kiosk = await launchKiosk(userData, { GRACE_BOOTH_E2E_CONFIRM_DELAY_MS: 500 });
    await bootstrap(kiosk.page);
    await startAndWaitForReview(kiosk.page);

    for (let retake = 0; retake < 2; retake += 1) {
      await kiosk.page.getByRole('button', { name: 'Retake all photos' }).click();
      await expect(
        kiosk.page
          .locator('[data-testid="capture-screen"], [data-testid="shot-review-screen"]')
          .first(),
      ).toBeVisible();
      await waitForReviewScreen(kiosk.page);
    }

    await kiosk.page.getByRole('button', { name: 'Use these photos' }).click();
    await expect(kiosk.page.getByTestId('processing-screen')).toBeVisible();
    await expect(kiosk.page.locator('.qr-panel')).toHaveCount(0);
    await expect(kiosk.page.getByTestId('final-screen')).toBeVisible({ timeout: 45_000 });
    await expect(
      kiosk.page.getByRole('img', { name: 'QR code for your private photo download' }),
    ).toBeVisible();
    await kiosk.page.screenshot({
      path: 'test-results/electron-final-collage-1.png',
      fullPage: false,
    });

    await exitImmediately(kiosk.app);
    kiosk = await launchKiosk(userData, { GRACE_BOOTH_E2E_NOW_MS: Date.now() + 11 * 60_000 });
    await expect(kiosk.page.getByTestId('final-screen')).toBeVisible({ timeout: 30_000 });

    await kiosk.page.getByRole('button', { name: 'Done' }).click();
    const start = kiosk.page.getByRole('button', { name: 'Start photo session' });
    await expect(start).toBeVisible();
    await expect(start).toBeFocused();
  } finally {
    await closeKiosk(kiosk?.app);
    await removeUserDataDirectory(userData);
  }
});

test('the Anniversary selection produces and displays the second collage', async () => {
  const userData = await createUserDataDirectory();
  let kiosk: RunningKiosk | null = null;
  try {
    kiosk = await launchKiosk(userData);
    await bootstrap(kiosk.page);
    await startAndWaitForReview(kiosk.page);
    await kiosk.page.getByTestId('collage-option-2').click();
    await expect(kiosk.page.getByTestId('collage-option-2')).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await kiosk.page.getByRole('button', { name: 'Use these photos' }).click();
    await expect(kiosk.page.getByTestId('final-screen')).toBeVisible({ timeout: 45_000 });

    const collage = kiosk.page
      .getByRole('region', { name: 'Your finished photo' })
      .getByRole('img', { name: 'Your finished photo' });
    await expect(collage).toBeVisible();
    await expect
      .poll(() =>
        collage.evaluate((image: HTMLImageElement) => ({
          height: image.naturalHeight,
          width: image.naturalWidth,
        })),
      )
      .toEqual({ height: 3_600, width: 1_200 });
    await kiosk.page.screenshot({
      path: 'test-results/electron-final-collage-2.png',
      fullPage: false,
    });
  } finally {
    await closeKiosk(kiosk?.app);
    await removeUserDataDirectory(userData);
  }
});

test('three production-length countdowns require at least 15 seconds', async () => {
  const userData = await createUserDataDirectory();
  let kiosk: RunningKiosk | null = null;
  try {
    kiosk = await launchKiosk(userData, {
      GRACE_BOOTH_E2E_COUNTDOWN_MS: 5_000,
      GRACE_BOOTH_E2E_CAMERA_DELAY_MS: 0,
      GRACE_BOOTH_E2E_REVIEW_MODE: 'continuous',
    });
    await bootstrap(kiosk.page);
    const startedAt = Date.now();
    await kiosk.page.getByRole('button', { name: 'Start photo session' }).click();
    await expect(kiosk.page.getByTestId('review-screen')).toBeVisible({ timeout: 45_000 });
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(14_500);
  } finally {
    await closeKiosk(kiosk?.app);
    await removeUserDataDirectory(userData);
  }
});

test('4-slot per-shot capture pauses after each shot, retakes a single slot cleanly, and completes Final QR', async () => {
  const userData = await createUserDataDirectory();
  const countdownMs = 40;
  const noAutoAdvanceHoldMs = countdownMs * 10;
  let kiosk: RunningKiosk | null = null;
  try {
    kiosk = await launchKiosk(userData, { GRACE_BOOTH_E2E_COUNTDOWN_MS: String(countdownMs) });
    const { page } = kiosk;
    await bootstrap(page);

    await unlockAdmin(page);
    await expect(page.getByTestId('frame-editor')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: 'Active for new sessions' })).toBeVisible();

    const slotCountInput = page.getByLabel('Shots / slots');
    await slotCountInput.fill('4');
    await expect(slotCountInput).toHaveValue('4');
    await expect(page.getByRole('tab', { name: 'Slot 4' })).toBeVisible();

    await page.getByRole('button', { name: 'Save configuration' }).click();
    await expect(page.getByText('Frame layout saved.')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('frame-item-1')).toContainText('4 slots');

    await page.getByRole('button', { name: 'Back to booth' }).click();
    await expect(page.getByTestId('attract-screen')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Four photos. One keepsake.')).toBeVisible();

    await page.getByRole('button', { name: 'Start photo session' }).click();
    const shotReview = page.getByTestId('shot-review-screen');
    const shotImage = page.getByTestId('shot-review-image');
    const continueButton = page.getByTestId('shot-review-continue');
    const retakeButton = page.getByTestId('shot-review-retake');

    await expect(shotReview).toBeVisible({ timeout: 15_000 });
    await expect(shotReview).toContainText('Photo 1 of 4.');
    await expect(shotImage).toBeVisible();
    await expect(continueButton).toHaveText('Next photo');

    await page.waitForTimeout(noAutoAdvanceHoldMs);
    await expect(shotReview).toBeVisible();
    await expect(shotReview).toContainText('Photo 1 of 4.');
    await expect(page.getByTestId('review-screen')).toHaveCount(0);

    const shot1Src = await shotImage.getAttribute('src');
    if (!shot1Src) throw new Error('Shot 1 preview image did not render a source URL');

    await continueButton.click();
    await expect(shotReview).toContainText('Photo 2 of 4.', { timeout: 15_000 });
    await expect(shotImage).toBeVisible();
    const shot2InitialSrc = await shotImage.getAttribute('src');
    if (!shot2InitialSrc) throw new Error('Shot 2 preview image did not render a source URL');
    expect(shot2InitialSrc).not.toBe(shot1Src);

    const slot1Thumb = page.locator('[data-testid="shot-review-strip"] [data-slot="1"] img');
    await expect(slot1Thumb).toHaveAttribute('src', shot1Src);

    await retakeButton.click();
    await expect(shotReview).toContainText('Photo 2 of 4.', { timeout: 15_000 });
    await expect(shotImage).not.toHaveAttribute('src', shot2InitialSrc, { timeout: 15_000 });
    await expect(shotImage).toBeVisible();
    const shot2RetakeSrc = await shotImage.getAttribute('src');
    if (!shot2RetakeSrc)
      throw new Error('Retaken Shot 2 preview image did not render a source URL');
    expect(shot2RetakeSrc).not.toBe(shot2InitialSrc);
    await expect(slot1Thumb).toHaveAttribute('src', shot1Src);

    await continueButton.click();
    await expect(shotReview).toContainText('Photo 3 of 4.', { timeout: 15_000 });
    await expect(shotImage).toBeVisible();
    await expect(continueButton).toHaveText('Next photo');

    await continueButton.click();
    await expect(shotReview).toContainText('Photo 4 of 4.', { timeout: 15_000 });
    await expect(shotImage).toBeVisible();
    await expect(continueButton).toHaveText('Review all photos');

    await continueButton.click();
    const review = page.getByTestId('review-screen');
    await expect(review).toBeVisible({ timeout: 15_000 });
    await expect(review).toContainText('All 4 photos captured');
    const photoList = review.getByRole('list', { name: 'Your photos' });
    await expect(photoList).toHaveClass(/review-shots--grid/);
    await expect(photoList.locator('img')).toHaveCount(4);
    await expect(review.getByRole('img', { name: 'Photo 1', exact: true })).toHaveAttribute(
      'src',
      shot1Src,
    );
    await expect(review.getByRole('img', { name: 'Photo 2', exact: true })).toHaveAttribute(
      'src',
      shot2RetakeSrc,
    );

    await page.getByRole('button', { name: 'Use these photos' }).click();
    await expect(page.getByTestId('final-screen')).toBeVisible({ timeout: 45_000 });
    await expect(
      page.getByRole('img', { name: 'QR code for your private photo download' }),
    ).toBeVisible();
  } finally {
    await closeKiosk(kiosk?.app);
    await removeUserDataDirectory(userData);
  }
});

test('default 8-second per-shot countdown runs on every shot and Admin capture settings switch to 1-second continuous mode', async () => {
  const userData = await createUserDataDirectory();
  let kiosk: RunningKiosk | null = null;
  try {
    kiosk = await launchKiosk(userData, {
      GRACE_BOOTH_E2E_COUNTDOWN_MS: 'settings',
      GRACE_BOOTH_E2E_CAMERA_DELAY_MS: 0,
    });
    const { page } = kiosk;
    await bootstrap(page);

    await page.getByRole('button', { name: 'Start photo session' }).click();
    await expect(page.getByTestId('capture-screen')).toBeVisible();
    await expect(page.getByTestId('countdown-value')).toHaveText('8');

    const shotReview = page.getByTestId('shot-review-screen');
    await expect(shotReview).toBeVisible({ timeout: 20_000 });
    await expect(shotReview).toContainText('Photo 1 of 3.');

    await page.getByTestId('shot-review-continue').click();
    await expect(page.getByTestId('capture-screen')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Photo 2 of 3')).toBeVisible();
    await expect(page.getByTestId('countdown-value')).toHaveText('8');

    await page.keyboard.press('Escape');
    await expect(page.getByTestId('cancel-hint')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('attract-screen')).toBeVisible({ timeout: 10_000 });

    await unlockAdmin(page);
    const settingsNavButton = page.getByRole('button', { name: 'Settings & health' });
    await expect(settingsNavButton).toBeVisible({ timeout: 30_000 });
    await settingsNavButton.click();
    await expect(page.getByTestId('admin-settings')).toBeVisible();

    const captureSection = page.locator('#settings-capture');
    await captureSection.scrollIntoViewIfNeeded();
    await expect(captureSection.getByTestId('capture-active-frame')).toContainText('3 slots');
    await expect(captureSection.getByTestId('capture-review-mode')).toHaveText(
      'Review every photo (Recommended)',
    );
    await expect(captureSection.getByTestId('capture-countdown-seconds')).toHaveValue('8');

    await captureSection.getByTestId('capture-review-mode').click();
    await page.getByRole('option', { name: 'Continuous shooting' }).click();
    await expect(captureSection.getByTestId('capture-review-mode')).toHaveText(
      'Continuous shooting',
    );
    await captureSection.getByTestId('capture-countdown-seconds').fill('1');
    await captureSection.getByTestId('save-capture-settings').click();
    await expect(page.getByTestId('admin-settings').getByRole('status')).toContainText(
      'Capture settings saved.',
      { timeout: 30_000 },
    );

    await page.getByRole('button', { name: 'Back to booth' }).click();
    await expect(page.getByTestId('attract-screen')).toBeVisible({ timeout: 10_000 });

    await page.evaluate(() => {
      document.body.dataset.shotReviewObserved = 'false';
      const observer = new MutationObserver(() => {
        if (document.querySelector('[data-testid="shot-review-screen"]')) {
          document.body.dataset.shotReviewObserved = 'true';
        }
        if (document.querySelector('[data-testid="review-screen"]')) {
          observer.disconnect();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    });

    await page.getByRole('button', { name: 'Start photo session' }).click();
    await expect(page.getByTestId('countdown-value')).toHaveText('1');
    await expect(page.getByTestId('review-screen')).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[data-testid="collage-option-1"] .photo-slot img')).toHaveCount(3);
    expect(await page.evaluate(() => document.body.dataset.shotReviewObserved)).toBe('false');
  } finally {
    await closeKiosk(kiosk?.app);
    await removeUserDataDirectory(userData);
  }
});

test('camera failure requires the operator passcode before restart', async () => {
  const userData = await createUserDataDirectory();
  let kiosk: RunningKiosk | null = null;
  try {
    kiosk = await launchKiosk(userData, {
      GRACE_BOOTH_E2E_CAPTURE_FAIL_SHOT: 2,
      GRACE_BOOTH_E2E_COUNTDOWN_MS: 500,
    });
    await bootstrap(kiosk.page);
    await kiosk.page.getByRole('button', { name: 'Start photo session' }).click();
    await expect(kiosk.page.getByTestId('shot-review-screen')).toBeVisible({ timeout: 15_000 });
    await kiosk.page.getByTestId('shot-review-continue').click();
    await expect(kiosk.page.getByTestId('recovery-camera')).toBeVisible({ timeout: 30_000 });

    await kiosk.page.getByRole('button', { name: 'Restart session' }).click();
    await expect(kiosk.page.getByRole('dialog')).toContainText('Operator restart');
    await kiosk.page.locator('#operator-passcode').fill(PASSCODE);
    await kiosk.page.getByRole('button', { name: 'Restart session' }).click();
    await expect(kiosk.page.getByTestId('capture-screen')).toBeVisible({ timeout: 15_000 });
  } finally {
    await closeKiosk(kiosk?.app);
    await removeUserDataDirectory(userData);
  }
});

test('automatic 1/3/8 second retry cycle exhausts and manual retry succeeds', async () => {
  const userData = await createUserDataDirectory();
  let kiosk: RunningKiosk | null = null;
  try {
    kiosk = await launchKiosk(userData, { GRACE_BOOTH_E2E_UPLOAD_FAILURES: 4 });
    await bootstrap(kiosk.page);
    await startAndWaitForReview(kiosk.page);
    const acceptedAt = Date.now();
    await kiosk.page.getByRole('button', { name: 'Use these photos' }).click();
    await expect(kiosk.page.getByTestId('recovery-upload')).toBeVisible({ timeout: 40_000 });
    expect(Date.now() - acceptedAt).toBeGreaterThanOrEqual(11_500);
    await expect(
      kiosk.page.getByRole('heading', { name: 'Your upload didn’t finish.' }),
    ).toBeVisible();

    await kiosk.page.getByRole('button', { name: 'Retry upload' }).click();
    await expect(kiosk.page.getByTestId('final-screen')).toBeVisible({ timeout: 30_000 });
  } finally {
    await closeKiosk(kiosk?.app);
    await removeUserDataDirectory(userData);
  }
});

for (const phase of ['create', 'upload', 'confirm'] as const) {
  test(`restart during ${phase} resumes the durable upload and restores Final`, async () => {
    const userData = await createUserDataDirectory();
    let kiosk: RunningKiosk | null = null;
    try {
      const delayVariable = {
        create: 'GRACE_BOOTH_E2E_CREATE_DELAY_MS',
        upload: 'GRACE_BOOTH_E2E_UPLOAD_DELAY_MS',
        confirm: 'GRACE_BOOTH_E2E_CONFIRM_DELAY_MS',
      }[phase];
      kiosk = await launchKiosk(userData, { [delayVariable]: 10_000 });
      await bootstrap(kiosk.page);
      await startAndWaitForReview(kiosk.page);
      await kiosk.page.getByRole('button', { name: 'Use these photos' }).click();
      await expect(kiosk.page.getByTestId('processing-screen')).toHaveAttribute(
        'data-state',
        'uploading',
        { timeout: 30_000 },
      );
      await kiosk.page.waitForTimeout(500);

      await exitImmediately(kiosk.app);
      kiosk = await launchKiosk(userData);
      await expect(kiosk.page.getByTestId('final-screen')).toBeVisible({ timeout: 45_000 });
    } finally {
      await closeKiosk(kiosk?.app);
      await removeUserDataDirectory(userData);
    }
  });
}

type E2ePrintHandle = {
  printer: {
    setStatus(status: string): void;
    printed: string[];
    pendingDocumentKeys(): string[];
  };
  addLandscape4rFrame(): Promise<string>;
  seedCollageSession(createdAt: number): Promise<string>;
};

async function printHandle<T>(
  app: ElectronApplication,
  action: (handle: E2ePrintHandle, argument: string) => T | Promise<T>,
  argument = '',
): Promise<T> {
  return app.evaluate(
    (_electron, [source, value]) => {
      const handle = (globalThis as unknown as { __graceBoothE2e: E2ePrintHandle }).__graceBoothE2e;
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const run = new Function('handle', 'argument', `return (${source})(handle, argument);`) as (
        handle: E2ePrintHandle,
        argument: string,
      ) => T | Promise<T>;
      return run(handle, value);
    },
    [action.toString(), argument] as const,
  );
}

test('4R print with the printer offline: Proceed, queue, then print once when it is back', async () => {
  const userData = await createUserDataDirectory();
  let kiosk: RunningKiosk | null = null;
  try {
    kiosk = await launchKiosk(userData);
    await bootstrap(kiosk.page);
    await printHandle(kiosk.app, (handle) => handle.addLandscape4rFrame());
    await printHandle(kiosk.app, (handle) => handle.printer.setStatus('offline'));
    await expect(kiosk.page.getByTestId('printer-indicator')).toContainText('Printer offline', {
      timeout: 10_000,
    });

    await startAndWaitForReview(kiosk.page);
    // A 1:3 Frame never offers printing.
    await kiosk.page.getByTestId('collage-option-1').click();
    await expect(kiosk.page.getByTestId('review-print')).toHaveCount(0);

    await kiosk.page.getByRole('radio', { name: /Landscape 4R/ }).click();
    const toggle = kiosk.page.getByRole('switch', { name: 'Print this photo' });
    await expect(toggle).not.toBeChecked();
    await toggle.click();
    await kiosk.page.getByRole('button', { name: 'More copies' }).click();
    await expect(kiosk.page.getByTestId('copy-count')).toHaveValue('2');

    await kiosk.page.getByRole('button', { name: 'Use these photos' }).click();
    await expect(kiosk.page.getByTestId('review-printer-warning')).toContainText('offline');
    await kiosk.page.screenshot({ path: 'test-results/electron-print-proceed.png' });
    await kiosk.page.getByTestId('print-proceed').click();

    await expect(kiosk.page.getByTestId('final-screen')).toBeVisible({ timeout: 45_000 });
    await expect(kiosk.page.getByTestId('printer-indicator')).toContainText('2 copies waiting', {
      timeout: 15_000,
    });
    const sessionPrintStatus = kiosk.page.getByTestId('session-print-status');
    await expect(sessionPrintStatus).toBeVisible({ timeout: 15_000 });
    await expect(sessionPrintStatus).toHaveAttribute('data-print-phase', 'paused');
    await expect(sessionPrintStatus).toContainText('Printing paused');
    expect(await printHandle(kiosk.app, (handle) => handle.printer.printed.length)).toBe(0);

    await printHandle(kiosk.app, (handle) => handle.printer.setStatus('ready'));
    await expect
      .poll(() => printHandle(kiosk!.app, (handle) => handle.printer.printed.length), {
        timeout: 20_000,
      })
      .toBe(2);
    await expect(kiosk.page.getByTestId('printer-indicator')).toHaveCount(0, { timeout: 10_000 });
    await expect(sessionPrintStatus).toHaveAttribute('data-print-phase', 'completed', {
      timeout: 10_000,
    });
    await expect(sessionPrintStatus).toContainText('Print finished');
    const printed = await printHandle(kiosk.app, (handle) => [...handle.printer.printed]);
    expect(new Set(printed).size).toBe(2);
  } finally {
    await closeKiosk(kiosk?.app);
    await removeUserDataDirectory(userData);
  }
});

test('shows session print status when printing is on with a ready printer, and hides it when off', async () => {
  const userData = await createUserDataDirectory();
  let kiosk: RunningKiosk | null = null;
  try {
    kiosk = await launchKiosk(userData);
    await bootstrap(kiosk.page);
    await printHandle(kiosk.app, (handle) => handle.addLandscape4rFrame());

    await startAndWaitForReview(kiosk.page);
    await kiosk.page.getByRole('radio', { name: /Landscape 4R/ }).click();
    await kiosk.page.getByRole('switch', { name: 'Print this photo' }).click();
    await kiosk.page.getByRole('button', { name: 'Use these photos' }).click();

    await expect(kiosk.page.getByTestId('final-screen')).toBeVisible({ timeout: 45_000 });
    const sessionPrintStatus = kiosk.page.getByTestId('session-print-status');
    await expect(sessionPrintStatus).toBeVisible({ timeout: 15_000 });
    await expect(sessionPrintStatus).toHaveAttribute('data-print-phase', 'completed', {
      timeout: 20_000,
    });
    await expect(sessionPrintStatus).toContainText('Print finished');
    await expect(kiosk.page.getByTestId('printer-indicator')).toHaveCount(0);

    await kiosk.page.getByRole('button', { name: 'Done' }).click();
    await expect(kiosk.page.getByTestId('attract-screen')).toBeVisible({ timeout: 15_000 });

    await startAndWaitForReview(kiosk.page);
    await kiosk.page.getByRole('radio', { name: /Landscape 4R/ }).click();
    await expect(kiosk.page.getByRole('switch', { name: 'Print this photo' })).not.toBeChecked();
    await kiosk.page.getByRole('button', { name: 'Use these photos' }).click();

    await expect(kiosk.page.getByTestId('final-screen')).toBeVisible({ timeout: 45_000 });
    await expect(kiosk.page.getByTestId('session-print-status')).toHaveCount(0);
  } finally {
    await closeKiosk(kiosk?.app);
    await removeUserDataDirectory(userData);
  }
});

test('operator cancels a queued copy and reprints from Recent photos', async () => {
  const userData = await createUserDataDirectory();
  let kiosk: RunningKiosk | null = null;
  try {
    kiosk = await launchKiosk(userData);
    await bootstrap(kiosk.page);
    await printHandle(kiosk.app, (handle) => handle.addLandscape4rFrame());
    await printHandle(kiosk.app, (handle) => handle.printer.setStatus('paper_out'));

    await startAndWaitForReview(kiosk.page);
    await kiosk.page.getByRole('radio', { name: /Landscape 4R/ }).click();
    await kiosk.page.getByRole('switch', { name: 'Print this photo' }).click();
    await kiosk.page.getByRole('button', { name: 'Use these photos' }).click();
    await kiosk.page.getByTestId('print-proceed').click();
    await expect(kiosk.page.getByTestId('final-screen')).toBeVisible({ timeout: 45_000 });
    await kiosk.page.getByRole('button', { name: 'Done' }).click();

    // Reprint from Recent photos on the booth.
    await kiosk.page.getByRole('button', { name: 'Recent Photos' }).click();
    await kiosk.page.getByTestId('gallery-item-1').getByRole('button').first().click();
    const reprint = kiosk.page.getByTestId('reprint-control');
    await expect(reprint).toBeVisible();
    await reprint.getByRole('button', { name: 'Reprint' }).click();
    await expect(reprint).toContainText('1 copy added to the print queue.');
    await kiosk.page.keyboard.press('Escape');
    await kiosk.page.keyboard.press('Escape');

    // Cancel the session copy from the operator's print queue before paper is loaded.
    await kiosk.page.getByRole('button', { name: 'Admin' }).click();
    await kiosk.page.locator('#operator-passcode').fill(PASSCODE);
    await kiosk.page.locator('#operator-passcode').press('Enter');
    await kiosk.page.getByRole('button', { name: 'Recent photos' }).click();
    const queue = kiosk.page.getByTestId('print-queue');
    await expect(queue.getByTestId('print-queue-item')).toHaveCount(2, { timeout: 15_000 });
    await queue.getByRole('button', { name: /Cancel session copy 1/ }).click();
    await expect(queue.getByTestId('print-queue-item')).toHaveCount(1);
    await kiosk.page.screenshot({ path: 'test-results/electron-print-queue.png' });

    await printHandle(kiosk.app, (handle) => handle.printer.setStatus('ready'));
    await expect
      .poll(() => printHandle(kiosk!.app, (handle) => handle.printer.printed.length), {
        timeout: 20_000,
      })
      .toBe(1);
    await expect(queue.getByText('Nothing is waiting to print.')).toBeVisible({ timeout: 15_000 });
  } finally {
    await closeKiosk(kiosk?.app);
    await removeUserDataDirectory(userData);
  }
});

test('Recent photos displays all captures from today beyond 20 and excludes prior days', async () => {
  const userData = await createUserDataDirectory();
  let kiosk: RunningKiosk | null = null;
  const yesterdayNoon = new Date(2026, 10, 27, 12, 0, 0, 0).getTime();
  const todayStartMs = new Date(2026, 10, 28, 0, 0, 0, 0).getTime();
  const todayNoon = new Date(2026, 10, 28, 12, 0, 0, 0).getTime();

  try {
    kiosk = await launchKiosk(userData, {
      GRACE_BOOTH_E2E_NOW_MS: yesterdayNoon,
      GRACE_BOOTH_E2E_CAMERA_DELAY_MS: 0,
      GRACE_BOOTH_E2E_REVIEW_MODE: 'continuous',
    });
    await bootstrap(kiosk.page);
    await startAndWaitForReview(kiosk.page);
    await kiosk.page.getByRole('button', { name: 'Use these photos' }).click();
    await expect(kiosk.page.getByTestId('final-screen')).toBeVisible({ timeout: 45_000 });
    await kiosk.page.getByRole('button', { name: 'Done' }).click();
    await closeKiosk(kiosk.app);
    kiosk = null;

    kiosk = await launchKiosk(userData, {
      GRACE_BOOTH_E2E_NOW_MS: todayNoon,
      GRACE_BOOTH_E2E_CAMERA_DELAY_MS: 0,
      GRACE_BOOTH_E2E_REVIEW_MODE: 'continuous',
    });
    const { page, app } = kiosk;
    await expect(page.getByTestId('attract-screen')).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: 'Recent Photos' }).click();
    await expect(page.getByTestId('recent-gallery')).toBeVisible();
    await expect(page.getByText('No photos today yet.')).toBeVisible();
    await expect(page.locator('[data-testid^="gallery-item-"]')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('recent-gallery')).toHaveCount(0);

    for (let index = 0; index < 24; index += 1) {
      await printHandle(
        app,
        (handle, timestamp) => handle.seedCollageSession(Number(timestamp)),
        String(todayStartMs + (index + 1) * 60_000),
      );
    }

    await startAndWaitForReview(page);
    await page.getByRole('button', { name: 'Use these photos' }).click();
    await expect(page.getByTestId('final-screen')).toBeVisible({ timeout: 45_000 });
    await page.getByRole('button', { name: 'Done' }).click();

    await page.getByRole('button', { name: 'Recent Photos' }).click();
    await expect(page.getByTestId('recent-gallery')).toBeVisible();
    await expect(page.locator('[data-testid^="gallery-item-"]')).toHaveCount(25, {
      timeout: 15_000,
    });

    const firstPreview = page.getByTestId('gallery-item-1').locator('.gallery-tile__preview');
    const lastTile = page.getByTestId('gallery-item-25');
    await lastTile.scrollIntoViewIfNeeded();
    const lastPreview = lastTile.locator('.gallery-tile__preview');

    await expect
      .poll(async () => {
        const firstSrc = await firstPreview.getAttribute('src');
        const lastSrc = await lastPreview.getAttribute('src');
        const firstLoaded = await firstPreview.evaluate(
          (element) =>
            element instanceof HTMLImageElement && element.complete && element.naturalWidth > 0,
        );
        const lastLoaded = await lastPreview.evaluate(
          (element) =>
            element instanceof HTMLImageElement && element.complete && element.naturalWidth > 0,
        );
        return { firstSrc, lastSrc, firstLoaded, lastLoaded };
      })
      .toMatchObject({
        firstSrc: expect.stringMatching(/^grace-booth-media:\/\/thumb\//),
        lastSrc: expect.stringMatching(/^grace-booth-media:\/\/thumb\//),
        firstLoaded: true,
        lastLoaded: true,
      });

    await page.getByTestId('gallery-item-1').locator('.gallery-tile__open').click();
    const detailImage = page.locator('.recent-detail-modal__image');
    await expect(detailImage).toBeVisible();
    await expect
      .poll(() =>
        detailImage.evaluate((element) =>
          element instanceof HTMLImageElement && element.complete
            ? { src: element.src, naturalWidth: element.naturalWidth }
            : null,
        ),
      )
      .toMatchObject({
        src: expect.stringMatching(/^grace-booth-media:\/\/asset\//),
        naturalWidth: 1200,
      });

    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('recent-gallery')).toHaveCount(0);

    await unlockAdmin(page);
    await page.getByRole('button', { name: 'Recent photos' }).click();
    await expect(page.locator('[data-testid^="gallery-item-"]')).toHaveCount(25, {
      timeout: 15_000,
    });
    await page.getByRole('button', { name: 'Refresh' }).click();
    await expect(page.locator('[data-testid^="gallery-item-"]')).toHaveCount(25);
  } finally {
    await closeKiosk(kiosk?.app);
    await removeUserDataDirectory(userData);
  }
});

async function launchKiosk(
  userDataDirectory: string,
  overrides: TestEnvironment = {},
): Promise<RunningKiosk> {
  const environment = testEnvironment(overrides);
  const app = await electron.launch({
    args: [KIOSK_ROOT, `--user-data-dir=${userDataDirectory}`],
    cwd: KIOSK_ROOT,
    env: environment,
    timeout: 60_000,
  });
  const page = await app.firstWindow({ timeout: 60_000 });
  await page.waitForLoadState('domcontentloaded');
  await expect(page.getByTestId('renderer-loading')).toHaveCount(0, { timeout: 30_000 });
  return { app, page };
}

function testEnvironment(overrides: TestEnvironment): Record<string, string> {
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  delete environment.ELECTRON_RUN_AS_NODE;
  for (const [key, value] of Object.entries(overrides)) {
    if (typeof value === 'string') environment[key] = value;
    if (typeof value === 'number') environment[key] = value.toString();
  }
  environment.GRACE_BOOTH_CAMERA_ADAPTER = 'mock';
  environment.GRACE_BOOTH_E2E = '1';
  return environment;
}

async function bootstrap(page: Page): Promise<void> {
  await expect(page.getByRole('dialog')).toContainText('Create operator passcode');
  await page.locator('#operator-passcode').fill(PASSCODE);
  await page.locator('#operator-passcode-confirmation').fill(PASSCODE);
  await page.getByRole('button', { name: 'Save passcode' }).click();
  await expect(page.getByTestId('attract-screen')).toBeVisible({ timeout: 15_000 });
}

async function unlockAdmin(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Admin' }).click();
  await page.locator('#operator-passcode').fill(PASSCODE);
  await page.locator('#operator-passcode').press('Enter');
}

async function waitForReviewScreen(page: Page): Promise<void> {
  const review = page.getByTestId('review-screen');
  const anyTarget = page.locator(
    '[data-testid="shot-review-screen"], [data-testid="review-screen"]',
  );

  for (let step = 0; step < 12; step += 1) {
    await anyTarget.first().waitFor({ state: 'visible', timeout: 30_000 });
    if (await review.isVisible()) {
      return;
    }
    await expect(page.getByTestId('shot-review-image')).toBeVisible();
    const currentSlot = await page
      .locator('[data-testid="shot-review-strip"] [aria-current="step"]')
      .getAttribute('data-slot');
    await page.getByTestId('shot-review-continue').click();
    await expect
      .poll(
        () =>
          page.evaluate((slotBefore) => {
            if (document.querySelector('[data-testid="review-screen"]')) return 'review';
            const active = document.querySelector(
              '[data-testid="shot-review-strip"] [aria-current="step"]',
            );
            if (!active) return 'capturing';
            return active.getAttribute('data-slot') !== slotBefore ? 'next-shot' : 'waiting';
          }, currentSlot),
        { timeout: 30_000 },
      )
      .not.toBe('waiting');
  }

  await expect(review).toBeVisible({ timeout: 30_000 });
}

async function startAndWaitForReview(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Start photo session' }).click();
  await expect(
    page
      .locator(
        '[data-testid="capture-screen"], [data-testid="shot-review-screen"], [data-testid="review-screen"]',
      )
      .first(),
  ).toBeVisible();
  await waitForReviewScreen(page);
  await expect(page.locator('[data-testid="collage-option-1"] .photo-slot img')).toHaveCount(3);
  await expect(page.locator('[data-testid="collage-option-2"] .photo-slot img')).toHaveCount(3);
}

async function exitImmediately(app: ElectronApplication): Promise<void> {
  const closed = new Promise<void>((resolveClosed) => app.once('close', resolveClosed));
  await app.evaluate(({ app: electronApp }) => electronApp.exit(0));
  await closed;
}

async function closeKiosk(app: ElectronApplication | undefined): Promise<void> {
  if (!app) return;
  try {
    await app.close();
  } catch {
    // The restart cases deliberately terminate the prior process immediately.
  }
}

async function createUserDataDirectory(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'grace-booth-e2e-'));
}

async function removeUserDataDirectory(directory: string): Promise<void> {
  const expectedPrefix = join(tmpdir(), 'grace-booth-e2e-');
  if (!directory.startsWith(expectedPrefix)) throw new Error('unsafe_e2e_cleanup_target');
  await rm(directory, { force: true, recursive: true, maxRetries: 40, retryDelay: 250 });
}
