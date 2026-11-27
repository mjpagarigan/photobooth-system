import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { LocalRepository, StoredAsset, StoredSession } from '../database/repositories.js';
import type { PhotoVault } from '../storage/photo-vault.js';
import type { SecretStore } from '../storage/secret-store.js';
import type { PublicDeliverySecret } from '../cloud/upload-queue.js';

export type OfflineDeliveryServerOptions = {
  port: number;
};

type OfflinePageState = { kind: 'ready'; token: string } | { kind: 'hash' } | { kind: 'not-found' };

const BASE_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'private, no-store',
};

const SECURITY_HEADERS: Record<OfflinePageState['kind'], Readonly<Record<string, string>>> = {
  ready: {
    ...BASE_SECURITY_HEADERS,
    'Content-Security-Policy':
      "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  },
  'not-found': {
    ...BASE_SECURITY_HEADERS,
    'Content-Security-Policy':
      "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  },
  hash: {
    ...BASE_SECURITY_HEADERS,
    'Content-Security-Policy':
      "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  },
};

const OFFLINE_PAGE_CSS = `:root {
  color-scheme: light;
  font-family: -apple-system, BlinkMacSystemFont, 'Inter Variable', system-ui, sans-serif;
  color: #1d1d1f;
  background: #f5f5f7;
  -webkit-font-smoothing: antialiased;
}
*, *::before, *::after {
  box-sizing: border-box;
}
[hidden] {
  display: none !important;
}
html, body {
  margin: 0;
  min-width: 320px;
  background: #f5f5f7;
  color: #1d1d1f;
  overflow-x: hidden;
}
body {
  min-height: 100dvh;
}
a, button {
  font: inherit;
}
a:focus-visible, button:focus-visible, [tabindex='0']:focus-visible {
  outline: 2px solid #0066cc;
  outline-offset: 3px;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}
.page-frame {
  width: min(100%, 480px);
  min-height: 100dvh;
  margin: 0 auto;
  padding: max(24px, env(safe-area-inset-top)) max(20px, env(safe-area-inset-right)) max(32px, env(safe-area-inset-bottom)) max(20px, env(safe-area-inset-left));
  display: flex;
  flex-direction: column;
}
.site-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 18px;
}
.site-header__brand {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: #1d1d1f;
}
.site-header__pill {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 980px;
  background: #e8e8ed;
  color: #424245;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
}
.photo-layout {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.state-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
h1 {
  margin: 0;
  font-size: 30px;
  font-weight: 700;
  line-height: 1.12;
  letter-spacing: -0.03em;
  color: #1d1d1f;
}
h1 span {
  color: #86868b;
}
.lead {
  margin: 0;
  font-size: 16px;
  line-height: 1.45;
  color: #636366;
}
.photo-card {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 16px;
  border-radius: 24px;
  background: #ffffff;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.05);
}
.photo-card img {
  display: block;
  max-height: 62dvh;
  width: auto;
  max-width: 100%;
  height: auto;
  object-fit: contain;
  border-radius: 16px;
}
.photo-card--loading {
  min-height: 320px;
}
.skeleton-box {
  width: min(100%, 240px);
  height: 300px;
  border-radius: 16px;
  background: #e8e8ed;
  animation: skeleton-pulse 1.5s ease-in-out infinite;
}
@keyframes skeleton-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.55; }
}
.action-stack {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.download-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: 52px;
  padding: 0 24px;
  border-radius: 980px;
  background: #0066cc;
  color: #ffffff;
  text-decoration: none;
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.01em;
  transition: background-color 150ms ease, transform 120ms ease;
}
.download-btn:hover {
  background: #0071e3;
}
.download-btn:active {
  background: #00539f;
  transform: scale(0.99);
}
.mobile-save-hint {
  margin: 0;
  font-size: 13px;
  line-height: 1.45;
  color: #636366;
  text-align: center;
}
.error-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 36px 24px 28px;
  border-radius: 24px;
  background: #ffffff;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.05);
  text-align: center;
}
.error-badge {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: #ffecee;
  color: #d70015;
}
.error-badge svg {
  width: 30px;
  height: 30px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.error-card h1 {
  font-size: 24px;
}
.error-message {
  margin: 0;
  font-size: 15px;
  line-height: 1.45;
  color: #1d1d1f;
}
.muted-copy {
  margin: 0;
  font-size: 14px;
  line-height: 1.45;
  color: #636366;
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    scroll-behavior: auto !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
@media (forced-colors: active) {
  .photo-card, .error-card, .site-header__pill, .download-btn {
    border: 1px solid CanvasText;
  }
  a:focus-visible, button:focus-visible, [tabindex='0']:focus-visible {
    outline: 2px solid Highlight;
    outline-offset: 2px;
  }
}`;

const ALERT_ICON_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="12.5"/><circle cx="12" cy="16" r="0.75" fill="currentColor" stroke="none"/></svg>`;

function renderOfflinePage(state: OfflinePageState): string {
  const title =
    state.kind === 'not-found'
      ? 'M.A.T. Photobooth · Photo Not Found'
      : 'M.A.T. Photobooth · Your Keepsake';

  let body: string;
  let script = '';

  if (state.kind === 'ready') {
    const safeToken = encodeURIComponent(state.token);
    const imageUrl = `/photo/${safeToken}/image`;
    body = `<main class="photo-layout" data-state="ready">
      <h1>You're all set. <span>Here's your keepsake.</span></h1>
      <section class="photo-card" aria-label="Your finished photo">
        <img src="${imageUrl}" alt="M.A.T. Photobooth finished event collage" />
      </section>
      <div class="action-stack">
        <a href="${imageUrl}?download=1" download="mat-photobooth-keepsake.jpg" class="download-btn">Download photo</a>
        <p class="mobile-save-hint">On iPhone or iPad, touch and hold the photo to save it to Photos.</p>
      </div>
    </main>`;
  } else if (state.kind === 'not-found') {
    body = `<main class="photo-layout" data-state="error">
      <section class="error-card" role="alert" aria-live="polite" aria-labelledby="error-title">
        <div class="error-badge" aria-hidden="true">${ALERT_ICON_SVG}</div>
        <h1 id="error-title">We could not open this photo.</h1>
        <p class="error-message">This photo may have expired or is not available on this booth.</p>
        <p class="muted-copy">Check that the whole QR link opened and that your device is connected to the booth Wi-Fi.</p>
      </section>
    </main>`;
  } else {
    body = `<div id="status-live" class="sr-only" role="status" aria-live="polite" aria-atomic="true">Opening your keepsake.</div>
    <main id="photo-main" class="photo-layout" data-state="loading" aria-busy="true">
      <div id="state-loading" class="state-panel">
        <h1>Opening your keepsake.</h1>
        <p class="lead">Loading the photo connected to this QR code.</p>
        <div class="photo-card photo-card--loading" aria-hidden="true">
          <div class="skeleton-box"></div>
        </div>
      </div>
      <div id="state-ready" class="state-panel" hidden>
        <h1>You're all set. <span>Here's your keepsake.</span></h1>
        <section class="photo-card" aria-label="Your finished photo">
          <img id="photo-img" alt="M.A.T. Photobooth finished event collage" />
        </section>
        <div class="action-stack">
          <a id="download-link" href="#" download="mat-photobooth-keepsake.jpg" class="download-btn">Download photo</a>
          <p class="mobile-save-hint">On iPhone or iPad, touch and hold the photo to save it to Photos.</p>
        </div>
      </div>
      <section id="state-error" class="error-card" role="alert" aria-live="polite" aria-labelledby="error-title" hidden>
        <div class="error-badge" aria-hidden="true">${ALERT_ICON_SVG}</div>
        <h1 id="error-title">We could not open this photo.</h1>
        <p id="error-message" class="error-message">This photo may have expired or is not available on this booth.</p>
        <p class="muted-copy">Check that the whole QR link opened and that your device is connected to the booth Wi-Fi.</p>
      </section>
    </main>`;
    script = `<script>
    (function () {
      var hash = window.location.hash.replace(/^#/, '').trim();
      var params = new URLSearchParams(window.location.search);
      var token = hash || (params.get('token') || '').trim();
      var main = document.getElementById('photo-main');
      var statusLive = document.getElementById('status-live');
      var loadingPanel = document.getElementById('state-loading');
      var readyPanel = document.getElementById('state-ready');
      var errorPanel = document.getElementById('state-error');
      var errorMessage = document.getElementById('error-message');
      var img = document.getElementById('photo-img');
      var downloadLink = document.getElementById('download-link');

      function showError(detail) {
        main.dataset.state = 'error';
        main.removeAttribute('aria-busy');
        loadingPanel.hidden = true;
        readyPanel.hidden = true;
        errorMessage.textContent = detail;
        errorPanel.hidden = false;
        statusLive.textContent = 'We could not open this photo.';
      }

      if (!token || !/^[a-zA-Z0-9_-]+$/.test(token)) {
        showError('This photo link is incomplete or invalid.');
        return;
      }

      var imageUrl = '/photo/' + encodeURIComponent(token) + '/image';
      img.addEventListener('load', function () {
        main.dataset.state = 'ready';
        main.removeAttribute('aria-busy');
        loadingPanel.hidden = true;
        errorPanel.hidden = true;
        downloadLink.href = imageUrl + '?download=1';
        readyPanel.hidden = false;
        statusLive.textContent = "You're all set. Here's your keepsake.";
      });
      img.addEventListener('error', function () {
        showError('This photo may have expired or is not available on this booth.');
      });
      img.src = imageUrl;
    })();
  </script>`;
  }

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="color-scheme" content="light" />
  <meta name="theme-color" content="#f5f5f7" />
  <title>${title}</title>
  <style>${OFFLINE_PAGE_CSS}</style>
</head>
<body>
  <div class="page-frame">
    <header class="site-header">
      <span class="site-header__brand">M.A.T. Photobooth</span>
      <span class="site-header__pill">Local Wi-Fi</span>
    </header>
    ${body}
  </div>
  ${script}
</body>
</html>`;
}

export class OfflineDeliveryServer {
  private server: Server | null = null;
  private tokenCache = new Map<string, { sessionId: string; assetId: string }>();

  constructor(
    private readonly repository: LocalRepository,
    private readonly vault: PhotoVault,
    private readonly secrets: SecretStore,
    private readonly port = 4_310,
  ) {}

  registerToken(token: string, sessionId: string, assetId: string): void {
    this.tokenCache.set(token, { sessionId, assetId });
  }

  async start(): Promise<void> {
    if (this.server) return;

    return new Promise((resolve, reject) => {
      const srv = createServer((req, res) => this.handleRequest(req, res));
      srv.on('error', (err: NodeJS.ErrnoException) => {
        // If port is already in use (e.g. loopback admin or other service), don't crash
        if (err.code === 'EADDRINUSE') {
          console.warn(
            `[OfflineDeliveryServer] Port ${this.port} is in use; offline delivery listener could not bind.`,
          );
          resolve();
        } else {
          reject(err);
        }
      });
      srv.listen(this.port, '0.0.0.0', () => {
        this.server = srv;
        resolve();
      });
    });
  }

  async close(): Promise<void> {
    if (!this.server) return;
    const srv = this.server;
    this.server = null;
    return new Promise((resolve) => {
      srv.close(() => resolve());
    });
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const parsedUrl = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const pathname = parsedUrl.pathname;

    if (pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, server: 'grace-booth-offline-delivery' }));
      return;
    }

    // Match /photo/:token/image or /download/:token/image
    const imageMatch = /^\/(?:photo|download)\/([a-zA-Z0-9_-]+)\/image$/.exec(pathname);
    if (imageMatch?.[1]) {
      const token = imageMatch[1];
      this.servePhotoJpeg(token, parsedUrl.searchParams.has('download'), res);
      return;
    }

    // Match /photo/:token or /download/:token
    const pageMatch = /^\/(?:photo|download)\/([a-zA-Z0-9_-]+)$/.exec(pathname);
    if (pageMatch?.[1]) {
      const token = pageMatch[1];
      this.servePhotoHtml(token, res);
      return;
    }

    // Match /photo or /download (client-side hash navigation, e.g. /photo#<token>)
    if (pathname === '/photo' || pathname === '/download') {
      this.servePhotoHashHtml(res);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }

  private resolveAssetByToken(
    token: string,
  ): { session: StoredSession; asset: StoredAsset } | null {
    // Check in-memory cache first
    const cached = this.tokenCache.get(token);
    if (cached) {
      const session = this.repository.getSession(cached.sessionId);
      const asset = this.repository.getAsset(cached.assetId);
      if (session && asset) return { session, asset };
    }

    // Fallback: search sessions with publicSecretRef
    const recentSessions = this.repository.listSessionsWithPublicSecret(100);
    for (const session of recentSessions) {
      if (!session.publicSecretRef || !session.collageAssetId) continue;
      try {
        const secret = this.secrets.getJson(session.publicSecretRef) as PublicDeliverySecret;
        if (secret.publicToken === token) {
          const asset = this.repository.getAsset(session.collageAssetId);
          if (asset) {
            this.tokenCache.set(token, { sessionId: session.id, assetId: asset.id });
            return { session, asset };
          }
        }
      } catch {
        // continue
      }
    }

    return null;
  }

  private servePhotoJpeg(token: string, isDownload: boolean, res: ServerResponse): void {
    const resolved = this.resolveAssetByToken(token);
    if (!resolved) {
      res.writeHead(404, { 'Content-Type': 'text/plain', ...BASE_SECURITY_HEADERS });
      res.end('Photo not found or expired');
      return;
    }

    try {
      const bytes = this.vault.read(resolved.asset.encryptedPath);
      const headers: Record<string, string | number> = {
        'Content-Type': 'image/jpeg',
        'Content-Length': bytes.byteLength,
        'Cache-Control': 'private, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      };
      if (isDownload) {
        headers['Content-Disposition'] = 'attachment; filename="mat-photobooth-keepsake.jpg"';
      }
      res.writeHead(200, headers);
      res.end(bytes);
    } catch {
      res.writeHead(500, { 'Content-Type': 'text/plain', ...BASE_SECURITY_HEADERS });
      res.end('Error loading photo asset');
    }
  }

  private sendHtmlPage(res: ServerResponse, statusCode: number, state: OfflinePageState): void {
    res.writeHead(statusCode, {
      'Content-Type': 'text/html; charset=utf-8',
      ...SECURITY_HEADERS[state.kind],
    });
    res.end(renderOfflinePage(state));
  }

  private servePhotoHtml(token: string, res: ServerResponse): void {
    const resolved = this.resolveAssetByToken(token);
    if (!resolved) {
      this.sendHtmlPage(res, 404, { kind: 'not-found' });
      return;
    }
    this.sendHtmlPage(res, 200, { kind: 'ready', token });
  }

  private servePhotoHashHtml(res: ServerResponse): void {
    this.sendHtmlPage(res, 200, { kind: 'hash' });
  }
}
