import type { CreateUploadRequest } from '@grace-booth/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CloudSessionStore } from '../../src/main/auth/cloud-session-store.js';
import { SupabaseDeliveryClient } from '../../src/main/cloud/delivery-client.js';

const REQUEST: CreateUploadRequest = {
  action: 'create',
  clientSessionId: '11111111-1111-4111-8111-111111111111',
  contentType: 'image/jpeg',
  byteSize: 4,
  sha256: 'a'.repeat(64),
  width: 2_700,
  height: 1_800,
  googleFormsUrl: null,
  capturedAt: '2026-08-24T07:19:44.000Z',
};

const CREATE_RESPONSE = {
  photoSessionId: '22222222-2222-4222-8222-222222222222',
  publicToken: Buffer.alloc(32, 0x41).toString('base64url'),
  upload: {
    storagePath: '2026/08/22222222-2222-4222-8222-222222222222.jpg',
    signedUploadToken: Buffer.alloc(32, 0x51).toString('base64url'),
    validForSeconds: 7_200,
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Supabase delivery request compatibility', () => {
  it('retries a legacy strict create-upload function once without capturedAt', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: {
              code: 'invalid_request',
              message: 'The request body is invalid.',
              retryable: false,
            },
          },
          400,
        ),
      )
      .mockResolvedValueOnce(jsonResponse(CREATE_RESPONSE, 201));
    vi.stubGlobal('fetch', fetchMock);

    const client = createDeliveryClient();
    await expect(client.createUpload(REQUEST)).resolves.toEqual(CREATE_RESPONSE);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestBody(fetchMock, 0)).toMatchObject({ capturedAt: REQUEST.capturedAt });
    expect(requestBody(fetchMock, 1)).not.toHaveProperty('capturedAt');
  });

  it('preserves the nested Edge Function error code and safe message', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse(
        {
          error: {
            code: 'conflict',
            message: 'This local session already has a different upload.',
            retryable: false,
          },
        },
        409,
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = createDeliveryClient();
    const requestWithoutCaptureTime = { ...REQUEST, capturedAt: undefined };

    await expect(client.createUpload(requestWithoutCaptureTime)).rejects.toMatchObject({
      kind: 'permanent',
      code: 'conflict',
      safeMessage: 'This local session already has a different upload.',
    });
  });

  it('reports an outdated cloud schema without resizing the production strip', async () => {
    const invalidResponse = () =>
      jsonResponse(
        {
          error: {
            code: 'invalid_request',
            message: 'The request body is invalid.',
            retryable: false,
          },
        },
        400,
      );
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(invalidResponse())
      .mockResolvedValueOnce(invalidResponse());
    vi.stubGlobal('fetch', fetchMock);

    const client = createDeliveryClient();
    const productionRequest = { ...REQUEST, width: 1_200, height: 3_600 };

    await expect(client.createUpload(productionRequest)).rejects.toMatchObject({
      kind: 'permanent',
      code: 'cloud_schema_incompatible',
      safeMessage: 'The cloud photo service must be updated before this strip can upload.',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestBody(fetchMock, 0)).toMatchObject({ width: 1_200, height: 3_600 });
    expect(requestBody(fetchMock, 1)).toMatchObject({ width: 1_200, height: 3_600 });
  });
});

function createDeliveryClient(): SupabaseDeliveryClient {
  const sessions = {
    load: () => ({
      accessToken: 'test-access-token',
      refreshToken: '',
      expiresAt: Math.floor(Date.now() / 1_000) + 3_600,
      userId: '33333333-3333-4333-8333-333333333333',
    }),
    save: vi.fn(),
    clear: vi.fn(),
  } as unknown as CloudSessionStore;
  return new SupabaseDeliveryClient(
    {
      url: 'https://project.example.test',
      publishableKey: 'test-publishable-key',
    },
    sessions,
  );
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function requestBody(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>, call: number): unknown {
  const init = fetchMock.mock.calls[call]?.[1];
  if (typeof init?.body !== 'string') throw new Error('Expected a JSON request body');
  return JSON.parse(init.body) as unknown;
}
