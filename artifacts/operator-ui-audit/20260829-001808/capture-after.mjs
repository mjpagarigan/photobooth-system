/* eslint-disable */
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = 'C:/Users/padil/mj/photobooth-system/artifacts/operator-ui-audit/20260829-001808';
const output = join(root, 'screenshots', 'after');
const baseUrl = 'http://127.0.0.1:4174';
const viewports = [
  { width: 1280, height: 720 },
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
  { width: 768, height: 1024 },
];
const fixtures = [
  { visual: 'admin-frame', surface: 'frame-editor', state: 'default', interaction: 'viewport' },
  { visual: 'admin-frame-error', surface: 'frame-editor', state: 'save-error', interaction: 'viewport' },
  { visual: 'admin-gallery', surface: 'recent-photos', state: 'populated', interaction: 'viewport' },
  { visual: 'admin-gallery-empty', surface: 'recent-photos', state: 'empty', interaction: 'default' },
  { visual: 'admin-settings', surface: 'settings-health', state: 'default', interaction: 'viewport' },
  { visual: 'admin-settings-degraded', surface: 'settings-health', state: 'degraded', interaction: 'viewport' },
  { visual: 'admin-settings-error', surface: 'settings-health', state: 'save-error', interaction: 'viewport' },
  { visual: 'operator-login', surface: 'operator-access', state: 'login', interaction: 'default' },
  { visual: 'operator-bootstrap', surface: 'operator-access', state: 'bootstrap', interaction: 'nondismissible' },
  { visual: 'operator-restart', surface: 'operator-access', state: 'restart', interaction: 'busy' },
  { visual: 'camera-setup', surface: 'camera-setup', state: 'open', interaction: 'default' },
];

await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];

for (const viewport of viewports) {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  for (const fixture of fixtures) {
    const page = await context.newPage();
    const externalRequests = [];
    const consoleErrors = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.origin !== baseUrl) externalRequests.push(request.url());
    });
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    await page.goto(`${baseUrl}/?visual=${fixture.visual}`, { waitUntil: 'load' });
    await page.locator('main, [role="dialog"], .admin-shell').first().waitFor({ state: 'visible' });
    if (fixture.visual.startsWith('admin-')) {
      await page.locator('.admin-shell').waitFor({ state: 'visible' });
    }
    if (fixture.visual.startsWith('operator-') || fixture.visual === 'camera-setup') {
      await page.getByRole('dialog').waitFor({ state: 'visible' });
    }
    await page.waitForTimeout(300);
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(
        [...document.images].map((image) =>
          image.complete
            ? Promise.resolve()
            : new Promise((resolve) => {
                image.addEventListener('load', resolve, { once: true });
                image.addEventListener('error', resolve, { once: true });
              }),
        ),
      );
    });
    await page.addStyleTag({
      content: `*,*::before,*::after{animation-delay:0s!important;animation-duration:0s!important;caret-color:transparent!important;transition-delay:0s!important;transition-duration:0s!important}`,
    });

    const axe = await new AxeBuilder({ page }).analyze();
    const geometry = await page.evaluate(() => {
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const visible = (element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
      };
      const controls = [...document.querySelectorAll('button,input,select,textarea,[role="button"],[role="tab"],[role="radio"],[role="switch"]')]
        .filter(visible)
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            label: element.getAttribute('aria-label') || element.textContent?.trim().slice(0, 80) || element.tagName,
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          };
        });
      const bounded = [...document.querySelectorAll('main,[role="dialog"],[role="listbox"],button,input,select,textarea')]
        .filter(visible)
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return {
            node: element.getAttribute('role') || element.tagName.toLowerCase(),
            label: element.getAttribute('aria-label') || element.textContent?.trim().slice(0, 60) || '',
            left: Math.round(rect.left),
            top: Math.round(rect.top),
            right: Math.round(rect.right),
            bottom: Math.round(rect.bottom),
          };
        });
      return {
        viewportWidth,
        viewportHeight,
        bodyWidth: document.body.scrollWidth,
        documentWidth: document.documentElement.scrollWidth,
        bodyHeight: document.body.scrollHeight,
        documentHeight: document.documentElement.scrollHeight,
        horizontalOverflow: Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) > viewportWidth,
        undersizedControls: controls.filter(({ width, height }) => width < 44 || height < 44),
        outOfViewport: bounded.filter(({ left, top, right, bottom }) => left < 0 || top < 0 || right > viewportWidth || bottom > viewportHeight),
      };
    });

    const basename = `${fixture.surface}--${fixture.state}--${fixture.interaction}--${viewport.width}x${viewport.height}.png`;
    await page.screenshot({ path: join(output, basename), animations: 'disabled', fullPage: false });
    results.push({
      ...fixture,
      viewport,
      screenshot: basename,
      seriousOrCritical: axe.violations
        .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
        .map(({ id, impact, help, nodes }) => ({ id, impact, help, nodes: nodes.length })),
      moderate: axe.violations
        .filter((violation) => violation.impact === 'moderate')
        .map(({ id, help, nodes }) => ({ id, help, nodes: nodes.length })),
      geometry,
      externalRequests,
      consoleErrors,
    });

    if (fixture.visual === 'admin-settings' && viewport.width === 1280) {
      await page.locator('.settings-scroll').evaluate((element) => element.scrollTo(0, element.scrollHeight));
      await page.screenshot({
        path: join(output, 'settings-health--default--bottom--1280x720.png'),
        animations: 'disabled',
        fullPage: false,
      });
    }
    await page.close();
  }
  await context.close();
}

await writeFile(join(root, 'after-results.json'), `${JSON.stringify(results, null, 2)}\n`);

const interactionContext = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const interactionPage = await interactionContext.newPage();
const interactions = {};

await interactionPage.goto(`${baseUrl}/?visual=admin-frame`);
const slotOne = interactionPage.getByRole('tab', { name: 'Slot 1' });
await slotOne.focus();
await slotOne.press('ArrowRight');
interactions.frameTabs = {
  selectedAfterArrow: await interactionPage.getByRole('tab', { name: 'Slot 2' }).getAttribute('aria-selected'),
};
const deleteButton = interactionPage.getByRole('button', { name: /Delete M\.A\.T\./ });
await deleteButton.focus();
await deleteButton.click();
interactions.frameDelete = {
  dialogVisible: await interactionPage.getByRole('alertdialog').isVisible(),
};
await interactionPage.getByRole('alertdialog').press('Escape');
await interactionPage.waitForTimeout(500);
interactions.frameDelete.focusRestored = await deleteButton.evaluate((element) => document.activeElement === element);

await interactionPage.goto(`${baseUrl}/?visual=admin-gallery`);
const firstPreview = interactionPage.getByRole('button', { name: /View photo strip captured/ }).first();
await firstPreview.focus();
await firstPreview.click();
interactions.galleryDetail = { dialogVisible: await interactionPage.getByRole('dialog').isVisible() };
await interactionPage.getByRole('dialog').press('Escape');
interactions.galleryDetail.focusRestored = await firstPreview.evaluate((element) => document.activeElement === element);

await interactionPage.goto(`${baseUrl}/?visual=admin-settings`);
const overviewTab = interactionPage.getByRole('tab', { name: 'Overview' });
await overviewTab.focus();
await overviewTab.press('ArrowRight');
interactions.settingsTabs = {
  selectedAfterArrow: await interactionPage.getByRole('tab', { name: 'Network' }).getAttribute('aria-selected'),
};
await interactionPage.getByRole('switch').click({ force: true });
await interactionPage.getByLabel('Port').fill('80');
await interactionPage.getByRole('button', { name: 'Save settings' }).click();
interactions.settingsValidation = {
  alert: await interactionPage.getByRole('alert').innerText(),
  invalid: await interactionPage.getByLabel('Port').getAttribute('aria-invalid'),
};

await interactionPage.goto(`${baseUrl}/?visual=operator-bootstrap`);
await interactionPage.getByRole('dialog').press('Escape');
interactions.bootstrap = {
  remainsOpenAfterEscape: await interactionPage.getByRole('dialog').isVisible(),
  cancelCount: await interactionPage.getByRole('button', { name: /cancel|close/i }).count(),
};
await interactionPage.getByRole('button', { name: 'Show passcode' }).click();
interactions.bootstrap.passwordTypeAfterToggle = await interactionPage
  .getByLabel('Passcode', { exact: true })
  .getAttribute('type');

await interactionPage.goto(`${baseUrl}/?visual=camera-setup`);
await interactionPage.getByRole('dialog').waitFor({ state: 'visible' });
await interactionPage.waitForTimeout(300);
await interactionPage.getByRole('combobox', { name: 'Active device node' }).click();
await interactionPage.getByRole('listbox').waitFor({ state: 'visible' });
interactions.cameraSelect = {
  optionCount: await interactionPage.getByRole('option').count(),
  listboxVisible: await interactionPage.getByRole('listbox').isVisible(),
};
await interactionPage.getByRole('combobox', { name: 'Active device node' }).press('Escape');

await writeFile(join(root, 'after-results.json'), `${JSON.stringify(results, null, 2)}\n`);
await writeFile(join(root, 'after-interactions.json'), `${JSON.stringify(interactions, null, 2)}\n`);
await interactionContext.close();
await browser.close();

console.log(`Captured ${results.length} states with ${results.reduce((sum, result) => sum + result.seriousOrCritical.length, 0)} serious/critical axe findings.`);
