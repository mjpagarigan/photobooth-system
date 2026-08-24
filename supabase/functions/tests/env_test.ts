import { assertEquals, assertThrows } from 'jsr:@std/assert@1.0.14';
import { ApiError } from '../_shared/errors.ts';
import { hasCompleteR2Configuration, parsePublicTokenDerivationKey } from '../_shared/env.ts';

Deno.test('token derivation keys accept hex, base64, and base64url with at least 32 bytes', () => {
  const bytes = Uint8Array.from({ length: 32 }, (_, index) => index);
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  const base64 = btoa(String.fromCharCode(...bytes));
  const base64url = base64.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');

  assertEquals(parsePublicTokenDerivationKey(hex), bytes);
  assertEquals(parsePublicTokenDerivationKey(base64), bytes);
  assertEquals(parsePublicTokenDerivationKey(base64url), bytes);
  assertThrows(
    () => parsePublicTokenDerivationKey('aa'.repeat(31)),
    ApiError,
    'The token service is not configured.',
  );
});

Deno.test('R2 configuration is either complete or fails closed', () => {
  assertEquals(
    hasCompleteR2Configuration({
      accountId: undefined,
      accessKeyId: undefined,
      secretAccessKey: undefined,
      bucketName: undefined,
    }),
    false,
  );
  assertEquals(
    hasCompleteR2Configuration({
      accountId: 'account',
      accessKeyId: 'access',
      secretAccessKey: 'secret',
      bucketName: 'bucket',
    }),
    true,
  );
  assertThrows(
    () =>
      hasCompleteR2Configuration({
        accountId: 'partial',
        accessKeyId: undefined,
        secretAccessKey: undefined,
        bucketName: undefined,
      }),
    ApiError,
    'The photo storage service is not configured.',
  );
});
