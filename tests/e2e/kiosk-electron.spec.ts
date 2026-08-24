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

    const collage = kiosk.page.getByRole('img', { name: 'Your finished three-photo strip' });
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
    await expect(kiosk.page.getByRole('heading', { name: 'Upload did not finish' })).toBeVisible();

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
