import { assertEquals } from 'jsr:@std/assert@1.0.14';

import {
  dateBasedStoragePath,
  parseCaptureTime,
  resolveAvailableStoragePath,
  suffixedObjectPath,
} from '../create-upload/index.ts';
import type { AdminClient } from '../_shared/supabase.ts';

Deno.test('formats the capture timestamp into MM-DD-YYYY folder and object name', () => {
  const path = dateBasedStoragePath(new Date('2026-08-24T14:32:05Z'));
  assertEquals(path, '08-24-2026/08-24-2026-14-32-05.jpg');
});

Deno.test('collision suffixes are inserted before the extension', () => {
  const base = dateBasedStoragePath(new Date('2026-08-24T14:32:05Z'));
  assertEquals(suffixedObjectPath(base, 2), '08-24-2026/08-24-2026-14-32-05-2.jpg');
  assertEquals(suffixedObjectPath(base, 12), '08-24-2026/08-24-2026-14-32-05-12.jpg');
});

Deno.test('absent or garbage capture timestamps fall back to the current UTC time', () => {
  const before = Date.now();
  for (const raw of [undefined, null, '', 'not-a-date', '2026-02-30T99:00:00Z', 42, {}]) {
    const resolved = parseCaptureTime(raw);
    const year = resolved.getUTCFullYear();
    const ms = resolved.getTime();
    if (Number.isFinite(ms) && ms >= before - 5_000 && ms <= before + 60_000 && year >= 1970) {
      // Falls in the "now" window: acceptable fallback.
      continue;
    }
    throw new Error(`Expected a current-time fallback for ${JSON.stringify(raw)}`);
  }
  const explicit = parseCaptureTime('2026-08-24T14:32:05Z');
  assertEquals(explicit.toISOString(), '2026-08-24T14:32:05.000Z');
});

function fakeAdminWithExistingNames(
  existing: string[],
): AdminClient {
  return {
    storage: {
      from: () => ({
        list: () =>
          Promise.resolve({
            data: existing.map((name) => ({ name })),
            error: null,
          }),
      }),
    },
  } as unknown as AdminClient;
}

Deno.test('same-second second upload resolves a -2 suffix via the existence probe', async () => {
  const base = '08-24-2026/08-24-2026-14-32-05.jpg';
  const admin = fakeAdminWithExistingNames(['08-24-2026-14-32-05.jpg']);
  const resolved = await resolveAvailableStoragePath(admin, base);
  assertEquals(resolved, '08-24-2026/08-24-2026-14-32-05-2.jpg');
});

Deno.test('a free candidate key is returned untouched', async () => {
  const admin = fakeAdminWithExistingNames([]);
  const resolved = await resolveAvailableStoragePath(
    admin,
    '01-01-2027/01-01-2027-00-00-09.jpg',
  );
  assertEquals(resolved, '01-01-2027/01-01-2027-00-00-09.jpg');
});
