import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { OfflineDeliveryServer } from '../../src/main/server/offline-delivery-server.js';
import { createTestStore, type TestStore } from './helpers.js';
import type { PublicDeliverySecret } from '../../src/main/cloud/upload-queue.js';

let store: TestStore | null = null;
let server: OfflineDeliveryServer | null = null;

afterEach(async () => {
  if (server) {
    await server.close();
    server = null;
  }
  if (store) {
    store.close();
    store = null;
  }
});

describe('Offline Delivery Server', () => {
  it('serves health check, Apple-styled photo pages with security headers, and JPEG downloads', async () => {
    store = createTestStore();
    const port = 4_321;
    server = new OfflineDeliveryServer(store.repository, store.vault, store.secrets, port);
    await server.start();

    const healthRes = await fetch(`http://127.0.0.1:${port}/health`);
    expect(healthRes.status).toBe(200);
    const healthJson = (await healthRes.json()) as { ok?: boolean };
    expect(healthJson.ok).toBe(true);

    const sessionId = randomUUID();
    store.repository.createSession(sessionId);
    store.database.raw
      .prepare("UPDATE sessions SET state = 'processing', capture_count = 3 WHERE id = ?")
      .run(sessionId);
    const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    const stored = store.vault.write('completed', jpegBytes);
    const assetId = randomUUID();
    store.repository.saveCollageAndQueue(
      {
        id: assetId,
        sessionId,
        kind: 'collage',
        retakeRound: 0,
        shotNumber: null,
        encryptedPath: stored.relativePath,
        width: 1800,
        height: 1200,
        byteSize: stored.byteSize,
        sha256: stored.sha256,
        createdAt: Date.now(),
      },
      randomUUID(),
      Date.now(),
    );

    const token = 'test-token-abcdef123456789012345678901234567';
    const secret: PublicDeliverySecret = {
      version: 1,
      photoSessionId: `local-${sessionId}`,
      publicToken: token,
      ready: {
        status: 'ready',
        readyAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
        publicPageOrigin: `http://127.0.0.1:${port}`,
        publicPath: '/photo',
      },
    };
    const secretRef = store.secrets.writeNamedJson(`public-delivery-${sessionId}`, secret);
    store.database.raw
      .prepare('UPDATE sessions SET public_secret_ref = ?, collage_asset_id = ? WHERE id = ?')
      .run(secretRef, assetId, sessionId);

    server.registerToken(token, sessionId, assetId);

    function assertAppleHtmlContract(res: Response, html: string, expectedScriptSrc: string): void {
      expect(res.headers.get('x-content-type-options')).toBe('nosniff');
      expect(res.headers.get('x-frame-options')).toBe('DENY');
      expect(res.headers.get('referrer-policy')).toBe('no-referrer');
      expect(res.headers.get('cache-control')).toBe('private, no-store');
      const csp = res.headers.get('content-security-policy');
      expect(csp).toContain("img-src 'self'");
      expect(csp).toContain(expectedScriptSrc);

      expect(html).toContain('M.A.T. Photobooth');
      expect(html).toContain('Local Wi-Fi');
      expect(html).toContain('#f5f5f7');
      expect(html).toContain('#0066cc');
      expect(html).toContain('viewport-fit=cover');

      expect(html).not.toContain('Segoe UI');
      expect(html).not.toContain('#0f6cbd');
      expect(html).not.toContain('#f5f5f5');
      expect(html).not.toContain('user-scalable=no');
      expect(html).not.toContain('Your photobooth collage is ready');
    }

    const pageRes = await fetch(`http://127.0.0.1:${port}/photo/${token}`);
    expect(pageRes.status).toBe(200);
    const readyHtml = await pageRes.text();
    assertAppleHtmlContract(pageRes, readyHtml, "script-src 'none'");
    expect(readyHtml).toContain(`/photo/${token}/image`);
    expect(readyHtml).toContain('download="mat-photobooth-keepsake.jpg"');

    const hashRes = await fetch(`http://127.0.0.1:${port}/photo`);
    expect(hashRes.status).toBe(200);
    const hashHtml = await hashRes.text();
    assertAppleHtmlContract(hashRes, hashHtml, "script-src 'unsafe-inline'");
    expect(hashHtml).toContain('Opening your keepsake.');
    expect(hashHtml).toContain('We could not open this photo.');
    expect(hashHtml).toContain('role="alert"');
    expect(hashHtml).toContain('aria-live="polite"');
    expect(hashHtml).toContain('#e8e8ed');
    expect(hashHtml).toContain('download="mat-photobooth-keepsake.jpg"');

    const notFoundRes = await fetch(`http://127.0.0.1:${port}/photo/unknown-token-value`);
    expect(notFoundRes.status).toBe(404);
    const notFoundHtml = await notFoundRes.text();
    assertAppleHtmlContract(notFoundRes, notFoundHtml, "script-src 'none'");
    expect(notFoundHtml).toContain('We could not open this photo.');

    const imgRes = await fetch(`http://127.0.0.1:${port}/photo/${token}/image`);
    expect(imgRes.status).toBe(200);
    expect(imgRes.headers.get('content-type')).toBe('image/jpeg');
    expect(imgRes.headers.get('x-content-type-options')).toBe('nosniff');
    const bytes = Buffer.from(await imgRes.arrayBuffer());
    expect(bytes).toEqual(jpegBytes);

    const downloadRes = await fetch(`http://127.0.0.1:${port}/photo/${token}/image?download=1`);
    expect(downloadRes.status).toBe(200);
    expect(downloadRes.headers.get('content-disposition')).toBe(
      'attachment; filename="mat-photobooth-keepsake.jpg"',
    );
  });
});
