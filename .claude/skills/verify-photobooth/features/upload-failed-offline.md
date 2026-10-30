# Upload failure and Finish offline

When cloud delivery fails, the booth retries after 1, 3 and 8 seconds, then shows a recovery screen that keeps the photo. The guest can retry the upload or finish offline and download over the booth's own network.

## Sub-features

- `upload-retrying` shows processing in `pending_upload` state while retries run.
- `upload-failed` shows the `Your upload didn’t finish.` recovery screen with `Retry upload` and `Finish offline`.
- `upload-retry` retries and reaches the final screen.
- `upload-offline` finishes offline and reaches the final screen with a same-network QR.

## How to get to it (user POV)

- Accept photos while the cloud is unreachable. The recovery screen appears after the retries.

## Driving it with verify-photobooth

Preconditions:

- Doctor is `READY`. The run sets `GRACE_BOOTH_E2E_UPLOAD_FAILURES=4`, which exhausts all automatic retries.

- **Run.** `pnpm exec playwright test -c .claude/skills/verify-photobooth/playwright.config.ts --project=kiosk kiosk-upload-failed`.
- **Retrying.** After `Use these photos`, `processing-screen` reports `data-state="pending_upload"`. Evidence `upload-failed/01-retrying`.
- **Failed.** `recovery-upload` shows the heading `Your upload didn’t finish.`. Evidence `02-upload-failed`.
- **Finish offline.** `Finish offline` is enabled; tap it. `final-screen` shows the download QR. Evidence `03-final-offline`.

## Gotchas

- The retry phase reports `pending_upload`, not `uploading`. Waiting for `uploading` times out.
- Recovery takes about 12 seconds of real retry backoff; no override shortens it.
- `Retry upload` is not driven by this journey. To prove it, set `GRACE_BOOTH_E2E_UPLOAD_FAILURES` to 4, tap `Retry upload`, and expect `final-screen` (the fifth attempt succeeds).
- The recovery message reads "The test upload failure was injected." in E2E mode. Production copy differs.
