import type { CameraAdapterKind } from '@grace-booth/shared';
import { z } from 'zod';

import { AppError } from './errors.js';

const EnvironmentSchema = z
  .object({
    GRACE_BOOTH_CAMERA_ADAPTER: z.enum(['mock', 'sony', 'webcam']).default('webcam'),
    GRACE_BOOTH_SUPABASE_URL: z
      .url()
      .refine((value) => {
        const url = new URL(value);
        return (
          url.protocol === 'https:' ||
          (url.protocol === 'http:' && ['127.0.0.1', 'localhost', '::1'].includes(url.hostname))
        );
      }, 'Supabase URL must use HTTPS except for local loopback development')
      .optional(),
    GRACE_BOOTH_SUPABASE_PUBLISHABLE_KEY: z.string().min(20).max(1_000).optional(),
    GRACE_BOOTH_E2E: z.enum(['0', '1']).default('0'),
    GRACE_BOOTH_E2E_COUNTDOWN_MS: z.coerce.number().int().min(10).max(5_000).optional(),
    GRACE_BOOTH_E2E_CAMERA_DELAY_MS: z.coerce.number().int().min(0).max(10_000).optional(),
    GRACE_BOOTH_E2E_CAPTURE_FAIL_SHOT: z.coerce.number().int().min(1).max(3).optional(),
    GRACE_BOOTH_E2E_UPLOAD_FAILURES: z.coerce.number().int().min(0).max(4).optional(),
    GRACE_BOOTH_E2E_CREATE_DELAY_MS: z.coerce.number().int().min(0).max(60_000).optional(),
    GRACE_BOOTH_E2E_UPLOAD_DELAY_MS: z.coerce.number().int().min(0).max(60_000).optional(),
    GRACE_BOOTH_E2E_CONFIRM_DELAY_MS: z.coerce.number().int().min(0).max(60_000).optional(),
    GRACE_BOOTH_E2E_NOW_MS: z.coerce.number().int().positive().optional(),
  })
  .loose();

export type RuntimeConfig = {
  cameraAdapter: CameraAdapterKind;
  cloud: { url: string | null; publishableKey: string | null };
  shotCountdownsMs: readonly [number, number, number];
  e2e: {
    enabled: boolean;
    cameraDelayMs: number;
    captureFailShot: number | null;
    uploadFailures: number;
    deliveryDelays: { createMs: number; uploadMs: number; confirmMs: number };
  };
  now(): number;
};

export const DEFAULT_PROD_SUPABASE_URL = 'https://bejgkclvsfbkpkflftxu.supabase.co';
export const DEFAULT_PROD_SUPABASE_PUBLISHABLE_KEY =
  'sb_publishable_kOTsRWT42YKfBIfxTW2eHA_vPjE9j4O';

export function loadRuntimeConfig(
  environment: NodeJS.ProcessEnv,
  isPackaged: boolean,
): RuntimeConfig {
  const parsed = EnvironmentSchema.parse(environment);
  const e2eEnabled = parsed.GRACE_BOOTH_E2E === '1';
  if (e2eEnabled && isPackaged) {
    throw new AppError(
      'e2e_forbidden',
      'Development test mode is disabled in packaged Grace Booth builds.',
    );
  }
  if (!!parsed.GRACE_BOOTH_SUPABASE_URL !== !!parsed.GRACE_BOOTH_SUPABASE_PUBLISHABLE_KEY) {
    throw new AppError(
      'cloud_config_incomplete',
      'Set both the Supabase URL and publishable key, or leave both unset.',
    );
  }
  const clockStartedAt = Date.now();
  const clockBase =
    e2eEnabled && parsed.GRACE_BOOTH_E2E_NOW_MS ? parsed.GRACE_BOOTH_E2E_NOW_MS : clockStartedAt;

  const cloudUrl =
    parsed.GRACE_BOOTH_SUPABASE_URL ?? (e2eEnabled ? null : DEFAULT_PROD_SUPABASE_URL);
  const cloudPublishableKey =
    parsed.GRACE_BOOTH_SUPABASE_PUBLISHABLE_KEY ??
    (e2eEnabled ? null : DEFAULT_PROD_SUPABASE_PUBLISHABLE_KEY);

  const e2eCountdownMs = parsed.GRACE_BOOTH_E2E_COUNTDOWN_MS ?? 40;
  const shotCountdownsMs: readonly [number, number, number] = e2eEnabled
    ? [e2eCountdownMs, e2eCountdownMs, e2eCountdownMs]
    : [8_000, 5_000, 5_000];

  return {
    cameraAdapter: parsed.GRACE_BOOTH_CAMERA_ADAPTER,
    cloud: {
      url: cloudUrl,
      publishableKey: cloudPublishableKey,
    },
    shotCountdownsMs,
    e2e: {
      enabled: e2eEnabled,
      cameraDelayMs: e2eEnabled ? (parsed.GRACE_BOOTH_E2E_CAMERA_DELAY_MS ?? 10) : 300,
      captureFailShot: e2eEnabled ? (parsed.GRACE_BOOTH_E2E_CAPTURE_FAIL_SHOT ?? null) : null,
      uploadFailures: e2eEnabled ? (parsed.GRACE_BOOTH_E2E_UPLOAD_FAILURES ?? 0) : 0,
      deliveryDelays: {
        createMs: e2eEnabled ? (parsed.GRACE_BOOTH_E2E_CREATE_DELAY_MS ?? 0) : 0,
        uploadMs: e2eEnabled ? (parsed.GRACE_BOOTH_E2E_UPLOAD_DELAY_MS ?? 0) : 0,
        confirmMs: e2eEnabled ? (parsed.GRACE_BOOTH_E2E_CONFIRM_DELAY_MS ?? 0) : 0,
      },
    },
    now: () => clockBase + (Date.now() - clockStartedAt),
  };
}
