# Photobooth verification map

This directory is the maintained source for verifying what guests and operators see in the M.A.T. Photobooth. Read the index, then use the matching feature file as the recipe.

## Baseline preconditions

- `pnpm build:kiosk` has run since the last change under `apps/kiosk/src`.
- `node .claude/skills/verify-photobooth/scripts/doctor.mjs` prints `READY`.
- Every Electron journey starts from first launch in a fresh `%TEMP%\grace-booth-verify-*` directory, so the first screen is the `Create operator passcode` dialog.
- The kiosk runs with `GRACE_BOOTH_E2E=1` and the mock camera. Captures are generated scenes, and cloud delivery is the deterministic E2E client.
- Never drive an instance this run did not start.

## Driving conventions

- Run journeys with `pnpm exec playwright test -c .claude/skills/verify-photobooth/playwright.config.ts --project=<kiosk|screen2|public> [file filter]`.
- Prefer role plus accessible name, then `data-testid`. Do not click by coordinates.
- Use `capture(page, feature, step)` for every step a reviewer needs to see.
- Shorten countdowns with `GRACE_BOOTH_E2E_COUNTDOWN_MS` only as far as the step needs. 1500 ms leaves time to screenshot the countdown.

## Proof and skip reporting

- A proof names the journey, the evidence folder, and each step file.
- Capture the action and the resulting screen, plus any stored side effect the feature file names.
- Report a path the harness cannot reach (real dual-display, physical camera) as unverified, with the reason. Do not report the fixture or a different path in its place.

## Feature entry contract

Each feature file starts with an H1 and one paragraph of user-visible behavior, then four H2s in order: `Sub-features`, `How to get to it (user POV)`, `Driving it with verify-photobooth`, `Gotchas`.

## Features

- [Guest flow](./guest-flow.md) covers attract, countdown, review, retake, layout choice, processing, final QR, and Done.
- [Upload failure and Finish offline](./upload-failed-offline.md) covers automatic retries, the recovery screen, and offline delivery.
- [Screen 2 QR station](./screen2-qr-station.md) covers the latest-result display in dual-display mode.
- [Attract shortcuts](./attract-shortcuts.md) covers Recent Photos and Camera Setup from the attract screen.
- [Operator access and admin](./operator-admin.md) covers the passcode, frame editor, admin recent photos, and settings and health.
- [Guest download page](./public-download.md) covers the phone page a guest opens from the QR code.
