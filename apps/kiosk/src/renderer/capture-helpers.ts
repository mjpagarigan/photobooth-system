import {
  DEFAULT_CAPTURE_COUNTDOWN_SECONDS,
  MAX_CAPTURE_COUNTDOWN_SECONDS,
  MIN_CAPTURE_COUNTDOWN_SECONDS,
} from '@grace-booth/shared';

const POSE_PROMPTS = [
  'Made to Serve · Warm smiles & eyes on lens!',
  'Discover Your Gift · Fun & playful pose!',
  'Better Together · Lean in & strike a pose!',
  'Share the Joy · Big energy & bright smiles!',
] as const;

const FINALE_POSE_PROMPT = 'Celebrate Together · Grand celebratory finale!';

export function posePromptForShot(shotNumber: number, totalShots: number): string {
  const safeTotal = Math.max(1, Math.trunc(totalShots));
  const safeShot = Math.max(1, Math.min(safeTotal, Math.trunc(shotNumber)));
  if (safeShot === safeTotal) {
    return FINALE_POSE_PROMPT;
  }
  return POSE_PROMPTS[(safeShot - 1) % POSE_PROMPTS.length] ?? FINALE_POSE_PROMPT;
}

export function computeDisplayedCountdownSeconds(
  deadlineMs: number | null,
  totalSeconds?: number | null,
  nowMs: number = Date.now(),
): number {
  const boundedTotal =
    totalSeconds != null && Number.isFinite(totalSeconds)
      ? Math.max(
          MIN_CAPTURE_COUNTDOWN_SECONDS,
          Math.min(MAX_CAPTURE_COUNTDOWN_SECONDS, Math.ceil(totalSeconds)),
        )
      : null;

  if (deadlineMs === null) {
    return boundedTotal ?? DEFAULT_CAPTURE_COUNTDOWN_SECONDS;
  }

  const upperBound = boundedTotal ?? MAX_CAPTURE_COUNTDOWN_SECONDS;
  const remaining = Math.ceil((deadlineMs - nowMs) / 1_000);
  return Math.max(MIN_CAPTURE_COUNTDOWN_SECONDS, Math.min(upperBound, remaining));
}
