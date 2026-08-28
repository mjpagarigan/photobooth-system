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
    const environment = validateEnvironment('production', {
      VITE_PUBLIC_PHOTO_API_URL: apiUrl,
      VITE_PUBLIC_PAGE_ORIGIN: 'https://photos.example.org',
    });
    const renderedHeaders = renderCloudflarePagesHeaders(environment);
    const renderedHtml = htmlTemplate
      .replaceAll('__PHOTO_API_ORIGIN__', apiOrigin)
      .replaceAll('__PUBLIC_PAGE_ORIGIN__', 'https://photos.example.org')
      .replaceAll('__UPGRADE_INSECURE_REQUESTS__', 'upgrade-insecure-requests');

    expect(responseCsp(renderedHeaders)).toBe(htmlCsp(renderedHtml));
    expect(renderedHeaders).not.toMatch(/__[A-Z0-9_]+__/u);
    expect(renderedHtml).not.toMatch(/__[A-Z_]+__/u);
    expect(responseCsp(renderedHeaders)).not.toMatch(/unsafe-inline|unsafe-eval/u);
    expect(responseCsp(renderedHeaders)).toContain(`connect-src ${apiOrigin}`);
    expect(htmlCsp(renderedHtml)).toContain(`connect-src ${apiOrigin}`);
    expect(responseCsp(renderedHeaders)).toContain("img-src 'self' blob:");
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
      }),
    ).not.toThrow();

    expect(
      validateEnvironment('production', {
        VITE_PUBLIC_PHOTO_API_URL: 'https://project-ref.supabase.co/functions/v1/photo',
        VITE_PUBLIC_PAGE_ORIGIN: 'https://photos.example.org',
      }),
    ).toMatchObject({
      pageOrigin: 'https://photos.example.org',
    });
  });
});
