import { assertEquals } from 'jsr:@std/assert@1.0.14';
import type { AdminClient } from '../_shared/supabase.ts';
import { type ConfirmStorageDependencies, readUploadedBytes } from '../confirm-upload/index.ts';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xd9]);

function storageAdmin(downloaded: string[]): AdminClient {
  return {
    storage: {
      from(bucket: string) {
        return {
          download(path: string) {
            downloaded.push(`${bucket}/${path}`);
            return Promise.resolve({
              data: new Blob([JPEG], { type: 'image/jpeg' }),
              error: null,
            });
          },
        };
      },
    },
  } as unknown as AdminClient;
}

Deno.test('confirmation reads each upload from its recorded backend', async () => {
  const downloaded: string[] = [];
  const r2Paths: string[] = [];
  const dependencies: ConfirmStorageDependencies = {
    isR2Configured: () => true,
    createR2Client: () => ({}) as ReturnType<ConfirmStorageDependencies['createR2Client']>,
    getR2ObjectBytes: (_client, path) => {
      r2Paths.push(path);
      return Promise.resolve(JPEG);
    },
    photoBucket: () => 'photos',
  };
  const admin = storageAdmin(downloaded);

  const legacy = await readUploadedBytes(
    admin,
    {
      storage_backend: 'supabase',
      storage_object_path: 'legacy/photo.jpg',
      content_type: 'image/jpeg',
    },
    dependencies,
  );
  const current = await readUploadedBytes(
    admin,
    {
      storage_backend: 'r2',
      storage_object_path: 'current/photo.jpg',
      content_type: 'image/jpeg',
    },
    dependencies,
  );

  assertEquals(legacy, JPEG);
  assertEquals(current, JPEG);
  assertEquals(downloaded, ['photos/legacy/photo.jpg']);
  assertEquals(r2Paths, ['current/photo.jpg']);
});
