/* eslint-disable no-undef, @typescript-eslint/no-empty-function */
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve('artifacts/ui-audit/20260828-174910');
const phase = process.env.CAPTURE_PHASE === 'after' ? 'after' : 'before';
const screenshotRoot = path.join(root, 'screenshots', phase);
const kioskOrigin = 'http://127.0.0.1:4174';
const publicOrigin = 'http://127.0.0.1:4173';
const apiOrigin = 'https://api.example.test';
const token = 'A'.repeat(43);
const photoFixture = await readFile(path.resolve('apps/kiosk/resources/mock/photo-1.jpg'));
const resumePublic = process.env.RESUME_PUBLIC === '1';
const resultsFile = path.join(root, `capture-results-${phase}.json`);
const results =
  resumePublic && phase === 'before'
    ? JSON.parse(await readFile(path.join(root, 'capture-results.json'), 'utf8'))
    : [];

await mkdir(screenshotRoot, { recursive: true });

const browser = await chromium.launch({
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});

function filename(surface, state, interaction, viewport) {
  return `${surface}--${state}--${interaction}--${viewport.width}x${viewport.height}.png`;
}

async function waitForAssets(page) {
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
}

async function capture(page, meta) {
  await waitForAssets(page);
  const accessibility = await new AxeBuilder({ page }).analyze();
  const geometry = await page.evaluate(() => {
    const visible = [
      ...document.querySelectorAll(
        'button, a, input, select, [role="button"], [role="dialog"], img',
      ),
    ]
      .filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.visibility !== 'hidden' &&
          style.display !== 'none' &&
          rect.width > 0 &&
          rect.height > 0
        );
      })
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          label:
            element.getAttribute('aria-label') ||
            element.getAttribute('alt') ||
            element.textContent?.trim().replace(/\s+/g, ' ').slice(0, 80) ||
            element.tagName,
          tag: element.tagName,
          role: element.getAttribute('role'),
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          outside:
            rect.left < -0.5 ||
            rect.top < -0.5 ||
            rect.right > window.innerWidth + 0.5 ||
            rect.bottom > window.innerHeight + 0.5,
        };
      });
    const dialogs = visible.filter((item) => item.role === 'dialog');
    const guestSmallTargets = visible.filter(
      (item) =>
        ['BUTTON', 'A'].includes(item.tag) &&
        !document.querySelector('.admin-shell') &&
        (item.width < 48 || item.height < 48),
    );
    const qr = visible.filter((item) => /QR code/i.test(item.label));
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      body: { width: document.body.scrollWidth, height: document.body.scrollHeight },
      document: {
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
      },
      horizontalOverflow:
        document.body.scrollWidth > window.innerWidth ||
        document.documentElement.scrollWidth > window.innerWidth,
      outside: visible.filter((item) => item.outside),
      guestSmallTargets,
      dialogs,
      qr,
      activeElement:
        document.activeElement?.getAttribute('aria-label') ||
        document.activeElement?.textContent?.trim().replace(/\s+/g, ' ').slice(0, 80) ||
        document.activeElement?.tagName,
    };
  });
  await page.addStyleTag({
    content: `*,*::before,*::after{animation-delay:0s!important;animation-duration:0s!important;transition-delay:0s!important;transition-duration:0s!important;caret-color:transparent!important}`,
  });
  const name = filename(meta.surface, meta.state, meta.interaction, meta.viewport);
  await page.screenshot({ path: path.join(screenshotRoot, name), fullPage: false });
  results.push({
    ...meta,
    screenshot: `screenshots/${phase}/${name}`,
    seriousOrCritical: accessibility.violations.filter(
      (item) => item.impact === 'serious' || item.impact === 'critical',
    ),
    moderate: accessibility.violations.filter((item) => item.impact === 'moderate'),
    geometry,
  });
}

async function kioskSeed(state, viewport, interaction = 'default', action) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await page.goto(`${kioskOrigin}/?visual=${state}`);
  await page.locator('main, .admin-shell').first().waitFor({ state: 'visible' });
  if (action) await action(page);
  await capture(page, { surface: 'kiosk', state, interaction, viewport });
  await context.close();
}

function bridgeScript(config) {
  const ok = (data) => ({ ok: true, data });
  const failure = (message) => ({ ok: false, error: { code: 'audit_fixture', message } });
  const frame = {
    id: '22222222-2222-4222-8222-222222222222',
    name: 'M.A.T. 42nd Anniversary',
    width: 1200,
    height: 3600,
    byteSize: 44090,
    revision: 3,
    mediaUrl: '/mock/frame-mat.png',
    slots: [
      { slotIndex: 1, x: 0.1, y: 0.08, width: 0.8, height: 0.24, rotation: 0, crop: 'cover' },
      { slotIndex: 2, x: 0.1, y: 0.38, width: 0.8, height: 0.24, rotation: 0, crop: 'cover' },
      { slotIndex: 3, x: 0.1, y: 0.68, width: 0.8, height: 0.24, rotation: 0, crop: 'cover' },
    ],
  };
  const attract = {
    screen: 'attract',
    state: null,
    sessionId: null,
    shotNumber: null,
    captureCount: 0,
    countdownEndsAt: null,
    cameraPreviewEnabled: false,
    media: { captureUrls: [], collageUrl: null, qrImageUrl: null },
    controls: {
      canStart: config.canStart !== false,
      canRetakeAll: false,
      canAcceptPhotos: false,
      canRetryUpload: false,
      canFinishOffline: false,
      canFinish: false,
    },
    errorCode: null,
    message: null,
  };
  const session = {
    ...attract,
    screen: 'review',
    state: 'review',
    sessionId: '11111111-1111-4111-8111-111111111111',
    captureCount: 3,
  };
  const svg = (label, color) =>
    `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="1800"><rect width="100%" height="100%" fill="${color}"/><text x="50%" y="50%" text-anchor="middle" fill="white" font-size="70">${label}</text></svg>`)}`;
  const galleryItems = config.emptyRecent
    ? []
    : [
        {
          sessionId: '11111111-1111-4111-8111-111111111111',
          previewDataUrl: svg('AUDIT FIXTURE', '#5d3429'),
          qrDataUrl: svg('QR', '#ffffff'),
          metadata: {
            capturedAt: 1787880000000,
            photoCount: 3,
            frameName: 'M.A.T. 42nd Anniversary',
            uploadStatus: config.galleryStatus || 'uploaded',
            cloudExpiresAt: 1790472000000,
          },
        },
      ];
  const settings = {
    googleFormsUrl: null,
    localRetentionDays: 60,
    cloudRetentionDays: 30,
    lan: {
      enabled: false,
      bindHost: '127.0.0.1',
      port: 4310,
      tlsConfigured: false,
      certificateFingerprint: null,
    },
    activeFrame: frame,
    frames: [frame],
    cameraAdapter: 'webcam',
    cameraDeviceId: null,
    cameraResolution: '1080p',
    supabaseUrl: null,
    supabasePublishableKey: null,
    revision: 3,
  };
  const health = {
    camera: { state: 'healthy', code: null, message: 'Camera ready.', checkedAt: 1 },
    cloud: {
      state: config.unhealthy ? 'degraded' : 'healthy',
      code: config.unhealthy ? 'offline' : null,
      message: config.unhealthy ? 'Cloud unavailable.' : 'Cloud ready.',
      checkedAt: 1,
    },
    database: { state: 'healthy', code: null, message: 'Database ready.', checkedAt: 1 },
    encryption: { state: 'healthy', code: null, message: 'Encryption ready.', checkedAt: 1 },
  };
  const initial = config.session ? session : attract;
  const pending = new Promise(() => {});
  window.graceBooth = {
    booth: {
      getSnapshot: async () => ok(initial),
      start: async () =>
        config.busyStart
          ? pending
          : config.startError
            ? failure('Camera unavailable. Reconnect the camera and try again.')
            : ok(session),
      retakeAll: async () => ok(initial),
      acceptPhotos: async () => ok(initial),
      retryUpload: async () => ok(initial),
      finishOffline: async () => ok(initial),
      done: async () => ok(initial),
      cancelSession: async () => ok(attract),
      getCameras: async () =>
        ok({
          adapter: config.cameraAdapter || 'webcam',
          deviceId: null,
          resolution: '1080p',
          status: {
            adapter: config.cameraAdapter || 'webcam',
            state: 'ready',
            code: null,
            operatorMessage: 'Ready',
            capabilities: { stillCapture: true, preview: true },
            checkedAt: 1,
          },
        }),
      setCamera: async () =>
        config.cameraSaveError
          ? failure('Failed to apply camera settings.')
          : ok({
              adapter: 'webcam',
              deviceId: null,
              resolution: '1080p',
              status: {
                adapter: 'webcam',
                state: 'ready',
                code: null,
                operatorMessage: 'Ready',
                capabilities: { stillCapture: true, preview: true },
                checkedAt: 1,
              },
            }),
      submitCameraFrame: async () => ok({}),
      subscribe: () => () => {},
      onCameraFrameRequest: () => () => {},
    },
    gallery: {
      getRecent: async () => (config.busyRecent ? pending : ok(galleryItems)),
      repairCloudPhoto: async () => ok({ status: 'repaired', message: 'Cloud copy repaired.' }),
    },
    admin: {
      getAuthStatus: async () =>
        ok({
          configured: config.bootstrap ? false : true,
          authenticated: Boolean(config.authenticated),
          expiresAt: null,
        }),
      login: async () =>
        config.loginBusy
          ? pending
          : config.loginError
            ? failure('The passcode was not accepted.')
            : ok({ configured: true, authenticated: true, expiresAt: Date.now() + 60000 }),
      logout: async () => ok({}),
      bootstrapPasscode: async () =>
        ok({ configured: true, authenticated: true, expiresAt: Date.now() + 60000 }),
      changePasscode: async () => ok({}),
      getSettings: async () => ok(settings),
      saveSettings: async () => ok(settings),
      listFrames: async () => ok([frame]),
      addFrame: async () => ok(null),
      updateFrameLayout: async () => ok(frame),
      deleteFrame: async () => ok([frame]),
      moveFrame: async () => ok([frame]),
      chooseLanCertificate: async () => ok(null),
      listUploadJobs: async () => ok({ items: [], nextCursor: null }),
      retryUpload: async () => ok({}),
      getHealth: async () => ok(health),
      restartSession: async () => ok(attract),
      connectCloud: async () => ok({ message: 'Connected.' }),
    },
  };
  if (config.cameraFailure) {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        addEventListener() {},
        removeEventListener() {},
        enumerateDevices: async () => [
          { deviceId: 'audit-camera', kind: 'videoinput', label: 'Audit Camera', groupId: 'audit' },
        ],
        getUserMedia: async () => {
          throw new DOMException(
            config.cameraFailure === 'permission' ? 'Permission denied' : 'Unavailable',
            config.cameraFailure === 'permission' ? 'NotAllowedError' : 'NotReadableError',
          );
        },
      },
    });
  }
}

async function kioskMock(config, viewport, state, interaction, action) {
  const context = await browser.newContext({ viewport, permissions: ['camera'] });
  await context.addInitScript(bridgeScript, config);
  const page = await context.newPage();
  await page.goto(kioskOrigin);
  await page.getByTestId('attract-screen').waitFor({ state: 'visible' });
  if (action) await action(page);
  await capture(page, { surface: 'kiosk', state, interaction, viewport });
  await context.close();
}

async function publicPage(state, viewport, interaction = 'default') {
  const context = await browser.newContext({
    viewport,
    reducedMotion: state === 'reduced-motion' ? 'reduce' : 'no-preference',
  });
  const page = await context.newPage();
  if (process.env.DEBUG_PUBLIC === '1') {
    page.on('request', (request) => console.log('REQUEST', request.method(), request.url()));
    page.on('response', (response) => console.log('RESPONSE', response.status(), response.url()));
    page.on('console', (message) => console.log('CONSOLE', message.type(), message.text()));
  }
  let downloadMode = 'ok';
  await page.route(`${apiOrigin}/**`, async (route) => {
    const request = route.request();
    const routeName = new URL(request.url()).pathname.split('/').at(-1);
    if (state === 'loading') return;
    if (routeName === 'resolve') {
      if (state === 'non-retryable-error')
        return route.fulfill({
          status: 410,
          contentType: 'application/json',
          body: JSON.stringify({
            error: {
              code: 'expired',
              message: 'This photo is unavailable or has expired.',
              retryable: false,
            },
          }),
        });
      if (state === 'retryable-error')
        return route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({
            error: {
              code: 'temporary',
              message: 'The archive is temporarily unavailable.',
              retryable: true,
            },
          }),
        });
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'ready',
          expiresAt:
            state === 'long-expiry' ? '2099-12-31T23:59:59.000Z' : '2026-09-16T12:00:00.000Z',
          googleFormsUrl: null,
        }),
      });
    }
    if (routeName === 'image')
      return route.fulfill({ status: 200, contentType: 'image/jpeg', body: photoFixture });
    if (routeName === 'download') {
      if (downloadMode === 'busy') return;
      if (downloadMode === 'error')
        return route.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
      return route.fulfill({ status: 200, contentType: 'image/jpeg', body: photoFixture });
    }
    await route.abort();
  });
  await page.route('https://**/*', async (route) => {
    if (route.request().url().startsWith(apiOrigin)) return route.fallback();
    await route.abort();
  });
  await page.goto(`${publicOrigin}/photo#${token}`);
  if (!['loading', 'non-retryable-error', 'retryable-error'].includes(state)) {
    await page.getByRole('img', { name: /finished event collage/i }).waitFor({ state: 'visible' });
  } else if (state === 'loading') {
    await page.getByText('Your moment is almost here.').waitFor({ state: 'visible' });
  } else {
    await page
      .getByRole('heading', { name: 'We could not open this photo.' })
      .waitFor({ state: 'visible' });
  }
  if (state === 'download-busy') {
    downloadMode = 'busy';
    await page.getByRole('button', { name: 'Download photo' }).click();
    await page.getByRole('button', { name: /Preparing download/i }).waitFor({ state: 'visible' });
  }
  if (state === 'download-error') {
    downloadMode = 'error';
    await page.getByRole('button', { name: 'Download photo' }).click();
    await page.getByRole('alert').waitFor({ state: 'visible' });
  }
  if (state === 'cta-focus') await page.getByRole('link', { name: /Join a Ministry/i }).focus();
  if (state === 'cta-hover') await page.getByRole('link', { name: /Join a Ministry/i }).hover();
  await capture(page, { surface: 'public', state, interaction, viewport });
  await context.close();
}

try {
  if (process.env.FOCUSED_AFTER === '1') {
    for (const viewport of [
      { width: 1280, height: 720 },
      { width: 1366, height: 768 },
    ]) {
      for (const state of [
        'attract',
        'processing',
        'final',
        'recovery-camera',
        'recovery-upload',
      ]) {
        await kioskSeed(state, viewport);
      }
      await kioskMock(
        { galleryStatus: 'uploaded' },
        viewport,
        'recent-gallery',
        'detail',
        async (page) => {
          await page.getByRole('button', { name: 'Recent Photos' }).click();
          await page.getByTestId('gallery-item-1').click();
          await page
            .getByRole('dialog', { name: 'Enlarged photo strip details' })
            .waitFor({ state: 'visible' });
        },
      );
      await kioskMock(
        { cameraFailure: 'permission' },
        viewport,
        'camera-setup',
        'permission-error',
        async (page) => {
          await page.getByRole('button', { name: 'Camera Setup' }).click();
          await page.getByText('Camera permission was denied.').waitFor({ state: 'visible' });
        },
      );
    }
    await kioskSeed('admin-frame', { width: 768, height: 1024 }, 'portrait');
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 1440, height: 900 },
    ]) {
      await publicPage('loading', viewport);
    }
  } else {
    const kioskViewports = [
      { width: 1280, height: 720 },
      { width: 1366, height: 768 },
    ];
    const staticStates = [
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
    ];
    for (const viewport of resumePublic ? [] : kioskViewports) {
      for (const state of staticStates) await kioskSeed(state, viewport);
      await kioskSeed('attract', viewport, 'keyboard-focus', (page) =>
        page.getByRole('button', { name: /start photo session/i }).focus(),
      );
      await kioskMock({ canStart: false }, viewport, 'attract', 'start-disabled');
      await kioskMock({ busyStart: true }, viewport, 'attract', 'start-busy', (page) =>
        page.getByRole('button', { name: /start photo session/i }).click(),
      );
      await kioskMock({ startError: true }, viewport, 'attract', 'camera-message', async (page) => {
        await page.getByRole('button', { name: /start photo session/i }).click();
        await page.getByRole('alert').waitFor({ state: 'visible' });
      });
      await kioskMock({}, viewport, 'recent-gallery', 'empty', (page) =>
        page.getByRole('button', { name: 'Recent Photos' }).click(),
      );
      await kioskMock(
        { galleryStatus: 'uploaded' },
        viewport,
        'recent-gallery',
        'populated',
        async (page) => {
          await page.getByRole('button', { name: 'Recent Photos' }).click();
          await page.getByTestId('gallery-item-1').waitFor({ state: 'visible' });
        },
      );
      await kioskMock(
        { galleryStatus: 'uploaded' },
        viewport,
        'recent-gallery',
        'detail',
        async (page) => {
          await page.getByRole('button', { name: 'Recent Photos' }).click();
          await page.getByTestId('gallery-item-1').click();
          await page
            .getByRole('dialog', { name: 'Enlarged photo strip details' })
            .waitFor({ state: 'visible' });
        },
      );
      await kioskMock({ bootstrap: true }, viewport, 'passcode', 'bootstrap');
      await kioskMock({}, viewport, 'passcode', 'login', async (page) => {
        await page.getByRole('button', { name: 'Admin' }).click();
        await page.getByRole('dialog').waitFor({ state: 'visible' });
      });
      await kioskMock(
        { loginError: true },
        viewport,
        'passcode',
        'validation-error',
        async (page) => {
          await page.getByRole('button', { name: 'Admin' }).click();
          await page.locator('#operator-passcode').fill('wrong-passcode');
          await page.getByRole('button', { name: 'Unlock' }).click();
          await page.getByRole('alert').waitFor({ state: 'visible' });
        },
      );
      await kioskMock({ loginBusy: true }, viewport, 'passcode', 'busy', async (page) => {
        await page.getByRole('button', { name: 'Admin' }).click();
        await page.locator('#operator-passcode').fill('long-enough');
        await page.getByRole('button', { name: 'Unlock' }).click();
      });
      await kioskMock({}, viewport, 'passcode', 'show-password', async (page) => {
        await page.getByRole('button', { name: 'Admin' }).click();
        await page.getByRole('button', { name: 'Show passcode' }).click();
      });
      await kioskMock(
        { cameraFailure: 'permission' },
        viewport,
        'camera-setup',
        'permission-error',
        async (page) => {
          await page.getByRole('button', { name: 'Camera Setup' }).click();
          await page.getByText('Camera permission was denied.').waitFor({ state: 'visible' });
        },
      );
      await kioskMock(
        { cameraFailure: 'unavailable' },
        viewport,
        'camera-setup',
        'unavailable',
        async (page) => {
          await page.getByRole('button', { name: 'Camera Setup' }).click();
          await page
            .getByText('The camera is unavailable or in use by another app.')
            .waitFor({ state: 'visible' });
        },
      );
      await kioskMock({}, viewport, 'camera-setup', 'sony-unsupported', async (page) => {
        await page.getByRole('button', { name: 'Camera Setup' }).click();
        await page.getByRole('button', { name: /Sony A7 Tethered/i }).click();
      });
      await kioskMock({}, viewport, 'camera-setup', 'mock-camera', async (page) => {
        await page.getByRole('button', { name: 'Camera Setup' }).click();
        await page.getByRole('button', { name: /Mock Hardware/i }).click();
      });
    }
    if (!resumePublic) {
      await kioskSeed('review', { width: 768, height: 1024 }, 'portrait');
      await kioskSeed('review', { width: 1920, height: 1080 }, 'desktop');
      await kioskSeed('admin-frame', { width: 768, height: 1024 }, 'portrait');
      await kioskSeed('admin-frame', { width: 1920, height: 1080 }, 'desktop');
    }

    const publicViewports = [
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 1440, height: 900 },
    ];
    const publicStates = process.env.PUBLIC_ONLY_STATE
      ? [process.env.PUBLIC_ONLY_STATE]
      : [
          'loading',
          'ready',
          'download-busy',
          'download-error',
          'cta-focus',
          'cta-hover',
          'non-retryable-error',
          'retryable-error',
          'long-expiry',
          'reduced-motion',
        ];
    for (const viewport of publicViewports) {
      for (const state of publicStates) await publicPage(state, viewport);
    }
  }
} finally {
  const deduplicated = [...new Map(results.map((item) => [item.screenshot, item])).values()];
  results.splice(0, results.length, ...deduplicated);
  await writeFile(resultsFile, JSON.stringify(results, null, 2));
  if (phase === 'before') {
    await writeFile(path.join(root, 'capture-results.json'), JSON.stringify(results, null, 2));
  }
  await browser.close();
}

console.log(
  JSON.stringify(
    {
      captures: results.length,
      seriousOrCritical: results.reduce((sum, item) => sum + item.seriousOrCritical.length, 0),
      horizontalOverflow: results.filter((item) => item.geometry.horizontalOverflow).length,
      outside: results.filter((item) => item.geometry.outside.length > 0).length,
    },
    null,
    2,
  ),
);
