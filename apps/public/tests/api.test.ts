import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchPhotoDownload, fetchPhotoImage, PhotoApiError, resolvePhoto } from '../src/api';

const token = 'A'.repeat(43);
const apiOrigin = 'https://api.example.test';
const r2Origin = 'https://bucket.account.r2.cloudflarestorage.com';

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

function responseAt(
  url: string,
  body: BodyInit | null,
  init: ResponseInit,
  redirected = false,
): Response {
  const response = new Response(body, init);
  Object.defineProperties(response, {
    url: { value: url },
    redirected: { value: redirected },
  });
  return response;
}

function jpegResponse(origin: string, redirected: boolean): Response {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xd9]);
  return responseAt(
    `${origin}/private/photo.jpg`,
    bytes,
    {
      status: 200,
      headers: { 'Content-Type': 'image/jpeg', 'Content-Length': String(bytes.byteLength) },
    },
    redirected,
  );
}

describe('photo API client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  it('resolves by POSTing the token only in the body', async () => {
    vi.mocked(fetch).mockResolvedValue(
      responseAt(
        `${apiOrigin}/functions/v1/photo/resolve`,
        JSON.stringify({
          status: 'ready',
          expiresAt: '2026-09-16T10:00:00.000Z',
          googleFormsUrl: null,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    await expect(resolvePhoto(token)).resolves.toMatchObject({ status: 'ready' });
    const [url, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(url ? requestUrl(url) : '').toBe('https://api.example.test/functions/v1/photo/resolve');
    expect(url ? requestUrl(url) : '').not.toContain(token);
    expect(init).toMatchObject({
      method: 'POST',
      credentials: 'omit',
      redirect: 'follow',
      referrerPolicy: 'no-referrer',
    });
    expect(init?.body).toBe(JSON.stringify({ token }));
  });

  it('uses separate controlled image and download POST routes', async () => {
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(jpegResponse(r2Origin, true)));

    await fetchPhotoImage(token);
    await fetchPhotoDownload(token);
    expect(vi.mocked(fetch).mock.calls.map(([url]) => requestUrl(url))).toEqual([
      'https://api.example.test/functions/v1/photo/image',
      'https://api.example.test/functions/v1/photo/download',
    ]);
    expect(
      vi.mocked(fetch).mock.calls.every(([, init]) => init?.body === JSON.stringify({ token })),
    ).toBe(true);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it('accepts only the configured R2 origin after a redirect', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jpegResponse(r2Origin, true));
    await expect(fetchPhotoImage(token)).resolves.toBeInstanceOf(Blob);

    vi.mocked(fetch).mockResolvedValueOnce(jpegResponse('https://attacker.example', true));
    const error = await fetchPhotoImage(token).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PhotoApiError);
    expect((error as PhotoApiError).message).toContain('could not load');
    expect((error as PhotoApiError).retryable).toBe(true);
  });

  it('accepts a non-redirected binary fallback only from the photo API origin', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jpegResponse(apiOrigin, false));
    await expect(fetchPhotoImage(token)).resolves.toBeInstanceOf(Blob);

    vi.mocked(fetch).mockResolvedValueOnce(jpegResponse(r2Origin, false));
    await expect(fetchPhotoImage(token)).rejects.toThrow('could not load');
  });

  it('rejects redirected responses whose content type is not image/jpeg', async () => {
    const bytes = new Uint8Array([0x3c, 0x68, 0x74, 0x6d, 0x6c, 0x3e]);
    vi.mocked(fetch).mockResolvedValueOnce(
      responseAt(
        `${r2Origin}/private/photo.html`,
        bytes,
        {
          status: 200,
          headers: { 'Content-Type': 'text/html;charset=utf-8', 'Content-Length': String(bytes.byteLength) },
        },
        true,
      ),
    );

    const error = await fetchPhotoImage(token).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PhotoApiError);
    expect((error as PhotoApiError).retryable).toBe(true);
  });

  it('rejects empty bodies even when the headers claim a JPEG', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      responseAt(`${r2Origin}/private/photo.jpg`, new Uint8Array(0), { status: 200, headers: { 'Content-Type': 'image/jpeg' } }, true),
    );

    const error = await fetchPhotoDownload(token).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PhotoApiError);
    expect((error as PhotoApiError).retryable).toBe(true);
  });

  it('rejects invalid JPEG bytes even when the response headers claim JPEG', async () => {
    const invalid = new Uint8Array([0xff, 0xd8, 0x00, 0x00, 0xff, 0xd9]);
    vi.mocked(fetch).mockResolvedValue(
      responseAt(
        `${r2Origin}/private/photo.jpg`,
        invalid,
        {
          status: 200,
          headers: {
            'Content-Type': 'image/jpeg',
            'Content-Length': String(invalid.byteLength),
          },
        },
        true,
      ),
    );

    await expect(fetchPhotoImage(token)).rejects.toThrow('could not load');
    const [url, init] = vi.mocked(fetch).mock.calls[0] ?? [];
    expect(requestUrl(url!)).not.toContain(token);
    expect(init?.body).toBe(JSON.stringify({ token }));
  });

  it('accepts JPEG responses larger than the former 12 MiB ceiling', async () => {
    const bytes = new Uint8Array(12 * 1_024 * 1_024 + 1);
    bytes.set([0xff, 0xd8, 0xff], 0);
    bytes.set([0xff, 0xd9], bytes.length - 2);
    vi.mocked(fetch).mockResolvedValue(
      responseAt(
        `${r2Origin}/private/large-photo.jpg`,
        bytes,
        {
          status: 200,
          headers: {
            'Content-Type': 'image/jpeg',
            'Content-Length': String(bytes.byteLength),
          },
        },
        true,
      ),
    );

    await expect(fetchPhotoImage(token)).resolves.toHaveProperty('size', bytes.byteLength);
  });
});
