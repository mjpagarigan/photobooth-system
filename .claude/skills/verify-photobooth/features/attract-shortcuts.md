# Attract shortcuts

From the attract screen, anyone can open the Recent Photos gallery of the last 20 collages, and an operator can open Camera Setup to choose the camera and resolution.

## Sub-features

- `recent-open` opens the Recent Photos gallery.
- `recent-close` closes it and returns to attract.
- `camera-open` opens the `Camera configuration` dialog.
- `camera-close` closes it and returns to attract.

## How to get to it (user POV)

- Tap `Recent Photos` on the attract screen (also on the final screen).
- Tap `Camera Setup` on the attract screen.

## Driving it with verify-photobooth

Preconditions:

- Doctor is `READY`.

- **Run.** `pnpm exec playwright test -c .claude/skills/verify-photobooth/playwright.config.ts --project=kiosk kiosk-operator`. The first two steps of that journey cover this feature.
- **Recent.** Tap `Recent Photos`; `recent-gallery` shows. Evidence `operator/01-recent-photos`. Tap `Close recent photos`; the gallery is gone.
- **Camera.** Tap `Camera Setup`; a dialog titled `Camera configuration` shows. Evidence `operator/02-camera-setup`. Tap the dialog's `Close`; no dialog remains.

## Gotchas

- A fresh user-data dir has no finished sessions, so the gallery shows its empty state. Run the guest journey in the same instance first to see thumbnails.
- In a fresh user-data dir the dialog selects `Laptop / USB Webcam` with `Default system webcam`, and the preview reads `Waiting for camera` because the harness grants no camera. Real device selection and a live preview are unverified by this harness. Do not tap `Apply & Save` unless the journey is about camera settings; it saves camera settings for the rest of the run.
- `Recent Photos` appears twice on some screens; use `.first()`.
