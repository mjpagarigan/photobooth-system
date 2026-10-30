import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { expect, type Page } from '@playwright/test';
import { _electron as electron, type ElectronApplication } from 'playwright';

const ROOT = resolve(__dirname, '../../../..');
const KIOSK_ROOT = resolve(ROOT, 'apps/kiosk');
const USER_DATA_PREFIX = join(tmpdir(), 'grace-booth-verify-');
export const USER_DATA_LEDGER = 'user-data-dirs.txt';

export const PASSCODE = 'grace-verify-2026';

export type Kiosk = { app: ElectronApplication; page: Page; userData: string };

export function evidenceDir(): string {
  const out = process.env.VERIFY_OUT;
  if (!out) throw new Error('VERIFY_OUT is unset; run through the verify-photobooth config');
  return out;
}

export async function capture(page: Page, feature: string, step: string): Promise<void> {
  const dir = resolve(evidenceDir(), feature);
  await mkdir(dir, { recursive: true });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: resolve(dir, `${step}.png`), fullPage: false });
  const aria = await page.locator('body').ariaSnapshot();
  await writeFile(resolve(dir, `${step}.aria.yml`), aria, 'utf8');
}

export async function launchKiosk(overrides: Record<string, string | number> = {}): Promise<Kiosk> {
  const userData = await mkdtemp(USER_DATA_PREFIX);
  await mkdir(evidenceDir(), { recursive: true });
  await appendFile(resolve(evidenceDir(), USER_DATA_LEDGER), `${userData}\n`, 'utf8');
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
  delete env.ELECTRON_RUN_AS_NODE;
  for (const [key, value] of Object.entries(overrides)) env[key] = String(value);
  env.GRACE_BOOTH_CAMERA_ADAPTER = 'mock';
  env.GRACE_BOOTH_E2E = '1';

  let app: ElectronApplication | null = null;
  try {
    app = await electron.launch({
      args: [KIOSK_ROOT, `--user-data-dir=${userData}`],
      cwd: KIOSK_ROOT,
      env,
      timeout: 60_000,
    });
    const page = await app.firstWindow({ timeout: 60_000 });
    await page.waitForLoadState('domcontentloaded');
    await expect(page.getByTestId('renderer-loading')).toHaveCount(0, { timeout: 30_000 });
    return { app, page, userData };
  } catch (error) {
    app?.process().kill();
    await removeUserData(userData);
    throw error;
  }
}

export async function removeUserData(userData: string): Promise<void> {
  if (!userData.startsWith(USER_DATA_PREFIX)) throw new Error('unsafe_verify_cleanup_target');
  await rm(userData, { force: true, recursive: true, maxRetries: 40, retryDelay: 250 });
}

export async function bootstrap(page: Page): Promise<void> {
  await expect(page.getByRole('dialog')).toContainText('Create operator passcode');
  await page.locator('#operator-passcode').fill(PASSCODE);
  await page.locator('#operator-passcode-confirmation').fill(PASSCODE);
  await page.getByRole('button', { name: 'Save passcode' }).click();
  await expect(page.getByTestId('attract-screen')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

export async function closeKiosk(kiosk: Kiosk | null): Promise<void> {
  if (!kiosk) return;
  try {
    await kiosk.app.close();
  } catch {
    // The process may already be gone after a deliberate exit.
  }
  await removeUserData(kiosk.userData);
}
