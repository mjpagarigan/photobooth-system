import { assertEquals, assertThrows } from 'jsr:@std/assert@1.0.14';
import {
  classifyCandidate,
  parseArguments,
  type RepairCandidate,
} from '../tools/repair-storage-backends.ts';

const CANDIDATE: RepairCandidate = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  storage_object_path: '08-27-2026/08-27-2026-08-00-00.jpg',
  storage_backend: 'supabase',
  status: 'ready',
  content_type: 'image/jpeg',
  byte_size: 100,
  content_sha256: 'a'.repeat(64),
  expires_at: '2026-09-26T00:00:00.000Z',
};

Deno.test('repair inventory classifications distinguish present, verified, and missing objects', async () => {
  assertEquals(
    await classifyCandidate(CANDIDATE, {
      verifySupabase: () => Promise.resolve('available'),
      verifyR2: () => Promise.resolve(null),
      loadCurrent: () => Promise.resolve(CANDIDATE),
      now: () => Date.parse('2026-08-27T00:00:00.000Z'),
    }),
    'supabase-present',
  );
  assertEquals(
    await classifyCandidate(CANDIDATE, {
      verifySupabase: () => Promise.resolve('missing'),
      verifyR2: () => Promise.resolve({ byteSize: 100, sha256: 'a'.repeat(64) }),
      loadCurrent: () => Promise.resolve(CANDIDATE),
      now: () => Date.parse('2026-08-27T00:00:00.000Z'),
    }),
    'r2-verified',
  );
  assertEquals(
    await classifyCandidate(CANDIDATE, {
      verifySupabase: () => Promise.resolve('missing'),
      verifyR2: () => Promise.resolve(null),
      loadCurrent: () => Promise.resolve(CANDIDATE),
      now: () => Date.parse('2026-08-27T00:00:00.000Z'),
    }),
    'missing-both',
  );
});

Deno.test('repair inventory refuses size, hash, and database drift', async () => {
  const base = {
    verifySupabase: () => Promise.resolve('missing' as const),
    loadCurrent: () => Promise.resolve(CANDIDATE),
    now: () => Date.parse('2026-08-27T00:00:00.000Z'),
  };
  assertEquals(
    await classifyCandidate(CANDIDATE, {
      ...base,
      verifyR2: () => Promise.resolve({ byteSize: 99, sha256: 'a'.repeat(64) }),
    }),
    'size-mismatch',
  );
  assertEquals(
    await classifyCandidate(CANDIDATE, {
      ...base,
      verifyR2: () => Promise.resolve({ byteSize: 100, sha256: 'b'.repeat(64) }),
    }),
    'hash-mismatch',
  );
  assertEquals(
    await classifyCandidate(CANDIDATE, {
      ...base,
      verifyR2: () => Promise.resolve({ byteSize: 100, sha256: 'a'.repeat(64) }),
      loadCurrent: () => Promise.resolve({ ...CANDIDATE, storage_backend: 'r2' }),
    }),
    'expired-or-changed',
  );
});

Deno.test('repair inventory isolates verification failures', async () => {
  assertEquals(
    await classifyCandidate(CANDIDATE, {
      verifySupabase: () => Promise.reject(new Error('credential detail must not escape')),
      verifyR2: () => Promise.resolve(null),
      loadCurrent: () => Promise.resolve(CANDIDATE),
      now: () => Date.parse('2026-08-27T00:00:00.000Z'),
    }),
    'verification-error',
  );
});

Deno.test('repair CLI defaults to dry-run and guards apply and rollback modes', () => {
  assertEquals(parseArguments([]), {
    apply: false,
    batchId: null,
    confirmCount: null,
    rollbackBatch: null,
  });
  assertThrows(() => parseArguments(['--apply']));
  assertThrows(() =>
    parseArguments([
      '--apply',
      '--batch-id',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '--confirm-count',
      '-1',
    ])
  );
  assertEquals(
    parseArguments([
      '--apply',
      '--batch-id',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      '--confirm-count',
      '7',
    ]),
    {
      apply: true,
      batchId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      confirmCount: 7,
      rollbackBatch: null,
    },
  );
  assertEquals(
    parseArguments([
      '--rollback-batch',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    ]),
    {
      apply: false,
      batchId: null,
      confirmCount: null,
      rollbackBatch: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    },
  );
});
