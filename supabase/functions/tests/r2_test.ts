import {
  type GetObjectCommandInput,
  type HeadObjectCommandInput,
  S3Client,
} from 'npm:@aws-sdk/client-s3@^3.750.0';
import { assertEquals, assertRejects } from 'jsr:@std/assert@1.0.14';
import { ApiError } from '../_shared/errors.ts';
import { checkR2ObjectExists, createR2PresignedGetUrl } from '../_shared/r2.ts';

function signingClient(): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: 'https://account.r2.cloudflarestorage.com',
    credentials: {
      accessKeyId: 'test-access-key',
      secretAccessKey: 'test-secret-key',
    },
  });
}

Deno.test('R2 GET signing is private, controlled, and bounded to 300 seconds', async () => {
  const previousBucket = Deno.env.get('R2_BUCKET_NAME');
  Deno.env.set('R2_BUCKET_NAME', 'private-photos');
  const client = signingClient();
  try {
    let commandInput: GetObjectCommandInput | undefined;
    let signedExpiry = 0;
    const signed = await createR2PresignedGetUrl(
      client,
      'private/object.jpg',
      'attachment',
      300,
      (_client, command, options) => {
        commandInput = command.input;
        signedExpiry = options.expiresIn;
        return Promise.resolve(
          'https://bucket.account.r2.cloudflarestorage.com/private/object.jpg?X-Amz-Signature=test',
        );
      },
    );
    assertEquals(new URL(signed).protocol, 'https:');
    assertEquals(signedExpiry, 300);
    assertEquals(commandInput?.Bucket, 'private-photos');
    assertEquals(commandInput?.Key, 'private/object.jpg');
    assertEquals(commandInput?.ResponseContentType, 'image/jpeg');
    assertEquals(
      commandInput?.ResponseContentDisposition,
      'attachment; filename="mat-photobooth-keepsake.jpg"',
    );
    assertEquals(
      commandInput?.ResponseCacheControl,
      'private, no-store, max-age=0',
    );

    await assertRejects(
      () => createR2PresignedGetUrl(client, 'private/object.jpg', 'inline', 0),
      ApiError,
    );
    await assertRejects(
      () => createR2PresignedGetUrl(client, 'private/object.jpg', 'inline', 301),
      ApiError,
    );
  } finally {
    client.destroy();
    if (previousBucket === undefined) Deno.env.delete('R2_BUCKET_NAME');
    else Deno.env.set('R2_BUCKET_NAME', previousBucket);
  }
});

Deno.test('R2 HEAD verification uses native fetch for bodyless responses', async () => {
  const previousBucket = Deno.env.get('R2_BUCKET_NAME');
  Deno.env.set('R2_BUCKET_NAME', 'private-photos');
  const client = signingClient();
  try {
    let commandInput: HeadObjectCommandInput | undefined;
    let signedExpiry = 0;
    let requestMethod: string | undefined;
    let redirectMode: RequestRedirect | undefined;
    const signer = (
      _client: S3Client,
      command: { input: HeadObjectCommandInput },
      options: { expiresIn: number },
    ) => {
      commandInput = command.input;
      signedExpiry = options.expiresIn;
      return Promise.resolve(
        'https://account.r2.cloudflarestorage.com/private-photos/private/object.jpg?X-Amz-Signature=test',
      );
    };

    const existing = await checkR2ObjectExists(
      client,
      'private/object.jpg',
      signer,
      (_input, init) => {
        requestMethod = init?.method;
        redirectMode = init?.redirect;
        return Promise.resolve(
          new Response(null, { status: 200, headers: { 'content-length': '1234' } }),
        );
      },
    );
    assertEquals(existing, { exists: true, byteSize: 1234 });
    assertEquals(commandInput?.Bucket, 'private-photos');
    assertEquals(commandInput?.Key, 'private/object.jpg');
    assertEquals(signedExpiry, 30);
    assertEquals(requestMethod, 'HEAD');
    assertEquals(redirectMode, 'error');

    const missing = await checkR2ObjectExists(
      client,
      'private/missing.jpg',
      signer,
      () => Promise.resolve(new Response(null, { status: 404 })),
    );
    assertEquals(missing, { exists: false, byteSize: null });

    await assertRejects(
      () =>
        checkR2ObjectExists(
          client,
          'private/forbidden.jpg',
          signer,
          () => Promise.resolve(new Response(null, { status: 403 })),
        ),
      ApiError,
    );
  } finally {
    client.destroy();
    if (previousBucket === undefined) Deno.env.delete('R2_BUCKET_NAME');
    else Deno.env.set('R2_BUCKET_NAME', previousBucket);
  }
});
