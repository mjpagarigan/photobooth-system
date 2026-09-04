import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const STATES = [
  'attract',
  'countdown',
  'review',
  'processing',
  'uploading-backoff',
  'final',
  'recovery-camera',
  'recovery-upload',
  'recovery-interrupted',
  'admin-frame',
  'admin-settings',
] as const;

const VIEWPORTS = [
  { label: '1366x768', width: 1366, height: 768 },
  { label: '1280x720', width: 1280, height: 720 },
] as const;

const SECONDARY_STATES = [
  'admin-frame-error',
  'admin-gallery',
  'admin-gallery-empty',
  'admin-settings-degraded',
  'admin-settings-error',
  'operator-login',
  'operator-bootstrap',
  'operator-restart',
  'camera-setup',
] as const;

for (const viewport of VIEWPORTS) {
  for (const state of STATES) {
    test(`${state} fits and remains accessible at ${viewport.label}`, async ({ page }) => {
      if (state === 'processing' || state === 'uploading-backoff') {
        await page.emulateMedia({ reducedMotion: 'reduce' });
      }
      const externalRequests: string[] = [];
      page.on('request', (request) => {
        const url = new URL(request.url());
        if (url.origin !== 'http://127.0.0.1:4174') {
          externalRequests.push(request.url());
        }
      });

      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(`/?visual=${state}`);
      await expect(page.locator('main, .admin-shell').first()).toBeVisible();
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all(
          [...document.images].map((image) =>
            image.complete
              ? Promise.resolve()
              : new Promise<void>((resolveImage) => {
                  image.addEventListener('load', () => resolveImage(), { once: true });
                  image.addEventListener('error', () => resolveImage(), { once: true });
                }),
          ),
        );
      });
      if ((await page.getByTestId('processing-animation').count()) > 0) {
        await expect(page.locator('.processing-animation__fallback')).toBeVisible();
      }
      await page.addStyleTag({
        content: `
          *, *::before, *::after {
            animation-delay: 0s !important;
            animation-duration: 0s !important;
            caret-color: transparent !important;
            transition-delay: 0s !important;
            transition-duration: 0s !important;
          }
        `,
      });

      const layout = await page.evaluate(() => ({
        bodyHeight: document.body.scrollHeight,
        bodyWidth: document.body.scrollWidth,
        documentHeight: document.documentElement.scrollHeight,
        documentWidth: document.documentElement.scrollWidth,
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth,
      }));
      expect(layout.bodyWidth).toBeLessThanOrEqual(layout.viewportWidth);
      expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
      expect(layout.bodyHeight).toBeLessThanOrEqual(layout.viewportHeight);
      expect(layout.documentHeight).toBeLessThanOrEqual(layout.viewportHeight);
      expect(externalRequests).toEqual([]);

      if (state === 'final') {
        const qrMetrics = await page
          .getByRole('img', { name: 'QR code for your private photo download' })
          .evaluate((image: HTMLImageElement) => {
            const rect = image.getBoundingClientRect();
            return {
              height: rect.height,
              naturalHeight: image.naturalHeight,
              naturalWidth: image.naturalWidth,
              unobstructed:
                document.elementFromPoint(
                  rect.left + rect.width / 2,
                  rect.top + rect.height / 2,
                ) === image,
              width: rect.width,
            };
          });
        expect(qrMetrics.width).toBeGreaterThanOrEqual(180);
        expect(qrMetrics.height).toBe(qrMetrics.width);
        expect(qrMetrics.naturalWidth).toBeGreaterThanOrEqual(300);
        expect(qrMetrics.naturalHeight).toBe(qrMetrics.naturalWidth);
        expect(qrMetrics.unobstructed).toBe(true);
      }

      const accessibility = await new AxeBuilder({ page }).analyze();
      const seriousOrCritical = accessibility.violations.filter(
        (violation) => violation.impact === 'serious' || violation.impact === 'critical',
      );
      expect(seriousOrCritical).toEqual([]);

      await expect(page).toHaveScreenshot(`${state}-${viewport.label}.png`, {
        animations: 'disabled',
        fullPage: false,
      });
    });
  }

  test(`review Collage 2 fits at ${viewport.label}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/?visual=review');
    await page.getByTestId('collage-option-2').click();
    await expect(page.getByTestId('collage-option-2')).toHaveAttribute('aria-checked', 'true');
    await waitForVisualAssets(page);
    await expectNoPageOverflow(page);
    await expect(page).toHaveScreenshot(`review-collage-2-${viewport.label}.png`, {
      animations: 'disabled',
      fullPage: false,
    });
  });

  test(`Operator Frame Editor Collage 2 fits at ${viewport.label}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/?visual=admin-frame');
    const frameItem2 = page.getByTestId('frame-item-2');
    await frameItem2.click();
    await expect(page.locator('.frame-library__item').nth(1)).toHaveClass(/is-selected/);
    await waitForVisualAssets(page);
    await expectNoPageOverflow(page);
    await expect(page).toHaveScreenshot(`admin-frame-collage-2-${viewport.label}.png`, {
      animations: 'disabled',
      fullPage: false,
    });
  });
}

for (const state of SECONDARY_STATES) {
  test(`${state} remains accessible at 1366x768`, async ({ page }) => {
    await page.setViewportSize({ width: 1_366, height: 768 });
    await page.goto(`/?visual=${state}`);
    await expect(page.locator('main, .admin-shell, [role="dialog"]').first()).toBeVisible();
    await waitForVisualAssets(page);
    await expectNoPageOverflow(page);

    const accessibility = await new AxeBuilder({ page }).analyze();
    const seriousOrCritical = accessibility.violations.filter(
      (violation) => violation.impact === 'serious' || violation.impact === 'critical',
    );
    expect(seriousOrCritical).toEqual([]);

    await expect(page).toHaveScreenshot(`${state}-1366x768.png`, {
      animations: 'disabled',
      fullPage: false,
    });
  });
}

test('QR station active queue fits at 1920x1080', async ({ page }) => {
  await page.setViewportSize({ width: 1_920, height: 1_080 });
  await page.goto('/?view=qr-station&visual=qr-station-active');
  await expect(page.getByTestId('qr-station-active')).toBeVisible();
  await expect(
    page.getByRole('heading', {
      name: 'Please scan the QR Code beside to download the photo',
    }),
  ).toBeVisible();
  await expect(page.getByText(/Next photo replaces this in \d+s/)).toBeVisible();
  await waitForVisualAssets(page);
  await expectNoPageOverflow(page);

  const qrSize = await page
    .getByRole('img', { name: 'QR code for photo download' })
    .evaluate((image) => image.getBoundingClientRect().width);
  expect(qrSize).toBeGreaterThanOrEqual(180);

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(
    accessibility.violations.filter(
      (violation) => violation.impact === 'serious' || violation.impact === 'critical',
    ),
  ).toEqual([]);

  await expect(page).toHaveScreenshot('qr-station-active-1920x1080.png', {
    animations: 'disabled',
    fullPage: false,
    maxDiffPixelRatio: 0.02,
  });
});

test('forced colors preserve visible focus and status', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await page.setViewportSize({ width: 1_366, height: 768 });
  await page.goto('/?visual=admin-settings-degraded');
  const firstNavigationItem = page.getByRole('button', { name: 'Frame editor' });
  await firstNavigationItem.focus();
  await expect(firstNavigationItem).toBeFocused();
  const outline = await firstNavigationItem.evaluate(
    (element) => getComputedStyle(element).outlineStyle,
  );
  expect(outline).not.toBe('none');
  await expect(page.getByText('Degraded', { exact: true })).toBeVisible();
  await expect(page).toHaveScreenshot('admin-settings-forced-colors-1366x768.png', {
    animations: 'disabled',
    fullPage: false,
  });
});

test('operator settings preserve spacing, desktop upload columns, and tab scrolling', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1_366, height: 768 });
  await page.goto('/?visual=admin-settings');

  const overviewPanel = page.getByRole('tabpanel', { name: 'Overview' });
  await expect(overviewPanel).toBeVisible();
  expect(
    await overviewPanel.evaluate((element) => Number.parseFloat(getComputedStyle(element).gap)),
  ).toBeGreaterThanOrEqual(16);

  await page.getByRole('tab', { name: 'Upload queue' }).click();
  const uploadList = page.locator('.upload-list');
  await expect(uploadList).toBeVisible();
  const uploadLayout = await uploadList.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      columns: style.gridTemplateColumns.split(' ').filter(Boolean).length,
      gap: Number.parseFloat(style.gap),
    };
  });
  expect(uploadLayout.columns).toBeGreaterThanOrEqual(2);
  expect(uploadLayout.gap).toBeGreaterThanOrEqual(12);
  await expect(page).toHaveScreenshot('admin-upload-queue-spaced-1366x768.png', {
    animations: 'disabled',
    fullPage: false,
  });

  for (const tabName of ['Google Photos', 'Security & Cloud'] as const) {
    await page.getByRole('tab', { name: tabName }).click();
    const panel = page.getByRole('tabpanel', { name: tabName });
    await expect(panel).toBeVisible();
    const scrollResult = await page.locator('.settings-scroll').evaluate((scrollOwner) => {
      const style = getComputedStyle(scrollOwner);
      const canScroll =
        /(auto|scroll)/u.test(style.overflowY) &&
        scrollOwner.scrollHeight > scrollOwner.clientHeight;
      scrollOwner.scrollTop = Math.min(120, scrollOwner.scrollHeight - scrollOwner.clientHeight);
      return { canScroll, scrollTop: scrollOwner.scrollTop };
    });
    expect(scrollResult.canScroll).toBe(true);
    expect(scrollResult.scrollTop).toBeGreaterThan(0);
  }

  await expect(page).toHaveScreenshot('admin-security-scroll-1366x768.png', {
    animations: 'disabled',
    fullPage: false,
  });
});

test('recent photos dialog stays within the kiosk viewport and owns its scroll', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1_366, height: 768 });
  await page.goto('/?visual=recent-gallery');
  await page.getByRole('button', { name: 'Recent Photos' }).click();
  const dialog = page.getByTestId('recent-gallery');
  await expect(dialog).toBeVisible();
  const metrics = await dialog.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const grid = element.querySelector<HTMLElement>('.recent-gallery__grid');
    return {
      bottom: rect.bottom,
      gridOverflowY: grid ? getComputedStyle(grid).overflowY : null,
      height: rect.height,
      right: rect.right,
    };
  });
  expect(metrics.right).toBeLessThanOrEqual(1_350);
  expect(metrics.bottom).toBeLessThanOrEqual(752);
  expect(metrics.height).toBeLessThanOrEqual(736);
  expect(metrics.gridOverflowY).toBe('auto');
  await expect(page).toHaveScreenshot('recent-photos-bounded-1366x768.png', {
    animations: 'disabled',
    fullPage: false,
  });
});

test('frame inspector groups preserve Fluent spacing', async ({ page }) => {
  await page.setViewportSize({ width: 1_366, height: 768 });
  await page.goto('/?visual=admin-frame');
  const panel = page.locator('.slot-tabs [role="tabpanel"]');
  const radioGroup = panel.getByRole('radiogroup', { name: 'Crop behavior' });
  await expect(panel).toBeVisible();
  await expect(radioGroup).toBeVisible();
  expect(
    await panel.evaluate((element) => Number.parseFloat(getComputedStyle(element).gap)),
  ).toBeGreaterThanOrEqual(16);
  expect(
    await radioGroup.evaluate((element) => Number.parseFloat(getComputedStyle(element).gap)),
  ).toBeGreaterThanOrEqual(8);
  await expect(page).toHaveScreenshot('admin-frame-inspector-spaced-1366x768.png', {
    animations: 'disabled',
    fullPage: false,
  });
});

test('reduced motion removes cosmetic rotation and shutter flash', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1_366, height: 768 });
  await page.goto('/?visual=processing');
  await expect(page.getByTestId('processing-screen')).toBeVisible();
  await expect(page.locator('.processing-animation__fallback')).toBeVisible();
  await expect(page.locator('.processing-animation svg')).toHaveCount(0);

  await page.goto('/?visual=countdown');
  const flash = page.locator('.shutter-flash');
  await flash.evaluate((element) => element.classList.add('is-active'));
  await expect
    .poll(() =>
      flash.evaluate((element) => {
        const style = getComputedStyle(element);
        return { animationName: style.animationName, opacity: style.opacity };
      }),
    )
    .toEqual({ animationName: 'none', opacity: '0' });
});

test('processing loads the packaged Lottie animation without external requests', async ({
  page,
}) => {
  const externalRequests: string[] = [];
  const animationRequests: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.endsWith('/animations/loading.json')) animationRequests.push(request.url());
    if (url.origin !== 'http://127.0.0.1:4174') externalRequests.push(request.url());
  });
  await page.setViewportSize({ width: 1_366, height: 768 });
  await page.goto('/?visual=processing');
  await expect(page.locator('.processing-animation svg')).toBeVisible();
  expect(animationRequests).toHaveLength(1);
  expect(externalRequests).toEqual([]);
});

test('review fits and remains accessible at portrait viewport', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto('/?visual=review');
  await expect(page.getByTestId('review-screen')).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      [...document.images].map((image) =>
        image.complete
          ? Promise.resolve()
          : new Promise<void>((resolveImage) => {
              image.addEventListener('load', () => resolveImage(), { once: true });
              image.addEventListener('error', () => resolveImage(), { once: true });
            }),
      ),
    );
  });
  await page.screenshot({ path: 'test-results/review-portrait-768x1024.png', fullPage: true });

  const layout = await page.evaluate(() => ({
    bodyWidth: document.body.scrollWidth,
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(layout.bodyWidth).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);

  const accessibility = await new AxeBuilder({ page }).analyze();
  const seriousOrCritical = accessibility.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );
  expect(seriousOrCritical).toEqual([]);
});

test('operator frame editor remains reachable at portrait viewport', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto('/?visual=admin-frame');
  await expect(page.getByTestId('frame-editor')).toBeVisible();
  await waitForVisualAssets(page);

  const width = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(width.document).toBeLessThanOrEqual(width.viewport);

  for (const locator of [
    page.getByRole('button', { name: /save configuration/i }),
    page.getByRole('region', { name: /visual frame layout preview/i }),
    page.getByRole('complementary', { name: /selected photo slot settings/i }),
  ]) {
    await locator.scrollIntoViewIfNeeded();
    await expect(locator).toBeVisible();
    const bounds = await locator.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(768);
  }
});

test('camera setup is a bounded, structured dialog', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/?visual=attract');
  await page.getByRole('button', { name: 'Camera Setup' }).click();
  const dialog = page.getByRole('dialog', { name: 'Camera Configuration' });
  await expect(dialog).toBeVisible();
  const bounds = await dialog.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(1280);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(720);
  await expect(page.locator('.camera-source-card')).toHaveCount(3);
  await expect(page.locator('.camera-preview-box')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close' })).toBeFocused();
});

test('review fits and remains accessible at large desktop viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/?visual=review');
  await expect(page.getByTestId('review-screen')).toBeVisible();
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      [...document.images].map((image) =>
        image.complete
          ? Promise.resolve()
          : new Promise<void>((resolveImage) => {
              image.addEventListener('load', () => resolveImage(), { once: true });
              image.addEventListener('error', () => resolveImage(), { once: true });
            }),
      ),
    );
  });
  await page.screenshot({ path: 'test-results/review-desktop-1920x1080.png', fullPage: true });

  const layout = await page.evaluate(() => ({
    bodyWidth: document.body.scrollWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyHeight: document.body.scrollHeight,
    documentHeight: document.documentElement.scrollHeight,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
  }));
  expect(layout.bodyWidth).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.bodyHeight).toBeLessThanOrEqual(layout.viewportHeight);
  expect(layout.documentHeight).toBeLessThanOrEqual(layout.viewportHeight);

  const accessibility = await new AxeBuilder({ page }).analyze();
  const seriousOrCritical = accessibility.violations.filter(
    (violation) => violation.impact === 'serious' || violation.impact === 'critical',
  );
  expect(seriousOrCritical).toEqual([]);
});

async function waitForVisualAssets(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      [...document.images].map((image) =>
        image.complete
          ? Promise.resolve()
          : new Promise<void>((resolveImage) => {
              image.addEventListener('load', () => resolveImage(), { once: true });
              image.addEventListener('error', () => resolveImage(), { once: true });
            }),
      ),
    );
  });
}

async function expectNoPageOverflow(page: import('@playwright/test').Page): Promise<void> {
  const layout = await page.evaluate(() => ({
    bodyHeight: document.body.scrollHeight,
    bodyWidth: document.body.scrollWidth,
    documentHeight: document.documentElement.scrollHeight,
    documentWidth: document.documentElement.scrollWidth,
    viewportHeight: window.innerHeight,
    viewportWidth: window.innerWidth,
  }));
  expect(layout.bodyWidth).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.bodyHeight).toBeLessThanOrEqual(layout.viewportHeight);
  expect(layout.documentHeight).toBeLessThanOrEqual(layout.viewportHeight);
}
