import { createHash } from 'node:crypto';
import { GetObjectCommand, type S3Client } from 'npm:@aws-sdk/client-s3@^3.750.0';
import { byteaToHex } from '../_shared/encoding.ts';
import { isR2Configured, photoBucket, r2BucketName } from '../_shared/env.ts';
import { createR2Client } from '../_shared/r2.ts';
import {
  type StorageVerificationResult,
  verifyStoredPhoto,
} from '../_shared/storage-verification.ts';
import { type AdminClient, createAdminClient } from '../_shared/supabase.ts';
import { sha256Hex } from '../_shared/token.ts';

const CONCURRENCY = 4;
const VERIFICATION_TIMEOUT_MS = 10_000;
const PAGE_SIZE = 500;

export const REPAIR_CLASSIFICATIONS = [
  'supabase-present',
  'r2-verified',
  'missing-both',
  'size-mismatch',
  'hash-mismatch',
  'expired-or-changed',
  'verification-error',
] as const;

export type RepairClassification = (typeof REPAIR_CLASSIFICATIONS)[number];

export type RepairCandidate = {
  id: string;
  storage_object_path: string;
  storage_backend: 'supabase' | 'r2';
  status: 'pending' | 'ready' | 'expired' | 'deleting' | 'deleted';
  content_type: 'image/jpeg';
  byte_size: number;
  content_sha256: string;
  expires_at: string;
};

export type CandidateClassifierDependencies = {
  verifySupabase: (candidate: RepairCandidate) => Promise<StorageVerificationResult>;
  verifyR2: (
    candidate: RepairCandidate,
  ) => Promise<{ byteSize: number; sha256: string } | null>;
  loadCurrent: (id: string) => Promise<RepairCandidate | null>;
  now: () => number;
};

function sameSnapshot(left: RepairCandidate, right: RepairCandidate): boolean {
  return left.id === right.id &&
    left.storage_object_path === right.storage_object_path &&
    left.storage_backend === right.storage_backend &&
    left.status === right.status &&
    left.content_type === right.content_type &&
    Number(left.byte_size) === Number(right.byte_size) &&
    left.content_sha256 === right.content_sha256 &&
    left.expires_at === right.expires_at;
}

export async function classifyCandidate(
  candidate: RepairCandidate,
  dependencies: CandidateClassifierDependencies,
): Promise<RepairClassification> {
  try {
    if (
      candidate.status !== 'ready' ||
      candidate.storage_backend !== 'supabase' ||
      Date.parse(candidate.expires_at) <= dependencies.now()
    ) {
      return 'expired-or-changed';
    }

    const supabase = await dependencies.verifySupabase(candidate);
    let classification: RepairClassification;
    if (supabase === 'available') {
      classification = 'supabase-present';
    } else if (supabase === 'mismatch') {
      classification = 'size-mismatch';
    } else {
      const r2 = await dependencies.verifyR2(candidate);
      if (!r2) classification = 'missing-both';
      else if (r2.byteSize !== Number(candidate.byte_size)) classification = 'size-mismatch';
      else if (r2.sha256 !== candidate.content_sha256) classification = 'hash-mismatch';
      else classification = 'r2-verified';
    }

    const current = await dependencies.loadCurrent(candidate.id);
    if (
      !current ||
      !sameSnapshot(candidate, current) ||
      Date.parse(current.expires_at) <= dependencies.now()
    ) {
      return 'expired-or-changed';
    }
    return classification;
  } catch {
    return 'verification-error';
  }
}

function withTimeout<T>(operation: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timer = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(new Error('verification_timeout')), VERIFICATION_TIMEOUT_MS);
  });
  return Promise.race([operation, timer]).finally(() => {
    if (timeout !== undefined) clearTimeout(timeout);
  });
}

async function mapConcurrent<T, R>(
  values: readonly T[],
  limit: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= values.length) return;
      const value = values[index];
      if (value !== undefined) results[index] = await mapper(value);
    }
  });
  await Promise.all(workers);
  return results;
}

function normalizedCandidate(value: unknown): RepairCandidate | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  const hash = typeof row.content_sha256 === 'string' ? byteaToHex(row.content_sha256) : null;
  if (
    typeof row.id !== 'string' ||
    typeof row.storage_object_path !== 'string' ||
    (row.storage_backend !== 'supabase' && row.storage_backend !== 'r2') ||
    !['pending', 'ready', 'expired', 'deleting', 'deleted'].includes(String(row.status)) ||
    row.content_type !== 'image/jpeg' ||
    !Number.isSafeInteger(Number(row.byte_size)) ||
    !hash ||
    typeof row.expires_at !== 'string'
  ) {
    return null;
  }
  return {
    id: row.id,
    storage_object_path: row.storage_object_path,
    storage_backend: row.storage_backend,
    status: row.status as RepairCandidate['status'],
    content_type: row.content_type,
    byte_size: Number(row.byte_size),
    content_sha256: hash,
    expires_at: row.expires_at,
  };
}

const SELECT_COLUMNS =
  'id, storage_object_path, storage_backend, status, content_type, byte_size, content_sha256, expires_at';

async function inventoryCandidates(admin: AdminClient, now: number): Promise<RepairCandidate[]> {
  const candidates: RepairCandidate[] = [];
  for (let offset = 0;; offset += PAGE_SIZE) {
    const { data, error } = await admin
      .from('photo_sessions')
      .select(SELECT_COLUMNS)
      .eq('status', 'ready')
      .eq('storage_backend', 'supabase')
      .gt('expires_at', new Date(now).toISOString())
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error || !Array.isArray(data)) throw new Error('inventory_failed');
    for (const row of data) {
      const candidate = normalizedCandidate(row);
      if (!candidate) throw new Error('inventory_invalid');
      candidates.push(candidate);
    }
    if (data.length < PAGE_SIZE) return candidates;
  }
}

async function loadCurrent(admin: AdminClient, id: string): Promise<RepairCandidate | null> {
  const { data, error } = await admin
    .from('photo_sessions')
    .select(SELECT_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error('inventory_failed');
  return data ? normalizedCandidate(data) : null;
}

async function streamR2Verification(
  r2: S3Client,
  candidate: RepairCandidate,
): Promise<{ byteSize: number; sha256: string } | null> {
  try {
    const response = await r2.send(
      new GetObjectCommand({
        Bucket: r2BucketName(),
        Key: candidate.storage_object_path,
      }),
      { abortSignal: AbortSignal.timeout(VERIFICATION_TIMEOUT_MS) },
    );
    if (!response.Body) throw new Error('empty_r2_body');
    const hash = createHash('sha256');
    let byteSize = 0;
    if (Symbol.asyncIterator in Object(response.Body)) {
      for await (const rawChunk of response.Body as AsyncIterable<Uint8Array>) {
        const chunk = rawChunk instanceof Uint8Array ? rawChunk : new Uint8Array(rawChunk);
        byteSize += chunk.byteLength;
        hash.update(chunk);
      }
    } else {
      const bytes = await response.Body.transformToByteArray();
      byteSize = bytes.byteLength;
      hash.update(bytes);
    }
    return { byteSize, sha256: hash.digest('hex') };
  } catch (error: unknown) {
    const candidateError = error as { name?: string; $metadata?: { httpStatusCode?: number } };
    if (
      candidateError?.name === 'NoSuchKey' ||
      candidateError?.$metadata?.httpStatusCode === 404
    ) {
      return null;
    }
    throw new Error('r2_verification_failed');
  }
}

type ClassifiedCandidate = {
  candidate: RepairCandidate;
  classification: RepairClassification;
  fingerprint: string;
};

async function scan(admin: AdminClient, r2: S3Client): Promise<ClassifiedCandidate[]> {
  const scanNow = Date.now();
  const candidates = await inventoryCandidates(admin, scanNow);
  return await mapConcurrent(candidates, CONCURRENCY, async (candidate) => {
    const classification = await classifyCandidate(candidate, {
      verifySupabase: (value) =>
        withTimeout(
          verifyStoredPhoto(admin, value, {
            isR2Configured,
            createR2Client: () => r2,
            checkR2ObjectExists: () => Promise.reject(new Error('not_used')),
            photoBucket,
          }),
        ),
      verifyR2: (value) => withTimeout(streamR2Verification(r2, value)),
      loadCurrent: (id) => withTimeout(loadCurrent(admin, id)),
      now: () => scanNow,
    });
    return {
      candidate,
      classification,
      fingerprint: (await sha256Hex(JSON.stringify([
        candidate.id,
        candidate.storage_object_path,
        candidate.storage_backend,
        candidate.status,
        candidate.content_type,
        candidate.byte_size,
        candidate.content_sha256,
        candidate.expires_at,
      ]))).slice(0, 20),
    };
  });
}

function reportRows(rows: readonly ClassifiedCandidate[]): {
  counts: Record<RepairClassification, number>;
  fingerprints: Record<RepairClassification, string[]>;
} {
  const counts: Record<RepairClassification, number> = {
    'supabase-present': 0,
    'r2-verified': 0,
    'missing-both': 0,
    'size-mismatch': 0,
    'hash-mismatch': 0,
    'expired-or-changed': 0,
    'verification-error': 0,
  };
  const fingerprints: Record<RepairClassification, string[]> = {
    'supabase-present': [],
    'r2-verified': [],
    'missing-both': [],
    'size-mismatch': [],
    'hash-mismatch': [],
    'expired-or-changed': [],
    'verification-error': [],
  };
  for (const row of rows) {
    counts[row.classification] += 1;
    fingerprints[row.classification].push(row.fingerprint);
  }
  for (const values of Object.values(fingerprints)) values.sort();
  return { counts, fingerprints };
}

function stableReport(rows: readonly ClassifiedCandidate[]): string {
  return JSON.stringify(reportRows(rows));
}

type Arguments = {
  apply: boolean;
  batchId: string | null;
  confirmCount: number | null;
  rollbackBatch: string | null;
};

export function parseArguments(args: string[]): Arguments {
  const readValue = (flag: string): string | null => {
    const index = args.indexOf(flag);
    return index >= 0 ? (args[index + 1] ?? null) : null;
  };
  const apply = args.includes('--apply');
  const batchId = readValue('--batch-id');
  const confirmCountRaw = readValue('--confirm-count');
  const rollbackBatch = readValue('--rollback-batch');
  const confirmCount = confirmCountRaw === null ? null : Number(confirmCountRaw);
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
  if (rollbackBatch !== null) {
    if (apply || batchId !== null || confirmCountRaw !== null || !uuidPattern.test(rollbackBatch)) {
      throw new Error('invalid_arguments');
    }
  } else if (
    apply &&
    (
      !batchId ||
      !uuidPattern.test(batchId) ||
      confirmCount === null ||
      !Number.isSafeInteger(confirmCount) ||
      confirmCount < 0
    )
  ) {
    throw new Error('invalid_arguments');
  }
  if (!apply && (batchId !== null || confirmCountRaw !== null)) {
    throw new Error('invalid_arguments');
  }
  return { apply, batchId, confirmCount, rollbackBatch };
}

async function applyRepairs(
  admin: AdminClient,
  rows: readonly ClassifiedCandidate[],
  batchId: string,
): Promise<Record<string, { count: number; fingerprints: string[] }>> {
  const outcomes: Record<string, { count: number; fingerprints: string[] }> = {};
  for (const row of rows.filter((value) => value.classification === 'r2-verified')) {
    const candidate = row.candidate;
    const { data, error } = await admin.rpc('repair_photo_storage_backend', {
      p_batch_id: batchId,
      p_session_id: candidate.id,
      p_expected_storage_object_path: candidate.storage_object_path,
      p_expected_byte_size: candidate.byte_size,
      p_expected_content_sha256_hex: candidate.content_sha256,
      p_expected_expires_at: candidate.expires_at,
      p_expected_status: 'ready',
      p_expected_storage_backend: 'supabase',
      p_source: 'admin-r2-verification',
    });
    const outcome = error ? 'verification-error' : String(Array.isArray(data) ? data[0] : data);
    const bucket = outcomes[outcome] ?? { count: 0, fingerprints: [] };
    bucket.count += 1;
    bucket.fingerprints.push(row.fingerprint);
    outcomes[outcome] = bucket;
  }
  for (const value of Object.values(outcomes)) value.fingerprints.sort();
  return outcomes;
}

async function main(args: string[]): Promise<void> {
  const parsed = parseArguments(args);
  const admin = createAdminClient();
  if (parsed.rollbackBatch) {
    const { data, error } = await admin.rpc('rollback_photo_storage_backend_repair', {
      p_batch_id: parsed.rollbackBatch,
    });
    if (error || !Number.isSafeInteger(Number(data))) throw new Error('rollback_failed');
    console.log(JSON.stringify({
      counts: { rolledBack: Number(data) },
      fingerprints: { batch: [(await sha256Hex(parsed.rollbackBatch)).slice(0, 20)] },
    }));
    return;
  }
  if (!isR2Configured()) throw new Error('r2_unconfigured');
  const r2 = createR2Client();
  try {
    const first = await scan(admin, r2);
    console.log(stableReport(first));
    if (!parsed.apply) return;
    const expected = first.filter((row) => row.classification === 'r2-verified').length;
    if (expected !== parsed.confirmCount) throw new Error('verified_count_mismatch');

    const revalidated = await scan(admin, r2);
    if (stableReport(first) !== stableReport(revalidated)) {
      throw new Error('inventory_changed');
    }
    if (!parsed.batchId) throw new Error('invalid_arguments');
    const outcomes = await applyRepairs(admin, revalidated, parsed.batchId);
    console.log(JSON.stringify({
      counts: Object.fromEntries(
        Object.entries(outcomes).map(([outcome, value]) => [outcome, value.count]),
      ),
      fingerprints: Object.fromEntries(
        Object.entries(outcomes).map(([outcome, value]) => [outcome, value.fingerprints]),
      ),
    }));
  } finally {
    r2.destroy();
  }
}

if (import.meta.main) {
  try {
    await main(Deno.args);
  } catch {
    console.error('Storage repair stopped safely. No unverified change was requested.');
    Deno.exitCode = 1;
  }
}
