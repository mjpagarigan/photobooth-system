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

test('guest happy path, repeated retakes, final restoration, and Done reset', async () => {
  const userData = await createUserDataDirectory();
  let kiosk: RunningKiosk | null = null;
  try {
    kiosk = await launchKiosk(userData, { GRACE_BOOTH_E2E_CONFIRM_DELAY_MS: 500 });
    await bootstrap(kiosk.page);
    await startAndWaitForReview(kiosk.page);

    for (let retake = 0; retake < 2; retake += 1) {
      await kiosk.page.getByRole('button', { name: 'Retake all photos' }).click();
      await expect(kiosk.page.getByTestId('capture-screen')).toBeVisible();
      await expect(kiosk.page.getByTestId('review-screen')).toBeVisible({ timeout: 30_000 });
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
    expect(await printHandle(kiosk.app, (handle) => handle.printer.printed.length)).toBe(0);

    await printHandle(kiosk.app, (handle) => handle.printer.setStatus('ready'));
    await expect
      .poll(() => printHandle(kiosk!.app, (handle) => handle.printer.printed.length), {
        timeout: 20_000,
      })
      .toBe(2);
    await expect(kiosk.page.getByTestId('printer-indicator')).toHaveCount(0, { timeout: 10_000 });
    const printed = await printHandle(kiosk.app, (handle) => [...handle.printer.printed]);
    expect(new Set(printed).size).toBe(2);
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

async function startAndWaitForReview(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Start photo session' }).click();
  await expect(page.getByTestId('capture-screen')).toBeVisible();
  await expect(page.getByTestId('review-screen')).toBeVisible({ timeout: 30_000 });
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
