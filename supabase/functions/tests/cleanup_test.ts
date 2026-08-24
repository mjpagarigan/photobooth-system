import { assertEquals } from 'jsr:@std/assert@1.0.14';
import type { AdminClient } from '../_shared/supabase.ts';
import { type CleanupDependencies, runCleanup } from '../cleanup-expired/index.ts';

type RpcResult = { data: unknown; error: unknown };

Deno.test('cleanup leaves failures leased and advances to later batches', async () => {
  const firstBatch = Array.from({ length: 50 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    storage_object_path: `2026/08/00000000-0000-4000-8000-${String(index).padStart(12, '0')}.jpg`,
    storage_backend: 'supabase',
    previous_status: 'expired',
  }));
  const laterClaim = {
    id: '99999999-9999-4999-8999-999999999999',
    storage_object_path: '2026/08/99999999-9999-4999-8999-999999999999.jpg',
    storage_backend: 'supabase',
    previous_status: 'deleting',
  };
  const claimResults: RpcResult[] = [
    { data: firstBatch, error: null },
    { data: [laterClaim], error: null },
  ];
  const rpcNames: string[] = [];
  const removedPaths: string[] = [];

  const admin = {
    rpc(name: string): Promise<RpcResult> {
      rpcNames.push(name);
      if (name === 'claim_photo_cleanup') {
        return Promise.resolve(claimResults.shift() ?? { data: [], error: null });
      }
      if (name === 'complete_photo_cleanup') {
        return Promise.resolve({ data: null, error: { message: 'simulated completion failure' } });
      }
      throw new Error(`Unexpected RPC ${name}`);
    },
    storage: {
      from() {
        return {
          remove(paths: string[]) {
            removedPaths.push(...paths);
            return Promise.resolve({
              error: paths[0] === laterClaim.storage_object_path
                ? null
                : { message: 'simulated storage failure' },
            });
          },
        };
      },
    },
  } as unknown as AdminClient;

  const summary = await runCleanup(
    admin,
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'photos',
  );

  assertEquals(summary, { claimed: 51, deleted: 0, failed: 51, hasMore: false });
  assertEquals(removedPaths.length, 51);
  assertEquals(rpcNames, [
    'claim_photo_cleanup',
    'claim_photo_cleanup',
    'complete_photo_cleanup',
  ]);
});

Deno.test('cleanup deletes each claim from its recorded storage backend', async () => {
  const claims = [
    {
      id: '11111111-1111-4111-8111-111111111111',
      storage_object_path: 'legacy/supabase.jpg',
      storage_backend: 'supabase',
      previous_status: 'expired',
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      storage_object_path: 'current/r2.jpg',
      storage_backend: 'r2',
      previous_status: 'expired',
    },
  ];
  let claimed = false;
  const supabaseRemoved: string[] = [];
  const r2Removed: string[] = [];
  const admin = {
    rpc(name: string): Promise<RpcResult> {
      if (name === 'claim_photo_cleanup') {
        if (claimed) return Promise.resolve({ data: [], error: null });
        claimed = true;
        return Promise.resolve({ data: claims, error: null });
      }
      return Promise.resolve({ data: true, error: null });
    },
    storage: {
      from() {
        return {
          remove(paths: string[]) {
            supabaseRemoved.push(...paths);
            return Promise.resolve({ error: null });
          },
        };
      },
    },
  } as unknown as AdminClient;
  const dependencies: CleanupDependencies = {
    isR2Configured: () => true,
    createR2Client: () => ({}) as ReturnType<CleanupDependencies['createR2Client']>,
    deleteR2Objects: (_client, paths) => {
      r2Removed.push(...paths);
      return Promise.resolve();
    },
  };

  const summary = await runCleanup(
    admin,
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'photos',
    dependencies,
  );

  assertEquals(summary, { claimed: 2, deleted: 2, failed: 0, hasMore: false });
  assertEquals(supabaseRemoved, ['legacy/supabase.jpg']);
  assertEquals(r2Removed, ['current/r2.jpg']);
});
