# Guest flow

A guest starts a session, poses for one countdown per frame slot, reviews the set, can retake all photos, picks a collage layout, waits while the collage is made and delivered, then scans a QR code and taps Done to hand the booth to the next guest.

## Sub-features

- `guest-start` starts a session from the attract screen.
- `guest-countdown` shows a numbered countdown and "Photo N of M" before each shot.
- `guest-review` shows every compatible layout filled with the captured photos.
- `guest-retake` replaces the whole set and returns to review.
- `guest-layout` changes the selected collage layout.
- `guest-processing` shows progress while the collage is composed and uploaded.
- `guest-final` shows the finished collage, the download QR, and the 30-day notice.
- `guest-done` returns to attract with focus on the start button.

## How to get to it (user POV)

- Tap `Start photo session` on the attract screen.
- In review, tap `Retake all photos` or a layout card, then `Use these photos`.
- On the final screen, tap `Done`.

## Driving it with verify-photobooth

Preconditions:

- Doctor is `READY` and the kiosk build is current.

- **Run.** `pnpm exec playwright test -c .claude/skills/verify-photobooth/playwright.config.ts --project=kiosk kiosk-guest`. Overrides used: `GRACE_BOOTH_E2E_COUNTDOWN_MS=1500`, `GRACE_BOOTH_E2E_CONFIRM_DELAY_MS=3000`.
- **First launch.** The `Create operator passcode` dialog shows. Evidence `guest-flow/01-operator-bootstrap`.
- **Attract.** After the passcode is saved, `attract-screen` shows. Evidence `02-attract`.
- **Countdown.** Tap `Start photo session`; `capture-screen` shows a countdown. Evidence `03-countdown`.
- **Review.** `review-screen` shows and `collage-option-1` holds 3 photos. Evidence `04-review`.
- **Retake.** Tap `Retake all photos`; `capture-screen` returns, then review again. Evidence `05-retake-countdown`.
- **Layout.** Tap `collage-option-2`; it reports `aria-checked="true"`. Evidence `06-review-layout-2`.
- **Processing.** Tap `Use these photos`; `processing-screen` shows. Evidence `07-processing`.
- **Final.** `final-screen` shows the QR image `QR code for your private photo download` and a loaded collage in the `Your finished photo` region. Evidence `08-final-qr` and `08-final-collage-size.json`.
- **Done.** Tap `Done`; `Start photo session` is focused. Evidence `09-attract-after-done`.

## Gotchas

- With the default 40 ms countdown the countdown screen is gone before a screenshot. Keep 1500 ms when you need `03-countdown`.
- Frames have arbitrary aspect ratios, so do not assert a fixed collage size. Assert it loaded and record the size.
- Retake resets the review, so choose the layout after the last retake.
- The final collage image has an empty `alt` on one copy; select it through the `Your finished photo` region.
