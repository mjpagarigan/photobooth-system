import type { SessionState } from '@grace-booth/shared';

import { AppError } from '../errors.js';

export type SessionEvent =
  | 'start'
  | 'countdown_elapsed'
  | 'capture_shot_ready'
  | 'capture_more'
  | 'capture_complete'
  | 'retake_shot'
  | 'accept_shot_more'
  | 'accept_shot_complete'
  | 'retake_all'
  | 'accept_photos'
  | 'processing_complete'
  | 'upload_begin'
  | 'upload_retry_wait'
  | 'upload_failed'
  | 'confirmation_ready'
  | 'qr_ready'
  | 'done'
  | 'camera_failed'
  | 'processing_interrupted'
  | 'app_interrupted'
  | 'resume_processing'
  | 'resume_upload'
  | 'reconcile_partial_capture'
  | 'operator_restart';

const TRANSITIONS = {
  attract: { start: 'countdown' },
  countdown: {
    countdown_elapsed: 'capturing',
    camera_failed: 'camera_error',
    app_interrupted: 'interrupted',
  },
  capturing: {
    capture_shot_ready: 'shot_review',
    capture_more: 'countdown',
    capture_complete: 'review',
    camera_failed: 'camera_error',
    app_interrupted: 'interrupted',
  },
  shot_review: {
    retake_shot: 'countdown',
    accept_shot_more: 'countdown',
    accept_shot_complete: 'review',
    app_interrupted: 'interrupted',
  },
  review: {
    retake_all: 'countdown',
    accept_photos: 'processing',
    app_interrupted: 'interrupted',
  },
  processing: {
    processing_complete: 'pending_upload',
    processing_interrupted: 'interrupted',
    app_interrupted: 'interrupted',
  },
  pending_upload: {
    upload_begin: 'uploading',
    upload_failed: 'upload_failed',
    confirmation_ready: 'ready',
  },
  uploading: {
    upload_retry_wait: 'pending_upload',
    upload_failed: 'upload_failed',
    confirmation_ready: 'ready',
    app_interrupted: 'pending_upload',
  },
  ready: { qr_ready: 'final' },
  final: { done: 'attract' },
  camera_error: { operator_restart: 'countdown' },
  upload_failed: {
    resume_upload: 'pending_upload',
    confirmation_ready: 'ready',
  },
  interrupted: {
    operator_restart: 'countdown',
    resume_processing: 'processing',
    resume_upload: 'pending_upload',
    reconcile_partial_capture: 'camera_error',
  },
} as const satisfies Record<SessionState, Partial<Record<SessionEvent, SessionState>>>;

export function reduceSessionState(state: SessionState, event: SessionEvent): SessionState {
  const next = (TRANSITIONS[state] as Partial<Record<SessionEvent, SessionState>>)[event];
  if (!next) {
    throw new AppError(
      'illegal_transition',
      `Event ${event} is not valid while the session is ${state}.`,
    );
  }
  return next;
}

export function isLegalSessionTransition(
  state: SessionState,
  event: SessionEvent,
  expected: SessionState,
): boolean {
  try {
    return reduceSessionState(state, event) === expected;
  } catch {
    return false;
  }
}

export const SESSION_EVENTS: readonly SessionEvent[] = [
  'start',
  'countdown_elapsed',
  'capture_shot_ready',
  'capture_more',
  'capture_complete',
  'retake_shot',
  'accept_shot_more',
  'accept_shot_complete',
  'retake_all',
  'accept_photos',
  'processing_complete',
  'upload_begin',
  'upload_retry_wait',
  'upload_failed',
  'confirmation_ready',
  'qr_ready',
  'done',
  'camera_failed',
  'processing_interrupted',
  'app_interrupted',
  'resume_processing',
  'resume_upload',
  'reconcile_partial_capture',
  'operator_restart',
] as const;

export const LEGAL_TRANSITIONS: Readonly<
  Record<SessionState, Readonly<Partial<Record<SessionEvent, SessionState>>>>
> = TRANSITIONS;
