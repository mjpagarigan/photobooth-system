import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { LocalRepository, StoredAsset, StoredSession } from '../database/repositories.js';
import type { PhotoVault } from '../storage/photo-vault.js';
import type { SecretStore } from '../storage/secret-store.js';
import type { PublicDeliverySecret } from '../cloud/upload-queue.js';

export type OfflineDeliveryServerOptions = {
  port: number;
};

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
          console.warn(`[OfflineDeliveryServer] Port ${this.port} is in use; offline delivery listener could not bind.`);
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

  private resolveAssetByToken(token: string): { session: StoredSession; asset: StoredAsset } | null {
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
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Photo not found or expired');
      return;
    }

    try {
      const bytes = this.vault.read(resolved.asset.encryptedPath);
      const headers: Record<string, string | number> = {
        'Content-Type': 'image/jpeg',
        'Content-Length': bytes.byteLength,
        'Cache-Control': 'public, max-age=86400',
      };
      if (isDownload) {
        headers['Content-Disposition'] = 'attachment; filename="grace-booth-photo.jpg"';
      }
      res.writeHead(200, headers);
      res.end(bytes);
    } catch {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Error loading photo asset');
    }
  }

  private servePhotoHtml(token: string, res: ServerResponse): void {
    const resolved = this.resolveAssetByToken(token);
    if (!resolved) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html>
<html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Grace Booth</title>
<style>body{font-family:"Segoe UI Variable","Segoe UI",system-ui,sans-serif;background:#f5f5f5;color:#242424;text-align:center;padding:3rem 1rem;}h1{font-size:24px;line-height:32px;font-weight:600}p{color:#424242;font-size:14px;line-height:20px}</style>
</head><body><h1>Photo not found</h1><p>This photo may have expired or is not available on this booth.</p></body></html>`);
      return;
    }

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <title>Grace Booth - Your Photo</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: "Segoe UI Variable", "Segoe UI", system-ui, sans-serif;
      background: #f5f5f5;
      color: #242424;
      display: flex;
      flex-direction: column;
      align-items: center;
      min-height: 100dvh;
      padding: 1.25rem 1rem 2.5rem;
    }
    .header {
      text-align: center;
      margin-bottom: 1.25rem;
    }
    .header h1 {
      font-size: 1.5rem;
      font-weight: 600;
      color: #242424;
    }
    .header p {
      font-size: 0.875rem;
      color: #616161;
      margin-top: 0.25rem;
    }
    .card {
      background: #ffffff;
      border: 1px solid #e0e0e0;
      border-radius: 8px;
      padding: 0.875rem;
      max-width: 440px;
      width: 100%;
      box-shadow: 0 0 2px rgba(0, 0, 0, 0.12), 0 8px 16px rgba(0, 0, 0, 0.14);
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .image-container {
      width: 100%;
      border-radius: 4px;
      overflow: hidden;
      background: #f5f5f5;
      display: flex;
      justify-content: center;
    }
    .image-container img {
      width: 100%;
      height: auto;
      display: block;
      border-radius: 2px;
    }
    .actions {
      width: 100%;
      margin-top: 1.25rem;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
    .download-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      background: #0f6cbd;
      color: #ffffff;
      text-decoration: none;
      font-weight: 600;
      font-size: 1rem;
      min-height: 48px;
      padding: 0.75rem 1.5rem;
      border-radius: 4px;
      box-shadow: 0 0 2px rgba(0, 0, 0, 0.12), 0 1px 2px rgba(0, 0, 0, 0.14);
      transition: background 0.1s ease;
    }
    .download-btn:active {
      background: #0c3b5e;
    }
    .tip {
      font-size: 0.775rem;
      color: #616161;
      text-align: center;
      line-height: 1.4;
      padding: 0 0.5rem;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Grace Booth</h1>
    <p>Your photobooth collage is ready</p>
  </div>
  <div class="card">
    <div class="image-container">
      <img src="/photo/${token}/image" alt="Grace Booth Photobooth Collage" />
    </div>
    <div class="actions">
      <a href="/photo/${token}/image?download=1" download="grace-booth-photo.jpg" class="download-btn">
        Save image
      </a>
      <p class="tip">Tap and hold the image to save directly to your camera roll, or tap the button above.</p>
    </div>
  </div>
</body>
</html>`;

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  }

  private servePhotoHashHtml(res: ServerResponse): void {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <title>Grace Booth - Your Photo</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: "Segoe UI Variable", "Segoe UI", system-ui, sans-serif;
      background: #f5f5f5;
      color: #242424;
      display: flex;
      flex-direction: column;
      align-items: center;
      min-height: 100dvh;
      padding: 1.25rem 1rem 2.5rem;
    }
    .header {
      text-align: center;
      margin-bottom: 1.25rem;
    }
    .header h1 {
      font-size: 1.5rem;
      font-weight: 600;
      color: #242424;
    }
    .header p {
      font-size: 0.875rem;
      color: #616161;
      margin-top: 0.25rem;
    }
    .card {
      background: #ffffff;
      border: 1px solid #e0e0e0;
      border-radius: 8px;
      padding: 0.875rem;
      max-width: 440px;
      width: 100%;
      box-shadow: 0 0 2px rgba(0, 0, 0, 0.12), 0 8px 16px rgba(0, 0, 0, 0.14);
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .image-container {
      width: 100%;
      min-height: 300px;
      border-radius: 4px;
      overflow: hidden;
      background: #f5f5f5;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .image-container img {
      width: 100%;
      height: auto;
      display: block;
      border-radius: 2px;
    }
    .actions {
      width: 100%;
      margin-top: 1.25rem;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
    }
    .download-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      background: #0f6cbd;
      color: #ffffff;
      text-decoration: none;
      font-weight: 600;
      font-size: 1rem;
      min-height: 48px;
      padding: 0.75rem 1.5rem;
      border-radius: 4px;
      box-shadow: 0 0 2px rgba(0, 0, 0, 0.12), 0 1px 2px rgba(0, 0, 0, 0.14);
      transition: background 0.1s ease;
    }
    .download-btn:active {
      background: #0c3b5e;
    }
    .tip {
      font-size: 0.775rem;
      color: #616161;
      text-align: center;
      line-height: 1.4;
      padding: 0 0.5rem;
    }
    .error-msg {
      display: none;
      color: #c50f1f;
      padding: 1.5rem 0;
      font-weight: 500;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>Grace Booth</h1>
    <p>Your photobooth collage is ready</p>
  </div>
  <div class="card">
    <div class="image-container">
      <img id="photo-img" style="display:none;" alt="Grace Booth Photobooth Collage" />
      <p id="loading-txt" style="color:#616161;">Loading your photo…</p>
      <p id="error-txt" class="error-msg">Photo not found or link has expired.</p>
    </div>
    <div class="actions" id="actions-panel" style="display:none;">
      <a id="download-link" href="#" download="grace-booth-photo.jpg" class="download-btn">
        Save image
      </a>
      <p class="tip">Tap and hold the image to save directly to your camera roll, or tap the button above.</p>
    </div>
  </div>
  <script>
    (function() {
      const hash = window.location.hash.replace('#', '').trim();
      const params = new URLSearchParams(window.location.search);
      const token = hash || params.get('token');
      const img = document.getElementById('photo-img');
      const loading = document.getElementById('loading-txt');
      const errorTxt = document.getElementById('error-txt');
      const actions = document.getElementById('actions-panel');
      const downloadLink = document.getElementById('download-link');

      if (!token) {
        loading.style.display = 'none';
        errorTxt.style.display = 'block';
        return;
      }

      const imageUrl = '/photo/' + encodeURIComponent(token) + '/image';
      img.onload = function() {
        loading.style.display = 'none';
        img.style.display = 'block';
        actions.style.display = 'flex';
        downloadLink.href = imageUrl + '?download=1';
      };
      img.onerror = function() {
        loading.style.display = 'none';
        errorTxt.style.display = 'block';
      };
      img.src = imageUrl;
    })();
  </script>
</body>
</html>`;

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  }
}
