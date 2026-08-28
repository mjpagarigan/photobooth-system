import { join } from 'node:path';

import { BrowserWindow } from 'electron';

export type KioskWindowResult = {
  window: BrowserWindow;
  rendererOrigin: string;
};

export async function createKioskWindow(
  appPath: string,
  isPackaged: boolean,
  developmentRendererUrl: string | undefined,
): Promise<KioskWindowResult> {
  const target = getRendererTarget(isPackaged, developmentRendererUrl);
  const window = new BrowserWindow({
    width: 1_366,
    height: 768,
    minWidth: 1_024,
    minHeight: 640,
    useContentSize: true,
    show: false,
    autoHideMenuBar: true,
    fullscreenable: true,
    fullscreen: isPackaged,
    maximizable: true,
    resizable: true,
    backgroundColor: '#F5F1E8',
    webPreferences: {
      preload: join(appPath, 'out', 'preload', 'index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      devTools: !isPackaged,
    },
  });

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.session.setPermissionRequestHandler(
    (_webContents, permission, callback, details) => {
      callback(
        isAllowedKioskPermission({
          permission,
          requestingOrigin: 'securityOrigin' in details ? details.securityOrigin : undefined,
          mediaTypes: 'mediaTypes' in details ? details.mediaTypes : undefined,
          trustedOrigin: target.origin,
        }),
      );
    },
  );
  window.webContents.session.setPermissionCheckHandler(
    (_webContents, permission, requestingOrigin, details) =>
      isAllowedKioskPermission({
        permission,
        requestingOrigin,
        mediaTypes: 'mediaType' in details ? [details.mediaType] : undefined,
        trustedOrigin: target.origin,
      }),
  );
  window.webContents.session.setDevicePermissionHandler(() => false);
  window.webContents.session.on('will-download', (event) => event.preventDefault());
  window.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedRendererUrl(url, target.origin)) event.preventDefault();
  });
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.webContents.on('render-process-gone', () => {
    if (!window.isDestroyed()) void window.loadURL(target.url);
  });
  window.once('ready-to-show', () => {
    window.maximize();
    window.show();
  });
  await window.loadURL(target.url);

  return { window, rendererOrigin: target.origin };
}

export function getRendererTarget(
  isPackaged: boolean,
  developmentRendererUrl: string | undefined,
): { url: string; origin: string } {
  if (isPackaged) return { url: 'app://grace-booth/index.html', origin: 'app://grace-booth' };
  if (!developmentRendererUrl) {
    return { url: 'app://grace-booth/index.html', origin: 'app://grace-booth' };
  }
  const parsed = new URL(developmentRendererUrl);
  if (
    parsed.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)
  ) {
    throw new Error('Development renderer URL must use loopback HTTP');
  }
  return { url: parsed.href, origin: parsed.origin };
}

export type KioskPermissionQuery = {
  permission: string;
  requestingOrigin: string | undefined;
  mediaTypes: readonly string[] | undefined;
  trustedOrigin: string;
};

/**
 * The kiosk grants exactly one capability: video-only camera access for its own renderer, which
 * needs a live viewfinder and the frames the webcam adapter captures. Microphone access, any other
 * permission, and any other origin stay denied.
 */
export function isAllowedKioskPermission(query: KioskPermissionQuery): boolean {
  if (query.permission !== 'media') return false;
  if (!query.requestingOrigin) return false;
  if (stripTrailingSlash(query.requestingOrigin) !== stripTrailingSlash(query.trustedOrigin)) {
    return false;
  }
  const mediaTypes = query.mediaTypes ?? [];
  return mediaTypes.length > 0 && mediaTypes.every((mediaType) => mediaType === 'video');
}

function stripTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

export function isTrustedRendererUrl(value: string, expectedOrigin: string): boolean {
  const url = new URL(value);
  return expectedOrigin === 'app://grace-booth'
    ? url.protocol === 'app:' && url.hostname === 'grace-booth'
    : url.origin === expectedOrigin;
}
