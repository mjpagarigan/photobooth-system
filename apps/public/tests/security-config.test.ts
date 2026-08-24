// @vitest-environment node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderCloudflarePagesHeaders, validateEnvironment } from '../vite.config';

const appDirectory = process.cwd();
const htmlTemplate = readFileSync(resolve(appDirectory, 'index.html'), 'utf8');

function responseCsp(rendered: string): string {
  const match = /^ {2}Content-Security-Policy: (default-src .+)$/mu.exec(rendered);
  if (!match?.[1]) throw new Error('Rendered Cloudflare Pages headers have no CSP');
  return match[1];
}

function htmlCsp(source: string): string {
  const match = /content="(default-src [^"]+)"/u.exec(source);
  if (!match?.[1]) throw new Error('HTML template has no CSP');
  return match[1];
}

describe('production security configuration', () => {
  it('keeps HTML and Cloudflare Pages CSPs exact and placeholder-free after rendering', () => {
    const apiUrl = 'https://project-ref.supabase.co/functions/v1/photo';
    const apiOrigin = new URL(apiUrl).origin;
    const r2Origin = 'https://bucket.account.r2.cloudflarestorage.com';
    const environment = validateEnvironment('production', {
      VITE_PUBLIC_PHOTO_API_URL: apiUrl,
      VITE_PUBLIC_PAGE_ORIGIN: 'https://photos.example.org',
      VITE_PUBLIC_R2_ORIGIN: r2Origin,
    });
    const renderedHeaders = renderCloudflarePagesHeaders(environment);
    const renderedHtml = htmlTemplate
      .replaceAll('__PHOTO_API_ORIGIN__', apiOrigin)
      .replaceAll('__PUBLIC_PAGE_ORIGIN__', 'https://photos.example.org')
      .replaceAll('__R2_ORIGIN__', r2Origin)
      .replaceAll('__UPGRADE_INSECURE_REQUESTS__', 'upgrade-insecure-requests');

    expect(responseCsp(renderedHeaders)).toBe(htmlCsp(renderedHtml));
    expect(renderedHeaders).not.toMatch(/__[A-Z0-9_]+__/u);
    expect(renderedHtml).not.toMatch(/__[A-Z_]+__/u);
    expect(responseCsp(renderedHeaders)).not.toMatch(/unsafe-inline|unsafe-eval/u);
    expect(responseCsp(renderedHeaders)).toContain(`connect-src ${apiOrigin} ${r2Origin}`);
    expect(htmlCsp(renderedHtml)).toContain(`connect-src ${apiOrigin} ${r2Origin}`);
    expect(responseCsp(renderedHeaders)).toContain("img-src 'self' blob:");
    expect(responseCsp(renderedHeaders)).not.toContain(`img-src ${r2Origin}`);
    expect(renderedHeaders).toContain('/photo\n  Cache-Control: private, no-store');
    expect(renderedHeaders).toContain('/photo/*\n  Cache-Control: private, no-store');
    expect(appDirectory).toMatch(/[\\/]apps[\\/]public$/u);
  });

  it('rejects unsafe or decorated production API endpoints', () => {
    for (const url of [
      'http://project-ref.supabase.co/functions/v1/photo',
      'https://user:password@project-ref.supabase.co/functions/v1/photo',
      'https://project-ref.supabase.co/functions/v1/photo?token=bad',
      'https://project-ref.supabase.co/functions/v1/other',
    ]) {
      expect(() =>
        validateEnvironment('production', {
          VITE_PUBLIC_PHOTO_API_URL: url,
          VITE_PUBLIC_PAGE_ORIGIN: 'https://photos.example.org',
          VITE_PUBLIC_R2_ORIGIN: 'https://r2.example',
        }),
      ).toThrow();
    }
  });

  it('rejects missing or decorated R2 origins', () => {
    const apiUrl = 'https://project-ref.supabase.co/functions/v1/photo';
    for (const origin of [
      undefined,
      'http://bucket.account.r2.cloudflarestorage.com',
      'https://user:password@bucket.account.r2.cloudflarestorage.com',
      'https://bucket.account.r2.cloudflarestorage.com:8443',
      'https://bucket.account.r2.cloudflarestorage.com/path',
      'https://bucket.account.r2.cloudflarestorage.com?query=value',
    ]) {
      expect(() =>
        validateEnvironment('production', {
          VITE_PUBLIC_PHOTO_API_URL: apiUrl,
          VITE_PUBLIC_PAGE_ORIGIN: 'https://photos.example.org',
          ...(origin === undefined ? {} : { VITE_PUBLIC_R2_ORIGIN: origin }),
        }),
      ).toThrow();
    }
  });

  it('fails production Vite configuration when required origins are absent or invalid', () => {
    expect(() => validateEnvironment('production', {})).toThrow(/are required/i);
    expect(() =>
      validateEnvironment('production', {
        VITE_PUBLIC_PHOTO_API_URL: 'https://project-ref.supabase.co/functions/v1/photo',
        VITE_PUBLIC_PAGE_ORIGIN: 'https://photos.example.org',
        VITE_PUBLIC_R2_ORIGIN: 'https://bucket.account.r2.cloudflarestorage.com/path',
      }),
    ).toThrow(/R2_ORIGIN/i);

    expect(
      validateEnvironment('production', {
        VITE_PUBLIC_PHOTO_API_URL: 'https://project-ref.supabase.co/functions/v1/photo',
        VITE_PUBLIC_PAGE_ORIGIN: 'https://photos.example.org',
        VITE_PUBLIC_R2_ORIGIN: 'https://bucket.account.r2.cloudflarestorage.com',
      }),
    ).toMatchObject({
      pageOrigin: 'https://photos.example.org',
      r2Origin: 'https://bucket.account.r2.cloudflarestorage.com',
    });
  });
});
