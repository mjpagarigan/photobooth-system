import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

import { AppError } from '../errors.js';
import { writeFileAtomic } from './atomic-file.js';
import type { AppPaths } from './paths.js';
import { resolveInside } from './paths.js';
import type { SecretStore } from './secret-store.js';

const MAGIC = Buffer.from('GBV2', 'ascii');
const HEADER_LENGTH_BYTES = 2;
const NONCE_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const MAX_HEADER_BYTES = 512;
const MAX_BYTES_BY_KIND = {
  pending: 50 * 1024 * 1024,
  frames: 5 * 1024 * 1024,
} as const;

export type VaultKind = 'pending' | 'completed' | 'frames';

type VaultHeader = {
  version: 2;
  kind: VaultKind;
  id: string;
  contentType: 'image/jpeg' | 'image/png';
  plaintextBytes: number;
};

type VaultKeyRecord = {
  version: 1;
  keyBase64: string;
};

export type VaultWriteResult = {
  relativePath: string;
  byteSize: number;
  sha256: string;
};

export class PhotoVault {
  private readonly key: Buffer;

  constructor(
    private readonly paths: AppPaths,
    secrets: SecretStore,
  ) {
    const rawKeyRecord = secrets.getNamedJson('photo-vault-key');
    const existing = parseVaultKeyRecord(rawKeyRecord);
    if (existing) {
      this.key = Buffer.from(existing.keyBase64, 'base64');
      if (this.key.length !== KEY_LENGTH)
        throw new AppError('vault_key', 'Photo storage is unavailable.');
    } else {
      if (this.hasEncryptedAssets()) {
        throw new AppError(
          'vault_key_missing',
          'Encrypted booth photos exist, but their Windows-protected key is missing. Files were preserved for operator recovery.',
        );
      }
      const key = randomBytes(KEY_LENGTH);
      secrets.writeNamedJson('photo-vault-key', { version: 1, keyBase64: key.toString('base64') });
      this.key = key;
    }
  }

  write(kind: VaultKind, plaintext: Uint8Array): VaultWriteResult {
    if (!isAcceptedVaultPlaintextSize(kind, plaintext.byteLength)) {
      throw new AppError('asset_size_invalid', 'The image size is outside the safe limit.');
    }
    const id = randomUUID();
    const header: VaultHeader = {
      version: 2,
      kind,
      id,
      contentType: kind === 'frames' ? 'image/png' : 'image/jpeg',
      plaintextBytes: plaintext.byteLength,
    };
    const headerBytes = Buffer.from(JSON.stringify(header), 'utf8');
    if (headerBytes.length > MAX_HEADER_BYTES) throw new Error('Vault header exceeded its bound');
    const lengthBytes = Buffer.alloc(HEADER_LENGTH_BYTES);
    lengthBytes.writeUInt16BE(headerBytes.length);
    const authenticatedHeader = Buffer.concat([MAGIC, lengthBytes, headerBytes]);
    const nonce = randomBytes(NONCE_LENGTH);
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    cipher.setAAD(authenticatedHeader);
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    const encrypted = Buffer.concat([authenticatedHeader, nonce, tag, ciphertext]);
    const fileName = `${id}.gbv`;
    const directory = this.paths[kind];
    const absolute = join(directory, fileName);
    writeFileAtomic(absolute, encrypted);
    return {
      relativePath: `${kind}/${fileName}`,
      byteSize: plaintext.byteLength,
      sha256: createHash('sha256').update(plaintext).digest('hex'),
    };
  }

  read(relativePath: string): Buffer {
    const absolute = this.resolveAsset(relativePath);
    const encrypted = readFileSync(absolute);
    if (encrypted.length < MAGIC.length + HEADER_LENGTH_BYTES + NONCE_LENGTH + TAG_LENGTH + 1) {
      throw new AppError('asset_corrupt', 'A stored image is incomplete.');
    }
    if (!encrypted.subarray(0, MAGIC.length).equals(MAGIC)) {
      throw new AppError('asset_format', 'A stored image has an unknown format.');
    }
    const headerLength = encrypted.readUInt16BE(MAGIC.length);
    if (headerLength === 0 || headerLength > MAX_HEADER_BYTES) {
      throw new AppError('asset_header', 'A stored image has an invalid header.');
    }
    const headerStart = MAGIC.length + HEADER_LENGTH_BYTES;
    const nonceStart = headerStart + headerLength;
    if (encrypted.length < nonceStart + NONCE_LENGTH + TAG_LENGTH + 1) {
      throw new AppError('asset_corrupt', 'A stored image is incomplete.');
    }
    const authenticatedHeader = encrypted.subarray(0, nonceStart);
    const header = parseHeader(encrypted.subarray(headerStart, nonceStart));
    const normalized = relativePath.replaceAll('\\', '/');
    const expectedFile = `${header.id}.gbv`;
    if (
      normalized !== `${header.kind}/${expectedFile}` ||
      header.contentType !== (header.kind === 'frames' ? 'image/png' : 'image/jpeg') ||
      !isAcceptedVaultPlaintextSize(header.kind, header.plaintextBytes)
    ) {
      throw new AppError(
        'asset_header',
        'A stored image header does not match its file reference.',
      );
    }
    const tagStart = nonceStart + NONCE_LENGTH;
    const dataStart = tagStart + TAG_LENGTH;
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.key,
      encrypted.subarray(nonceStart, tagStart),
    );
    decipher.setAAD(authenticatedHeader);
    decipher.setAuthTag(encrypted.subarray(tagStart, dataStart));
    try {
      const plaintext = Buffer.concat([
        decipher.update(encrypted.subarray(dataStart)),
        decipher.final(),
      ]);
      if (plaintext.length !== header.plaintextBytes) {
        throw new AppError('asset_size_invalid', 'The stored image exceeds the safe limit.');
      }
      return plaintext;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        'asset_authentication_failed',
        'A stored image could not be verified.',
        false,
        {
          cause: error,
        },
      );
    }
  }

  exists(relativePath: string): boolean {
    try {
      this.read(relativePath);
      return true;
    } catch (error) {
      if (isMissingFile(error)) return false;
      throw error;
    }
  }

  delete(relativePath: string): void {
    rmSync(this.resolveAsset(relativePath), { force: true });
  }

  stageDelete(relativePath: string): { originalPath: string; stagedPath: string } {
    const originalPath = this.resolveAsset(relativePath);
    const stagedPath = join(this.paths.staging, `${randomUUID()}.delete`);
    renameSync(originalPath, stagedPath);
    return { originalPath, stagedPath };
  }

  createTombstoneReference(): string {
    return `staging/${randomUUID()}.delete`;
  }

  stageDeleteTo(relativePath: string, tombstoneReference: string): void {
    renameSync(this.resolveAsset(relativePath), this.resolveStaging(tombstoneReference));
  }

  stagingExists(tombstoneReference: string): boolean {
    try {
      statSync(this.resolveStaging(tombstoneReference));
      return true;
    } catch (error) {
      if (isMissingFile(error)) return false;
      throw error;
    }
  }

  finishTombstone(tombstoneReference: string): void {
    rmSync(this.resolveStaging(tombstoneReference), { force: true });
  }

  finishStagedDelete(stagedPath: string): void {
    const relation = relative(this.paths.staging, stagedPath);
    if (relation.startsWith('..') || relation.includes('/') || relation.includes('\\')) {
      throw new Error('Invalid staged-delete path');
    }
    rmSync(stagedPath, { force: true });
  }

  restoreStagedDelete(stagedPath: string, originalPath: string): void {
    const stagedRelation = relative(this.paths.staging, stagedPath);
    const originalRelation = relative(this.paths.root, originalPath);
    if (stagedRelation.startsWith('..') || originalRelation.startsWith('..')) {
      throw new Error('Invalid staged-delete path');
    }
    renameSync(stagedPath, originalPath);
  }

  private resolveAsset(relativePath: string): string {
    const normalized = relativePath.replaceAll('\\', '/');
    const prefix = normalized.split('/')[0];
    if (!prefix || !['pending', 'completed', 'frames'].includes(prefix)) {
      throw new Error('Invalid photo-vault reference');
    }
    if (basename(normalized) !== normalized.slice(prefix.length + 1)) {
      throw new Error('Nested photo-vault references are not supported');
    }
    const absolute = resolveInside(this.paths.root, normalized);
    if (relative(this.paths.root, absolute).startsWith('..')) {
      throw new Error('Invalid photo-vault reference');
    }
    return absolute;
  }

  private resolveStaging(reference: string): string {
    const normalized = reference.replaceAll('\\', '/');
    if (!/^staging\/[0-9a-f-]{36}\.delete$/i.test(normalized)) {
      throw new Error('Invalid tombstone reference');
    }
    return resolveInside(this.paths.root, normalized);
  }

  private hasEncryptedAssets(): boolean {
    return [this.paths.pending, this.paths.completed, this.paths.frames].some((directory) =>
      readdirSync(directory).some((name) => name.endsWith('.gbv')),
    );
  }
}

export function isAcceptedVaultPlaintextSize(kind: VaultKind, byteLength: number): boolean {
  if (!Number.isSafeInteger(byteLength) || byteLength < 1) return false;
  if (kind === 'completed') return true;
  return byteLength <= MAX_BYTES_BY_KIND[kind];
}

function parseHeader(bytes: Buffer): VaultHeader {
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new AppError('asset_header', 'A stored image has an invalid header.');
  }
  if (!value || typeof value !== 'object') {
    throw new AppError('asset_header', 'A stored image has an invalid header.');
  }
  const record = value as Record<string, unknown>;
  if (
    record.version !== 2 ||
    !['pending', 'completed', 'frames'].includes(String(record.kind)) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      String(record.id),
    ) ||
    !['image/jpeg', 'image/png'].includes(String(record.contentType)) ||
    !Number.isSafeInteger(record.plaintextBytes)
  ) {
    throw new AppError('asset_header', 'A stored image has an invalid header.');
  }
  return record as unknown as VaultHeader;
}

function parseVaultKeyRecord(value: unknown): VaultKeyRecord | null {
  if (value === null) return null;
  if (
    !value ||
    typeof value !== 'object' ||
    (value as Record<string, unknown>).version !== 1 ||
    typeof (value as Record<string, unknown>).keyBase64 !== 'string'
  ) {
    throw new AppError('vault_key', 'Photo storage is unavailable.');
  }
  const keyBase64 = (value as Record<string, unknown>).keyBase64;
  if (typeof keyBase64 !== 'string') {
    throw new AppError('vault_key', 'Photo storage is unavailable.');
  }
  return { version: 1, keyBase64 };
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
