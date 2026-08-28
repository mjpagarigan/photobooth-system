import { join } from 'node:path';
import type { DisplayInfo, DualDisplaySettings } from '@grace-booth/shared';
import { BrowserWindow, screen, type Display } from 'electron';

import type { LocalRepository } from '../database/repositories.js';
import {
  getRendererTarget,
  isAllowedKioskPermission,
  isTrustedRendererUrl,
} from './window.js';

export class DisplayManager {
  private captureWindow: BrowserWindow | null = null;
  private qrStationWindow: BrowserWindow | null = null;
  private rendererOrigin = '';
  private onDisplayAddedHandler: (() => void) | null = null;
  private onDisplayRemovedHandler: (() => void) | null = null;

  constructor(
    private readonly appPath: string,
    private readonly isPackaged: boolean,
    private readonly developmentRendererUrl: string | undefined,
    private readonly repository: LocalRepository,
  ) {}

  async initialize(): Promise<{ captureWindow: BrowserWindow; rendererOrigin: string }> {
    const target = getRendererTarget(this.isPackaged, this.developmentRendererUrl);
    this.rendererOrigin = target.origin;

    await this.syncWindows();

    this.onDisplayAddedHandler = () => {
      void this.syncWindows();
    };
    this.onDisplayRemovedHandler = () => {
      void this.syncWindows();
    };
    screen.on('display-added', this.onDisplayAddedHandler);
    screen.on('display-removed', this.onDisplayRemovedHandler);

    return {
      captureWindow: this.captureWindow!,
      rendererOrigin: this.rendererOrigin,
    };
  }

  getCaptureWindow(): BrowserWindow | null {
    return this.captureWindow;
  }

  getQrStationWindow(): BrowserWindow | null {
    return this.qrStationWindow;
  }

  isDualActive(): boolean {
    const displays = screen.getAllDisplays();
    const settings = this.repository.getSettings();
    if (settings.dualDisplayMode === 'disabled') return false;
    if (settings.dualDisplayMode === 'enabled') return displays.length >= 2;
    return displays.length >= 2; // 'auto'
  }

  getDisplays(): DisplayInfo[] {
    const displays = screen.getAllDisplays();
    const primary = screen.getPrimaryDisplay();
    return displays.map((d, index) => ({
      id: d.id,
      label: `Display ${index + 1} (${d.bounds.width}x${d.bounds.height})`,
      bounds: {
        x: d.bounds.x,
        y: d.bounds.y,
        width: d.bounds.width,
        height: d.bounds.height,
      },
      isPrimary: d.id === primary.id,
    }));
  }

  async swapDisplays(): Promise<DisplayInfo[]> {
    const settings = this.repository.getSettings();
    const newSwap = !settings.swapDisplays;
    this.repository.setDualDisplaySettings(
      settings.dualDisplayMode,
      newSwap,
      settings.qrDismissSeconds,
    );
    await this.syncWindows();
    return this.getDisplays();
  }

  async setDualDisplaySettings(input: DualDisplaySettings): Promise<DualDisplaySettings> {
    this.repository.setDualDisplaySettings(
      input.mode,
      input.swapDisplays,
      input.qrDismissSeconds,
    );
    await this.syncWindows();
    return input;
  }

  async syncWindows(): Promise<void> {
    const displays = screen.getAllDisplays();
    const settings = this.repository.getSettings();
    const isDual = this.isDualActive();

    const displayOrder = settings.swapDisplays && displays.length >= 2 ? [...displays].reverse() : displays;
    const captureDisplay = displayOrder[0] ?? screen.getPrimaryDisplay();
    const qrDisplay = isDual ? (displayOrder[1] ?? null) : null;

    // 1. Capture Window
    if (!this.captureWindow || this.captureWindow.isDestroyed()) {
      this.captureWindow = await this.createWindow(captureDisplay, 'capture');
    } else {
      this.positionWindow(this.captureWindow, captureDisplay);
    }

    // 2. QR Station Window
    if (qrDisplay) {
      if (!this.qrStationWindow || this.qrStationWindow.isDestroyed()) {
        this.qrStationWindow = await this.createWindow(qrDisplay, 'qr-station');
      } else {
        this.positionWindow(this.qrStationWindow, qrDisplay);
      }
    } else {
      if (this.qrStationWindow && !this.qrStationWindow.isDestroyed()) {
        this.qrStationWindow.close();
        this.qrStationWindow = null;
      }
    }
  }

  private positionWindow(win: BrowserWindow, display: Display): void {
    if (this.isPackaged) {
      win.setBounds(display.bounds);
      win.setFullScreen(true);
    } else {
      win.setBounds({
        x: display.bounds.x + 30,
        y: display.bounds.y + 30,
        width: Math.min(1366, display.bounds.width - 60),
        height: Math.min(768, display.bounds.height - 60),
      });
    }
  }

  private async createWindow(
    display: Display,
    view: 'capture' | 'qr-station',
  ): Promise<BrowserWindow> {
    const target = getRendererTarget(this.isPackaged, this.developmentRendererUrl);
    const windowUrl =
      view === 'qr-station'
        ? `${target.url}${target.url.includes('?') ? '&' : '?'}view=qr-station`
        : target.url;

    const win = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: 1_366,
      height: 768,
      minWidth: 1_024,
      minHeight: 640,
      useContentSize: true,
      show: false,
      autoHideMenuBar: true,
      fullscreenable: true,
      fullscreen: this.isPackaged,
      maximizable: true,
      resizable: true,
      backgroundColor: '#F5F1E8',
      webPreferences: {
        preload: join(this.appPath, 'out', 'preload', 'index.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        allowRunningInsecureContent: false,
        spellcheck: false,
        devTools: !this.isPackaged,
      },
    });

    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.session.setPermissionRequestHandler(
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
    win.webContents.session.setPermissionCheckHandler(
      (_webContents, permission, requestingOrigin, details) =>
        isAllowedKioskPermission({
          permission,
          requestingOrigin,
          mediaTypes: 'mediaType' in details ? [details.mediaType] : undefined,
          trustedOrigin: target.origin,
        }),
    );
    win.webContents.session.setDevicePermissionHandler(() => false);
    win.webContents.session.on('will-download', (event) => event.preventDefault());
    win.webContents.on('will-navigate', (event, url) => {
      if (!isTrustedRendererUrl(url, target.origin)) event.preventDefault();
    });
    win.webContents.on('will-attach-webview', (event) => event.preventDefault());
    win.webContents.on('render-process-gone', () => {
      if (!win.isDestroyed()) void win.loadURL(windowUrl);
    });
    win.once('ready-to-show', () => {
      if (!this.isPackaged) win.maximize();
      win.show();
    });

    this.positionWindow(win, display);
    await win.loadURL(windowUrl);

    return win;
  }

  close(): void {
    if (this.onDisplayAddedHandler) {
      screen.removeListener('display-added', this.onDisplayAddedHandler);
    }
    if (this.onDisplayRemovedHandler) {
      screen.removeListener('display-removed', this.onDisplayRemovedHandler);
    }
  }
}
