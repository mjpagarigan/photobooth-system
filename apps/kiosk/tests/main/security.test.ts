import { readFileSync, writeFileSync } from 'node:fs';

import { afterEach, describe, expect, it } from 'vitest';

import { AdminSessionService } from '../../src/main/auth/admin-sessions.js';
import { PasscodeService } from '../../src/main/auth/passcode-service.js';
import {
  isAcceptedVaultPlaintextSize,
  PhotoVault,
} from '../../src/main/storage/photo-vault.js';
import { resolveInside } from '../../src/main/storage/paths.js';
import { createTestStore, type TestStore } from './helpers.js';

let store: TestStore | null = null;
afterEach(() => {
  store?.close();
  store = null;
});

describe('local secret boundaries', () => {
  it('refuses to replace a missing vault key when encrypted assets exist', () => {
    store = createTestStore();
    const stored = store.vault.write('pending', Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    store.secrets.delete('secrets/photo-vault-key.sealed');
    expect(() => new PhotoVault(store!.paths, store!.secrets)).toThrow(/key is missing/i);
    expect(
      readFileSync(resolveInside(store.paths.root, stored.relativePath)).byteLength,
    ).toBeGreaterThan(0);
  });

  it('authenticates the immutable per-asset header and rejects tampering', () => {
    store = createTestStore();
    const stored = store.vault.write('pending', Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const path = resolveInside(store.paths.root, stored.relativePath);
    const bytes = readFileSync(path);
    const headerStart = 6;
    bytes[headerStart + 12] = (bytes[headerStart + 12] ?? 0) ^ 1;
    writeFileSync(path, bytes);
    expect(() => store?.vault.read(stored.relativePath)).toThrow();
  });

  it('accepts completed JPEG sizes above the former 12 MiB ceiling', () => {
    expect(isAcceptedVaultPlaintextSize('completed', 20_000_000)).toBe(true);
    expect(isAcceptedVaultPlaintextSize('completed', Number.MAX_SAFE_INTEGER)).toBe(true);
    expect(isAcceptedVaultPlaintextSize('completed', 0)).toBe(false);
    expect(isAcceptedVaultPlaintextSize('pending', 60_000_000)).toBe(false);
  });
});

describe('admin authentication hardening', () => {
  it('serializes scrypt work so concurrent requests allocate only one derivation', async () => {
    store = createTestStore();
    let active = 0;
    let maximumActive = 0;
    const derive = async (passcode: string): Promise<Buffer> => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return Buffer.alloc(64, passcode.charCodeAt(0));
    };
    const service = new PasscodeService(store.repository, derive);
    await service.bootstrap('secure-passcode');
    await Promise.all([
      service.verify('secure-passcode'),
      service.verify('secure-passcode'),
      service.verify('secure-passcode'),
    ]);
    expect(maximumActive).toBe(1);
  });

  it('rejects altered scrypt cost parameters instead of allocating attacker-selected work', async () => {
    store = createTestStore();
    const service = new PasscodeService(store.repository);
    await service.bootstrap('secure-passcode');
    store.database.raw.prepare('UPDATE settings SET scrypt_n = 1048576 WHERE id = 1').run();
    await expect(service.verify('secure-passcode')).rejects.toThrow(/invalid/i);
  });

  it('enforces sliding idle and eight-hour absolute session expiry', () => {
    const sessions = new AdminSessionService();
    sessions.authenticateRenderer(7, 0);
    for (let now = 14 * 60_000; now < 8 * 60 * 60_000; now += 14 * 60_000) {
      expect(sessions.rendererStatus(7, now)).not.toBeNull();
    }
    expect(sessions.rendererStatus(7, 8 * 60 * 60_000 + 1)).toBeNull();
  });

  it('locks a login source after five failures', () => {
    const sessions = new AdminSessionService();
    for (let index = 0; index < 5; index += 1) sessions.recordLoginResult('source', false, index);
    expect(() => sessions.assertLoginAllowed('source', 10)).toThrow(/too many/i);
  });
});
