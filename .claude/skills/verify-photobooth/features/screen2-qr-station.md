# Screen 2 QR station

In dual-display mode, the second screen shows the newest finished collage with its QR code and an auto-dismiss timer while Screen 1 returns to attract for the next guest.

## Sub-features

- `screen2-active` shows the latest collage, QR code, and timer.
- `screen2-idle` shows the M.A.T. logo, "Your photo appears here.", and the Recent control. The journeys do not reach it; `scripts/compare.mjs qr-station-idle=Screen2Idle` renders its fixture.
- `screen2-routing` sends a newer result to Screen 2 and replaces an older one. Not reachable by this harness.

## How to get to it (user POV)

- Connect a second display in Windows `Extend these displays`, set `Admin > Settings & health > Displays` to `Auto` or `Force Enabled`, and finish a session.

## Driving it with verify-photobooth

Preconditions:

- Doctor is `READY`. The run starts the kiosk renderer on port 4174.

- **Run.** `pnpm exec playwright test -c .claude/skills/verify-photobooth/playwright.config.ts --project=screen2`.
- **Active result.** Opening `/?view=qr-station&visual=qr-station-active` shows `qr-station-active`. Evidence `screen2/01-latest-result-1366x768` and `02-latest-result-1920x1080`.

## Gotchas

- This is fixture data rendered by the real `QrStationScreen` component, without the Electron bridge. It proves layout, not IPC, display assignment, or timers.
- Real dual-display needs two physical monitors. With one monitor, the display manager never opens the QR station window. Report `screen2-idle` and `screen2-routing` as unverified unless a second monitor is attached and an operator confirms it.
- Without `visual=qr-station-active`, the renderer has no Electron bridge and never loads a station state, so the page is not a valid picture of the idle screen.
