import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';

import { protocol } from 'electron';
import { z } from 'zod';

import type { MediaService } from '../storage/media-service.js';
import { resolveInside } from '../storage/paths.js';

const MediaIdSchema = z.uuid();

export function registerPrivilegedSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'app',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: false,
        stream: true,
      },
    },
    {
      scheme: 'grace-booth-media',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: false,
        stream: true,
      },
    },
  ]);
}

export function installProtocolHandlers(rendererRoot: string, media: MediaService): void {
  protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    if (url.hostname !== 'grace-booth') return new Response('Not found', { status: 404 });
    const relativePath = decodeURIComponent(
      url.pathname === '/' ? '/index.html' : url.pathname,
    ).slice(1);
    if (!relativePath || relativePath.includes('\0'))
      return new Response('Not found', { status: 404 });
    try {
      const absolute = resolveInside(resolve(rendererRoot), relativePath);
      const bytes = await readFile(absolute);
      return new Response(bytes, {
        status: 200,
        headers: {
          'content-type': contentType(extname(absolute)),
          'content-security-policy': [
            "default-src 'self'",
            "script-src 'self'",
            "style-src 'self' 'unsafe-inline'",
            "font-src 'self' data:",
            "img-src 'self' data: grace-booth-media:",
            "media-src 'self' blob: mediastream:",
            "connect-src 'self'",
            "object-src 'none'",
            "base-uri 'none'",
            "frame-ancestors 'none'",
            "form-action 'none'",
          ].join('; '),
          'cross-origin-opener-policy': 'same-origin',
          'x-content-type-options': 'nosniff',
          'referrer-policy': 'no-referrer',
          'cache-control':
            relativePath === 'index.html' ? 'no-store' : 'public, max-age=31536000, immutable',
        },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });

  protocol.handle('grace-booth-media', (request) => readMediaResponse(request, media));
}

export async function readMediaResponse(request: Request, media: MediaService): Promise<Response> {
  const url = new URL(request.url);
  if (url.hostname !== 'asset' && url.hostname !== 'thumb') {
    return new Response('Not found', { status: 404 });
  }
  const parsed = MediaIdSchema.safeParse(url.pathname.slice(1));
  if (!parsed.success) return new Response('Not found', { status: 404 });
  try {
    const value =
      url.hostname === 'thumb' ? await media.readThumbnail(parsed.data) : media.read(parsed.data);
    return new Response(value.bytes, {
      status: 200,
      headers: {
        'content-type': value.contentType,
        'cache-control': 'no-store, private',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}

function contentType(extension: string): string {
  switch (extension.toLowerCase()) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
    case '.mjs':
      return 'application/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.woff2':
      return 'font/woff2';
    case '.wav':
      return 'audio/wav';
    default:
      return 'application/octet-stream';
  }
}
